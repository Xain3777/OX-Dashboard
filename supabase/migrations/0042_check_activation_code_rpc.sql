-- ============================================================
-- 0042 — public.check_activation_code(code) for the sister app
--
-- The member-facing app (sister repo) looks up subscriptions by
-- activation_code. Today it queries gym_subscriptions directly,
-- which means a cancelled or expired subscription still returns a
-- row — the member app sees the old end_date and treats the code
-- as valid. This RPC is the single source of truth for "is this
-- code active right now?".
--
-- Contract:
--   • Returns at most one row — the latest subscription matching
--     the code (by end_date desc, then created_at desc).
--   • is_active = TRUE only when ALL of:
--       cancelled_at IS NULL
--       status = 'active'
--       end_date >= current_date (in DB timezone — Asia/Damascus
--       handling is the sister app's responsibility if it differs)
--   • Returns no row when no subscription has ever had this code.
--   • The sister app should hide member status / dates when
--     is_active = FALSE, or show an "expired / cancelled" UI based
--     on the returned status + cancelled_at fields.
--
-- Security: SECURITY DEFINER so anon / authenticated callers (the
-- member app's anon key) can read past gym_subscriptions RLS. Only
-- the minimal columns needed for the active-check are returned —
-- no payment / cash session / created_by leakage.
--
-- Apply manually via Supabase Dashboard → SQL Editor.
-- Idempotent — uses CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_activation_code(p_code text)
RETURNS TABLE (
  member_id     uuid,
  member_name   text,
  plan_type     text,
  offer         text,
  start_date    date,
  end_date      date,
  status        text,
  cancelled_at  timestamptz,
  is_active     boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    s.member_id,
    s.member_name,
    s.plan_type,
    s.offer,
    s.start_date,
    s.end_date,
    s.status,
    s.cancelled_at,
    (s.cancelled_at IS NULL
       AND s.status = 'active'
       AND s.end_date >= current_date) AS is_active
  FROM public.gym_subscriptions s
  WHERE s.activation_code = upper(btrim(p_code))
  ORDER BY s.end_date DESC NULLS LAST, s.created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.check_activation_code(text) IS
  'Sister-app entry point. Returns the latest subscription row for an activation code with a computed is_active flag (false when cancelled or expired). At most one row.';

-- The sister app authenticates with the anon key on first launch and
-- with authenticated tokens after sign-in. Grant both.
REVOKE ALL ON FUNCTION public.check_activation_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_activation_code(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   DROP FUNCTION IF EXISTS public.check_activation_code(text);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
