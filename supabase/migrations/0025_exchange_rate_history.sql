-- ============================================================
-- 0025 — exchange rate change history
--
-- The current rate lives in app_settings.exchange_rate_usd_syp,
-- which gets overwritten on every change. This table records every
-- change as its own row so the manager dashboard can chart rate
-- over time and audit who changed what when.
--
-- Per-transaction snapshots already exist on each revenue row's
-- exchange_rate column — this table is for the rate-change events
-- themselves, independent of whether any transaction happened.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.exchange_rate_history (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  rate        numeric(12,4)  NOT NULL CHECK (rate > 0),
  changed_at  timestamptz    NOT NULL DEFAULT now(),
  changed_by  uuid           REFERENCES public.profiles(id) ON DELETE SET NULL,
  note        text
);

-- Time-series queries (charts, "rate yesterday", recent changes) sort by
-- changed_at descending. Index makes those queries cheap.
CREATE INDEX IF NOT EXISTS idx_exchange_rate_history_changed_at
  ON public.exchange_rate_history (changed_at DESC);

ALTER TABLE public.exchange_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_history read"   ON public.exchange_rate_history;
DROP POLICY IF EXISTS "rate_history insert" ON public.exchange_rate_history;

-- Any staff can read the full history (it's just numbers, no PII).
CREATE POLICY "rate_history read" ON public.exchange_rate_history
  FOR SELECT TO authenticated
  USING (true);

-- Insert: caller must stamp themselves as the changer (or NULL, e.g.
-- automated jobs). This mirrors the pattern on every other intake table.
CREATE POLICY "rate_history insert" ON public.exchange_rate_history
  FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid() OR changed_by IS NULL);

-- No UPDATE / DELETE policies — this is an append-only audit log.
-- Mistakes are corrected by inserting a new row, not by editing history.

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   DROP TABLE IF EXISTS public.exchange_rate_history;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
