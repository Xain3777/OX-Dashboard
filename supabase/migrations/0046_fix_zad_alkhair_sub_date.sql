-- ============================================================
-- 0046 — move subscription "زاد الخير محمد" into May 4 history
--
-- The subscription for زاد الخير محمد (phone 0997836872, $20 paid)
-- was entered today (2026-05-17) but belongs to 2026-05-04
-- (start_date is already 2026-05-04).
--
-- fetchDailyReport / fetchReportSummary bucket subscriptions by
-- `created_at` falling inside the Damascus calendar day — NOT by
-- start_date. So the $20 currently counts toward today's total.
--
-- This sets `created_at` to noon on 2026-05-04 (Asia/Damascus, UTC+3)
-- so the row moves into May 4's history and leaves today's total.
--
-- NOTE: cash_session_id is intentionally left unchanged. The row
-- still belongs to whatever shift it was recorded against, so the
-- per-shift breakdown for that session keeps reconciling. Only the
-- date-bucketed daily/monthly reports are affected.
-- ============================================================

-- 1. Preview the row BEFORE the change (run this first, confirm 1 row):
-- SELECT id, member_name, phone, start_date, end_date, paid_amount,
--        amount, created_at
--   FROM public.gym_subscriptions
--  WHERE phone = '0997836872'
--    AND member_name = 'زاد الخير محمد'
--    AND created_at::date = '2026-05-17';

-- 2. Apply the fix:
UPDATE public.gym_subscriptions
   SET created_at = '2026-05-04 12:00:00+03'::timestamptz
 WHERE phone = '0997836872'
   AND member_name = 'زاد الخير محمد'
   AND created_at::date = '2026-05-17';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT (restores it to today):
--   UPDATE public.gym_subscriptions
--      SET created_at = now()
--    WHERE phone = '0997836872'
--      AND member_name = 'زاد الخير محمد';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
