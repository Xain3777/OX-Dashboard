"use client";

// Live dashboard data: pulls KPIs + alerts straight from Supabase and
// subscribes to realtime changes so the UI never goes stale.

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "./client";
import { fetchExchangeRate, getCurrentBusinessDate } from "./intake";

export interface LiveKPI {
  todayRevenueUSD: number;
  activeMembers: number;
  expiringThisWeek: number;
  endedCount: number;
  cashOnHandSYP: number;
  cashOnHandUSD: number;
  lowStockItems: number;
}

const ZERO: LiveKPI = {
  todayRevenueUSD: 0,
  activeMembers: 0,
  expiringThisWeek: 0,
  endedCount: 0,
  cashOnHandSYP: 0,
  cashOnHandUSD: 0,
  lowStockItems: 0,
};

function inSevenDaysISO() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(23, 59, 59, 999);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function sumAmountSypToday(table: string): Promise<number> {
  const supabase = supabaseBrowser();
  const businessDate = getCurrentBusinessDate();
  // Approximate: rows whose session is today's business date session
  // For simplicity use created_at >= start of Latakia business day
  const latakiaOffset = 3 * 60 * 60 * 1000;
  const now = Date.now() + latakiaOffset;
  const d = new Date(now);
  const hour = d.getUTCHours();
  if (hour < 6) d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(3, 0, 0, 0); // 06:00 local = 03:00 UTC
  const since = d.toISOString();

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
  const businessDate = getCurrentBusinessDate();

  const [
    rate,
    subsToday,
    salesToday,
    inbodyToday,
    activeSubs,
    expiringSoon,
    endedSubs,
    openSessions,
    lowStock,
  ] = await Promise.all([
    fetchExchangeRate(),
    sumAmountSypToday("subscriptions"),
    sumAmountSypToday("sales"),
    sumAmountSypToday("inbody_sessions"),
    supabase.from("subscriptions").select("member_name", { count: "exact", head: true })
      .eq("status", "active").is("cancelled_at", null),
    supabase.from("subscriptions").select("id", { count: "exact", head: true })
      .eq("status", "active").is("cancelled_at", null)
      .gte("end_date", todayISO()).lte("end_date", inSevenDaysISO()),
    supabase.from("subscriptions").select("id", { count: "exact", head: true })
      .or(`status.eq.expired,end_date.lt.${todayISO()}`).is("cancelled_at", null),
    supabase.from("cash_sessions").select("id")
      .eq("business_date", businessDate).eq("status", "open").limit(1),
    supabase.from("products").select("id, stock, low_stock_threshold"),
  ]);

  const todayRevenueSYP = subsToday + salesToday + inbodyToday;
  const cashOnHandSYP = openSessions.data && openSessions.data.length > 0 ? todayRevenueSYP : 0;

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
    lowStockItems: lowStockCount,
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
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void refresh());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh]);

  return { kpi, loading, refresh };
}
