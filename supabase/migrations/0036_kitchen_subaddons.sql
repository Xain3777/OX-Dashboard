-- ============================================================
-- 0036 — kitchen sub-add-ons + meal description tweaks
--
-- Builds on 0035 (kitchen v2). Two changes:
--
--   1. Reword the main meal descriptions to clarify portions are
--      post-cooking weights, and drop the "المكونات:" prefix per the
--      latest spec.
--
--   2. Add three sub-portion add-ons that were previously not in the
--      catalog. price_syp is 0 by design — these are tracked for cost
--      reporting; reception still surfaces them so cashiers can mark
--      them on a meal even when they're free / bundled. The kitchen UI
--      filter no longer requires sellPrice > 0 (see KitchenBlock.tsx).
--
--      • إضافة رز 50غ   — cost 425  SYP, sort 250
--      • إضافة رز 100غ  — cost 850  SYP, sort 260
--      • إضافة دجاج 50غ — cost 3200 SYP, sort 270
--
--   3. Move سلطة forward in the add-on order (300 → 130) so the
--      reception list reads: rice → salad → chicken portions → sub-
--      portions, matching the spec's intended order.
--
-- Idempotent: every UPDATE matches by name; every INSERT guards on
-- existing name. Re-applying the migration is a no-op once rows have
-- landed.
-- ============================================================

-- ── 1. food_items: refresh meal descriptions ─────────────────
UPDATE public.food_items
   SET description = 'رز 250غ بعد الطبخ + دجاج 150غ بعد الطبخ + سلطة'
 WHERE name = 'وجبة 150غ دجاج';

UPDATE public.food_items
   SET description = 'رز 300غ بعد الطبخ + دجاج 200غ بعد الطبخ + سلطة'
 WHERE name = 'وجبة 200غ دجاج';

-- ── 2. food_items: move سلطة forward ─────────────────────────
UPDATE public.food_items
   SET sort_order = 130
 WHERE name = 'سلطة';

-- ── 3. food_items: insert sub-portion add-ons ────────────────
INSERT INTO public.food_items (name, category, price_syp, cost_syp, description, sort_order, is_active)
SELECT 'إضافة رز 50غ', 'meal_addons', 0, 425, '50غ رز بعد الطبخ', 250, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة رز 50غ');

INSERT INTO public.food_items (name, category, price_syp, cost_syp, description, sort_order, is_active)
SELECT 'إضافة رز 100غ', 'meal_addons', 0, 850, '100غ رز بعد الطبخ', 260, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة رز 100غ');

INSERT INTO public.food_items (name, category, price_syp, cost_syp, description, sort_order, is_active)
SELECT 'إضافة دجاج 50غ', 'meal_addons', 0, 3200, '50غ دجاج بعد الطبخ', 270, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة دجاج 50غ');

-- ── 4. catalog_items: mirror description refresh ─────────────
UPDATE public.catalog_items
   SET description = 'رز 250غ بعد الطبخ + دجاج 150غ بعد الطبخ + سلطة'
 WHERE name = 'وجبة 150غ دجاج';

UPDATE public.catalog_items
   SET description = 'رز 300غ بعد الطبخ + دجاج 200غ بعد الطبخ + سلطة'
 WHERE name = 'وجبة 200غ دجاج';

-- ── 5. catalog_items: move سلطة forward ──────────────────────
UPDATE public.catalog_items
   SET sort_order = 130
 WHERE name = 'سلطة';

-- ── 6. catalog_items: insert sub-portion add-ons ─────────────
-- food_items.id ↔ catalog_items.id pairing was set up in 0031 (legacy
-- row import) but new kitchen rows are inserted independently in both
-- tables, with a fresh uuid in each. The KitchenBlock UI reads
-- catalog_items only, so the catalog side is what powers the visible
-- card. Manager-side editing also writes to catalog_items via the
-- legacy bridge in store-context.tsx.
INSERT INTO public.catalog_items (
  name, category, item_type,
  sell_currency, sell_price,
  cost_currency, cost_price,
  stock_quantity, track_stock,
  low_stock_threshold, sort_order,
  is_active, description
)
SELECT 'إضافة رز 50غ', 'meal_addons', 'meal',
       'syp', 0,
       'syp', 425,
       0, false,
       3, 250,
       true, '50غ رز بعد الطبخ'
WHERE NOT EXISTS (SELECT 1 FROM public.catalog_items WHERE name = 'إضافة رز 50غ');

INSERT INTO public.catalog_items (
  name, category, item_type,
  sell_currency, sell_price,
  cost_currency, cost_price,
  stock_quantity, track_stock,
  low_stock_threshold, sort_order,
  is_active, description
)
SELECT 'إضافة رز 100غ', 'meal_addons', 'meal',
       'syp', 0,
       'syp', 850,
       0, false,
       3, 260,
       true, '100غ رز بعد الطبخ'
WHERE NOT EXISTS (SELECT 1 FROM public.catalog_items WHERE name = 'إضافة رز 100غ');

INSERT INTO public.catalog_items (
  name, category, item_type,
  sell_currency, sell_price,
  cost_currency, cost_price,
  stock_quantity, track_stock,
  low_stock_threshold, sort_order,
  is_active, description
)
SELECT 'إضافة دجاج 50غ', 'meal_addons', 'meal',
       'syp', 0,
       'syp', 3200,
       0, false,
       3, 270,
       true, '50غ دجاج بعد الطبخ'
WHERE NOT EXISTS (SELECT 1 FROM public.catalog_items WHERE name = 'إضافة دجاج 50غ');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   DELETE FROM public.catalog_items
--    WHERE name IN ('إضافة رز 50غ','إضافة رز 100غ','إضافة دجاج 50غ');
--   DELETE FROM public.food_items
--    WHERE name IN ('إضافة رز 50غ','إضافة رز 100غ','إضافة دجاج 50غ');
--   UPDATE public.food_items SET sort_order = 300 WHERE name = 'سلطة';
--   UPDATE public.catalog_items SET sort_order = 300 WHERE name = 'سلطة';
--   UPDATE public.food_items
--      SET description = 'المكونات: رز 250غ + دجاج 150غ + سلطة'
--    WHERE name = 'وجبة 150غ دجاج';
--   UPDATE public.food_items
--      SET description = 'المكونات: رز 300غ + دجاج 200غ + سلطة'
--    WHERE name = 'وجبة 200غ دجاج';
--   UPDATE public.catalog_items
--      SET description = 'المكونات: رز 250غ + دجاج 150غ + سلطة'
--    WHERE name = 'وجبة 150غ دجاج';
--   UPDATE public.catalog_items
--      SET description = 'المكونات: رز 300غ + دجاج 200غ + سلطة'
--    WHERE name = 'وجبة 200غ دجاج';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
