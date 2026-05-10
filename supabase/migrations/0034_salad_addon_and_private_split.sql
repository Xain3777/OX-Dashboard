-- ============================================================
-- 0034 — salad kitchen add-on + private-coach split support
--
-- Salad is now a sellable meal add-on:
--   sell: 12,000 SYP
--   cost:  8,000 SYP
--
-- The private-coach split uses existing private_sessions columns:
--   base_trainer_fee = coach share
--   group_price      = gym share
-- ============================================================

UPDATE public.food_items
   SET price_syp  = 12000,
       cost_syp   = 8000,
       category   = 'meals',
       sort_order = 300,
       is_active  = true
 WHERE name = 'سلطة';

INSERT INTO public.food_items (name, category, price_syp, cost_syp, sort_order, is_active)
SELECT 'سلطة', 'meals', 12000, 8000, 300, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'سلطة');

UPDATE public.catalog_items
   SET category      = 'meals',
       item_type     = 'meal',
       sell_currency = 'syp',
       sell_price    = 12000,
       cost_currency = 'syp',
       cost_price    = 8000,
       track_stock   = false,
       is_active     = true,
       sort_order    = 300
 WHERE name = 'سلطة';

INSERT INTO public.catalog_items (
  id, name, category, item_type,
  sell_currency, sell_price,
  cost_currency, cost_price,
  stock_quantity, track_stock,
  low_stock_threshold, sort_order,
  is_active, created_by, created_at
)
SELECT
  fi.id, fi.name, 'meals', 'meal',
  'syp', 12000,
  'syp', 8000,
  0, false,
  3, 300,
  true, fi.created_by, fi.created_at
FROM public.food_items fi
WHERE fi.name = 'سلطة'
  AND NOT EXISTS (
    SELECT 1 FROM public.catalog_items c
    WHERE c.id = fi.id OR c.name = 'سلطة'
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   UPDATE public.food_items
--      SET price_syp = 0, cost_syp = 4000, is_active = false
--    WHERE name = 'سلطة';
--   UPDATE public.catalog_items
--      SET sell_price = 0, cost_price = 4000, is_active = false
--    WHERE name = 'سلطة';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
