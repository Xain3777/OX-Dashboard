-- ============================================================
-- 0057 — Add the 4 missing members to يوسف's group (fixes 0056 §C)
--
-- 0056 §C inserted nothing because its `cross join lateral` resolved to
-- zero rows. This version hardcodes the 4 names and pulls the shared
-- fields (created_by, exchange_rate, amount_syp share) from يوسف's existing
-- group row via scalar subqueries, so it can't be silently zeroed out.
--
-- Each new member: $28, one month (2026-05-09 → 2026-06-08), already paid.
-- Idempotent: skips any name that already has a live row in the group.
-- Run AFTER 0056 §A (which set يوسف's row to $28).
-- ============================================================

insert into public.gym_subscriptions
  (member_name, plan_type, offer, start_date, end_date,
   amount, paid_amount, payment_status, currency, exchange_rate, status,
   group_id, amount_syp, created_by, cash_session_id)
select v.nm, '1_month', 'referral_4', date '2026-05-09', date '2026-06-08',
       28, 28, 'paid', 'usd',
       (select exchange_rate from public.gym_subscriptions
         where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
           and cancelled_at is null limit 1),
       'expired',
       '5f0672ce-b13e-4a5e-8126-57516599bb32',
       (select amount_syp from public.gym_subscriptions
         where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
           and cancelled_at is null limit 1),
       (select created_by from public.gym_subscriptions
         where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
           and cancelled_at is null limit 1),
       (select cash_session_id from public.gym_subscriptions
         where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
           and cancelled_at is null limit 1)
from (values
  ('أحمد فواز حذاوي'),
  ('بشار محمد دريس'),
  ('جعفر أسامة الكنج'),
  ('نضال مفيد مناع')
) as v(nm)
where not exists (
  select 1 from public.gym_subscriptions s
  where s.member_name = v.nm
    and s.group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
    and s.cancelled_at is null
)
returning member_name, amount, paid_amount, start_date, end_date, status;

NOTIFY pgrst, 'reload schema';
