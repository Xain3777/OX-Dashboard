-- ============================================================
-- 0056 — Fix يوسف وليد طراف's group-of-5 offer (group_5 / referral_4)
--
-- Group id: 5f0672ce-b13e-4a5e-8126-57516599bb32
-- The $140 (= 35 × 4) was paid once for all 5 members for ONE month, but:
--   • the membership was given 60 days instead of 30
--   • only يوسف got rows (TWO of them — a duplicate)
--   • the other 4 recorded members were never inserted
--
-- Target end state: 5 members in one group, each $28 (5 × 28 = $140),
-- one month (2026-05-09 → 2026-06-08), $140 already paid.
--
-- Run sections in order A → B → C.
-- ============================================================

-- ── A) Fix يوسف's real group row: split to $28, end at one month ──
update public.gym_subscriptions
   set amount      = 28,
       paid_amount = 28,
       amount_syp  = case when amount > 0 then round(amount_syp * 28.0 / amount, 2) else amount_syp end,
       end_date    = date '2026-06-08',
       status      = 'expired'
 where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
   and cancelled_at is null
returning member_name, amount, paid_amount, start_date, end_date, status;

-- ── B) Cancel the DUPLICATE يوسف row (the one NOT in this group).
--    Required: without this he'd carry $28 + a stray $140 = wrong total.
--    Confirm first if unsure:
--      select id, member_name, amount, start_date, end_date, group_id
--      from public.gym_subscriptions
--      where member_name ilike '%يوسف%طراف%' and cancelled_at is null;
update public.gym_subscriptions
   set cancelled_at     = now(),
       cancelled_reason = 'إلغاء تسجيل مكرر — عرض مجموعة'
 where member_name ilike '%يوسف%طراف%'
   and cancelled_at is null
   and group_id is distinct from '5f0672ce-b13e-4a5e-8126-57516599bb32'
returning member_name, amount, group_id, cancelled_at;

-- ── C) Add the 4 missing members at $28 each (names pulled from the
--       recorded group_offers.members list — no manual transcription).
--       amount_syp is the per-member share of يوسف's frozen rate. ──
insert into public.gym_subscriptions
  (member_name, plan_type, offer, start_date, end_date,
   amount, paid_amount, payment_status, currency, exchange_rate, status,
   group_id, amount_syp, created_by)
select m.nm, '1_month', 'referral_4', date '2026-05-09', date '2026-06-08',
       28, 28, 'paid', 'usd', g.exchange_rate, 'expired',
       '5f0672ce-b13e-4a5e-8126-57516599bb32', g.syp_share, g.created_by
from (
  select jsonb_array_elements(members) ->> 'name' as nm
  from public.group_offers
  where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
) m
cross join lateral (
  select created_by, exchange_rate,
         case when amount > 0 then round(amount_syp * 28.0 / amount, 2) else 0 end as syp_share
  from public.gym_subscriptions
  where group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
    and cancelled_at is null
  limit 1
) g
where not exists (
  select 1 from public.gym_subscriptions s
  where s.group_id = '5f0672ce-b13e-4a5e-8126-57516599bb32'
    and s.member_name = m.nm
    and s.cancelled_at is null
)
returning member_name, offer, amount, start_date, end_date, status;

NOTIFY pgrst, 'reload schema';
