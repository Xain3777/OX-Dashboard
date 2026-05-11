-- ============================================================
-- 0038 — revert meal descriptions to "المكونات: …" form and
--        deactivate the sub-portion add-ons from 0036
--
-- Two narrow corrections to the kitchen catalog:
--
--   1. Main meal descriptions roll back to the المكونات-prefixed
--      makeup line. 0036 had switched them to a "… بعد الطبخ"
--      phrasing; the canonical wording is the prefixed form again.
--
--   2. The three sub-portion add-ons inserted in 0036
--        • إضافة رز 50غ
--        • إضافة رز 100غ
--        • إضافة دجاج 50غ
--      are removed from the visible menu via is_active = false.
--      Rows stay in food_items / catalog_items so any past
--      item_sales referencing them remain valid; a future migration
--      can re-activate them by flipping the flag back to true.
--
-- Idempotent: re-running converges on the same state.
-- ============================================================

-- ── 1. food_items: revert meal descriptions ──────────────────
UPDATE public.food_items
   SET description = 'المكونات: رز 250غ + دجاج 150غ + سلطة'
 WHERE name = 'وجبة 150غ دجاج';

UPDATE public.food_items
   SET description = 'المكونات: رز 300غ + دجاج 200غ + سلطة'
 WHERE name = 'وجبة 200غ دجاج';

-- ── 2. catalog_items: mirror description revert ──────────────
UPDATE public.catalog_items
   SET description = 'المكونات: رز 250غ + دجاج 150غ + سلطة'
 WHERE name = 'وجبة 150غ دجاج';

UPDATE public.catalog_items
   SET description = 'المكونات: رز 300غ + دجاج 200غ + سلطة'
 WHERE name = 'وجبة 200غ دجاج';

-- ── 3. food_items: deactivate sub-portion add-ons ────────────
UPDATE public.food_items
   SET is_active = false
 WHERE name IN ('إضافة رز 50غ', 'إضافة رز 100غ', 'إضافة دجاج 50غ');

-- ── 4. catalog_items: deactivate sub-portion add-ons ─────────
UPDATE public.catalog_items
   SET is_active = false
 WHERE name IN ('إضافة رز 50غ', 'إضافة رز 100غ', 'إضافة دجاج 50غ');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   UPDATE public.food_items
--      SET description = 'رز 250غ بعد الطبخ + دجاج 150غ بعد الطبخ + سلطة'
--    WHERE name = 'وجبة 150غ دجاج';
--   UPDATE public.food_items
--      SET description = 'رز 300غ بعد الطبخ + دجاج 200غ بعد الطبخ + سلطة'
--    WHERE name = 'وجبة 200غ دجاج';
--   UPDATE public.catalog_items
--      SET description = 'رز 250غ بعد الطبخ + دجاج 150غ بعد الطبخ + سلطة'
--    WHERE name = 'وجبة 150غ دجاج';
--   UPDATE public.catalog_items
--      SET description = 'رز 300غ بعد الطبخ + دجاج 200غ بعد الطبخ + سلطة'
--    WHERE name = 'وجبة 200غ دجاج';
--   UPDATE public.food_items SET is_active = true
--    WHERE name IN ('إضافة رز 50غ','إضافة رز 100غ','إضافة دجاج 50غ');
--   UPDATE public.catalog_items SET is_active = true
--    WHERE name IN ('إضافة رز 50غ','إضافة رز 100غ','إضافة دجاج 50غ');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
