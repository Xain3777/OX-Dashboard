-- ============================================================
-- 0052 — coach roster: per-coach trainee lists
--
-- Builds on 0050 (coaches table). Two pieces:
--   1. coaches.kind — tags a coach as 'private' (an external private
--      trainer renting the gym) or 'gym' (one of our own trainers).
--      Surfaced as a label in the new "المدربون" roster tab.
--   2. coach_trainees — the people training UNDER a coach. Fed from
--      both subscription forms (private "تدريب خاص" and gym-coach
--      "تدريب مع مدربينا"). One row per player, with name + phone.
--      This is what makes "who trains under Zein?" queryable and lets
--      reception add more players to an existing coach later without
--      re-charging the coach.
--
-- Money note: trainee rows are a ROSTER, not a revenue ledger. The
-- actual revenue still lives on private_sessions / gym_subscriptions
-- (with editable totals). `amount` here is an optional informational
-- snapshot of what was attributed to this player — never summed for
-- cash-session reconciliation.
-- ============================================================

-- 1. Coach kind ------------------------------------------------
alter table public.coaches
  add column if not exists kind text not null default 'private'
    check (kind in ('private','gym'));

-- 2. Trainees --------------------------------------------------
create table if not exists public.coach_trainees (
  id                 uuid          primary key default gen_random_uuid(),
  coach_id           uuid          references public.coaches(id),
  coach_name         text          not null,   -- snapshot; survives rename/deactivation
  name               text          not null,
  phone              text          not null,
  -- which form created this trainee
  source             text          not null default 'private'
                       check (source in ('private','coach_private')),
  -- optional links back to the revenue row that registered this player
  private_session_id uuid          references public.private_sessions(id) on delete set null,
  subscription_id    uuid          references public.gym_subscriptions(id) on delete set null,
  amount             numeric(10,2),            -- informational only
  amount_syp         numeric(12,2),            -- informational only
  is_active          boolean       not null default true,
  notes              text,
  created_at         timestamptz   not null default now(),
  created_by         uuid          references public.profiles(id),
  created_by_name    text
);

create index if not exists coach_trainees_coach_idx
  on public.coach_trainees (coach_id, is_active);

create index if not exists coach_trainees_created_idx
  on public.coach_trainees (created_at desc);

-- RLS: read = all authenticated (cashiers need the roster tab);
-- insert = own rows; update/delete = own rows or manager (mirrors
-- private_sessions).
alter table public.coach_trainees enable row level security;

drop policy if exists "coach_trainees read"   on public.coach_trainees;
drop policy if exists "coach_trainees insert" on public.coach_trainees;
drop policy if exists "coach_trainees update" on public.coach_trainees;
drop policy if exists "coach_trainees delete" on public.coach_trainees;

create policy "coach_trainees read"
  on public.coach_trainees for select
  to authenticated
  using (true);

create policy "coach_trainees insert"
  on public.coach_trainees for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "coach_trainees update"
  on public.coach_trainees for update
  to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager')
  with check (created_by = auth.uid() or public.current_role() = 'manager');

create policy "coach_trainees delete"
  on public.coach_trainees for delete
  to authenticated
  using (created_by = auth.uid() or public.current_role() = 'manager');

NOTIFY pgrst, 'reload schema';
