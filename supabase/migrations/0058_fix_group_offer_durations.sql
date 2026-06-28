-- ============================================================
-- 0058 — Normalize group-offer durations + backfill يوسف's session
--
-- The dashboard derives a subscription's status from end_date
-- (remaining > 0 → active), NOT from the stored `status` column
-- (see store-context.tsx). So any group-offer row whose end_date is
-- longer than its plan (e.g. يوسف's original 60 days on a 1-month plan)
-- shows extra days remaining even when it should be expired.
--
-- A) Backfill cash_session_id on يوسف's group rows that are still NULL
--    (an earlier insert ran before the session was copied).
-- B) Audit + fix EVERY group-offer row so end_date = start_date + plan
--    days. Group offers are plain plan-length memberships (zero bonus
--    days), so this is always the correct duration.
--
-- AUDIT (run alone first to see what's off):
--   select member_name, offer, plan_type, start_date, end_date,
--          (end_date - start_date) as cur_days
--   from public.gym_subscriptions
--   where offer in ('group_5','group_9','referral_4','referral_9')
--     and cancelled_at is null
--   order by created_at;
-- ============================================================

-- ── A) Backfill the missing cash session on يوسف's group ────
update public.gym_subscriptions
   set cash_session_id = (
     select cash_session_id from public.gym_subscriptions
     where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
       and cash_session_id is not null
       and cancelled_at is null
     limit 1
   )
 where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
   and cash_session_id is null
   and cancelled_at is null;

-- ── B) Normalize every group-offer end_date to start + plan days ──
with planmap(plan, days) as (
  values ('daily',1),('15_days',15),('1_month',30),('3_months',90),
         ('6_months',180),('9_months',270),('12_months',360)
)
update public.gym_subscriptions s
   set end_date = s.start_date + p.days
  from planmap p
 where s.plan_type = p.plan
   and s.offer in ('group_5','group_9','referral_4','referral_9')
   and s.cancelled_at is null
   and s.end_date <> s.start_date + p.days
returning s.member_name, s.offer, s.plan_type, s.start_date, s.end_date,
          (s.end_date - s.start_date) as days;

NOTIFY pgrst, 'reload schema';

