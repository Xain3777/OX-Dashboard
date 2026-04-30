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
    sumUSD("subscriptions",   "paid_amount", today),
    sumUSD("sales",           "total",       today, "store"),
    sumUSD("sales",           "total",       today, "kitchen"),
    sumUSD("inbody_sessions", "amount",      today),
    sumUSD("subscriptions",   "paid_amount", month),
    sumUSD("sales",           "total",       month, "store"),
    sumUSD("sales",           "total",       month, "kitchen"),
    sumUSD("inbody_sessions", "amount",      month),
    supabase
      .from("subscriptions")
      .select("member_name", { count: "exact", head: true })
      .eq("status", "active")
      .is("cancelled_at", null),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", todayISO())
      .lte("end_date", inSevenDaysISO()),
    // "Ended" = expired explicitly OR an active row whose end_date is in
    // the past. Cancelled rows are excluded. We can't combine `.or()` with
    // a chained `.is()` (it AND-merges in a way that breaks the OR group),
    // so encode the cancellation guard inside the OR filter itself.
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .or(
        `and(status.eq.expired,cancelled_at.is.null),` +
        `and(status.eq.active,end_date.lt.${todayISO()},cancelled_at.is.null)`
      ),
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

export interface DailyReportRow {
  time: string;
  type: "subscription" | "sale_store" | "sale_kitchen" | "inbody" | "expense";
  description: string;
  by: string;
  amount: number; // positive = income, negative = expense
}

export interface DailyReport {
  date: string;
  sessionsCount: number;
  totalIncome: number;
  totalExpenses: number;
  net: number;
  rows: DailyReportRow[];
}

export async function fetchDailyReport(date: string): Promise<DailyReport> {
  const supabase = supabaseBrowser();
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd   = `${date}T23:59:59.999Z`;

  // Fetch sessions for the day to get session IDs
  const { data: sessions } = await supabase
    .from("cash_sessions")
    .select("id")
    .gte("opened_at", dayStart)
    .lte("opened_at", dayEnd);

  const sessionIds = (sessions ?? []).map((s: Record<string, unknown>) => String(s.id));

  // Fetch profiles for name resolution
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name");
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    const pr = p as Record<string, unknown>;
    nameMap[String(pr.id)] = String(pr.display_name ?? "");
  }

  const rows: DailyReportRow[] = [];

  if (sessionIds.length > 0) {
    // Subscriptions
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("created_at, member_name, paid_amount, created_by")
      .in("cash_session_id", sessionIds)
      .is("cancelled_at", null);
    for (const s of subs ?? []) {
      const r = s as Record<string, unknown>;
      rows.push({
        time: String(r.created_at ?? ""),
        type: "subscription",
        description: `اشتراك — ${String(r.member_name ?? "")}`,
        by: nameMap[String(r.created_by ?? "")] ?? String(r.created_by ?? ""),
        amount: Number(r.paid_amount ?? 0),
      });
    }

    // Store sales
    const { data: storeSales } = await supabase
      .from("sales")
      .select("created_at, product_name, quantity, total, created_by_name")
      .in("cash_session_id", sessionIds)
      .eq("source", "store")
      .is("cancelled_at", null);
    for (const s of storeSales ?? []) {
      const r = s as Record<string, unknown>;
      const qty = Number(r.quantity ?? 1);
      const name = String(r.product_name ?? "");
      rows.push({
        time: String(r.created_at ?? ""),
        type: "sale_store",
        description: `متجر — ${qty}× ${name}`,
        by: String(r.created_by_name ?? ""),
        amount: Number(r.total ?? 0),
      });
    }

    // Kitchen sales
    const { data: kitchenSales } = await supabase
      .from("sales")
      .select("created_at, product_name, quantity, total, created_by_name")
      .in("cash_session_id", sessionIds)
      .eq("source", "kitchen")
      .is("cancelled_at", null);
    for (const s of kitchenSales ?? []) {
      const r = s as Record<string, unknown>;
      const qty = Number(r.quantity ?? 1);
      const name = String(r.product_name ?? "");
      rows.push({
        time: String(r.created_at ?? ""),
        type: "sale_kitchen",
        description: `مطبخ — ${qty}× ${name}`,
        by: String(r.created_by_name ?? ""),
        amount: Number(r.total ?? 0),
      });
    }

    // InBody sessions
    const { data: inbody } = await supabase
      .from("inbody_sessions")
      .select("created_at, member_name, amount, created_by_name")
      .in("cash_session_id", sessionIds)
      .is("cancelled_at", null);
    for (const s of inbody ?? []) {
      const r = s as Record<string, unknown>;
      rows.push({
        time: String(r.created_at ?? ""),
        type: "inbody",
        description: `InBody — ${String(r.member_name ?? "")}`,
        by: String(r.created_by_name ?? ""),
        amount: Number(r.amount ?? 0),
      });
    }

    // Expenses — `expenses` stores the raw amount + currency + an SYP snapshot.
    // Convert SYP rows to USD using the snapshot ratio so the daily total is
    // single-currency.
    const { data: expenses } = await supabase
      .from("expenses")
      .select("created_at, description, amount, amount_syp, currency, exchange_rate, created_by")
      .in("cash_session_id", sessionIds)
      .is("cancelled_at", null);
    for (const s of expenses ?? []) {
      const r = s as Record<string, unknown>;
      const currency = String(r.currency ?? "usd");
      const amount = Number(r.amount ?? 0);
      const rate = Number(r.exchange_rate ?? 0);
      const usdAmount = currency === "syp" && rate > 0 ? amount / rate : amount;
      rows.push({
        time: String(r.created_at ?? ""),
        type: "expense",
        description: `مصروف — ${String(r.description ?? "")}`,
        by: nameMap[String(r.created_by ?? "")] ?? String(r.created_by ?? ""),
        amount: -Number(usdAmount.toFixed(2)),
      });
    }
  }

  rows.sort((a, b) => a.time.localeCompare(b.time));

  const totalIncome   = rows.filter(r => r.amount > 0).reduce((a, r) => a + r.amount, 0);
  const totalExpenses = rows.filter(r => r.amount < 0).reduce((a, r) => a + Math.abs(r.amount), 0);

  return {
    date,
    sessionsCount: sessionIds.length,
    totalIncome:   Number(totalIncome.toFixed(2)),
    totalExpenses: Number(totalExpenses.toFixed(2)),
    net:           Number((totalIncome - totalExpenses).toFixed(2)),
    rows,
  };
}

const REALTIME_TABLES = [
  "subscriptions",
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
