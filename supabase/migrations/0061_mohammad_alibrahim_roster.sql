-- ============================================================
-- 0061 — put coach محمد الابراهيم in the roster + trainers list
--
-- Today his name only exists as free-typed text on 3 gym_subscriptions
-- rows (the "مع مدربينا" / coach-private flow), in THREE spellings:
--     "محمد ابراهيم", "محمد الابراهيم", "محمد الإبراهيم"
-- with coach_id NULL and no coach_trainees rows — so he never appears
-- in the "المدربون" roster tab.
--
-- This migration:
--   1. Canonicalizes the three spellings to one: 'محمد الابراهيم'.
--   2. Inserts him into the coaches roster (kind='gym'). The 0060
--      trigger auto-assigns his activation_code.
--   3. Links his 3 subscriptions to the roster row (coach_id).
--   4. Adds each subscriber as a trainee under him so they show in
--      the roster tab. Revenue is untouched — it already lives on the
--      gym_subscriptions rows; coach_trainees.amount is informational.
--
-- Idempotent: re-running won't duplicate the coach or the trainees.
-- Run AFTER 0060. Apply manually via Supabase Dashboard → SQL Editor.
-- ============================================================

-- 1. Canonicalize the three spellings --------------------------
update public.gym_subscriptions
set private_coach_name = 'محمد الابراهيم'
where btrim(private_coach_name) in ('محمد ابراهيم', 'محمد الابراهيم', 'محمد الإبراهيم');

-- 2. Ensure the roster coach exists (activation_code via 0060 trigger)
insert into public.coaches (name, kind, is_active)
select 'محمد الابراهيم', 'gym', true
where not exists (
  select 1 from public.coaches
  where lower(btrim(name)) = lower('محمد الابراهيم') and is_active
);

-- 3. Link his subscriptions to the roster coach ----------------
update public.gym_subscriptions s
set coach_id = c.id
from public.coaches c
where lower(btrim(c.name)) = lower('محمد الابراهيم')
  and c.is_active
  and s.private_coach_name = 'محمد الابراهيم'
  and s.coach_id is distinct from c.id;

-- 4. Register each subscriber as a trainee under him -----------
--    (idempotent — skips subscriptions already linked to a trainee)
insert into public.coach_trainees
  (coach_id, coach_name, name, phone, source, subscription_id,
   amount, amount_syp, is_active, created_at, created_by, created_by_name)
select
  s.coach_id,
  'محمد الابراهيم',
  s.member_name,
  coalesce(s.phone, ''),
  'coach_private',
  s.id,
  s.paid_amount,
  s.amount_syp,
  true,
  s.created_at,                 -- preserve the real entry date
  pr.id,                        -- only a real profile (FK-safe), else NULL
  null
from public.gym_subscriptions s
left join public.profiles pr on pr.id = s.created_by
where s.private_coach_name = 'محمد الابراهيم'
  and s.cancelled_at is null
  and not exists (
    select 1 from public.coach_trainees ct where ct.subscription_id = s.id
  );

NOTIFY pgrst, 'reload schema';
