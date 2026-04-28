-- Group linkage for subscriptions (couple / referral)
alter table public.subscriptions
  add column if not exists group_id uuid;

-- ── Private training sessions ─────────────────────────────────────────────────

create table if not exists public.private_sessions (
  id                uuid          primary key default gen_random_uuid(),
  number_of_players int           not null check (number_of_players > 0),
  player_names      text[]        not null default '{}',
  base_trainer_fee  numeric(10,2) not null default 18,
  group_price       numeric(10,2) not null,
  total_price       numeric(10,2) not null,
  currency          text          not null default 'usd' check (currency in ('syp','usd')),
  exchange_rate     numeric(10,2) not null default 1,
  amount_syp        numeric(12,2),
  group_id          uuid,
  notes             text,
  cash_session_id   uuid          references public.cash_sessions(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid          references public.profiles(id),
  cancelled_reason  text,
  created_at        timestamptz   not null default now(),
  created_by        uuid          not null references public.profiles(id),
  created_by_name   text
);

alter table public.private_sessions enable row level security;

create policy "private_sessions_insert"
  on public.private_sessions for insert to authenticated
  with check (created_by = auth.uid());

create policy "private_sessions_select"
  on public.private_sessions for select to authenticated
  using (true);

create policy "private_sessions_update"
  on public.private_sessions for update to authenticated
  using (
    created_by = auth.uid() or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
  );

-- ── Group offers metadata (couple / referral / corporate) ─────────────────────

create table if not exists public.group_offers (
  id                uuid         primary key default gen_random_uuid(),
  group_id          uuid         not null,
  offer_type        text         not null check (offer_type in ('referral','couple','corporate')),
  members           jsonb        not null default '[]',
  referral_count    int,
  reward_type       text,
  reward_value      numeric,
  discount_percent  numeric,
  organization_type text,
  price_applied     numeric,
  cash_session_id   uuid         references public.cash_sessions(id),
  created_at        timestamptz  not null default now(),
  created_by        uuid         not null references public.profiles(id)
);

alter table public.group_offers enable row level security;

create policy "group_offers_all"
  on public.group_offers for all to authenticated
  using (true)
  with check (created_by = auth.uid());
