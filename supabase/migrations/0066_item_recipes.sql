-- ============================================================
-- 0066 — item recipes / bill-of-materials (الوصفات) + auto stock depletion
--
-- Phase 2 of the inventory subsystem. Links a sellable catalog_item
-- (مادة المبيع) to the warehouse raw_materials it consumes (المكونات
-- الأساسية), so selling the item automatically deducts its ingredients
-- from the warehouse — and restores them if the sale is cancelled.
--
--   item_recipes: one row per (catalog_item, raw_material) component, with
--   the quantity consumed per ONE unit sold, plus a unit label for display.
--   The depletion amount is recipe.quantity × item_sales.quantity, expressed
--   in the raw material's own stocking unit (no unit conversion is applied —
--   define the component quantity in the material's unit).
--
-- Triggers on item_sales (SECURITY DEFINER so reception's sale can move
-- manager-owned warehouse stock, mirroring the 0064 purchase triggers):
--   • AFTER INSERT  — deduct each component (only for non-cancelled rows).
--   • AFTER UPDATE OF cancelled_at — when a sale is newly cancelled, add the
--     components back. Deduct/restore are pure arithmetic (no floor) so they
--     stay symmetric and reversible; a material may go negative, which is a
--     deliberate "sold more than stocked — reorder" signal.
--
-- Note: catalog_items.stock_quantity (finished-good count) is a SEPARATE
-- concern handled in app code (intake.cancelTransaction); these triggers
-- only touch raw_materials. A meal with track_stock = false can still carry
-- a recipe that depletes ingredients.
--
-- Idempotent: CREATE ... IF NOT EXISTS / DROP-then-CREATE throughout.
-- Depends on 0030 (catalog_items, item_sales) and 0063 (raw_materials).
-- ============================================================

-- ── 1. item_recipes table ─────────────────────────────────────
create table if not exists public.item_recipes (
  id               uuid           primary key default gen_random_uuid(),
  catalog_item_id  uuid           not null references public.catalog_items(id) on delete cascade,
  raw_material_id  uuid           not null references public.raw_materials(id) on delete restrict,
  quantity         numeric(14,3)  not null check (quantity > 0),
  unit             text           not null,
  notes            text,
  created_by       uuid           references public.profiles(id),
  created_at       timestamptz    not null default now(),
  -- A material appears at most once per item's recipe.
  unique (catalog_item_id, raw_material_id)
);

create index if not exists idx_item_recipes_catalog on public.item_recipes(catalog_item_id);
create index if not exists idx_item_recipes_material on public.item_recipes(raw_material_id);

-- ── 2. deduct-on-sale trigger (SECURITY DEFINER) ──────────────
-- Subtracts every recipe component (quantity × units sold) from the
-- warehouse when a non-cancelled sale is recorded. Items without a recipe
-- match zero rows and cost nothing.
create or replace function public.item_sale_apply_recipe()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.catalog_item_id is not null and new.cancelled_at is null then
    update public.raw_materials rm
       set current_quantity = rm.current_quantity - (ir.quantity * new.quantity),
           updated_at       = now()
      from public.item_recipes ir
     where ir.catalog_item_id = new.catalog_item_id
       and ir.raw_material_id = rm.id;
  end if;
  return new;
end $$;

drop trigger if exists item_sales_recipe_deduct on public.item_sales;
create trigger item_sales_recipe_deduct
  after insert on public.item_sales
  for each row execute function public.item_sale_apply_recipe();

-- ── 3. restore-on-cancel trigger (SECURITY DEFINER) ───────────
-- When a sale transitions to cancelled, add its recipe components back.
create or replace function public.item_sale_restore_recipe()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null and new.catalog_item_id is not null then
    update public.raw_materials rm
       set current_quantity = rm.current_quantity + (ir.quantity * new.quantity),
           updated_at       = now()
      from public.item_recipes ir
     where ir.catalog_item_id = new.catalog_item_id
       and ir.raw_material_id = rm.id;
  end if;
  return new;
end $$;

drop trigger if exists item_sales_recipe_restore on public.item_sales;
create trigger item_sales_recipe_restore
  after update of cancelled_at on public.item_sales
  for each row execute function public.item_sale_restore_recipe();

-- ── 4. RLS ────────────────────────────────────────────────────
-- Recipes are a manager configuration concern: read = all authenticated,
-- write = manager only. Reception never edits recipes (but their sales
-- still deplete stock via the SECURITY DEFINER triggers above).
alter table public.item_recipes enable row level security;

drop policy if exists item_recipes_read   on public.item_recipes;
drop policy if exists item_recipes_insert on public.item_recipes;
drop policy if exists item_recipes_update on public.item_recipes;
drop policy if exists item_recipes_delete on public.item_recipes;

create policy item_recipes_read on public.item_recipes
  for select to authenticated using (true);
create policy item_recipes_insert on public.item_recipes
  for insert to authenticated
  with check (public.current_role() = 'manager');
create policy item_recipes_update on public.item_recipes
  for update to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');
create policy item_recipes_delete on public.item_recipes
  for delete to authenticated
  using (public.current_role() = 'manager');

-- ── 5. Realtime publication membership ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'item_recipes'
  ) then
    alter publication supabase_realtime add table public.item_recipes;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   alter publication supabase_realtime drop table public.item_recipes;
--   drop trigger if exists item_sales_recipe_deduct  on public.item_sales;
--   drop trigger if exists item_sales_recipe_restore on public.item_sales;
--   drop function if exists public.item_sale_apply_recipe();
--   drop function if exists public.item_sale_restore_recipe();
--   drop table if exists public.item_recipes cascade;
--   notify pgrst, 'reload schema';
-- ============================================================
