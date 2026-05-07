"use client";

import { supabaseBrowser } from "./client";

export interface ActiveSession {
  id: string;
  openingCash: number;
  openedAt: string;
  openedBy: string;
  employeeName: string;
}

export interface SessionIncome {
  subsIncome: number;
  storeIncome: number;
  mealsIncome: number;
  inbodyIncome: number;
  totalIncome: number;
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  try {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("cash_sessions")
      .select("id, opening_cash, opened_at, opened_by")
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const d = data as Record<string, unknown>;
    const openedBy = String(d.opened_by ?? "");
    let employeeName = "";
    if (openedBy) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", openedBy)
        .maybeSingle();
      employeeName = String((profile as Record<string, unknown> | null)?.display_name ?? "");
    }
    return {
      id: String(d.id),
      openingCash: Number(d.opening_cash ?? 0),
      openedAt: String(d.opened_at ?? ""),
      openedBy,
      employeeName,
    };
  } catch {
    return null;
  }
}

export async function getLastClosedSession(): Promise<{ id: string; actualCash: number; openedByName: string } | null> {
  try {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("cash_sessions")
      .select("id, actual_cash, opened_by")
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const d = data as Record<string, unknown>;
    const openedBy = String(d.opened_by ?? "");
    let openedByName = "";
    if (openedBy) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", openedBy)
        .maybeSingle();
      openedByName = String((profile as Record<string, unknown> | null)?.display_name ?? "");
    }
    return {
      id: String(d.id),
      actualCash: Number(d.actual_cash ?? 0),
      openedByName,
    };
  } catch {
    return null;
  }
}

export async function fetchSessionIncome(sessionId: string): Promise<SessionIncome> {
  const supabase = supabaseBrowser();

  // For subscriptions and inbody (still on legacy currency+rate columns)
  // we keep the per-row USD normalization. For item_sales we read the
  // GENERATED amount_usd column directly — no math needed.
  const sumLegacyUSD = async (
    table: "gym_subscriptions" | "inbody_sessions",
    amountCol: string,
  ): Promise<number> => {
    const select = `${amountCol}, currency, exchange_rate`;
    const { data } = await supabase
      .from(table)
      .select(select)
      .eq("cash_session_id", sessionId)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%");
    return (data ?? []).reduce((a: number, r: unknown) => {
      const row    = r as Record<string, unknown>;
      const amount = Number(row[amountCol] ?? 0);
      const cur    = String(row.currency ?? "usd");
      const rate   = Number(row.exchange_rate ?? 1) || 1;
      return a + (cur === "syp" ? amount / rate : amount);
    }, 0);
  };

  const sumItemSalesUSD = async (source: "store" | "kitchen"): Promise<number> => {
    const { data } = await supabase
      .from("item_sales")
      .select("amount_usd")
      .eq("cash_session_id", sessionId)
      .eq("source", source)
      .is("cancelled_at", null);
    return (data ?? []).reduce(
      (a: number, r: unknown) => a + Number((r as Record<string, unknown>).amount_usd ?? 0),
      0,
    );
  };

  const [sub, store, meals, inbody] = await Promise.all([
    sumLegacyUSD("gym_subscriptions", "paid_amount"),
    sumItemSalesUSD("store"),
    sumItemSalesUSD("kitchen"),
    sumLegacyUSD("inbody_sessions", "amount"),
  ]);
  return {
    subsIncome:   Number(sub.toFixed(2)),
    storeIncome:  Number(store.toFixed(2)),
    mealsIncome:  Number(meals.toFixed(2)),
    inbodyIncome: Number(inbody.toFixed(2)),
    totalIncome:  Number((sub + store + meals + inbody).toFixed(2)),
  };
}
