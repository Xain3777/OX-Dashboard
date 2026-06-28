-- ============================================================
-- 0054 — Cancel an erroneous 55,000 SYP expense entered today
--
-- The app never hard-deletes money rows; it soft-deletes via
-- cancelled_at (every read filters `cancelled_at is null`, and
-- closeCashSession recomputes expected cash from non-cancelled
-- rows — so cancelling correctly returns the 55k to the till).
--
-- STEP 1 — confirm the target first (run this SELECT alone):
--   select id, description, amount, currency, amount_syp,
--          created_by_name, source, created_at
--   from public.expenses
--   where cancelled_at is null
--     and amount_syp = 55000
--     and (created_at at time zone 'Asia/Damascus')::date
--         = (now() at time zone 'Asia/Damascus')::date;
--
-- STEP 2 — if exactly that one row is the bad expense, run the
-- UPDATE below. RETURNING echoes what was cancelled.
-- ============================================================

update public.expenses e
   set cancelled_at     = now(),
       cancelled_by     = e.created_by,
       cancelled_reason = 'حذف يدوي — مصروف خاطئ (55 ألف ل.س)'
 where e.cancelled_at is null
   and e.amount_syp = 55000
   and (e.created_at at time zone 'Asia/Damascus')::date
       = (now() at time zone 'Asia/Damascus')::date
returning e.id, e.description, e.amount, e.currency, e.amount_syp,
          e.created_by_name, e.created_at;

NOTIFY pgrst, 'reload schema';
