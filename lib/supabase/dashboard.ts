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
}

const ZERO: LiveKPI = {
  todayRevenueUSD: 0,
  activeMembers: 0,
  expiringThisWeek: 0,
  endedCount: 0,
  cashOnHandUSD: 0,
  lowStockItems: 0,
  monthlyRevenueUSD: 0,
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

  return {
    todayRevenueUSD:   Number(todayRevenueUSD.toFixed(2)),
    activeMembers:     activeSubs.count ?? 0,
    expiringThisWeek:  expiringSoon.count ?? 0,
    endedCount:        endedSubs.count ?? 0,
    cashOnHandUSD:     Number(cashOnHandUSD.toFixed(2)),
    lowStockItems:     lowStockCount,
    monthlyRevenueUSD: Number(monthlyRevenueUSD.toFixed(2)),
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
