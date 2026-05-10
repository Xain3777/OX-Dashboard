-- ============================================================
-- 0037 — track inventory on bottled water in the kitchen catalog
--
-- ماء صغير / ماء كبير are now stock-tracked like store supplements:
-- every reception kitchen sale decrements stock_quantity via the
-- server-side trigger that already exists in pushItemSale (intake.ts
-- decrements when track_stock = true, regardless of source).
--
-- Initial stock_quantity is left at 0 — the manager sets the real
-- starting count from the kitchen table in the dashboard. The four
-- supplement-style kitchen drinks (مشروب طاقة / BCAA / Pre-workout)
-- are NOT switched on yet; if they should track too, run an
-- analogous UPDATE.
--
-- low_stock_threshold defaults to 3 from the 0030 column default;
-- bump to 5 here so the manager sees a low-stock warning earlier on
-- water (high turnover item).
--
-- Idempotent: re-applying is a no-op because the UPDATEs converge to
-- the same state.
-- ============================================================

UPDATE public.catalog_items
   SET track_stock         = true,
       low_stock_threshold = 5
 WHERE name IN ('ماء صغير', 'ماء كبير');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   UPDATE public.catalog_items
--      SET track_stock         = false,
--          low_stock_threshold = 3
--    WHERE name IN ('ماء صغير', 'ماء كبير');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
