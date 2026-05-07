-- ============================================================
-- 0029 — loosen RLS for cross-staff edits + cancellations
--
-- Replaces the never-applied local file 0027_rls_cross_staff_edits.sql
-- (renamed to a non-colliding number — there are two local 0027_*.sql
-- files, and live DB confirmed in audit pass that this one was never
-- applied).
--
-- Background
-- ----------
-- Until now, the update policies on sales / gym_subscriptions /
-- inbody_sessions were:
--     using (created_by = auth.uid() or public.current_role() = 'manager')
-- After the b647adc move to 5 named/shift accounts, every shift handover
-- left the next cashier unable to fix the previous shift's mistakes
-- without escalating to a manager. The frontend surfaces this as the
-- misleading message "لم يتم تحديث الصف — تحقق من صلاحيات RLS" and
-- "Cannot coerce the result to a single JSON object" because the UPDATE
-- returns 0 rows.
--
-- This migration relaxes UPDATE so any signed-in user (reception or
-- manager) can edit or cancel any row on these three tables. INSERT
-- policies are unchanged: created_by = auth.uid() is still enforced
-- on writes, so the audit trail of who created the original row is
-- preserved. cancelled_by / cancelled_reason on the row continue to
-- record who cancelled it.
--
-- Idempotent: drops policies before recreating them, so re-running is
-- safe.
-- ============================================================

drop policy if exists "subs update"   on public.gym_subscriptions;
drop policy if exists "sales update"  on public.sales;
drop policy if exists "inbody update" on public.inbody_sessions;

create policy "subs update"   on public.gym_subscriptions for update to authenticated
  using (true)
  with check (true);

create policy "sales update"  on public.sales             for update to authenticated
  using (true)
  with check (true);

create policy "inbody update" on public.inbody_sessions   for update to authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';
