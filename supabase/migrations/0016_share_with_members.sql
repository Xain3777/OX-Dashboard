-- ============================================================================
-- 0016 — Shared-database canonicalization
--
-- Idempotent. Safe to re-run. Applies on top of this repo's 0001..0015 PLUS
-- the sister-app (ox-gym-app) RESET_AND_SEED.sql / migration 013_clean_reset.
-- The two apps share one Supabase project per the user's deployment intent.
--
-- Goals:
--   1. Make `current_user_role()` return a role for staff in EITHER source —
--      sister-app's public.members (auth_id) or this repo's public.profiles
--      (id). Both apps' RLS uses this RPC.
--   2. Keep `current_role()` (the dashboard's existing function name) as a
--      passthrough alias so existing RLS policies in 0001/0002 don't have to
--      be rewritten.
--   3. Expose the dashboard's subscriptions to the player portal via the
--      `member_subscriptions` VIEW that matches sister-app's enum shape.
--   4. Drop the orphaned SYP cash-session columns whose canonical USD
--      replacements landed in 0010/0014. Code paths that read them are
--      fixed in this same release.
--
-- Apply via Supabase Dashboard → SQL Editor → New query.
-- ============================================================================

-- ── 1. current_user_role() — accepts both staff sources ─────────────────────
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role::text FROM public.members  WHERE auth_id = auth.uid() LIMIT 1),
    (SELECT role        FROM public.profiles WHERE id      = auth.uid() LIMIT 1)
  );
$$;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated;

-- ── 2. current_role() — back-compat alias ───────────────────────────────────
-- The dashboard's RLS policies in 0001/0002 reference `public.current_role()`.
-- Re-define it as a passthrough so both function names resolve to the same
-- canonical lookup.
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.current_user_role();
$$;
GRANT EXECUTE ON FUNCTION public.current_role() TO anon, authenticated;

-- ── 3. member_subscriptions view ────────────────────────────────────────────
-- Lets the player portal read this dashboard's subscriptions in the shape
-- sister-app expects. Plan_type collapses 1/3/{6,9,12} to monthly/quarterly/
-- annual since sister's enum has only those three. cancelled rows and rows
-- without a member_id are excluded — sister-app's portal only cares about
-- subscriptions that link a real player.
DROP VIEW IF EXISTS public.member_subscriptions;
CREATE VIEW public.member_subscriptions AS
SELECT
  s.id,
  s.member_id,
  CASE
    WHEN s.plan_type = '1_month'  THEN 'monthly'::sub_plan_type
    WHEN s.plan_type = '3_months' THEN 'quarterly'::sub_plan_type
    ELSE                                'annual'::sub_plan_type
  END                              AS plan_type,
  s.start_date,
  s.end_date,
  CASE
    WHEN s.status = 'active'    THEN 'active'::sub_status
    WHEN s.status = 'cancelled' THEN 'cancelled'::sub_status
    ELSE                              'expired'::sub_status
  END                              AS status,
  s.amount                         AS price,
  NULL::text                       AS notes
FROM public.subscriptions s
WHERE s.cancelled_at IS NULL
  AND s.member_id IS NOT NULL;

GRANT SELECT ON public.member_subscriptions TO authenticated;

-- ── 4. Drop legacy SYP cash_sessions columns ────────────────────────────────
-- Replaced by USD columns in 0010 (opening_cash, actual_cash, expected_cash,
-- difference). Components that read the old SYP columns are fixed in this
-- release; running this migration without that fix briefly breaks two
-- alert/report widgets, so keep the order: deploy code → run migration.
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS opening_cash_syp;
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS closing_cash_syp;
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS expected_cash_syp;
ALTER TABLE public.cash_sessions DROP COLUMN IF EXISTS discrepancy_syp;

-- ── 5. Reload PostgREST schema cache ────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
