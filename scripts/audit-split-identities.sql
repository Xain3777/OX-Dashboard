-- ============================================================
-- Weekly audit — split member identities (member/coach app)
--
-- Context: registration in the member app used to create a SECOND
-- members row for the login instead of attaching auth to the row
-- reception created (which holds the subscription). Migrations
-- 0069–0071 healed the backlog and installed triggers that auto-link
-- new registrations, but the ROOT fix lives in the ox-gym-app repo.
-- Run this weekly in Supabase Dashboard → SQL Editor. Every section
-- should return 0 rows / zeros — anything else means the app fix
-- regressed (or isn't shipped yet) and the trigger needs a look.
-- Read-only: safe to run any time.
-- ============================================================

-- 1. App profiles whose linked member has NO login while the same
--    auth user sits on a DIFFERENT members row (the classic split —
--    coach terminal would resolve these players to a dead row).
select 'profile_linked_to_no_login_row' as problem, p.id as app_profile_id,
       p.full_name, p.linked_member_id, b.id as login_member_id
from public.member_app_profiles p
join public.members a on a.id = p.linked_member_id and a.auth_id is null
join public.members b on b.auth_id = p.app_user_id and b.id <> p.linked_member_id;

-- 2. Active subscriptions stranded on a no-login member while the
--    activation code's owner has a login row (reception health page
--    shows these as unlinked; coach can't bill/see them correctly).
select 'active_sub_on_no_login_row' as problem, g.id as subscription_id,
       g.member_name, g.activation_code, g.member_id as no_login_member,
       p.linked_member_id as login_member
from public.gym_subscriptions g
join public.members a on a.id = g.member_id and a.auth_id is null
join public.member_app_profiles p
  on upper(btrim(p.activation_code)) = upper(btrim(g.activation_code))
where g.cancelled_at is null
  and g.end_date >= current_date;

-- 3. Duplicate members per phone where one row has auth and another
--    doesn't (new duplicates being created = app fix not shipped).
--    Counts only; drill in with the phone if nonzero.
select 'duplicate_login_noLogin_pairs' as metric, count(*) as pairs
from (
  select phone_normalized
  from public.members
  where phone_normalized is not null and phone_normalized <> ''
  group by phone_normalized
  having bool_or(auth_id is not null) and bool_or(auth_id is null) and count(*) > 1
) d;

-- 4. Roster health: app-registered players the coach terminal would
--    see WITHOUT a resolvable login (must stay 0 — 0070's guarantee).
select 'roster_rows_without_login' as metric, count(*) as rows
from public.app_registered_players arp
join public.members m on m.id = arp.member_id
where m.auth_id is null;
