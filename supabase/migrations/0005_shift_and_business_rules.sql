-- ============================================================
-- OX GYM — shift handoff, discrepancy logs, business rules
--   • cash_sessions: previous_session_id + auto-locked opening
--   • discrepancy_logs: every non-zero close stored with reason
--   • subscription_plans + subscription_offers (fixed catalog)
--   • inbody_pricing tiers (member/non-member)
--   • inventory_baseline + inventory_counts (start vs end of day)
--   • daily_exports (record of EOD Excel + reset)
-- ============================================================

-- ── 1. shift handoff on cash_sessions ───────────────────────
alter table public.cash_sessions
  add column if not exists previous_session_id uuid references public.cash_sessions(id),
  add column if not exists opening_locked      boolean not null default false;

create index if not exists idx_cs_prev on public.cash_sessions(previous_session_id);

-- Helper: most recent closed session (any worker, today). Used by the UI
-- to pre-fill the next worker's opening balance.
create or replace function public.last_closed_session_for_today()
returns table(id uuid, closing_cash_syp numeric)
language sql stable security definer set search_path = public as $$
  select id, closing_cash_syp
  from public.cash_sessions
  where status = 'closed'
    and closed_at::date = current_date
  order by closed_at desc
  limit 1;
$$;

-- ── 2. discrepancy_logs ─────────────────────────────────────
create table if not exists public.discrepancy_logs (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  worker_id   uuid not null references public.profiles(id),
  worker_name text not null,
  expected_syp numeric(14,2) not null,
  actual_syp   numeric(14,2) not null,
  difference_syp numeric(14,2) not null,
  reason text not null,
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_disc_session on public.discrepancy_logs(cash_session_id);
create index if not exists idx_disc_unresolved on public.discrepancy_logs(resolved) where resolved = false;

alter table public.discrepancy_logs enable row level security;

drop policy if exists "disc read"   on public.discrepancy_logs;
drop policy if exists "disc insert" on public.discrepancy_logs;
drop policy if exists "disc update" on public.discrepancy_logs;
create policy "disc read"   on public.discrepancy_logs for select to authenticated
  using (public.current_role() = 'manager' or worker_id = auth.uid());
create policy "disc insert" on public.discrepancy_logs for insert to authenticated
  with check (worker_id = auth.uid());
create policy "disc update" on public.discrepancy_logs for update to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── 3. subscription_plans (fixed catalog, USD) ──────────────
create table if not exists public.subscription_plans (
  code text primary key,             -- '1m','3m','6m','9m','12m'
  months integer not null,
  price_usd numeric(10,2) not null,
  active boolean not null default true
);

insert into public.subscription_plans(code, months, price_usd) values
  ('1m',  1,  35),
  ('3m',  3,  90),
  ('6m',  6, 170),
  ('9m',  9, 235),
  ('12m',12, 300)
on conflict (code) do update
  set months = excluded.months,
      price_usd = excluded.price_usd,
      active = true;

-- Standard monthly base for "remainder" months in custom-duration plans.
insert into public.app_settings(key, value)
values ('plan_base_monthly_usd', to_jsonb(35::numeric))
on conflict (key) do nothing;

alter table public.subscription_plans enable row level security;
drop policy if exists "plans read"  on public.subscription_plans;
drop policy if exists "plans write" on public.subscription_plans;
create policy "plans read"  on public.subscription_plans for select to authenticated using (true);
create policy "plans write" on public.subscription_plans for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── 4. subscription_offers ──────────────────────────────────
-- Offers apply only to base monthly pricing, not to fixed multi-month plans.
create table if not exists public.subscription_offers (
  code text primary key,             -- 'referral_4','referral_9','couple','corporate'
  label text not null,
  kind text not null check (kind in ('free_months','fixed_price','percent_off')),
  value numeric(10,2) not null,      -- months / fixed USD / percent (0..100)
  applies_to_base_only boolean not null default true,
  active boolean not null default true,
  notes text
);

insert into public.subscription_offers(code, label, kind, value, applies_to_base_only, notes) values
  ('referral_4','إحالة 4 أصدقاء — شهر مجاني',         'free_months', 1, true,  'يضاف شهر مجاني بعد إكمال 4 إحالات'),
  ('referral_9','إحالة 9 أصدقاء — شهران مجانيان',      'free_months', 2, true,  'يضاف شهران مجانيان بعد إكمال 9 إحالات'),
  ('couple',    'باقة الزوجين — 60$ لشخصين (شهر واحد)','fixed_price', 60, true, 'تطبق على باقة الشهر فقط'),
  ('corporate', 'شركات/بنوك — خصم 15% للشهر',          'percent_off', 15, true, 'يطبق على السعر الشهري الأساسي فقط')
on conflict (code) do update
  set label = excluded.label,
      kind = excluded.kind,
      value = excluded.value,
      applies_to_base_only = excluded.applies_to_base_only,
      notes = excluded.notes,
      active = true;

alter table public.subscription_offers enable row level security;
drop policy if exists "offers read"  on public.subscription_offers;
drop policy if exists "offers write" on public.subscription_offers;
create policy "offers read"  on public.subscription_offers for select to authenticated using (true);
create policy "offers write" on public.subscription_offers for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── 5. inbody_pricing tiers (USD) ───────────────────────────
create table if not exists public.inbody_pricing (
  code text primary key,             -- 'member_1','member_5','member_10','non_member_1'
  label text not null,
  member_type text not null check (member_type in ('gym_member','non_member')),
  sessions integer not null,
  price_usd numeric(10,2) not null,
  active boolean not null default true
);

insert into public.inbody_pricing(code, label, member_type, sessions, price_usd) values
  ('member_1',     'عضو — جلسة واحدة',  'gym_member',  1,  5),
  ('member_5',     'عضو — 5 جلسات',     'gym_member',  5, 20),
  ('member_10',    'عضو — 10 جلسات',    'gym_member', 10, 40),
  ('non_member_1', 'زيارة خارجية — جلسة','non_member', 1,  8)
on conflict (code) do update
  set label = excluded.label,
      member_type = excluded.member_type,
      sessions = excluded.sessions,
      price_usd = excluded.price_usd,
      active = true;

alter table public.inbody_pricing enable row level security;
drop policy if exists "ibp read"  on public.inbody_pricing;
drop policy if exists "ibp write" on public.inbody_pricing;
create policy "ibp read"  on public.inbody_pricing for select to authenticated using (true);
create policy "ibp write" on public.inbody_pricing for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── 6. inventory baseline + daily counts ────────────────────
create table if not exists public.inventory_baseline (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  product_id uuid not null references public.products(id) on delete cascade,
  expected_qty integer not null,
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles(id),
  unique(business_date, product_id)
);

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  product_id uuid not null references public.products(id) on delete cascade,
  counted_qty integer not null,
  expected_qty integer not null,
  difference integer not null,
  reason text,
  counted_at timestamptz not null default now(),
  counted_by uuid references public.profiles(id),
  unique(business_date, product_id)
);

