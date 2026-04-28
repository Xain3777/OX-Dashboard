"use client";

// All Supabase writes go through this module.
// Every function calls Supabase first, adds .select() to confirm the write,
// logs success/failure, and returns the DB row on success.

import { supabaseBrowser } from "./client";

export type Currency = "syp" | "usd";
export type DbRow = Record<string, unknown>;

export interface CurrentUser {
  id: string;
  displayName: string;
}

const FALLBACK_RATE = 13200;

function assertUser(user: CurrentUser | null | undefined): asserts user is CurrentUser {
  if (!user || !user.id) throw new Error("missing authenticated user");
}

function logSuccess(table: string, operation: string, data: unknown) {
  console.log("Supabase write success:", { table, operation, data });
}

function logError(table: string, operation: string, error: unknown) {
  console.error("Supabase write failed:", { table, operation, error });
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
    logError("app_settings", "select", e);
    return FALLBACK_RATE;
  }
}

export async function persistExchangeRate(
  user: CurrentUser,
  rate: number
): Promise<{ error?: string }> {
  if (!Number.isFinite(rate) || rate <= 0) return { error: "سعر صرف غير صالح" };
  try {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("app_settings")
      .upsert(
        { key: RATE_KEY, value: rate, updated_at: new Date().toISOString(), updated_by: user.id },
        { onConflict: "key" }
      )
      .select();
    if (error) { logError("app_settings", "upsert", error); return { error: error.message }; }
    logSuccess("app_settings", "upsert", data);
    await pushActivity({
      user,
      action: "exchange_rate_update",
      description: `تحديث سعر الصرف — 1$ = ${rate.toLocaleString("en-US")} ل.س`,
    });
    return {};
  } catch (e) {
    logError("app_settings", "upsert", e);
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
    if (error) logError("activity_feed", "insert", error);
  } catch (e) {
    logError("activity_feed", "insert", e);
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
  paymentMethod?: string;
  currency?: Currency;
  exchangeRate: number;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.paidAmount < 0 || opts.amount < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const currency = opts.currency ?? "usd";
    const amountSYP =
      currency === "syp"
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
        payment_method: opts.paymentMethod ?? "cash",
        currency,
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        status: "active",
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
      })
      .select()
      .single();

    if (error) { logError("subscriptions", "insert", error); return { error: error.message }; }
    if (!data) { logError("subscriptions", "insert", "no row returned"); return { error: "لم يتم حفظ الاشتراك — تحقق من RLS" }; }
    logSuccess("subscriptions", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "subscription_create",
      description: `اشتراك جديد — ${opts.memberName} (${opts.planType}) — $${opts.paidAmount}`,
      amountUSD: currency === "usd" ? opts.paidAmount : undefined,
      entityType: "subscription",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("subscriptions", "insert", e);
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
  currency?: Currency;
  exchangeRate: number;
  source?: "store" | "kitchen";
  paymentMethod?: string;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.quantity <= 0 || opts.total < 0) return { error: "كمية أو مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const currency = opts.currency ?? "usd";
    const amountSYP =
      currency === "syp"
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
        payment_method: opts.paymentMethod ?? "cash",
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
        created_by_name: opts.user.displayName,
      })
      .select()
      .single();

    if (error) { logError("sales", "insert", error); return { error: error.message }; }
    if (!data) { logError("sales", "insert", "no row returned"); return { error: "لم يتم حفظ البيع — تحقق من RLS" }; }
    logSuccess("sales", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "sale_create",
      description: `بيع ${opts.quantity}× ${opts.productName} — $${opts.total}`,
      amountUSD: currency === "usd" ? opts.total : undefined,
      entityType: "sale",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("sales", "insert", e);
    return { error: String(e) };
  }
}

// ── InBody sessions ───────────────────────────────────────────

export async function pushInBody(opts: {
  user: CurrentUser;
  memberName: string;
  memberType: "gym_member" | "non_member";
  amountUSD: number;
  exchangeRate: number;
}): Promise<{ data?: DbRow; error?: string }> {
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
        created_by_name: opts.user.displayName,
      })
      .select()
      .single();

    if (error) { logError("inbody_sessions", "insert", error); return { error: error.message }; }
    if (!data) { logError("inbody_sessions", "insert", "no row returned"); return { error: "لم يتم حفظ الجلسة — تحقق من RLS" }; }
    logSuccess("inbody_sessions", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "inbody_create",
      description: `جلسة InBody — ${opts.memberName} — $${opts.amountUSD}`,
      amountUSD: opts.amountUSD,
      entityType: "inbody",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("inbody_sessions", "insert", e);
    return { error: String(e) };
  }
}

// ── expenses ──────────────────────────────────────────────────

