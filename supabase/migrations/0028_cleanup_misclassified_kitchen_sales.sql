-- ============================================================
-- 0028 — clean up kitchen sales rows poisoned by the
-- "exchange_rate=1" bug fixed in commit 2ca314b
--
-- Background
-- ----------
-- Before the kitchen-currency fix, KitchenBlock.tsx passed
-- `exchangeRate: 1` to pushSale, so kitchen sale rows were stored
-- with one of these broken shapes:
--
--   A. currency='syp', exchange_rate=1
--      Read-side conversion does `total / rate` → divides by 1 →
--      treats the raw SYP number as a USD value. A 7,000 SYP item
--      becomes a $7,000 contribution to revenue.
--
--   B. currency='usd', total=<raw SYP>
--      Even older variants stored kitchen sales as USD with the
--      raw SYP amount. Same effect: $7,000 from a single item.
--
-- Both shapes are unrecoverable in-place because we don't know
-- the rate that was active at write-time. The safest fix is to
-- soft-cancel the affected rows so they drop out of every USD
-- aggregation (which all filter `cancelled_at is null`), while
-- preserving them in the audit trail. New kitchen orders written
-- after the fix carry a real exchange_rate and are unaffected.
--
-- Selection criteria — kitchen-source sales that are clearly bugs:
--   • source='kitchen' AND currency='syp' AND exchange_rate <= 1
--     (definite signature of the rate=1 bug)
--   • source='kitchen' AND currency='usd' AND total > 50
--     (no single kitchen line item costs more than ~$1 USD; a
--      $50+ kitchen sale is raw SYP misclassified as USD)
--
-- Already-cancelled rows are skipped. Re-running this migration
-- after a restore is safe — the second pass cancels nothing new.
-- ============================================================

-- 1. Snapshot how many rows we're about to touch, for the log.
do $$
declare
  bug_a_count int;
  bug_b_count int;
begin
  select count(*) into bug_a_count
  from public.sales
  where source = 'kitchen'
    and currency = 'syp'
    and (exchange_rate is null or exchange_rate <= 1)
    and cancelled_at is null;

  select count(*) into bug_b_count
  from public.sales
  where source = 'kitchen'
    and currency = 'usd'
    and total > 50
    and cancelled_at is null;

  raise notice
    '0028 cleanup: % kitchen-syp-rate1 rows, % kitchen-usd-large rows will be cancelled',
    bug_a_count, bug_b_count;
end $$;

-- 2. Cancel the bug-A shape: kitchen + currency='syp' + rate <= 1.
update public.sales
   set cancelled_at     = coalesce(cancelled_at, now()),
       cancelled_reason = coalesce(cancelled_reason,
         'auto-cleanup 0028: kitchen sale stored with exchange_rate <= 1 (pre-fix bug)')
 where source = 'kitchen'
   and currency = 'syp'
   and (exchange_rate is null or exchange_rate <= 1)
   and cancelled_at is null;

-- 3. Cancel the bug-B shape: kitchen + currency='usd' + raw SYP value.
update public.sales
   set cancelled_at     = coalesce(cancelled_at, now()),
       cancelled_reason = coalesce(cancelled_reason,
         'auto-cleanup 0028: kitchen sale stored as currency=usd with raw SYP amount')
 where source = 'kitchen'
   and currency = 'usd'
   and total > 50
   and cancelled_at is null;

-- 4. Activity-feed crumb so the cleanup is visible in the dashboard log.
--    created_by_name is NOT NULL on activity_feed, so we hardcode 'system'.
insert into public.activity_feed (action, description, created_by, created_by_name)
values (
  'sales_cleanup',
  'تنظيف تلقائي: تم إلغاء مبيعات مطبخ مسجّلة بعملة خاطئة قبل إصلاح سعر الصرف',
  null,
  'system'
);

notify pgrst, 'reload schema';
