-- ============================================================
-- 0040 — expenses: note + created_by_name + source
--
-- Two new things land on the reception side:
--   1. A "daily expenses" block where reception types a free-form
--      expense (name + amount in SYP or USD + optional note),
--      signed automatically with their display name.
--   2. The manager's expenses tab needs to visually distinguish
--      rows that came from reception vs. ones the manager typed
--      themselves, and label them with the staff member's name +
--      time-of-day (morning / evening / night).
--
-- Schema additions (all nullable so existing rows stay valid):
--   • expenses.note              — free-form text from reception
--   • expenses.created_by_name   — display-name snapshot so the
--                                  manager UI never has to join
--                                  profiles (same pattern as
--                                  sales / inbody_sessions —
--                                  see 0011_fix_schema.sql)
--   • expenses.source            — 'reception_daily' | 'manager'
--                                  Used by the manager UI to
--                                  badge reception-entered rows.
--                                  Defaults to 'manager' for
--                                  legacy rows; the new reception
--                                  intake path explicitly writes
--                                  'reception_daily'.
--
-- RLS: existing "expenses insert" already requires created_by =
-- auth.uid() (see 0002_finance_hardening.sql line 117). No policy
-- changes needed — both manager and reception can already insert.
-- "expenses update" stays restricted to manager (cancel_set or
-- through the cross-staff trigger added later); reception is not
-- allowed to edit/delete other-staff rows but can edit their own
-- via the same created_by clause.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / no data backfill needed.
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_by_name text;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manager'
    CHECK (source IN ('manager', 'reception_daily'));

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS note;
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS created_by_name;
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS source;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
