-- Allow any authenticated user to read or write app_settings.
-- The manager-only restriction caused RLS failures when profiles
-- weren't seeded or when staff roles differed from the policy expectation.
-- Exchange rate is non-sensitive shared state — any logged-in user may update it.
drop policy if exists "settings write" on public.app_settings;
create policy "settings write" on public.app_settings
  for all to authenticated
  using (true) with check (true);
