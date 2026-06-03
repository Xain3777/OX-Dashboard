"use client";

// All Supabase writes go through this module.
// Every function calls Supabase first, adds .select() to confirm the write,
// logs success/failure, and returns the DB row on success.

import { supabaseBrowser } from "./client";
import { getActiveSession, getLastClosedSession } from "./session";
import type { PaymentMethod } from "../types";

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

function isMissingDescriptionColumn(error: unknown): boolean {
  const msg = (error as { message?: string })?.message ?? String(error);
  return msg.includes("'description' column") || msg.includes('"description" column');
}

// Activation code — 2 uppercase letters + 6 digits, e.g. "QK482917".
// Format mirrors the App repo's public.generate_activation_code() helper.
// Uses crypto.getRandomValues when available; falls back to Math.random.
function generateActivationCode(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const buf = new Uint32Array(8);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0xffffffff);
  }
  const l1 = letters[buf[0] % 26];
  const l2 = letters[buf[1] % 26];
  let digits = "";
  for (let i = 2; i < 8; i++) digits += String(buf[i] % 10);
  return `${l1}${l2}${digits}`;
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
    const previousRate = await fetchExchangeRate();
    const { data, error } = await supabase
      .from("app_settings")
      .upsert(
        { key: RATE_KEY, value: rate, updated_at: new Date().toISOString(), updated_by: user.id },
        { onConflict: "key" }
      )
      .select();
    if (error) { logError("app_settings", "upsert", error); return { error: error.message }; }
    logSuccess("app_settings", "upsert", data);

    // Append the change to the exchange_rate_history audit table so the
    // manager dashboard can chart rate-over-time. Best-effort: if this
    // fails, app_settings already reflects the new rate, so the user's
    // intent is honored — we just log the failure for observability.
    const { error: histErr } = await supabase
      .from("exchange_rate_history")
      .insert({ rate, changed_by: user.id });
    if (histErr) logError("exchange_rate_history", "insert", histErr);

    await pushActivity({
      user,
      action: "exchange_rate_update",
      description: `تحديث سعر الصرف — 1$ = ${previousRate.toLocaleString("en-US")} → ${rate.toLocaleString("en-US")} ل.س`,
      oldValue: { rate: previousRate },
      newValue: { rate },
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
  // Structured before/after for edit/delete/cancel events. Older DBs may not
  // have these columns yet — if the insert fails on unknown column, we retry
  // without them so writes don't break before migration 0041 is applied.
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}) {
  try {
    assertUser(opts.user);
    const supabase = supabaseBrowser();
    const cashSessionId = (await getActiveSession())?.id ?? null;
    const basePayload: Record<string, unknown> = {
      action: opts.action,
      description: opts.description,
      amount_syp: opts.amountSYP ?? null,
      amount_usd: opts.amountUSD ?? null,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
      created_by_name: opts.user.displayName,
    };
    const payload: Record<string, unknown> = { ...basePayload };
    if (opts.oldValue !== undefined) payload.old_value = opts.oldValue ?? null;
    if (opts.newValue !== undefined) payload.new_value = opts.newValue ?? null;

    let { error } = await supabase.from("activity_feed").insert(payload);
    if (error) {
      const msg = (error as { message?: string }).message ?? String(error);
      if (msg.includes("old_value") || msg.includes("new_value")) {
        logError("activity_feed", "insert-fallback-no-audit-cols", error);
        const retry = await supabase.from("activity_feed").insert(basePayload);
        error = retry.error;
      }
    }
    if (error) logError("activity_feed", "insert", error);
  } catch (e) {
    logError("activity_feed", "insert", e);
  }
}

// ── stock snapshots ───────────────────────────────────────────
//
// Walks every catalog row where track_stock = true and writes one
// stock_snapshots row per item for the given session and type.
// Uses upsert with on-conflict ignore so a duplicate call is a no-op.
// Called on cash session open and close. Errors are logged but not
// surfaced — the session lifecycle still succeeds.

