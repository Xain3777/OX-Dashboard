-- ============================================================
-- 0051 — subscription renewals
--
-- Renewing keeps the same member_id but inserts a brand-new
-- subscription row (so the cash-session bucketing, daily/monthly
-- revenue totals, and audit chain stay clean). The OLD row gets
-- status='renewed' and a back-link to the new row.
--
-- Reverting a renewal = cancel the new row + flip the old row back
-- to 'expired'.
-- ============================================================

-- 1. Extend the status check constraint to allow 'renewed'.
--    (Existing values: active / expired / frozen / cancelled.)
alter table public.gym_subscriptions
  drop constraint if exists gym_subscriptions_status_check;

alter table public.gym_subscriptions
  add constraint gym_subscriptions_status_check
  check (status in ('active','expired','frozen','cancelled','renewed'));

-- 2. Self-FK from the old (renewed) row to the new (renewal) row.
--    Nullable — only set on rows that were renewed.
alter table public.gym_subscriptions
  add column if not exists renewed_to_subscription_id uuid
    references public.gym_subscriptions(id) on delete set null;

create index if not exists gym_subscriptions_renewed_to_idx
  on public.gym_subscriptions (renewed_to_subscription_id);

NOTIFY pgrst, 'reload schema';
