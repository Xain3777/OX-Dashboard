-- ============================================================
-- 0023 — food_items cost tracking + meals catalog corrections
--
-- Adds cost / metadata columns to food_items so the manager UI can
-- show profit per item without hardcoding USD↔SYP conversion in code.
-- The live exchange rate (app_settings.exchange_rate_usd_syp) is used
-- by the UI to render USD costs at the current rate.
--
-- Schema additions:
--   • food_items.cost_syp     numeric(12,2) NULL
--   • food_items.cost_usd     numeric(10,4) NULL
--   • food_items.sort_order   integer NOT NULL DEFAULT 0
--   • food_items.description  text NULL
--   • food_items.metadata     jsonb NOT NULL DEFAULT '{}'::jsonb
--
-- Catalog corrections:
--   • وجبة 300غ price_syp 44000 → 42000
--   • Costs backfilled for portion-based meals + add-ons
--   • New row: سلطة (price blank, cost 4000)
--   • Drinks (ماء صغير / ماء كبير) repriced and recategorized to
--     'drinks' (were 'food' from the 0003 generic seed).
--   • products: Shaker — cost/price currencies were inverted in
--     0021. Flip to cost_usd=2 / price_syp=60000.
--   • products: Towel — new accessory (cost 1.5 USD, price 40k SYP).
--
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS, every INSERT
-- guards on existing rows, every UPDATE matches by name. Apply
-- manually via Supabase Dashboard → SQL Editor.
-- ============================================================

-- ── 1. food_items: new columns ─────────────────────────────────
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

-- ── 2. Main meals: correct وجبة 300غ price + backfill costs ────
UPDATE public.food_items
   SET price_syp   = 29000,
       cost_syp    = 19000,
       category    = 'meals',
       description = 'رز 250غ + جاج 150غ + سلطة',
       sort_order  = 10
 WHERE name = 'وجبة 150غ';

UPDATE public.food_items
   SET price_syp   = 34000,
       cost_syp    = 23800,
       category    = 'meals',
       description = 'رز 300غ + جاج 200غ + سلطة',
       sort_order  = 20
 WHERE name = 'وجبة 200غ';

UPDATE public.food_items
   SET price_syp   = 38000,
       cost_syp    = 26225,
       category    = 'meals',
       description = 'رز 300غ + جاج 250غ + سلطة',
       sort_order  = 30
 WHERE name = 'وجبة 250غ';

UPDATE public.food_items
   SET price_syp   = 42000,
       cost_syp    = 29050,
       category    = 'meals',
       description = 'رز 300غ + جاج 300غ + سلطة',
       sort_order  = 40
 WHERE name = 'وجبة 300غ';

-- ── 3. Add-ons: rice / chicken / salad ─────────────────────────
UPDATE public.food_items
   SET price_syp  = 10000,
       cost_syp   = NULL,
       category   = 'meals',
       sort_order = 110
 WHERE name = 'رز 200غ';

UPDATE public.food_items
   SET price_syp  = 15000,
       cost_syp   = 8100,
       category   = 'meals',
       sort_order = 120
 WHERE name = 'رز 300غ';

UPDATE public.food_items
   SET price_syp  = 20000,
       cost_syp   = 8500,
       category   = 'meals',
       sort_order = 210
 WHERE name = 'إضافة جاج 150غ';

UPDATE public.food_items
   SET price_syp  = 25000,
       cost_syp   = 11300,
       category   = 'meals',
       sort_order = 220
 WHERE name = 'إضافة جاج 200غ';

UPDATE public.food_items
   SET price_syp  = 30000,
       cost_syp   = 14125,
       category   = 'meals',
       sort_order = 230
 WHERE name = 'إضافة جاج 250غ';

UPDATE public.food_items
   SET price_syp  = 35000,
       cost_syp   = 16950,
       category   = 'meals',
       sort_order = 240
 WHERE name = 'إضافة جاج 300غ';

-- سلطة as a stand-alone add-on. Selling price intentionally 0 so
-- the manager fills it in from the dashboard before reception sells
-- it (zero-price items are still hidden from kitchen reception when
-- price_syp = 0 — handled in the UI, not at the DB layer).
INSERT INTO public.food_items (name, category, price_syp, cost_syp, sort_order, is_active)
SELECT 'سلطة', 'meals', 0, 4000, 300, false
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'سلطة');

-- ── 4. Drinks ──────────────────────────────────────────────────
-- Existing 0003 seed put these in category='food' with placeholder
-- prices. Update prices/costs and move to 'drinks'.
UPDATE public.food_items
   SET price_syp  = 5000,
       cost_syp   = 2437,
       category   = 'drinks',
       sort_order = 410
 WHERE name = 'ماء صغير';

UPDATE public.food_items
   SET price_syp  = 7000,
       cost_syp   = 4875,
       category   = 'drinks',
       sort_order = 420
 WHERE name = 'ماء كبير';

-- ── 5. products: fix Shaker direction + add Towel ──────────────
-- 0021 inserted Shaker as cost=60000 SYP / price=2 USD (inverted by
-- mistake). Correct to cost=2 USD / price=60000 SYP so margin %
-- comes out sensibly when the manager edits the exchange rate.
UPDATE public.products
   SET cost           = 2,
       cost_currency  = 'usd',
       price          = 60000,
       price_currency = 'syp'
 WHERE lower(name) = 'shaker';

INSERT INTO public.products (name, category, cost, cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT 'Towel', 'accessory', 1.5, 'usd', 40000, 'syp', 0, 3
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE lower(name) = 'towel');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   ALTER TABLE public.food_items DROP COLUMN IF EXISTS metadata;
--   ALTER TABLE public.food_items DROP COLUMN IF EXISTS description;
--   ALTER TABLE public.food_items DROP COLUMN IF EXISTS sort_order;
--   ALTER TABLE public.food_items DROP COLUMN IF EXISTS cost_usd;
--   ALTER TABLE public.food_items DROP COLUMN IF EXISTS cost_syp;
--   UPDATE public.food_items SET price_syp = 44000 WHERE name = 'وجبة 300غ';
--   UPDATE public.food_items SET category = 'food' WHERE name IN ('ماء صغير','ماء كبير');
--   DELETE FROM public.food_items WHERE name = 'سلطة';
--   UPDATE public.products
--      SET cost = 60000, cost_currency = 'syp', price = 2, price_currency = 'usd'
--    WHERE lower(name) = 'shaker';
--   DELETE FROM public.products WHERE lower(name) = 'towel';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
