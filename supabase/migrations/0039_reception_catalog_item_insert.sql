-- ============================================================
-- 0039 - allow reception to create inventory-safe catalog items
--
-- The store UI already routes "add product" into catalog_items. Migration
-- 0030 kept INSERT manager-only, so receptionist inserts fail with:
-- "new row violates row-level security policy for table catalog_items".
--
-- Managers can still create any catalog item. Reception can create only
-- active, stock-tracked sellable inventory rows with no cost fields.
-- Cost/margin and delete/deactivation remain manager-controlled.
-- ============================================================

DROP POLICY IF EXISTS catalog_items_insert ON public.catalog_items;

CREATE POLICY catalog_items_insert ON public.catalog_items
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.current_role() = 'manager'
      OR (
        cost_currency IS NULL
        AND cost_price IS NULL
        AND is_active = true
        AND track_stock = true
        AND stock_quantity >= 0
        AND low_stock_threshold >= 0
        AND sell_price >= 0
        AND sell_currency IN ('syp', 'usd')
        AND category IN ('meals', 'meal_addons', 'drinks', 'supplements', 'accessories', 'other')
        AND item_type IN ('meal', 'water', 'drink', 'supplement', 'product', 'other')
      )
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   DROP POLICY IF EXISTS catalog_items_insert ON public.catalog_items;
--   CREATE POLICY catalog_items_insert ON public.catalog_items
--     FOR INSERT TO authenticated
--     WITH CHECK (public.current_role() = 'manager');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
