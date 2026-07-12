-- ============================================================
-- 0070 — coach terminal "can't send to some players": relink app
--        profiles to the members row that holds the login (auth)
--
-- Symptom (reported 2026-07): the coach terminal shows hundreds of players
-- and can send plans to most, but for a growing subset "send" does nothing —
-- even though those players CAN open the app with their activation code.
--
-- Root cause (verified on live data)
-- ----------------------------------
-- Every affected player has TWO public.members rows:
--   • Row A — created by reception, no auth_id, carries the gym subscription.
--             member_app_profiles.linked_member_id points HERE, so this is
--             what the coach roster/view public.app_registered_players and the
--             "send plan" tables (plan_sends / member_workout_programs /
--             member_meal_programs / notifications, all FK -> members) resolve
--             the player to.
--   • Row B — created when the player registered/activated, has auth_id = the
--             player's login. This is the row they actually sign in as.
-- The coach sends to Row A, which has no login to deliver to → nothing
-- happens. The player logs in fine because their auth lives on Row B.
--
-- Scale at write time: of 553 roster rows, 300 point at an auth row (send
-- works) and 253 point at a no-auth Row A (send fails). For ALL 253, the
-- profile's OWN app_user_id equals the auth_id on the correct Row B — so the
-- right row is identified deterministically, no name/phone guessing.
-- This is NOT a storage/infra issue (DB ~39 MB, project healthy).
--
-- Fix
-- ---
--   Part 1: one-time repair — relink each app profile to the members row
--           whose auth_id = the profile's app_user_id (idempotent; only
--           touches rows that are currently mispointed).
--   Part 2: prevention — a trigger so that whenever a members row gains an
--           auth_id, any app profile referencing that auth user is relinked
--           to it. Stops the bleed even before the registration flow (sister
--           app) is fixed to reuse the existing member instead of creating a
--           duplicate.
--
-- After this, app_registered_players.member_id points at the auth-bearing
-- row for all players, so the coach can send to everyone who has a login.
-- (Subscription display for the now-orphaned Row A subscription is handled by
-- 0069's phone-normalized fallback; 0070 does not need it to enable sending.)
--
-- Does NOT merge/delete the duplicate members rows — Row A is left as a
-- harmless subscription-only record. The TRUE permanent fix is in the member
-- app's registration/activation flow: match an existing members row by
-- normalized phone and set auth_id on IT, instead of inserting a new row.
--
-- Idempotent. Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

-- ── Part 1: one-time repair ───────────────────────────────────
update public.member_app_profiles p
   set linked_member_id = b.id
  from public.members b
 where p.app_user_id is not null
   and b.auth_id = p.app_user_id
   and p.linked_member_id is distinct from b.id;

-- ── Part 2: keep it from recurring ────────────────────────────
create or replace function public.relink_profile_to_auth_member()
returns trigger
language plpgsql
as $$
begin
  -- When a members row has/gets an auth_id, make sure the app profile for
  -- that same auth user points at THIS row (the one that can receive plans).
  if new.auth_id is not null then
    update public.member_app_profiles p
       set linked_member_id = new.id
     where p.app_user_id = new.auth_id
       and p.linked_member_id is distinct from new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_members_relink_profile on public.members;
create trigger trg_members_relink_profile
  after insert or update of auth_id on public.members
  for each row execute function public.relink_profile_to_auth_member();

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT (leaves the data repair in place — it is correct):
--   DROP TRIGGER IF EXISTS trg_members_relink_profile ON public.members;
--   DROP FUNCTION IF EXISTS public.relink_profile_to_auth_member();
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
