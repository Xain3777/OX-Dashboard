-- ============================================================
-- 0035 — kitchen menu v2: short meal names, meal_addons category,
--        description column on catalog_items
--
-- Reception kitchen UI gets a cleaner three-group layout:
--   1. وجبات رئيسية   → category 'meals'
--   2. إضافات على الوجبة → category 'meal_addons' (NEW value)
--   3. أصناف أخرى     → category 'other'
--
-- Meal cards stop bundling the makeup into the name; the makeup
-- moves into a new `description` column rendered as muted subtext.
--   • وجبة 150غ → renamed to "وجبة 150غ دجاج" (price 38000, cost 29000)
--   • وجبة 200غ → renamed to "وجبة 200غ دجاج" (price 42000, cost 32625)
--   • وجبة 250غ / وجبة 300غ → deactivated (kept for historical sales)
--
-- Idempotent: ALTER TABLE … ADD COLUMN IF NOT EXISTS / IF EXISTS
-- guards on the constraint, UPDATEs match by name. Re-applying is a
-- no-op once rows have been renamed.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

-- ── 0. food_items: backfill columns from 0023 (defensive) ─────
-- Some prod databases never had 0023 applied (the column additions
-- live there). Re-state them here with IF NOT EXISTS so this
-- migration is self-bootstrapping. If 0023 already ran, these are
-- no-ops.
ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS cost_syp    numeric(12,2);

ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS cost_usd    numeric(10,4);

ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0;

ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS metadata    jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 1. catalog_items.description ──────────────────────────────
ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS description text;

-- ── 2. catalog_items.category — add 'meal_addons' ─────────────
-- The original CHECK from 0030 only allowed
-- 'meals','drinks','supplements','accessories','other'. Drop & recreate
-- to widen the enum. Constraint name from 0030 is the default
-- catalog_items_category_check.
ALTER TABLE public.catalog_items
  DROP CONSTRAINT IF EXISTS catalog_items_category_check;

ALTER TABLE public.catalog_items
  ADD CONSTRAINT catalog_items_category_check
  CHECK (category IN ('meals','meal_addons','drinks','supplements','accessories','other'));

-- ── 3. food_items: rename + reprice the two surviving meals ──
UPDATE public.food_items
   SET name        = 'وجبة 150غ دجاج',
       price_syp   = 38000,
       cost_syp    = 29000,
       category    = 'meals',
       description = 'المكونات: رز 250غ + دجاج 150غ + سلطة',
       sort_order  = 10,
       is_active   = true
 WHERE name IN ('وجبة 150غ', 'وجبة 150غ دجاج');

UPDATE public.food_items
   SET name        = 'وجبة 200غ دجاج',
       price_syp   = 42000,
       cost_syp    = 32625,
       category    = 'meals',
       description = 'المكونات: رز 300غ + دجاج 200غ + سلطة',
       sort_order  = 20,
       is_active   = true
 WHERE name IN ('وجبة 200غ', 'وجبة 200غ دجاج');

-- ── 4. food_items: deactivate obsolete bundled meals ──────────
UPDATE public.food_items
   SET is_active = false
 WHERE name IN ('وجبة 250غ', 'وجبة 300غ');

-- ── 5. food_items: meal add-ons → category 'meal_addons' ──────
UPDATE public.food_items SET category = 'meal_addons', sort_order = 110 WHERE name = 'رز 200غ';
UPDATE public.food_items SET category = 'meal_addons', sort_order = 120 WHERE name = 'رز 300غ';
UPDATE public.food_items SET category = 'meal_addons', sort_order = 210 WHERE name = 'إضافة جاج 150غ';
UPDATE public.food_items SET category = 'meal_addons', sort_order = 220 WHERE name = 'إضافة جاج 200غ';
UPDATE public.food_items SET category = 'meal_addons', sort_order = 230 WHERE name = 'إضافة جاج 250غ';
UPDATE public.food_items SET category = 'meal_addons', sort_order = 240 WHERE name = 'إضافة جاج 300غ';
UPDATE public.food_items SET category = 'meal_addons', sort_order = 300 WHERE name = 'سلطة';

-- ── 6. food_items: drinks → category 'other' ──────────────────
UPDATE public.food_items SET category = 'other', sort_order = 410 WHERE name = 'ماء صغير';
UPDATE public.food_items SET category = 'other', sort_order = 420 WHERE name = 'ماء كبير';
UPDATE public.food_items SET category = 'other', sort_order = 415 WHERE name = 'مشروب طاقة';
UPDATE public.food_items SET category = 'other', sort_order = 430 WHERE name = 'BCAA';
UPDATE public.food_items SET category = 'other', sort_order = 440 WHERE name = 'Pre-workout';