export async function snapshotStockForSession(opts: {
  user: CurrentUser;
  cashSessionId: string;
  snapshotType: "open" | "close";
  exchangeRate: number;
}): Promise<void> {
  try {
    if (!opts.cashSessionId) return;
    const supabase = supabaseBrowser();
    const { data: items, error } = await supabase
      .from("catalog_items")
      .select(
        "id, name, category, sell_price, sell_currency, cost_price, cost_currency, stock_quantity"
      )
      .eq("track_stock", true)
      .eq("is_active", true);
    if (error) { logError("stock_snapshots", "select-catalog", error); return; }
    if (!items || items.length === 0) return;

    const rate = Number.isFinite(opts.exchangeRate) && opts.exchangeRate > 0
      ? opts.exchangeRate
      : FALLBACK_RATE;

    const rows = items.map((it) => {
      const r = it as Record<string, unknown>;
      return {
        cash_session_id: opts.cashSessionId,
        snapshot_type: opts.snapshotType,
        catalog_item_id: String(r.id),
        item_name_snapshot: String(r.name ?? ""),
        category_snapshot: r.category == null ? null : String(r.category),
        stock_quantity: Number(r.stock_quantity ?? 0),
        sell_price: Number(r.sell_price ?? 0),
        sell_currency: String(r.sell_currency ?? "usd"),
        cost_price: r.cost_price == null ? null : Number(r.cost_price),
        cost_currency: r.cost_currency == null ? null : String(r.cost_currency),
        exchange_rate_to_syp: rate,
        snapshot_by: opts.user.id,
      };
    });

    const { error: insErr } = await supabase
      .from("stock_snapshots")
      .upsert(rows, {
        onConflict: "cash_session_id,snapshot_type,catalog_item_id",
        ignoreDuplicates: true,
      });
    if (insErr) logError("stock_snapshots", "upsert", insErr);
    else logSuccess("stock_snapshots", `upsert-${opts.snapshotType}`, { count: rows.length });
  } catch (e) {
    logError("stock_snapshots", "snapshot", e);
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
  privateCoachName?: string | null;
  coachId?: string | null;
  note?: string | null;
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

    // Activation code — one per subscription row. The unique index on
    // activation_code forbids reuse across rows, so each insert generates a
    // fresh code and probes for collision before insert; the index is the
    // final safety net.
    let activationCode: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = generateActivationCode();
      const { data: clash, error: clashErr } = await supabase
        .from("gym_subscriptions")
        .select("id")
        .eq("activation_code", candidate)
        .limit(1)
        .maybeSingle();
      if (clashErr) {
        logError("gym_subscriptions", "select-activation-code-clash", clashErr);
        activationCode = candidate;
        break;
      }
      if (!clash) {
        activationCode = candidate;
        break;
      }
    }
    if (!activationCode) {
      return { error: "تعذّر توليد رمز تفعيل فريد — حاول مرة أخرى" };
    }

    const trimmedPhone = (opts.phone ?? "").trim();
    const trimmedCoach = (opts.privateCoachName ?? "").trim();
    const trimmedNote  = (opts.note ?? "").trim();
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
      private_coach_name: trimmedCoach || null,
      ...(opts.coachId ? { coach_id: opts.coachId } : {}),
      note: trimmedNote || null,
      activation_code: activationCode,
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

    const subLabel =
      currency === "syp"
        ? `${Math.round(opts.paidAmount).toLocaleString("en-US")} ل.س`
        : `$${opts.paidAmount}`;
    const subUSD =
      currency === "usd"
        ? opts.paidAmount
        : opts.exchangeRate > 0
          ? opts.paidAmount / opts.exchangeRate
          : undefined;
    await pushActivity({
      user: opts.user,
      action: "subscription_create",
      description: `اشتراك جديد — ${opts.memberName} (${opts.planType}) — ${subLabel}`,
      amountUSD: subUSD,
      amountSYP: currency === "syp" ? opts.paidAmount : amountSYP,
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
    privateCoachName?: string | null;
    note?: string | null;
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
    if (fields.privateCoachName !== undefined)
      mapped.private_coach_name = (fields.privateCoachName ?? "").toString().trim() || null;
    if (fields.note !== undefined)
      mapped.note = (fields.note ?? "").toString().trim() || null;
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
    // .maybeSingle() — not .single() — so an RLS-blocked update returns
    // data=null cleanly instead of throwing the cryptic
    // "Cannot coerce the result to a single JSON object" error.
    // The post-check below converts that into a localized message.
    const { data, error } = await supabase
      .from("gym_subscriptions")
      .update(mapped)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) { logError("gym_subscriptions", "update", error); return { error: error.message }; }
    if (!data)  { logError("gym_subscriptions", "update", "no row returned"); return { error: "تعذّر تحديث الاشتراك — تحقق من الصلاحيات أو أن الصف لم يُحذف" }; }
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

// ── subscriptions: renew ──────────────────────────────────────
//
// Renewing a subscription is two writes:
//   1. INSERT a fresh subscription row for the same member with the
//      new plan / amount / start / end. This is the row whose
//      created_at lands in today's session + daily revenue.
//   2. UPDATE the old row to status='renewed' with a back-link to
//      the new row's id.
//
// Both rows share the same member_id, so member counts stay stable.
// Activation codes are NOT reused — every row gets a fresh code via
// pushSubscription's existing generator.
export async function renewSubscription(opts: {
  user: CurrentUser;
  oldSubscriptionId: string;
  memberId?: string;
  memberName: string;
  phone?: string;
  planType: string;
  startDate: string;
  endDate: string;
  amount: number;
  paidAmount: number;
  paymentStatus: "paid" | "partial" | "unpaid";
  paymentMethod?: string;
  currency?: Currency;
  exchangeRate: number;
  privateCoachName?: string | null;
  coachId?: string | null;
  note?: string | null;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.oldSubscriptionId) return { error: "معرّف الاشتراك القديم مفقود" };

    const created = await pushSubscription({
      user: opts.user,
      memberName: opts.memberName,
      memberId: opts.memberId,
      phone: opts.phone,
      planType: opts.planType,
      offer: "none",
      startDate: opts.startDate,
      endDate: opts.endDate,
      amount: opts.amount,
      paidAmount: opts.paidAmount,
      paymentStatus: opts.paymentStatus,
      paymentMethod: opts.paymentMethod,
      currency: opts.currency ?? "usd",
      exchangeRate: opts.exchangeRate,
      privateCoachName: opts.privateCoachName ?? null,
      coachId: opts.coachId ?? null,
      note: opts.note ?? null,
    });
    if (created.error || !created.data) return { error: created.error ?? "تعذر إنشاء الاشتراك الجديد" };

    const newRow = created.data as DbRow;
    const newId  = String(newRow.id);

    const supabase = supabaseBrowser();
    const { error: upErr } = await supabase
      .from("gym_subscriptions")
      .update({ status: "renewed", renewed_to_subscription_id: newId })
      .eq("id", opts.oldSubscriptionId);
    if (upErr) {
      logError("gym_subscriptions", "renew-mark-old", upErr);
      // Don't surface as a hard failure — the new row already exists and
      // money is captured. The cashier can re-mark the old row later.
    }

    return { data: newRow };
  } catch (e) {
    logError("gym_subscriptions", "renew", e);
    return { error: String(e) };
  }
}

// ── coaches roster ────────────────────────────────────────────
//
// Coaches are the gym's employed trainers (NOT members). The roster
// powers the private / coach_private coach picker and per-coach
// revenue rollups. RLS: read = all authenticated; insert = any
// authenticated cashier (so a new coach can be onboarded from the
// subscription form); update / delete = manager only.

export interface CoachRow {
  id: string;
  name: string;
  phone: string | null;
  share_percentage: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export async function fetchCoaches(): Promise<{ data?: CoachRow[]; error?: string }> {
  try {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("coaches")
      .select("id, name, phone, share_percentage, is_active, notes, created_at, created_by")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });
    if (error) { logError("coaches", "select", error); return { error: error.message }; }
    return { data: (data ?? []) as CoachRow[] };
  } catch (e) {
    logError("coaches", "select", e);
    return { error: String(e) };
  }
}

