"use client";

// Live KPIs — all amounts in USD, derived entirely from Supabase.
// No expenses, no discrepancy logic, no SYP conversions here.

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "./client";


export interface LiveKPI {
  todayRevenueUSD: number;
  activeMembers: number;
  expiringThisWeek: number;
  endedCount: number;
  cashOnHandUSD: number;   // open-session opening_cash + today's income
  lowStockItems: number;
  monthlyRevenueUSD: number;
  partiallyPaidCount: number;
  partiallyPaidRemainingUSD: number;
}

const ZERO: LiveKPI = {
  todayRevenueUSD: 0,
  activeMembers: 0,
  expiringThisWeek: 0,
  endedCount: 0,
  cashOnHandUSD: 0,
  lowStockItems: 0,
  monthlyRevenueUSD: 0,
  partiallyPaidCount: 0,
  partiallyPaidRemainingUSD: 0,
};

function startOfTodayISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function startOfMonthISO() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function inSevenDaysISO() {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(23, 59, 59, 999);
  return d.toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

// Tables with a `member_name` column whose rows we want to exclude when
// the name contains "test" (case-insensitive). Sales/expenses don't have
// member_name, so the filter is skipped automatically.
const MEMBER_NAMED_TABLES = new Set<string>(["gym_subscriptions", "inbody_sessions"]);

async function sumUSD(
  table: string,
  col: string,
  since: string,
  source?: string,
): Promise<number> {
  const supabase = supabaseBrowser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from(table)
    .select(col)
    .gte("created_at", since)
    .is("cancelled_at", null);
  if (source) q = q.eq("source", source);
  if (MEMBER_NAMED_TABLES.has(table)) q = q.not("member_name", "ilike", "%test%");
  const { data } = await q;
  return (data ?? []).reduce(
    (a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0),
    0,
  );
}

export async function fetchLiveKPI(): Promise<LiveKPI> {
  const supabase = supabaseBrowser();
  const today = startOfTodayISO();
  const month = startOfMonthISO();

  const [
    todaySubsUSD,
    todayStoreUSD,
    todayKitchenUSD,
    todayInbodyUSD,
    monthSubsUSD,
    monthStoreUSD,
    monthKitchenUSD,
    monthInbodyUSD,
    activeSubs,
    expiringSoon,
    endedSubs,
    openSessions,
    lowStock,
    partiallyPaid,
  ] = await Promise.all([
    sumUSD("gym_subscriptions", "paid_amount", today),
    sumUSD("sales",           "total",       today, "store"),
    sumUSD("sales",           "total",       today, "kitchen"),
    sumUSD("inbody_sessions", "amount",      today),
    sumUSD("gym_subscriptions", "paid_amount", month),
    sumUSD("sales",           "total",       month, "store"),
    sumUSD("sales",           "total",       month, "kitchen"),
    sumUSD("inbody_sessions", "amount",      month),
    supabase
      .from("gym_subscriptions")
      .select("member_name", { count: "exact", head: true })
      .eq("status", "active")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", todayISO())
      .lte("end_date", inSevenDaysISO())
      .not("member_name", "ilike", "%test%"),
    // "Ended" = expired explicitly OR an active row whose end_date is in
    // the past. Cancelled rows are excluded. We can't combine `.or()` with
    // a chained `.is()` (it AND-merges in a way that breaks the OR group),
    // so encode the cancellation guard inside the OR filter itself.
    supabase
      .from("gym_subscriptions")
      .select("id", { count: "exact", head: true })
      .or(
        `and(status.eq.expired,cancelled_at.is.null),` +
        `and(status.eq.active,end_date.lt.${todayISO()},cancelled_at.is.null)`
      )
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("cash_sessions")
      .select("opening_cash")
      .eq("status", "open"),
    supabase.from("products").select("id, stock, low_stock_threshold"),
    // Partially paid subscriptions (any offer type, any plan).
    // We pull amount + paid_amount + currency + exchange_rate so we can
    // surface remaining balances in USD even if the row was stored in SYP.
    supabase
      .from("gym_subscriptions")
      .select("amount, paid_amount, currency, exchange_rate")
      .eq("payment_status", "partial")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
  ]);

  const todayRevenueUSD   = todaySubsUSD + todayStoreUSD + todayKitchenUSD + todayInbodyUSD;
  const monthlyRevenueUSD = monthSubsUSD + monthStoreUSD + monthKitchenUSD + monthInbodyUSD;
  const openOpening = (openSessions.data ?? []).reduce(
    (a: number, r: Record<string, unknown>) => a + Number(r.opening_cash ?? 0),
    0,
  );
  const cashOnHandUSD = openOpening + todayRevenueUSD;

  const lowStockCount = (lowStock.data ?? []).filter(
    (p: Record<string, unknown>) =>
      Number(p.stock ?? 0) <= Number(p.low_stock_threshold ?? 0),
  ).length;

  const partialRows = (partiallyPaid.data ?? []) as Record<string, unknown>[];
  const partiallyPaidCount = partialRows.length;
  const partiallyPaidRemainingUSD = partialRows.reduce((acc, r) => {
    const amount     = Number(r.amount ?? 0);
    const paidAmount = Number(r.paid_amount ?? 0);
    const currency   = String(r.currency ?? "usd");
    const rate       = Number(r.exchange_rate ?? 0);
    const remaining  = amount - paidAmount;
    if (remaining <= 0) return acc;
    if (currency === "syp" && rate > 0) return acc + remaining / rate;
    return acc + remaining;
  }, 0);

  return {
    todayRevenueUSD:   Number(todayRevenueUSD.toFixed(2)),
    activeMembers:     activeSubs.count ?? 0,
    expiringThisWeek:  expiringSoon.count ?? 0,
    endedCount:        endedSubs.count ?? 0,
    cashOnHandUSD:     Number(cashOnHandUSD.toFixed(2)),
    lowStockItems:     lowStockCount,
    monthlyRevenueUSD: Number(monthlyRevenueUSD.toFixed(2)),
    partiallyPaidCount,
    partiallyPaidRemainingUSD: Number(partiallyPaidRemainingUSD.toFixed(2)),
  };
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
//
// "Daily" is a Damascus-local calendar day, not a UTC day, and not a cash
// session. Rows are filtered by `created_at` falling inside the Damascus-day
// window, so the report is correct for overnight shifts, multi-shift days,
// and days where the cash session was opened the previous evening.

export interface SubscriptionDailyRow {
  time: string;
  memberName: string;
  phone: string;
  planType: string;
  offer: string;
  startDate: string;
  endDate: string;
  amount: number;       // full price (USD)
  paidAmount: number;   // actually paid (USD)
  remaining: number;    // amount - paidAmount
  paymentStatus: string;
  paymentMethod: string;
  by: string;
}

export interface SaleDailyRow {
  time: string;
  productName: string;
  quantity: number;
  unitPriceUSD: number;
  totalUSD: number;
  paymentMethod: string;
  by: string;
}

export interface InBodyDailyRow {
  time: string;
  memberName: string;
  sessionType: string;
  amountUSD: number;
  by: string;
}

export interface ExpenseDailyRow {
  time: string;
  description: string;
  category: string;
  amountUSD: number;
  originalAmount: number;
  currency: string;
  by: string;
}

export interface DailyReport {
  date: string;
  windowStartUTC: string;
  windowEndUTC: string;
  sessionsCount: number;
  totals: {
    subscriptionsUSD: number;
    storeSalesUSD: number;
    kitchenSalesUSD: number;
    inbodyUSD: number;
    expensesUSD: number;
    incomeUSD: number;
    netUSD: number;
  };
  counts: {
    subscriptions: number;
    storeSales: number;
    kitchenSales: number;
    inbody: number;
    expenses: number;
  };
  subscriptions: SubscriptionDailyRow[];
  storeSales: SaleDailyRow[];
  kitchenSales: SaleDailyRow[];
  inbody: InBodyDailyRow[];
  expenses: ExpenseDailyRow[];
}

// Damascus has been UTC+3 year-round since 2022 (no DST). Anchoring the
// day window via the +03:00 offset is timezone-correct without relying on
// the runtime's local TZ.
const DAMASCUS_OFFSET = "+03:00";

function damascusDayWindowUTC(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000${DAMASCUS_OFFSET}`).toISOString();
  const end   = new Date(`${date}T23:59:59.999${DAMASCUS_OFFSET}`).toISOString();
  return { start, end };
}

function toUSD(amount: number, currency: string, rate: number): number {
  if (currency === "syp" && rate > 0) return amount / rate;
  return amount;
}

export async function fetchDailyReport(date: string): Promise<DailyReport> {
  const supabase = supabaseBrowser();
  const { start: dayStart, end: dayEnd } = damascusDayWindowUTC(date);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name");
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    const pr = p as Record<string, unknown>;
    nameMap[String(pr.id)] = String(pr.display_name ?? "");
  }

  const [sessionsRes, subsRes, salesRes, inbodyRes, expensesRes] = await Promise.all([
    supabase
      .from("cash_sessions")
      .select("id")
      .gte("opened_at", dayStart)
      .lte("opened_at", dayEnd),
    supabase
      .from("gym_subscriptions")
      .select(
        "created_at, member_name, phone, plan_type, offer, start_date, end_date, " +
        "amount, paid_amount, payment_status, payment_method, currency, exchange_rate, created_by"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("sales")
      .select(
        "created_at, source, product_name, quantity, unit_price, total, " +
        "currency, exchange_rate, payment_method, created_by, created_by_name"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null),
    supabase
      .from("inbody_sessions")
      .select(
        "created_at, member_name, session_type, amount, currency, exchange_rate, " +
        "created_by, created_by_name"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("expenses")
      .select("created_at, description, category, amount, currency, exchange_rate, created_by")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null),
  ]);

  const sessionsCount = (sessionsRes.data ?? []).length;

  const subscriptions: SubscriptionDailyRow[] = (subsRes.data ?? []).map((s) => {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const amount     = toUSD(Number(r.amount ?? 0),      currency, rate);
    const paidAmount = toUSD(Number(r.paid_amount ?? 0), currency, rate);
    return {
      time: String(r.created_at ?? ""),
      memberName: String(r.member_name ?? ""),
      phone: String(r.phone ?? ""),
      planType: String(r.plan_type ?? ""),
      offer: String(r.offer ?? "none"),
      startDate: String(r.start_date ?? ""),
      endDate: String(r.end_date ?? ""),
      amount: Number(amount.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      remaining: Number((amount - paidAmount).toFixed(2)),
      paymentStatus: String(r.payment_status ?? ""),
      paymentMethod: String(r.payment_method ?? ""),
      by: nameMap[String(r.created_by ?? "")] ?? String(r.created_by ?? ""),
    };
  });

  const storeSales: SaleDailyRow[] = [];
  const kitchenSales: SaleDailyRow[] = [];
  for (const s of salesRes.data ?? []) {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const qty = Number(r.quantity ?? 1);
    const total = toUSD(Number(r.total ?? 0), currency, rate);
    const unit = qty > 0 ? total / qty : toUSD(Number(r.unit_price ?? 0), currency, rate);
    const row: SaleDailyRow = {
      time: String(r.created_at ?? ""),
      productName: String(r.product_name ?? ""),
      quantity: qty,
      unitPriceUSD: Number(unit.toFixed(2)),
      totalUSD: Number(total.toFixed(2)),
      paymentMethod: String(r.payment_method ?? ""),
      by: String(r.created_by_name ?? nameMap[String(r.created_by ?? "")] ?? ""),
    };
    if (String(r.source ?? "store") === "kitchen") kitchenSales.push(row);
    else storeSales.push(row);
  }

  const inbody: InBodyDailyRow[] = (inbodyRes.data ?? []).map((s) => {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const usd = toUSD(Number(r.amount ?? 0), currency, rate);
    return {
      time: String(r.created_at ?? ""),
      memberName: String(r.member_name ?? ""),
      sessionType: String(r.session_type ?? ""),
      amountUSD: Number(usd.toFixed(2)),
      by: String(r.created_by_name ?? nameMap[String(r.created_by ?? "")] ?? ""),
    };
  });

  const expenses: ExpenseDailyRow[] = (expensesRes.data ?? []).map((s) => {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const raw = Number(r.amount ?? 0);
    const usd = toUSD(raw, currency, rate);
    return {
      time: String(r.created_at ?? ""),
      description: String(r.description ?? ""),
      category: String(r.category ?? ""),
      amountUSD: Number(usd.toFixed(2)),
      originalAmount: raw,
      currency,
      by: nameMap[String(r.created_by ?? "")] ?? String(r.created_by ?? ""),
    };
  });

  const sortByTime = <T extends { time: string }>(rows: T[]) =>
    rows.sort((a, b) => a.time.localeCompare(b.time));
  sortByTime(subscriptions);
  sortByTime(storeSales);
  sortByTime(kitchenSales);
  sortByTime(inbody);
  sortByTime(expenses);

  const subscriptionsUSD = subscriptions.reduce((a, r) => a + r.paidAmount, 0);
  const storeSalesUSD    = storeSales.reduce((a, r) => a + r.totalUSD, 0);
  const kitchenSalesUSD  = kitchenSales.reduce((a, r) => a + r.totalUSD, 0);
  const inbodyUSD        = inbody.reduce((a, r) => a + r.amountUSD, 0);
  const expensesUSD      = expenses.reduce((a, r) => a + r.amountUSD, 0);
  const incomeUSD        = subscriptionsUSD + storeSalesUSD + kitchenSalesUSD + inbodyUSD;

  return {
    date,
    windowStartUTC: dayStart,
    windowEndUTC: dayEnd,
    sessionsCount,
    totals: {
      subscriptionsUSD: Number(subscriptionsUSD.toFixed(2)),
      storeSalesUSD:    Number(storeSalesUSD.toFixed(2)),
      kitchenSalesUSD:  Number(kitchenSalesUSD.toFixed(2)),
      inbodyUSD:        Number(inbodyUSD.toFixed(2)),
      expensesUSD:      Number(expensesUSD.toFixed(2)),
      incomeUSD:        Number(incomeUSD.toFixed(2)),
      netUSD:           Number((incomeUSD - expensesUSD).toFixed(2)),
    },
    counts: {
      subscriptions: subscriptions.length,
      storeSales:    storeSales.length,
      kitchenSales:  kitchenSales.length,
      inbody:        inbody.length,
      expenses:      expenses.length,
    },
    subscriptions,
    storeSales,
    kitchenSales,
    inbody,
    expenses,
  };
}

const REALTIME_TABLES = [
  "gym_subscriptions",
  "sales",
  "inbody_sessions",
  "cash_sessions",
  "products",
] as const;

export function useLiveKPI() {
  const supabase = supabaseBrowser();
  const [kpi, setKpi] = useState<LiveKPI>(ZERO);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchLiveKPI();
      setKpi(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel("live-kpi");
    for (const table of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void refresh(),
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh]);

  return { kpi, loading, refresh };
}

// ────────────────────────────────────────────────────────────────────────────
// Manager dashboard helpers
//
// All amounts are reported as the snapshotted SYP value (`amount_syp` on each
// transaction row, frozen at write-time per migration 0002). For old rows
// missing `amount_syp`, a fallback is used:
//   • `currency='syp'` → use the row's native amount column directly
//   • `currency='usd'` and `exchange_rate > 0` → multiply by exchange_rate
//   • otherwise → exclude from SYP total and increment `skipped.<table>` so
//     the UI can surface a warning. Never silently divide by 1.
//
// USD figures are computed only when a row has either `currency='usd'`
// (use the raw column) or a positive `exchange_rate` snapshot. Rows with a
// missing/zero exchange_rate on SYP-stored data are excluded from USD totals.
//
// Test rows (`member_name ILIKE '%test%'`) are excluded on every table that
// has a member_name column, matching the prior fetchLiveKPI behaviour.
// ────────────────────────────────────────────────────────────────────────────

export type DateRangePreset = "today" | "week" | "month" | "custom";

export interface ManagerDateRange {
  preset: DateRangePreset;
  /** Start of window, ISO timestamptz at Damascus 00:00:00.000 +03:00. */
  startUTC: string;
  /** End of window, ISO timestamptz at Damascus 23:59:59.999 +03:00. */
  endUTC: string;
  /** Local start date YYYY-MM-DD (Damascus). */
  startDate: string;
  /** Local end date YYYY-MM-DD (Damascus). */
  endDate: string;
  /** Arabic display label. */
  label: string;
}

function todayDamascusDate(): string {
  // en-CA → YYYY-MM-DD, applied through the Damascus tz.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Damascus" });
}

function startOfWeekDamascusDate(): string {
  // Levant convention: Saturday is the start of the working week.
  const today = todayDamascusDate();
  const damascusWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Damascus",
    weekday: "short",
  }).format(new Date(`${today}T12:00:00${DAMASCUS_OFFSET}`));
  const offset: Record<string, number> = {
    Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6,
  };
  const back = offset[damascusWeekday] ?? 0;
  const anchor = new Date(`${today}T12:00:00${DAMASCUS_OFFSET}`);
  anchor.setUTCDate(anchor.getUTCDate() - back);
  return anchor.toISOString().slice(0, 10);
}

function startOfMonthDamascusDate(): string {
  return `${todayDamascusDate().slice(0, 7)}-01`;
}

export function makeDateRange(
  preset: DateRangePreset,
  custom?: { startDate: string; endDate: string },
): ManagerDateRange {
  const today = todayDamascusDate();
  let startDate = today;
  let endDate = today;
  let label = "اليوم";
  if (preset === "week") {
    startDate = startOfWeekDamascusDate();
    endDate = today;
    label = "هذا الأسبوع";
  } else if (preset === "month") {
    startDate = startOfMonthDamascusDate();
    endDate = today;
    label = "هذا الشهر";
  } else if (preset === "custom" && custom) {
    startDate = custom.startDate;
    endDate = custom.endDate;
    label = `${startDate} → ${endDate}`;
  }
  const startUTC = new Date(`${startDate}T00:00:00.000${DAMASCUS_OFFSET}`).toISOString();
  const endUTC   = new Date(`${endDate}T23:59:59.999${DAMASCUS_OFFSET}`).toISOString();
  return { preset, startUTC, endUTC, startDate, endDate, label };
}

// ── Row-level conversion helpers ─────────────────────────────────────────────

interface AmountRow {
  amount_syp?: number | string | null;
  exchange_rate?: number | string | null;
  currency?: string | null;
}

/**
 * Resolve a row's SYP value preferring the snapshot column. Returns null when
 * no reliable conversion is possible — caller increments a "skipped" counter.
 */
function rowSYP(row: AmountRow, nativeAmount: number): number | null {
  const snapshot = Number(row.amount_syp ?? NaN);
  if (Number.isFinite(snapshot) && snapshot > 0) return snapshot;
  const cur = String(row.currency ?? "usd");
  if (cur === "syp") return nativeAmount;
  const rate = Number(row.exchange_rate ?? 0);
  if (cur === "usd" && rate > 0) return nativeAmount * rate;
  return null;
}

/**
 * Resolve a row's USD value. Returns null when the row was stored in SYP
 * without a usable exchange_rate snapshot (we never silently divide by 1).
 */
function rowUSD(row: AmountRow, nativeAmount: number): number | null {
  const cur = String(row.currency ?? "usd");
  if (cur === "usd") return nativeAmount;
  const rate = Number(row.exchange_rate ?? 0);
  if (cur === "syp" && rate > 0) return nativeAmount / rate;
  return null;
}

// Identity for distinct-member counting. Falls back to a normalised name when
// member_id is absent. Exposed as a single helper so every count uses it.
function memberIdentity(row: { member_id?: string | null; member_name?: string | null; id?: string }): string {
  if (row.member_id) return `id:${row.member_id}`;
  const name = (row.member_name ?? "").trim().toLowerCase();
  if (name) return `name:${name}`;
  return `row:${row.id ?? ""}`;
}

// ── Manager summary ──────────────────────────────────────────────────────────

export interface CurrencyBucket {
  syp: number;
  usd: number;
  /** Rows skipped from USD total because exchange_rate was 0/null. */
  skippedUSD: number;
}

const ZERO_BUCKET: CurrencyBucket = { syp: 0, usd: 0, skippedUSD: 0 };

export interface ManagerSummary {
  range: ManagerDateRange;
  subscriptions: CurrencyBucket;
  inbody: CurrencyBucket;
  store: CurrencyBucket;
  kitchen: CurrencyBucket;
  privateSessions: CurrencyBucket;
  expenses: CurrencyBucket;
  totalRevenue: CurrencyBucket;
  netIncome: CurrencyBucket;
  activeMembers: {
    /** Distinct member_id (with normalised-name fallback) of currently active subs. */
    distinct: number;
    /** Subscription rows whose member_id was null — counted via name fallback. */
    unattached: number;
  };
  partiallyPaid: {
    count: number;
    remainingSYP: number;
    remainingUSD: number;
    skippedUSD: number;
  };
  cashOnHand: {
    /** Open-session opening + session income − session expenses. SYP. */
    syp: number;
    usd: number;
    /** Whether there is an open cash session. */
    hasOpenSession: boolean;
  };
}

const SUB_SELECT =
  "id, member_id, member_name, plan_type, offer, paid_amount, amount, payment_status, currency, exchange_rate, amount_syp, status, end_date, created_at, cancelled_at";
const SALE_SELECT =
  "id, source, total, currency, exchange_rate, amount_syp, is_reversal, cancelled_at, created_at";
const INBODY_SELECT =
  "id, member_id, member_name, session_type, amount, currency, exchange_rate, amount_syp, cancelled_at, created_at";
const PRIVATE_SELECT =
  "id, paid_amount, total_price, payment_status, currency, exchange_rate, amount_syp, cancelled_at, created_at";
const EXPENSE_SELECT =
  "id, category, amount, currency, exchange_rate, amount_syp, cancelled_at, created_at";

type Row = Record<string, unknown>;

/** Sum a query's rows into a CurrencyBucket using the named amount column. */
function bucketise(rows: Row[], amountCol: string): CurrencyBucket {
  const out: CurrencyBucket = { syp: 0, usd: 0, skippedUSD: 0 };
  for (const r of rows) {
    const native = Number(r[amountCol] ?? 0);
    if (!Number.isFinite(native) || native === 0) continue;
    const syp = rowSYP(r as AmountRow, native);
    if (syp != null) out.syp += syp;
    const usd = rowUSD(r as AmountRow, native);
    if (usd != null) out.usd += usd;
    else out.skippedUSD += 1;
  }
  return out;
}

function bucketSubtract(a: CurrencyBucket, b: CurrencyBucket): CurrencyBucket {
  return {
    syp: a.syp - b.syp,
    usd: a.usd - b.usd,
    skippedUSD: a.skippedUSD + b.skippedUSD,
  };
}

function bucketSum(...xs: CurrencyBucket[]): CurrencyBucket {
  return xs.reduce(
    (acc, x) => ({
      syp: acc.syp + x.syp,
      usd: acc.usd + x.usd,
      skippedUSD: acc.skippedUSD + x.skippedUSD,
    }),
    { ...ZERO_BUCKET },
  );
}

export async function fetchManagerDashboardSummary(
  range: ManagerDateRange,
): Promise<ManagerSummary> {
  const supabase = supabaseBrowser();
  const today = todayDamascusDate();

  const [
    subsRes,
    salesRes,
    inbodyRes,
    privateRes,
    expensesRes,
    activeSubsRes,
    partialSubsRes,
    openSessionRes,
  ] = await Promise.all([
    supabase
      .from("gym_subscriptions")
      .select(SUB_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("sales")
      .select(SALE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .eq("is_reversal", false),
    supabase
      .from("inbody_sessions")
      .select(INBODY_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("private_sessions")
      .select(PRIVATE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
    supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name, end_date, status, cancelled_at")
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, amount, paid_amount, currency, exchange_rate, amount_syp, cancelled_at")
      .eq("payment_status", "partial")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("cash_sessions")
      .select("id, opening_cash")
      .eq("status", "open")
      .limit(1),
  ]);

  const subRows     = (subsRes.data     ?? []) as Row[];
  const saleRows    = (salesRes.data    ?? []) as Row[];
  const inbodyRows  = (inbodyRes.data   ?? []) as Row[];
  const privateRows = (privateRes.data  ?? []) as Row[];
  const expRows     = (expensesRes.data ?? []) as Row[];

  const subscriptions = bucketise(subRows, "paid_amount");
  const inbody        = bucketise(inbodyRows, "amount");
  const storeRows     = saleRows.filter((r) => String(r.source ?? "store") === "store");
  const kitchenRows   = saleRows.filter((r) => String(r.source ?? "store") === "kitchen");
  const store         = bucketise(storeRows, "total");
  const kitchen       = bucketise(kitchenRows, "total");
  const privateSessions = bucketise(privateRows, "paid_amount");
  const expenses      = bucketise(expRows, "amount");

  const totalRevenue = bucketSum(subscriptions, inbody, store, kitchen, privateSessions);
  const netIncome    = bucketSubtract(totalRevenue, expenses);

  // ── active members (point-in-time, NOT range-filtered) ────────────────────
  const activeRows = (activeSubsRes.data ?? []) as Row[];
  const idents = new Set<string>();
  let unattached = 0;
  for (const r of activeRows) {
    if (!r.member_id) unattached += 1;
    idents.add(memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string }));
  }

  // ── partial-payment outstanding balance ───────────────────────────────────
  const partialRows = (partialSubsRes.data ?? []) as Row[];
  let partialRemainingSYP = 0;
  let partialRemainingUSD = 0;
  let partialSkippedUSD = 0;
  for (const r of partialRows) {
    const remaining = Number(r.amount ?? 0) - Number(r.paid_amount ?? 0);
    if (remaining <= 0) continue;
    const proxyRow: AmountRow = { ...r };
    // amount_syp on the row reflects paid_amount, not remaining — recompute.
    const cur = String(proxyRow.currency ?? "usd");
    const rate = Number(proxyRow.exchange_rate ?? 0);
    if (cur === "syp") {
      partialRemainingSYP += remaining;
      if (rate > 0) partialRemainingUSD += remaining / rate;
      else partialSkippedUSD += 1;
    } else if (cur === "usd") {
      partialRemainingUSD += remaining;
      if (rate > 0) partialRemainingSYP += remaining * rate;
      else partialSkippedUSD += 1;
    }
  }

  // ── cash on hand: opening + session income − session expenses (USD/SYP) ───
  const openSession = (openSessionRes.data ?? [])[0] as Row | undefined;
  let cashSypOpen = 0;
  let cashUsdOpen = 0;
  let cashSyp = 0;
  let cashUsd = 0;
  let hasOpenSession = false;
  if (openSession?.id) {
    hasOpenSession = true;
    const sid = String(openSession.id);
    const openingUSD = Number(openSession.opening_cash ?? 0);
    cashUsdOpen = openingUSD;
    // We don't track opening_cash_syp on the cash_session post-0016. Convert
    // the opening using the most-recent app exchange rate as a presentation
    // helper (NOT used for accounting). If unavailable, leave SYP at 0.
    const { data: rateRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "exchange_rate_usd_syp")
      .maybeSingle();
    const liveRate = Number((rateRow?.value as unknown) ?? 0);
    cashSypOpen = liveRate > 0 ? openingUSD * liveRate : 0;

    const [sessionSubs, sessionSales, sessionInbody, sessionPrivate, sessionExp] = await Promise.all([
      supabase.from("gym_subscriptions").select("paid_amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("sales").select("total, currency, exchange_rate, amount_syp, source, is_reversal").eq("cash_session_id", sid).is("cancelled_at", null).eq("is_reversal", false),
      supabase.from("inbody_sessions").select("amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("private_sessions").select("paid_amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("expenses").select("amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
    ]);
    const incomeBucket = bucketSum(
      bucketise((sessionSubs.data ?? []) as Row[], "paid_amount"),
      bucketise((sessionSales.data ?? []) as Row[], "total"),
      bucketise((sessionInbody.data ?? []) as Row[], "amount"),
      bucketise((sessionPrivate.data ?? []) as Row[], "paid_amount"),
    );
    const expenseBucket = bucketise((sessionExp.data ?? []) as Row[], "amount");
    cashSyp = cashSypOpen + incomeBucket.syp - expenseBucket.syp;
    cashUsd = cashUsdOpen + incomeBucket.usd - expenseBucket.usd;
  }

  return {
    range,
    subscriptions,
    inbody,
    store,
    kitchen,
    privateSessions,
    expenses,
    totalRevenue,
    netIncome,
    activeMembers: { distinct: idents.size, unattached },
    partiallyPaid: {
      count: partialRows.length,
      remainingSYP: partialRemainingSYP,
      remainingUSD: partialRemainingUSD,
      skippedUSD: partialSkippedUSD,
    },
    cashOnHand: { syp: cashSyp, usd: cashUsd, hasOpenSession },
  };
}

// ── Subscription breakdown ───────────────────────────────────────────────────

const KNOWN_PLANS = [
  "daily", "15_days", "1_month",
  "3_months", "6_months", "9_months", "12_months",
] as const;
export type KnownPlan = typeof KNOWN_PLANS[number] | "other";

export interface PlanRow {
  plan: KnownPlan;
  count: number;
  members: number;
  paidSYP: number;
  paidUSD: number;
  avgPaidSYP: number;
  partialCount: number;
  unpaidCount: number;
}

export interface OfferRow {
  offer: string;
  count: number;
  paidSYP: number;
  paidUSD: number;
}

export interface SubscriptionBreakdown {
  range: ManagerDateRange;
  byPlanType: PlanRow[];
  byOffer: OfferRow[];
  totals: {
    monthlySYP: number;
    multiMonthSYP: number;
    offerSYP: number;
    normalSYP: number;
    partialRemainingSYP: number;
    unpaidRemainingSYP: number;
  };
  skippedUSD: number;
}

function normalisePlan(p: unknown): KnownPlan {
  const s = String(p ?? "").trim();
  return (KNOWN_PLANS as readonly string[]).includes(s) ? (s as KnownPlan) : "other";
}

export async function fetchSubscriptionBreakdown(
  range: ManagerDateRange,
): Promise<SubscriptionBreakdown> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("gym_subscriptions")
    .select(SUB_SELECT)
    .gte("created_at", range.startUTC)
    .lte("created_at", range.endUTC)
    .is("cancelled_at", null)
    .not("member_name", "ilike", "%test%");
  if (error) console.error("fetchSubscriptionBreakdown:", error);
  const rows = (data ?? []) as Row[];

  const planAcc = new Map<KnownPlan, {
    count: number; idents: Set<string>; paidSYP: number; paidUSD: number; partial: number; unpaid: number;
  }>();
  const offerAcc = new Map<string, { count: number; paidSYP: number; paidUSD: number }>();
  let monthlySYP = 0, multiMonthSYP = 0, offerSYP = 0, normalSYP = 0;
  let partialRemainingSYP = 0, unpaidRemainingSYP = 0;
  let skippedUSD = 0;

  for (const r of rows) {
    const plan = normalisePlan(r.plan_type);
    const offer = (r.offer == null || r.offer === "" ? "none" : String(r.offer));
    const paidNative = Number(r.paid_amount ?? 0);
    const amountNative = Number(r.amount ?? 0);
    const paidSYP = rowSYP(r as AmountRow, paidNative);
    const paidUSD = rowUSD(r as AmountRow, paidNative);
    const remainingNative = Math.max(0, amountNative - paidNative);
    const remainingSYP = remainingNative > 0
      ? rowSYP(r as AmountRow, remainingNative) ?? 0
      : 0;
    if (paidUSD == null) skippedUSD += 1;

    // ── plan bucket ────────────────────────────────────────────
    let pb = planAcc.get(plan);
    if (!pb) { pb = { count: 0, idents: new Set(), paidSYP: 0, paidUSD: 0, partial: 0, unpaid: 0 }; planAcc.set(plan, pb); }
    pb.count += 1;
    pb.idents.add(memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string }));
    if (paidSYP != null) pb.paidSYP += paidSYP;
    if (paidUSD != null) pb.paidUSD += paidUSD;
    if (r.payment_status === "partial") pb.partial += 1;
    if (r.payment_status === "unpaid")  pb.unpaid  += 1;

    // ── offer bucket ───────────────────────────────────────────
    let ob = offerAcc.get(offer);
    if (!ob) { ob = { count: 0, paidSYP: 0, paidUSD: 0 }; offerAcc.set(offer, ob); }
    ob.count += 1;
    if (paidSYP != null) ob.paidSYP += paidSYP;
    if (paidUSD != null) ob.paidUSD += paidUSD;

    // ── totals ─────────────────────────────────────────────────
    const safeSYP = paidSYP ?? 0;
    if (plan === "1_month") monthlySYP += safeSYP;
    if (plan === "3_months" || plan === "6_months" || plan === "9_months" || plan === "12_months")
      multiMonthSYP += safeSYP;
    if (offer === "none") normalSYP += safeSYP; else offerSYP += safeSYP;

    if (r.payment_status === "partial") partialRemainingSYP += remainingSYP;
    if (r.payment_status === "unpaid")  unpaidRemainingSYP  += remainingSYP;
  }

  const byPlanType: PlanRow[] = [...KNOWN_PLANS, "other" as KnownPlan]
    .map((p) => {
      const pb = planAcc.get(p);
      if (!pb) return { plan: p, count: 0, members: 0, paidSYP: 0, paidUSD: 0, avgPaidSYP: 0, partialCount: 0, unpaidCount: 0 };
      return {
        plan: p,
        count: pb.count,
        members: pb.idents.size,
        paidSYP: pb.paidSYP,
        paidUSD: pb.paidUSD,
        avgPaidSYP: pb.count > 0 ? pb.paidSYP / pb.count : 0,
        partialCount: pb.partial,
        unpaidCount: pb.unpaid,
      };
    })
    .filter((p) => p.count > 0);

  const byOffer: OfferRow[] = [...offerAcc.entries()]
    .map(([offer, v]) => ({ offer, count: v.count, paidSYP: v.paidSYP, paidUSD: v.paidUSD }))
    .sort((a, b) => b.paidSYP - a.paidSYP);

  return {
    range,
    byPlanType,
    byOffer,
    totals: { monthlySYP, multiMonthSYP, offerSYP, normalSYP, partialRemainingSYP, unpaidRemainingSYP },
    skippedUSD,
  };
}

// ── Member category breakdown (point-in-time, NOT range-filtered) ───────────

export interface MemberCategoryBreakdown {
  totalActive: number;
  unattachedActive: number;
  monthlyNormal: number;
  monthlyOffer: number;
  threeMonthNormal: number;
  threeMonthOffer: number;
  sixMonthNormal: number;
  sixMonthOffer: number;
  nineMonthNormal: number;
  nineMonthOffer: number;
  yearlyNormal: number;
  yearlyOffer: number;
  multiMonthOfferTotal: number;
  frozen: number;
  expired: number;
  expiringThisWeek: number;
}

export async function fetchMemberCategoryBreakdown(): Promise<MemberCategoryBreakdown> {
  const supabase = supabaseBrowser();
  const today = todayDamascusDate();
  const inSeven = (() => {
    const d = new Date(`${today}T12:00:00${DAMASCUS_OFFSET}`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const [activeRes, frozenRes, expiredExplicitRes, expiredByEndDateRes, expiringRes] = await Promise.all([
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name, plan_type, offer, end_date, status, cancelled_at")
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name")
      .eq("status", "frozen")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name")
      .eq("status", "expired")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name")
      .eq("status", "active")
      .is("cancelled_at", null)
      .lt("end_date", today)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name, end_date")
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .lte("end_date", inSeven)
      .not("member_name", "ilike", "%test%"),
  ]);

  const distinct = (rows: Row[]) =>
    new Set(rows.map((r) => memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string }))).size;

  // Distinct counts per (plan, offer) bucket on the active set.
  const activeRows = (activeRes.data ?? []) as Row[];
  const idents: Record<string, Set<string>> = {};
  const bucket = (key: string) => {
    if (!idents[key]) idents[key] = new Set();
    return idents[key];
  };
  let unattachedActive = 0;
  for (const r of activeRows) {
    const ident = memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string });
    if (!r.member_id) unattachedActive += 1;
    const plan = normalisePlan(r.plan_type);
    const hasOffer = r.offer && r.offer !== "none" && r.offer !== "";
    bucket("all").add(ident);
    bucket(`plan:${plan}`).add(ident);
    bucket(`plan:${plan}:${hasOffer ? "offer" : "normal"}`).add(ident);
    if (hasOffer && plan !== "1_month" && plan !== "daily" && plan !== "15_days") {
      bucket("multimonthOffer").add(ident);
    }
  }
  const at = (k: string) => idents[k]?.size ?? 0;

  return {
    totalActive: at("all"),
    unattachedActive,
    monthlyNormal:    at("plan:1_month:normal"),
    monthlyOffer:     at("plan:1_month:offer"),
    threeMonthNormal: at("plan:3_months:normal"),
    threeMonthOffer:  at("plan:3_months:offer"),
    sixMonthNormal:   at("plan:6_months:normal"),
    sixMonthOffer:    at("plan:6_months:offer"),
    nineMonthNormal:  at("plan:9_months:normal"),
    nineMonthOffer:   at("plan:9_months:offer"),
    yearlyNormal:     at("plan:12_months:normal"),
    yearlyOffer:      at("plan:12_months:offer"),
    multiMonthOfferTotal: at("multimonthOffer"),
    frozen:  distinct((frozenRes.data ?? []) as Row[]),
    expired: distinct([
      ...((expiredExplicitRes.data ?? []) as Row[]),
      ...((expiredByEndDateRes.data ?? []) as Row[]),
    ]),
    expiringThisWeek: distinct((expiringRes.data ?? []) as Row[]),
  };
}

// ── Other-income breakdown ───────────────────────────────────────────────────

export interface OtherIncomeBreakdown {
  range: ManagerDateRange;
  inbody: {
    bucket: CurrencyBucket;
    sessionCount: number;
    gymMember: number;
    nonMember: number;
    packageSessions: number;
  };
  kitchen: { bucket: CurrencyBucket; orderCount: number };
  store:   { bucket: CurrencyBucket; saleCount: number };
  privateSessions: { bucket: CurrencyBucket; sessionCount: number };
}

export async function fetchOtherIncomeBreakdown(
  range: ManagerDateRange,
): Promise<OtherIncomeBreakdown> {
  const supabase = supabaseBrowser();
  const [salesRes, inbodyRes, privateRes] = await Promise.all([
    supabase
      .from("sales")
      .select(SALE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .eq("is_reversal", false),
    supabase
      .from("inbody_sessions")
      .select(INBODY_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("private_sessions")
      .select(PRIVATE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
  ]);

  const saleRows = (salesRes.data ?? []) as Row[];
  const storeRows   = saleRows.filter((r) => String(r.source ?? "store") === "store");
  const kitchenRows = saleRows.filter((r) => String(r.source ?? "store") === "kitchen");

  const inbodyRows = (inbodyRes.data ?? []) as Row[];
  const sessionType = (r: Row) => String(r.session_type ?? "");
  const gymMember = inbodyRows.filter((r) => sessionType(r) === "gym_member" || sessionType(r) === "single").length;
  const nonMember = inbodyRows.filter((r) => sessionType(r) === "non_member").length;
  const packageSessions = inbodyRows.filter((r) => sessionType(r).startsWith("package_")).length;

  const privateRows = (privateRes.data ?? []) as Row[];

  return {
    range,
    inbody: {
      bucket: bucketise(inbodyRows, "amount"),
      sessionCount: inbodyRows.length,
      gymMember,
      nonMember,
      packageSessions,
    },
    kitchen: { bucket: bucketise(kitchenRows, "total"), orderCount: kitchenRows.length },
    store:   { bucket: bucketise(storeRows,   "total"), saleCount:  storeRows.length },
    privateSessions: { bucket: bucketise(privateRows, "paid_amount"), sessionCount: privateRows.length },
  };
}

// ── Expenses breakdown ───────────────────────────────────────────────────────

export interface ExpensesBreakdown {
  range: ManagerDateRange;
  total: CurrencyBucket;
  byCategory: { category: string; bucket: CurrencyBucket; count: number }[];
}

export async function fetchExpensesBreakdown(
  range: ManagerDateRange,
): Promise<ExpensesBreakdown> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("expenses")
    .select(EXPENSE_SELECT)
    .gte("created_at", range.startUTC)
    .lte("created_at", range.endUTC)
    .is("cancelled_at", null);
  if (error) console.error("fetchExpensesBreakdown:", error);
  const rows = (data ?? []) as Row[];

  const byCat = new Map<string, Row[]>();
  for (const r of rows) {
    const cat = String(r.category ?? "miscellaneous");
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, rs]) => ({
      category,
      bucket: bucketise(rs, "amount"),
      count: rs.length,
    }))
    .sort((a, b) => b.bucket.syp - a.bucket.syp);

  return { range, total: bucketise(rows, "amount"), byCategory };
}

// ── useManagerOverview: orchestrates all 5 fetches with realtime refresh ────

export interface ManagerOverview {
  summary: ManagerSummary | null;
  subs: SubscriptionBreakdown | null;
  members: MemberCategoryBreakdown | null;
  other: OtherIncomeBreakdown | null;
  expenses: ExpensesBreakdown | null;
}

const MANAGER_REALTIME_TABLES = [
  "gym_subscriptions",
  "sales",
  "inbody_sessions",
  "cash_sessions",
  "private_sessions",
  "expenses",
  "products",
] as const;

export function useManagerOverview(range: ManagerDateRange) {
  const supabase = supabaseBrowser();
  const [data, setData] = useState<ManagerOverview>({
    summary: null, subs: null, members: null, other: null, expenses: null,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [summary, subs, members, other, expenses] = await Promise.all([
        fetchManagerDashboardSummary(range),
        fetchSubscriptionBreakdown(range),
        fetchMemberCategoryBreakdown(),
        fetchOtherIncomeBreakdown(range),
        fetchExpensesBreakdown(range),
      ]);
      setData({ summary, subs, members, other, expenses });
    } catch (e) {
      console.error("useManagerOverview refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel(`manager-overview-${range.preset}-${range.startDate}-${range.endDate}`);
    for (const table of MANAGER_REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void refresh(),
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh, range.preset, range.startDate, range.endDate]);

  return { ...data, loading, refresh };
}
