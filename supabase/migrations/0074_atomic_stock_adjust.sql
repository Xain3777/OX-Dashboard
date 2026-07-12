-- ============================================================
-- 0074 — atomic catalog stock adjustment (fixes lost-update race)
--
-- Why
-- ---
-- Selling and cancelling adjust catalog_items.stock_quantity from the
-- frontend as SELECT stock → UPDATE stock = stock − qty (two round-trips).
-- Two concurrent sales of the same item can read the same starting stock
-- and one decrement is silently lost — inventory drifts up over time.
-- The restore-on-cancel path has the same race in the other direction.
--
-- Fix: one SQL statement that adjusts relative to the CURRENT value.
-- SECURITY INVOKER (default) — RLS and the 0030 reception column-gate
-- trigger still apply exactly as they do to the direct UPDATE today.
--
-- The frontend (pushItemSale / cancelTransaction) calls this RPC and
-- falls back to the legacy read-modify-write if the function doesn't
-- exist yet, so deploy order doesn't matter.
--
-- Idempotent. Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

create or replace function public.adjust_catalog_stock(p_item_id uuid, p_delta numeric)
returns boolean
language plpgsql
as $$
declare
  v_adjusted boolean := false;
begin
  update public.catalog_items
     set stock_quantity = greatest(0, coalesce(stock_quantity, 0) + p_delta)
   where id = p_item_id
     and coalesce(track_stock, false)
  returning true into v_adjusted;
  return coalesce(v_adjusted, false);
end;
$$;

revoke all on function public.adjust_catalog_stock(uuid, numeric) from public;
grant execute on function public.adjust_catalog_stock(uuid, numeric) to authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   DROP FUNCTION IF EXISTS public.adjust_catalog_stock(uuid, numeric);
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
