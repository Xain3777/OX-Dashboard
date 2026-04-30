-- ============================================================================
-- OX Dashboard — one-shot setup on the shared Supabase project
--
-- This file consolidates migrations 0001..0016 into a single paste so the
-- whole dashboard schema can be applied in one click in the Supabase SQL
-- Editor. Idempotent: safe to re-run.
--
-- Sister-app's tables (members, subscriptions, workout_plans, ...) are
-- left ENTIRELY untouched. The dashboard's subscription table is named
-- `gym_subscriptions` to avoid the name collision.
--
-- Apply once via Supabase Dashboard → SQL Editor → New query → Run.
-- After it succeeds, run the profile backfill at the very bottom.
-- ============================================================================



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0001  initial schema (profiles + products + cash_sessions + finance      ║
-- ║       tables). MEMBERS is intentionally skipped — sister-app owns it.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('manager', 'reception')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('supplements','wearables','protein_cups','bca_drinks','meals','kitchen','other')),
  cost numeric(12,2) not null default 0,
  price numeric(12,2) not null default 0,
  stock integer not null default 0,
  low_stock_threshold integer not null default 5,
  created_at timestamptz not null default now()
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_cash_syp numeric(14,2) not null default 0,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  closing_cash_syp numeric(14,2),
  expected_cash_syp numeric(14,2),
  discrepancy_syp numeric(14,2),
  notes text,
  status text not null default 'open' check (status in ('open','closed'))
);

create table if not exists public.gym_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  member_name text not null,
  plan_type text not null,
  offer text not null default 'none',
  start_date date not null default current_date,
  end_date date not null,
  amount numeric(12,2) not null,
  paid_amount numeric(12,2) not null default 0,
  payment_status text not null default 'paid' check (payment_status in ('paid','partial','unpaid')),
  currency text not null default 'syp' check (currency in ('syp','usd')),
  status text not null default 'active' check (status in ('active','expired','frozen','cancelled')),
  cash_session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  product_name text not null,
  quantity integer not null,
  unit_price numeric(12,2) not null,
  total numeric(12,2) not null,
  currency text not null default 'syp' check (currency in ('syp','usd')),
  source text not null default 'store' check (source in ('store','kitchen')),
  is_reversal boolean not null default false,
  reversal_of uuid references public.sales(id),
  reversal_reason text,
  cash_session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

create table if not exists public.inbody_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id),
  member_name text not null,
  session_type text not null default 'single' check (session_type in ('single','package_5','package_10')),
  amount numeric(12,2) not null,
  currency text not null default 'syp' check (currency in ('syp','usd')),
  notes text,
  cash_session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);

create table if not exists public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  description text not null,
  amount_syp numeric(14,2),
  amount_usd numeric(12,2),
  entity_type text,
  entity_id uuid,
  cash_session_id uuid references public.cash_sessions(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_by_name text not null
);

create index if not exists idx_subs_user_time     on public.gym_subscriptions(created_by, created_at desc);
create index if not exists idx_sales_user_time    on public.sales(created_by, created_at desc);
create index if not exists idx_inbody_user_time   on public.inbody_sessions(created_by, created_at desc);
create index if not exists idx_activity_time      on public.activity_feed(created_at desc);
create index if not exists idx_cash_user_time     on public.cash_sessions(opened_by, opened_at desc);
create index if not exists idx_subs_session       on public.gym_subscriptions(cash_session_id);
create index if not exists idx_sales_session      on public.sales(cash_session_id);
create index if not exists idx_inbody_session     on public.inbody_sessions(cash_session_id);

alter table public.profiles          enable row level security;
alter table public.products          enable row level security;
alter table public.cash_sessions     enable row level security;
alter table public.gym_subscriptions enable row level security;
alter table public.sales             enable row level security;
alter table public.inbody_sessions   enable row level security;
alter table public.activity_feed     enable row level security;

create or replace function public.current_role() returns text
  language sql stable security definer set search_path = public, auth as $$
  select role from public.profiles where id = auth.uid();