create index if not exists idx_inv_base_date  on public.inventory_baseline(business_date);
create index if not exists idx_inv_count_date on public.inventory_counts(business_date);

alter table public.inventory_baseline enable row level security;
alter table public.inventory_counts   enable row level security;

drop policy if exists "inv base read"  on public.inventory_baseline;
drop policy if exists "inv base write" on public.inventory_baseline;
create policy "inv base read"  on public.inventory_baseline for select to authenticated using (true);
create policy "inv base write" on public.inventory_baseline for all to authenticated
  using (true) with check (true);

drop policy if exists "inv count read"  on public.inventory_counts;
drop policy if exists "inv count write" on public.inventory_counts;
create policy "inv count read"  on public.inventory_counts for select to authenticated using (true);
create policy "inv count write" on public.inventory_counts for all to authenticated
  using (true) with check (true);

-- ── 7. daily_exports (record of EOD export + cash reset) ────
create table if not exists public.daily_exports (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  exported_at timestamptz not null default now(),
  exported_by uuid references public.profiles(id),
  filename text,
  total_revenue_syp numeric(14,2),
  total_expenses_syp numeric(14,2),
  total_discrepancy_syp numeric(14,2) not null default 0,
  shift_count integer not null default 0
);

alter table public.daily_exports enable row level security;
drop policy if exists "dx read"  on public.daily_exports;
drop policy if exists "dx write" on public.daily_exports;
create policy "dx read"  on public.daily_exports for select to authenticated using (true);
create policy "dx write" on public.daily_exports for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- ── 8. realtime ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='discrepancy_logs') then
    alter publication supabase_realtime add table public.discrepancy_logs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='subscription_plans') then
    alter publication supabase_realtime add table public.subscription_plans;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='subscription_offers') then
    alter publication supabase_realtime add table public.subscription_offers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inbody_pricing') then
    alter publication supabase_realtime add table public.inbody_pricing;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inventory_baseline') then
    alter publication supabase_realtime add table public.inventory_baseline;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inventory_counts') then
    alter publication supabase_realtime add table public.inventory_counts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='daily_exports') then
    alter publication supabase_realtime add table public.daily_exports;
  end if;
end$$;
