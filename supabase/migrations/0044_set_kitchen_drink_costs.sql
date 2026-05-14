-- ============================================================
-- 0044 — set SYP cost prices for the four kitchen bar items
--
-- These rows came in from food_items (0031) without a cost_price.
-- Manager-provided purchase costs (per unit, SYP):
--   ماء كبير    → 4875 SYP
--   ماء صغير    → 2437 SYP
--   BCAA        → 15000 SYP
--   Pre-workout → 15000 SYP
--
-- cost_currency forced to 'syp' so the accountability audit
-- (0041) and any UI cost displays don't reinterpret these as USD.
-- sell_price is untouched — this only fills in the cost basis.
--
-- Idempotent: re-applying converges to the same state.
-- ============================================================

UPDATE public.catalog_items
   SET cost_price    = 4875,
       cost_currency = 'syp'
 WHERE name = 'ماء كبير';

UPDATE public.catalog_items
   SET cost_price    = 2437,
       cost_currency = 'syp'
 WHERE name = 'ماء صغير';

UPDATE public.catalog_items
   SET cost_price    = 15000,
       cost_currency = 'syp'
 WHERE name = 'BCAA';

UPDATE public.catalog_items
   SET cost_price    = 15000,
       cost_currency = 'syp'
 WHERE name = 'Pre-workout';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   UPDATE public.catalog_items
--      SET cost_price = NULL, cost_currency = NULL
--    WHERE name IN ('ماء كبير', 'ماء صغير', 'BCAA', 'Pre-workout');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
