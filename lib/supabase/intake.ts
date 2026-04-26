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
  phoneNumber?: string;
  planType: string;
  offer?: string;
  startDate: string;
  endDate: string;
  amountUSD: number;
  paidAmountUSD: number;
  paymentStatus: "paid" | "partial" | "unpaid";
  exchangeRate: number;
}): Promise<{ id?: string; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.paidAmountUSD < 0 || opts.amountUSD < 0) return { error: "مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = Math.round(opts.paidAmountUSD * opts.exchangeRate);

    const { data, error } = await supabase
      .from("subscriptions")
      .insert({
        member_name: opts.memberName,
        phone_number: opts.phoneNumber ?? null,
        plan_type: opts.planType,
        offer: opts.offer ?? "none",
        start_date: opts.startDate,
        end_date: opts.endDate,
        amount: opts.amountUSD,
        paid_amount: opts.paidAmountUSD,
        payment_status: opts.paymentStatus,
        currency: "usd",
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
      description: `اشتراك جديد — ${opts.memberName} (${opts.planType}) — $${opts.paidAmountUSD}`,
      amountUSD: opts.paidAmountUSD,
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
  unitPrice: number;    // USD
  total: number;        // USD
  exchangeRate: number;
  source?: "store" | "kitchen";
}): Promise<{ id?: string; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.quantity <= 0 || opts.total < 0) return { error: "كمية أو مبلغ غير صالح" };

    const supabase = supabaseBrowser();
    const cashSessionId = await getOpenSessionId(opts.user.id);
    const amountSYP = Math.round(opts.total * opts.exchangeRate);

    const { data, error } = await supabase
      .from("sales")
      .insert({
        product_id: opts.productId ?? null,
        product_name: opts.productName,
        quantity: opts.quantity,
        unit_price: opts.unitPrice,
        total: opts.total,
        currency: "usd",
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
      amountUSD: opts.total,
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

// Shift handoff: returns the opening balance the next worker must use
// (= closing balance of the most recent closed session today, or 0 if first
// shift of the day). Always paired with `previous_session_id` for the audit trail.
export async function fetchHandoffOpening(): Promise<{ openingSYP: number; previousSessionId: string | null }> {
  try {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.rpc("last_closed_session_for_today");
    if (error) { logErr("handoff rpc", error); return { openingSYP: 0, previousSessionId: null }; }
    const row = Array.isArray(data) && data.length > 0 ? data[0] as { id: string; closing_cash_syp: number } : null;
    return {
      openingSYP: row ? Number(row.closing_cash_syp ?? 0) : 0,
      previousSessionId: row?.id ?? null,
    };
  } catch (e) {
    logErr("handoff throw", e);
    return { openingSYP: 0, previousSessionId: null };
  }
}

export async function openCashSession(user: CurrentUser, openingCashSYPOverride?: number) {
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

    // Auto-handoff: opening = previous closed session's closing today.
    const handoff = await fetchHandoffOpening();
    const openingCashSYP = openingCashSYPOverride ?? handoff.openingSYP;
    const opening_locked = handoff.previousSessionId !== null;

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by: user.id,
        opening_cash_syp: openingCashSYP,
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
        ? `فتح جلسة نقدية — استلام من الوردية السابقة ${openingCashSYP.toLocaleString("en-US")} ل.س`
        : `فتح جلسة نقدية — أول وردية لليوم — افتتاحي ${openingCashSYP.toLocaleString("en-US")} ل.س`,
      amountSYP: openingCashSYP,
    });
    return { id: data?.id as string };
  } catch (e) {
    logErr("open session throw", e);
    return { error: String(e) };
  }
}

// Compute total income for a session in USD (subscriptions + sales + inbody).
// Expenses are excluded per business rules. Uses native USD amounts (not amount_syp).
export async function computeExpectedCash(sessionId: string, exchangeRate: number): Promise<number> {
  const supabase = supabaseBrowser();

  // Opening stored in SYP; convert to USD for consistent comparison.
  const { data: sess } = await supabase
    .from("cash_sessions")
    .select("opening_cash_syp")
    .eq("id", sessionId)
    .maybeSingle();
  const openingUSD = Number((Number(sess?.opening_cash_syp ?? 0) / exchangeRate).toFixed(2));

  const sumUSD = async (table: string, col: string) => {
    const { data } = await supabase
      .from(table)
      .select(col)
      .eq("cash_session_id", sessionId)
      .is("cancelled_at", null);
    const total = (data as unknown as Record<string, unknown>[])
      ?.reduce((a, r) => a + Number(r[col] ?? 0), 0) ?? 0;
    return Number(total.toFixed(2));
  };

  const subs   = await sumUSD("subscriptions",   "paid_amount");
  const sales  = await sumUSD("sales",           "total");
  const inbody = await sumUSD("inbody_sessions", "amount");

  return Number((openingUSD + subs + sales + inbody).toFixed(2));
}

export async function closeCashSession(
  user: CurrentUser,
  sessionId: string,
  closingCashUSD: number,
  exchangeRate: number,
  discrepancyReason?: string,
) {
  try {
    assertUser(user);
    const supabase = supabaseBrowser();

    const expectedCashUSD = await computeExpectedCash(sessionId, exchangeRate);

    // Normalise both to 2 decimal places to prevent float mismatches.
    const closingNorm  = Number(closingCashUSD.toFixed(2));
    const expectedNorm = Number(expectedCashUSD.toFixed(2));
    const discrepancy  = Number((closingNorm - expectedNorm).toFixed(2));

    if (discrepancy !== 0 && (!discrepancyReason || !discrepancyReason.trim())) {
      return { error: "يجب إدخال سبب الفرق قبل إغلاق الجلسة." };
    }

    // Store SYP-equivalent for backward-compat columns.
    const closingCashSYP  = Math.round(closingNorm  * exchangeRate);
    const expectedCashSYP = Math.round(expectedNorm * exchangeRate);
    const discrepancySYP  = Math.round(discrepancy  * exchangeRate);

    const { error } = await supabase
      .from("cash_sessions")
      .update({
        closed_by:         user.id,
        closed_at:         new Date().toISOString(),
        closing_cash_syp:  closingCashSYP,
        expected_cash_syp: expectedCashSYP,
        discrepancy_syp:   discrepancySYP,
        notes:             discrepancyReason ?? null,
        status:            "closed",
      })
      .eq("id", sessionId);
    if (error) return { error: error.message };

    if (discrepancy !== 0) {
      const { error: dErr } = await supabase
        .from("discrepancy_logs")
        .insert({
          cash_session_id: sessionId,
          worker_id:      user.id,
          worker_name:    user.displayName,
          expected_syp:   expectedCashSYP,
          actual_syp:     closingCashSYP,
          difference_syp: discrepancySYP,
          reason:         discrepancyReason ?? "غير محدد",
        });
      if (dErr) logErr("discrepancy insert", dErr);
    }

    await pushActivity({
      user,
      action: "session_closed",
      description: `إغلاق جلسة — متوقع $${expectedNorm} — فعلي $${closingNorm} — فرق $${discrepancy}${discrepancyReason ? ` — السبب: ${discrepancyReason}` : ""}`,
      amountUSD: closingNorm,
    });

    return { expectedCashUSD: expectedNorm, discrepancy };
  } catch (e) {
    logErr("close session throw", e);
    return { error: String(e) };
  }
}
