-- Widen session_type to support gym_member / non_member visit model
alter table public.inbody_sessions
  drop constraint if exists inbody_sessions_session_type_check;

alter table public.inbody_sessions
  add constraint inbody_sessions_session_type_check
  check (session_type in ('single','package_5','package_10','gym_member','non_member'));
