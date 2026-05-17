-- ============================================================
-- 0047 — move couple offer (أحمد حيدر + مايا خدام) into May 11 history
--
-- History reconstructed from activity_feed:
--   2026-05-11 17:04  Couple sub originally created for أحمد حيدر
--                     (group aeabbab2), in May 11 cash session
--                     1c935d22.
--   2026-05-11 19:58  That sub was edited (name/phone/plan/offer/
--                     dates/amount/paid_amount) — ended up a single
--                     row of $60 paid (id 3bcc2391).
--   2026-05-17 16:43  That May 11 row (3bcc2391, $60) was CANCELLED
--                     ("إلغاء — أحمد حيدر") — removed $60 from the
--                     May 11 total.
--   2026-05-17 16:46  A NEW couple sub was created as two rows —
--                     أحمد حيدر $30 + مايا خدام $30
--                     (group 29a1fc0e), start_date 2026-05-11, but
--                     created_at = today and attached to today's
--                     cash session.
--
-- The new couple belongs to 2026-05-11 (its start_date / true
-- registration date), not today. Daily/monthly reports bucket by
-- created_at, and the per-shift breakdown groups by cash_session_id.
--
-- Fix (both rows of group 29a1fc0e):
--   1. created_at -> 2026-05-11 17:04 (Asia/Damascus, UTC+3),
--      mirroring the original couple's creation time.
--   2. cash_session_id -> 1c935d22 — the May 11 session that ran
--      09:24–23:58 Damascus (the same session the original,
--      now-cancelled, couple sub belonged to). Unlike migration
--      0046 (May 4 had no session, so NULL was used), May 11 has a
--      real session, so the rows are attached to it — this also
--      restores that shift's subscription total, which lost $60
--      when row 3bcc2391 was cancelled.
--
-- Net effect: $60 leaves today (date total + today's shift) and
-- lands back on May 11 (date total + May 11 shift 1c935d22).
-- ============================================================

-- 1. Preview the rows BEFORE the change (run first, confirm 2 rows):
-- SELECT id, member_name, phone, paid_amount, start_date,
--        created_at, cash_session_id
--   FROM public.gym_subscriptions
--  WHERE group_id = '29a1fc0e-7dd7-484c-a130-4f4858fe1b44';

-- 2. Apply the fix:
UPDATE public.gym_subscriptions
   SET created_at      = '2026-05-11 17:04:00+03'::timestamptz,
       cash_session_id = '1c935d22-885c-48d0-972e-1bbecbc720bb'
 WHERE group_id = '29a1fc0e-7dd7-484c-a130-4f4858fe1b44';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT (restores both rows to today; original today-session
-- id was a4f9fdfe-5d57-4052-81ce-ea14efec88b6):
--   UPDATE public.gym_subscriptions
--      SET created_at      = now(),
--          cash_session_id = 'a4f9fdfe-5d57-4052-81ce-ea14efec88b6'
--    WHERE group_id = '29a1fc0e-7dd7-484c-a130-4f4858fe1b44';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
