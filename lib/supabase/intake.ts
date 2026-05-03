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

// ── members (find or create by phone, falling back to name) ───
//
// Returns the existing member row if a record matches by phone (preferred)
// or by case-insensitive full_name, otherwise inserts a new member row.
// Members table on the live DB has columns: id, full_name, phone, created_at.

export interface MemberRow {
  id: string;
  full_name: string;
  phone: string | null;
}

export async function findOrCreateMember(opts: {
  user: CurrentUser;
  name: string;
  phone?: string;
}): Promise<{ data?: MemberRow; error?: string }> {
  try {
    assertUser(opts.user);
    const trimmedName  = opts.name.trim();
    const trimmedPhone = (opts.phone ?? "").trim();
    if (!trimmedName) return { error: "اسم العضو مطلوب" };

    const supabase = supabaseBrowser();
    console.log("findOrCreateMember: lookup", { name: trimmedName, phone: trimmedPhone || null });

    // 1. Lookup by phone (preferred — phone is more unique than name)
    if (trimmedPhone) {
      const { data: byPhone, error: phoneErr } = await supabase
        .from("members")
        .select("id, full_name, phone")
        .eq("phone", trimmedPhone)
        .limit(1);
      if (phoneErr) { logError("members", "select-by-phone", phoneErr); return { error: phoneErr.message }; }
      if (byPhone && byPhone.length > 0) {
        const row = byPhone[0] as MemberRow;
        console.log("findOrCreateMember: matched by phone", row);
        return { data: row };
      }
    }

    // 2. Fallback: case-insensitive name match
    const { data: byName, error: nameErr } = await supabase
      .from("members")
      .select("id, full_name, phone")
      .ilike("full_name", trimmedName)
      .limit(1);
    if (nameErr) { logError("members", "select-by-name", nameErr); return { error: nameErr.message }; }
    if (byName && byName.length > 0) {
      const row = byName[0] as MemberRow;
      console.log("findOrCreateMember: matched by name", row);
      // If the existing member has no phone but caller supplied one, fill it in.
      if (trimmedPhone && !row.phone) {
        const { data: updated, error: upErr } = await supabase
          .from("members")
          .update({ phone: trimmedPhone })
          .eq("id", row.id)
          .select("id, full_name, phone")
          .single();
        if (upErr) { logError("members", "update-phone", upErr); /* fall through with old row */ }
        else if (updated) {
          console.log("findOrCreateMember: backfilled phone on existing member", updated);
          return { data: updated as MemberRow };
        }
      }
      return { data: row };
    }

    // 3. No match — insert a new member
    const insertPayload = { full_name: trimmedName, phone: trimmedPhone || null };
    console.log("findOrCreateMember: inserting new member", insertPayload);
    const { data: created, error: insErr } = await supabase
      .from("members")
      .insert(insertPayload)
      .select("id, full_name, phone")
      .single();
    if (insErr) { logError("members", "insert", insErr); return { error: insErr.message }; }
    if (!created) { logError("members", "insert", "no row returned"); return { error: "لم يتم إنشاء العضو — تحقق من RLS" }; }
    logSuccess("members", "insert", created);
    return { data: created as MemberRow };
  } catch (e) {
    logError("members", "findOrCreate", e);
    return { error: String(e) };
  }
}

// ── subscriptions ─────────────────────────────────────────────