export async function addCoach(opts: {
  user: CurrentUser;
  name: string;
  phone?: string | null;
  sharePercentage?: number | null;
  notes?: string | null;
}): Promise<{ data?: CoachRow; error?: string }> {
  try {
    assertUser(opts.user);
    const trimmedName = opts.name.trim();
    if (!trimmedName) return { error: "اسم الكوتش مطلوب" };
    const supabase = supabaseBrowser();
    const payload = {
      name: trimmedName,
      phone: (opts.phone ?? "").toString().trim() || null,
      share_percentage:
        opts.sharePercentage != null && Number.isFinite(opts.sharePercentage)
          ? opts.sharePercentage
          : null,
      notes: (opts.notes ?? "").toString().trim() || null,
      is_active: true,
      created_by: opts.user.id,
    };
    const { data, error } = await supabase
      .from("coaches")
      .insert(payload)
      .select()
      .single();
    if (error) { logError("coaches", "insert", error); return { error: error.message }; }
    logSuccess("coaches", "insert", data);
    return { data: data as CoachRow };
  } catch (e) {
    logError("coaches", "insert", e);
    return { error: String(e) };
  }
}

export async function updateCoach(
  id: string,
  fields: {
    name?: string;
    phone?: string | null;
    sharePercentage?: number | null;
    notes?: string | null;
    isActive?: boolean;
  },
  user: CurrentUser
): Promise<{ data?: CoachRow; error?: string }> {
  try {
    assertUser(user);
    if (!id) return { error: "معرّف الكوتش مفقود" };
    const mapped: Record<string, unknown> = {};
    if (fields.name !== undefined) mapped.name = fields.name.trim();
    if (fields.phone !== undefined) mapped.phone = (fields.phone ?? "").toString().trim() || null;
    if (fields.sharePercentage !== undefined)
      mapped.share_percentage =
        fields.sharePercentage != null && Number.isFinite(fields.sharePercentage)
          ? fields.sharePercentage
          : null;
    if (fields.notes !== undefined) mapped.notes = (fields.notes ?? "").toString().trim() || null;
    if (fields.isActive !== undefined) mapped.is_active = fields.isActive;

    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("coaches")
      .update(mapped)
      .eq("id", id)
      .select()
      .single();
    if (error) { logError("coaches", "update", error); return { error: error.message }; }
    return { data: data as CoachRow };
  } catch (e) {
    logError("coaches", "update", e);
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

    const saleLabel =
      currency === "syp"
        ? `${Math.round(opts.total).toLocaleString("en-US")} ل.س`
        : `$${opts.total}`;
    const saleUSD =
      currency === "usd"
        ? opts.total
        : opts.exchangeRate > 0
          ? opts.total / opts.exchangeRate
          : undefined;
    const saleSYP = currency === "syp" ? opts.total : amountSYP;
    await pushActivity({
      user: opts.user,
      action: "sale_create",
      description: `بيع ${opts.quantity}× ${opts.productName} — ${saleLabel}`,
      amountUSD: saleUSD,
      amountSYP: saleSYP,
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
  /** Live USD→SYP rate at the moment the expense is created. Snapshotted onto
   *  the row so closeCashSession / fetchExpensesBreakdown can convert SYP
   *  expenses to USD using the rate that was active at write time, never the
   *  current rate. Required for SYP expenses; optional for USD-native ones
   *  (where the rate isn't used to compute USD) but stored anyway for audit. */
  exchangeRate?: number;
  /** Free-form note from the reception daily-expenses block. */
  note?: string | null;
  /** Where the row originated. Defaults to 'manager'; reception's daily
   *  block writes 'reception_daily' so the manager UI can badge it. */
  source?: "manager" | "reception_daily";
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (opts.amount <= 0) return { error: "المبلغ يجب أن يكون أكبر من صفر" };
    if (opts.currency === "syp" && (!opts.exchangeRate || opts.exchangeRate <= 0)) {
      return { error: "سعر الصرف مطلوب لإدخال مصروف بالليرة السورية" };
    }

    const supabase = supabaseBrowser();
    const cashSessionId = (await getActiveSession())?.id ?? null;

    const rate = opts.exchangeRate && opts.exchangeRate > 0 ? opts.exchangeRate : null;
    const amountSYP =
      opts.currency === "syp"
        ? Math.round(opts.amount)
        : rate != null
          ? Math.round(opts.amount * rate)
          : null;

    const note = opts.note == null ? null : String(opts.note).trim() || null;
    const payload = {
      description: opts.description,
      amount: opts.amount,
      currency: opts.currency,
      category: opts.category,
      exchange_rate: rate,
      amount_syp: amountSYP,
      cash_session_id: cashSessionId,
      created_by: opts.user.id,
      created_by_name: opts.user.displayName,
      note,
      source: opts.source ?? "manager",
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

    const amountLabel =
      opts.currency === "syp"
        ? `${Math.round(opts.amount).toLocaleString("en-US")} ل.س`
        : `$${opts.amount}`;
    await pushActivity({
      user: opts.user,
      action: "expense_create",
      description: `مصروف — ${opts.description} — ${amountLabel}`,
      amountUSD: opts.currency === "usd" ? opts.amount : undefined,
      amountSYP: opts.currency === "syp" ? Math.round(opts.amount) : amountSYP ?? undefined,
      entityType: "expense",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("expenses", "insert", e);
    return { error: String(e) };
  }
}

export async function updateExpense(opts: {
  user: CurrentUser;
  id: string;
  description: string;
  amount: number;
  currency: Currency;
  category: string;
  exchangeRate?: number;
  note?: string | null;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.id) return { error: "معرّف المصروف مفقود" };
    if (!opts.description.trim()) return { error: "أدخل وصف المصروف" };
    if (opts.amount <= 0) return { error: "المبلغ يجب أن يكون أكبر من صفر" };
    if (opts.currency === "syp" && (!opts.exchangeRate || opts.exchangeRate <= 0)) {
      return { error: "سعر الصرف مطلوب لإدخال مصروف بالليرة السورية" };
    }

    const rate = opts.exchangeRate && opts.exchangeRate > 0 ? opts.exchangeRate : null;
    const amountSYP =
      opts.currency === "syp"
        ? Math.round(opts.amount)
        : rate != null
          ? Math.round(opts.amount * rate)
          : null;

    const supabase = supabaseBrowser();
    const payload: Record<string, unknown> = {
      description: opts.description.trim(),
      amount: opts.amount,
      currency: opts.currency,
      category: opts.category,
      exchange_rate: rate,
      amount_syp: amountSYP,
    };
    if (opts.note !== undefined) {
      const trimmed = opts.note == null ? null : String(opts.note).trim() || null;
      payload.note = trimmed;
    }

    const { data, error } = await supabase
      .from("expenses")
      .update(payload)
      .eq("id", opts.id)
      .is("cancelled_at", null)
      .select()
      .single();

    if (error) { logError("expenses", "update", error); return { error: error.message }; }
    if (!data) { logError("expenses", "update", "no row returned"); return { error: "لم يتم تحديث المصروف — تحقق من RLS" }; }
    logSuccess("expenses", "update", data);

    await pushActivity({
      user: opts.user,
      action: "expense_update",
      description: `تعديل مصروف — ${opts.description.trim()} — ${opts.currency === "usd" ? "$" : ""}${opts.amount}`,
      amountUSD: opts.currency === "usd" ? opts.amount : undefined,
      amountSYP: amountSYP ?? undefined,
      entityType: "expense",
      entityId: opts.id,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("expenses", "update", e);
    return { error: String(e) };
  }
}

// ── Unified catalog: catalog_items + item_sales (post-0030 schema) ──
//
// New write paths that target the unified catalog tables introduced by
// migrations 0030/0031. The legacy pushSale / persistFoodItem* /
// persistProduct* functions above remain callable for backward compat
// during the cutover but are no longer invoked from the UI.
//
// Currency comes from the catalog row (sell_currency), never from the
// cashier. amount_syp / amount_usd are GENERATED STORED columns on the
// item_sales table — we never write them and the dashboard sums them
// directly with no per-row conversion math.

export interface CatalogItemDb {
  id: string;
  name: string;
  category: string;
  item_type: string;
  sell_currency: "syp" | "usd";
  sell_price: number;
  cost_currency: "syp" | "usd" | null;
  cost_price: number | null;
  stock_quantity: number;
  track_stock: boolean;
  low_stock_threshold: number;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function pushItemSale(opts: {
  user: CurrentUser;
  catalogItem: {
    id: string;
    name: string;
    category: string;
    itemType: string;
    sellCurrency: "syp" | "usd";
    sellPrice: number;
  };
  quantity: number;
  /** Live USD↔SYP rate at sale time. Required for SYP items; for USD
   *  items it's stored too (audit trail) but the math doesn't depend on it. */
  exchangeRate: number;
  paymentMethod?: PaymentMethod;
  source: "kitchen" | "store";
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (opts.quantity <= 0) return { error: "الكمية يجب أن تكون أكبر من صفر" };
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.catalogItem.sellPrice < 0) return { error: "السعر غير صالح" };

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };

    const supabase = supabaseBrowser();
    const unitPrice = Number(opts.catalogItem.sellPrice);
    const originalTotal = Number((unitPrice * opts.quantity).toFixed(4));

    const payload = {
      catalog_item_id: opts.catalogItem.id,
      item_name_snapshot: opts.catalogItem.name,
      category_snapshot: opts.catalogItem.category,
      item_type_snapshot: opts.catalogItem.itemType,
      quantity: opts.quantity,
      unit_price: unitPrice,
      original_currency: opts.catalogItem.sellCurrency,
      original_total: originalTotal,
      exchange_rate_to_syp: opts.exchangeRate,
      source: opts.source,
      payment_method: opts.paymentMethod ?? "cash",
      cash_session_id: session.id,
      created_by: opts.user.id,
      created_by_name: opts.user.displayName,
    };
    console.log("Supabase insert payload:", { table: "item_sales", payload });

    const { data, error } = await supabase
      .from("item_sales")
      .insert(payload)
      .select()
      .single();

    if (error) { logError("item_sales", "insert", error); return { error: error.message }; }
    if (!data) { logError("item_sales", "insert", "no row returned"); return { error: "لم يتم حفظ البيع — تحقق من RLS" }; }
    logSuccess("item_sales", "insert", data);

    // Decrement stock when the catalog item tracks inventory. We don't
    // gate this on currency or item_type — the catalog row's track_stock
    // is the source of truth. Failure here is logged but not surfaced
    // to the cashier (the sale already landed; stock can be reconciled).
    void supabase
      .from("catalog_items")
      .select("track_stock, stock_quantity")
      .eq("id", opts.catalogItem.id)
      .maybeSingle()
      .then(async ({ data: rowData }) => {
        const row = rowData as { track_stock?: boolean; stock_quantity?: number } | null;
        if (!row?.track_stock) return;
        const next = Math.max(0, Number(row.stock_quantity ?? 0) - opts.quantity);
        const { error: stockErr } = await supabase
          .from("catalog_items")
          .update({ stock_quantity: next })
          .eq("id", opts.catalogItem.id);
        if (stockErr) logError("catalog_items", "stock-decrement", stockErr);
      });

    const rowAny = data as DbRow & { amount_usd?: number; amount_syp?: number };
    const usd = Number(rowAny.amount_usd ?? 0);
    const syp = Number(rowAny.amount_syp ?? 0);
    const label = opts.catalogItem.sellCurrency === "syp"
      ? `${Math.round(originalTotal).toLocaleString("en-US")} ل.س`
      : `$${originalTotal}`;
    await pushActivity({
      user: opts.user,
      action: "sale_create",
      description: `بيع ${opts.quantity}× ${opts.catalogItem.name} — ${label}`,
      amountUSD: usd > 0 ? usd : undefined,
      amountSYP: syp > 0 ? syp : undefined,
      entityType: "item_sale",
      entityId: rowAny.id as string,
    });
    return { data: rowAny };
  } catch (e) {
    logError("item_sales", "insert", e);
    return { error: String(e) };
  }
}

// ── catalog_items management (reception can insert stock-tracked
// inventory rows with no cost fields; DELETE remains manager-only.
// Reception updates are limited to sell_price / stock_quantity /
// low_stock_threshold by the BEFORE UPDATE trigger from migration 0030) ──

export async function persistCatalogItemInsert(opts: {
  user: CurrentUser;
  name: string;
  category: string;
  itemType: string;
  sellCurrency: "syp" | "usd";
  sellPrice: number;
  costCurrency?: "syp" | "usd" | null;
  costPrice?: number | null;
  stockQuantity?: number;
  trackStock?: boolean;
  lowStockThreshold?: number;
  sortOrder?: number;
  isActive?: boolean;
  description?: string | null;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    const trimmedName = opts.name.trim();
    if (!trimmedName) return { error: "أدخل اسم الصنف" };
    if (!Number.isFinite(opts.sellPrice) || opts.sellPrice < 0) return { error: "سعر البيع غير صالح" };

    const supabase = supabaseBrowser();
    const payload = {
      name: trimmedName,
      category: opts.category,
      item_type: opts.itemType,
      sell_currency: opts.sellCurrency,
      sell_price: opts.sellPrice,
      cost_currency: opts.costCurrency ?? null,
      cost_price: opts.costPrice == null || !Number.isFinite(opts.costPrice) ? null : opts.costPrice,
      stock_quantity: Number.isInteger(opts.stockQuantity) && (opts.stockQuantity ?? 0) >= 0 ? opts.stockQuantity : 0,
      track_stock: opts.trackStock ?? false,
      low_stock_threshold:
        Number.isInteger(opts.lowStockThreshold) && (opts.lowStockThreshold ?? 0) >= 0
          ? opts.lowStockThreshold
          : 3,
      sort_order: Number.isInteger(opts.sortOrder) ? opts.sortOrder : 0,
      is_active: opts.isActive ?? true,
      description: opts.description == null ? null : String(opts.description).trim() || null,
      created_by: opts.user.id,
    };
    console.log("Supabase insert payload:", { table: "catalog_items", payload });

    let { data, error } = await supabase
      .from("catalog_items")
      .insert(payload)
      .select()
      .single();
    if (error && isMissingDescriptionColumn(error)) {
      logError("catalog_items", "insert-description-retry", error);
      const payloadWithoutDescription: Record<string, unknown> = { ...payload };
      delete payloadWithoutDescription.description;
      const retry = await supabase
        .from("catalog_items")
        .insert(payloadWithoutDescription)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) { logError("catalog_items", "insert", error); return { error: error.message }; }
    if (!data) { logError("catalog_items", "insert", "no row returned"); return { error: "لم يتم إضافة الصنف — تحقق من صلاحيات RLS" }; }
    logSuccess("catalog_items", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "catalog_item_create",
      description: `صنف جديد — ${trimmedName} (${opts.sellPrice} ${opts.sellCurrency === "syp" ? "ل.س" : "$"})`,
      entityType: "catalog_item",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("catalog_items", "insert", e);
    return { error: String(e) };
  }
}

export async function persistCatalogItemUpdate(opts: {
  user: CurrentUser;
  id: string;
  fields: {
    name?: string;
    category?: string;
    itemType?: string;
    sellCurrency?: "syp" | "usd";
    sellPrice?: number;
    costCurrency?: "syp" | "usd" | null;
    costPrice?: number | null;
    stockQuantity?: number;
    trackStock?: boolean;
    lowStockThreshold?: number;
    sortOrder?: number;
    isActive?: boolean;
    description?: string | null;
  };
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.id) return { error: "معرّف الصنف مفقود" };

    const mapped: Record<string, unknown> = {};
    if (opts.fields.name !== undefined)            mapped.name             = opts.fields.name.trim();
    if (opts.fields.category !== undefined)        mapped.category         = opts.fields.category;
    if (opts.fields.itemType !== undefined)        mapped.item_type        = opts.fields.itemType;
    if (opts.fields.sellCurrency !== undefined)    mapped.sell_currency    = opts.fields.sellCurrency;
    if (opts.fields.sellPrice !== undefined) {
      if (!Number.isFinite(opts.fields.sellPrice) || opts.fields.sellPrice < 0) return { error: "سعر البيع غير صالح" };
      mapped.sell_price = opts.fields.sellPrice;
    }
    if (opts.fields.costCurrency !== undefined)    mapped.cost_currency    = opts.fields.costCurrency ?? null;
    if (opts.fields.costPrice !== undefined)
      mapped.cost_price = opts.fields.costPrice == null || !Number.isFinite(opts.fields.costPrice) ? null : opts.fields.costPrice;
    if (opts.fields.stockQuantity !== undefined && Number.isInteger(opts.fields.stockQuantity) && opts.fields.stockQuantity >= 0)
      mapped.stock_quantity = opts.fields.stockQuantity;
    if (opts.fields.trackStock !== undefined)      mapped.track_stock      = opts.fields.trackStock;
    if (opts.fields.lowStockThreshold !== undefined && Number.isInteger(opts.fields.lowStockThreshold) && opts.fields.lowStockThreshold >= 0)
      mapped.low_stock_threshold = opts.fields.lowStockThreshold;
    if (opts.fields.sortOrder !== undefined && Number.isInteger(opts.fields.sortOrder))
      mapped.sort_order = opts.fields.sortOrder;
    if (opts.fields.isActive !== undefined)        mapped.is_active        = opts.fields.isActive;
    if (opts.fields.description !== undefined)
      mapped.description = opts.fields.description == null ? null : String(opts.fields.description).trim() || null;
    if (Object.keys(mapped).length === 0) return { error: "لا توجد تغييرات" };

    const supabase = supabaseBrowser();

    // Read the existing row so we can capture before/after for the audit log.
    // If the read fails we still attempt the update — the audit entry just
    // won't have an oldValue. Use the same column shape we're about to update.
    const auditCols = "name, category, item_type, sell_currency, sell_price, cost_currency, cost_price, stock_quantity, track_stock, low_stock_threshold, sort_order, is_active";
    const { data: priorRow } = await supabase
      .from("catalog_items")
      .select(auditCols)
      .eq("id", opts.id)
      .maybeSingle();

    console.log("Supabase update payload:", { table: "catalog_items", id: opts.id, payload: mapped });
    let { data, error } = await supabase
      .from("catalog_items")
      .update(mapped)
      .eq("id", opts.id)
      .select()
      .single();
    if (error && isMissingDescriptionColumn(error)) {
      logError("catalog_items", "update-description-retry", error);
      const mappedWithoutDescription: Record<string, unknown> = { ...mapped };
      delete mappedWithoutDescription.description;
      const retry = await supabase
        .from("catalog_items")
        .update(mappedWithoutDescription)
        .eq("id", opts.id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      // The reception_locked_column trigger raises this when a non-manager
      // tries to change a column outside (sell_price, stock_quantity,
      // low_stock_threshold). Surface a localized error.
      const msg = (error as { message?: string }).message ?? String(error);
      if (msg.includes("reception_locked_column")) {
        logError("catalog_items", "update-locked", error);
        return { error: "لا يمكن للاستقبال تعديل هذا الحقل — المدير فقط" };
      }
      logError("catalog_items", "update", error);
      return { error: msg };
    }
    if (!data) { logError("catalog_items", "update", "no row returned"); return { error: "لم يتم تعديل الصنف — تحقق من صلاحيات RLS" }; }
    logSuccess("catalog_items", "update", data);

    // Diff prior vs new: only include keys that actually changed.
    const newRow = data as Record<string, unknown>;
    const diffOld: Record<string, unknown> = {};
    const diffNew: Record<string, unknown> = {};
    if (priorRow) {
      const before = priorRow as Record<string, unknown>;
      for (const k of Object.keys(mapped)) {
        if (before[k] !== newRow[k]) {
          diffOld[k] = before[k] ?? null;
          diffNew[k] = newRow[k] ?? null;
        }
      }
    } else {
      for (const k of Object.keys(mapped)) diffNew[k] = newRow[k] ?? null;
    }

    await pushActivity({
      user: opts.user,
      action: "catalog_item_update",
      description: `تعديل صنف — ${(data as DbRow).name as string} (${Object.keys(diffNew).join(", ") || Object.keys(mapped).join(", ")})`,
      entityType: "catalog_item",
      entityId: opts.id,
      oldValue: priorRow ? diffOld : null,
      newValue: diffNew,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("catalog_items", "update", e);
    return { error: String(e) };
  }
}

export async function persistCatalogItemDelete(opts: {
  user: CurrentUser;
  id: string;
}): Promise<{ error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.id) return { error: "معرّف الصنف مفقود" };

    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("catalog_items")
      .delete()
      .eq("id", opts.id)
      .select();
    if (error) { logError("catalog_items", "delete", error); return { error: error.message }; }
    if (!data || (data as unknown[]).length === 0) {
      logError("catalog_items", "delete", "no rows deleted — RLS may be blocking");
      return { error: "لم يتم حذف الصنف — تحقق من صلاحيات المدير" };
    }
    logSuccess("catalog_items", "delete", data);

    const row = (data as DbRow[])[0];
    const r = row as Record<string, unknown>;
    await pushActivity({
      user: opts.user,
      action: "catalog_item_delete",
      description: `حذف صنف — ${(row.name as string) ?? opts.id}`,
      entityType: "catalog_item",
      entityId: opts.id,
      oldValue: {
        name: r.name ?? null,
        category: r.category ?? null,
        item_type: r.item_type ?? null,
        sell_currency: r.sell_currency ?? null,
        sell_price: r.sell_price ?? null,
        cost_currency: r.cost_currency ?? null,
        cost_price: r.cost_price ?? null,
        stock_quantity: r.stock_quantity ?? null,
        track_stock: r.track_stock ?? null,
        low_stock_threshold: r.low_stock_threshold ?? null,
        is_active: r.is_active ?? null,
      },
    });
    return {};
  } catch (e) {
    logError("catalog_items", "delete", e);
    return { error: String(e) };
  }
}

// ── Cancellation (soft-delete) ────────────────────────────────

export type CancellableTable = "sales" | "gym_subscriptions" | "inbody_sessions" | "item_sales" | "expenses";

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

    if (opts.table === "item_sales") {
      const sale = row as DbRow;
      const catalogItemId = sale.catalog_item_id == null ? null : String(sale.catalog_item_id);
      const quantity = Number(sale.quantity ?? 0);
      if (catalogItemId && quantity > 0) {
        const { data: item, error: itemErr } = await supabase
          .from("catalog_items")
          .select("track_stock, stock_quantity")
          .eq("id", catalogItemId)
          .maybeSingle();
        if (itemErr) {
          logError("catalog_items", "select-stock-restore", itemErr);
          return { error: itemErr.message };
        }
        const catalogItem = item as { track_stock?: boolean; stock_quantity?: number } | null;
        if (catalogItem?.track_stock) {
          const restoredStock = Number(catalogItem.stock_quantity ?? 0) + quantity;
          const { error: stockErr } = await supabase
            .from("catalog_items")
            .update({ stock_quantity: restoredStock })
            .eq("id", catalogItemId);
          if (stockErr) {
            logError("catalog_items", "stock-restore", stockErr);
            return { error: stockErr.message };
          }
        }
      }
    }

    const r = row as Record<string, unknown>;
    const label = r.product_name || r.member_name || r.description || r.item_name_snapshot || "عملية";
    const amtSYP = Number(r.amount_syp ?? 0);
    await pushActivity({
      user: opts.user,
      action: `${opts.table}_cancel`,
      description: `إلغاء — ${label}${opts.reason ? ` (${opts.reason})` : ""}`,
      amountSYP: -amtSYP,
      entityType: opts.table,
      entityId: opts.id,
      oldValue: r,
      newValue: { cancelled_at: new Date().toISOString(), cancelled_by: opts.user.id, cancelled_reason: opts.reason ?? null },
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

  // item_sales has GENERATED amount_usd — read it directly. The DB has
  // already done the per-row currency math at write time.
  const sumItemSalesUSD = async (source: "kitchen" | "store"): Promise<number> => {
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

  const [subsTotal, inbodyTotal, storeTotal, mealsTotal] = await Promise.all([
    sumUSD("gym_subscriptions", "paid_amount"),
    sumUSD("inbody_sessions", "amount"),
    sumItemSalesUSD("store"),
    sumItemSalesUSD("kitchen"),
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

    // Snapshot every track_stock catalog row as the session's opening
    // inventory. Fire-and-forget — failure is logged but doesn't block
    // the session opening (snapshots are diagnostic, not load-bearing
    // for the cash-handoff math).
    const sessionId = String((data as DbRow).id);
    const rate = await fetchExchangeRate();
    void snapshotStockForSession({
      user,
      cashSessionId: sessionId,
      snapshotType: "open",
      exchangeRate: rate,
    });

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

    // item_sales has GENERATED amount_usd — read it directly per source.
    const sumItemSalesUSD = async (source: "kitchen" | "store"): Promise<number> => {
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

    const [subsTotal, storeTotal, mealsTotal, inbodyTotal, expensesTotal] = await Promise.all([
      sumCol("gym_subscriptions", "paid_amount"),
      sumItemSalesUSD("store"),
      sumItemSalesUSD("kitchen"),
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

    // Snapshot inventory at close. Counts come from the auto-decrement
    // on each sale (catalog_items.stock_quantity is already current).
    // Fire-and-forget for the same reason as open.
    const rate = await fetchExchangeRate();
    void snapshotStockForSession({
      user,
      cashSessionId: sessionId,
      snapshotType: "close",
      exchangeRate: rate,
    });

    await pushActivity({
      user,
      action: "session_closed",
      description: `إغلاق جلسة — المبلغ الفعلي: $${actualCashUSD.toFixed(2)}`,
      amountUSD: actualCashUSD,
      oldValue: { status: "open" },
      newValue: {
        status: "closed",
        opening_cash: openingCash,
        actual_cash: actualCashUSD,
        expected_cash: expectedCash,
        difference,
      },
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
  privateCoachName?: string | null;
  /** Override the computed price (trainerFee + groupPrice). Useful when
   *  reception negotiates a custom rate. */
  totalPriceOverride?: number;
  baseTrainerFeeOverride?: number;
  groupPriceOverride?: number;
  paidAmount?: number;
  paymentStatus?: "paid" | "partial" | "unpaid";
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.exchangeRate || opts.exchangeRate <= 0) return { error: "سعر الصرف غير صالح" };
    if (opts.numberOfPlayers <= 0) return { error: "عدد اللاعبين يجب أن يكون أكبر من صفر" };

    const BASE_TRAINER_FEE = 18;
    const trainerFee = opts.baseTrainerFeeOverride != null && opts.baseTrainerFeeOverride >= 0
      ? opts.baseTrainerFeeOverride
      : BASE_TRAINER_FEE;
    const groupPrice = opts.groupPriceOverride != null && opts.groupPriceOverride >= 0
      ? opts.groupPriceOverride
      : ptGroupPrice(opts.numberOfPlayers);
    const computedTotal = trainerFee + groupPrice;
    const totalPrice = opts.totalPriceOverride != null && opts.totalPriceOverride >= 0
      ? opts.totalPriceOverride
      : computedTotal;
    const paidAmount = opts.paidAmount != null && opts.paidAmount >= 0 ? opts.paidAmount : totalPrice;
    if (paidAmount > totalPrice && totalPrice > 0) return { error: "المبلغ المدفوع أكبر من المبلغ الإجمالي" };
    const paymentStatus = opts.paymentStatus ??
      (paidAmount <= 0 ? "unpaid" : paidAmount >= totalPrice ? "paid" : "partial");
    const amountSYP = Math.round(totalPrice * opts.exchangeRate);

    const session = await getActiveSession();
    if (!session) return { error: "لا توجد جلسة نقدية مفتوحة — افتح جلسة أولاً" };
    const supabase = supabaseBrowser();
    const cashSessionId = session.id;

    const trimmedCoach = (opts.privateCoachName ?? "").trim();
    const { data, error } = await supabase
      .from("private_sessions")
      .insert({
        number_of_players: opts.numberOfPlayers,
        player_names: opts.playerNames.filter((n) => n.trim()),
        base_trainer_fee: trainerFee,
        group_price: groupPrice,
        total_price: totalPrice,
        paid_amount: paidAmount,
        payment_status: paymentStatus,
        currency: "usd",
        exchange_rate: opts.exchangeRate,
        amount_syp: amountSYP,
        group_id: opts.groupId ?? null,
        notes: opts.notes?.trim() || null,
        private_coach_name: trimmedCoach || null,
        cash_session_id: cashSessionId,
        created_by: opts.user.id,
        created_by_name: opts.user.displayName,
      })
      .select()
      .single();

    if (error) { logError("private_sessions", "insert", error); return { error: error.message }; }
    if (!data) { logError("private_sessions", "insert", "no row returned"); return { error: "لم يتم حفظ الجلسة — تحقق من RLS" }; }
    logSuccess("private_sessions", "insert", data);

    const statusSuffix =
      paymentStatus === "paid" ? "" :
      paymentStatus === "partial" ? ` (مدفوع: $${paidAmount} من $${totalPrice})` :
      ` (غير مدفوع — $${totalPrice})`;
    await pushActivity({
      user: opts.user,
      action: "private_session_create",
      description: `تدريب خاص — ${opts.numberOfPlayers} لاعبين — $${totalPrice}${statusSuffix}`,
      amountUSD: paidAmount,
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
  priceCurrency?: Currency;
  cost?: number | null;
  costCurrency?: Currency;
  stock?: number;
  lowStockThreshold?: number;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    const trimmedName = opts.name.trim();
    if (!trimmedName) return { error: "أدخل اسم المنتج" };
    if (!Number.isFinite(opts.price) || opts.price <= 0) return { error: "سعر البيع غير صالح" };

    const supabase = supabaseBrowser();
    // cost is nullable in 0021 — pass null when caller didn't set it.
    const costValue =
      opts.cost === undefined || opts.cost === null
        ? null
        : Number.isFinite(opts.cost) && opts.cost >= 0 ? opts.cost : null;
    const payload = {
      name: trimmedName,
      category: opts.category,
      cost: costValue,
      cost_currency: opts.costCurrency ?? "usd",
      price: opts.price,
      price_currency: opts.priceCurrency ?? "usd",
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

// === food_items: manager-only catalog mutations ===
//
// food_items is the canonical kitchen menu (RLS: read by all, mutate
// by manager only — see 0003_food_items.sql). Mutations here go
// straight to Supabase; the local store mirrors the returned row.
// Cost is stored in either SYP (cost_syp) or USD (cost_usd); the UI
// converts USD costs at the live exchange rate, never at write-time.

export async function persistFoodItemInsert(opts: {
  user: CurrentUser;
  name: string;
  category: string;
  priceSYP: number;
  costSYP?: number | null;
  costUSD?: number | null;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    const trimmedName = opts.name.trim();
    if (!trimmedName) return { error: "أدخل اسم الصنف" };
    if (!Number.isFinite(opts.priceSYP) || opts.priceSYP < 0) return { error: "سعر البيع غير صالح" };

    const supabase = supabaseBrowser();
    const payload = {
      name: trimmedName,
      category: opts.category,
      price_syp: opts.priceSYP,
      cost_syp: opts.costSYP == null || !Number.isFinite(opts.costSYP) ? null : opts.costSYP,
      cost_usd: opts.costUSD == null || !Number.isFinite(opts.costUSD) ? null : opts.costUSD,
      description: opts.description?.trim() || null,
      sort_order: Number.isInteger(opts.sortOrder) ? opts.sortOrder : 0,
      is_active: opts.isActive ?? true,
    };
    console.log("Supabase insert payload:", { table: "food_items", payload });

    const { data, error } = await supabase
      .from("food_items")
      .insert(payload)
      .select()
      .single();
    if (error) { logError("food_items", "insert", error); return { error: error.message }; }
    if (!data) { logError("food_items", "insert", "no row returned"); return { error: "لم يتم إضافة الصنف — تحقق من RLS" }; }
    logSuccess("food_items", "insert", data);

    await pushActivity({
      user: opts.user,
      action: "food_item_create",
      description: `صنف مطبخ جديد — ${trimmedName} (${opts.priceSYP.toLocaleString("en-US")} ل.س)`,
      entityType: "food_item",
      entityId: (data as DbRow).id as string,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("food_items", "insert", e);
    return { error: String(e) };
  }
}

export async function persistFoodItemUpdate(opts: {
  user: CurrentUser;
  id: string;
  fields: {
    name?: string;
    category?: string;
    priceSYP?: number;
    costSYP?: number | null;
    costUSD?: number | null;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  };
}): Promise<{ data?: DbRow; error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.id) return { error: "معرّف الصنف مفقود" };

    const mapped: Record<string, unknown> = {};
    if (opts.fields.name !== undefined)        mapped.name        = opts.fields.name.trim();
    if (opts.fields.category !== undefined)    mapped.category    = opts.fields.category;
    if (opts.fields.priceSYP !== undefined) {
      if (!Number.isFinite(opts.fields.priceSYP) || opts.fields.priceSYP < 0) return { error: "سعر البيع غير صالح" };
      mapped.price_syp = opts.fields.priceSYP;
    }
    if (opts.fields.costSYP !== undefined)
      mapped.cost_syp = opts.fields.costSYP == null || !Number.isFinite(opts.fields.costSYP) ? null : opts.fields.costSYP;
    if (opts.fields.costUSD !== undefined)
      mapped.cost_usd = opts.fields.costUSD == null || !Number.isFinite(opts.fields.costUSD) ? null : opts.fields.costUSD;
    if (opts.fields.description !== undefined)
      mapped.description = (opts.fields.description ?? "").toString().trim() || null;
    if (opts.fields.sortOrder !== undefined && Number.isInteger(opts.fields.sortOrder))
      mapped.sort_order = opts.fields.sortOrder;
    if (opts.fields.isActive !== undefined) mapped.is_active = opts.fields.isActive;
    mapped.updated_at = new Date().toISOString();
    if (Object.keys(mapped).length === 1) return { error: "لا توجد تغييرات" };

    const supabase = supabaseBrowser();
    console.log("Supabase update payload:", { table: "food_items", id: opts.id, payload: mapped });
    const { data, error } = await supabase
      .from("food_items")
      .update(mapped)
      .eq("id", opts.id)
      .select()
      .single();
    if (error) { logError("food_items", "update", error); return { error: error.message }; }
    if (!data) { logError("food_items", "update", "no row returned"); return { error: "لم يتم تعديل الصنف — تحقق من صلاحيات المدير" }; }
    logSuccess("food_items", "update", data);

    await pushActivity({
      user: opts.user,
      action: "food_item_update",
      description: `تعديل صنف — ${(data as DbRow).name as string} (${Object.keys(mapped).filter((k) => k !== "updated_at").join(", ")})`,
      entityType: "food_item",
      entityId: opts.id,
    });
    return { data: data as DbRow };
  } catch (e) {
    logError("food_items", "update", e);
    return { error: String(e) };
  }
}

export async function persistFoodItemDelete(opts: {
  user: CurrentUser;
  id: string;
}): Promise<{ error?: string }> {
  try {
    assertUser(opts.user);
    if (!opts.id) return { error: "معرّف الصنف مفقود" };

    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("food_items")
      .delete()
      .eq("id", opts.id)
      .select();
    if (error) { logError("food_items", "delete", error); return { error: error.message }; }
    if (!data || (data as unknown[]).length === 0) {
      logError("food_items", "delete", "no rows deleted — RLS may be blocking");
      return { error: "لم يتم حذف الصنف — تحقق من صلاحيات المدير" };
    }
    logSuccess("food_items", "delete", data);

    const row = (data as DbRow[])[0];
    await pushActivity({
      user: opts.user,
      action: "food_item_delete",
      description: `حذف صنف — ${(row.name as string) ?? opts.id}`,
      entityType: "food_item",
      entityId: opts.id,
    });
    return {};
  } catch (e) {
    logError("food_items", "delete", e);
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