$$;

drop policy if exists "profiles read"  on public.profiles;
drop policy if exists "profiles write" on public.profiles;
create policy "profiles read"  on public.profiles for select to authenticated using (true);
create policy "profiles write" on public.profiles for all    to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

drop policy if exists "products read"  on public.products;
drop policy if exists "products write" on public.products;
create policy "products read"  on public.products for select to authenticated using (true);
create policy "products write" on public.products for all    to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

drop policy if exists "cs read"   on public.cash_sessions;
drop policy if exists "cs insert" on public.cash_sessions;
drop policy if exists "cs update" on public.cash_sessions;
create policy "cs read"   on public.cash_sessions for select to authenticated
  using (public.current_role() = 'manager' or opened_by = auth.uid());
create policy "cs insert" on public.cash_sessions for insert to authenticated
  with check (opened_by = auth.uid());
create policy "cs update" on public.cash_sessions for update to authenticated
  using (opened_by = auth.uid() or public.current_role() = 'manager');

drop policy if exists "subs read"   on public.gym_subscriptions;
drop policy if exists "subs insert" on public.gym_subscriptions;
create policy "subs read"   on public.gym_subscriptions for select to authenticated
  using (public.current_role() = 'manager' or created_by = auth.uid());
create policy "subs insert" on public.gym_subscriptions for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "sales read"   on public.sales;
drop policy if exists "sales insert" on public.sales;
create policy "sales read"   on public.sales for select to authenticated
  using (public.current_role() = 'manager' or created_by = auth.uid());
create policy "sales insert" on public.sales for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "inbody read"   on public.inbody_sessions;
drop policy if exists "inbody insert" on public.inbody_sessions;
create policy "inbody read"   on public.inbody_sessions for select to authenticated
  using (public.current_role() = 'manager' or created_by = auth.uid());
create policy "inbody insert" on public.inbody_sessions for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "activity read"   on public.activity_feed;
drop policy if exists "activity insert" on public.activity_feed;
create policy "activity read"   on public.activity_feed for select to authenticated
  using (public.current_role() = 'manager' or created_by = auth.uid());
create policy "activity insert" on public.activity_feed for insert to authenticated
  with check (created_by = auth.uid() or created_by is null);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='gym_subscriptions') then
    alter publication supabase_realtime add table public.gym_subscriptions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inbody_sessions') then
    alter publication supabase_realtime add table public.inbody_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='cash_sessions') then
    alter publication supabase_realtime add table public.cash_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='activity_feed') then
    alter publication supabase_realtime add table public.activity_feed;
  end if;
end$$;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0002  finance hardening (expenses, app_settings, currency snapshot       ║
-- ║       columns, soft-delete columns, additional RLS).                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

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

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.app_settings (key, value)
values ('exchange_rate_usd_syp', to_jsonb(13200::numeric))
on conflict (key) do nothing;

alter table public.gym_subscriptions
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

alter table public.gym_subscriptions
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

update public.gym_subscriptions
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

create index if not exists idx_subs_active_session
  on public.gym_subscriptions(cash_session_id) where cancelled_at is null;
create index if not exists idx_sales_active_session
  on public.sales(cash_session_id) where cancelled_at is null;
create index if not exists idx_inbody_active_session
  on public.inbody_sessions(cash_session_id) where cancelled_at is null;
create index if not exists idx_expenses_active_session
  on public.expenses(cash_session_id) where cancelled_at is null;
create index if not exists idx_expenses_user_time
  on public.expenses(created_by, created_at desc);

alter table public.expenses     enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "expenses read"   on public.expenses;
drop policy if exists "expenses insert" on public.expenses;
drop policy if exists "expenses update" on public.expenses;
create policy "expenses read"   on public.expenses for select to authenticated
  using (public.current_role() = 'manager' or created_by = auth.uid());
create policy "expenses insert" on public.expenses for insert to authenticated
  with check (created_by = auth.uid());
