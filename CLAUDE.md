# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — Next dev server on port 3000
- `npm run build` / `npm run start` — production build / serve
- `npm run lint` — ESLint (flat config in `eslint.config.mjs`)
- `npm run seed:users` — one-time Supabase auth + profile seeding (run after `0001_init.sql`)

There is no test suite. Node version is pinned to 22 (`.node-version`).

Required env vars in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — used by client/server/middleware
- `SUPABASE_SERVICE_ROLE_KEY` — only for the seed script
- `SEED_DEFAULT_PASSWORD` — optional; defaults to `123456`

Database migrations in `supabase/migrations/*.sql` are applied **manually** through the Supabase Dashboard SQL editor in numeric order. There is no Supabase CLI workflow. Each migration ends with `NOTIFY pgrst, 'reload schema'` so PostgREST sees new columns immediately. Numbers `0006`–`0009` are intentionally skipped; `0010_usd_shift_overhaul.sql` is the canonical USD migration; `0015_safe_catchup.sql` is idempotent and re-applies anything older databases may be missing.

## Architecture

A Next.js 16 App Router single-page Arabic/RTL dashboard for OX GYM. The whole UI is rendered from `app/page.tsx` as client components on top of Supabase (auth + Postgres + realtime).

### Next.js 16 deviations from prior versions
- **Middleware is `proxy.ts` at the repo root, exporting a function named `proxy`** (not `middleware.ts` / `middleware`). It refreshes the Supabase session cookie on every non-asset request. There is no `middleware.ts`.
- Heed `AGENTS.md`: read `node_modules/next/dist/docs/` before relying on Next.js APIs you remember from earlier versions.

### Provider tree

`app/page.tsx` wraps everything in `AuthProvider` → `CurrencyProvider` → `StoreProvider`. There is no client-side router; `AppRouter` switches between `LoginScreen`, `ManagerDashboard`, and `DashboardContent` based on `useAuth()`.

- `lib/auth-context.tsx` — Supabase auth + role lookup from `public.profiles` (`manager` | `reception`). Intentionally ignores `INITIAL_SESSION` and `TOKEN_REFRESHED` events to avoid stale-cookie auto-login races; only `SIGNED_IN` / `SIGNED_OUT` mutate state. Don't "fix" this by reacting to all events.
- `lib/currency-context.tsx` — exchange rate (1 USD → SYP) persisted in `app_settings.exchange_rate_usd_syp`. USD is the canonical currency.
- `lib/store-context.tsx` — local mirror of subscriptions / sales / inbody / food items / active session. Hydrates from Supabase on mount (today's rows for sales/inbody, all-time-active for subs). Mutations are optimistic; persistence is delegated to the intake module.

### Supabase boundary (writes vs reads are split)

- `lib/supabase/intake.ts` — **the only place that writes.** Every write validates inputs, requires an open `cash_session_id`, calls `.select()` to confirm the row materialized under RLS, logs success/failure, and pushes a row into `activity_feed`. New write paths must follow this pattern. When `data` is empty after a write, treat it as RLS rejection.
- `lib/supabase/dashboard.ts` — read-side aggregations (`fetchLiveKPI`, `fetchDailyReport`) and the `useLiveKPI` hook, which subscribes to realtime changes on `subscriptions`, `sales`, `inbody_sessions`, `cash_sessions`, `products`.
- `lib/supabase/session.ts` — cash-session lookups (`getActiveSession`, `getLastClosedSession`, `fetchSessionIncome`).
- `lib/supabase/client.ts` / `server.ts` — browser and SSR clients via `@supabase/ssr`.

### Cash-session invariant

A *cash session* (`public.cash_sessions`) is one cashier shift. The DB enforces **at most one open session at a time** (`0013_one_open_session.sql`). All revenue writes (sales, subscriptions, inbody, expenses, private sessions) attach the active `cash_session_id` and refuse to write without one. Closing a session **recomputes** expected vs. actual cash from DB rows in `closeCashSession` — never trust frontend-aggregated totals on close. Opening cash for the next session is the prior session's `actual_cash` (handoff), with `opening_locked` set to prevent edits.

### RLS pattern

All tables have RLS on. Default pattern: **read** allowed for managers OR the row's `created_by`; **insert** requires `created_by = auth.uid()`; **mutations** of `products` / `profiles` are manager-only. Seed users via `scripts/seed-users.mjs` (uses the service-role key — bypasses RLS). When adding a new table, add policies in the same migration.

### Money handling

Money columns store USD (`amount`, `total`, `paid_amount`, `unit_price`) plus an `amount_syp` snapshot computed at write-time using the exchange rate at that moment. Conversions happen in `intake.ts`; the read side never recomputes. UI formatting (Arabic months, `Asia/Damascus` timezone) lives in `lib/utils/time.ts` and `lib/business-logic.ts` — reuse `formatDate` / `formatTime` rather than calling `toLocaleString` ad hoc.

### UI conventions

- Whole app is RTL (`<html dir="rtl">`) with hard-coded Arabic copy. Preserve direction when editing strings.
- Theme tokens (`bg-void`, `text-offwhite`, `text-gold`, `border-gunmetal`, etc.) are Tailwind v4 utilities defined in `app/globals.css` under `@theme`. Stick to the existing palette; don't introduce ad-hoc hex colors.
- `data/catalog/*.json` (meals, supplements, wearables) are static seeds for first-boot fallback; the live source of truth is the `food_items` / `products` tables.
