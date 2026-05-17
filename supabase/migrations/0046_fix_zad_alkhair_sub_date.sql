-- ============================================================
-- 0046 — move subscription "زاد الخير محمد" into May 4 history
--
-- The subscription for زاد الخير محمد (phone 0997836872, $20 paid)
-- was entered today (2026-05-17) but belongs to 2026-05-04
-- (start_date is already 2026-05-04).
--
-- fetchDailyReport / fetchReportSummary bucket subscriptions by
-- `created_at` falling inside the Damascus calendar day — NOT by
-- start_date. So the $20 originally counted toward today's total
-- (both the date-bucketed report and the per-shift breakdown).
--
-- Fix is two steps:
--   1. created_at -> noon 2026-05-04 (Asia/Damascus, UTC+3) so the
--      row moves into May 4's date-bucketed daily/monthly totals
--      and leaves today's "إيرادات اليوم".
--   2. cash_session_id -> NULL. No cash session was ever opened on
--      2026-05-04, so there is no May 4 shift to attach it to.
--      Detaching removes the $20 from today's per-shift breakdown
--      (الاشتراكات: $163 -> $143) and from today's cash close.
--      A NULL cash_session_id is valid (nullable column) and the
--      shift-breakdown reader (dashboard.ts) filters by
--      String(cash_session_id ?? "") === sid, so a detached row is
--      simply skipped by every shift card. The May 4 daily report
--      still counts it because that report buckets by created_at.
-- ============================================================

-- 1. Preview the row BEFORE the change (run this first, confirm 1 row):
-- SELECT id, member_name, phone, start_date, end_date, paid_amount,
--        amount, created_at, cash_session_id
--   FROM public.gym_subscriptions
--  WHERE phone = '0997836872'
--    AND member_name = 'زاد الخير محمد'
--    AND created_at::date = '2026-05-17';

-- 2. Apply the fix:
UPDATE public.gym_subscriptions
   SET created_at      = '2026-05-04 12:00:00+03'::timestamptz,
       cash_session_id = NULL
 WHERE phone = '0997836872'
   AND member_name = 'زاد الخير محمد'
   AND created_at::date = '2026-05-17';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT (restores it to today; cash_session_id stays NULL —
-- the original session id was not preserved):
--   UPDATE public.gym_subscriptions
--      SET created_at = now()
--    WHERE phone = '0997836872'
--      AND member_name = 'زاد الخير محمد';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
