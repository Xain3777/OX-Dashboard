-- ============================================================
-- 0073 — snapshot cost-of-goods on item_sales at sale time
--
-- Why
-- ---
-- Profit ("الربح") is computed as sell − cost, but item_sales never stored
-- the item's cost — every profit reader (ProfitReportBlock, the manager
-- goodsProfit KPI, the daily inventory reconciliation) joins back to the
-- CURRENT catalog_items.cost_price. Three failure modes, all of which
-- overstate profit to the FULL sale price (e.g. protein pack bought for
-- $40, sold for $50 → "profit $50" instead of $10):
--   1. cost_price never entered → cost counts as 0.
--   2. Item deleted from the catalog → the join finds nothing → cost 0,
--      permanently, for every historical sale of that item.
--   3. cost_price edited later → all historical profit silently rewrites.
--
-- Fix: store the cost (price + currency) on the sale row at write time.
-- The frontend (lib/supabase/intake.ts pushItemSale) fills it for new
-- sales; this migration backfills existing rows from today's catalog —
-- the same assumption the read side already made, so reports don't move.
-- Read paths prefer the snapshot and fall back to the live catalog when
-- the snapshot is NULL, so entering a missing cost later still fixes
-- old rows of that item.
--
-- Idempotent. Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

alter table public.item_sales
  add column if not exists cost_price_snapshot    numeric(12,2),
  add column if not exists cost_currency_snapshot text;

do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'item_sales_cost_currency_snapshot_check'
  ) then
    alter table public.item_sales
      add constraint item_sales_cost_currency_snapshot_check
      check (cost_currency_snapshot is null or cost_currency_snapshot in ('syp','usd'));
  end if;
end $$;

-- Backfill from the current catalog, only where a cost is actually known.
-- Rows whose item has no cost stay NULL so a later-entered cost still
-- applies to them through the read-side fallback.
update public.item_sales s
   set cost_price_snapshot    = c.cost_price,
       cost_currency_snapshot = coalesce(c.cost_currency, c.sell_currency, 'usd')
  from public.catalog_items c
 where s.catalog_item_id = c.id
   and s.cost_price_snapshot is null
   and c.cost_price is not null;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   ALTER TABLE public.item_sales
--     DROP CONSTRAINT IF EXISTS item_sales_cost_currency_snapshot_check,
--     DROP COLUMN IF EXISTS cost_currency_snapshot,
--     DROP COLUMN IF EXISTS cost_price_snapshot;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
