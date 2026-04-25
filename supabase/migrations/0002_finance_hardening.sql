-- ============================================================
-- OX GYM — finance hardening
--   • currency snapshot (immutable SYP-equivalent + exchange rate at txn time)
--   • soft-delete (cancellation) on every transaction type
--   • expenses table (was local-only)
--   • app_settings (persist global exchange rate, etc.)
--   • RLS + realtime for new surfaces
-- ============================================================

-- ── EXPENSES (was local-only) ───────────────────────────────
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric(12,2) not null,
  currency text not null default 'syp' check (currency in ('syp','usd')),
  category text not null default 'other',
  cash_session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

-- ── APP SETTINGS (key/value, single-row globals) ────────────
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

-- seed default exchange rate if missing
insert into public.app_settings (key, value)
values ('exchange_rate_usd_syp', to_jsonb(13200::numeric))
on conflict (key) do nothing;

-- ── CURRENCY SNAPSHOT COLUMNS ───────────────────────────────
-- amount_syp = immutable SYP-equivalent at txn time
--   for syp txns: equals amount (or paid_amount for subs)
--   for usd txns: amount * exchange_rate (frozen at insert)
-- exchange_rate = USD→SYP rate used at txn time

alter table public.subscriptions
  add column if not exists exchange_rate numeric(14,4),
  add column if not exists amount_syp    numeric(14,2);

alter table public.sales
  add column if not exists exchange_rate numeric(14,4),
  add column if not exists amount_syp    numeric(14,2);

alter table public.inbody_sessions
  add column if not exists exchange_rate numeric(14,4),
  add column if not exists amount_syp    numeric(14,2);

alter table public.expenses
  add column if not exists exchange_rate numeric(14,4),
  add column if not exists amount_syp    numeric(14,2);

-- ── CANCELLATION (soft-delete) COLUMNS ──────────────────────
alter table public.subscriptions
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references public.profiles(id),
  add column if not exists cancelled_reason text;

alter table public.sales
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references public.profiles(id),
  add column if not exists cancelled_reason text;

alter table public.inbody_sessions
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references public.profiles(id),
  add column if not exists cancelled_reason text;

alter table public.expenses
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references public.profiles(id),
  add column if not exists cancelled_reason text;

-- ── BACKFILL amount_syp for any existing rows ───────────────
-- (no-op on a fresh DB; safe if rows exist)
update public.subscriptions
   set amount_syp = case when currency = 'syp' then paid_amount
                         else paid_amount * coalesce(exchange_rate, 13200) end
 where amount_syp is null;

update public.sales
   set amount_syp = case when currency = 'syp' then total
                         else total * coalesce(exchange_rate, 13200) end
 where amount_syp is null;

update public.inbody_sessions
   set amount_syp = case when currency = 'syp' then amount
                         else amount * coalesce(exchange_rate, 13200) end
 where amount_syp is null;

-- ── INDEXES for cancellation filtering ──────────────────────
create index if not exists idx_subs_active_session
  on public.subscriptions(cash_session_id) where cancelled_at is null;
create index if not exists idx_sales_active_session
  on public.sales(cash_session_id) where cancelled_at is null;
create index if not exists idx_inbody_active_session
  on public.inbody_sessions(cash_session_id) where cancelled_at is null;
create index if not exists idx_expenses_active_session
  on public.expenses(cash_session_id) where cancelled_at is null;

create index if not exists idx_expenses_user_time
  on public.expenses(created_by, created_at desc);

-- ── RLS for new tables ──────────────────────────────────────
alter table public.expenses     enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "expenses read"   on public.expenses;
drop policy if exists "expenses insert" on public.expenses;
drop policy if exists "expenses update" on public.expenses;
create policy "expenses read"   on public.expenses for select to authenticated
  using (public.current_role() = 'manager' or created_by = auth.uid());
create policy "expenses insert" on public.expenses for insert to authenticated
  with check (created_by = auth.uid());
-- update only allowed for cancellation (creator or manager)
create policy "expenses update" on public.expenses for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');

-- allow creator OR manager to cancel a txn (update cancelled_* columns)
drop policy if exists "subs update"   on public.subscriptions;
drop policy if exists "sales update"  on public.sales;
drop policy if exists "inbody update" on public.inbody_sessions;
create policy "subs update"   on public.subscriptions   for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');
create policy "sales update"  on public.sales           for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');
create policy "inbody update" on public.inbody_sessions for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');

-- app_settings: anyone signed-in can read; only manager can write
drop policy if exists "settings read"  on public.app_settings;
drop policy if exists "settings write" on public.app_settings;
create policy "settings read"  on public.app_settings for select to authenticated using (true);
create policy "settings write" on public.app_settings for all    to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── REALTIME ────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='expenses') then
    alter publication supabase_realtime add table public.expenses;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='app_settings') then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end$$;
