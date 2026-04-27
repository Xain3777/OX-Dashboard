-- OX GYM — USD shift overhaul
-- • cash_sessions: add opening_cash, actual_cash (USD), employee_name
-- • food_items: add price_usd column
-- • last_closed_session_for_today(): return actual_cash (USD)

-- ── 1. cash_sessions — USD columns ──────────────────────────────────
ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS opening_cash  numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cash   numeric(14,4),
  ADD COLUMN IF NOT EXISTS employee_name text;

-- ── 2. food_items — USD price ────────────────────────────────────────
ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS price_usd numeric(10,4) NOT NULL DEFAULT 0;

-- ── 3. Update RPC to return actual_cash (USD) ────────────────────────
-- The old function returned closing_cash_syp; we now return actual_cash.
CREATE OR REPLACE FUNCTION public.last_closed_session_for_today()
RETURNS TABLE(id uuid, actual_cash numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, actual_cash
  FROM public.cash_sessions
  WHERE status = 'closed'
    AND closed_at >= CURRENT_DATE::timestamptz
    AND closed_at <  CURRENT_DATE::timestamptz + INTERVAL '1 day'
  ORDER BY closed_at DESC
  LIMIT 1;
$$;
