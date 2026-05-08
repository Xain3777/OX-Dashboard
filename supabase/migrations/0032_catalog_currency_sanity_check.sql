-- ============================================================
-- 0032 — catalog_items currency-vs-price sanity check
--
-- Hard prevention at the DB level for the class of bug that polluted
-- prod recently: a catalog row with sell_currency='usd' AND a price
-- in the thousands (a SYP-magnitude value mistakenly flagged as USD).
-- That pattern produced a $7,000 USD water bottle which, when sold,
-- became 93,625,000 SYP in item_sales via the GENERATED amount_syp
-- column — corrupting reconciliation by ~280M SYP across 3 rows.
--
-- Rule: a USD-priced catalog item cannot have sell_price > 200.
--
-- Rationale for the 200 threshold:
--   • Highest legitimate USD item on prod today is YAVA PREMIUM ISO 2kg
--     at $100. 200 is 2× the existing max — comfortable headroom.
--   • Catches every SYP-magnitude misrecord (kitchen items are
--     thousands of SYP, water is 5,000-7,000, meals 10,000-44,000).
--   • If a future high-end item ($300+) ever needs to live here, this
--     constraint can be dropped + recreated with a higher cap. That's
--     a deliberate policy choice rather than a silent failure mode.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- Idempotent: drops the constraint first if it already exists.
-- ============================================================

ALTER TABLE public.catalog_items
  DROP CONSTRAINT IF EXISTS catalog_items_usd_price_sanity;

ALTER TABLE public.catalog_items
  ADD CONSTRAINT catalog_items_usd_price_sanity
  CHECK (NOT (sell_currency = 'usd' AND sell_price > 200));

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   ALTER TABLE public.catalog_items
--     DROP CONSTRAINT IF EXISTS catalog_items_usd_price_sanity;
--   NOTIFY pgrst, 'reload schema';
--
-- TO RAISE THE CAP later (e.g., if a $400 item is added intentionally):
--   ALTER TABLE public.catalog_items
--     DROP CONSTRAINT IF EXISTS catalog_items_usd_price_sanity;
--   ALTER TABLE public.catalog_items
--     ADD CONSTRAINT catalog_items_usd_price_sanity
--     CHECK (NOT (sell_currency = 'usd' AND sell_price > 500));
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
