-- ============================================================
-- 0019 — phone column on gym_subscriptions + RLS UPDATE policies
--
-- 1. Adds optional `phone` to gym_subscriptions so each subscription
--    captures the member's contact number directly (also stored on
--    public.members; this is a snapshot for fast list rendering).
-- 2. Adds an UPDATE policy on gym_subscriptions so the original
--    creator OR a manager can correct after-the-fact mistakes.
-- 3. Adds an UPDATE policy on products so reception can adjust
--    stock and selling price (the UI hides cost/margin from them).
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

ALTER TABLE gym_subscriptions ADD COLUMN IF NOT EXISTS phone text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'gym_subscriptions' AND policyname = 'subscriptions_update') THEN
    CREATE POLICY subscriptions_update ON gym_subscriptions FOR UPDATE
    USING (
      created_by = auth.uid() OR
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'manager')
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'products' AND policyname = 'products_update_authenticated') THEN
    CREATE POLICY products_update_authenticated ON products FOR UPDATE
    USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION ENTIRELY, run:
--
--   DROP POLICY IF EXISTS subscriptions_update ON gym_subscriptions;
--   DROP POLICY IF EXISTS products_update_authenticated ON products;
--   ALTER TABLE gym_subscriptions DROP COLUMN IF EXISTS phone;
--   NOTIFY pgrst, 'reload schema';
--
-- WARNING: dropping the phone column deletes all phone values
-- captured since this migration was applied.
-- ============================================================
