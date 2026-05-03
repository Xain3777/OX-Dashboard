-- ============================================================
-- 0018 — extend group_offers.offer_type constraint to allow
--        group_5 and group_9 offer types
--
-- Reason: the new offer mechanic replaces the bonus-days
-- referral offers with two group-discount offers:
--   group_5 — 5 people pay for 4 (each pays base × 4/5)
--   group_9 — 9 people pay for 7 (each pays base × 7/9)
--
-- Existing rows with offer_type='referral'/'couple'/'corporate'
-- continue to satisfy the new constraint. No data is touched.
--
-- Run in Supabase Dashboard → SQL Editor.
-- ============================================================

-- Drop the old CHECK constraint (if it exists with the legacy name)
alter table if exists public.group_offers
  drop constraint if exists group_offers_offer_type_check;

-- Recreate with the extended set
alter table if exists public.group_offers
  add constraint group_offers_offer_type_check
  check (offer_type in ('referral','couple','corporate','group_5','group_9'));

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION ENTIRELY, run:
--
--   -- (only safe if no rows currently use group_5 or group_9)
--   alter table if exists public.group_offers
--     drop constraint if exists group_offers_offer_type_check;
--   alter table if exists public.group_offers
--     add constraint group_offers_offer_type_check
--     check (offer_type in ('referral','couple','corporate'));
--   notify pgrst, 'reload schema';
--
-- If you've already inserted rows with offer_type='group_5' or
-- 'group_9', delete those first or the constraint will fail to
-- be added back:
--   delete from public.group_offers where offer_type in ('group_5','group_9');
-- ============================================================
