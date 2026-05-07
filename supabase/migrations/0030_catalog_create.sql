-- ============================================================
-- 0030 — unified catalog: catalog_items + item_sales (schema only)
--
-- Creates the two new tables that replace the legacy split between
-- food_items (kitchen menu) and products (store inventory), and
-- between their downstream `sales` table.
--
-- This migration is ADDITIVE only:
--   • food_items, products, sales remain untouched and fully usable.
--   • The app continues to read/write them until the code switch ships.
--   • Backfill happens in 0031_catalog_backfill.sql.
--   • Legacy tables are kept indefinitely until a later legacy_drop step.
--
-- Schema highlights:
--   • catalog_items has a trigger-enforced column policy: reception can
--     only modify sell_price, stock_quantity, low_stock_threshold;
--     managers can modify any column. Both share the Postgres
--     `authenticated` role, so column-level GRANT alone cannot
--     differentiate them — a BEFORE UPDATE trigger handles it.
--   • item_sales has GENERATED STORED columns for amount_syp + amount_usd
--     so the app never writes them and aggregation never has to recompute
--     from currency + rate. Historical accuracy is preserved because the
--     stored generated value is computed from the row's own
--     exchange_rate_to_syp snapshot, never the live rate.
--   • A CHECK constraint refuses SYP rows with NULL or non-positive
--     exchange_rate (uncancelled rows only — cancelled rows are exempt
--     so legacy backfill of cancelled SYP rows with bad rates can land).
--
-- Idempotent: every CREATE TABLE / FUNCTION / TRIGGER / POLICY uses
-- IF NOT EXISTS or DROP-then-CREATE.
-- ============================================================

-- ── 1. catalog_items table ────────────────────────────────────
create table if not exists public.catalog_items (
  id                     uuid           primary key default gen_random_uuid(),
  name                   text           not null,
  category               text           not null check (category in ('meals','drinks','supplements','accessories','other')),
  item_type              text           not null check (item_type in ('meal','water','drink','supplement','product','other')),
  sell_currency          text           not null check (sell_currency in ('syp','usd')),
  sell_price             numeric(14,4)  not null check (sell_price >= 0),
  cost_currency          text                    check (cost_currency is null or cost_currency in ('syp','usd')),
  cost_price             numeric(14,4)           check (cost_price is null or cost_price >= 0),
  stock_quantity         integer        not null default 0 check (stock_quantity >= 0),
  track_stock            boolean        not null default false,
  low_stock_threshold    integer        not null default 3 check (low_stock_threshold >= 0),
  sort_order             integer        not null default 0,
  is_active              boolean        not null default true,
  created_by             uuid           references public.profiles(id),
  created_at             timestamptz    not null default now(),
  updated_at             timestamptz    not null default now()
);

create index if not exists idx_catalog_items_category    on public.catalog_items(category);
create index if not exists idx_catalog_items_item_type   on public.catalog_items(item_type);
create index if not exists idx_catalog_items_active_sort on public.catalog_items(is_active, sort_order, name);

-- ── 2. updated_at trigger on catalog_items ────────────────────
create or replace function public.catalog_items_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists catalog_items_updated_at on public.catalog_items;
create trigger catalog_items_updated_at
  before update on public.catalog_items
  for each row execute function public.catalog_items_set_updated_at();

-- ── 3. reception column-gating trigger on catalog_items ───────
-- Both reception and manager log in via Supabase auth and run as the
-- Postgres `authenticated` role, so we can't differentiate them via
-- column-level GRANT. Instead, this BEFORE UPDATE trigger looks up the
-- user's app-level role from public.profiles and rejects updates that
-- touch forbidden columns.
--
-- Bypass: when there is no JWT context (auth.uid() IS NULL), the trigger
-- trusts the caller. This covers direct SQL access via the Supabase
-- Dashboard SQL Editor and service-role calls used in migrations.
create or replace function public.enforce_reception_catalog_columns()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  -- Direct DB access (migrations, service role, dashboard editor): allow.
  if auth.uid() is null then
    return new;
  end if;

  -- Manager: allow any column change.
  if public.current_role() = 'manager' then
    return new;
  end if;

  -- Anyone else (reception): only sell_price, stock_quantity,
  -- and low_stock_threshold may differ from OLD.
  if  new.name                is distinct from old.name
   or new.category            is distinct from old.category
   or new.item_type           is distinct from old.item_type
   or new.sell_currency       is distinct from old.sell_currency
   or new.cost_currency       is distinct from old.cost_currency
   or new.cost_price          is distinct from old.cost_price
   or new.track_stock         is distinct from old.track_stock
   or new.is_active           is distinct from old.is_active
   or new.sort_order          is distinct from old.sort_order
   or new.created_by          is distinct from old.created_by
   or new.id                  is distinct from old.id
  then
    raise exception 'reception_locked_column'
      using hint = 'Only sell_price, stock_quantity, low_stock_threshold are editable by reception';
  end if;

  return new;
end $$;

drop trigger if exists catalog_items_reception_guard on public.catalog_items;
create trigger catalog_items_reception_guard
  before update on public.catalog_items
  for each row execute function public.enforce_reception_catalog_columns();

-- ── 4. RLS for catalog_items ──────────────────────────────────
alter table public.catalog_items enable row level security;

