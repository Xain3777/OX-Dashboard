-- ============================================================
-- 0043 — enable track_stock for the supplement-style kitchen drinks
--
-- Following migration 0037 (which switched on tracking for ماء صغير /
-- ماء كبير), this turns on stock tracking for the three drink items
-- that are physically inventoried at the bar — BCAA, Pre-workout, and
-- مشروب طاقة. After this migration, every kitchen sale of these items
-- will auto-decrement catalog_items.stock_quantity via the trigger
-- already wired in lib/supabase/intake.ts:pushItemSale.
--
-- Initial stock_quantity is left untouched — the manager sets the real
-- starting count from the catalog edit UI (or the kitchen table).
--
-- low_stock_threshold defaults to 3 from the 0030 column default; bump
-- to 5 (same as water) so the manager sees a low-stock warning sooner
-- on these higher-turnover items.
--
-- Idempotent: re-applying converges to the same state.
-- ============================================================

UPDATE public.catalog_items
   SET track_stock         = true,
       low_stock_threshold = 5
 WHERE name IN ('BCAA', 'Pre-workout', 'مشروب طاقة');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   UPDATE public.catalog_items
--      SET track_stock         = false,
--          low_stock_threshold = 3
--    WHERE name IN ('BCAA', 'Pre-workout', 'مشروب طاقة');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
