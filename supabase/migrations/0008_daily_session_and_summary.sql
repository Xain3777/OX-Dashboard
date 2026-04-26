-- ============================================================
-- OX GYM — daily session model + summary table
--   • cash_sessions: add business_date (one session per day)
--   • daily_summary: per-day income snapshot written on close
--   • current_business_date() helper (UTC+3, day rolls at 06:00)
--   • subscription_offers: update couple offer to per-person pricing
-- ============================================================

-- ── 1. business_date helper ──────────────────────────────────
-- Returns the Latakia business date (UTC+3, day starts at 06:00 local).
-- Before 06:00 local time (= 03:00 UTC) we are still on the previous day.
create or replace function public.current_business_date()
returns date
language sql stable security definer set search_path = public as $$
  select case
    when extract(hour from (now() at time zone 'Asia/Damascus')) < 6
    then (now() at time zone 'Asia/Damascus')::date - 1
    else (now() at time zone 'Asia/Damascus')::date
  end;
$$;

-- ── 2. cash_sessions: add business_date ─────────────────────
alter table public.cash_sessions
  add column if not exists business_date date;

-- Backfill existing rows using their opened_at timestamp
update public.cash_sessions
set business_date = case
  when extract(hour from (opened_at at time zone 'Asia/Damascus')) < 6
  then (opened_at at time zone 'Asia/Damascus')::date - 1
  else (opened_at at time zone 'Asia/Damascus')::date
end
where business_date is null;

-- Unique constraint: one session per business day
create unique index if not exists idx_cs_business_date
  on public.cash_sessions(business_date);

create index if not exists idx_cs_status on public.cash_sessions(status);

-- ── 3. daily_summary ────────────────────────────────────────
create table if not exists public.daily_summary (
  id            uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  session_id    uuid references public.cash_sessions(id),
  closed_by     uuid references public.profiles(id),
  closed_at     timestamptz not null default now(),
  subs_total    numeric(12,2) not null default 0,
  inbody_total  numeric(12,2) not null default 0,
  store_total   numeric(12,2) not null default 0,
  meals_total   numeric(12,2) not null default 0,
  total_income  numeric(12,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_ds_date on public.daily_summary(business_date desc);

alter table public.daily_summary enable row level security;

drop policy if exists "ds read"   on public.daily_summary;
drop policy if exists "ds insert" on public.daily_summary;
create policy "ds read"   on public.daily_summary for select to authenticated using (true);
create policy "ds insert" on public.daily_summary for insert to authenticated
  with check (public.current_role() = 'manager');
create policy "ds update" on public.daily_summary for update to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── 4. update couple offer to per-person $29.75 ─────────────
-- Couple = two separate subscriptions, each at $29.75 (15% off $35)
update public.subscription_offers
set
  label = 'باقة الزوجين — 29.75$ للشخص (خصم 15%)',
  kind  = 'percent_off',
  value = 15,
  notes = 'تُنشأ اشتراكان منفصلان، كل واحد بـ 29.75$ (35 × 0.85)'
where code = 'couple';

-- ── 5. realtime ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'daily_summary'
  ) then
    alter publication supabase_realtime add table public.daily_summary;
  end if;
end$$;
