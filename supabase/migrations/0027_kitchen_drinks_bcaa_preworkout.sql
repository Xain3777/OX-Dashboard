-- ============================================================
-- 0027 — add BCAA and Pre-workout to the kitchen menu
--
-- These two drinks are sold from the kitchen station (poured into
-- a cup at the bar). They live as a separate row from the matching
-- products-table SKUs (BCAA Cup / Pre-workout Cup from migration
-- 0021) because food_items powers the receptionist's kitchen UI
-- while products powers the store inventory — different surfaces,
-- different responsibilities.
--
-- Both priced 20,000 SYP, category 'drinks' (alongside ماء صغير /
-- ماء كبير added in 0023). Idempotent INSERTs guard on existing
-- name.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

INSERT INTO public.food_items (name, category, price_syp, sort_order, is_active)
SELECT 'BCAA', 'drinks', 20000, 430, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'BCAA');

INSERT INTO public.food_items (name, category, price_syp, sort_order, is_active)
SELECT 'Pre-workout', 'drinks', 20000, 440, true
WHERE NOT EXISTS (SELECT 1 FROM public.food_items WHERE name = 'Pre-workout');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   DELETE FROM public.food_items WHERE name IN ('BCAA', 'Pre-workout');
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
