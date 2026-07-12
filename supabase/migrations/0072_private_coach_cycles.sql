-- ============================================================
-- 0072 — private-coach monthly cycles: renew + mid-month player adds
--
-- Why
-- ---
-- The private coach (تدريب خاص) is billed monthly = a fixed base fee +
-- a group tier by total players. Two things were impossible until now:
--   1. Renewing a private coach for the next month.
--   2. Adding a player mid-month and charging ONLY his share (نسبته) on
--      its own, without opening a brand-new subscription.
-- Both need the private_sessions ledger to understand a "cycle" (a month
-- for a coach) and the KIND of each charge.
--
-- New columns on private_sessions
--   • coach_id        — key a charge to a coach roster row (was free-text
--                       private_coach_name only).
--   • charge_type     — 'initial'  = first charge of the month (base + tier)
--                       'addition' = mid-month player add (his share only;
--                                    base = 0)
--                       'renewal'  = new month (base + tier of full roster)
--   • period_start /
--     period_end      — the monthly cycle this charge belongs to.
--   • renewed_from_id — links a renewal back to the prior month's charge,
--                       so a coach's months form a chain.
--
-- Money model is unchanged (base_trainer_fee + group_price + paid_amount);
-- these columns only add structure so the coaches tab can show a cycle and
-- refuse a double-renew. No amounts are touched.
--
-- Idempotent. Apply manually via Supabase Dashboard → SQL Editor.
-- Depends on 0012/0015 (private_sessions), 0021 (private_coach_name),
-- 0022 (paid_amount/payment_status), 0050 (coaches).
-- ============================================================

alter table public.private_sessions
  add column if not exists coach_id        uuid references public.coaches(id),
  add column if not exists charge_type      text not null default 'initial',
  add column if not exists period_start     date,
  add column if not exists period_end       date,
  add column if not exists renewed_from_id  uuid references public.private_sessions(id);

-- charge_type domain
do $$ begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'private_sessions_charge_type_check'
  ) then
    alter table public.private_sessions
      add constraint private_sessions_charge_type_check
      check (charge_type in ('initial','addition','renewal'));
  end if;
end $$;

-- Backfill coach_id from the free-text coach name (active roster match).
update public.private_sessions ps
   set coach_id = c.id
  from public.coaches c
 where ps.coach_id is null
   and ps.private_coach_name is not null
   and lower(btrim(c.name)) = lower(btrim(ps.private_coach_name));

-- Backfill charge_type: rows whose notes mark them as a monthly renew become
-- 'renewal'; everything else is the initial charge of its cycle.
update public.private_sessions
   set charge_type = 'renewal'
 where charge_type = 'initial'
   and coalesce(notes,'') ilike '%تجديد%';

-- Backfill the cycle window from the charge date (a 1-month cycle).
update public.private_sessions
   set period_start = created_at::date,
       period_end   = (created_at::date + interval '1 month')::date
 where period_start is null;

-- Cycle lookups per coach.
create index if not exists private_sessions_coach_period_idx
  on public.private_sessions (coach_id, period_start desc);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   DROP INDEX IF EXISTS public.private_sessions_coach_period_idx;
--   ALTER TABLE public.private_sessions
--     DROP CONSTRAINT IF EXISTS private_sessions_charge_type_check,
--     DROP COLUMN IF EXISTS renewed_from_id,
--     DROP COLUMN IF EXISTS period_end,
--     DROP COLUMN IF EXISTS period_start,
--     DROP COLUMN IF EXISTS charge_type,
--     DROP COLUMN IF EXISTS coach_id;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
