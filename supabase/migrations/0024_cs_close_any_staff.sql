-- ============================================================
-- 0024 — relax cash_sessions UPDATE so any reception can close
--
-- Reason: in real shift handoffs, the receptionist who CLOSES
-- a cash session is rarely the same person who opened it. The
-- 0001 policy restricted UPDATE to (opener OR manager), which
-- blocked the next-shift receptionist from closing the prior
-- shift's drawer and forced manager intervention every time.
--
-- New behavior: any authenticated `manager` OR `reception` can
-- UPDATE cash_sessions. The existing partial unique index from
-- 0013_one_open_session.sql still enforces "at most one open
-- session", and `closeCashSession` recomputes expected vs.
-- actual cash from DB rows on close — so the closer doesn't
-- have to be the opener for the audit trail to be correct.
-- `closed_by` is still recorded as auth.uid() of whoever closes.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

DROP POLICY IF EXISTS "cs update" ON public.cash_sessions;

CREATE POLICY "cs update" ON public.cash_sessions FOR UPDATE
  TO authenticated
  USING (public.current_user_role() IN ('manager', 'reception'));

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION (restore opener-or-manager rule):
--
--   DROP POLICY IF EXISTS "cs update" ON public.cash_sessions;
--   CREATE POLICY "cs update" ON public.cash_sessions FOR UPDATE
--     TO authenticated
--     USING (opened_by = auth.uid() OR public.current_user_role() = 'manager');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