create policy "expenses update" on public.expenses for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');

drop policy if exists "subs update"   on public.gym_subscriptions;
drop policy if exists "sales update"  on public.sales;
drop policy if exists "inbody update" on public.inbody_sessions;
create policy "subs update"   on public.gym_subscriptions for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');
create policy "sales update"  on public.sales for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');
create policy "inbody update" on public.inbody_sessions for update to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');

drop policy if exists "settings read"  on public.app_settings;
drop policy if exists "settings write" on public.app_settings;
create policy "settings read"  on public.app_settings for select to authenticated using (true);
create policy "settings write" on public.app_settings for all    to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='expenses') then
    alter publication supabase_realtime add table public.expenses;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='app_settings') then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end$$;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0003  food_items catalog (kitchen menu).                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_syp numeric(12,2) not null check (price_syp >= 0),
  category text default 'food',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists food_items_active_idx on public.food_items (is_active, name);

alter table public.food_items enable row level security;

drop policy if exists food_items_read on public.food_items;
create policy food_items_read on public.food_items
  for select to authenticated using (true);

drop policy if exists food_items_insert on public.food_items;
create policy food_items_insert on public.food_items
  for insert to authenticated
  with check (public.current_role() = 'manager');

drop policy if exists food_items_update on public.food_items;
create policy food_items_update on public.food_items
  for update to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

drop policy if exists food_items_delete on public.food_items;
create policy food_items_delete on public.food_items
  for delete to authenticated using (public.current_role() = 'manager');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='food_items') then
    alter publication supabase_realtime add table public.food_items;
  end if;
end$$;

insert into public.food_items (name, price_syp)
values
  ('قهوة', 5000),
  ('شاي', 3000),
  ('ماء صغير', 2000),
  ('ماء كبير', 4000),
  ('مشروب طاقة', 15000),
  ('سندويش', 12000)
on conflict do nothing;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0004  inbody_sessions: widen session_type to support member visit model. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.inbody_sessions
  drop constraint if exists inbody_sessions_session_type_check;
alter table public.inbody_sessions
  add constraint inbody_sessions_session_type_check
  check (session_type in ('single','package_5','package_10','gym_member','non_member'));



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0005  shift handoff, discrepancy logs, business-rule catalogs.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.cash_sessions
  add column if not exists previous_session_id uuid references public.cash_sessions(id),
  add column if not exists opening_locked      boolean not null default false;

create index if not exists idx_cs_prev on public.cash_sessions(previous_session_id);

-- last_closed_session_for_today() is defined in the 0010 section below
-- (canonical USD-returning version). 0005's SYP variant is intentionally
-- omitted to avoid the 42P13 return-type-change error on re-runs.

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
create index if not exists idx_disc_session    on public.discrepancy_logs(cash_session_id);
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