export async function pushExpense(opts: {
  user: CurrentUser;
  description: string;
  amount: number;
  currency: Currency;
  category: string;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (opts.amount <= 0) return { error: "المبلغ يجب أن يكون أكبر من صفر" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);

    const payload = {
      description: opts.description,
      amount: opts.amount,
      currency: opts.currency,
      category: opts.category,
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
    };
    console.log("Supabase write payload:", { table: "expenses", operation: "insert", payload });

    const { data, error } = await supabase
      .from("expenses")
      .insert(payload)
      .select()
      .single();

    if (error) { logError("expenses", "insert", error); return { error: error.message }; }
    if (!data) { logError("expenses", "insert", "no row returned"); return { error: "لم يتم حفظ المصروف — تحقق من RLS" }; }
    logSuccess("expenses", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "expense_create",
      description: `مصروف — ${opts.description} — $${opts.amount}`,
      amountUSD: opts.currency === "usd" ? opts.amount : undefined,
      entityType: "expense",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("expenses", "insert", e);
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
  try {
    assertUser(opts.user);
    const supabase = supabaseBrowser();

    const { data: row, error: readErr } = await supabase
      .from(opts.table)
      .select("amount_syp, currency, cancelled_at, member_name, product_name, description")
      .eq("id", opts.id)
      .maybeSingle();
    if (readErr) { logError(opts.table, "select-for-cancel", readErr); return { error: readErr.message }; }
    if (!row) return { error: "العملية غير موجودة" };
    if ((row as DbRow).cancelled_at) return { error: "العملية ملغاة بالفعل" };

    const { data, error } = await supabase
      .from(opts.table)
      .update({
        cancelled_at: new Date().toISOString(),
        cancelled_by: opts.user.id,
        cancelled_reason: opts.reason ?? null,
      })
      .eq("id", opts.id)
      .select();

    if (error) { logError(opts.table, "update-cancel", error); return { error: error.message }; }
    if (!data || (data as unknown[]).length === 0) {
      logError(opts.table, "update-cancel", "no rows updated — RLS may be blocking");
      return { error: "لم يتم تحديث الصف — تحقق من صلاحيات RLS" };
    }
    logSuccess(opts.table, "cancel", data);

    const r = row as Record<string, unknown>;
    const label = r.product_name || r.member_name || r.description || "عملية";
    const amtSYP = Number(r.amount_syp ?? 0);
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
    logError(opts.table, "cancel", e);
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
  const supabase = supabaseBrowser();

  const sumUSD = async (
    table: string,
    col: string,
    filter?: { col: string; val: string }
  ): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(col).eq("cash_session_id", sessionId).is("cancelled_at", null);
    if (filter) q = q.eq(filter.col, filter.val);
    const { data } = await q;
    return (data ?? []).reduce(
      (a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0),
      0
    );
  };

  const [subsTotal, inbodyTotal, storeTotal, mealsTotal] = await Promise.all([
    sumUSD("subscriptions", "paid_amount"),
    sumUSD("inbody_sessions", "amount"),
    sumUSD("sales", "total", { col: "source", val: "store" }),
    sumUSD("sales", "total", { col: "source", val: "kitchen" }),
  ]);

  return {
    subsTotal: Number(subsTotal.toFixed(2)),
    inbodyTotal: Number(inbodyTotal.toFixed(2)),
    storeTotal: Number(storeTotal.toFixed(2)),
    mealsTotal: Number(mealsTotal.toFixed(2)),
    totalIncome: Number((subsTotal + inbodyTotal + storeTotal + mealsTotal).toFixed(2)),
  };
}

// ── Cash session lifecycle ────────────────────────────────────

export async function fetchHandoffOpening(): Promise<{
  openingUSD: number;
  previousSessionId: string | null;
}> {
  try {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("last_closed_session_for_today");
    if (error) { logError("cash_sessions", "rpc-handoff", error); return { openingUSD: 0, previousSessionId: null }; }
    const row =
      Array.isArray(data) && data.length > 0
        ? (data[0] as { id: string; actual_cash: number })
        : null;
    return {
      openingUSD: row ? Number(row.actual_cash ?? 0) : 0,
      previousSessionId: row?.id ?? null,
    };
  } catch (e) {
    logError("cash_sessions", "rpc-handoff", e);
    return { openingUSD: 0, previousSessionId: null };
  }
}

export async function openCashSession(
  user: CurrentUser,
  openingCashUSDOverride?: number
): Promise<{ data?: DbRow; error?: string }> {
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
    const openingCash = openingCashUSDOverride ?? handoff.openingUSD;
    const opening_locked = handoff.previousSessionId !== null;

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by: user.id,
        employee_name: user.displayName,
        opening_cash: openingCash,
        previous_session_id: handoff.previousSessionId,
        opening_locked,
        status: "open",
      })
      .select()
      .single();

    if (error) { logError("cash_sessions", "insert", error); return { error: error.message }; }
    if (!data) { logError("cash_sessions", "insert", "no row returned"); return { error: "لم يتم فتح الجلسة — تحقق من RLS" }; }
    logSuccess("cash_sessions", "insert", data);

    await pushActivity({
      user,
      action: "session_opened",
      description: opening_locked
        ? `فتح جلسة نقدية — استلام من الوردية السابقة $${openingCash.toFixed(2)}`
        : `فتح جلسة نقدية — أول وردية اليوم — افتتاحي $${openingCash.toFixed(2)}`,
      amountUSD: openingCash,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("cash_sessions", "insert", e);
    return { error: String(e) };
  }
}

export async function closeCashSession(
  user: CurrentUser,
  sessionId: string,
  actualCashUSD: number
): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(user);
    const supabase = supabaseBrowser();

    const { data, error } = await supabase
      .from("cash_sessions")
      .update({
        closed_by: user.id,
        closed_at: new Date().toISOString(),
        actual_cash: actualCashUSD,
        status: "closed",
      })
      .eq("id", sessionId)
      .select();

    if (error) { logError("cash_sessions", "update-close", error); return { error: error.message }; }
    if (!data || (data as unknown[]).length === 0) {
      logError("cash_sessions", "update-close", "no rows updated");
      return { error: "لم يتم إغلاق الجلسة — تحقق من RLS" };
    }
    logSuccess("cash_sessions", "update-close", data);

    await pushActivity({
      user,
      action: "session_closed",
      description: `إغلاق جلسة — المبلغ الفعلي: $${actualCashUSD.toFixed(2)}`,
      amountUSD: actualCashUSD,
    });
    return { data: (data as DbRow[])[0] };
  } catch (e) {
    logError("cash_sessions", "update-close", e);
    return { error: String(e) };
  }
}
