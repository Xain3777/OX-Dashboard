-- ============================================================
-- 0069 — member/coach app: read active membership from gym_subscriptions
--
-- Symptom (reported 2026-07): players who register in the member app have a
-- working login but do NOT show up for coaches / reception, "the coach
-- terminal can't send them" a plan. It looks like it "started randomly a
-- couple days ago and keeps growing." It is NOT a storage/infra event —
-- the DB is ~39 MB, project healthy, no deleted/dangling rows. What changed
-- is that coaches started relying on a subscription check that was never
-- correctly wired; the backlog just became visible and keeps growing with
-- every new registration.
--
-- Root cause
-- ----------
-- The member/coach app decides "is this an active client?" from the table
-- public.subscriptions (the sister app's own table). Every surface that
-- reports subscription status reads it:
--     • view public.app_registered_players     (coach terminal roster)
--     • view public.coach_player_profile_audit  (player buckets)
-- But reception records EVERY real membership in public.gym_subscriptions,
-- and NOTHING syncs gym_subscriptions -> subscriptions (no trigger exists;
-- the bridge view member_subscriptions is unused). Live audit:
--     • public.subscriptions        →   39 rows,   2 active & current
--     • public.gym_subscriptions    → 1095 rows, ~263 active & current
--     • coach_player_profile_audit  → 552 players "not_subscribed_but_app",
--                                       only  1 "subscribed_and_app"
-- So virtually every app-registered player is treated as having no
-- subscription and the coach terminal won't send to them.
--
-- Compounding: split member identity. Reception creates a members row
-- (no auth) and links the gym_subscriptions row to it; when the same person
-- registers in the app, a SECOND members row (with auth) is created and the
-- app profile links to THAT one (sometimes a spelling variant, e.g.
-- "ألما"/"الما"). So the subscription's member_id and the app login's
-- member_id differ — a member_id-only join misses them. The phone the two
-- sides store also differs in format (gym_subscriptions "0997…" vs members
-- "963997…"), so matching must normalize both via public.normalize_phone().
--
-- Fix (this migration)
-- --------------------
--   Part 1: add + backfill + auto-sync gym_subscriptions.phone_normalized so
--           it can be matched against members.phone_normalized.
--   Part 2: repoint app_registered_players' subscription lookup at
--           gym_subscriptions, matching member_id OR phone_normalized.
--   Part 3: same repoint inside coach_player_profile_audit's
--           has_active_subscription / profile_bucket checks.
-- Simulated on live data: "active membership" resolves for 363 players (was
-- ~2-15), including every name reported. View output columns/types are
-- unchanged (CREATE OR REPLACE preserves grants + SECURITY DEFINER), so the
-- member app needs no redeploy.
--
-- NOT fixed here (true root cause, lives in the sister app + a data cleanup):
--   • the registration flow should MATCH an existing reception members row by
--     normalized phone and reuse it, instead of creating a duplicate.
--   • existing duplicate members should be merged.
--   • players in members+gym_subscriptions with NO member_app_profiles row
--     (e.g. "كرم عوض") never appear in app_registered_players at all.
-- If the coach terminal reads the public.subscriptions TABLE directly (not
-- these views), that table must additionally be fed from gym_subscriptions —
-- say so and it gets its own migration.
--
-- Idempotent. Apply manually via Supabase Dashboard → SQL Editor.
-- Depends on: public.normalize_phone(text), gym_subscriptions, members,
-- member_app_profiles, enums sub_plan_type / sub_status / user_role.
-- ============================================================

-- ── Part 1: normalized phone on gym_subscriptions ─────────────
alter table public.gym_subscriptions
  add column if not exists phone_normalized text;

update public.gym_subscriptions
   set phone_normalized = public.normalize_phone(phone)
 where phone is not null
   and phone_normalized is distinct from public.normalize_phone(phone);

create or replace function public.sync_gym_subscription_phone_normalized()
returns trigger
language plpgsql
as $$
begin
  new.phone_normalized := public.normalize_phone(new.phone);
  return new;
end;
$$;

drop trigger if exists trg_gym_subscriptions_phone_normalized on public.gym_subscriptions;
create trigger trg_gym_subscriptions_phone_normalized
  before insert or update of phone on public.gym_subscriptions
  for each row execute function public.sync_gym_subscription_phone_normalized();

create index if not exists gym_subscriptions_phone_normalized_idx
  on public.gym_subscriptions (phone_normalized);

-- ── Part 2: coach-terminal roster view ────────────────────────
create or replace view public.app_registered_players as
  select
    p.id                          as app_profile_id,
    p.app_user_id,
    p.linked_member_id            as member_id,
    p.full_name,
    p.phone,
    p.phone_normalized,
    p.height_cm,
    p.weight_kg,
    p.fitness_goal,
    p.training_level,
    p.onboarding_complete,
    p.app_registered_at,
    m.status                      as member_status,
    s.plan_type,
    s.start_date,
    s.end_date,
    s.status                      as subscription_status,
    greatest(s.end_date - current_date, 0) as subscription_days_left
  from public.member_app_profiles p
    join public.members m on m.id = p.linked_member_id
    left join lateral (
      select
        case
          when g.plan_type = '1_month'  then 'monthly'::sub_plan_type
          when g.plan_type = '3_months' then 'quarterly'::sub_plan_type
          else                               'annual'::sub_plan_type
        end                        as plan_type,
        g.start_date,
        g.end_date,
        'active'::sub_status       as status
      from public.gym_subscriptions g
      where g.cancelled_at is null
        and g.end_date >= current_date
        and (
              g.member_id = m.id
           or (m.phone_normalized is not null
               and g.phone_normalized is not null
               and g.phone_normalized = m.phone_normalized)
        )
      order by g.end_date desc
      limit 1
    ) s on true;

-- ── Part 3: player-bucket audit view ──────────────────────────
-- Same shape as before; the two subscription EXISTS checks now read
-- gym_subscriptions (member_id OR normalized phone) instead of the unfed
-- public.subscriptions table.
create or replace view public.coach_player_profile_audit as
  select
    m.id                                   as member_id,
    p.id                                   as app_profile_id,
    m.full_name,
    m.phone,
    m.status                               as member_status,
    m.auth_id is not null                  as has_auth_account,
    p.id is not null                       as has_app_profile,
    p.app_registered_at,
    coalesce(p.onboarding_complete, false) as app_onboarding_complete,
    exists (
      select 1 from public.gym_subscriptions g
      where g.cancelled_at is null and g.end_date >= current_date
        and (g.member_id = m.id
             or (m.phone_normalized is not null and g.phone_normalized is not null
                 and g.phone_normalized = m.phone_normalized))
    )                                      as has_active_subscription,
    coalesce(m.onboarding_complete, false) = true
      or m.date_of_birth is not null or m.gender is not null
      or m.height_cm is not null or m.weight_kg is not null
      or nullif(trim(both from coalesce(m.fitness_goal, ''::text)), ''::text) is not null
      or nullif(trim(both from coalesce(m.training_level, ''::text)), ''::text) is not null
      or nullif(trim(both from coalesce(m.weight_goal, ''::text)), ''::text) is not null
      or nullif(trim(both from coalesce(m.fitness_outcome, ''::text)), ''::text) is not null
      or cardinality(coalesce(m.illnesses, '{}'::text[])) > 0
      or cardinality(coalesce(m.injuries, '{}'::text[])) > 0
                                           as has_legacy_profile_data,
    case
      when exists (
        select 1 from public.gym_subscriptions g
        where g.cancelled_at is null and g.end_date >= current_date
          and (g.member_id = m.id
               or (m.phone_normalized is not null and g.phone_normalized is not null
                   and g.phone_normalized = m.phone_normalized))
      ) and p.id is not null then 'subscribed_dashboard_and_app'::text
      when exists (
        select 1 from public.gym_subscriptions g
        where g.cancelled_at is null and g.end_date >= current_date
          and (g.member_id = m.id
               or (m.phone_normalized is not null and g.phone_normalized is not null
                   and g.phone_normalized = m.phone_normalized))
      ) then 'subscribed_dashboard_not_app'::text
      when p.id is not null then 'not_subscribed_in_dashboard_but_app'::text
      when m.auth_id is not null then 'auth_account_without_app_profile'::text
      else 'dashboard_only_no_auth'::text
    end                                    as profile_bucket
  from public.members m
    left join public.member_app_profiles p on p.linked_member_id = m.id
  where m.role = 'player'::user_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT: restore both views to their subscriptions-sourced form and
-- drop the phone_normalized column/trigger/index. (Original app_registered_
-- players + coach_player_profile_audit definitions are recorded in git
-- history of this file / pg_get_viewdef prior to 0069.)
--   DROP TRIGGER IF EXISTS trg_gym_subscriptions_phone_normalized ON public.gym_subscriptions;
--   DROP FUNCTION IF EXISTS public.sync_gym_subscription_phone_normalized();
--   DROP INDEX IF EXISTS public.gym_subscriptions_phone_normalized_idx;
--   ALTER TABLE public.gym_subscriptions DROP COLUMN IF EXISTS phone_normalized;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
