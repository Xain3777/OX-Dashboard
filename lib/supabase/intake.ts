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
import type { DailyIncome } from "@/lib/types";

export type Currency = "syp" | "usd";

export interface CurrentUser {
  id: string;          // auth.users.id (uuid)
  displayName: string;
}

export interface DailySessionInfo {
  id: string;
  businessDate: string;
  status: "open" | "closed";
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
}

const FALLBACK_RATE = 13200;

// ── helpers ───────────────────────────────────────────────────

function assertUser(user: CurrentUser | null | undefined): asserts user is CurrentUser {
  if (!user || !user.id) throw new Error("missing authenticated user");
}

function logErr(scope: string, err: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[supabase ${scope}]`, err);
}

// Returns the business date string (YYYY-MM-DD) for Latakia UTC+3.
// The business day runs 06:00–24:00 local time; before 06:00 we still
// report the previous calendar day.
export function getCurrentBusinessDate(): string {
  const latakiaMs = Date.now() + 3 * 60 * 60 * 1000; // UTC+3
  const d = new Date(latakiaMs);
  const hour = d.getUTCHours();
  if (hour < 6) d.setUTCDate(d.getUTCDate() - 1);
  const y  = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

// Returns the shared open session ID for today's business date (any opener).
async function getOpenSessionId(): Promise<string | null> {
  const supabase = supabaseBrowser();
  const businessDate = getCurrentBusinessDate();
  const { data } = await supabase
    .from("cash_sessions")
    .select("id")
    .eq("business_date", businessDate)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
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
    const cashSessionId = await getOpenSessionId();
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
    const cashSessionId = await getOpenSessionId();
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
    const cashSessionId = await getOpenSessionId();
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
    const cashSessionId = await getOpenSessionId();
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

// ── Daily session management ──────────────────────────────────

export async function getTodaySession(): Promise<DailySessionInfo | null> {
  try {
    const supabase = supabaseBrowser();
    const businessDate = getCurrentBusinessDate();
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("id, business_date, status, opened_at, opened_by, closed_at, closed_by")
      .eq("business_date", businessDate)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { logErr("getTodaySession", error); return null; }
    if (!data) return null;
    return {
      id: data.id as string,
      businessDate: data.business_date as string,
      status: data.status as "open" | "closed",
      openedAt: data.opened_at as string,
      openedBy: data.opened_by as string,
      closedAt: data.closed_at as string | undefined,
      closedBy: data.closed_by as string | undefined,
    };
  } catch (e) {
    logErr("getTodaySession throw", e);
    return null;
  }
}

// Get or create the single shared session for today's business date.
// Safe to call from multiple clients simultaneously — Supabase unique
// constraint on business_date prevents duplicates; the loser of the
// race will get the existing row on retry.
export async function getOrCreateDailySession(
  user: CurrentUser
): Promise<{ session: DailySessionInfo | null; error?: string }> {
  try {
    assertUser(user);
    const supabase = supabaseBrowser();
    const businessDate = getCurrentBusinessDate();

    // Check for existing session (open or closed) for today.
    const existing = await getTodaySession();
    if (existing) return { session: existing };

    // No session yet — create one.
    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        business_date: businessDate,
        opened_by: user.id,
        status: "open",
        opening_cash_syp: 0,
      })
      .select("id, business_date, status, opened_at, opened_by")
      .single();

    if (error) {
      // Unique constraint violation = another client beat us. Re-fetch.
      if (error.code === "23505") {
        const retry = await getTodaySession();
        return { session: retry };
      }
      logErr("getOrCreateDailySession insert", error);
      return { session: null, error: error.message };
    }

    await pushActivity({
      user,
      action: "session_opened",
      description: `بدء يوم عمل — ${businessDate}`,
    });

    return {
      session: {
        id: data.id as string,
        businessDate: data.business_date as string,
        status: "open",
        openedAt: data.opened_at as string,
        openedBy: data.opened_by as string,
      },
    };
  } catch (e) {
    logErr("getOrCreateDailySession throw", e);
    return { session: null, error: String(e) };
  }
}

// Compute today's income broken down by the 4 sources.
// Only counts non-cancelled rows linked to the given session.
export async function computeDailyIncome(sessionId: string): Promise<DailyIncome> {
  const supabase = supabaseBrowser();

  const sumUSD = async (table: string, col: string, filter?: { source: string }): Promise<number> => {
    let q = supabase
      .from(table)
      .select(col)
      .eq("cash_session_id", sessionId)
      .is("cancelled_at", null);
    if (filter) q = q.eq("source", filter.source);
    const { data } = await q;
    const total = (data as unknown as Record<string, unknown>[])
      ?.reduce((a, r) => a + Number(r[col] ?? 0), 0) ?? 0;
    return Number(total.toFixed(2));
  };

  const [subsTotal, inbodyTotal, storeTotal, mealsTotal] = await Promise.all([
    sumUSD("subscriptions",   "paid_amount"),
    sumUSD("inbody_sessions", "amount"),
    sumUSD("sales",           "total", { source: "store" }),
    sumUSD("sales",           "total", { source: "kitchen" }),
  ]);

  return {
    subsTotal,
    inbodyTotal,
    storeTotal,
    mealsTotal,
    totalIncome: Number((subsTotal + inbodyTotal + storeTotal + mealsTotal).toFixed(2)),
  };
}

// Close today's session. Manager-only action.
// Writes totals to daily_summary for historical reporting.
export async function closeDailySession(
  user: CurrentUser,
  sessionId: string,
): Promise<{ error?: string; income?: DailyIncome }> {
  try {
    assertUser(user);
    const supabase = supabaseBrowser();

    const income = await computeDailyIncome(sessionId);
    const businessDate = getCurrentBusinessDate();

    const { error: closeErr } = await supabase
      .from("cash_sessions")
      .update({
        closed_by: user.id,
        closed_at: new Date().toISOString(),
        status: "closed",
      })
      .eq("id", sessionId);
    if (closeErr) return { error: closeErr.message };

    // Upsert daily summary for historical records.
    await supabase
      .from("daily_summary")
      .upsert({
        business_date: businessDate,
        session_id: sessionId,
        total_income: income.totalIncome,
        subs_total: income.subsTotal,
        inbody_total: income.inbodyTotal,
        store_total: income.storeTotal,
        meals_total: income.mealsTotal,
        closed_by: user.id,
      }, { onConflict: "business_date" });

    await pushActivity({
      user,
      action: "session_closed",
      description: `إغلاق يوم عمل — ${businessDate} — إجمالي الدخل: $${income.totalIncome}`,
      amountUSD: income.totalIncome,
    });

    return { income };
  } catch (e) {
    logErr("closeDailySession throw", e);
    return { error: String(e) };
  }
}
