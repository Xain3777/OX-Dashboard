-- ============================================================
-- OX GYM — schema fixes for code/DB alignment
--   • products.category constraint → match code categories
--   • food_items.price_usd backfill from price_syp
--   • payment_method on subscriptions + sales
--   • created_by_name on inbody_sessions + sales (for UI display)
-- ============================================================

-- ── 1. products category CHECK ────────────────────────────────
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_category_check
  CHECK (category IN (
    'protein','mass_gainer','creatine','amino',
    'pre_workout','fat_burner','health','focus','other'
  ));

-- ── 2. food_items price_usd backfill ─────────────────────────
-- price_usd was added in 0010 with DEFAULT 0; seed rows only have price_syp.
-- Use 13200 as baseline rate (same as app default).
UPDATE public.food_items
   SET price_usd = ROUND((price_syp / 13200.0)::numeric, 4)
 WHERE price_usd = 0 AND price_syp > 0;

-- ── 3. payment_method on subscriptions ───────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));

-- ── 4. payment_method on sales ───────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));

-- ── 5. created_by_name on inbody_sessions ────────────────────
ALTER TABLE public.inbody_sessions
  ADD COLUMN IF NOT EXISTS created_by_name text;

-- ── 6. created_by_name on sales ──────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS created_by_name text;