export async function pushSubscription(opts: {
  user: CurrentUser;
  memberName: string;
  memberId?: string;
  phone?: string;
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

    // One-offer-per-member rule: if this subscription has any offer (non-"none"),
    // refuse to insert when the same member already has another active offered sub.
    if (opts.offer && opts.offer !== "none" && opts.memberId) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing, error: lookupErr } = await supabase
        .from("gym_subscriptions")
        .select("id, offer, end_date")
        .eq("member_id", opts.memberId)
        .neq("offer", "none")
        .is("cancelled_at", null)
        .gte("end_date", today)
        .limit(1);
      if (lookupErr) {
        logError("gym_subscriptions", "select-existing-offer", lookupErr);
        // Fall through — don't block on a lookup failure, but log it.
      } else if (existing && existing.length > 0) {
        console.warn("pushSubscription: member already has an active offer, rejecting", { memberId: opts.memberId, existing });
        return { error: `${opts.memberName} لديه عرض نشط بالفعل — لا يمكن إضافة عرض آخر` };
      }
    }
    const currency = opts.currency ?? "usd";
    const amountSYP =
      currency === "syp"
        ? Math.round(opts.paidAmount)
        : Math.round(opts.paidAmount * opts.exchangeRate);

    const trimmedPhone = (opts.phone ?? "").trim();
    const subPayload = {
      member_name: opts.memberName,
      ...(opts.memberId ? { member_id: opts.memberId } : {}),
      phone: trimmedPhone || null,
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
    console.log("Supabase insert payload:", { table: "gym_subscriptions", payload: subPayload });

    const { data, error } = await supabase
      .from("gym_subscriptions")
      .insert(subPayload)
      .select()
      .single();

    if (error) { logError("gym_subscriptions", "insert", error); return { error: error.message }; }
    if (!data) { logError("gym_subscriptions", "insert", "no row returned"); return { error: "لم يتم حفظ الاشتراك — تحقق من RLS" }; }
    logSuccess("gym_subscriptions", "insert", data);

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
    logError("gym_subscriptions", "insert", e);
    return { error: String(e) };
  }
}

// ── subscriptions: edit (correction, NOT a revenue event) ─────
//
// updateSubscription is for after-the-fact corrections. It does NOT touch
// the cash session, since the original sale already settled. RLS limits
// the update to the original creator or a manager.

