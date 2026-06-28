-- ============================================================
-- 0063 — raw materials warehouse (المستودع)
--
-- The first piece of the inventory subsystem. A raw material is a
-- purchasable stock item held in the warehouse (مادة شراء), distinct
-- from a sellable catalog_item. Phase 1: stock moves only via
-- purchase invoices (0064, increment) and manual manager edits.
-- Phase 2 (later) will deplete it on sale via item recipes.
--
-- Schema highlights:
--   • current_quantity / low_stock_threshold are numeric(14,3) so we
--     can track fractional units (kg, litres) as well as whole pieces.
--   • last_purchase_price + cost_currency are a convenience snapshot of
--     the most recent purchase line; the authoritative per-purchase
--     price lives on purchase_invoice_lines (0064).
--   • RLS: read = all authenticated; insert = any authenticated user
--     (so reception can create a material while recording a purchase);
--     update / delete = manager only. The stock-increment trigger in
--     0064 runs SECURITY DEFINER so reception's purchase can still bump
--     a manager-owned material's quantity.
--
-- Idempotent: CREATE ... IF NOT EXISTS / DROP-then-CREATE throughout.
-- ============================================================

-- ── 1. raw_materials table ────────────────────────────────────
create table if not exists public.raw_materials (
  id                     uuid           primary key default gen_random_uuid(),
  name                   text           not null,
  unit                   text           not null default 'piece',
  current_quantity       numeric(14,3)  not null default 0,
  last_purchase_price    numeric(14,4)           check (last_purchase_price is null or last_purchase_price >= 0),
  cost_currency          text                    check (cost_currency is null or cost_currency in ('syp','usd')),
  low_stock_threshold    numeric(14,3)  not null default 0 check (low_stock_threshold >= 0),
  notes                  text,
  is_active              boolean        not null default true,
  created_by             uuid           references public.profiles(id),
  created_at             timestamptz    not null default now(),
  updated_at             timestamptz    not null default now()
);

create index if not exists idx_raw_materials_active_name on public.raw_materials(is_active, name);
-- Case-insensitive name index supports find-or-create on the purchase form.
create index if not exists idx_raw_materials_lower_name on public.raw_materials(lower(name));

-- ── 2. updated_at trigger ─────────────────────────────────────
create or replace function public.raw_materials_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists raw_materials_updated_at on public.raw_materials;
create trigger raw_materials_updated_at
  before update on public.raw_materials
  for each row execute function public.raw_materials_set_updated_at();

-- ── 3. RLS ────────────────────────────────────────────────────
alter table public.raw_materials enable row level security;

drop policy if exists raw_materials_read   on public.raw_materials;
drop policy if exists raw_materials_insert on public.raw_materials;
drop policy if exists raw_materials_update on public.raw_materials;
drop policy if exists raw_materials_delete on public.raw_materials;

create policy raw_materials_read on public.raw_materials
  for select to authenticated using (true);

-- Insert: any authenticated user, stamping themselves as creator.
create policy raw_materials_insert on public.raw_materials
  for insert to authenticated
  with check (created_by = auth.uid());

-- Update / delete: managers only (editing cost / threshold / corrections).
create policy raw_materials_update on public.raw_materials
  for update to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

create policy raw_materials_delete on public.raw_materials
  for delete to authenticated
  using (public.current_role() = 'manager');

-- ── 4. Realtime publication membership ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'raw_materials'
  ) then
    alter publication supabase_realtime add table public.raw_materials;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   alter publication supabase_realtime drop table public.raw_materials;
--   drop table if exists public.raw_materials cascade;
--   drop function if exists public.raw_materials_set_updated_at();
--   notify pgrst, 'reload schema';
-- ============================================================
