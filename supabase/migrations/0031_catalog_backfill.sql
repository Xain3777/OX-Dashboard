-- ============================================================
-- 0031 — backfill catalog_items + item_sales from legacy tables
--
-- Pure data migration. Reads from food_items / products / sales and
-- writes to catalog_items / item_sales. Legacy tables are NOT touched.
--
-- Defensive against schema drift (audited 2026-05-07):
--   • food_items live schema is the 0001+0010 baseline only. Does NOT
--     have cost_syp, cost_usd, sort_order, description, metadata
--     (migration 0023 was never applied). Defaults apply to those.
--   • products live schema has cost (nullable), cost_currency,
--     price_currency from 0021. is_active not present — assume true.
--   • sales live has every column we need: exchange_rate, amount_syp,
--     cancelled_*, payment_method, created_by_name.
--
-- Sales hygiene from audit:
--   • C1 (uncancelled SYP rows with NULL/<=1 rate)         = 0
--   • C3 (uncancelled kitchen USD rows with total > $50)  = 0
-- → no special soft-cancel pass needed. Reversal rows are skipped.
--
-- Idempotent: each INSERT is guarded by NOT EXISTS on id.
--
-- Dedup strategy for water/BCAA/Pre-workout pairs:
--   1. food_items rows insert first, preserving Arabic names.
--   2. Catalog row prices are then synced from the matching products row
--      (Big Water → 7000 onto ماء كبير, BCAA Cup price onto BCAA, etc.)
--      so kitchen UI keeps its Arabic name AND gets the canonical
--      products-side price/cost.
--   3. products rows insert next, skipping anything whose lower(name)
--      already collides with a catalog_items row (case-insensitive),
--      and skipping the four explicit kitchen-side pairs.
-- ============================================================

