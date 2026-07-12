-- ============================================================
-- 0071 — consolidate each player's subscription onto their LOGIN member
--        (the other half of the duplicate-identity repair; completes 0070)
--
-- Context
-- -------
-- 0070 relinked each app profile to the members row that holds the login, so
-- the coach ROSTER (app_registered_players) now points at a sendable row for
-- everyone. But a player's gym_subscriptions row is created by reception on
-- the OLD no-login members row (Row A) — reception makes the row + issues the
-- activation code BEFORE the player registers. When the player later registers
-- (creating the login Row B), the subscription stays behind on Row A.
--
-- Symptom this fixes: زين حسان علي / 0959619700 — login + profile on Row B,
-- but subscription (active to 2026-08-01) on Row A. If the coach terminal
-- resolves a player through the SUBSCRIPTION (Row A, no login), it still can't
-- send to him even after 0070. On a live audit, 424 non-cancelled subs sit on
-- a no-login row while the same person has a login row.
--
-- Deterministic key: the activation code. A player registers with the exact
-- code on their subscription, and it is stored on member_app_profiles.
-- activation_code — so gym_subscriptions.activation_code = profile.activation_
-- code identifies the owner's login member (profile.linked_member_id, which
-- 0070 already pointed at the login row). zein's profile code = RG093366 =
-- his subscription code. No name/phone guessing.
--
-- Fix
-- ---
--   Part 1: one-time — repoint non-cancelled subscriptions that sit on a
--           no-login row onto the login member identified by the shared
--           activation code. Only where the code maps to exactly ONE login
--           member (skips the lone ambiguous code).
--   Part 2: prevention — extend 0070's relink function so that when a member
--           gains auth (registration), that person's stranded subscription is
--           moved onto the login row in the same step.
--
-- Safety: only MEMBER LINKAGE (member_id) is changed — never amounts, dates,
-- status, or cash. The dashboard reception list renders member_name (a
-- snapshot), so its display is unaffected; the one-offer-per-member check and
-- member_subscriptions/app_registered_players all become MORE correct.
--
-- After 0070 + 0071, every registered player has login + profile + active
-- subscription resolving to one login-bearing members row, so the coach can
-- send regardless of which row the terminal keys off. The no-login Row A is
-- left as a harmless historical shell.
--
-- True permanent cure still belongs in the member app: on registration, match
-- the existing members row by the activation code and set auth_id on IT
-- instead of inserting a duplicate. Part 2 is a DB-side stopgap until then.
--
-- Idempotent. Apply AFTER 0070. Manual via Supabase Dashboard → SQL Editor.
-- ============================================================

-- ── Part 1: one-time repoint via activation code ──────────────
update public.gym_subscriptions g
   set member_id = t.login_member
  from (
    select upper(btrim(p.activation_code))          as code,
           (array_agg(distinct p.linked_member_id))[1] as login_member
    from public.member_app_profiles p
    join public.members lm
      on lm.id = p.linked_member_id and lm.auth_id is not null   -- linked to a real login row
    where p.activation_code is not null and btrim(p.activation_code) <> ''
    group by upper(btrim(p.activation_code))
    having count(distinct p.linked_member_id) = 1                 -- unambiguous owner
  ) t
 where upper(btrim(g.activation_code)) = t.code
   and g.cancelled_at is null
   and g.member_id is distinct from t.login_member
   and exists (select 1 from public.members a               -- only move OFF a no-login row
               where a.id = g.member_id and a.auth_id is null);

-- ── Part 2: keep subscriptions consolidated going forward ─────
-- Redefine 0070's function to also move the subscription when auth is set.
create or replace function public.relink_profile_to_auth_member()
returns trigger
language plpgsql
as $$
begin
  if new.auth_id is not null then
    -- (0070) point the profile for this login at THIS row
    update public.member_app_profiles p
       set linked_member_id = new.id
     where p.app_user_id = new.auth_id
       and p.linked_member_id is distinct from new.id;

    -- (0071) move this person's stranded subscription onto the login row,
    -- matched by the activation code the profile registered with.
    update public.gym_subscriptions g
       set member_id = new.id
      from public.member_app_profiles p
     where p.linked_member_id = new.id
       and p.activation_code is not null and btrim(p.activation_code) <> ''
       and upper(btrim(g.activation_code)) = upper(btrim(p.activation_code))
       and g.cancelled_at is null
       and g.member_id is distinct from new.id
       and exists (select 1 from public.members a
                   where a.id = g.member_id and a.auth_id is null);
  end if;
  return new;
end;
$$;
-- trigger trg_members_relink_profile (created in 0070) already calls this.

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT (data repair is correct; this only restores 0070's function body):
--   CREATE OR REPLACE FUNCTION public.relink_profile_to_auth_member() ...
--     -- (0070 version: profile relink only, no subscription move)
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
