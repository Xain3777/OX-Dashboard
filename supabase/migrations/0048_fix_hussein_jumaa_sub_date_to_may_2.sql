-- ============================================================
-- 0048 — move subscription "حسين جمعة حمود" into May 2 history
--
-- The subscription for حسين جمعة حمود (phone 0991133447, $35 paid,
-- id f3c7714f-eca0-4b29-a21b-aca2d58f17d9) was entered today
-- (2026-05-19) but belongs to 2026-05-02 (start_date is already
-- 2026-05-02).
--
-- fetchDailyReport / fetchReportSummary bucket subscriptions by
-- `created_at` falling inside the Damascus calendar day — NOT by
-- start_date. So the $35 currently counts toward today's total
-- (both the date-bucketed report and the per-shift breakdown).
--
-- Fix is two steps:
--   1. created_at -> noon 2026-05-02 (Asia/Damascus, UTC+3) so the
--      row moves into May 2's date-bucketed daily/monthly totals
--      and leaves today's "إيرادات اليوم".
--   2. cash_session_id -> 4233c02a-3253-45a0-bbbc-be5b9783ab9e —
--      the session that ran 2026-05-01 05:08 → 2026-05-07 04:02
--      Damascus, which covers May 2. Unlike migration 0046 (May 4
--      had no session, so NULL was used), May 2 falls inside a real
--      session, so the row is attached to it — mirroring 0047.
--
-- Net effect: $35 leaves today (date total + today's shift) and
-- lands on May 2 (date total + the May 1–7 session 4233c02a).
-- ============================================================

-- 1. Preview the row BEFORE the change (run first, confirm 1 row):
-- SELECT id, member_name, phone, start_date, end_date, paid_amount,
--        amount, created_at, cash_session_id
--   FROM public.gym_subscriptions
--  WHERE id = 'f3c7714f-eca0-4b29-a21b-aca2d58f17d9';

-- 2. Apply the fix:
UPDATE public.gym_subscriptions
   SET created_at      = '2026-05-02 12:00:00+03'::timestamptz,
       cash_session_id = '4233c02a-3253-45a0-bbbc-be5b9783ab9e'
 WHERE id = 'f3c7714f-eca0-4b29-a21b-aca2d58f17d9';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT (restores it to today; original today-session id was
-- 1349b412-2c91-4ac5-8310-32e5ff666452):
--   UPDATE public.gym_subscriptions
--      SET created_at      = now(),
--          cash_session_id = '1349b412-2c91-4ac5-8310-32e5ff666452'
--    WHERE id = 'f3c7714f-eca0-4b29-a21b-aca2d58f17d9';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
