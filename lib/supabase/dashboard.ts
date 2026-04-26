"use client";

// Live dashboard data: pulls KPIs + alerts straight from Supabase and
// subscribes to realtime changes so the UI never goes stale.

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "./client";
import { fetchExchangeRate } from "./intake";

export interface LiveKPI {
  todayRevenueUSD: number;       // sum of amount_syp for today / live FX
  activeMembers: number;         // distinct member_name on active subs
  expiringThisWeek: number;
  endedCount: number;
  cashOnHandSYP: number;         // currently-open sessions, opening + intake - expenses
  cashOnHandUSD: number;
  expectedCashSYP: number;
  actualCashSYP: number;         // sum of last-known close for today
  cashDifferenceSYP: number;     // expected - actual (over all closed shifts today)
  unresolvedDiscrepancies: number;
  lowStockItems: number;
  monthlyProfit: number;         // USD
}

const ZERO: LiveKPI = {
  todayRevenueUSD: 0,
  activeMembers: 0,
  expiringThisWeek: 0,
  endedCount: 0,
  cashOnHandSYP: 0,
  cashOnHandUSD: 0,
  expectedCashSYP: 0,
  actualCashSYP: 0,
  cashDifferenceSYP: 0,
  unresolvedDiscrepancies: 0,
  lowStockItems: 0,
  monthlyProfit: 0,
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function inSevenDaysISO() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 59, 999);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function sumAmountSypToday(table: string): Promise<number> {
  const supabase = supabaseBrowser();
  const since = startOfTodayISO();
  const { data } = await supabase
    .from(table)
    .select("amount_syp")
    .gte("created_at", since)
    .is("cancelled_at", null);
  return (data ?? []).reduce(
    (a: number, r: Record<string, unknown>) => a + Number(r.amount_syp ?? 0),
    0
  );
}

async function sumAmountSypMonth(table: string): Promise<number> {
  const supabase = supabaseBrowser();
  const since = startOfMonthISO();
  const { data } = await supabase
    .from(table)
    .select("amount_syp")
    .gte("created_at", since)
    .is("cancelled_at", null);
  return (data ?? []).reduce(
    (a: number, r: Record<string, unknown>) => a + Number(r.amount_syp ?? 0),
    0
  );
}

export async function fetchLiveKPI(): Promise<LiveKPI> {
  const supabase = supabaseBrowser();

  const [
    rate,
    subsToday,
    salesToday,
    inbodyToday,
    expensesToday,
    subsMonth,
    salesMonth,
    inbodyMonth,
    expensesMonth,
    activeSubs,
    expiringSoon,
    endedSubs,
    openSessions,
    closedToday,
    discCount,
    lowStock,
  ] = await Promise.all([
    fetchExchangeRate(),
    sumAmountSypToday("subscriptions"),
    sumAmountSypToday("sales"),
    sumAmountSypToday("inbody_sessions"),
    sumAmountSypToday("expenses"),
    sumAmountSypMonth("subscriptions"),
    sumAmountSypMonth("sales"),
    sumAmountSypMonth("inbody_sessions"),
    sumAmountSypMonth("expenses"),
    supabase.from("subscriptions").select("member_name", { count: "exact", head: true })
      .eq("status", "active").is("cancelled_at", null),
    supabase.from("subscriptions").select("id", { count: "exact", head: true })
      .eq("status", "active").is("cancelled_at", null)
      .gte("end_date", todayISO()).lte("end_date", inSevenDaysISO()),
    supabase.from("subscriptions").select("id", { count: "exact", head: true })
      .or(`status.eq.expired,end_date.lt.${todayISO()}`).is("cancelled_at", null),
    supabase.from("cash_sessions").select("opening_cash_syp")
      .eq("status", "open"),
    supabase.from("cash_sessions").select("expected_cash_syp, closing_cash_syp, discrepancy_syp")
      .eq("status", "closed").gte("closed_at", startOfTodayISO()),
    supabase.from("discrepancy_logs").select("id", { count: "exact", head: true })
      .eq("resolved", false),
    supabase.from("products").select("id, stock, low_stock_threshold"),
  ]);

  const todayRevenueSYP = subsToday + salesToday + inbodyToday;
  const monthRevenueSYP = subsMonth + salesMonth + inbodyMonth;
  const monthlyProfitSYP = monthRevenueSYP - expensesMonth;

  const openOpening = (openSessions.data ?? []).reduce(
    (a: number, r: Record<string, unknown>) => a + Number(r.opening_cash_syp ?? 0), 0
  );
  // Expected cash on hand = opening of every open session + today's intake - today's expenses.
  const cashOnHandSYP = openOpening + todayRevenueSYP - expensesToday;

  // Aggregate over closed shifts today: sum expected vs actual.
  const closedRows = (closedToday.data ?? []) as Array<Record<string, unknown>>;
  const expectedSum = closedRows.reduce((a, r) => a + Number(r.expected_cash_syp ?? 0), 0);
  const actualSum   = closedRows.reduce((a, r) => a + Number(r.closing_cash_syp ?? 0), 0);

  const lowStockCount = (lowStock.data ?? []).filter(
    (p: Record<string, unknown>) => Number(p.stock ?? 0) <= Number(p.low_stock_threshold ?? 0)
  ).length;

  return {
    todayRevenueUSD: rate > 0 ? todayRevenueSYP / rate : 0,
    activeMembers: activeSubs.count ?? 0,
    expiringThisWeek: expiringSoon.count ?? 0,
    endedCount: endedSubs.count ?? 0,
    cashOnHandSYP,
    cashOnHandUSD: rate > 0 ? cashOnHandSYP / rate : 0,
    expectedCashSYP: expectedSum,
    actualCashSYP:   actualSum,
    cashDifferenceSYP: expectedSum - actualSum,
    unresolvedDiscrepancies: discCount.count ?? 0,
    lowStockItems: lowStockCount,
    monthlyProfit: rate > 0 ? monthlyProfitSYP / rate : 0,
  };
}

const REALTIME_TABLES = [
  "subscriptions",
  "sales",
  "inbody_sessions",
  "expenses",
  "cash_sessions",
  "discrepancy_logs",
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
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void refresh());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh]);

  return { kpi, loading, refresh };
}