-- ── 1. food_items → catalog_items ─────────────────────────────
-- Mapping rules:
--   category   ← keep 'meals' / map 'food' rows by name
--   item_type  ← derive from the name pattern + legacy category
--   sell_currency ← always 'syp' (food_items is SYP-priced by design)
--   sell_price ← price_syp
--   cost_*     ← NULL (live food_items has no cost columns)
--   stock_quantity / track_stock ← 0 / false (kitchen items don't track)
--   sort_order ← 0 (manager re-orders post-migration if desired)
insert into public.catalog_items (
  id, name, category, item_type,
  sell_currency, sell_price,
  cost_currency, cost_price,
  stock_quantity, track_stock,
  low_stock_threshold, sort_order,
  is_active, created_by, created_at
)
select
  fi.id,
  fi.name,
  -- category mapping
  case
    when fi.category = 'meals'                                                 then 'meals'
    when fi.name like 'ماء%'                                                    then 'drinks'
    when fi.name in ('قهوة','شاي','مشروب طاقة','BCAA','Pre-workout')          then 'drinks'
    when fi.name in ('سندويش','سلطة')                                          then 'meals'
    when fi.name like 'وجبة%' or fi.name like 'رز%' or fi.name like 'إضافة%'   then 'meals'
    when fi.category in ('drinks','supplements','accessories','other')         then fi.category
    else 'other'
  end                                                                          as category,
  -- item_type mapping (more specific than category)
  case
    when fi.name like 'ماء%'                                                    then 'water'
    when fi.name in ('قهوة','شاي','مشروب طاقة','BCAA','Pre-workout')          then 'drink'
    when fi.name like 'وجبة%' or fi.name like 'رز%' or fi.name like 'إضافة%'   then 'meal'
    when fi.name in ('سندويش','سلطة')                                          then 'meal'
    when fi.category = 'meals'                                                 then 'meal'
    else 'other'
  end                                                                          as item_type,
  'syp'                                                                        as sell_currency,
  fi.price_syp                                                                 as sell_price,
  null                                                                         as cost_currency,
  null                                                                         as cost_price,
  0                                                                            as stock_quantity,
  false                                                                        as track_stock,
  3                                                                            as low_stock_threshold,
  0                                                                            as sort_order,
  fi.is_active,
  fi.created_by,
  fi.created_at
from public.food_items fi
where not exists (select 1 from public.catalog_items c where c.id = fi.id);

-- ── 2. Sync the four known kitchen↔store pairs ────────────────
-- For each pair where the food_items version exists, copy the products
-- row's price/cost onto the just-inserted catalog row. This way the
-- kitchen UI keeps its Arabic name AND uses the products-side canonical
-- price (e.g., ماء كبير becomes 7000 SYP from Big Water in products,
-- not the stale 4000 SYP currently in food_items).
update public.catalog_items c
set
  sell_price     = p.price,
  cost_currency  = case when p.cost is not null then coalesce(p.cost_currency, 'usd') else c.cost_currency end,
  cost_price     = coalesce(p.cost, c.cost_price)
from public.products p
where (
       (c.name = 'ماء كبير'    and lower(p.name) = 'big water')
    or (c.name = 'ماء صغير'    and lower(p.name) = 'small water')
    or (c.name = 'BCAA'        and lower(p.name) = 'bcaa cup')
    or (c.name = 'Pre-workout' and lower(p.name) = 'pre-workout cup')
);

-- ── 3. products → catalog_items ───────────────────────────────
-- Skip rows that:
--   (a) already exist in catalog_items by id (re-run safety), or
--   (b) match one of the four kitchen-side pairs (food_items version
--       was inserted in step 1 and synced in step 2 — products row is
--       redundant), or
--   (c) collide case-insensitively with an already-present catalog row.
--
-- Mapping rules:
--   category mapping collapses 8 supplement subcategories into 'supplements'.
--     (legacy subcategory is dropped — manager can use the existing item
--     category dropdown to retag if needed; lightweight per spec.)
--   item_type uses the legacy category to differentiate water/drink/
--     accessory/supplement.
--   track_stock = true (products track inventory).
insert into public.catalog_items (
  id, name, category, item_type,
  sell_currency, sell_price,
  cost_currency, cost_price,
  stock_quantity, track_stock,
  low_stock_threshold, sort_order,
  is_active, created_by, created_at
)
select
  p.id,
  p.name,
  case
    when p.category in ('water','drink')                                        then 'drinks'
    when p.category = 'accessory'                                               then 'accessories'
    when p.category in ('protein','mass_gainer','creatine','amino',
                        'pre_workout','fat_burner','health','focus')             then 'supplements'
    when p.category = 'other'                                                   then 'other'
    else 'other'
  end                                                                            as category,
  case
    when p.category = 'water'                                                   then 'water'
    when p.category = 'drink'                                                   then 'drink'
    when p.category = 'accessory'                                               then 'product'
    when p.category in ('protein','mass_gainer','creatine','amino',
                        'pre_workout','fat_burner','health','focus')             then 'supplement'
    else 'other'
  end                                                                            as item_type,
  coalesce(p.price_currency, 'usd')                                              as sell_currency,
  p.price                                                                        as sell_price,
  case when p.cost is not null then coalesce(p.cost_currency, 'usd') else null end as cost_currency,
  p.cost                                                                         as cost_price,
  p.stock                                                                        as stock_quantity,
  true                                                                           as track_stock,
  p.low_stock_threshold                                                          as low_stock_threshold,
  0                                                                              as sort_order,
  true                                                                           as is_active,
  null::uuid                                                                     as created_by,
  p.created_at
from public.products p
where not exists (select 1 from public.catalog_items c where c.id = p.id)
  and not exists (
    select 1 from public.catalog_items c
    where (lower(p.name) = 'big water'        and c.name = 'ماء كبير')
       or (lower(p.name) = 'small water'      and c.name = 'ماء صغير')
       or (lower(p.name) = 'bcaa cup'         and c.name = 'BCAA')
       or (lower(p.name) = 'pre-workout cup'  and c.name = 'Pre-workout')
       or lower(c.name) = lower(p.name)        -- generic case-insensitive dedupe
  );

-- ── 4. sales → item_sales ─────────────────────────────────────
-- For each historic sales row, build an item_sales row.
--
-- catalog_item_id resolution:
--   1. sales.product_id is FK to products.id → catalog_items.id (since
--      we preserved ids during step 3). Use directly when set.
--   2. Otherwise (kitchen rows, where product_id is NULL), look up
--      catalog_items by item name (latest match wins via DISTINCT ON).
--   3. If still unresolved, leave NULL (orphan sale — preserved for
--      audit, just no FK link).
--
-- category_snapshot / item_type_snapshot:
--   Look up from catalog_items via the resolved id. Fall back to the
--   source-implied default ('meals'/'meal' for kitchen, 'supplements'/
--   'supplement' for store) when nothing matches.
--
-- exchange_rate_to_syp:
--   Copy as-is. C1 audit confirmed no uncancelled SYP rows have a NULL
--   or <=1 rate, so the active_syp_rate_required CHECK won't fire.
--
-- Reversal rows (is_reversal = true) are NOT migrated — they're a
-- legacy mechanism the new dashboard reads ignore everywhere
-- (.eq("is_reversal", false) is hardcoded in dashboard.ts). The
-- cancelled_at pattern covers the same audit need.
insert into public.item_sales (
  id, catalog_item_id,
  item_name_snapshot, category_snapshot, item_type_snapshot,
  quantity, unit_price, original_currency, original_total,
  exchange_rate_to_syp,
  source, payment_method, cash_session_id,
  created_by, created_by_name, created_at,
  cancelled_at, cancelled_by, cancelled_reason
)
select
  s.id,
  -- catalog_item_id resolution
  coalesce(
    s.product_id,
    (
      select c.id from public.catalog_items c
      where c.name = s.product_name
      order by c.created_at desc
      limit 1
    )
  )                                                                                   as catalog_item_id,
  s.product_name                                                                      as item_name_snapshot,
  -- category_snapshot
  coalesce(
    (
      select c.category from public.catalog_items c
      where c.id = coalesce(
        s.product_id,
        (select c2.id from public.catalog_items c2 where c2.name = s.product_name
         order by c2.created_at desc limit 1)
      )
    ),
    case when s.source = 'kitchen' then 'meals' else 'supplements' end
  )                                                                                   as category_snapshot,
  -- item_type_snapshot
  coalesce(
    (
      select c.item_type from public.catalog_items c
      where c.id = coalesce(
        s.product_id,
        (select c2.id from public.catalog_items c2 where c2.name = s.product_name
         order by c2.created_at desc limit 1)
      )
    ),
    case when s.source = 'kitchen' then 'meal' else 'supplement' end
  )                                                                                   as item_type_snapshot,
  s.quantity,
  s.unit_price,
  s.currency                                                                          as original_currency,
  s.total                                                                             as original_total,
  s.exchange_rate                                                                     as exchange_rate_to_syp,
  s.source,
  s.payment_method,
  s.cash_session_id,
  s.created_by,
  s.created_by_name,
  s.created_at,
  s.cancelled_at,
  s.cancelled_by,
  s.cancelled_reason
from public.sales s
where s.is_reversal = false
  and not exists (select 1 from public.item_sales i where i.id = s.id);

-- ── 5. Sanity counts (informational) ──────────────────────────
-- The Supabase Dashboard SQL Editor will print these notices in the
-- output panel so you can verify the row counts before doing anything
-- else with the new tables.
do $$
declare
  catalog_count int;
  catalog_meals int;
  catalog_drinks int;
  catalog_supps  int;
  sales_count    int;
  sales_active   int;
begin
  select count(*) into catalog_count from public.catalog_items;
  select count(*) into catalog_meals from public.catalog_items where category = 'meals';
  select count(*) into catalog_drinks from public.catalog_items where category = 'drinks';
  select count(*) into catalog_supps from public.catalog_items where category = 'supplements';
  select count(*) into sales_count from public.item_sales;
  select count(*) into sales_active from public.item_sales where cancelled_at is null;

  raise notice '0031 backfill complete:';
  raise notice '  catalog_items total      = %', catalog_count;
  raise notice '    of which meals         = %', catalog_meals;
  raise notice '    of which drinks        = %', catalog_drinks;
  raise notice '    of which supplements   = %', catalog_supps;
  raise notice '  item_sales total         = %', sales_count;
  raise notice '    of which not cancelled = %', sales_active;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION (data only — schema stays):
--   truncate table public.item_sales;
--   truncate table public.catalog_items;
--   notify pgrst, 'reload schema';
-- ============================================================
