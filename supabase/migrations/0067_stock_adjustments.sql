-- ============================================================
-- 0067 — stock adjustments / wastage ledger (تعديلات وهدر المخزون)
--
-- Phase 3 of the inventory subsystem. An append-only ledger of manual
-- warehouse stock movements that are NOT purchases or sales: spoilage
-- (تلف), breakage (كسر), stock-count corrections (جرد), giveaways (هدية),
-- or anything else (أخرى). Each row carries a signed `delta` (negative for
-- loss, positive for a found/correction) applied to the material's current
-- quantity by an AFTER INSERT trigger.
--
-- Append-only by design: to undo a mistaken adjustment, record an opposite
-- one — the ledger stays a faithful audit trail. (No cancelled_at column.)
--
-- The apply trigger is SECURITY DEFINER for symmetry with the purchase /
-- recipe triggers, even though inserts are manager-only here.
--
-- Idempotent. Depends on 0063 (raw_materials).
-- ============================================================

-- ── 1. stock_adjustments table ────────────────────────────────
create table if not exists public.stock_adjustments (
  id                     uuid           primary key default gen_random_uuid(),
  raw_material_id        uuid           not null references public.raw_materials(id) on delete cascade,
  material_name_snapshot text           not null,
  delta                  numeric(14,3)  not null check (delta <> 0),
  reason                 text           not null check (reason in ('waste','breakage','count','gift','other')),
  notes                  text,
  created_by             uuid           not null references public.profiles(id),
  created_by_name        text,
  created_at             timestamptz    not null default now()
);

create index if not exists idx_stock_adjustments_material on public.stock_adjustments(raw_material_id);
create index if not exists idx_stock_adjustments_created on public.stock_adjustments(created_at desc);

-- ── 2. apply trigger (SECURITY DEFINER) ───────────────────────
create or replace function public.stock_adjustment_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.raw_materials
     set current_quantity = current_quantity + new.delta,
         updated_at       = now()
   where id = new.raw_material_id;
  return new;
end $$;

drop trigger if exists stock_adjustment_apply_trg on public.stock_adjustments;
create trigger stock_adjustment_apply_trg
  after insert on public.stock_adjustments
  for each row execute function public.stock_adjustment_apply();

-- ── 3. RLS ────────────────────────────────────────────────────
-- Read = all authenticated; insert = manager only. Append-only: no
-- update/delete policies (so the ledger can't be rewritten).
alter table public.stock_adjustments enable row level security;

drop policy if exists stock_adjustments_read   on public.stock_adjustments;
drop policy if exists stock_adjustments_insert on public.stock_adjustments;

create policy stock_adjustments_read on public.stock_adjustments
  for select to authenticated using (true);
create policy stock_adjustments_insert on public.stock_adjustments
  for insert to authenticated
  with check (created_by = auth.uid() and public.current_role() = 'manager');

-- ── 4. Realtime publication membership ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'stock_adjustments'
  ) then
    alter publication supabase_realtime add table public.stock_adjustments;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   alter publication supabase_realtime drop table public.stock_adjustments;
--   drop trigger if exists stock_adjustment_apply_trg on public.stock_adjustments;
--   drop function if exists public.stock_adjustment_apply();
--   drop table if exists public.stock_adjustments cascade;
--   notify pgrst, 'reload schema';
-- ============================================================