export async function updateSubscription(
  id: string,
  fields: {
    memberName?: string;
    phone?: string | null;
    planType?: string;
    offer?: string;
    startDate?: string;
    endDate?: string;
    amount?: number;
    paidAmount?: number;
    paymentStatus?: "paid" | "partial" | "unpaid";
  },
  user: CurrentUser
): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(user);
    if (!id) return { error: "معرّف الاشتراك مفقود" };

    const mapped: Record<string, unknown> = {};
    if (fields.memberName !== undefined)    mapped.member_name    = fields.memberName.trim();
    if (fields.phone !== undefined)         mapped.phone          = (fields.phone ?? "").toString().trim() || null;
    if (fields.planType !== undefined)      mapped.plan_type      = fields.planType;
    if (fields.offer !== undefined)         mapped.offer          = fields.offer;
    if (fields.startDate !== undefined)     mapped.start_date     = fields.startDate;
    if (fields.endDate !== undefined)       mapped.end_date       = fields.endDate;
    if (fields.paymentStatus !== undefined) mapped.payment_status = fields.paymentStatus;
    if (fields.amount !== undefined) {
      if (fields.amount < 0) return { error: "مبلغ غير صالح" };
      mapped.amount = fields.amount;
    }
    if (fields.paidAmount !== undefined) {
      if (fields.paidAmount < 0) return { error: "المبلغ المدفوع غير صالح" };
      mapped.paid_amount = fields.paidAmount;
    }
    if (Object.keys(mapped).length === 0) return { error: "لا توجد تغييرات" };

    console.log("Supabase update payload:", { table: "gym_subscriptions", id, payload: mapped });

    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("gym_subscriptions")
      .update(mapped)
      .eq("id", id)
      .select()
      .single();

    if (error) { logError("gym_subscriptions", "update", error); return { error: error.message }; }
    if (!data)  { logError("gym_subscriptions", "update", "no row returned"); return { error: "RLS rejected update" }; }
    logSuccess("gym_subscriptions", "update", data);

    await pushActivity({
      user,
      action: "subscription_update",
      description: `تعديل اشتراك — ${(data as DbRow).member_name as string} (${Object.keys(mapped).join(", ")})`,
      entityType: "subscription",
      entityId: id,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("gym_subscriptions", "update", e);
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

export type CancellableTable = "sales" | "gym_subscriptions" | "inbody_sessions";

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

  const memberNamedTables = new Set(["gym_subscriptions", "inbody_sessions"]);
  const sumUSD = async (
    table: string,
    col: string,
    filter?: { col: string; val: string }
  ): Promise<number> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(col).eq("cash_session_id", sessionId).is("cancelled_at", null);
    if (filter) q = q.eq(filter.col, filter.val);
    if (memberNamedTables.has(table)) q = q.not("member_name", "ilike", "%test%");
    const { data } = await q;
    return (data ?? []).reduce(
      (a: number, r: unknown) => a + Number((r as Record<string, unknown>)[col] ?? 0),
      0
    );
  };

  // Kitchen sales may be in SYP (post-conversion). Sum them as USD
  // by dividing each row's total by its exchange_rate when currency='syp'.
  const sumKitchenAsUSD = async (): Promise<number> => {
    const { data } = await supabase
      .from("sales")
      .select("total, currency, exchange_rate")
      .eq("cash_session_id", sessionId)
      .eq("source", "kitchen")
      .is("cancelled_at", null);
    return (data ?? []).reduce((a: number, r: unknown) => {
      const row = r as Record<string, unknown>;
      const total = Number(row.total ?? 0);
      const cur   = String(row.currency ?? "usd");
      const rate  = Number(row.exchange_rate ?? 1) || 1;
      return a + (cur === "syp" ? total / rate : total);
    }, 0);
  };

  const [subsTotal, inbodyTotal, storeTotal, mealsTotal] = await Promise.all([
    sumUSD("gym_subscriptions", "paid_amount"),
    sumUSD("inbody_sessions", "amount"),
    sumUSD("sales", "total", { col: "source", val: "store" }),
    sumKitchenAsUSD(),
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

    // Aggregate all income and expenses from DB for this session. Tables
    // with a member_name column also drop rows whose member name contains
    // "test" so test entries don't pollute the close-out totals.
    const memberNamedTables = new Set(["gym_subscriptions", "inbody_sessions"]);
    const sumCol = async (
      table: string,
      col: string,
      filter?: { col: string; val: string },
    ): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(table).select(col).eq("cash_session_id", sessionId).is("cancelled_at", null);
      if (filter) q = q.eq(filter.col, filter.val);
      if (memberNamedTables.has(table)) q = q.not("member_name", "ilike", "%test%");
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

    // Kitchen sales are in SYP — convert each row to USD via its exchange_rate.
    const sumKitchenAsUSD = async (): Promise<number> => {
      const { data } = await supabase
        .from("sales")
        .select("total, currency, exchange_rate")
        .eq("cash_session_id", sessionId)
        .eq("source", "kitchen")
        .is("cancelled_at", null);
      return (data ?? []).reduce((a: number, r: unknown) => {
        const row = r as Record<string, unknown>;
        const total = Number(row.total ?? 0);
        const cur   = String(row.currency ?? "usd");
        const rate  = Number(row.exchange_rate ?? 1) || 1;
        return a + (cur === "syp" ? total / rate : total);
      }, 0);
    };

    const [subsTotal, storeTotal, mealsTotal, inbodyTotal, expensesTotal] = await Promise.all([
      sumCol("gym_subscriptions", "paid_amount"),
      sumCol("sales",           "total", { col: "source", val: "store" }),
      sumKitchenAsUSD(),
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
  offerType: "referral" | "couple" | "corporate" | "group_5" | "group_9";
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

// === products: reception-safe price + stock mutations ===
//
// These do NOT require a cash session — they are inventory ops, not revenue.
// RLS policy `products_update_authenticated` (migration 0019) lets any
// authenticated user perform UPDATEs on the products table, but reception
// sees only the selling-price field in the UI.

export async function persistProductPrice(
  productId: string,
  price: number,
  user: CurrentUser
): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(user);
    if (!productId) return { error: "معرّف المنتج مفقود" };
    if (!Number.isFinite(price) || price <= 0) return { error: "سعر غير صالح" };

    const supabase = supabaseBrowser();
    console.log("Supabase update payload:", { table: "products", id: productId, payload: { price } });
    const { data, error } = await supabase
      .from("products")
      .update({ price })
      .eq("id", productId)
      .select()
      .single();
    if (error) { logError("products", "update-price", error); return { error: error.message }; }
    if (!data) { logError("products", "update-price", "no row returned"); return { error: "RLS rejected" }; }
    logSuccess("products", "update-price", data);

    await pushActivity({
      user,
      action: "product_price_update",
      description: `تعديل سعر المنتج — ${(data as DbRow).name as string} → $${price}`,
      entityType: "product",
      entityId: productId,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("products", "update-price", e);
    return { error: String(e) };
  }
}

export async function persistProductInsert(opts: {
  user: CurrentUser;
  name: string;
  category: string;
  price: number;
  cost?: number;
  stock?: number;
  lowStockThreshold?: number;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    const trimmedName = opts.name.trim();
    if (!trimmedName) return { error: "أدخل اسم المنتج" };
    if (!Number.isFinite(opts.price) || opts.price <= 0) return { error: "سعر البيع غير صالح" };

    const supabase = supabaseBrowser();
    const payload = {
      name: trimmedName,
      category: opts.category,
      cost: Number.isFinite(opts.cost) && (opts.cost ?? 0) >= 0 ? opts.cost : 0,
      price: opts.price,
      stock: Number.isInteger(opts.stock) && (opts.stock ?? 0) >= 0 ? opts.stock : 0,
      low_stock_threshold:
        Number.isInteger(opts.lowStockThreshold) && (opts.lowStockThreshold ?? 0) >= 0
          ? opts.lowStockThreshold
          : 3,
    };
    console.log("Supabase insert payload:", { table: "products", payload });

    const { data, error } = await supabase
      .from("products")
      .insert(payload)
      .select()
      .single();
    if (error) { logError("products", "insert", error); return { error: error.message }; }
    if (!data) { logError("products", "insert", "no row returned"); return { error: "لم يتم إضافة المنتج — تحقق من RLS" }; }
    logSuccess("products", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "product_create",
      description: `منتج جديد — ${trimmedName} ($${opts.price})`,
      entityType: "product",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("products", "insert", e);
    return { error: String(e) };
  }
}

export async function persistProductStockAdjustment(
  productId: string,
  addQuantity: number,
  user: CurrentUser
): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(user);
    if (!productId) return { error: "معرّف المنتج مفقود" };
    if (!Number.isInteger(addQuantity) || addQuantity <= 0) {
      return { error: "الكمية يجب أن تكون عدد صحيح موجب" };
    }

    const supabase = supabaseBrowser();
    const { data: cur, error: readErr } = await supabase
      .from("products")
      .select("stock, name")
      .eq("id", productId)
      .single();
    if (readErr) { logError("products", "select-stock", readErr); return { error: readErr.message }; }
    if (!cur) return { error: "المنتج غير موجود" };
    const currentStock = Number((cur as DbRow).stock ?? 0);
    const newStock = currentStock + addQuantity;
    console.log("Supabase update payload:", { table: "products", id: productId, payload: { stock: newStock, addQuantity } });

    const { data, error } = await supabase
      .from("products")
      .update({ stock: newStock })
      .eq("id", productId)
      .select()
      .single();
    if (error) { logError("products", "update-stock", error); return { error: error.message }; }
    if (!data) { logError("products", "update-stock", "no row returned"); return { error: "RLS rejected" }; }
    logSuccess("products", "update-stock", data);

    await pushActivity({
      user,
      action: "product_stock_adjust",
      description: `+${addQuantity} وحدة — ${(cur as DbRow).name as string}`,
      entityType: "product",
      entityId: productId,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("products", "update-stock", e);
    return { error: String(e) };
  }
}
