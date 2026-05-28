"use client";

// Live KPIs — all amounts in USD, derived entirely from Supabase.
// No expenses, no discrepancy logic, no SYP conversions here.

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "./client";


export interface LiveKPI {
  todayRevenueUSD: number;
  activeMembers: number;
  expiringThisWeek: number;
  endedCount: number;
  cashOnHandUSD: number;   // open-session opening_cash + today's income
  lowStockItems: number;
  monthlyRevenueUSD: number;
  partiallyPaidCount: number;
  partiallyPaidRemainingUSD: number;
}

const ZERO: LiveKPI = {
  todayRevenueUSD: 0,
  activeMembers: 0,
  expiringThisWeek: 0,
  endedCount: 0,
  cashOnHandUSD: 0,
  lowStockItems: 0,
  monthlyRevenueUSD: 0,
  partiallyPaidCount: 0,
  partiallyPaidRemainingUSD: 0,
};

function startOfTodayISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function startOfMonthISO() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function inSevenDaysISO() {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(23, 59, 59, 999);
  return d.toISOString().slice(0, 10);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

// Tables with a `member_name` column whose rows we want to exclude when
// the name contains "test" (case-insensitive). Sales/expenses don't have
// member_name, so the filter is skipped automatically.
const MEMBER_NAMED_TABLES = new Set<string>(["gym_subscriptions", "inbody_sessions"]);

async function sumUSD(
  table: string,
  col: string,
  since: string,
  source?: string,
): Promise<number> {
  const supabase = supabaseBrowser();
  // Pull currency and exchange_rate alongside the amount so we can normalize
  // any row stored in SYP (kitchen sales today; potentially store sales /
  // subs in the future) to USD. Without this, raw SYP totals were summed
  // into USD aggregates — the kitchen-currency bug from ultrareview.
  const select = `${col}, currency, exchange_rate`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from(table)
    .select(select)
    .gte("created_at", since)
    .is("cancelled_at", null);
  if (source) q = q.eq("source", source);
  if (MEMBER_NAMED_TABLES.has(table)) q = q.not("member_name", "ilike", "%test%");
  const { data } = await q;
  return (data ?? []).reduce((a: number, r: unknown) => {
    const row    = r as Record<string, unknown>;
    const amount = Number(row[col] ?? 0);
    const cur    = String(row.currency ?? "usd");
    const rate   = Number(row.exchange_rate ?? 1) || 1;
    return a + (cur === "syp" ? amount / rate : amount);
  }, 0);
}

// Sum item_sales.amount_usd directly. The amount_usd column is GENERATED
// from each row's own exchange_rate_to_syp snapshot, so historical totals
// stay correct when the live rate changes. No per-row conversion math
// needed in the app — the DB does it once at write time.
async function sumItemSalesUSD(
  since: string,
  source?: "kitchen" | "store",
): Promise<number> {
  const supabase = supabaseBrowser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("item_sales")
    .select("amount_usd")
    .gte("created_at", since)
    .is("cancelled_at", null);
  if (source) q = q.eq("source", source);
  const { data } = await q;
  return (data ?? []).reduce(
    (a: number, r: unknown) => a + Number((r as Record<string, unknown>).amount_usd ?? 0),
    0,
  );
}

export async function fetchLiveKPI(): Promise<LiveKPI> {
  const supabase = supabaseBrowser();
  const today = startOfTodayISO();
  const month = startOfMonthISO();

  const [
    todaySubsUSD,
    todayStoreUSD,
    todayKitchenUSD,
    todayInbodyUSD,
    monthSubsUSD,
    monthStoreUSD,
    monthKitchenUSD,
    monthInbodyUSD,
    activeSubs,
    expiringSoon,
    endedSubs,
    openSessions,
    lowStock,
    partiallyPaid,
  ] = await Promise.all([
    sumUSD("gym_subscriptions", "paid_amount", today),
    sumItemSalesUSD(today, "store"),
    sumItemSalesUSD(today, "kitchen"),
    sumUSD("inbody_sessions", "amount",      today),
    sumUSD("gym_subscriptions", "paid_amount", month),
    sumItemSalesUSD(month, "store"),
    sumItemSalesUSD(month, "kitchen"),
    sumUSD("inbody_sessions", "amount",      month),
    supabase
      .from("gym_subscriptions")
      .select("member_name", { count: "exact", head: true })
      .eq("status", "active")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", todayISO())
      .lte("end_date", inSevenDaysISO())
      .not("member_name", "ilike", "%test%"),
    // "Ended" = expired explicitly OR an active row whose end_date is in
    // the past. Cancelled rows are excluded. We can't combine `.or()` with
    // a chained `.is()` (it AND-merges in a way that breaks the OR group),
    // so encode the cancellation guard inside the OR filter itself.
    supabase
      .from("gym_subscriptions")
      .select("id", { count: "exact", head: true })
      .or(
        `and(status.eq.expired,cancelled_at.is.null),` +
        `and(status.eq.active,end_date.lt.${todayISO()},cancelled_at.is.null)`
      )
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("cash_sessions")
      .select("opening_cash")
      .eq("status", "open"),
    supabase
      .from("catalog_items")
      .select("id, stock_quantity, low_stock_threshold, track_stock")
      .eq("track_stock", true)
      .eq("is_active", true),
    // Partially paid subscriptions (any offer type, any plan).
    // We pull amount + paid_amount + currency + exchange_rate so we can
    // surface remaining balances in USD even if the row was stored in SYP.
    supabase
      .from("gym_subscriptions")
      .select("amount, paid_amount, currency, exchange_rate")
      .eq("payment_status", "partial")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
  ]);

  const todayRevenueUSD   = todaySubsUSD + todayStoreUSD + todayKitchenUSD + todayInbodyUSD;
  const monthlyRevenueUSD = monthSubsUSD + monthStoreUSD + monthKitchenUSD + monthInbodyUSD;
  const openOpening = (openSessions.data ?? []).reduce(
    (a: number, r: Record<string, unknown>) => a + Number(r.opening_cash ?? 0),
    0,
  );
  const cashOnHandUSD = openOpening + todayRevenueUSD;

  const lowStockCount = (lowStock.data ?? []).filter(
    (p: Record<string, unknown>) =>
      Number(p.stock_quantity ?? 0) <= Number(p.low_stock_threshold ?? 0),
  ).length;

  const partialRows = (partiallyPaid.data ?? []) as Record<string, unknown>[];
  const partiallyPaidCount = partialRows.length;
  const partiallyPaidRemainingUSD = partialRows.reduce((acc, r) => {
    const amount     = Number(r.amount ?? 0);
    const paidAmount = Number(r.paid_amount ?? 0);
    const currency   = String(r.currency ?? "usd");
    const rate       = Number(r.exchange_rate ?? 0);
    const remaining  = amount - paidAmount;
    if (remaining <= 0) return acc;
    if (currency === "syp" && rate > 0) return acc + remaining / rate;
    return acc + remaining;
  }, 0);

  return {
    todayRevenueUSD:   Number(todayRevenueUSD.toFixed(2)),
    activeMembers:     activeSubs.count ?? 0,
    expiringThisWeek:  expiringSoon.count ?? 0,
    endedCount:        endedSubs.count ?? 0,
    cashOnHandUSD:     Number(cashOnHandUSD.toFixed(2)),
    lowStockItems:     lowStockCount,
    monthlyRevenueUSD: Number(monthlyRevenueUSD.toFixed(2)),
    partiallyPaidCount,
    partiallyPaidRemainingUSD: Number(partiallyPaidRemainingUSD.toFixed(2)),
  };
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
//
// "Daily" is a Damascus-local calendar day, not a UTC day, and not a cash
// session. Rows are filtered by `created_at` falling inside the Damascus-day
// window, so the report is correct for overnight shifts, multi-shift days,
// and days where the cash session was opened the previous evening.

export interface SubscriptionDailyRow {
  time: string;
  memberName: string;
  phone: string;
  planType: string;
  offer: string;
  startDate: string;
  endDate: string;
  amount: number;       // full price (USD)
  paidAmount: number;   // actually paid (USD)
  remaining: number;    // amount - paidAmount
  paymentStatus: string;
  paymentMethod: string;
  by: string;
}

export interface SaleDailyRow {
  time: string;
  productName: string;
  quantity: number;
  unitPriceUSD: number;
  totalUSD: number;
  paymentMethod: string;
  by: string;
}

// Per-item inventory + profit reconciliation for the daily report.
// openingStock is DERIVED as currentStock + soldQty — accurate only if the
// item was not restocked/adjusted mid-day. revenue/cost/profit are in the
// item's native sell currency (`currency`); costKnown is false when the
// catalog row has no cost_price (then cost/profit are not meaningful).
export interface InventoryRow {
  name: string;
  category: string;
  itemType: string;
  trackStock: boolean;
  openingStock: number | null;  // null when track_stock is off
  soldQty: number;
  currentStock: number | null;  // null when track_stock is off
  currency: "syp" | "usd";
  revenue: number;
  cost: number;
  profit: number;
  costKnown: boolean;
}

export interface InBodyDailyRow {
  time: string;
  memberName: string;
  sessionType: string;
  amountUSD: number;
  by: string;
}

export interface ExpenseDailyRow {
  time: string;
  description: string;
  category: string;
  amountUSD: number;
  originalAmount: number;
  currency: string;
  by: string;
  cancelled: boolean;
}

export interface ShiftBreakdown {
  sessionId: string;
  employeeName: string;
  openedAt: string;
  closedAt: string | null;
  status: string;
  shiftLabel: string;   // "صباحية" / "ظهيرة" / "مسائية" / "ليلية" based on opened_at hour
  openingCashUSD: number;
  actualCashUSD: number | null;
  expectedCashUSD: number | null;
  differenceUSD: number | null;
  subscriptionsUSD: number;
  storeSalesUSD: number;
  kitchenSalesUSD: number;
  inbodyUSD: number;
  expensesUSD: number;
  incomeUSD: number;
  netUSD: number;
  counts: {
    subscriptions: number;
    storeSales: number;
    kitchenSales: number;
    inbody: number;
    expenses: number;
  };
}

export interface ActivityEntryRow {
  time: string;
  action: string;
  description: string;
  amountUSD: number | null;
  amountSYP: number | null;
  by: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}

export interface DailyReport {
  date: string;
  windowStartUTC: string;
  windowEndUTC: string;
  sessionsCount: number;
  totals: {
    subscriptionsUSD: number;
    storeSalesUSD: number;
    kitchenSalesUSD: number;
    inbodyUSD: number;
    expensesUSD: number;
    incomeUSD: number;
    netUSD: number;
  };
  counts: {
    subscriptions: number;
    storeSales: number;
    kitchenSales: number;
    inbody: number;
    expenses: number;
  };
  subscriptions: SubscriptionDailyRow[];
  storeSales: SaleDailyRow[];
  kitchenSales: SaleDailyRow[];
  inbody: InBodyDailyRow[];
  expenses: ExpenseDailyRow[];
  shifts: ShiftBreakdown[];
  activity: ActivityEntryRow[];
  inventory: {
    kitchen: InventoryRow[];
    store: InventoryRow[];
  };
}

// Damascus has been UTC+3 year-round since 2022 (no DST). Anchoring the
// day window via the +03:00 offset is timezone-correct without relying on
// the runtime's local TZ.
const DAMASCUS_OFFSET = "+03:00";

function damascusDayWindowUTC(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000${DAMASCUS_OFFSET}`).toISOString();
  const end   = new Date(`${date}T23:59:59.999${DAMASCUS_OFFSET}`).toISOString();
  return { start, end };
}

function toUSD(amount: number, currency: string, rate: number): number {
  if (currency === "syp" && rate > 0) return amount / rate;
  return amount;
}

export async function fetchDailyReport(date: string): Promise<DailyReport> {
  const supabase = supabaseBrowser();
  const { start: dayStart, end: dayEnd } = damascusDayWindowUTC(date);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name");
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    const pr = p as Record<string, unknown>;
    nameMap[String(pr.id)] = String(pr.display_name ?? "");
  }

  const [sessionsRes, subsRes, salesRes, inbodyRes, expensesRes, activityRes, catalogRes] = await Promise.all([
    supabase
      .from("cash_sessions")
      .select(
        "id, opened_at, closed_at, status, opening_cash, actual_cash, expected_cash, difference, opened_by"
      )
      .gte("opened_at", dayStart)
      .lte("opened_at", dayEnd)
      .order("opened_at", { ascending: true }),
    supabase
      .from("gym_subscriptions")
      .select(
        "created_at, member_name, phone, plan_type, offer, start_date, end_date, " +
        "amount, paid_amount, payment_status, payment_method, currency, exchange_rate, created_by, cash_session_id"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("item_sales")
      .select(
        "created_at, source, catalog_item_id, item_name_snapshot, quantity, unit_price, original_total, " +
        "original_currency, exchange_rate_to_syp, amount_usd, payment_method, " +
        "created_by, created_by_name, cash_session_id"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null),
    supabase
      .from("inbody_sessions")
      .select(
        "created_at, member_name, session_type, amount, currency, exchange_rate, " +
        "created_by, created_by_name, cash_session_id"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    // Expenses are fetched INCLUDING cancelled rows so the daily report can
    // list them all with a "cancelled?" column. Cancelled rows are excluded
    // from money totals / counts below — only the detail list shows them.
    supabase
      .from("expenses")
      .select("created_at, description, category, amount, currency, exchange_rate, created_by, cash_session_id, cancelled_at")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd),
    supabase
      .from("activity_feed")
      .select(
        "id, action, description, amount_syp, amount_usd, created_at, created_by, created_by_name, old_value, new_value"
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .order("created_at", { ascending: true }),
    supabase
      .from("catalog_items")
      .select(
        "id, name, category, item_type, sell_currency, cost_currency, cost_price, stock_quantity, track_stock, is_active"
      ),
  ]);

  const sessionsCount = (sessionsRes.data ?? []).length;

  const subscriptions: SubscriptionDailyRow[] = (subsRes.data ?? []).map((s) => {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const amount     = toUSD(Number(r.amount ?? 0),      currency, rate);
    const paidAmount = toUSD(Number(r.paid_amount ?? 0), currency, rate);
    return {
      time: String(r.created_at ?? ""),
      memberName: String(r.member_name ?? ""),
      phone: String(r.phone ?? ""),
      planType: String(r.plan_type ?? ""),
      offer: String(r.offer ?? "none"),
      startDate: String(r.start_date ?? ""),
      endDate: String(r.end_date ?? ""),
      amount: Number(amount.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      remaining: Number((amount - paidAmount).toFixed(2)),
      paymentStatus: String(r.payment_status ?? ""),
      paymentMethod: String(r.payment_method ?? ""),
      by: nameMap[String(r.created_by ?? "")] ?? String(r.created_by ?? ""),
    };
  });

  const storeSales: SaleDailyRow[] = [];
  const kitchenSales: SaleDailyRow[] = [];
  for (const s of salesRes.data ?? []) {
    const r = s as unknown as Record<string, unknown>;
    // item_sales already has amount_usd as a generated column.
    const qty = Number(r.quantity ?? 1);
    const total = Number(r.amount_usd ?? 0);
    const unit = qty > 0 ? total / qty : 0;
    const row: SaleDailyRow = {
      time: String(r.created_at ?? ""),
      productName: String(r.item_name_snapshot ?? ""),
      quantity: qty,
      unitPriceUSD: Number(unit.toFixed(2)),
      totalUSD: Number(total.toFixed(2)),
      paymentMethod: String(r.payment_method ?? ""),
      by: String(r.created_by_name ?? nameMap[String(r.created_by ?? "")] ?? ""),
    };
    if (String(r.source ?? "store") === "kitchen") kitchenSales.push(row);
    else storeSales.push(row);
  }

  const inbody: InBodyDailyRow[] = (inbodyRes.data ?? []).map((s) => {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const usd = toUSD(Number(r.amount ?? 0), currency, rate);
    return {
      time: String(r.created_at ?? ""),
      memberName: String(r.member_name ?? ""),
      sessionType: String(r.session_type ?? ""),
      amountUSD: Number(usd.toFixed(2)),
      by: String(r.created_by_name ?? nameMap[String(r.created_by ?? "")] ?? ""),
    };
  });

  const expenses: ExpenseDailyRow[] = (expensesRes.data ?? []).map((s) => {
    const r = s as unknown as Record<string, unknown>;
    const currency = String(r.currency ?? "usd");
    const rate = Number(r.exchange_rate ?? 0);
    const raw = Number(r.amount ?? 0);
    const usd = toUSD(raw, currency, rate);
    return {
      time: String(r.created_at ?? ""),
      description: String(r.description ?? ""),
      category: String(r.category ?? ""),
      amountUSD: Number(usd.toFixed(2)),
      originalAmount: raw,
      currency,
      by: nameMap[String(r.created_by ?? "")] ?? String(r.created_by ?? ""),
      cancelled: r.cancelled_at != null,
    };
  });

  const sortByTime = <T extends { time: string }>(rows: T[]) =>
    rows.sort((a, b) => a.time.localeCompare(b.time));
  sortByTime(subscriptions);
  sortByTime(storeSales);
  sortByTime(kitchenSales);
  sortByTime(inbody);
  sortByTime(expenses);

  const subscriptionsUSD = subscriptions.reduce((a, r) => a + r.paidAmount, 0);
  const storeSalesUSD    = storeSales.reduce((a, r) => a + r.totalUSD, 0);
  const kitchenSalesUSD  = kitchenSales.reduce((a, r) => a + r.totalUSD, 0);
  const inbodyUSD        = inbody.reduce((a, r) => a + r.amountUSD, 0);
  const expensesUSD      = expenses.reduce((a, r) => a + (r.cancelled ? 0 : r.amountUSD), 0);
  const incomeUSD        = subscriptionsUSD + storeSalesUSD + kitchenSalesUSD + inbodyUSD;

  // ─── Per-shift breakdown ────────────────────────────────────────────────
  // For each cash_session opened during this day, bucket every transaction
  // that carries its session_id (regardless of when within the day the
  // transaction was logged). The shift label is derived from the hour of
  // opened_at in Damascus time so the manager sees "صباحية" / "مسائية" etc.
  function shiftLabel(openedAt: string): string {
    const h = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Damascus",
        hour: "2-digit",
        hour12: false,
      }).format(new Date(openedAt))
    );
    if (h >= 5  && h < 12) return "صباحية";
    if (h >= 12 && h < 17) return "ظهيرة";
    if (h >= 17 && h < 22) return "مسائية";
    return "ليلية";
  }

  const sessionRows = (sessionsRes.data ?? []) as unknown as Record<string, unknown>[];
  const subRowsAll  = (subsRes.data ?? [])     as unknown as Record<string, unknown>[];
  const saleRowsAll = (salesRes.data ?? [])    as unknown as Record<string, unknown>[];
  const ibRowsAll   = (inbodyRes.data ?? [])   as unknown as Record<string, unknown>[];
  const expRowsAll  = (expensesRes.data ?? []) as unknown as Record<string, unknown>[];

  const shifts: ShiftBreakdown[] = sessionRows.map((s) => {
    const sid = String(s.id);
    const openedAt = String(s.opened_at ?? "");
    const subRowsForSession    = subRowsAll.filter((r) => String(r.cash_session_id ?? "") === sid);
    const inbodyRowsForSession = ibRowsAll.filter((r)  => String(r.cash_session_id ?? "") === sid);
    // Cancelled expenses are excluded from per-shift totals/counts.
    const expRowsForSession    = expRowsAll.filter((r) => String(r.cash_session_id ?? "") === sid && r.cancelled_at == null);
    const subsUSD = subRowsForSession.reduce((a, row) =>
      a + toUSD(Number(row.paid_amount ?? 0), String(row.currency ?? "usd"), Number(row.exchange_rate ?? 0)), 0);
    const inbodyUSDs = inbodyRowsForSession.reduce((a, row) =>
      a + toUSD(Number(row.amount ?? 0), String(row.currency ?? "usd"), Number(row.exchange_rate ?? 0)), 0);
    const expUSDs = expRowsForSession.reduce((a, row) =>
      a + toUSD(Number(row.amount ?? 0), String(row.currency ?? "usd"), Number(row.exchange_rate ?? 0)), 0);
    // item_sales has GENERATED amount_usd — just sum it.
    const storeRowsForSession   = saleRowsAll.filter((r) => String(r.cash_session_id ?? "") === sid && String(r.source ?? "store") === "store");
    const kitchenRowsForSession = saleRowsAll.filter((r) => String(r.cash_session_id ?? "") === sid && String(r.source ?? "store") === "kitchen");
    const storeUSDs   = storeRowsForSession.reduce((a, r)   => a + Number(r.amount_usd ?? 0), 0);
    const kitchenUSDs = kitchenRowsForSession.reduce((a, r) => a + Number(r.amount_usd ?? 0), 0);
    const incomeUSDs  = subsUSD + storeUSDs + kitchenUSDs + inbodyUSDs;

    return {
      sessionId: sid,
      employeeName: nameMap[String(s.opened_by ?? "")] ?? "—",
      openedAt,
      closedAt: s.closed_at ? String(s.closed_at) : null,
      status: String(s.status ?? ""),
      shiftLabel: openedAt ? shiftLabel(openedAt) : "—",
      openingCashUSD:   Number(Number(s.opening_cash ?? 0).toFixed(2)),
      actualCashUSD:    s.actual_cash   == null ? null : Number(Number(s.actual_cash).toFixed(2)),
      expectedCashUSD:  s.expected_cash == null ? null : Number(Number(s.expected_cash).toFixed(2)),
      differenceUSD:    s.difference    == null ? null : Number(Number(s.difference).toFixed(2)),
      subscriptionsUSD: Number(subsUSD.toFixed(2)),
      storeSalesUSD:    Number(storeUSDs.toFixed(2)),
      kitchenSalesUSD:  Number(kitchenUSDs.toFixed(2)),
      inbodyUSD:        Number(inbodyUSDs.toFixed(2)),
      expensesUSD:      Number(expUSDs.toFixed(2)),
      incomeUSD:        Number(incomeUSDs.toFixed(2)),
      netUSD:           Number((incomeUSDs - expUSDs).toFixed(2)),
      counts: {
        subscriptions: subRowsForSession.length,
        storeSales:    storeRowsForSession.length,
        kitchenSales:  kitchenRowsForSession.length,
        inbody:        inbodyRowsForSession.length,
        expenses:      expRowsForSession.length,
      },
    };
  });

  // ─── Activity log for the day ───────────────────────────────────────────
  const activity: ActivityEntryRow[] = (activityRes.data ?? []).map((a) => {
    const r = a as Record<string, unknown>;
    return {
      time: String(r.created_at ?? ""),
      action: String(r.action ?? ""),
      description: String(r.description ?? ""),
      amountUSD: r.amount_usd == null ? null : Number(r.amount_usd),
      amountSYP: r.amount_syp == null ? null : Number(r.amount_syp),
      by: String(r.created_by_name ?? nameMap[String(r.created_by ?? "")] ?? ""),
      oldValue: (r.old_value as Record<string, unknown> | null) ?? null,
      newValue: (r.new_value as Record<string, unknown> | null) ?? null,
    };
  });

  // ─── Inventory + profit reconciliation ──────────────────────────────────
  // Per-item: opening stock (DERIVED = current + sold), units sold today,
  // current stock, and revenue/cost/profit in the item's native sell
  // currency. The derived opening is exact only when the item was not
  // restocked/adjusted mid-day — it's a best estimate, not an audit number.
  const KITCHEN_ITEM_TYPES = new Set(["meal", "water", "drink"]);

  type InvAccum = {
    soldQty: number;
    revenue: number;            // native sell currency
    cost: number;               // native sell currency
    costKnown: boolean;
    currency: "syp" | "usd";    // used only for legacy (no catalog) rows
  };
  const salesByCatalogId = new Map<string, InvAccum>();
  const salesByName = new Map<string, InvAccum>();

  const catalogRows = (catalogRes.data ?? []) as unknown as Record<string, unknown>[];
  const catalogById = new Map<string, Record<string, unknown>>();
  for (const c of catalogRows) catalogById.set(String(c.id), c);

  // Per-unit cost expressed in the item's *sell* currency. Converts from the
  // catalog row's cost_currency using the sale's snapshot rate when they
  // differ. Returns null when the catalog row has no cost recorded.
  function unitCostInSellCurrency(
    cat: Record<string, unknown> | undefined,
    rate: number
  ): number | null {
    if (!cat || cat.cost_price == null) return null;
    const costPrice = Number(cat.cost_price);
    const costCur = String(cat.cost_currency ?? cat.sell_currency ?? "usd");
    const sellCur = String(cat.sell_currency ?? "usd");
    if (costCur === sellCur) return costPrice;
    if (costCur === "usd" && sellCur === "syp") return rate > 0 ? costPrice * rate : null;
    if (costCur === "syp" && sellCur === "usd") return rate > 0 ? costPrice / rate : null;
    return costPrice;
  }

  for (const s of salesRes.data ?? []) {
    const r = s as unknown as Record<string, unknown>;
    const catId = r.catalog_item_id == null ? "" : String(r.catalog_item_id);
    const cat = catId ? catalogById.get(catId) : undefined;
    const qty = Number(r.quantity ?? 0);
    const rate = Number(r.exchange_rate_to_syp ?? 0);
    const revenue = Number(r.original_total ?? 0);
    const unitCost = unitCostInSellCurrency(cat, rate);
    const key = catId || `name:${String(r.item_name_snapshot ?? "")}`;
    const bucket = catId ? salesByCatalogId : salesByName;
    const acc = bucket.get(key) ?? {
      soldQty: 0, revenue: 0, cost: 0, costKnown: true,
      currency: String(r.original_currency ?? "usd") === "syp" ? "syp" : "usd",
    };
    acc.soldQty += qty;
    acc.revenue += revenue;
    if (unitCost == null) acc.costKnown = false;
    else acc.cost += unitCost * qty;
    bucket.set(key, acc);
  }

  function buildInventoryRow(cat: Record<string, unknown>, acc: InvAccum | undefined): InventoryRow {
    const tracked = Boolean(cat.track_stock);
    const soldQty = acc?.soldQty ?? 0;
    const currentStock = tracked ? Number(cat.stock_quantity ?? 0) : null;
    return {
      name: String(cat.name ?? ""),
      category: String(cat.category ?? ""),
      itemType: String(cat.item_type ?? ""),
      trackStock: tracked,
      currentStock,
      openingStock: tracked ? (currentStock as number) + soldQty : null,
      soldQty,
      currency: String(cat.sell_currency ?? "usd") === "syp" ? "syp" : "usd",
      revenue: Number((acc?.revenue ?? 0).toFixed(2)),
      cost: Number((acc?.cost ?? 0).toFixed(2)),
      profit: Number(((acc?.revenue ?? 0) - (acc?.cost ?? 0)).toFixed(2)),
      costKnown: acc?.costKnown ?? true,
    };
  }

  const inventoryKitchen: InventoryRow[] = [];
  const inventoryStore: InventoryRow[] = [];
  for (const cat of catalogRows) {
    const acc = salesByCatalogId.get(String(cat.id));
    // Include every stock-tracked item, plus any item sold today.
    if (!cat.track_stock && !acc) continue;
    const row = buildInventoryRow(cat, acc);
    if (KITCHEN_ITEM_TYPES.has(row.itemType)) inventoryKitchen.push(row);
    else inventoryStore.push(row);
  }
  // Legacy sales whose catalog_item_id is null can't be matched to a catalog
  // row — surface them as sold-only rows so their revenue isn't dropped.
  for (const [key, acc] of salesByName) {
    inventoryStore.push({
      name: key.slice("name:".length),
      category: "", itemType: "other", trackStock: false,
      openingStock: null, soldQty: acc.soldQty, currentStock: null,
      currency: acc.currency,
      revenue: Number(acc.revenue.toFixed(2)),
      cost: Number(acc.cost.toFixed(2)),
      profit: Number((acc.revenue - acc.cost).toFixed(2)),
      costKnown: acc.costKnown,
    });
  }
  const invSort = (a: InventoryRow, b: InventoryRow) =>
    b.soldQty - a.soldQty || a.name.localeCompare(b.name, "ar");
  inventoryKitchen.sort(invSort);
  inventoryStore.sort(invSort);

  return {
    date,
    windowStartUTC: dayStart,
    windowEndUTC: dayEnd,
    sessionsCount,
    totals: {
      subscriptionsUSD: Number(subscriptionsUSD.toFixed(2)),
      storeSalesUSD:    Number(storeSalesUSD.toFixed(2)),
      kitchenSalesUSD:  Number(kitchenSalesUSD.toFixed(2)),
      inbodyUSD:        Number(inbodyUSD.toFixed(2)),
      expensesUSD:      Number(expensesUSD.toFixed(2)),
      incomeUSD:        Number(incomeUSD.toFixed(2)),
      netUSD:           Number((incomeUSD - expensesUSD).toFixed(2)),
    },
    counts: {
      subscriptions: subscriptions.length,
      storeSales:    storeSales.length,
      kitchenSales:  kitchenSales.length,
      inbody:        inbody.length,
      // Active (non-cancelled) count — pairs with expensesUSD in the summary.
      expenses:      expenses.filter((r) => !r.cancelled).length,
    },
    subscriptions,
    storeSales,
    kitchenSales,
    inbody,
    expenses,
    shifts,
    activity,
    inventory: {
      kitchen: inventoryKitchen,
      store: inventoryStore,
    },
  };
}

// ─── Monthly Report ──────────────────────────────────────────────────────────
// A multi-day version of fetchDailyReport. Adds per-day rollup so the manager
// can scan the month at a glance, plus the same per-shift breakdown and
// activity log as the daily report. Date arguments are Damascus-local
// YYYY-MM-DD strings (typically the 1st of the month → today).

export interface DailyRollup {
  date: string;            // YYYY-MM-DD (Damascus)
  subscriptionsUSD: number;
  storeSalesUSD: number;
  kitchenSalesUSD: number;
  inbodyUSD: number;
  expensesUSD: number;
  incomeUSD: number;
  netUSD: number;
  shiftsCount: number;
  activityCount: number;
}

export interface EmployeeMonthlyTotals {
  name: string;
  shifts: number;
  totalIncomeUSD: number;
  voidsCount: number;          // any *_cancel action
  exchangeRateChanges: number; // exchange_rate_update action
  stockEdits: number;          // catalog_item_update/create/delete actions
}

export interface MonthlyReport {
  startDate: string;
  endDate: string;
  windowStartUTC: string;
  windowEndUTC: string;
  totals: DailyReport["totals"];
  counts: DailyReport["counts"] & { shifts: number; activity: number };
  dailyRollup: DailyRollup[];
  shifts: ShiftBreakdown[];
  activity: ActivityEntryRow[];
  employees: EmployeeMonthlyTotals[];
}

function damascusRangeUTC(startDate: string, endDate: string): { start: string; end: string } {
  const start = new Date(`${startDate}T00:00:00.000${DAMASCUS_OFFSET}`).toISOString();
  const end   = new Date(`${endDate}T23:59:59.999${DAMASCUS_OFFSET}`).toISOString();
  return { start, end };
}

function damascusCalendarDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Damascus" });
}

export async function fetchMonthlyReport(
  startDate: string,
  endDate: string,
): Promise<MonthlyReport> {
  const supabase = supabaseBrowser();
  const { start: rangeStart, end: rangeEnd } = damascusRangeUTC(startDate, endDate);

  const { data: profiles } = await supabase.from("profiles").select("id, display_name");
  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    const pr = p as Record<string, unknown>;
    nameMap[String(pr.id)] = String(pr.display_name ?? "");
  }

  const [sessionsRes, subsRes, salesRes, inbodyRes, expensesRes, activityRes] = await Promise.all([
    supabase
      .from("cash_sessions")
      .select(
        "id, opened_at, closed_at, status, opening_cash, actual_cash, expected_cash, difference, opened_by"
      )
      .gte("opened_at", rangeStart)
      .lte("opened_at", rangeEnd)
      .order("opened_at", { ascending: true }),
    supabase
      .from("gym_subscriptions")
      .select("created_at, paid_amount, currency, exchange_rate, cash_session_id")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("item_sales")
      .select("created_at, source, amount_usd, cash_session_id")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .is("cancelled_at", null),
    supabase
      .from("inbody_sessions")
      .select("created_at, amount, currency, exchange_rate, cash_session_id, member_name")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("expenses")
      .select("created_at, amount, currency, exchange_rate, cash_session_id")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .is("cancelled_at", null),
    supabase
      .from("activity_feed")
      .select(
        "id, action, description, amount_syp, amount_usd, created_at, created_by, created_by_name, old_value, new_value"
      )
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .order("created_at", { ascending: true }),
  ]);

  function shiftLabel(openedAt: string): string {
    const h = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Damascus", hour: "2-digit", hour12: false }).format(new Date(openedAt))
    );
    if (h >= 5  && h < 12) return "صباحية";
    if (h >= 12 && h < 17) return "ظهيرة";
    if (h >= 17 && h < 22) return "مسائية";
    return "ليلية";
  }

  // ── Per-shift breakdown ─────────────────────────────────────────────────
  const sessionRows = (sessionsRes.data ?? []) as unknown as Record<string, unknown>[];
  const subRows  = (subsRes.data ?? []) as unknown as Record<string, unknown>[];
  const saleRows = (salesRes.data ?? []) as unknown as Record<string, unknown>[];
  const ibRows   = (inbodyRes.data ?? []) as unknown as Record<string, unknown>[];
  const expRows  = (expensesRes.data ?? []) as unknown as Record<string, unknown>[];

  const shifts: ShiftBreakdown[] = sessionRows.map((s) => {
    const sid = String(s.id);
    const openedAt = String(s.opened_at ?? "");
    const subsForSession   = subRows.filter((r) => String(r.cash_session_id ?? "") === sid);
    const ibForSession     = ibRows.filter((r) => String(r.cash_session_id ?? "") === sid);
    const expForSession    = expRows.filter((r) => String(r.cash_session_id ?? "") === sid);
    const storeForSession  = saleRows.filter((r) => String(r.cash_session_id ?? "") === sid && String(r.source ?? "store") === "store");
    const kitchenForSession = saleRows.filter((r) => String(r.cash_session_id ?? "") === sid && String(r.source ?? "store") === "kitchen");

    const subsUSD = subsForSession.reduce((a, r) =>
      a + toUSD(Number(r.paid_amount ?? 0), String(r.currency ?? "usd"), Number(r.exchange_rate ?? 0)), 0);
    const ibUSD = ibForSession.reduce((a, r) =>
      a + toUSD(Number(r.amount ?? 0), String(r.currency ?? "usd"), Number(r.exchange_rate ?? 0)), 0);
    const expUSD = expForSession.reduce((a, r) =>
      a + toUSD(Number(r.amount ?? 0), String(r.currency ?? "usd"), Number(r.exchange_rate ?? 0)), 0);
    const storeUSD   = storeForSession.reduce((a, r) => a + Number(r.amount_usd ?? 0), 0);
    const kitchenUSD = kitchenForSession.reduce((a, r) => a + Number(r.amount_usd ?? 0), 0);
    const incomeUSD = subsUSD + storeUSD + kitchenUSD + ibUSD;

    return {
      sessionId: sid,
      employeeName: nameMap[String(s.opened_by ?? "")] ?? "—",
      openedAt,
      closedAt: s.closed_at ? String(s.closed_at) : null,
      status: String(s.status ?? ""),
      shiftLabel: openedAt ? shiftLabel(openedAt) : "—",
      openingCashUSD:   Number(Number(s.opening_cash ?? 0).toFixed(2)),
      actualCashUSD:    s.actual_cash   == null ? null : Number(Number(s.actual_cash).toFixed(2)),
      expectedCashUSD:  s.expected_cash == null ? null : Number(Number(s.expected_cash).toFixed(2)),
      differenceUSD:    s.difference    == null ? null : Number(Number(s.difference).toFixed(2)),
      subscriptionsUSD: Number(subsUSD.toFixed(2)),
      storeSalesUSD:    Number(storeUSD.toFixed(2)),
      kitchenSalesUSD:  Number(kitchenUSD.toFixed(2)),
      inbodyUSD:        Number(ibUSD.toFixed(2)),
      expensesUSD:      Number(expUSD.toFixed(2)),
      incomeUSD:        Number(incomeUSD.toFixed(2)),
      netUSD:           Number((incomeUSD - expUSD).toFixed(2)),
      counts: {
        subscriptions: subsForSession.length,
        storeSales:    storeForSession.length,
        kitchenSales:  kitchenForSession.length,
        inbody:        ibForSession.length,
        expenses:      expForSession.length,
      },
    };
  });

  // ── Per-day rollup ──────────────────────────────────────────────────────
  const rollup = new Map<string, DailyRollup>();
  const ensureDay = (date: string): DailyRollup => {
    let r = rollup.get(date);
    if (!r) {
      r = {
        date,
        subscriptionsUSD: 0, storeSalesUSD: 0, kitchenSalesUSD: 0,
        inbodyUSD: 0, expensesUSD: 0, incomeUSD: 0, netUSD: 0,
        shiftsCount: 0, activityCount: 0,
      };
      rollup.set(date, r);
    }
    return r;
  };
  for (const r of subRows) {
    const d = damascusCalendarDate(String(r.created_at ?? ""));
    ensureDay(d).subscriptionsUSD += toUSD(Number(r.paid_amount ?? 0), String(r.currency ?? "usd"), Number(r.exchange_rate ?? 0));
  }
  for (const r of saleRows) {
    const d = damascusCalendarDate(String(r.created_at ?? ""));
    const v = Number(r.amount_usd ?? 0);
    if (String(r.source ?? "store") === "kitchen") ensureDay(d).kitchenSalesUSD += v;
    else                                            ensureDay(d).storeSalesUSD   += v;
  }
  for (const r of ibRows) {
    const d = damascusCalendarDate(String(r.created_at ?? ""));
    ensureDay(d).inbodyUSD += toUSD(Number(r.amount ?? 0), String(r.currency ?? "usd"), Number(r.exchange_rate ?? 0));
  }
  for (const r of expRows) {
    const d = damascusCalendarDate(String(r.created_at ?? ""));
    ensureDay(d).expensesUSD += toUSD(Number(r.amount ?? 0), String(r.currency ?? "usd"), Number(r.exchange_rate ?? 0));
  }
  for (const s of sessionRows) {
    const d = damascusCalendarDate(String(s.opened_at ?? ""));
    ensureDay(d).shiftsCount += 1;
  }
  for (const a of activityRes.data ?? []) {
    const d = damascusCalendarDate(String((a as Record<string, unknown>).created_at ?? ""));
    ensureDay(d).activityCount += 1;
  }
  const dailyRollup: DailyRollup[] = [...rollup.values()]
    .map((r) => ({
      ...r,
      subscriptionsUSD: Number(r.subscriptionsUSD.toFixed(2)),
      storeSalesUSD:    Number(r.storeSalesUSD.toFixed(2)),
      kitchenSalesUSD:  Number(r.kitchenSalesUSD.toFixed(2)),
      inbodyUSD:        Number(r.inbodyUSD.toFixed(2)),
      expensesUSD:      Number(r.expensesUSD.toFixed(2)),
      incomeUSD:        Number((r.subscriptionsUSD + r.storeSalesUSD + r.kitchenSalesUSD + r.inbodyUSD).toFixed(2)),
      netUSD:           Number((r.subscriptionsUSD + r.storeSalesUSD + r.kitchenSalesUSD + r.inbodyUSD - r.expensesUSD).toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Activity log + per-employee aggregates ──────────────────────────────
  const activity: ActivityEntryRow[] = (activityRes.data ?? []).map((a) => {
    const r = a as Record<string, unknown>;
    return {
      time: String(r.created_at ?? ""),
      action: String(r.action ?? ""),
      description: String(r.description ?? ""),
      amountUSD: r.amount_usd == null ? null : Number(r.amount_usd),
      amountSYP: r.amount_syp == null ? null : Number(r.amount_syp),
      by: String(r.created_by_name ?? nameMap[String(r.created_by ?? "")] ?? ""),
      oldValue: (r.old_value as Record<string, unknown> | null) ?? null,
      newValue: (r.new_value as Record<string, unknown> | null) ?? null,
    };
  });

  const empMap = new Map<string, EmployeeMonthlyTotals>();
  const ensureEmp = (name: string): EmployeeMonthlyTotals => {
    let e = empMap.get(name);
    if (!e) {
      e = { name, shifts: 0, totalIncomeUSD: 0, voidsCount: 0, exchangeRateChanges: 0, stockEdits: 0 };
      empMap.set(name, e);
    }
    return e;
  };
  for (const s of shifts) {
    const e = ensureEmp(s.employeeName || "—");
    e.shifts += 1;
    e.totalIncomeUSD += s.incomeUSD;
  }
  for (const a of activity) {
    const e = ensureEmp(a.by || "—");
    if (a.action.endsWith("_cancel")) e.voidsCount += 1;
    if (a.action === "exchange_rate_update") e.exchangeRateChanges += 1;
    if (a.action === "catalog_item_update" || a.action === "catalog_item_create" || a.action === "catalog_item_delete") e.stockEdits += 1;
  }
  const employees: EmployeeMonthlyTotals[] = [...empMap.values()]
    .map((e) => ({ ...e, totalIncomeUSD: Number(e.totalIncomeUSD.toFixed(2)) }))
    .sort((a, b) => b.totalIncomeUSD - a.totalIncomeUSD);

  // ── Totals ──────────────────────────────────────────────────────────────
  const subscriptionsUSD = dailyRollup.reduce((a, r) => a + r.subscriptionsUSD, 0);
  const storeSalesUSD    = dailyRollup.reduce((a, r) => a + r.storeSalesUSD,    0);
  const kitchenSalesUSD  = dailyRollup.reduce((a, r) => a + r.kitchenSalesUSD,  0);
  const inbodyUSD        = dailyRollup.reduce((a, r) => a + r.inbodyUSD,        0);
  const expensesUSD      = dailyRollup.reduce((a, r) => a + r.expensesUSD,      0);
  const incomeUSD        = subscriptionsUSD + storeSalesUSD + kitchenSalesUSD + inbodyUSD;

  return {
    startDate, endDate,
    windowStartUTC: rangeStart, windowEndUTC: rangeEnd,
    totals: {
      subscriptionsUSD: Number(subscriptionsUSD.toFixed(2)),
      storeSalesUSD:    Number(storeSalesUSD.toFixed(2)),
      kitchenSalesUSD:  Number(kitchenSalesUSD.toFixed(2)),
      inbodyUSD:        Number(inbodyUSD.toFixed(2)),
      expensesUSD:      Number(expensesUSD.toFixed(2)),
      incomeUSD:        Number(incomeUSD.toFixed(2)),
      netUSD:           Number((incomeUSD - expensesUSD).toFixed(2)),
    },
    counts: {
      subscriptions: subRows.length,
      storeSales:    saleRows.filter((r) => String(r.source ?? "store") === "store").length,
      kitchenSales:  saleRows.filter((r) => String(r.source ?? "store") === "kitchen").length,
      inbody:        ibRows.length,
      expenses:      expRows.length,
      shifts:        shifts.length,
      activity:      activity.length,
    },
    dailyRollup,
    shifts,
    activity,
    employees,
  };
}

const REALTIME_TABLES = [
  "gym_subscriptions",
  "item_sales",
  "inbody_sessions",
  "cash_sessions",
  "catalog_items",
] as const;

export function useLiveKPI() {
  const supabase = supabaseBrowser();
  const [kpi, setKpi] = useState<LiveKPI>(ZERO);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchLiveKPI();
      setKpi(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel("live-kpi");
    for (const table of REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void refresh(),
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh]);

  return { kpi, loading, refresh };
}

// ────────────────────────────────────────────────────────────────────────────
// Manager dashboard helpers
//
// All amounts are reported as the snapshotted SYP value (`amount_syp` on each
// transaction row, frozen at write-time per migration 0002). For old rows
// missing `amount_syp`, a fallback is used:
//   • `currency='syp'` → use the row's native amount column directly
//   • `currency='usd'` and `exchange_rate > 0` → multiply by exchange_rate
//   • otherwise → exclude from SYP total and increment `skipped.<table>` so
//     the UI can surface a warning. Never silently divide by 1.
//
// USD figures are computed only when a row has either `currency='usd'`
// (use the raw column) or a positive `exchange_rate` snapshot. Rows with a
// missing/zero exchange_rate on SYP-stored data are excluded from USD totals.
//
// Test rows (`member_name ILIKE '%test%'`) are excluded on every table that
// has a member_name column, matching the prior fetchLiveKPI behaviour.
// ────────────────────────────────────────────────────────────────────────────

export type DateRangePreset = "today" | "week" | "month" | "custom";

export interface ManagerDateRange {
  preset: DateRangePreset;
  /** Start of window, ISO timestamptz at Damascus 00:00:00.000 +03:00. */
  startUTC: string;
  /** End of window, ISO timestamptz at Damascus 23:59:59.999 +03:00. */
  endUTC: string;
  /** Local start date YYYY-MM-DD (Damascus). */
  startDate: string;
  /** Local end date YYYY-MM-DD (Damascus). */
  endDate: string;
  /** Arabic display label. */
  label: string;
}

function todayDamascusDate(): string {
  // en-CA → YYYY-MM-DD, applied through the Damascus tz.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Damascus" });
}

function startOfWeekDamascusDate(): string {
  // Levant convention: Saturday is the start of the working week.
  const today = todayDamascusDate();
  const damascusWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Damascus",
    weekday: "short",
  }).format(new Date(`${today}T12:00:00${DAMASCUS_OFFSET}`));
  const offset: Record<string, number> = {
    Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6,
  };
  const back = offset[damascusWeekday] ?? 0;
  const anchor = new Date(`${today}T12:00:00${DAMASCUS_OFFSET}`);
  anchor.setUTCDate(anchor.getUTCDate() - back);
  return anchor.toISOString().slice(0, 10);
}

function startOfMonthDamascusDate(): string {
  return `${todayDamascusDate().slice(0, 7)}-01`;
}

export function makeDateRange(
  preset: DateRangePreset,
  custom?: { startDate: string; endDate: string },
): ManagerDateRange {
  const today = todayDamascusDate();
  let startDate = today;
  let endDate = today;
  let label = "اليوم";
  if (preset === "week") {
    startDate = startOfWeekDamascusDate();
    endDate = today;
    label = "هذا الأسبوع";
  } else if (preset === "month") {
    startDate = startOfMonthDamascusDate();
    endDate = today;
    label = "هذا الشهر";
  } else if (preset === "custom" && custom) {
    startDate = custom.startDate;
    endDate = custom.endDate;
    label = `${startDate} → ${endDate}`;
  }
  const startUTC = new Date(`${startDate}T00:00:00.000${DAMASCUS_OFFSET}`).toISOString();
  const endUTC   = new Date(`${endDate}T23:59:59.999${DAMASCUS_OFFSET}`).toISOString();
  return { preset, startUTC, endUTC, startDate, endDate, label };
}

// ── Row-level conversion helpers ─────────────────────────────────────────────

interface AmountRow {
  amount_syp?: number | string | null;
  exchange_rate?: number | string | null;
  currency?: string | null;
}

/**
 * Resolve a row's SYP value preferring the snapshot column. Returns null when
 * no reliable conversion is possible — caller increments a "skipped" counter.
 */
function rowSYP(row: AmountRow, nativeAmount: number): number | null {
  const snapshot = Number(row.amount_syp ?? NaN);
  if (Number.isFinite(snapshot) && snapshot > 0) return snapshot;
  const cur = String(row.currency ?? "usd");
  if (cur === "syp") return nativeAmount;
  const rate = Number(row.exchange_rate ?? 0);
  if (cur === "usd" && rate > 0) return nativeAmount * rate;
  return null;
}

/**
 * Resolve a row's USD value. Returns null when the row was stored in SYP
 * without a usable exchange_rate snapshot (we never silently divide by 1).
 */
function rowUSD(row: AmountRow, nativeAmount: number): number | null {
  const cur = String(row.currency ?? "usd");
  if (cur === "usd") return nativeAmount;
  const rate = Number(row.exchange_rate ?? 0);
  if (cur === "syp" && rate > 0) return nativeAmount / rate;
  return null;
}

// Identity for distinct-member counting. Falls back to a normalised name when
// member_id is absent. Exposed as a single helper so every count uses it.
function memberIdentity(row: { member_id?: string | null; member_name?: string | null; id?: string }): string {
  if (row.member_id) return `id:${row.member_id}`;
  const name = (row.member_name ?? "").trim().toLowerCase();
  if (name) return `name:${name}`;
  return `row:${row.id ?? ""}`;
}

// ── Manager summary ──────────────────────────────────────────────────────────

export interface CurrencyBucket {
  syp: number;
  usd: number;
  /** Rows skipped from USD total because exchange_rate was 0/null. */
  skippedUSD: number;
}

const ZERO_BUCKET: CurrencyBucket = { syp: 0, usd: 0, skippedUSD: 0 };

export interface ManagerSummary {
  range: ManagerDateRange;
  subscriptions: CurrencyBucket;
  inbody: CurrencyBucket;
  store: CurrencyBucket;
  kitchen: CurrencyBucket;
  privateSessions: CurrencyBucket;
  expenses: CurrencyBucket;
  totalRevenue: CurrencyBucket;
  netIncome: CurrencyBucket;
  activeMembers: {
    /** Distinct member_id (with normalised-name fallback) of currently active subs. */
    distinct: number;
    /** Subscription rows whose member_id was null — counted via name fallback. */
    unattached: number;
  };
  /** Same raw subscription row count shown in the reception subscriptions header. */
  totalMembers: number;
  partiallyPaid: {
    count: number;
    remainingSYP: number;
    remainingUSD: number;
    skippedUSD: number;
  };
  cashOnHand: {
    /** Open-session opening + session income − session expenses. SYP. */
    syp: number;
    usd: number;
    /** Whether there is an open cash session. */
    hasOpenSession: boolean;
  };
}

const SUB_SELECT =
  "id, member_id, member_name, plan_type, offer, paid_amount, amount, payment_status, currency, exchange_rate, amount_syp, status, end_date, created_at, cancelled_at";
// item_sales replaces sales. amount_syp + amount_usd are GENERATED on the
// row, so the bucket builder can just read them. We keep `original_*`
// columns around for the optional native-currency display.
const ITEM_SALE_SELECT =
  "id, source, original_total, original_currency, exchange_rate_to_syp, " +
  "amount_syp, amount_usd, cancelled_at, created_at";
const INBODY_SELECT =
  "id, member_id, member_name, session_type, amount, currency, exchange_rate, amount_syp, cancelled_at, created_at";
const PRIVATE_SELECT =
  "id, paid_amount, total_price, base_trainer_fee, group_price, payment_status, currency, exchange_rate, amount_syp, cancelled_at, created_at";
const EXPENSE_SELECT =
  "id, category, amount, currency, exchange_rate, amount_syp, cancelled_at, created_at";

type Row = Record<string, unknown>;

/** Sum a query's rows into a CurrencyBucket using the named amount column. */
function bucketise(rows: Row[], amountCol: string): CurrencyBucket {
  const out: CurrencyBucket = { syp: 0, usd: 0, skippedUSD: 0 };
  for (const r of rows) {
    const native = Number(r[amountCol] ?? 0);
    if (!Number.isFinite(native) || native === 0) continue;
    const syp = rowSYP(r as AmountRow, native);
    if (syp != null) out.syp += syp;
    const usd = rowUSD(r as AmountRow, native);
    if (usd != null) out.usd += usd;
    else out.skippedUSD += 1;
  }
  return out;
}

/** item_sales bucket builder — reads the GENERATED amount_syp / amount_usd
 *  columns directly. Skips rows where amount_usd is NULL (legacy USD rows
 *  without a stored exchange_rate_to_syp). */
function bucketiseItemSales(rows: Row[]): CurrencyBucket {
  const out: CurrencyBucket = { syp: 0, usd: 0, skippedUSD: 0 };
  for (const r of rows) {
    const sypVal = r.amount_syp == null ? null : Number(r.amount_syp);
    const usdVal = r.amount_usd == null ? null : Number(r.amount_usd);
    if (sypVal != null && Number.isFinite(sypVal)) out.syp += sypVal;
    if (usdVal != null && Number.isFinite(usdVal)) out.usd += usdVal;
    else out.skippedUSD += 1;
  }
  return out;
}

function bucketSubtract(a: CurrencyBucket, b: CurrencyBucket): CurrencyBucket {
  return {
    syp: a.syp - b.syp,
    usd: a.usd - b.usd,
    skippedUSD: a.skippedUSD + b.skippedUSD,
  };
}

function bucketPrivateSessionShare(rows: Row[], shareCol: "group_price" | "base_trainer_fee"): CurrencyBucket {
  const out: CurrencyBucket = { syp: 0, usd: 0, skippedUSD: 0 };
  for (const r of rows) {
    const paid = Number(r.paid_amount ?? 0);
    const total = Number(r.total_price ?? 0);
    const share = Number(r[shareCol] ?? 0);
    if (!Number.isFinite(paid) || !Number.isFinite(total) || !Number.isFinite(share) || paid <= 0 || total <= 0 || share <= 0) continue;
    const native = Math.min(paid, total) * (share / total);
    const syp = rowSYP(r as AmountRow, native);
    if (syp != null) out.syp += syp;
    const usd = rowUSD(r as AmountRow, native);
    if (usd != null) out.usd += usd;
    else out.skippedUSD += 1;
  }
  return out;
}

function bucketSum(...xs: CurrencyBucket[]): CurrencyBucket {
  return xs.reduce(
    (acc, x) => ({
      syp: acc.syp + x.syp,
      usd: acc.usd + x.usd,
      skippedUSD: acc.skippedUSD + x.skippedUSD,
    }),
    { ...ZERO_BUCKET },
  );
}

export async function fetchManagerDashboardSummary(
  range: ManagerDateRange,
): Promise<ManagerSummary> {
  const supabase = supabaseBrowser();
  const today = todayDamascusDate();

  const [
    subsRes,
    salesRes,
    inbodyRes,
    privateRes,
    expensesRes,
    activeSubsRes,
    totalMembersRes,
    partialSubsRes,
    openSessionRes,
  ] = await Promise.all([
    supabase
      .from("gym_subscriptions")
      .select(SUB_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("item_sales")
      .select(ITEM_SALE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
    supabase
      .from("inbody_sessions")
      .select(INBODY_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("private_sessions")
      .select(PRIVATE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
    supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name, end_date, status, cancelled_at")
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id", { count: "exact", head: true })
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, amount, paid_amount, currency, exchange_rate, amount_syp, cancelled_at")
      .eq("payment_status", "partial")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("cash_sessions")
      .select("id, opening_cash")
      .eq("status", "open")
      .limit(1),
  ]);

  const subRows     = (subsRes.data     ?? []) as unknown as Row[];
  const saleRows    = (salesRes.data    ?? []) as unknown as Row[];
  const inbodyRows  = (inbodyRes.data   ?? []) as unknown as Row[];
  const privateRows = (privateRes.data  ?? []) as unknown as Row[];
  const expRows     = (expensesRes.data ?? []) as unknown as Row[];

  const subscriptions = bucketise(subRows, "paid_amount");
  const inbody        = bucketise(inbodyRows, "amount");
  const storeRows     = saleRows.filter((r) => String(r.source ?? "store") === "store");
  const kitchenRows   = saleRows.filter((r) => String(r.source ?? "store") === "kitchen");
  const store         = bucketiseItemSales(storeRows);
  const kitchen       = bucketiseItemSales(kitchenRows);
  const privateSessions = bucketise(privateRows, "paid_amount");
  const expenses      = bucketise(expRows, "amount");

  const totalRevenue = bucketSum(subscriptions, inbody, store, kitchen, privateSessions);
  const netIncome    = bucketSubtract(totalRevenue, expenses);

  // ── active members (point-in-time, NOT range-filtered) ────────────────────
  const activeRows = (activeSubsRes.data ?? []) as Row[];
  const idents = new Set<string>();
  let unattached = 0;
  for (const r of activeRows) {
    if (!r.member_id) unattached += 1;
    idents.add(memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string }));
  }

  // ── partial-payment outstanding balance ───────────────────────────────────
  const partialRows = (partialSubsRes.data ?? []) as Row[];
  let partialRemainingSYP = 0;
  let partialRemainingUSD = 0;
  let partialSkippedUSD = 0;
  for (const r of partialRows) {
    const remaining = Number(r.amount ?? 0) - Number(r.paid_amount ?? 0);
    if (remaining <= 0) continue;
    const proxyRow: AmountRow = { ...r };
    // amount_syp on the row reflects paid_amount, not remaining — recompute.
    const cur = String(proxyRow.currency ?? "usd");
    const rate = Number(proxyRow.exchange_rate ?? 0);
    if (cur === "syp") {
      partialRemainingSYP += remaining;
      if (rate > 0) partialRemainingUSD += remaining / rate;
      else partialSkippedUSD += 1;
    } else if (cur === "usd") {
      partialRemainingUSD += remaining;
      if (rate > 0) partialRemainingSYP += remaining * rate;
      else partialSkippedUSD += 1;
    }
  }

  // ── cash on hand: opening + session income − session expenses (USD/SYP) ───
  const openSession = (openSessionRes.data ?? [])[0] as Row | undefined;
  let cashSypOpen = 0;
  let cashUsdOpen = 0;
  let cashSyp = 0;
  let cashUsd = 0;
  let hasOpenSession = false;
  if (openSession?.id) {
    hasOpenSession = true;
    const sid = String(openSession.id);
    const openingUSD = Number(openSession.opening_cash ?? 0);
    cashUsdOpen = openingUSD;
    // We don't track opening_cash_syp on the cash_session post-0016. Convert
    // the opening using the most-recent app exchange rate as a presentation
    // helper (NOT used for accounting). If unavailable, leave SYP at 0.
    const { data: rateRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "exchange_rate_usd_syp")
      .maybeSingle();
    const liveRate = Number((rateRow?.value as unknown) ?? 0);
    cashSypOpen = liveRate > 0 ? openingUSD * liveRate : 0;

    const [sessionSubs, sessionSales, sessionInbody, sessionPrivate, sessionExp] = await Promise.all([
      supabase.from("gym_subscriptions").select("paid_amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("item_sales").select("amount_syp, amount_usd, source").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("inbody_sessions").select("amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("private_sessions").select("paid_amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
      supabase.from("expenses").select("amount, currency, exchange_rate, amount_syp").eq("cash_session_id", sid).is("cancelled_at", null),
    ]);
    const incomeBucket = bucketSum(
      bucketise((sessionSubs.data ?? []) as Row[], "paid_amount"),
      bucketiseItemSales((sessionSales.data ?? []) as Row[]),
      bucketise((sessionInbody.data ?? []) as Row[], "amount"),
      bucketise((sessionPrivate.data ?? []) as Row[], "paid_amount"),
    );
    const expenseBucket = bucketise((sessionExp.data ?? []) as Row[], "amount");
    cashSyp = cashSypOpen + incomeBucket.syp - expenseBucket.syp;
    cashUsd = cashUsdOpen + incomeBucket.usd - expenseBucket.usd;
  }

  return {
    range,
    subscriptions,
    inbody,
    store,
    kitchen,
    privateSessions,
    expenses,
    totalRevenue,
    netIncome,
    activeMembers: { distinct: idents.size, unattached },
    totalMembers: totalMembersRes.count ?? 0,
    partiallyPaid: {
      count: partialRows.length,
      remainingSYP: partialRemainingSYP,
      remainingUSD: partialRemainingUSD,
      skippedUSD: partialSkippedUSD,
    },
    cashOnHand: { syp: cashSyp, usd: cashUsd, hasOpenSession },
  };
}

// ── Subscription breakdown ───────────────────────────────────────────────────

const KNOWN_PLANS = [
  "daily", "15_days", "1_month",
  "3_months", "6_months", "9_months", "12_months",
  "custom",
] as const;
export type KnownPlan = typeof KNOWN_PLANS[number] | "other";

export interface PlanRow {
  plan: KnownPlan;
  count: number;
  members: number;
  paidSYP: number;
  paidUSD: number;
  avgPaidSYP: number;
  partialCount: number;
  unpaidCount: number;
}

export interface OfferRow {
  offer: string;
  count: number;
  paidSYP: number;
  paidUSD: number;
}

export interface SubscriptionBreakdown {
  range: ManagerDateRange;
  byPlanType: PlanRow[];
  byOffer: OfferRow[];
  totals: {
    monthlySYP: number;
    multiMonthSYP: number;
    offerSYP: number;
    normalSYP: number;
    partialRemainingSYP: number;
    unpaidRemainingSYP: number;
  };
  skippedUSD: number;
}

function normalisePlan(p: unknown): KnownPlan {
  const s = String(p ?? "").trim();
  return (KNOWN_PLANS as readonly string[]).includes(s) ? (s as KnownPlan) : "other";
}

export async function fetchSubscriptionBreakdown(
  range: ManagerDateRange,
): Promise<SubscriptionBreakdown> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("gym_subscriptions")
    .select(SUB_SELECT)
    .gte("created_at", range.startUTC)
    .lte("created_at", range.endUTC)
    .is("cancelled_at", null)
    .not("member_name", "ilike", "%test%");
  if (error) console.error("fetchSubscriptionBreakdown:", error);
  const rows = (data ?? []) as Row[];

  const planAcc = new Map<KnownPlan, {
    count: number; idents: Set<string>; paidSYP: number; paidUSD: number; partial: number; unpaid: number;
  }>();
  const offerAcc = new Map<string, { count: number; paidSYP: number; paidUSD: number }>();
  let monthlySYP = 0, multiMonthSYP = 0, offerSYP = 0, normalSYP = 0;
  let partialRemainingSYP = 0, unpaidRemainingSYP = 0;
  let skippedUSD = 0;

  for (const r of rows) {
    const plan = normalisePlan(r.plan_type);
    const offer = (r.offer == null || r.offer === "" ? "none" : String(r.offer));
    const paidNative = Number(r.paid_amount ?? 0);
    const amountNative = Number(r.amount ?? 0);
    const paidSYP = rowSYP(r as AmountRow, paidNative);
    const paidUSD = rowUSD(r as AmountRow, paidNative);
    const remainingNative = Math.max(0, amountNative - paidNative);
    const remainingSYP = remainingNative > 0
      ? rowSYP(r as AmountRow, remainingNative) ?? 0
      : 0;
    if (paidUSD == null) skippedUSD += 1;

    // ── plan bucket ────────────────────────────────────────────
    let pb = planAcc.get(plan);
    if (!pb) { pb = { count: 0, idents: new Set(), paidSYP: 0, paidUSD: 0, partial: 0, unpaid: 0 }; planAcc.set(plan, pb); }
    pb.count += 1;
    pb.idents.add(memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string }));
    if (paidSYP != null) pb.paidSYP += paidSYP;
    if (paidUSD != null) pb.paidUSD += paidUSD;
    if (r.payment_status === "partial") pb.partial += 1;
    if (r.payment_status === "unpaid")  pb.unpaid  += 1;

    // ── offer bucket ───────────────────────────────────────────
    let ob = offerAcc.get(offer);
    if (!ob) { ob = { count: 0, paidSYP: 0, paidUSD: 0 }; offerAcc.set(offer, ob); }
    ob.count += 1;
    if (paidSYP != null) ob.paidSYP += paidSYP;
    if (paidUSD != null) ob.paidUSD += paidUSD;

    // ── totals ─────────────────────────────────────────────────
    const safeSYP = paidSYP ?? 0;
    if (plan === "1_month") monthlySYP += safeSYP;
    if (plan === "3_months" || plan === "6_months" || plan === "9_months" || plan === "12_months")
      multiMonthSYP += safeSYP;
    if (offer === "none") normalSYP += safeSYP; else offerSYP += safeSYP;

    if (r.payment_status === "partial") partialRemainingSYP += remainingSYP;
    if (r.payment_status === "unpaid")  unpaidRemainingSYP  += remainingSYP;
  }

  const byPlanType: PlanRow[] = [...KNOWN_PLANS, "other" as KnownPlan]
    .map((p) => {
      const pb = planAcc.get(p);
      if (!pb) return { plan: p, count: 0, members: 0, paidSYP: 0, paidUSD: 0, avgPaidSYP: 0, partialCount: 0, unpaidCount: 0 };
      return {
        plan: p,
        count: pb.count,
        members: pb.idents.size,
        paidSYP: pb.paidSYP,
        paidUSD: pb.paidUSD,
        avgPaidSYP: pb.count > 0 ? pb.paidSYP / pb.count : 0,
        partialCount: pb.partial,
        unpaidCount: pb.unpaid,
      };
    })
    .filter((p) => p.count > 0);

  const byOffer: OfferRow[] = [...offerAcc.entries()]
    .map(([offer, v]) => ({ offer, count: v.count, paidSYP: v.paidSYP, paidUSD: v.paidUSD }))
    .sort((a, b) => b.paidSYP - a.paidSYP);

  return {
    range,
    byPlanType,
    byOffer,
    totals: { monthlySYP, multiMonthSYP, offerSYP, normalSYP, partialRemainingSYP, unpaidRemainingSYP },
    skippedUSD,
  };
}

// ── Member category breakdown (point-in-time, NOT range-filtered) ───────────

export interface MemberCategoryBreakdown {
  totalActive: number;
  unattachedActive: number;
  monthlyNormal: number;
  monthlyOffer: number;
  threeMonthNormal: number;
  threeMonthOffer: number;
  sixMonthNormal: number;
  sixMonthOffer: number;
  nineMonthNormal: number;
  nineMonthOffer: number;
  yearlyNormal: number;
  yearlyOffer: number;
  multiMonthOfferTotal: number;
  frozen: number;
  expired: number;
  expiringThisWeek: number;
}

export async function fetchMemberCategoryBreakdown(): Promise<MemberCategoryBreakdown> {
  const supabase = supabaseBrowser();
  const today = todayDamascusDate();
  const inSeven = (() => {
    const d = new Date(`${today}T12:00:00${DAMASCUS_OFFSET}`);
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  const [activeRes, frozenRes, expiredExplicitRes, expiredByEndDateRes, expiringRes] = await Promise.all([
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name, plan_type, offer, end_date, status, cancelled_at")
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name")
      .eq("status", "frozen")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name")
      .eq("status", "expired")
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name")
      .eq("status", "active")
      .is("cancelled_at", null)
      .lt("end_date", today)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("gym_subscriptions")
      .select("id, member_id, member_name, end_date")
      .eq("status", "active")
      .is("cancelled_at", null)
      .gte("end_date", today)
      .lte("end_date", inSeven)
      .not("member_name", "ilike", "%test%"),
  ]);

  const distinct = (rows: Row[]) =>
    new Set(rows.map((r) => memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string }))).size;

  // Distinct counts per (plan, offer) bucket on the active set.
  const activeRows = (activeRes.data ?? []) as Row[];
  const idents: Record<string, Set<string>> = {};
  const bucket = (key: string) => {
    if (!idents[key]) idents[key] = new Set();
    return idents[key];
  };
  let unattachedActive = 0;
  for (const r of activeRows) {
    const ident = memberIdentity(r as { member_id?: string | null; member_name?: string | null; id?: string });
    if (!r.member_id) unattachedActive += 1;
    const plan = normalisePlan(r.plan_type);
    const hasOffer = r.offer && r.offer !== "none" && r.offer !== "";
    bucket("all").add(ident);
    bucket(`plan:${plan}`).add(ident);
    bucket(`plan:${plan}:${hasOffer ? "offer" : "normal"}`).add(ident);
    if (hasOffer && plan !== "1_month" && plan !== "daily" && plan !== "15_days") {
      bucket("multimonthOffer").add(ident);
    }
  }
  const at = (k: string) => idents[k]?.size ?? 0;

  return {
    totalActive: at("all"),
    unattachedActive,
    monthlyNormal:    at("plan:1_month:normal"),
    monthlyOffer:     at("plan:1_month:offer"),
    threeMonthNormal: at("plan:3_months:normal"),
    threeMonthOffer:  at("plan:3_months:offer"),
    sixMonthNormal:   at("plan:6_months:normal"),
    sixMonthOffer:    at("plan:6_months:offer"),
    nineMonthNormal:  at("plan:9_months:normal"),
    nineMonthOffer:   at("plan:9_months:offer"),
    yearlyNormal:     at("plan:12_months:normal"),
    yearlyOffer:      at("plan:12_months:offer"),
    multiMonthOfferTotal: at("multimonthOffer"),
    frozen:  distinct((frozenRes.data ?? []) as Row[]),
    expired: distinct([
      ...((expiredExplicitRes.data ?? []) as Row[]),
      ...((expiredByEndDateRes.data ?? []) as Row[]),
    ]),
    expiringThisWeek: distinct((expiringRes.data ?? []) as Row[]),
  };
}

// ── Other-income breakdown ───────────────────────────────────────────────────

export interface OtherIncomeBreakdown {
  range: ManagerDateRange;
  inbody: {
    bucket: CurrencyBucket;
    sessionCount: number;
    gymMember: number;
    nonMember: number;
    packageSessions: number;
  };
  kitchen: { bucket: CurrencyBucket; orderCount: number };
  store:   { bucket: CurrencyBucket; saleCount: number };
  privateSessions: {
    bucket: CurrencyBucket;
    sessionCount: number;
    gymShare: CurrencyBucket;
    coachShare: CurrencyBucket;
  };
}

export async function fetchOtherIncomeBreakdown(
  range: ManagerDateRange,
): Promise<OtherIncomeBreakdown> {
  const supabase = supabaseBrowser();
  const [salesRes, inbodyRes, privateRes] = await Promise.all([
    supabase
      .from("item_sales")
      .select(ITEM_SALE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
    supabase
      .from("inbody_sessions")
      .select(INBODY_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null)
      .not("member_name", "ilike", "%test%"),
    supabase
      .from("private_sessions")
      .select(PRIVATE_SELECT)
      .gte("created_at", range.startUTC)
      .lte("created_at", range.endUTC)
      .is("cancelled_at", null),
  ]);

  const saleRows = (salesRes.data ?? []) as unknown as Row[];
  const storeRows   = saleRows.filter((r) => String(r.source ?? "store") === "store");
  const kitchenRows = saleRows.filter((r) => String(r.source ?? "store") === "kitchen");

  const inbodyRows = (inbodyRes.data ?? []) as unknown as Row[];
  const sessionType = (r: Row) => String(r.session_type ?? "");
  const gymMember = inbodyRows.filter((r) => sessionType(r) === "gym_member" || sessionType(r) === "single").length;
  const nonMember = inbodyRows.filter((r) => sessionType(r) === "non_member").length;
  const packageSessions = inbodyRows.filter((r) => sessionType(r).startsWith("package_")).length;

  const privateRows = (privateRes.data ?? []) as Row[];

  return {
    range,
    inbody: {
      bucket: bucketise(inbodyRows, "amount"),
      sessionCount: inbodyRows.length,
      gymMember,
      nonMember,
      packageSessions,
    },
    kitchen: { bucket: bucketiseItemSales(kitchenRows), orderCount: kitchenRows.length },
    store:   { bucket: bucketiseItemSales(storeRows),   saleCount:  storeRows.length },
    privateSessions: {
      bucket: bucketise(privateRows, "paid_amount"),
      sessionCount: privateRows.length,
      gymShare: bucketPrivateSessionShare(privateRows, "group_price"),
      coachShare: bucketPrivateSessionShare(privateRows, "base_trainer_fee"),
    },
  };
}

// ── Expenses breakdown ───────────────────────────────────────────────────────

export interface ExpensesBreakdown {
  range: ManagerDateRange;
  total: CurrencyBucket;
  byCategory: { category: string; bucket: CurrencyBucket; count: number }[];
}

export async function fetchExpensesBreakdown(
  range: ManagerDateRange,
): Promise<ExpensesBreakdown> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("expenses")
    .select(EXPENSE_SELECT)
    .gte("created_at", range.startUTC)
    .lte("created_at", range.endUTC)
    .is("cancelled_at", null);
  if (error) console.error("fetchExpensesBreakdown:", error);
  const rows = (data ?? []) as Row[];

  const byCat = new Map<string, Row[]>();
  for (const r of rows) {
    const cat = String(r.category ?? "miscellaneous");
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }
  const byCategory = [...byCat.entries()]
    .map(([category, rs]) => ({
      category,
      bucket: bucketise(rs, "amount"),
      count: rs.length,
    }))
    .sort((a, b) => b.bucket.syp - a.bucket.syp);

  return { range, total: bucketise(rows, "amount"), byCategory };
}

// ── useManagerOverview: orchestrates all 5 fetches with realtime refresh ────

export interface ManagerOverview {
  summary: ManagerSummary | null;
  subs: SubscriptionBreakdown | null;
  members: MemberCategoryBreakdown | null;
  other: OtherIncomeBreakdown | null;
  expenses: ExpensesBreakdown | null;
}

const MANAGER_REALTIME_TABLES = [
  "gym_subscriptions",
  "sales",
  "inbody_sessions",
  "cash_sessions",
  "private_sessions",
  "expenses",
  "products",
] as const;

export function useManagerOverview(range: ManagerDateRange) {
  const supabase = supabaseBrowser();
  const [data, setData] = useState<ManagerOverview>({
    summary: null, subs: null, members: null, other: null, expenses: null,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [summary, subs, members, other, expenses] = await Promise.all([
        fetchManagerDashboardSummary(range),
        fetchSubscriptionBreakdown(range),
        fetchMemberCategoryBreakdown(),
        fetchOtherIncomeBreakdown(range),
        fetchExpensesBreakdown(range),
      ]);
      setData({ summary, subs, members, other, expenses });
    } catch (e) {
      console.error("useManagerOverview refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel(`manager-overview-${range.preset}-${range.startDate}-${range.endDate}`);
    for (const table of MANAGER_REALTIME_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void refresh(),
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh, range.preset, range.startDate, range.endDate]);

  return { ...data, loading, refresh };
}
