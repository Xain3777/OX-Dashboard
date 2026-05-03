-- ============================================================
-- 0020 — let any authenticated user INSERT into products
--
-- Migration 0019 already opened UPDATE on products to any
-- authenticated user (so reception can adjust selling price /
-- stock). The original 0001 "products write" policy covers ALL
-- operations but is gated on manager role, which blocks reception
-- from creating new inventory rows. This migration adds an
-- INSERT-only policy so reception can add new products from the
-- store block. Cost stays in the schema and remains visible /
-- editable only in the manager dashboard UI.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'products' AND policyname = 'products_insert_authenticated') THEN
    CREATE POLICY products_insert_authenticated ON products FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION, run:
--
--   DROP POLICY IF EXISTS products_insert_authenticated ON products;
--   NOTIFY pgrst, 'reload schema';
--
-- After reverting, only managers can INSERT new products again
-- (via the original "products write" policy from 0001_init.sql).
-- ============================================================
