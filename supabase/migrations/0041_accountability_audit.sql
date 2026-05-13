-- ============================================================
-- 0041 — financial accountability: before/after audit + per-shift
-- stock snapshots
--
-- 1. activity_feed gains two structured columns — old_value / new_value
--    as jsonb — so every edit captures *what it was* and *what it
--    became*, not just a freeform description. The description column
--    stays as the human-readable summary; existing rows keep working.
--
-- 2. stock_snapshots — append-only table written at shift open and
--    shift close, capturing the qty / sell_price / cost_price /
--    exchange_rate for every catalog_item where track_stock = true.
--    Per-shift reconciliation reads from this table; the math doesn't
--    depend on replaying activity_feed events.
--
-- Apply manually via Supabase Dashboard → SQL Editor in numeric order.
-- Idempotent — safe to re-apply.
-- ============================================================

-- 1. activity_feed structured before/after ---------------------

ALTER TABLE public.activity_feed
  ADD COLUMN IF NOT EXISTS old_value jsonb,
  ADD COLUMN IF NOT EXISTS new_value jsonb;

COMMENT ON COLUMN public.activity_feed.old_value IS
  'Structured before-state snapshot for edit/delete/cancel events. NULL for create or activity events with no prior state.';
COMMENT ON COLUMN public.activity_feed.new_value IS
  'Structured after-state snapshot for create/edit events. NULL for delete/cancel events.';

-- 2. stock_snapshots ------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_snapshots (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id      uuid          NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  snapshot_type        text          NOT NULL CHECK (snapshot_type IN ('open','close')),
  catalog_item_id      uuid          NOT NULL REFERENCES public.catalog_items(id) ON DELETE CASCADE,
  item_name_snapshot   text          NOT NULL,
  category_snapshot    text,
  stock_quantity       numeric(14,3) NOT NULL CHECK (stock_quantity >= 0),
  sell_price           numeric(14,4) NOT NULL CHECK (sell_price >= 0),
  sell_currency        text          NOT NULL CHECK (sell_currency IN ('syp','usd')),
  cost_price           numeric(14,4),
  cost_currency        text          CHECK (cost_currency IS NULL OR cost_currency IN ('syp','usd')),
  exchange_rate_to_syp numeric(14,4) NOT NULL CHECK (exchange_rate_to_syp > 0),
  snapshot_at          timestamptz   NOT NULL DEFAULT now(),
  snapshot_by          uuid          REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One row per (session, type, item). Re-running the snapshot for the
-- same session/type is a no-op via ON CONFLICT DO NOTHING in code.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_snapshot_per_session_type_item
  ON public.stock_snapshots (cash_session_id, snapshot_type, catalog_item_id);

CREATE INDEX IF NOT EXISTS idx_stock_snapshots_session
  ON public.stock_snapshots (cash_session_id, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_stock_snapshots_item_time
  ON public.stock_snapshots (catalog_item_id, snapshot_at DESC);

ALTER TABLE public.stock_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_snapshots read"   ON public.stock_snapshots;
DROP POLICY IF EXISTS "stock_snapshots insert" ON public.stock_snapshots;

-- Read: any authenticated user. The audit tab is manager-only in the UI
-- but reception staff legitimately need to query snapshots for their own
-- open/close cycle, and the data is just numbers — no PII.
CREATE POLICY "stock_snapshots read" ON public.stock_snapshots
  FOR SELECT TO authenticated
  USING (true);

-- Insert: caller stamps themselves as snapshot_by (NULL allowed for
-- automated/server-side jobs). Mirrors the activity_feed pattern.
CREATE POLICY "stock_snapshots insert" ON public.stock_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (snapshot_by = auth.uid() OR snapshot_by IS NULL);

-- No UPDATE / DELETE policies — append-only audit log. Mistakes are
-- corrected by inserting a new row, not by editing history.

-- 3. Realtime publication -------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'stock_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_snapshots;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   DROP TABLE IF EXISTS public.stock_snapshots;
--   ALTER TABLE public.activity_feed
--     DROP COLUMN IF EXISTS old_value,
--     DROP COLUMN IF EXISTS new_value;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
