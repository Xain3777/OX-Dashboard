"use client";

// All persistence to Supabase goes through this module.
// Every transaction stores:
//   • amount        — value entered, in `currency`
//   • currency      — 'syp' | 'usd'
//   • exchange_rate — USD→SYP rate at time of insert (immutable)
//   • amount_syp    — SYP-equivalent at time of insert (immutable)
// Reports/totals always sum amount_syp so historical values never shift
// when the live exchange rate changes.

import { supabaseBrowser } from "./client";

export type Currency = "syp" | "usd";

export interface CurrentUser {
  id: string;          // auth.users.id (uuid)
  displayName: string;
}

const FALLBACK_RATE = 13200;

// ── helpers ───────────────────────────────────────────────────

function assertUser(user: CurrentUser | null | undefined): asserts user is CurrentUser {
  if (!user || !user.id) throw new Error("missing authenticated user");
}

function snapshotSYP(amount: number, currency: Currency, rate: number): number {
  if (currency === "syp") return Math.round(amount);
  return Math.round(amount * rate);
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

function logErr(scope: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[supabase ${scope}]`, err);
}

// ── exchange rate (persisted in app_settings) ─────────────────

const RATE_KEY = "exchange_rate_usd_syp";

export async function fetchExchangeRate(): Promise<number> {
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
  currency: Currency;
  exchangeRate: number;
}): Promise<{ id?: string; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.currency) return { error: "العملة مطلوبة" };
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.paidAmount < 0 || opts.amount < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = snapshotSYP(opts.paidAmount, opts.currency, opts.exchangeRate);

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
        currency: opts.currency,
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
      description: `اشتراك جديد — ${opts.memberName} (${opts.planType})`,
      amountSYP: opts.currency === "syp" ? opts.paidAmount : undefined,
      amountUSD: opts.currency === "usd" ? opts.paidAmount : undefined,
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
  unitPrice: number;
  total: number;
  currency: Currency;
  exchangeRate: number;
  source?: "store" | "kitchen";
}): Promise<{ id?: string; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.currency) return { error: "العملة مطلوبة" };
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.quantity <= 0 || opts.total < 0) return { error: "كمية أو مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = snapshotSYP(opts.total, opts.currency, opts.exchangeRate);

    const { data, error } = await supabase
      .from("sales")
      .insert({
        product_id: opts.productId ?? null,
        product_name: opts.productName,
        quantity: opts.quantity,
        unit_price: opts.unitPrice,
        total: opts.total,
        currency: opts.currency,
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
      description: `بيع ${opts.quantity}× ${opts.productName}`,
      amountSYP: opts.currency === "syp" ? opts.total : undefined,
      amountUSD: opts.currency === "usd" ? opts.total : undefined,
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
  sessionType: "single" | "package_5" | "package_10";
  amount: number;
  currency: Currency;
  exchangeRate: number;
}): Promise<{ id?: string; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.currency) return { error: "العملة مطلوبة" };
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.amount < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = snapshotSYP(opts.amount, opts.currency, opts.exchangeRate);

    const { data, error } = await supabase
      .from("inbody_sessions")
      .insert({
        member_name: opts.memberName,
        session_type: opts.sessionType,
        amount: opts.amount,
        currency: opts.currency,
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
      description: `جلسة InBody — ${opts.memberName}`,
      amountSYP: opts.currency === "syp" ? opts.amount : undefined,
      amountUSD: opts.currency === "usd" ? opts.amount : undefined,
      entityType: "inbody",
      entityId: data?.id as string,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("inbody throw", e);
    return { error: String(e) };
  }
}

// ── Expenses ──────────────────────────────────────────────────

export async function pushExpense(opts: {
  user: CurrentUser;
  description: string;
  amount: number;
  currency: Currency;
  category?: string;
  exchangeRate: number;
}): Promise<{ id?: string; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.currency) return { error: "العملة مطلوبة" };
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.amount < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = snapshotSYP(opts.amount, opts.currency, opts.exchangeRate);

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        description: opts.description,
        amount: opts.amount,
        currency: opts.currency,
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        category: opts.category ?? "other",
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
      })
      .select("id")
      .single();

    if (error) { logErr("expense insert", error); return { error: error.message }; }

    await pushActivity({
      user: opts.user,
      action: "expense_create",
      description: `مصروف: ${opts.description}`,
      amountSYP: opts.currency === "syp" ? opts.amount : undefined,
      amountUSD: opts.currency === "usd" ? opts.amount : undefined,
      entityType: "expense",
      entityId: data?.id as string,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("expense throw", e);
    return { error: String(e) };
  }
}

// ── Cancellation (soft-delete) ────────────────────────────────

export type CancellableTable = "sales" | "subscriptions" | "inbody_sessions" | "expenses";

export async function cancelTransaction(opts: {
  user: CurrentUser;
  table: CancellableTable;
  id: string;
  reason?: string;
}): Promise<{ error?: string }> {
  try {
    assertUser(opts.user);
    const supabase = supabaseBrowser();

    // Read first so we can describe it in activity feed and bail if already cancelled.
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

// ── cash sessions ─────────────────────────────────────────────

export async function openCashSession(user: CurrentUser, openingCashSYP: number) {
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
  } catch (e) {
    logErr("open session throw", e);
    return { error: String(e) };
  }
}

export async function closeCashSession(
  user: CurrentUser,
  sessionId: string,
  closingCashSYP: number
) {
  try {
    assertUser(user);
    const supabase = supabaseBrowser();

    const { data: sess } = await supabase
      .from("cash_sessions")
      .select("opening_cash_syp")
      .eq("id", sessionId)
      .maybeSingle();
    const opening = Number(sess?.opening_cash_syp ?? 0);

    // Sum amount_syp (immutable snapshot) for active rows in this session.
    const sumActiveSYP = async (table: string) => {
      const { data } = await supabase
        .from(table)
        .select("amount_syp")
        .eq("cash_session_id", sessionId)
        .is("cancelled_at", null);
      return (data ?? []).reduce(
        (a: number, r: Record<string, unknown>) => a + Number(r.amount_syp ?? 0),
        0
      );
    };
    const subsTotal     = await sumActiveSYP("subscriptions");
    const salesTotal    = await sumActiveSYP("sales");
    const inbodyTotal   = await sumActiveSYP("inbody_sessions");
    const expensesTotal = await sumActiveSYP("expenses");

    const expectedCash = opening + subsTotal + salesTotal + inbodyTotal - expensesTotal;
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
  } catch (e) {
    logErr("close session throw", e);
    return { error: String(e) };
  }
}