create table if not exists public.subscription_plans (
  code text primary key,
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
  set months = excluded.months, price_usd = excluded.price_usd, active = true;
insert into public.app_settings(key, value)
values ('plan_base_monthly_usd', to_jsonb(35::numeric))
on conflict (key) do nothing;
alter table public.subscription_plans enable row level security;
drop policy if exists "plans read"  on public.subscription_plans;
drop policy if exists "plans write" on public.subscription_plans;
create policy "plans read"  on public.subscription_plans for select to authenticated using (true);
create policy "plans write" on public.subscription_plans for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

create table if not exists public.subscription_offers (
  code text primary key,
  label text not null,
  kind text not null check (kind in ('free_months','fixed_price','percent_off')),
  value numeric(10,2) not null,
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
  set label = excluded.label, kind = excluded.kind, value = excluded.value,
      applies_to_base_only = excluded.applies_to_base_only,
      notes = excluded.notes, active = true;
alter table public.subscription_offers enable row level security;
drop policy if exists "offers read"  on public.subscription_offers;
drop policy if exists "offers write" on public.subscription_offers;
create policy "offers read"  on public.subscription_offers for select to authenticated using (true);
create policy "offers write" on public.subscription_offers for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

create table if not exists public.inbody_pricing (
  code text primary key,
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
  set label = excluded.label, member_type = excluded.member_type,
      sessions = excluded.sessions, price_usd = excluded.price_usd, active = true;
alter table public.inbody_pricing enable row level security;
drop policy if exists "ibp read"  on public.inbody_pricing;
drop policy if exists "ibp write" on public.inbody_pricing;
create policy "ibp read"  on public.inbody_pricing for select to authenticated using (true);
create policy "ibp write" on public.inbody_pricing for all to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

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

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='discrepancy_logs')   then alter publication supabase_realtime add table public.discrepancy_logs;   end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='subscription_plans') then alter publication supabase_realtime add table public.subscription_plans; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='subscription_offers')then alter publication supabase_realtime add table public.subscription_offers;end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inbody_pricing')     then alter publication supabase_realtime add table public.inbody_pricing;     end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inventory_baseline') then alter publication supabase_realtime add table public.inventory_baseline; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='inventory_counts')   then alter publication supabase_realtime add table public.inventory_counts;   end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='daily_exports')      then alter publication supabase_realtime add table public.daily_exports;      end if;
end$$;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0010  USD shift overhaul — cash_sessions USD columns, food_items USD.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS opening_cash  numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cash   numeric(14,4),
  ADD COLUMN IF NOT EXISTS employee_name text;

ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS price_usd numeric(10,4) NOT NULL DEFAULT 0;

-- Drop the function before recreating in case a previous run installed a
-- variant with a different return type (the 42P13 error your last paste hit).
DROP FUNCTION IF EXISTS public.last_closed_session_for_today();
CREATE FUNCTION public.last_closed_session_for_today()
RETURNS TABLE(id uuid, actual_cash numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, actual_cash
  FROM public.cash_sessions
  WHERE status = 'closed'
    AND closed_at >= CURRENT_DATE::timestamptz
    AND closed_at <  CURRENT_DATE::timestamptz + INTERVAL '1 day'
  ORDER BY closed_at DESC
  LIMIT 1;
$$;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0011  schema fixes: products category, food_items USD backfill,          ║
-- ║       payment_method + created_by_name columns.                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_category_check
  CHECK (category IN (
    'protein','mass_gainer','creatine','amino',
    'pre_workout','fat_burner','health','focus','other'
  ));

UPDATE public.food_items
   SET price_usd = ROUND((price_syp / 13200.0)::numeric, 4)
 WHERE price_usd = 0 AND price_syp > 0;

ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));
ALTER TABLE public.inbody_sessions
  ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS created_by_name text;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0012  group offers + private sessions. (Policies are in the idempotent   ║
-- ║       0015 catchup below — kept here just for the table CREATEs.)        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.gym_subscriptions
  add column if not exists group_id uuid;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0013  enforce at most one open cash session at a time.                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE UNIQUE INDEX IF NOT EXISTS one_open_session
  ON cash_sessions ((status))
  WHERE status = 'open';



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0014  expected vs actual cash columns on cash_sessions.                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS expected_cash numeric(14,4),
  ADD COLUMN IF NOT EXISTS difference    numeric(14,4);



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0015  safe catchup — idempotent re-application of 0011/0012.            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));
ALTER TABLE public.inbody_sessions
  ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS group_id uuid;