drop policy if exists catalog_items_read   on public.catalog_items;
drop policy if exists catalog_items_insert on public.catalog_items;
drop policy if exists catalog_items_update on public.catalog_items;
drop policy if exists catalog_items_delete on public.catalog_items;

-- All authenticated users can read.
create policy catalog_items_read on public.catalog_items
  for select to authenticated using (true);

-- INSERT: managers only.
create policy catalog_items_insert on public.catalog_items
  for insert to authenticated
  with check (public.current_role() = 'manager');

-- UPDATE: any authenticated user is allowed at the RLS layer. The
-- column-level gate is the trigger above. This split keeps the policy
-- simple and makes the rejection happen with a clear error message
-- instead of a silent zero-rows-affected.
create policy catalog_items_update on public.catalog_items
  for update to authenticated
  using (true)
  with check (true);

-- DELETE: managers only.
create policy catalog_items_delete on public.catalog_items
  for delete to authenticated
  using (public.current_role() = 'manager');

-- ── 5. item_sales table ───────────────────────────────────────
create table if not exists public.item_sales (
  id                     uuid           primary key default gen_random_uuid(),
  catalog_item_id        uuid           references public.catalog_items(id) on delete set null,
  item_name_snapshot     text           not null,
  category_snapshot      text           not null,
  item_type_snapshot     text           not null,
  quantity               integer        not null check (quantity > 0),
  unit_price             numeric(14,4)  not null check (unit_price >= 0),
  original_currency      text           not null check (original_currency in ('syp','usd')),
  original_total         numeric(14,4)  not null check (original_total >= 0),
  -- Nullable to allow legacy USD rows that never snapshotted a rate.
  -- The CHECK constraint below enforces NOT NULL for SYP.
  exchange_rate_to_syp   numeric(14,4)           check (exchange_rate_to_syp is null or exchange_rate_to_syp > 0),
  source                 text           not null check (source in ('kitchen','store')),
  payment_method         text,
  cash_session_id        uuid                    references public.cash_sessions(id),
  created_by             uuid           not null references public.profiles(id),
  created_by_name        text,
  created_at             timestamptz    not null default now(),
  cancelled_at           timestamptz,
  cancelled_by           uuid                    references public.profiles(id),
  cancelled_reason       text,

  -- Frozen SYP equivalent. Generated from the row's own snapshot rate so
  -- the value never drifts when the live rate changes. NULL for USD rows
  -- whose rate was never recorded — those rows are excluded from SYP
  -- aggregations on the read side.
  amount_syp numeric(14,2) generated always as (
    case
      when original_currency = 'syp' then original_total
      when exchange_rate_to_syp is not null then original_total * exchange_rate_to_syp
      else null
    end
  ) stored,

  -- Frozen USD equivalent. Generated from the row's own snapshot rate.
  -- For USD rows: equals original_total (rate not used). For SYP rows:
  -- requires rate (enforced by the CHECK below for active rows).
  amount_usd numeric(14,4) generated always as (
    case
      when original_currency = 'usd' then original_total
      when exchange_rate_to_syp is not null and exchange_rate_to_syp > 0 then original_total / exchange_rate_to_syp
      else null
    end
  ) stored,

  -- Active SYP rows must carry a positive rate. Cancelled rows are
  -- exempt so legacy soft-cancelled rows with bad rates can land during
  -- backfill without violating the constraint.
  constraint item_sales_active_syp_rate_required
    check (
      cancelled_at is not null
      or original_currency != 'syp'
      or (exchange_rate_to_syp is not null and exchange_rate_to_syp > 0)
    )
);

create index if not exists idx_item_sales_session
  on public.item_sales(cash_session_id) where cancelled_at is null;
create index if not exists idx_item_sales_user_time
  on public.item_sales(created_by, created_at desc);
create index if not exists idx_item_sales_catalog_item
  on public.item_sales(catalog_item_id);
create index if not exists idx_item_sales_created_at
  on public.item_sales(created_at desc);
create index if not exists idx_item_sales_source_time
  on public.item_sales(source, created_at desc) where cancelled_at is null;

-- ── 6. RLS for item_sales ─────────────────────────────────────
alter table public.item_sales enable row level security;

drop policy if exists item_sales_read   on public.item_sales;
drop policy if exists item_sales_insert on public.item_sales;
drop policy if exists item_sales_update on public.item_sales;

create policy item_sales_read on public.item_sales
  for select to authenticated using (true);

-- Insert: caller stamps themselves as creator (matches sales / inbody / subs).
create policy item_sales_insert on public.item_sales
  for insert to authenticated
  with check (created_by = auth.uid());

-- Update: any authenticated user (matches the cross-staff edits policy
-- from 0029). Cancellation is via the cancelled_at column, not DELETE.
create policy item_sales_update on public.item_sales
  for update to authenticated
  using (true)
  with check (true);

-- No DELETE policy by design — soft-cancel via cancelled_at.

-- ── 7. Realtime publication membership ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'catalog_items'
  ) then
    alter publication supabase_realtime add table public.catalog_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'item_sales'
  ) then
    alter publication supabase_realtime add table public.item_sales;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   alter publication supabase_realtime drop table public.item_sales;
--   alter publication supabase_realtime drop table public.catalog_items;
--   drop table if exists public.item_sales;
--   drop table if exists public.catalog_items;
--   drop function if exists public.enforce_reception_catalog_columns();
--   drop function if exists public.catalog_items_set_updated_at();
--   notify pgrst, 'reload schema';
-- ============================================================
