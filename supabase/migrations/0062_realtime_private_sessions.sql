-- ============================================================
-- 0062 — add private_sessions to the realtime publication
--
-- Bug: the live KPI hook (useLiveKPI → REALTIME_TABLES in
-- lib/supabase/dashboard.ts) subscribes to `private_sessions` changes
-- to refresh "إيرادات اليوم / الشهرية" the moment a private/coach
-- session is saved. But `private_sessions` was never added to the
-- `supabase_realtime` publication, so Postgres never broadcasts its
-- INSERT/UPDATE/DELETE events. Effect: a pure "تدريب خاص" session's
-- cash did NOT appear in the live total until an unrelated event (or a
-- page reload) forced a refetch. (Coach-private masked this because it
-- also writes a gym_subscriptions row, which IS published.)
--
-- The money itself was always recorded and is summed into the totals
-- on any refetch — this only fixes the LIVE refresh.
--
-- Apply manually via Supabase Dashboard → SQL Editor. Idempotent.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_sessions'
  ) then
    alter publication supabase_realtime add table public.private_sessions;
  end if;
end $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.private_sessions;
-- ============================================================
