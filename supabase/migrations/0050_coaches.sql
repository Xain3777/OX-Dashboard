-- ============================================================
-- 0050 — coaches roster
--
-- Adds a `coaches` table for the gym's employed trainers. Distinct
-- from `members` (members are paying customers, coaches are staff).
-- Used by:
--   • the private + coach_private subscription forms
--     (free-text `private_coach_name` is replaced by a select over
--     this roster, with an "add new" inline path)
--   • per-coach revenue rollups in the manager dashboard
--
-- Schema notes:
--   • `share_percentage` is nullable on purpose — share/split is
--     entered by the cashier per transaction, this column is just an
--     optional default the cashier can override.
--   • Soft-deactivation via `is_active` (no hard delete) keeps the
--     audit chain intact: an old private_session row can still
--     resolve a deactivated coach's name.
-- ============================================================

create table if not exists public.coaches (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text,
  share_percentage numeric(5,2),
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now()
);

create unique index if not exists coaches_name_unique_active
  on public.coaches (lower(name))
  where is_active = true;

create index if not exists coaches_active_idx
  on public.coaches (is_active, name);

-- Optional link from a subscription's private add-on to a coach row.
-- Free-text `private_coach_name` stays as the canonical snapshot so
-- historical rows still render after a coach is renamed/deactivated.
alter table public.gym_subscriptions
  add column if not exists coach_id uuid references public.coaches(id);

-- RLS: every authenticated user can read the roster (cashiers need
-- the dropdown). Insert is open to authenticated (any cashier can
-- onboard a coach via the inline-add). Update / delete restricted to
-- managers.
alter table public.coaches enable row level security;

drop policy if exists "coaches read"   on public.coaches;
drop policy if exists "coaches insert" on public.coaches;
drop policy if exists "coaches update" on public.coaches;
drop policy if exists "coaches delete" on public.coaches;

create policy "coaches read"
  on public.coaches for select
  to authenticated
  using (true);

create policy "coaches insert"
  on public.coaches for insert
  to authenticated
  with check (created_by = auth.uid() or created_by is null);

create policy "coaches update"
  on public.coaches for update
  to authenticated
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

create policy "coaches delete"
  on public.coaches for delete
  to authenticated
  using (public.current_role() = 'manager');

-- Keep updated_at fresh
create or replace function public.touch_coaches_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_coaches_touch on public.coaches;
create trigger trg_coaches_touch
  before update on public.coaches
  for each row execute function public.touch_coaches_updated_at();

NOTIFY pgrst, 'reload schema';
