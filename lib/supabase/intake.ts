"use client";

// All persistence to Supabase goes through this module.
// All amounts are stored in USD. The exchange rate is kept only for
// optional display conversion in the UI.

import { supabaseBrowser } from "./client";

export type Currency = "syp" | "usd";

// When NEXT_PUBLIC_LOCAL_AUTH=true all writes are no-ops and reads return
// sensible defaults. Remove this block (and IS_LOCAL guards below) before
// going to production with a real Supabase project.
const IS_LOCAL = process.env.NEXT_PUBLIC_LOCAL_AUTH === "true";
function localId() { return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export interface CurrentUser {
  id: string;
  displayName: string;
}

const FALLBACK_RATE = 13200;

function assertUser(user: CurrentUser | null | undefined): asserts user is CurrentUser {
  if (!user || !user.id) throw new Error("missing authenticated user");
}

function logErr(scope: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[supabase ${scope}]`, err);
}

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

// ── exchange rate ─────────────────────────────────────────────

const RATE_KEY = "exchange_rate_usd_syp";

export async function fetchExchangeRate(): Promise<number> {
  if (IS_LOCAL) return FALLBACK_RATE;
  try {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", RATE_KEY)
      .maybeSingle();
    const v = data?.value;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : FALLBACK_RATE;
  } catch (e) {
    logErr("fetch rate", e);
    return FALLBACK_RATE;
  }
}

export async function persistExchangeRate(user: CurrentUser, rate: number): Promise<{ error?: string }> {
  if (!Number.isFinite(rate) || rate <= 0) return { error: "سعر صرف غير صالح" };
  if (IS_LOCAL) return {};
  try {
    const supabase = supabaseBrowser();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: RATE_KEY, value: rate, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: "key" });
    if (error) return { error: error.message };
    await pushActivity({
      user,
      action: "exchange_rate_update",
      description: `تحديث سعر الصرف — 1$ = ${rate.toLocaleString("en-US")} ل.س`,
    });
    return {};
  } catch (e) {
    logErr("persist rate", e);
    return { error: String(e) };
  }
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
  if (IS_LOCAL) return;
  try {
    assertUser(opts.user);
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
  currency?: Currency;
  exchangeRate: number;
}): Promise<{ id?: string; error?: string }> {
  if (IS_LOCAL) return { id: localId() };
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.paidAmount < 0 || opts.amount < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const currency = opts.currency ?? "usd";
    const amountSYP = currency === "syp"
      ? Math.round(opts.paidAmount)
      : Math.round(opts.paidAmount * opts.exchangeRate);

    const { data, error } = await supabase
      .from("subscriptions")
      .insert({
        member_name: opts.memberName,
        plan_type: opts.planType,
        offer: opts.offer ?? "none",
        start_date: opts.startDate,
        end_date: opts.endDate,
        amount: opts.amount,
        paid_amount: opts.paidAmount,
        payment_status: opts.paymentStatus,
        currency,
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        status: "active",
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
      })
      .select("id")
      .single();

    if (error) { logErr("subscription insert", error); return { error: error.message }; }

    await pushActivity({
      user: opts.user,
      action: "subscription_create",
      description: `اشتراك جديد — ${opts.memberName} (${opts.planType}) — $${opts.paidAmount}`,
      amountUSD: currency === "usd" ? opts.paidAmount : undefined,
      entityType: "subscription",
      entityId: data?.id as string,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("subscription throw", e);
    return { error: String(e) };
  }
}

// ── store / kitchen sales ─────────────────────────────────────

export async function pushSale(opts: {
  user: CurrentUser;
  productName: string;
  productId?: string;
  quantity: number;
  unitPrice: number;   // USD
  total: number;       // USD
  currency?: Currency;
  exchangeRate: number;
  source?: "store" | "kitchen";
}): Promise<{ id?: string; error?: string }> {
  if (IS_LOCAL) return { id: localId() };
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.quantity <= 0 || opts.total < 0) return { error: "كمية أو مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const currency = opts.currency ?? "usd";
    const amountSYP = currency === "syp"
      ? Math.round(opts.total)
      : Math.round(opts.total * opts.exchangeRate);

    const { data, error } = await supabase
      .from("sales")
      .insert({
        product_id: opts.productId ?? null,
        product_name: opts.productName,
        quantity: opts.quantity,
        unit_price: opts.unitPrice,
        total: opts.total,
        currency,
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        source: opts.source ?? "store",
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
      })
      .select("id")
      .single();

    if (error) { logErr("sale insert", error); return { error: error.message }; }

    await pushActivity({
      user: opts.user,
      action: "sale_create",
      description: `بيع ${opts.quantity}× ${opts.productName} — $${opts.total}`,
      amountUSD: currency === "usd" ? opts.total : undefined,
      entityType: "sale",
      entityId: data?.id as string,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("sale throw", e);
    return { error: String(e) };
  }
}

// ── InBody sessions ───────────────────────────────────────────

export async function pushInBody(opts: {
  user: CurrentUser;
  memberName: string;
  memberType: "gym_member" | "non_member";
  amountUSD: number;   // fixed: $5 member / $8 non-member
  exchangeRate: number;
}): Promise<{ id?: string; error?: string }> {
  if (IS_LOCAL) return { id: localId() };
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.amountUSD < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = Math.round(opts.amountUSD * opts.exchangeRate);

    const { data, error } = await supabase
      .from("inbody_sessions")
      .insert({
        member_name: opts.memberName,
        session_type: opts.memberType,
        amount: opts.amountUSD,
        currency: "usd",
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
      })
      .select("id")
      .single();

    if (error) { logErr("inbody insert", error); return { error: error.message }; }

    await pushActivity({
      user: opts.user,
      action: "inbody_create",
      description: `جلسة InBody — ${opts.memberName} — $${opts.amountUSD}`,
      amountUSD: opts.amountUSD,
      entityType: "inbody",
      entityId: data?.id as string,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("inbody throw", e);
    return { error: String(e) };
  }
}

// ── Cancellation (soft-delete) ────────────────────────────────

export type CancellableTable = "sales" | "subscriptions" | "inbody_sessions";

export async function cancelTransaction(opts: {
  user: CurrentUser;
  table: CancellableTable;
  id: string;
  reason?: string;
}): Promise<{ error?: string }> {
  if (IS_LOCAL) return {};
  try {
    assertUser(opts.user);
    const supabase = supabaseBrowser();

    const { data: row, error: readErr } = await supabase
      .from(opts.table)
      .select("amount_syp, currency, cancelled_at, member_name, product_name, description")
      .eq("id", opts.id)
      .maybeSingle();
    if (readErr) return { error: readErr.message };
    if (!row) return { error: "العملية غير موجودة" };
    if (row.cancelled_at) return { error: "العملية ملغاة بالفعل" };

    const { error } = await supabase
      .from(opts.table)
      .update({
        cancelled_at: new Date().toISOString(),
        cancelled_by: opts.user.id,
        cancelled_reason: opts.reason ?? null,
      })
      .eq("id", opts.id);
    if (error) return { error: error.message };

    const label =
      (row as Record<string, unknown>).product_name ||
      (row as Record<string, unknown>).member_name ||
      (row as Record<string, unknown>).description ||
      "عملية";
    const amtSYP = Number((row as Record<string, unknown>).amount_syp ?? 0);

    await pushActivity({
      user: opts.user,
      action: `${opts.table}_cancel`,
      description: `إلغاء — ${label}${opts.reason ? ` (${opts.reason})` : ""}`,
      amountSYP: -amtSYP,
      entityType: opts.table,
      entityId: opts.id,
    });

    return {};
  } catch (e) {
    logErr("cancel throw", e);
    return { error: String(e) };
  }
}

// ── Session income helpers ────────────────────────────────────

export async function computeSessionIncome(sessionId: string): Promise<{
  subsTotal: number;
  inbodyTotal: number;
  storeTotal: number;
  mealsTotal: number;
  totalIncome: number;
}> {
  if (IS_LOCAL) return { subsTotal: 0, inbodyTotal: 0, storeTotal: 0, mealsTotal: 0, totalIncome: 0 };
  const supabase = supabaseBrowser();

  const sumUSD = async (table: string, col: string, filter?: { col: string; val: string }): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(col).eq("cash_session_id", sessionId).is("cancelled_at", null);
    if (filter) q = q.eq(filter.col, filter.val);
    const { data } = await q;
    return (data ?? []).reduce((a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0), 0);
  };

  const [subsTotal, inbodyTotal, storeTotal, mealsTotal] = await Promise.all([
    sumUSD("subscriptions",   "paid_amount"),
    sumUSD("inbody_sessions", "amount"),
    sumUSD("sales",           "total", { col: "source", val: "store" }),
    sumUSD("sales",           "total", { col: "source", val: "kitchen" }),
  ]);

  return {
    subsTotal:   Number(subsTotal.toFixed(2)),
    inbodyTotal: Number(inbodyTotal.toFixed(2)),
    storeTotal:  Number(storeTotal.toFixed(2)),
    mealsTotal:  Number(mealsTotal.toFixed(2)),
    totalIncome: Number((subsTotal + inbodyTotal + storeTotal + mealsTotal).toFixed(2)),
  };
}

export async function computePreviousSessionsIncome(currentSessionId: string): Promise<{
  subsTotal: number;
  inbodyTotal: number;
  storeTotal: number;
  mealsTotal: number;
}> {
  if (IS_LOCAL) return { subsTotal: 0, inbodyTotal: 0, storeTotal: 0, mealsTotal: 0 };
  const supabase = supabaseBrowser();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: prevSessions } = await supabase
    .from("cash_sessions")
    .select("id")
    .eq("status", "closed")
    .gte("opened_at", todayStart.toISOString())
    .neq("id", currentSessionId);

  if (!prevSessions || prevSessions.length === 0) {
    return { subsTotal: 0, inbodyTotal: 0, storeTotal: 0, mealsTotal: 0 };
  }

  const sessionIds = (prevSessions as { id: string }[]).map((s) => s.id);

  const sumUSD = async (table: string, col: string, filter?: { col: string; val: string }): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(col).in("cash_session_id", sessionIds).is("cancelled_at", null);
    if (filter) q = q.eq(filter.col, filter.val);
    const { data } = await q;
    return (data ?? []).reduce((a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0), 0);
  };

  const [subsTotal, inbodyTotal, storeTotal, mealsTotal] = await Promise.all([
    sumUSD("subscriptions",   "paid_amount"),
    sumUSD("inbody_sessions", "amount"),
    sumUSD("sales",           "total", { col: "source", val: "store" }),
    sumUSD("sales",           "total", { col: "source", val: "kitchen" }),
  ]);

  return {
    subsTotal:   Number(subsTotal.toFixed(2)),
    inbodyTotal: Number(inbodyTotal.toFixed(2)),
    storeTotal:  Number(storeTotal.toFixed(2)),
    mealsTotal:  Number(mealsTotal.toFixed(2)),
  };
}

// ── Cash session lifecycle ────────────────────────────────────

export async function fetchHandoffOpening(): Promise<{ openingUSD: number; previousSessionId: string | null }> {
  if (IS_LOCAL) return { openingUSD: 0, previousSessionId: null };
  try {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("last_closed_session_for_today");
    if (error) { logErr("handoff rpc", error); return { openingUSD: 0, previousSessionId: null }; }
    const row = Array.isArray(data) && data.length > 0
      ? data[0] as { id: string; actual_cash: number }
      : null;
    return {
      openingUSD: row ? Number(row.actual_cash ?? 0) : 0,
      previousSessionId: row?.id ?? null,
    };
  } catch (e) {
    logErr("handoff throw", e);
    return { openingUSD: 0, previousSessionId: null };
  }
}

export async function openCashSession(user: CurrentUser, openingCashUSDOverride?: number) {
  if (IS_LOCAL) return { id: localId() };
  try {
    assertUser(user);
    const supabase = supabaseBrowser();
    const { data: existing } = await supabase
      .from("cash_sessions")
      .select("id")
      .eq("opened_by", user.id)
      .eq("status", "open");
    if (existing && existing.length > 0) {
      return { error: "لديك جلسة مفتوحة بالفعل. أغلقها أولاً." };
    }

    const handoff = await fetchHandoffOpening();
    const openingCash   = openingCashUSDOverride ?? handoff.openingUSD;
    const opening_locked = handoff.previousSessionId !== null;

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by:          user.id,
        employee_name:      user.displayName,
        opening_cash:       openingCash,
        previous_session_id: handoff.previousSessionId,
        opening_locked,
        status: "open",
      })
      .select("id")
      .single();
    if (error) return { error: error.message };

    await pushActivity({
      user,
      action: "session_opened",
      description: opening_locked
        ? `فتح جلسة نقدية — استلام من الوردية السابقة $${openingCash.toFixed(2)}`
        : `فتح جلسة نقدية — أول وردية اليوم — افتتاحي $${openingCash.toFixed(2)}`,
      amountUSD: openingCash,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("open session throw", e);
    return { error: String(e) };
  }
}

export async function closeCashSession(
  user: CurrentUser,
  sessionId: string,
  actualCashUSD: number,
) {
  if (IS_LOCAL) return {};
  try {
    assertUser(user);
    const supabase = supabaseBrowser();

    const { error } = await supabase
      .from("cash_sessions")
      .update({
        closed_by:   user.id,
        closed_at:   new Date().toISOString(),
        actual_cash: actualCashUSD,
        status:      "closed",
      })
      .eq("id", sessionId);
    if (error) return { error: error.message };

    await pushActivity({
      user,
      action: "session_closed",
      description: `إغلاق جلسة — المبلغ الفعلي: $${actualCashUSD.toFixed(2)}`,
      amountUSD: actualCashUSD,
    });

    return {};
  } catch (e) {
    logErr("close session throw", e);
    return { error: String(e) };
  }
}
