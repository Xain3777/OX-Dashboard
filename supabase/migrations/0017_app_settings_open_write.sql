-- ============================================================
-- 0017 — open app_settings write to all authenticated staff
--
-- Reason: the daily USD→SYP exchange rate must be editable by
-- reception staff, not just managers. Migration 0002 set the
-- write policy to manager-only, which is why the rate input
-- in the dashboard fails for non-manager users.
--
-- This migration:
--   1. drops the manager-only write policy on app_settings
--   2. recreates it as an open authenticated-write policy
--   3. seeds the exchange-rate row if missing (idempotent)
--   4. reloads PostgREST schema cache
--
-- Run in Supabase Dashboard → SQL Editor.
-- ============================================================

-- 1. Replace manager-only write policy with authenticated-write policy
drop policy if exists "settings write" on public.app_settings;
create policy "settings write" on public.app_settings for all to authenticated
  using (true) with check (true);

-- 2. Seed default exchange rate row if missing (idempotent — does nothing if a row already exists)
insert into public.app_settings (key, value)
values ('exchange_rate_usd_syp', to_jsonb(13200::numeric))
on conflict (key) do nothing;

-- 3. Reload PostgREST schema cache so the change is visible immediately
notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION ENTIRELY, run:
--
--   drop policy if exists "settings write" on public.app_settings;
--   create policy "settings write" on public.app_settings for all to authenticated
--     using (public.current_role() = 'manager') with check (public.current_role() = 'manager');
--   notify pgrst, 'reload schema';
--
-- (The seed row is harmless to leave. To remove it explicitly:)
--   delete from public.app_settings where key = 'exchange_rate_usd_syp';
-- ============================================================
