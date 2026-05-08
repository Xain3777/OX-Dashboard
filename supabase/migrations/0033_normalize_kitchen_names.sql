-- ============================================================
-- 0033 — normalize kitchen catalog names to Arabic per business rule
--
-- Spec rule: prefer Arabic names for meals / water / BCAA / Pre-workout
-- (kitchen-served items) and English names for supplements (which are
-- already in English). On prod the English-named "Small Water",
-- "BCAA Cup", and "Pre-workout Cup" survived from the products-table
-- backfill in migration 0031 — this migration aligns them to the
-- Arabic / canonical naming the receptionists actually expect.
--
-- Dev's catalog already has the Arabic names because food_items
-- (which used Arabic) was the dominant source there. This migration
-- mostly affects prod.
--
-- Idempotent: each UPDATE matches by the OLD name; running again is
-- a no-op once the rows have been renamed.
-- ============================================================

UPDATE public.catalog_items SET name = 'ماء صغير'  WHERE name = 'Small Water';
UPDATE public.catalog_items SET name = 'BCAA'        WHERE name = 'BCAA Cup';
UPDATE public.catalog_items SET name = 'Pre-workout' WHERE name = 'Pre-workout Cup';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   UPDATE public.catalog_items SET name = 'Small Water'    WHERE name = 'ماء صغير';
--   UPDATE public.catalog_items SET name = 'BCAA Cup'        WHERE name = 'BCAA';
--   UPDATE public.catalog_items SET name = 'Pre-workout Cup' WHERE name = 'Pre-workout';
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
