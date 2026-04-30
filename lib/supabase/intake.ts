"use client";

// All Supabase writes go through this module.
// Every function calls Supabase first, adds .select() to confirm the write,
// logs success/failure, and returns the DB row on success.

import { supabaseBrowser } from "./client";
import { getActiveSession, getLastClosedSession } from "./session";

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
    const cashSessionId = (await getActiveSession())?.id ?? null;
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
  groupId?: string;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.paidAmount < 0 || opts.amount < 0) return { error: "مبلغ غير صالح" };

    if (opts.offer === undefined) opts.offer = "none";
    if (opts.offer === "none") opts.groupId = undefined;

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };
    const supabase = supabaseBrowser();
    const cashSessionId = session.id;
    const currency = opts.currency ?? "usd";
    const amountSYP =
      currency === "syp"
        ? Math.round(opts.paidAmount)
        : Math.round(opts.paidAmount * opts.exchangeRate);

    const subPayload = {
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
      ...(opts.groupId ? { group_id: opts.groupId } : {}),
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
    };
    console.log("Supabase insert payload:", { table: "subscriptions", payload: subPayload });

    const { data, error } = await supabase
      .from("subscriptions")
      .insert(subPayload)
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

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };
    const supabase = supabaseBrowser();
    const cashSessionId = session.id;
    const currency = opts.currency ?? "usd";
    const amountSYP =
      currency === "syp"
        ? Math.round(opts.total)
        : Math.round(opts.total * opts.exchangeRate);

    const salePayload = {
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
    };
    console.log("Supabase insert payload:", { table: "sales", payload: salePayload });

    const { data, error } = await supabase
      .from("sales")
      .insert(salePayload)
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
  memberId?: string;
  memberName: string;
  memberType: "gym_member" | "non_member";
  amountUSD: number;
  exchangeRate: number;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.amountUSD < 0) return { error: "مبلغ غير صالح" };

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };
    const supabase = supabaseBrowser();
    const cashSessionId = session.id;
    const amountSYP = Math.round(opts.amountUSD * opts.exchangeRate);

    const inbodyPayload = {
      member_id: opts.memberId ?? null,
      member_name: opts.memberName,
      session_type: opts.memberType,
      amount: opts.amountUSD,
      currency: "usd",
      exchange_rate: opts.exchangeRate,
      amount_syp: amountSYP,
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
      created_by_name: opts.user.displayName,
    };
    console.log("Supabase insert payload:", { table: "inbody_sessions", payload: inbodyPayload });

    const { data, error } = await supabase
      .from("inbody_sessions")
      .insert(inbodyPayload)
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

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };
    const supabase = supabaseBrowser();
    const cashSessionId = session.id;

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
      .select("*")
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
    const last = await getLastClosedSession();
    return {
      openingUSD: last ? last.actualCash : 0,
      previousSessionId: last?.id ?? null,
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
    const existing = await getActiveSession();
    if (existing) return { error: "هناك جلسة نقدية مفتوحة بالفعل. أغلقها أولاً." };

    const supabase = supabaseBrowser();
    const handoff = await fetchHandoffOpening();
    const openingCash = openingCashUSDOverride ?? handoff.openingUSD;
    const opening_locked = handoff.previousSessionId !== null;

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by: user.id,
        opening_cash: openingCash,
        previous_session_id: handoff.previousSessionId,
        opening_locked,
        status: "open",
      })
      .select()
      .single();

    if (error) {
      logError("cash_sessions", "insert", error);
      // 23505 = unique_violation. The 0013 partial unique index enforces
      // "at most one open session" at the DB level — surface the same
      // localized message the pre-check gives.
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return { error: "هناك جلسة نقدية مفتوحة بالفعل. أغلقها أولاً." };
      }
      return { error: error.message };
    }
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

    // Fetch opening_cash from DB — do not trust frontend value.
    const { data: sessionRow } = await supabase
      .from("cash_sessions")
      .select("opening_cash")
      .eq("id", sessionId)
      .maybeSingle();
    const openingCash = Number((sessionRow as Record<string, unknown> | null)?.opening_cash ?? 0);

    // Aggregate all income and expenses from DB for this session.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sumCol = async (table: string, col: string, filter?: { col: string; val: string }): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(table).select(col).eq("cash_session_id", sessionId).is("cancelled_at", null);
      if (filter) q = q.eq(filter.col, filter.val);
      const { data } = await q;
      return (data ?? []).reduce(
        (a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0),
        0
      );
    };

    // Expenses must (1) exclude soft-deleted rows and (2) convert SYP to USD
    // using the per-row exchange_rate snapshot. Without (1), cancelled
    // expenses silently subtract from expectedCash. Without (2), an SYP
    // expense's raw value is treated as USD and the close looks short by
    // thousands of dollars.
    const sumExpenses = async (): Promise<number> => {
      const { data } = await supabase
        .from("expenses")
        .select("amount, currency, exchange_rate")
        .eq("cash_session_id", sessionId)
        .is("cancelled_at", null);
      return (data ?? []).reduce((a: number, r: unknown) => {
        const row = r as Record<string, unknown>;
        const amount = Number(row.amount ?? 0);
        const rate = Number(row.exchange_rate ?? 0);
        const usd = String(row.currency ?? "usd") === "syp" && rate > 0
          ? amount / rate
          : amount;
        return a + usd;
      }, 0);
    };

    const [subsTotal, storeTotal, mealsTotal, inbodyTotal, expensesTotal] = await Promise.all([
      sumCol("subscriptions",   "paid_amount"),
      sumCol("sales",           "total", { col: "source", val: "store" }),
      sumCol("sales",           "total", { col: "source", val: "kitchen" }),
      sumCol("inbody_sessions", "amount"),
      sumExpenses(),
    ]);

    const totalIncome  = subsTotal + storeTotal + mealsTotal + inbodyTotal;
    const expectedCash = Number((openingCash + totalIncome - expensesTotal).toFixed(4));
    const difference   = Number((actualCashUSD - expectedCash).toFixed(4));

    // The status='open' filter prevents accidental double-close — without it,
    // a stale tab calling close on an already-closed session silently
    // overwrites its actual_cash / difference, corrupting the audit trail.
    const { data, error } = await supabase
      .from("cash_sessions")
      .update({
        closed_by: user.id,
        closed_at: new Date().toISOString(),
        actual_cash: actualCashUSD,
        expected_cash: expectedCash,
        difference,
        status: "closed",
      })
      .eq("id", sessionId)
      .eq("status", "open")
      .select();

    if (error) { logError("cash_sessions", "update-close", error); return { error: error.message }; }
    if (!data || (data as unknown[]).length === 0) {
      logError("cash_sessions", "update-close", "no rows updated");
      return { error: "الجلسة مغلقة بالفعل أو لا تملك صلاحية الإغلاق" };
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

// ── Private training sessions ─────────────────────────────────

function ptGroupPrice(n: number): number {
  return n <= 2 ? 10 : n <= 5 ? 15 : 18;
}

export async function pushPrivateSession(opts: {
  user: CurrentUser;
  numberOfPlayers: number;
  playerNames: string[];
  groupId?: string;
  notes?: string;
  exchangeRate: number;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.numberOfPlayers <= 0) return { error: "عدد اللاعبين يجب أن يكون أكبر من صفر" };

    const BASE_TRAINER_FEE = 18;
    const groupPrice = ptGroupPrice(opts.numberOfPlayers);
    const totalPrice = BASE_TRAINER_FEE + groupPrice;
    const amountSYP = Math.round(totalPrice * opts.exchangeRate);

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };
    const supabase = supabaseBrowser();
    const cashSessionId = session.id;

    const { data, error } = await supabase
      .from("private_sessions")
      .insert({
        number_of_players: opts.numberOfPlayers,
        player_names: opts.playerNames.filter((n) => n.trim()),
        base_trainer_fee: BASE_TRAINER_FEE,
        group_price: groupPrice,
        total_price: totalPrice,
        currency: "usd",
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        group_id: opts.groupId ?? null,
        notes: opts.notes?.trim() || null,
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
        created_by_name: opts.user.displayName,
      })
      .select()
      .single();

    if (error) { logError("private_sessions", "insert", error); return { error: error.message }; }
    if (!data) { logError("private_sessions", "insert", "no row returned"); return { error: "لم يتم حفظ الجلسة — تحقق من RLS" }; }
    logSuccess("private_sessions", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "private_session_create",
      description: `تدريب خاص — ${opts.numberOfPlayers} لاعبين — $${totalPrice}`,
      amountUSD: totalPrice,
      entityType: "private_session",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("private_sessions", "insert", e);
    return { error: String(e) };
  }
}

// ── Group offers metadata ─────────────────────────────────────

export async function pushGroupOffer(opts: {
  user: CurrentUser;
  groupId: string;
  offerType: "referral" | "couple" | "corporate";
  members: { name: string; userId?: string }[];
  referralCount?: number;
  rewardType?: string;
  rewardValue?: number;
  discountPercent?: number;
  organizationType?: string;
  priceApplied?: number;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    const supabase = supabaseBrowser();
    const cashSessionId = (await getActiveSession())?.id ?? null;

    const { data, error } = await supabase
      .from("group_offers")
      .insert({
        group_id: opts.groupId,
        offer_type: opts.offerType,
        members: opts.members,
        referral_count: opts.referralCount ?? null,
        reward_type: opts.rewardType ?? null,
        reward_value: opts.rewardValue ?? null,
        discount_percent: opts.discountPercent ?? null,
        organization_type: opts.organizationType ?? null,
        price_applied: opts.priceApplied ?? null,
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
      })
      .select()
      .single();

    if (error) { logError("group_offers", "insert", error); return { error: error.message }; }
    logSuccess("group_offers", "insert", data);
    return { data: data as DbRow };
  } catch (e) {
    logError("group_offers", "insert", e);
    return { error: String(e) };
  }
}
