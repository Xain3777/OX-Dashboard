-- ============================================================
-- 0059 — backfill missing coach_trainees for private sessions
--
-- Why: when reception saves a "تدريب خاص" (private training) entry, the
-- app writes the private_sessions revenue row first, then registers the
-- players into coach_trainees in a SECOND, non-fatal call. If that second
-- call failed (RLS hiccup, network, or it simply predates the roster
-- feature in 0052), the money landed but the players never showed up in
-- the coaches roster. This recreates one coach_trainees row per player
-- from the private_sessions row's own data.
--
-- Scope / safety:
--   • Only pure private training: private_sessions.group_id IS NULL.
--     (coach-private sessions share a group_id with a subscription and
--      link their roster via subscription_id — handled separately, never
--      double-insert here.)
--   • Only sessions that currently have NO trainee linked by
--     private_session_id — so this is idempotent and safe to re-run.
--   • Skips cancelled sessions and empty player names.
--
-- Amount (informational only — never summed for cash reconciliation):
--   per-player share = total_price / (count of non-empty player names),
--   matching how the app splits it at write time. amount_syp uses the
--   session's frozen exchange_rate.
-- ============================================================

with src as (
  select
    ps.id,
    ps.player_names,
    coalesce(nullif(btrim(ps.private_coach_name), ''), 'غير محدد') as coach_name,
    ps.private_coach_name,
    ps.total_price,
    ps.exchange_rate,
    ps.created_at,
    ps.created_by,
    ps.created_by_name,
    (select count(*) from unnest(ps.player_names) p where btrim(p) <> '') as valid_players
  from public.private_sessions ps
  where ps.cancelled_at is null
    and ps.group_id is null                       -- pure private training only
    and ps.player_names is not null
    and exists (select 1 from unnest(ps.player_names) p where btrim(p) <> '')
    and not exists (
      select 1 from public.coach_trainees ct where ct.private_session_id = ps.id
    )
)
insert into public.coach_trainees
  (coach_id, coach_name, name, phone, source, private_session_id,
   amount, amount_syp, is_active, created_at, created_by, created_by_name)
select
  c.id,                                            -- resolved coach when the name matches, else NULL
  src.coach_name,
  btrim(p.player),
  '',                                              -- phone unknown on the session row
  'private',
  src.id,
  round(src.total_price / nullif(src.valid_players, 0), 2),
  case when coalesce(src.exchange_rate, 0) > 0
       then round((src.total_price / nullif(src.valid_players, 0)) * src.exchange_rate)
       else null end,
  true,
  src.created_at,                                  -- preserve the session's real date, not now()
  pr.id,                                           -- only set created_by when it's a real profile (FK-safe)
  src.created_by_name
from src
cross join lateral unnest(src.player_names) as p(player)
left join public.coaches  c  on lower(btrim(c.name)) = lower(src.coach_name)
left join public.profiles pr on pr.id = src.created_by
where btrim(p.player) <> '';

NOTIFY pgrst, 'reload schema';
