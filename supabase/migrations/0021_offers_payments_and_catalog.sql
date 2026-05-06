-- ============================================================
-- 0021 — Subscription extras + product/meal catalog updates
--
-- Adds:
--   • gym_subscriptions.private_coach_name  text  (nullable)
--   • gym_subscriptions.note                text  (nullable)
--   • products.cost                         → made nullable
--   • products.cost_currency                text default 'usd'
--   • products.price_currency               text default 'usd'
--   • products.category                     → check extended with
--                                              accessory/drink/water
--   • New product seeds: shaker, BCAA cup, pre-workout cup, waters
--   • New food_items: portion-based meal pricing (full meal / rice
--     / chicken add-on)
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS, every INSERT
-- guards on existing names.
-- ============================================================

-- ── 1. gym_subscriptions: optional coach name + free-form note ──
ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS private_coach_name text;

ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS note text;

-- private_sessions also gains the coach name (the existing
-- private-training form writes into this table).
ALTER TABLE public.private_sessions
  ADD COLUMN IF NOT EXISTS private_coach_name text;

-- ── 2. products: relax cost NOT NULL + add currency snapshots ──
-- Some new SKUs (e.g., the BCAA / pre-workout cups) start without
-- a known cost; reception will fill it in later. The default-0
-- semantics from 0001 made "no cost" indistinguishable from "free
-- to source", so cost is now nullable.
ALTER TABLE public.products
  ALTER COLUMN cost DROP NOT NULL;

ALTER TABLE public.products
  ALTER COLUMN cost DROP DEFAULT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_currency text NOT NULL DEFAULT 'usd';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_currency text NOT NULL DEFAULT 'usd';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'products_cost_currency_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_cost_currency_check
      CHECK (cost_currency IN ('syp','usd'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'products_price_currency_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_price_currency_check
      CHECK (price_currency IN ('syp','usd'));
  END IF;
END $$;

-- ── 3. products.category: extend allowed values ─────────────────
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_category_check
  CHECK (category IN (
    'protein','mass_gainer','creatine','amino',
    'pre_workout','fat_burner','health','focus',
    'accessory','drink','water','other'
  ));

-- ── 4. Seed new products (idempotent on lower(name)) ────────────
-- Shaker:        cost SYP, price USD (intentional asymmetry)
-- BCAA / Pre-workout / waters: cost null, price SYP
INSERT INTO public.products (name, category, cost,  cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT 'Shaker',           'accessory', 60000, 'syp',  2,     'usd', 0, 3
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE lower(name) = 'shaker');

INSERT INTO public.products (name, category, cost, cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT 'BCAA Cup',         'drink',     NULL, 'usd',  20000, 'syp', 0, 3
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE lower(name) = 'bcaa cup');

INSERT INTO public.products (name, category, cost, cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT 'Pre-workout Cup',  'drink',     NULL, 'usd',  20000, 'syp', 0, 3
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE lower(name) = 'pre-workout cup');

INSERT INTO public.products (name, category, cost, cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT 'Small Water',      'water',     NULL, 'usd',   5000, 'syp', 0, 5
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE lower(name) = 'small water');

INSERT INTO public.products (name, category, cost, cost_currency, price, price_currency, stock, low_stock_threshold)
SELECT 'Big Water',        'water',     NULL, 'usd',   7000, 'syp', 0, 5
WHERE NOT EXISTS (SELECT 1 FROM public.products WHERE lower(name) = 'big water');

-- ── 5. Food items: portion-based meal pricing ───────────────────
-- Stored in `food_items` so they appear in the kitchen reception UI
-- alongside existing menu items. Names use Arabic gym shorthand the
-- staff already recognise.
INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'وجبة 150غ', 'meals', 29000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'وجبة 150غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'وجبة 200غ', 'meals', 34000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'وجبة 200غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'وجبة 250غ', 'meals', 38000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'وجبة 250غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'وجبة 300غ', 'meals', 44000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'وجبة 300غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'رز 200غ', 'meals', 10000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'رز 200غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'رز 300غ', 'meals', 15000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'رز 300غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'إضافة جاج 150غ', 'meals', 20000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة جاج 150غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'إضافة جاج 200غ', 'meals', 25000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة جاج 200غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'إضافة جاج 250غ', 'meals', 30000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة جاج 250غ');

INSERT INTO public.food_items (name, category, price_syp, is_active)
SELECT 'إضافة جاج 300غ', 'meals', 35000, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'إضافة جاج 300غ');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION ENTIRELY, run:
--
--   ALTER TABLE public.gym_subscriptions DROP COLUMN IF EXISTS private_coach_name;
--   ALTER TABLE public.gym_subscriptions DROP COLUMN IF EXISTS note;
--   ALTER TABLE public.private_sessions  DROP COLUMN IF EXISTS private_coach_name;
--   ALTER TABLE public.products          DROP CONSTRAINT IF EXISTS products_cost_currency_check;
--   ALTER TABLE public.products          DROP CONSTRAINT IF EXISTS products_price_currency_check;
--   ALTER TABLE public.products          DROP COLUMN IF EXISTS cost_currency;
--   ALTER TABLE public.products          DROP COLUMN IF EXISTS price_currency;
--   ALTER TABLE public.products          DROP CONSTRAINT IF EXISTS products_category_check;
--   ALTER TABLE public.products          ADD CONSTRAINT  products_category_check CHECK (
--     category IN ('protein','mass_gainer','creatine','amino','pre_workout','fat_burner','health','focus','other'));
--   DELETE FROM public.products    WHERE lower(name) IN ('shaker','bcaa cup','pre-workout cup','small water','big water');
--   DELETE FROM public.food_items  WHERE name IN (
--     'وجبة 150غ','وجبة 200غ','وجبة 250غ','وجبة 300غ',
--     'رز 200غ','رز 300غ',
--     'إضافة جاج 150غ','إضافة جاج 200غ','إضافة جاج 250غ','إضافة جاج 300غ'
--   );
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