CREATE TABLE IF NOT EXISTS public.private_sessions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  number_of_players int           NOT NULL CHECK (number_of_players > 0),
  player_names      text[]        NOT NULL DEFAULT '{}',
  base_trainer_fee  numeric(10,2) NOT NULL DEFAULT 18,
  group_price       numeric(10,2) NOT NULL,
  total_price       numeric(10,2) NOT NULL,
  currency          text          NOT NULL DEFAULT 'usd' CHECK (currency IN ('syp','usd')),
  exchange_rate     numeric(10,2) NOT NULL DEFAULT 1,
  amount_syp        numeric(12,2),
  group_id          uuid,
  notes             text,
  cash_session_id   uuid          REFERENCES public.cash_sessions(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid          REFERENCES public.profiles(id),
  cancelled_reason  text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  created_by        uuid          NOT NULL REFERENCES public.profiles(id),
  created_by_name   text
);
ALTER TABLE public.private_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_sessions' AND policyname='private_sessions_insert') THEN
    CREATE POLICY "private_sessions_insert" ON public.private_sessions FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_sessions' AND policyname='private_sessions_select') THEN
    CREATE POLICY "private_sessions_select" ON public.private_sessions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_sessions' AND policyname='private_sessions_update') THEN
    CREATE POLICY "private_sessions_update" ON public.private_sessions FOR UPDATE TO authenticated
      USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'manager'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.group_offers (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid         NOT NULL,
  offer_type        text         NOT NULL CHECK (offer_type IN ('referral','couple','corporate')),
  members           jsonb        NOT NULL DEFAULT '[]',
  referral_count    int,
  reward_type       text,
  reward_value      numeric,
  discount_percent  numeric,
  organization_type text,
  price_applied     numeric,
  cash_session_id   uuid         REFERENCES public.cash_sessions(id),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  created_by        uuid         NOT NULL REFERENCES public.profiles(id)
);
ALTER TABLE public.group_offers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='group_offers' AND policyname='group_offers_all') THEN
    CREATE POLICY "group_offers_all" ON public.group_offers FOR ALL TO authenticated
      USING (true) WITH CHECK (created_by = auth.uid());
  END IF;
END $$;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0016  shared-DB canonicalization: current_user_role + view + cleanup.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role::text FROM public.members  WHERE auth_id = auth.uid() LIMIT 1),
    (SELECT role        FROM public.profiles WHERE id      = auth.uid() LIMIT 1)
  );
$$;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT public.current_user_role(); $$;
GRANT EXECUTE ON FUNCTION public.current_role() TO anon, authenticated;

DROP VIEW IF EXISTS public.member_subscriptions;
CREATE VIEW public.member_subscriptions AS
SELECT
  s.id,
  s.member_id,
  CASE
    WHEN s.plan_type = '1_month'  THEN 'monthly'::sub_plan_type
    WHEN s.plan_type = '3_months' THEN 'quarterly'::sub_plan_type
    ELSE                                'annual'::sub_plan_type
  END                              AS plan_type,
  s.start_date,
  s.end_date,
  CASE
    WHEN s.status = 'active'    THEN 'active'::sub_status
    WHEN s.status = 'cancelled' THEN 'cancelled'::sub_status
    ELSE                              'expired'::sub_status
  END                              AS status,
  s.amount                         AS price,
  NULL::text                       AS notes
FROM public.gym_subscriptions s
WHERE s.cancelled_at IS NULL
  AND s.member_id IS NOT NULL;

GRANT SELECT ON public.member_subscriptions TO authenticated;

ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS opening_cash_syp;
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS closing_cash_syp;
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS expected_cash_syp;
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS discrepancy_syp;



-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Profile backfill — link each auth.users row created in Phase A to its    ║
-- ║ profiles row. Idempotent: re-runs upsert.                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

INSERT INTO public.profiles (id, display_name, role, active)
SELECT u.id, s.display_name, s.role_name, true
FROM auth.users u
JOIN (VALUES
  ('adham@ox.local',      'كوتش ادهم',  'manager'),
  ('reception1@ox.local', 'reception1', 'reception'),
  ('reception2@ox.local', 'reception2', 'reception'),
  ('reception3@ox.local', 'reception3', 'reception'),
  ('reception4@ox.local', 'reception4', 'reception'),
  ('reception5@ox.local', 'reception5', 'reception'),
  ('reception6@ox.local', 'reception6', 'reception'),
  ('reception7@ox.local', 'reception7', 'reception')
) AS s(email, display_name, role_name) ON s.email = u.email
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role         = EXCLUDED.role,
  active       = true;

NOTIFY pgrst, 'reload schema';
