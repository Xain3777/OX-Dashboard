"use client";

// Shadow-write helpers: fire-and-forget pushes to Supabase mirroring
// existing local store actions. If insert fails (offline, bad RLS, etc.)
// we log to console and the local UI keeps working.

import { supabaseBrowser } from "./client";

type Currency = "syp" | "usd";

export interface CurrentUser {
  id: string;          // auth.users.id (uuid)
  displayName: string;
}

// ── helpers ───────────────────────────────────────────────────

async function getOpenSessionId(userId: string): Promise<string | null> {
  const supabase = supabaseBrowser();
  const { data } = await supabase
    .from("cash_sessions")
    .select("id")
    .eq("opened_by", userId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function logErr(scope: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[supabase ${scope}]`, err);
}

// ── activity feed ─────────────────────────────────────────────

export async function pushActivity(opts: {
  user: CurrentUser;
  action: string;
  description: string;
  amountSYP?: number;
  amountUSD?: number;
  entityType?: string;
  entityId?: string;
}) {
  try {
    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const { error } = await supabase.from("activity_feed").insert({
      action: opts.action,
      description: opts.description,
      amount_syp: opts.amountSYP ?? null,
      amount_usd: opts.amountUSD ?? null,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
      created_by_name: opts.user.displayName,
    });
    if (error) logErr("activity insert", error);
  } catch (e) {
    logErr("activity throw", e);
  }
}

// ── subscriptions ─────────────────────────────────────────────

export async function pushSubscription(opts: {
  user: CurrentUser;
  memberName: string;
  planType: string;
  offer?: string;
  startDate: string;
  endDate: string;
  amount: number;
  paidAmount: number;
  paymentStatus: "paid" | "partial" | "unpaid";
  currency: Currency;
}) {
  try {
    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const { error } = await supabase.from("subscriptions").insert({
      member_name: opts.memberName,
      plan_type: opts.planType,
      offer: opts.offer ?? "none",
      start_date: opts.startDate,
      end_date: opts.endDate,
      amount: opts.amount,
      paid_amount: opts.paidAmount,
      payment_status: opts.paymentStatus,
      currency: opts.currency,
      status: "active",
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
    });
    if (error) logErr("subscription insert", error);
  } catch (e) {
    logErr("subscription throw", e);
  }
}

// ── store / kitchen sales ─────────────────────────────────────

export async function pushSale(opts: {
  user: CurrentUser;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  currency: Currency;
  source?: "store" | "kitchen";
}) {
  try {
    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const { error } = await supabase.from("sales").insert({
      product_name: opts.productName,
      quantity: opts.quantity,
      unit_price: opts.unitPrice,
      total: opts.total,
      currency: opts.currency,
      source: opts.source ?? "store",
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
    });
    if (error) logErr("sale insert", error);
  } catch (e) {
    logErr("sale throw", e);
  }
}

// ── InBody sessions ───────────────────────────────────────────

export async function pushInBody(opts: {
  user: CurrentUser;
  memberName: string;
  sessionType: "single" | "package_5" | "package_10";
  amount: number;
  currency: Currency;
}) {
  try {
    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const { error } = await supabase.from("inbody_sessions").insert({
      member_name: opts.memberName,
      session_type: opts.sessionType,
      amount: opts.amount,
      currency: opts.currency,
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
    });
    if (error) logErr("inbody insert", error);
  } catch (e) {
    logErr("inbody throw", e);
  }
}

// ── cash sessions ─────────────────────────────────────────────

export async function openCashSession(user: CurrentUser, openingCashSYP: number) {
  const supabase = supabaseBrowser();
  // close any prior open session for this user (defensive)
  const { data: existing } = await supabase
    .from("cash_sessions")
    .select("id")
    .eq("opened_by", user.id)
    .eq("status", "open");
  if (existing && existing.length > 0) {
    return { error: "لديك جلسة مفتوحة بالفعل. أغلقها أولاً." };
  }
  const { data, error } = await supabase
    .from("cash_sessions")
    .insert({
      opened_by: user.id,
      opening_cash_syp: openingCashSYP,
      status: "open",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await pushActivity({
    user,
    action: "session_opened",
    description: `فتح جلسة نقدية — رصيد افتتاحي ${openingCashSYP.toLocaleString("en-US")} ل.س`,
    amountSYP: openingCashSYP,
  });
  return { id: data?.id as string };
}

export async function closeCashSession(
  user: CurrentUser,
  sessionId: string,
  closingCashSYP: number
) {
  const supabase = supabaseBrowser();

  // Compute expected = opening + sum(SYP intake)
  const { data: sess } = await supabase
    .from("cash_sessions")
    .select("opening_cash_syp")
    .eq("id", sessionId)
    .maybeSingle();
  const opening = Number(sess?.opening_cash_syp ?? 0);

  const sumSYP = async (table: string, amountCol: string) => {
    const { data } = await supabase
      .from(table)
      .select(`${amountCol}, currency`)
      .eq("cash_session_id", sessionId)
      .eq("currency", "syp");
    return (data ?? []).reduce(
      (a: number, r: Record<string, unknown>) => a + Number(r[amountCol] ?? 0),
      0
    );
  };
  const subsTotal   = await sumSYP("subscriptions",   "paid_amount");
  const salesTotal  = await sumSYP("sales",           "total");
  const inbodyTotal = await sumSYP("inbody_sessions", "amount");
  const expectedCash = opening + subsTotal + salesTotal + inbodyTotal;
  const discrepancy  = closingCashSYP - expectedCash;

  const { error } = await supabase
    .from("cash_sessions")
    .update({
      closed_by: user.id,
      closed_at: new Date().toISOString(),
      closing_cash_syp: closingCashSYP,
      expected_cash_syp: expectedCash,
      discrepancy_syp: discrepancy,
      status: "closed",
    })
    .eq("id", sessionId);
  if (error) return { error: error.message };

  await pushActivity({
    user,
    action: "session_closed",
    description: `إغلاق جلسة — متوقع ${expectedCash.toLocaleString("en-US")} ل.س — فعلي ${closingCashSYP.toLocaleString("en-US")} ل.س — فرق ${discrepancy.toLocaleString("en-US")} ل.س`,
    amountSYP: closingCashSYP,
  });

  return { expectedCash, discrepancy };
}
