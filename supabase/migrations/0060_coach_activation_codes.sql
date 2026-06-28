-- ============================================================
-- 0060 — coach activation codes
--
-- Coaches (the gym's trainers) now get their own activation code so
-- they can activate / sign into the app, mirroring how a member's
-- gym_subscriptions row carries an `activation_code`.
--
-- Format matches the member code: 2 uppercase letters + 6 digits
-- (e.g. "QK482917"). Generated DB-side via a BEFORE INSERT trigger so
-- every coach — whether added from the app's inline "add coach" path
-- or seeded by a migration — gets one automatically, with a unique
-- index as the final safety net.
--
-- A read-only RPC (check_coach_activation_code) lets the app validate
-- a code with the anon key, exactly like 0042 does for members.
--
-- Apply manually via Supabase Dashboard → SQL Editor. Idempotent.
-- ============================================================

-- 1. Column ----------------------------------------------------
alter table public.coaches
  add column if not exists activation_code text;

-- 2. Generator: 2 letters + 6 digits, retries until unique --------
create or replace function public.generate_coach_activation_code()
returns text
language plpgsql
as $$
declare
  letters constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  code text;
  i int;
begin
  loop
    code := substr(letters, 1 + floor(random() * 26)::int, 1)
          || substr(letters, 1 + floor(random() * 26)::int, 1);
    for i in 1..6 loop
      code := code || floor(random() * 10)::int::text;
    end loop;
    exit when not exists (select 1 from public.coaches where activation_code = code);
  end loop;
  return code;
end;
$$;

-- 3. Backfill existing coaches one-by-one so each generated code
--    sees the codes assigned just before it (avoids in-statement
--    collisions).
do $$
declare r record;
begin
  for r in select id from public.coaches where activation_code is null loop
    update public.coaches
      set activation_code = public.generate_coach_activation_code()
      where id = r.id;
  end loop;
end $$;

-- 4. Uniqueness ------------------------------------------------
create unique index if not exists coaches_activation_code_unique
  on public.coaches (activation_code);

-- 5. Auto-assign on insert -------------------------------------
create or replace function public.set_coach_activation_code()
returns trigger
language plpgsql
as $$
begin
  if new.activation_code is null or btrim(new.activation_code) = '' then
    new.activation_code := public.generate_coach_activation_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_coaches_activation_code on public.coaches;
create trigger trg_coaches_activation_code
  before insert on public.coaches
  for each row execute function public.set_coach_activation_code();

-- 6. App-facing validation RPC (mirrors 0042 for members) --------
create or replace function public.check_coach_activation_code(p_code text)
returns table (
  coach_id  uuid,
  name      text,
  kind      text,
  phone     text,
  is_active boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select c.id, c.name, c.kind, c.phone, c.is_active
  from public.coaches c
  where c.activation_code = upper(btrim(p_code))
  limit 1;
$$;

revoke all on function public.check_coach_activation_code(text) from public;
grant execute on function public.check_coach_activation_code(text) to anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- TO REVERT:
--   DROP TRIGGER IF EXISTS trg_coaches_activation_code ON public.coaches;
--   DROP FUNCTION IF EXISTS public.set_coach_activation_code();
--   DROP FUNCTION IF EXISTS public.check_coach_activation_code(text);
--   DROP INDEX IF EXISTS public.coaches_activation_code_unique;
--   ALTER TABLE public.coaches DROP COLUMN IF EXISTS activation_code;
--   DROP FUNCTION IF EXISTS public.generate_coach_activation_code();
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
