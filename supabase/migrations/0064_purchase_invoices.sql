-- ============================================================
-- 0064 — inventory purchase invoices (فواتير المشتريات)
--
-- The second expense type: a purchase that increases warehouse stock,
-- recorded under an invoice header (date + invoice number) with one or
-- more material lines (name / quantity / unit / purchase price / notes).
--
-- Money flow: the intake layer also writes ONE mirrored row into
-- public.expenses (category 'inventory_purchase', purchase_invoice_id =
-- this invoice) so the purchase total automatically counts toward
-- expense breakdowns AND the cash-session close — no read-side changes.
-- That mirrored expense is linked back via expenses.purchase_invoice_id
-- (added in 0065).
--
-- Stock flow: an AFTER INSERT trigger on purchase_invoice_lines bumps
-- raw_materials.current_quantity. It is SECURITY DEFINER so a reception
-- user (who cannot UPDATE raw_materials directly under 0063's RLS) can
-- still stock a manager-owned material by recording a purchase. An
-- AFTER UPDATE trigger on purchase_invoices reverses the stock when the
-- invoice is cancelled.
--
-- Idempotent: CREATE ... IF NOT EXISTS / DROP-then-CREATE throughout.
-- Depends on 0063 (raw_materials) and the existing expenses table.
-- ============================================================

-- ── 1. purchase_invoices header ───────────────────────────────
create table if not exists public.purchase_invoices (
  id                     uuid           primary key default gen_random_uuid(),
  invoice_number         text,
  invoice_date           date           not null default current_date,
  supplier               text,
  notes                  text,
  total                  numeric(14,4)  not null default 0 check (total >= 0),
  currency               text           not null default 'syp' check (currency in ('syp','usd')),
  exchange_rate          numeric(14,4)           check (exchange_rate is null or exchange_rate > 0),
  amount_syp             numeric(14,2),
  cash_session_id        uuid           references public.cash_sessions(id),
  source                 text           not null default 'manager' check (source in ('manager','reception_daily')),
  created_by             uuid           not null references public.profiles(id),
  created_by_name        text,
  created_at             timestamptz    not null default now(),
  cancelled_at           timestamptz,
  cancelled_by           uuid           references public.profiles(id),
  cancelled_reason       text
);

create index if not exists idx_purchase_invoices_active
  on public.purchase_invoices(created_at desc) where cancelled_at is null;
create index if not exists idx_purchase_invoices_session
  on public.purchase_invoices(cash_session_id) where cancelled_at is null;

-- ── 2. purchase_invoice_lines ─────────────────────────────────
create table if not exists public.purchase_invoice_lines (
  id                     uuid           primary key default gen_random_uuid(),
  invoice_id             uuid           not null references public.purchase_invoices(id) on delete cascade,
  raw_material_id        uuid           references public.raw_materials(id),
  material_name_snapshot text           not null,
  quantity               numeric(14,3)  not null check (quantity > 0),
  unit                   text           not null,
  unit_purchase_price    numeric(14,4)  not null default 0 check (unit_purchase_price >= 0),
  line_total             numeric(14,4)  generated always as (quantity * unit_purchase_price) stored,
  notes                  text,
  created_at             timestamptz    not null default now()
);

create index if not exists idx_purchase_invoice_lines_invoice
  on public.purchase_invoice_lines(invoice_id);
create index if not exists idx_purchase_invoice_lines_material
  on public.purchase_invoice_lines(raw_material_id);

-- ── 3. stock-increment trigger (SECURITY DEFINER) ─────────────
-- Bumps the referenced material's quantity + last purchase price when a
-- purchase line is inserted. SECURITY DEFINER bypasses raw_materials'
-- manager-only UPDATE policy so reception purchases can stock a
-- manager-owned material.
create or replace function public.purchase_line_apply_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_material_id is not null then
    -- Pull the invoice's currency so last_purchase_price is shown in the
    -- right currency in the warehouse (otherwise a SYP purchase reads as $).
    update public.raw_materials rm
       set current_quantity    = rm.current_quantity + new.quantity,
           last_purchase_price = new.unit_purchase_price,
           cost_currency       = pi.currency,
           updated_at          = now()
      from public.purchase_invoices pi
     where rm.id = new.raw_material_id
       and pi.id = new.invoice_id;
  end if;
  return new;
end $$;

drop trigger if exists purchase_line_stock_increment on public.purchase_invoice_lines;
create trigger purchase_line_stock_increment
  after insert on public.purchase_invoice_lines
  for each row execute function public.purchase_line_apply_stock();

-- ── 4. stock-reversal trigger on invoice cancel ───────────────
-- When an invoice transitions to cancelled, subtract every line's
-- quantity back out of the warehouse (floored at 0).
create or replace function public.purchase_invoice_reverse_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.raw_materials rm
       set current_quantity = greatest(0, rm.current_quantity - l.qty),
           updated_at       = now()
      from (
        select raw_material_id, sum(quantity) as qty
          from public.purchase_invoice_lines
         where invoice_id = new.id and raw_material_id is not null
         group by raw_material_id
      ) l
     where rm.id = l.raw_material_id;
  end if;
  return new;
end $$;

drop trigger if exists purchase_invoice_cancel_reverse on public.purchase_invoices;
create trigger purchase_invoice_cancel_reverse
  after update of cancelled_at on public.purchase_invoices
  for each row execute function public.purchase_invoice_reverse_stock();

-- ── 5. RLS ────────────────────────────────────────────────────
alter table public.purchase_invoices      enable row level security;
alter table public.purchase_invoice_lines enable row level security;

drop policy if exists purchase_invoices_read   on public.purchase_invoices;
drop policy if exists purchase_invoices_insert on public.purchase_invoices;
drop policy if exists purchase_invoices_update on public.purchase_invoices;
drop policy if exists purchase_invoices_delete on public.purchase_invoices;

create policy purchase_invoices_read on public.purchase_invoices
  for select to authenticated using (true);
create policy purchase_invoices_insert on public.purchase_invoices
  for insert to authenticated with check (created_by = auth.uid());
-- Update (cancellation) / delete: creator or manager.
create policy purchase_invoices_update on public.purchase_invoices
  for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');
create policy purchase_invoices_delete on public.purchase_invoices
  for delete to authenticated
  using (public.current_role() = 'manager');

drop policy if exists purchase_invoice_lines_read   on public.purchase_invoice_lines;
drop policy if exists purchase_invoice_lines_insert on public.purchase_invoice_lines;
drop policy if exists purchase_invoice_lines_update on public.purchase_invoice_lines;

create policy purchase_invoice_lines_read on public.purchase_invoice_lines
  for select to authenticated using (true);
-- Insert allowed when the parent invoice belongs to the caller (or they
-- are a manager). The ON DELETE CASCADE handles line cleanup.
create policy purchase_invoice_lines_insert on public.purchase_invoice_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from public.purchase_invoices pi
      where pi.id = invoice_id
        and (pi.created_by = auth.uid() or public.current_role() = 'manager')
    )
  );
create policy purchase_invoice_lines_update on public.purchase_invoice_lines
  for update to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

-- ── 6. Realtime publication membership ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'purchase_invoices'
  ) then
    alter publication supabase_realtime add table public.purchase_invoices;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'purchase_invoice_lines'
  ) then
    alter publication supabase_realtime add table public.purchase_invoice_lines;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   alter publication supabase_realtime drop table public.purchase_invoice_lines;
--   alter publication supabase_realtime drop table public.purchase_invoices;
--   drop table if exists public.purchase_invoice_lines cascade;
--   drop table if exists public.purchase_invoices cascade;
--   drop function if exists public.purchase_line_apply_stock();
--   drop function if exists public.purchase_invoice_reverse_stock();
--   notify pgrst, 'reload schema';
-- ============================================================
