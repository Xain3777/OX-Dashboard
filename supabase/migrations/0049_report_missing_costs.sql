-- ============================================================
-- 0049 — READ-ONLY report: items missing cost prices
--
-- Run each block in the Supabase SQL editor. No writes. The result
-- of each SELECT is the list of rows where cost is NULL (or 0),
-- broken down by table. Fill them in via the manager dashboard's
-- inventory editors.
--
-- Do NOT mark this migration as applied — re-running is harmless.
-- ============================================================

-- 1. Store products with no cost
SELECT 'products'                AS source,
       id,
       name,
       category,
       price,
       cost,
       stock,
       created_at
  FROM public.products
 WHERE cost IS NULL OR cost = 0
 ORDER BY category, name;

-- 2. Catalog items (kitchen / water / drinks / supplements sold via
--    kitchen UI) with no cost in either currency
SELECT 'catalog_items'            AS source,
       id,
       name,
       category,
       item_type,
       sell_currency,
       sell_price,
       cost_currency,
       cost_price,
       stock_quantity,
       is_active
  FROM public.catalog_items
 WHERE is_active = true
   AND (cost_price IS NULL OR cost_price = 0)
 ORDER BY item_type, category, sort_order, name;

-- 3. Legacy food_items rows (kept until catalog cutover completes)
--    where neither cost column is populated
SELECT 'food_items'               AS source,
       id,
       name,
       category,
       price_syp,
       cost_syp,
       cost_usd,
       is_active
  FROM public.food_items
 WHERE is_active = true
   AND (cost_syp IS NULL OR cost_syp = 0)
   AND (cost_usd IS NULL OR cost_usd = 0)
 ORDER BY category, sort_order NULLS LAST, name;
