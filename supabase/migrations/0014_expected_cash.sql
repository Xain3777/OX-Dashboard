-- Store expected vs actual cash at session close for discrepancy tracking
ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS expected_cash numeric(14,4),
  ADD COLUMN IF NOT EXISTS difference    numeric(14,4);
