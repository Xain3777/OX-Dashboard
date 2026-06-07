-- ============================================================
-- 0053 — Anviz gate access: dashboard ⇄ device member map
--
-- Links a CrossChex/Anviz device user (numeric UserID on the gate,
-- e.g. 201) to a gym member by name. Anviz names do NOT match the
-- dashboard, so the manager types `member_name` manually to match
-- `gym_subscriptions.member_name`.
--
-- This table is just the MAPPING + a manual override. The actual
-- gate decision (UserFlag 1/0) is computed by an external sync
-- script that joins this map against gym_subscriptions:
--   • active subscription AND blocked = false  -> gate opens (1)
--   • expired / no sub / blocked = true        -> gate blocks (0)
-- `blocked` is a hard manual override that always blocks regardless
-- of subscription state.
-- ============================================================

create table if not exists public.anviz_member_map (
  id            uuid        primary key default gen_random_uuid(),
  anviz_userid  integer     not null unique,   -- the number on the device, e.g. 201
  member_name   text        not null,          -- typed manually; matches gym_subscriptions.member_name
  blocked       boolean     not null default false,  -- manual override: true = always blocked regardless of sub
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists anviz_member_map_member_name_idx
  on public.anviz_member_map (member_name);

-- RLS: read = all authenticated (any cashier/manager can view the
-- gate map). Insert / update / delete = managers only — gate access
-- is a manager-controlled concern.
alter table public.anviz_member_map enable row level security;

drop policy if exists "anviz_member_map read"   on public.anviz_member_map;
drop policy if exists "anviz_member_map insert" on public.anviz_member_map;
drop policy if exists "anviz_member_map update" on public.anviz_member_map;
drop policy if exists "anviz_member_map delete" on public.anviz_member_map;

create policy "anviz_member_map read"
  on public.anviz_member_map for select
  to authenticated
  using (true);

create policy "anviz_member_map insert"
  on public.anviz_member_map for insert
  to authenticated
  with check (public.current_role() = 'manager');

create policy "anviz_member_map update"
  on public.anviz_member_map for update
  to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

create policy "anviz_member_map delete"
  on public.anviz_member_map for delete
  to authenticated
  using (public.current_role() = 'manager');

-- Keep updated_at fresh
create or replace function public.touch_anviz_member_map_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_anviz_member_map_touch on public.anviz_member_map;
create trigger trg_anviz_member_map_touch
  before update on public.anviz_member_map
  for each row execute function public.touch_anviz_member_map_updated_at();

NOTIFY pgrst, 'reload schema';
