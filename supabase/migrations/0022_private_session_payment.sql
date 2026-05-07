-- ============================================================
-- 0022 — Payment tracking on private_sessions
--
-- Adds:
--   • private_sessions.paid_amount      numeric(12,2) (default 0)
--   • private_sessions.payment_status   text          (paid|partial|unpaid; default 'paid')
--
-- Existing rows have total_price + currency but no notion of partial
-- payment. Default new columns to "paid in full" so the historical
-- assumption (everything was paid up front) is preserved.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

ALTER TABLE public.private_sessions
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.private_sessions
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'private_sessions_payment_status_check'
  ) THEN
    ALTER TABLE public.private_sessions
      ADD CONSTRAINT private_sessions_payment_status_check
      CHECK (payment_status IN ('paid','partial','unpaid'));
  END IF;
END $$;

-- Backfill paid_amount = total_price for the legacy "everything was paid"
-- assumption. Skipping rows that already have a non-zero paid_amount
-- (e.g., a manual fix).
UPDATE public.private_sessions
   SET paid_amount = total_price
 WHERE paid_amount = 0
   AND total_price > 0
   AND payment_status = 'paid';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   ALTER TABLE public.private_sessions DROP CONSTRAINT IF EXISTS private_sessions_payment_status_check;
--   ALTER TABLE public.private_sessions DROP COLUMN IF EXISTS payment_status;
--   ALTER TABLE public.private_sessions DROP COLUMN IF EXISTS paid_amount;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
