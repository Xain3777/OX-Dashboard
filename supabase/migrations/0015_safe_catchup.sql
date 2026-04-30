-- ============================================================
-- OX GYM — safe catch-up migration
-- Applies all columns that may have been missed in 0011 / 0012.
-- Every statement is idempotent (IF NOT EXISTS / IF EXISTS guards).
-- Run in Supabase SQL editor, then reload the PostgREST schema cache.
-- ============================================================

-- ── From 0011: payment_method on subscriptions ────────────────
ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));

-- ── From 0011: payment_method on sales ───────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('cash','card','transfer','other'));

-- ── From 0011: created_by_name on inbody_sessions ────────────
ALTER TABLE public.inbody_sessions
  ADD COLUMN IF NOT EXISTS created_by_name text;

-- ── From 0011: created_by_name on sales ──────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS created_by_name text;

-- ── From 0012: group_id on subscriptions ─────────────────────
ALTER TABLE public.gym_subscriptions
  ADD COLUMN IF NOT EXISTS group_id uuid;

-- ── From 0012: private_sessions ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.private_sessions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  number_of_players int           NOT NULL CHECK (number_of_players > 0),
  player_names      text[]        NOT NULL DEFAULT '{}',
  base_trainer_fee  numeric(10,2) NOT NULL DEFAULT 18,
  group_price       numeric(10,2) NOT NULL,
  total_price       numeric(10,2) NOT NULL,
  currency          text          NOT NULL DEFAULT 'usd' CHECK (currency IN ('syp','usd')),
  exchange_rate     numeric(10,2) NOT NULL DEFAULT 1,
  amount_syp        numeric(12,2),
  group_id          uuid,
  notes             text,
  cash_session_id   uuid          REFERENCES public.cash_sessions(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid          REFERENCES public.profiles(id),
  cancelled_reason  text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  created_by        uuid          NOT NULL REFERENCES public.profiles(id),
  created_by_name   text
);

ALTER TABLE public.private_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_sessions' AND policyname='private_sessions_insert') THEN
    CREATE POLICY "private_sessions_insert" ON public.private_sessions FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_sessions' AND policyname='private_sessions_select') THEN
    CREATE POLICY "private_sessions_select" ON public.private_sessions FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='private_sessions' AND policyname='private_sessions_update') THEN
    CREATE POLICY "private_sessions_update" ON public.private_sessions FOR UPDATE TO authenticated
      USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'manager'));
  END IF;
END $$;

-- ── From 0012: group_offers ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_offers (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid         NOT NULL,
  offer_type        text         NOT NULL CHECK (offer_type IN ('referral','couple','corporate')),
  members           jsonb        NOT NULL DEFAULT '[]',
  referral_count    int,
  reward_type       text,
  reward_value      numeric,
  discount_percent  numeric,
  organization_type text,
  price_applied     numeric,
  cash_session_id   uuid         REFERENCES public.cash_sessions(id),
  created_at        timestamptz  NOT NULL DEFAULT now(),
  created_by        uuid         NOT NULL REFERENCES public.profiles(id)
);

ALTER TABLE public.group_offers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='group_offers' AND policyname='group_offers_all') THEN
    CREATE POLICY "group_offers_all" ON public.group_offers FOR ALL TO authenticated
      USING (true) WITH CHECK (created_by = auth.uid());
  END IF;
END $$;

-- ── Reload PostgREST schema cache ─────────────────────────────
-- Run this last so all new columns are visible immediately.
NOTIFY pgrst, 'reload schema';
