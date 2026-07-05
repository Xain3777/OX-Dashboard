-- ============================================================
-- 0068 — per-user cost-price unlock (profiles.can_edit_cost)
--
-- Reception accounts are blocked from writing catalog_items.cost_price /
-- cost_currency by the BEFORE UPDATE trigger enforce_reception_catalog_columns
-- (migration 0030). This adds a per-user flag so specific reception accounts
-- (e.g. حيدر / haidar) can edit cost prices WITHOUT becoming full managers,
-- and relaxes the trigger to honor it — for the cost columns only.
--
-- The frontend mirror is lib/staff-accounts.ts (canEditCost) → auth-context,
-- which shows the "أسعار التكلفة" editor to flagged users.
--
-- Idempotent. Depends on 0001 (profiles) and 0030 (catalog trigger).
-- ============================================================

-- ── 1. flag column ────────────────────────────────────────────
alter table public.profiles
  add column if not exists can_edit_cost boolean not null default false;

-- ── 2. grant it to the haidar account (by auth email) ─────────
-- Runs with elevated access in the SQL editor, so it can read auth.users.
update public.profiles p
   set can_edit_cost = true
  from auth.users u
 where u.id = p.id
   and u.email = 'haidar@ox.local';

-- ── 3. relax the reception column-gating trigger for cost cols ─
-- Managers and no-JWT contexts still short-circuit. Reception users are still
-- blocked from name/category/type/etc.; cost_price + cost_currency are now
-- permitted ONLY when the caller's profile has can_edit_cost = true.
create or replace function public.enforce_reception_catalog_columns()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_can_edit_cost boolean;
begin
  -- Direct DB access (migrations, service role, dashboard editor): allow.
  if auth.uid() is null then
    return new;
  end if;

  -- Manager: allow any column change.
  if public.current_role() = 'manager' then
    return new;
  end if;

  select coalesce(can_edit_cost, false) into v_can_edit_cost
    from public.profiles where id = auth.uid();

  -- Columns reception can NEVER change (cost handled separately below).
  if  new.name                is distinct from old.name
   or new.category            is distinct from old.category
   or new.item_type           is distinct from old.item_type
   or new.sell_currency       is distinct from old.sell_currency
   or new.track_stock         is distinct from old.track_stock
   or new.is_active           is distinct from old.is_active
   or new.sort_order          is distinct from old.sort_order
   or new.created_by          is distinct from old.created_by
   or new.id                  is distinct from old.id
  then
    raise exception 'reception_locked_column'
      using hint = 'Only sell_price, stock_quantity, low_stock_threshold (+ cost for can_edit_cost users) are editable by reception';
  end if;

  -- Cost columns: allowed only for can_edit_cost users.
  if not coalesce(v_can_edit_cost, false) then
    if  new.cost_currency is distinct from old.cost_currency
     or new.cost_price    is distinct from old.cost_price
    then
      raise exception 'reception_locked_column'
        using hint = 'cost_price / cost_currency require can_edit_cost';
    end if;
  end if;

  return new;
end $$;

-- Trigger definition is unchanged; recreate for safety (idempotent).
drop trigger if exists catalog_items_reception_guard on public.catalog_items;
create trigger catalog_items_reception_guard
  before update on public.catalog_items
  for each row execute function public.enforce_reception_catalog_columns();

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT THIS MIGRATION:
--   -- restore the original trigger body from 0030_catalog_create.sql, then:
--   alter table public.profiles drop column if exists can_edit_cost;
--   notify pgrst, 'reload schema';
-- ============================================================
