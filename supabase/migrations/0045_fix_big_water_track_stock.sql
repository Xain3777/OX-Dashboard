-- ============================================================
-- 0045 — re-apply track_stock for ماء كبير (big water)
--
-- Migration 0037 switched on track_stock for ماء صغير / ماء كبير,
-- but on the live database ماء كبير still has track_stock = false
-- (low_stock_threshold is also still the 0030 default of 3, proving
-- 0037's UPDATE never landed for this row — likely it was toggled
-- off manually, or this DB predates 0037).
--
-- Consequence: kitchen sales of ماء كبير do NOT decrement
-- catalog_items.stock_quantity (pushItemSale gates the decrement on
-- track_stock), and the daily report shows no opening/current stock
-- for it. Every other tracked kitchen drink (ماء صغير, BCAA,
-- Pre-workout, مشروب طاقة) is already correct.
--
-- This converges ماء كبير to the same state as 0037 intended.
-- Idempotent: re-applying is a no-op.
-- ============================================================

UPDATE public.catalog_items
   SET track_stock         = true,
       low_stock_threshold = 5
 WHERE name = 'ماء كبير'
   AND (track_stock = false OR low_stock_threshold <> 5);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   UPDATE public.catalog_items
--      SET track_stock         = false,
--          low_stock_threshold = 3
--    WHERE name = 'ماء كبير';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