-- ── 7. catalog_items: mirror meal renames + descriptions ──────
UPDATE public.catalog_items
   SET name        = 'وجبة 150غ دجاج',
       sell_price  = 38000,
       cost_price  = 29000,
       cost_currency = 'syp',
       category    = 'meals',
       item_type   = 'meal',
       description = 'المكونات: رز 250غ + دجاج 150غ + سلطة',
       sort_order  = 10,
       is_active   = true
 WHERE name IN ('وجبة 150غ', 'وجبة 150غ دجاج');

UPDATE public.catalog_items
   SET name        = 'وجبة 200غ دجاج',
       sell_price  = 42000,
       cost_price  = 32625,
       cost_currency = 'syp',
       category    = 'meals',
       item_type   = 'meal',
       description = 'المكونات: رز 300غ + دجاج 200غ + سلطة',
       sort_order  = 20,
       is_active   = true
 WHERE name IN ('وجبة 200غ', 'وجبة 200غ دجاج');

-- ── 8. catalog_items: deactivate obsolete meals ───────────────
UPDATE public.catalog_items
   SET is_active = false
 WHERE name IN ('وجبة 250غ', 'وجبة 300غ');

-- ── 9. catalog_items: meal add-ons category move ──────────────
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 110 WHERE name = 'رز 200غ';
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 120 WHERE name = 'رز 300غ';
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 210 WHERE name = 'إضافة جاج 150غ';
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 220 WHERE name = 'إضافة جاج 200غ';
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 230 WHERE name = 'إضافة جاج 250غ';
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 240 WHERE name = 'إضافة جاج 300غ';
UPDATE public.catalog_items SET category = 'meal_addons', item_type = 'meal', sort_order = 300 WHERE name = 'سلطة';

-- ── 10. catalog_items: drinks → 'other' ───────────────────────
-- item_type stays 'water'/'drink' so KITCHEN_TYPES filter still catches
-- them; only the grouping category moves.
UPDATE public.catalog_items SET category = 'other', sort_order = 410 WHERE name = 'ماء صغير';
UPDATE public.catalog_items SET category = 'other', sort_order = 420 WHERE name = 'ماء كبير';
UPDATE public.catalog_items SET category = 'other', sort_order = 415 WHERE name = 'مشروب طاقة';
UPDATE public.catalog_items SET category = 'other', sort_order = 430 WHERE name = 'BCAA';
UPDATE public.catalog_items SET category = 'other', sort_order = 440 WHERE name = 'Pre-workout';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   UPDATE public.food_items
--      SET name = 'وجبة 150غ', price_syp = 29000, cost_syp = 19000,
--          description = 'رز 250غ + جاج 150غ + سلطة', sort_order = 10
--    WHERE name = 'وجبة 150غ دجاج';
--   UPDATE public.food_items
--      SET name = 'وجبة 200غ', price_syp = 34000, cost_syp = 23800,
--          description = 'رز 300غ + جاج 200غ + سلطة', sort_order = 20
--    WHERE name = 'وجبة 200غ دجاج';
--   UPDATE public.food_items SET is_active = true
--    WHERE name IN ('وجبة 250غ', 'وجبة 300غ');
--   UPDATE public.food_items SET category = 'meals'
--    WHERE category = 'meal_addons';
--   UPDATE public.food_items SET category = 'drinks'
--    WHERE name IN ('ماء صغير','ماء كبير','مشروب طاقة','BCAA','Pre-workout');
--
--   -- mirror to catalog_items
--   UPDATE public.catalog_items
--      SET name = 'وجبة 150غ', sell_price = 29000, cost_price = 19000,
--          description = 'رز 250غ + جاج 150غ + سلطة', sort_order = 10
--    WHERE name = 'وجبة 150غ دجاج';
--   UPDATE public.catalog_items
--      SET name = 'وجبة 200غ', sell_price = 34000, cost_price = 23800,
--          description = 'رز 300غ + جاج 200غ + سلطة', sort_order = 20
--    WHERE name = 'وجبة 200غ دجاج';
--   UPDATE public.catalog_items SET is_active = true
--    WHERE name IN ('وجبة 250غ', 'وجبة 300غ');
--   UPDATE public.catalog_items SET category = 'meals'
--    WHERE category = 'meal_addons';
--   UPDATE public.catalog_items SET category = 'drinks'
--    WHERE name IN ('ماء صغير','ماء كبير','مشروب طاقة','BCAA','Pre-workout');
--
--   ALTER TABLE public.catalog_items DROP CONSTRAINT catalog_items_category_check;
--   ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_category_check
--     CHECK (category IN ('meals','drinks','supplements','accessories','other'));
--   ALTER TABLE public.catalog_items DROP COLUMN IF EXISTS description;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
