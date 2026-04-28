"use client";

// Live KPIs — all amounts in USD, derived entirely from Supabase.
// No expenses, no discrepancy logic, no SYP conversions here.

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "./client";

const IS_LOCAL = process.env.NEXT_PUBLIC_LOCAL_AUTH !== "false";

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
  if (IS_LOCAL) return ZERO;
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
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .or(`status.eq.expired,end_date.lt.${todayISO()}`)
      .is("cancelled_at", null),
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
  const [loading, setLoading] = useState(!IS_LOCAL);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchLiveKPI();
      setKpi(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (IS_LOCAL) { setLoading(false); return; }
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
