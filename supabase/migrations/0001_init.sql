-- ============================================================
-- OX GYM — initial schema
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- ── PROFILES (1:1 with auth.users) ──────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('manager', 'reception')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── MEMBERS (skipped — sister-app's `members` is canonical) ─────────
-- The shared Supabase project already has a `members` table from sister-app
-- with shape (auth_id, full_name, role, username, phone, ...). The dashboard
-- only reads from it (InBodyBlock dropdown, FK targets) and never writes,
-- so we don't recreate it here. RLS policies for `members` are owned by
-- sister-app's RESET_AND_SEED — do NOT add policies that would overwrite
-- them.

-- ── PRODUCTS ────────────────────────────────────────────────
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

-- ── CASH SESSIONS (one per shift) ───────────────────────────
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

-- ── SUBSCRIPTIONS ───────────────────────────────────────────
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

-- ── SALES (store + kitchen) ─────────────────────────────────
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

-- ── InBody SESSIONS ─────────────────────────────────────────
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

-- ── ACTIVITY FEED ───────────────────────────────────────────
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

-- ── INDEXES ─────────────────────────────────────────────────
create index if not exists idx_subs_user_time     on public.gym_subscriptions(created_by, created_at desc);
create index if not exists idx_sales_user_time    on public.sales(created_by, created_at desc);
create index if not exists idx_inbody_user_time   on public.inbody_sessions(created_by, created_at desc);
create index if not exists idx_activity_time      on public.activity_feed(created_at desc);
create index if not exists idx_cash_user_time     on public.cash_sessions(opened_by, opened_at desc);
create index if not exists idx_subs_session       on public.gym_subscriptions(cash_session_id);
create index if not exists idx_sales_session      on public.sales(cash_session_id);
create index if not exists idx_inbody_session     on public.inbody_sessions(cash_session_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.profiles        enable row level security;
-- members RLS is owned by sister-app — do not toggle here.
alter table public.products        enable row level security;
alter table public.cash_sessions   enable row level security;
alter table public.gym_subscriptions   enable row level security;
alter table public.sales           enable row level security;
alter table public.inbody_sessions enable row level security;
alter table public.activity_feed   enable row level security;

create or replace function public.current_role() returns text
  language sql stable security definer set search_path = public, auth as $$
  select role from public.profiles where id = auth.uid();
$$;

-- profiles
drop policy if exists "profiles read"  on public.profiles;
drop policy if exists "profiles write" on public.profiles;
create policy "profiles read"  on public.profiles for select to authenticated using (true);
create policy "profiles write" on public.profiles for all    to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- members policies are owned by sister-app's RESET_AND_SEED.sql; leaving them
-- untouched here prevents accidental over-permissioning.

-- products (read by all, mutate by manager only)
drop policy if exists "products read"  on public.products;
drop policy if exists "products write" on public.products;
create policy "products read"  on public.products for select to authenticated using (true);
create policy "products write" on public.products for all    to authenticated
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- cash_sessions: reception sees own; manager sees all
drop policy if exists "cs read"   on public.cash_sessions;
drop policy if exists "cs insert" on public.cash_sessions;
drop policy if exists "cs update" on public.cash_sessions;
create policy "cs read"   on public.cash_sessions for select to authenticated
  using (public.current_role() = 'manager' or opened_by = auth.uid());
create policy "cs insert" on public.cash_sessions for insert to authenticated
  with check (opened_by = auth.uid());
create policy "cs update" on public.cash_sessions for update to authenticated
  using (opened_by = auth.uid() or public.current_role() = 'manager');

-- intake tables
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

-- realtime publications
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
