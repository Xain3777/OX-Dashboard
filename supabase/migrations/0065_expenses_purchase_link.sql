-- ============================================================
-- 0065 — expenses: receipt number + purchase invoice link
--
-- Two additive columns on the existing expenses table:
--   • receipt_number      — رقم الإيصال for plain (non-inventory)
--                           expenses such as electricity / water / taxes,
--                           and a convenience mirror of the invoice
--                           number for purchase-backed expense rows.
--   • purchase_invoice_id — set on the ONE expense row the intake layer
--                           writes per purchase invoice (0064). The
--                           manager's plain-expenses list filters these
--                           OUT (they show under the Purchases section);
--                           expense TOTALS and cash reconciliation still
--                           include them, which is the whole point.
--
-- expenses.category has no CHECK constraint (see 0002_finance_hardening),
-- so the new 'inventory_purchase' category value used by the mirrored
-- rows needs no constraint change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No backfill.
-- Depends on 0064 (purchase_invoices) for the FK target.
-- ============================================================

alter table public.expenses
  add column if not exists receipt_number text;

alter table public.expenses
  add column if not exists purchase_invoice_id uuid references public.purchase_invoices(id);

create index if not exists idx_expenses_purchase_invoice
  on public.expenses(purchase_invoice_id) where purchase_invoice_id is not null;

notify pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   drop index if exists public.idx_expenses_purchase_invoice;
--   alter table public.expenses drop column if exists purchase_invoice_id;
--   alter table public.expenses drop column if exists receipt_number;
--   notify pgrst, 'reload schema';
-- ============================================================
