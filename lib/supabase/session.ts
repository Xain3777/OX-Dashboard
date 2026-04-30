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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sumCol = async (
    table: string,
    col: string,
    extra?: { col: string; val: string },
    excludeTestMembers?: boolean,
  ): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(col).eq("cash_session_id", sessionId).is("cancelled_at", null);
    if (extra) q = q.eq(extra.col, extra.val);
    if (excludeTestMembers) q = q.not("member_name", "ilike", "%test%");
    const { data } = await q;
    return (data ?? []).reduce(
      (a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0),
      0
    );
  };
  const [sub, store, meals, inbody] = await Promise.all([
    sumCol("gym_subscriptions", "paid_amount", undefined, true),
    sumCol("sales",             "total", { col: "source", val: "store" }),
    sumCol("sales",             "total", { col: "source", val: "kitchen" }),
    sumCol("inbody_sessions",   "amount", undefined, true),
  ]);
  return {
    subsIncome:   Number(sub.toFixed(2)),
    storeIncome:  Number(store.toFixed(2)),
    mealsIncome:  Number(meals.toFixed(2)),
    inbodyIncome: Number(inbody.toFixed(2)),
    totalIncome:  Number((sub + store + meals + inbody).toFixed(2)),
  };
}
