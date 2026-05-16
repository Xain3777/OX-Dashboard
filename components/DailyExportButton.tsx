"use client";

// Daily report download — shared by reception (app/page.tsx) and manager
// (ManagerDashboard.tsx). Builds a self-contained HTML document and opens it
// in a print window so the user can save as PDF. Using the browser's print
// pipeline (rather than a JS PDF library) gives us correct Arabic shaping +
// RTL for free and avoids a heavy dep + Arabic-font bundling.

import { useState } from "react";
import { FileText } from "lucide-react";
import { fetchDailyReport, type ActivityEntryRow, type InventoryRow } from "@/lib/supabase/dashboard";

function damascusTime(ts: string) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("ar-SY", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function damascusDayMonth(ts: string) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("ar-SY", {
    timeZone: "Asia/Damascus",
    day: "2-digit",
    month: "short",
  });
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: "نقدي",
  card: "بطاقة",
  transfer: "حوالة",
};
const STATUS_LABEL: Record<string, string> = {
  paid: "مدفوع",
  partial: "جزئي",
  unpaid: "غير مدفوع",
};

// Mirrors components/AuditLog.tsx ACTION_META so the PDF activity log matches
// the on-screen "سجل المراجعة" — same label, same accent color per action.
type ActionMeta = { label: string; color: string };
const ACTION_META: Record<string, ActionMeta> = {
  sale_create:              { label: "بيع",           color: "#5CC45C" },
  item_sale:                { label: "بيع",           color: "#5CC45C" },
  sales_cancel:             { label: "إلغاء بيع",     color: "#FF3333" },
  item_sales_cancel:        { label: "إلغاء بيع",     color: "#FF3333" },
  subscription_create:      { label: "إنشاء اشتراك",  color: "#F5C100" },
  subscription_update:      { label: "تعديل اشتراك",  color: "#F5C100" },
  gym_subscriptions_cancel: { label: "حذف اشتراك",    color: "#FF3333" },
  inbody_session:           { label: "جلسة InBody",   color: "#F5C100" },
  inbody_create:            { label: "جلسة InBody",   color: "#F5C100" },
  inbody_sessions_cancel:   { label: "إلغاء InBody",  color: "#FF3333" },
  private_session_create:   { label: "تدريب خاص",     color: "#F5C100" },
  expense_create:           { label: "تسجيل مصروف",   color: "#FF7A00" },
  expense_update:           { label: "تعديل مصروف",   color: "#F5C100" },
  expenses_cancel:          { label: "إلغاء مصروف",   color: "#FF3333" },
  product_stock_adjust:     { label: "تعديل المخزون", color: "#F5C100" },
  product_price_update:     { label: "تعديل السعر",   color: "#F5C100" },
  food_item_delete:         { label: "حذف صنف مطبخ",  color: "#FF3333" },
  session_opened:           { label: "فتح وردية",     color: "#FFD740" },
  session_closed:           { label: "إغلاق وردية",   color: "#C49A00" },
  catalog_item_create:      { label: "صنف جديد",      color: "#5CC45C" },
  catalog_item_update:      { label: "تعديل صنف",     color: "#F5C100" },
  catalog_item_delete:      { label: "حذف صنف",       color: "#FF3333" },
  exchange_rate_update:     { label: "تغيير الدولار", color: "#F5C100" },
};
const FALLBACK_META: ActionMeta = { label: "نشاط", color: "#777777" };

const FIELD_LABEL: Record<string, string> = {
  name: "الاسم", category: "الفئة", item_type: "النوع",
  sell_price: "سعر البيع", sell_currency: "عملة البيع",
  cost_price: "سعر التكلفة", cost_currency: "عملة التكلفة",
  stock_quantity: "المخزون", track_stock: "تتبع المخزون",
  low_stock_threshold: "حد التنبيه", is_active: "نشط",
  rate: "سعر الدولار",
  opening_cash: "الافتتاحي", actual_cash: "النقد الفعلي",
  expected_cash: "النقد المتوقع", difference: "الفرق", status: "الحالة",
  cancelled_at: "وقت الإلغاء", cancelled_reason: "سبب الإلغاء",
  paid_amount: "المبلغ المدفوع", amount: "المبلغ", member_name: "اسم العضو",
  plan_type: "الخطة", offer: "العرض", end_date: "تاريخ الانتهاء",
};

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toFixed(2);
}

// Inventory section formats revenue/cost/profit in each item's native sell
// currency — kitchen rows are SYP, store rows are USD.
function fmtNative(n: number, cur: "syp" | "usd"): string {
  if (cur === "syp") return `${Math.round(n).toLocaleString("en-US")} ل.س`;
  return `$${Number(n).toFixed(2)}`;
}

function inventoryRowsHTML(rows: InventoryRow[]): string {
  return rows.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${r.openingStock == null ? "—" : r.openingStock}</td>
      <td class="num">${r.soldQty}</td>
      <td class="num">${r.currentStock == null ? "—" : r.currentStock}</td>
      <td class="num">${escapeHtml(fmtNative(r.revenue, r.currency))}</td>
      <td class="num">${r.costKnown ? escapeHtml(fmtNative(r.cost, r.currency)) : "—"}</td>
      <td class="num ${r.costKnown ? (r.profit >= 0 ? "pos" : "neg") : ""}">${r.costKnown ? escapeHtml(fmtNative(r.profit, r.currency)) : "—"}</td>
    </tr>`).join("");
}

// Per-product rollup for a kitchen/store sales list — total quantity and
// total revenue per product, plus a grand-total footer row. The detailed
// per-sale table is still rendered above this; this is an added summary.
function salesSummaryHTML(
  rows: { productName: string; quantity: number; totalUSD: number }[]
): string {
  const map = new Map<string, { qty: number; total: number }>();
  for (const r of rows) {
    const e = map.get(r.productName) ?? { qty: 0, total: 0 };
    e.qty += r.quantity;
    e.total += r.totalUSD;
    map.set(r.productName, e);
  }
  const entries = Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  const grandQty = entries.reduce((a, [, v]) => a + v.qty, 0);
  const grandTotal = entries.reduce((a, [, v]) => a + v.total, 0);
  const body = entries.map(([name, v]) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td class="num">${v.qty}</td>
      <td class="num">${fmtMoney(v.total)}</td>
    </tr>`).join("");
  return `
  <table class="tbl">
    <thead><tr><th>المنتج</th><th>الكمية الكلية</th><th>الإجمالي ($)</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td>الإجمالي العام</td>
      <td class="num">${grandQty}</td>
      <td class="num">${fmtMoney(grandTotal)}</td>
    </tr></tfoot>
  </table>`;
}

function renderVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function renderDiff(oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null): string {
  const keys = new Set<string>();
  Object.keys(oldV ?? {}).forEach((k) => keys.add(k));
  Object.keys(newV ?? {}).forEach((k) => keys.add(k));
  const rows = Array.from(keys)
    .filter((k) => !["id", "created_at", "created_by"].includes(k))
    .filter((k) => (oldV?.[k] ?? null) !== (newV?.[k] ?? null));
  if (rows.length === 0) return "";
  const trs = rows.map((k) => `
    <tr>
      <td class="diff-k">${escapeHtml(FIELD_LABEL[k] ?? k)}</td>
      <td class="diff-old">${escapeHtml(renderVal(oldV?.[k]))}</td>
      <td class="diff-arrow">→</td>
      <td class="diff-new">${escapeHtml(renderVal(newV?.[k]))}</td>
    </tr>`).join("");
  return `<table class="diff">${trs}</table>`;
}

function activityCardHTML(a: ActivityEntryRow): string {
  const meta = ACTION_META[a.action] ?? FALLBACK_META;
  const amountUsd = a.amountUSD != null && Number(a.amountUSD) !== 0
    ? `<span class="amt">$${Number(a.amountUSD).toFixed(2)}</span>` : "";
  const amountSyp = a.amountSYP != null && Number(a.amountSYP) !== 0
    ? `<span class="amt-syp">${Math.round(Number(a.amountSYP)).toLocaleString("en-US")} ل.س</span>` : "";
  return `
    <div class="act-row" style="border-right:2px solid ${meta.color}">
      <div class="act-time">
        <div class="act-t">${escapeHtml(damascusTime(a.time))}</div>
        <div class="act-d">${escapeHtml(damascusDayMonth(a.time))}</div>
      </div>
      <div class="act-body">
        <div class="act-desc">${escapeHtml(a.description)}</div>
        <div class="act-meta">
          <span class="act-by">${escapeHtml(a.by || "—")}</span>
          ${amountUsd ? `<span class="dot">·</span>${amountUsd}` : ""}
          ${amountSyp ? `<span class="dot">·</span>${amountSyp}` : ""}
        </div>
        ${renderDiff(a.oldValue, a.newValue)}
      </div>
      <div class="act-badge" style="color:${meta.color}">${escapeHtml(meta.label)}</div>
    </div>`;
}

export default function DailyExportButton() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const report = await fetchDailyReport(date);

      const subsRows = report.subscriptions.map(r => `
        <tr>
          <td>${escapeHtml(damascusTime(r.time))}</td>
          <td>${escapeHtml(r.memberName)}</td>
          <td>${escapeHtml(r.phone)}</td>
          <td>${escapeHtml(r.planType)}</td>
          <td>${escapeHtml(r.offer === "none" ? "" : r.offer)}</td>
          <td>${escapeHtml(r.startDate)}</td>
          <td>${escapeHtml(r.endDate)}</td>
          <td class="num">${fmtMoney(r.amount)}</td>
          <td class="num">${fmtMoney(r.paidAmount)}</td>
          <td class="num">${fmtMoney(r.remaining)}</td>
          <td>${escapeHtml(STATUS_LABEL[r.paymentStatus] ?? r.paymentStatus)}</td>
          <td>${escapeHtml(PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod)}</td>
          <td>${escapeHtml(r.by)}</td>
        </tr>`).join("");

      const saleRows = (rows: typeof report.storeSales) => rows.map(r => `
        <tr>
          <td>${escapeHtml(damascusTime(r.time))}</td>
          <td>${escapeHtml(r.productName)}</td>
          <td class="num">${r.quantity}</td>
          <td class="num">${fmtMoney(r.unitPriceUSD)}</td>
          <td class="num">${fmtMoney(r.totalUSD)}</td>
          <td>${escapeHtml(PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod)}</td>
          <td>${escapeHtml(r.by)}</td>
        </tr>`).join("");

      const inbodyRows = report.inbody.map(r => `
        <tr>
          <td>${escapeHtml(damascusTime(r.time))}</td>
          <td>${escapeHtml(r.memberName)}</td>
          <td>${escapeHtml(r.sessionType)}</td>
          <td class="num">${fmtMoney(r.amountUSD)}</td>
          <td>${escapeHtml(r.by)}</td>
        </tr>`).join("");

      const expRows = report.expenses.map(r => `
        <tr${r.cancelled ? ` class="cancelled-row"` : ""}>
          <td>${escapeHtml(damascusTime(r.time))}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.category)}</td>
          <td class="num">${fmtMoney(r.amountUSD)}</td>
          <td class="num">${escapeHtml(String(r.originalAmount))}</td>
          <td>${escapeHtml(r.currency.toUpperCase())}</td>
          <td>${escapeHtml(r.by)}</td>
          <td>${r.cancelled ? `<span class="cx">ملغي</span>` : "—"}</td>
        </tr>`).join("");

      const shiftRows = report.shifts.map(s => `
        <tr>
          <td>${escapeHtml(s.shiftLabel)}</td>
          <td>${escapeHtml(s.employeeName)}</td>
          <td>${escapeHtml(damascusTime(s.openedAt))}</td>
          <td>${escapeHtml(s.closedAt ? damascusTime(s.closedAt) : "—")}</td>
          <td>${escapeHtml(s.status === "open" ? "مفتوحة" : "مغلقة")}</td>
          <td class="num">${fmtMoney(s.openingCashUSD)}</td>
          <td class="num">${fmtMoney(s.expectedCashUSD)}</td>
          <td class="num">${fmtMoney(s.actualCashUSD)}</td>
          <td class="num">${fmtMoney(s.differenceUSD)}</td>
          <td class="num">${fmtMoney(s.incomeUSD)}</td>
          <td class="num">${fmtMoney(s.expensesUSD)}</td>
          <td class="num">${fmtMoney(s.netUSD)}</td>
        </tr>`).join("");

      const activityCards = report.activity.map(activityCardHTML).join("");

      const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>تقرير يومي — OX GYM — ${escapeHtml(date)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #0A0A0A; color: #F0EDE6;
    font-family: "Segoe UI", "Tahoma", "Arial", sans-serif; }
  body { padding: 18px 22px; }
  h1 { font-size: 22px; letter-spacing: 2px; margin: 0 0 4px; color: #F0EDE6; }
  h2 { font-size: 15px; letter-spacing: 1.5px; margin: 22px 0 8px; color: #F5C100;
    text-transform: uppercase; border-bottom: 1px solid #252525; padding-bottom: 6px; }
  .sub { color: #777; font-size: 11px; margin-bottom: 8px; font-family: monospace; }
  table.tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.tbl th, table.tbl td { padding: 6px 8px; border-bottom: 1px solid #252525;
    text-align: right; vertical-align: top; }
  table.tbl th { background: #1A1A1A; color: #AAAAAA; font-weight: 600;
    font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  table.tbl td { color: #D8D5CC; }
  table.tbl td.num { font-family: monospace; }
  table.tbl td.num.pos { color: #5CC45C; }
  table.tbl td.num.neg { color: #FF7A00; }
  table.tbl tfoot td { background: #1A1A1A; color: #F5C100; font-weight: 700;
    border-top: 2px solid #F5C100; }
  .sub-h { font-size: 12px; color: #AAAAAA; letter-spacing: 1px;
    margin: 14px 0 6px; }
  .cancelled-row td { color: #666; text-decoration: line-through; }
  .cx { color: #FF3333; text-decoration: none; font-weight: 600; }
  .note { color: #777; font-size: 10px; margin: -4px 0 8px; font-family: monospace; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    margin-bottom: 8px; }
  .kpi { background: #1A1A1A; border: 1px solid #252525; padding: 10px 12px; }
  .kpi-label { font-size: 10px; color: #777; text-transform: uppercase;
    letter-spacing: 1px; }
  .kpi-value { font-size: 18px; color: #F0EDE6; font-family: monospace;
    margin-top: 4px; }
  .kpi-value.pos { color: #5CC45C; }
  .kpi-value.neg { color: #FF7A00; }
  .empty { color: #555; font-size: 11px; padding: 12px 0; font-family: monospace; }

  /* Activity log — replicates components/AuditLog.tsx card layout. */
  .act-list { background: #1A1A1A; border: 1px solid #252525; }
  .act-row { display: flex; align-items: flex-start; gap: 12px;
    padding: 9px 14px; border-bottom: 1px solid #252525; }
  .act-row:last-child { border-bottom: 0; }
  .act-time { flex: 0 0 60px; text-align: left; font-family: monospace; }
  .act-t { font-size: 11px; color: #F0EDE6; line-height: 1.2; }
  .act-d { font-size: 10px; color: #555; line-height: 1.2; }
  .act-body { flex: 1; min-width: 0; }
  .act-desc { font-size: 12px; color: #AAAAAA; line-height: 1.35; }
  .act-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    margin-top: 2px; font-family: monospace; font-size: 10px; }
  .act-by { color: #777; }
  .dot { color: #252525; }
  .amt { color: #5CC45C; font-family: monospace; }
  .amt-syp { color: #5CC45C; font-family: monospace; }
  .act-badge { flex: 0 0 auto; font-family: monospace; font-size: 10px;
    text-transform: uppercase; letter-spacing: 1px; padding-top: 2px;
    white-space: nowrap; }
  .diff { width: 100%; margin-top: 6px; border-collapse: collapse;
    background: #0A0A0A; border: 1px solid #252525; font-family: monospace;
    font-size: 9px; }
  .diff td { padding: 2px 6px; }
  .diff .diff-k { color: #666; white-space: nowrap; }
  .diff .diff-old { color: #FF7A00; }
  .diff .diff-arrow { color: #555; }
  .diff .diff-new { color: #5CC45C; }

  @page { size: A4; margin: 12mm; }
  @media print {
    html, body { background: #0A0A0A !important; -webkit-print-color-adjust: exact;
      print-color-adjust: exact; }
    h2 { page-break-after: avoid; }
    .act-row, table.tbl tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>تقرير يومي — OX GYM</h1>
  <div class="sub">التاريخ: ${escapeHtml(date)} · الورديات: ${report.sessionsCount}</div>

  <h2>ملخص اليوم</h2>
  <div class="summary-grid">
    <div class="kpi"><div class="kpi-label">إجمالي الدخل</div>
      <div class="kpi-value pos">$${fmtMoney(report.totals.incomeUSD)}</div></div>
    <div class="kpi"><div class="kpi-label">إجمالي المصاريف</div>
      <div class="kpi-value neg">$${fmtMoney(report.totals.expensesUSD)}</div></div>
    <div class="kpi"><div class="kpi-label">الصافي</div>
      <div class="kpi-value">$${fmtMoney(report.totals.netUSD)}</div></div>
    <div class="kpi"><div class="kpi-label">اشتراكات</div>
      <div class="kpi-value">$${fmtMoney(report.totals.subscriptionsUSD)} <span style="font-size:11px;color:#777">(${report.counts.subscriptions})</span></div></div>
    <div class="kpi"><div class="kpi-label">المتجر</div>
      <div class="kpi-value">$${fmtMoney(report.totals.storeSalesUSD)} <span style="font-size:11px;color:#777">(${report.counts.storeSales})</span></div></div>
    <div class="kpi"><div class="kpi-label">المطبخ</div>
      <div class="kpi-value">$${fmtMoney(report.totals.kitchenSalesUSD)} <span style="font-size:11px;color:#777">(${report.counts.kitchenSales})</span></div></div>
    <div class="kpi"><div class="kpi-label">InBody</div>
      <div class="kpi-value">$${fmtMoney(report.totals.inbodyUSD)} <span style="font-size:11px;color:#777">(${report.counts.inbody})</span></div></div>
    <div class="kpi"><div class="kpi-label">مصاريف</div>
      <div class="kpi-value neg">$${fmtMoney(report.totals.expensesUSD)} <span style="font-size:11px;color:#777">(${report.counts.expenses})</span></div></div>
  </div>

  <h2>تفصيل الورديات (${report.shifts.length})</h2>
  ${report.shifts.length === 0 ? `<div class="empty">لا توجد ورديات.</div>` : `
  <table class="tbl">
    <thead><tr>
      <th>الوردية</th><th>الموظف</th><th>الفتح</th><th>الإغلاق</th><th>الحالة</th>
      <th>الافتتاحي</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th>
      <th>الدخل</th><th>المصاريف</th><th>الصافي</th>
    </tr></thead>
    <tbody>${shiftRows}</tbody>
  </table>`}

  <h2>الاشتراكات (${report.counts.subscriptions})</h2>
  ${report.subscriptions.length === 0 ? `<div class="empty">لا توجد اشتراكات.</div>` : `
  <table class="tbl">
    <thead><tr>
      <th>الوقت</th><th>العضو</th><th>الهاتف</th><th>الباقة</th><th>العرض</th>
      <th>البداية</th><th>النهاية</th><th>السعر</th><th>المدفوع</th><th>المتبقي</th>
      <th>حالة الدفع</th><th>الطريقة</th><th>بواسطة</th>
    </tr></thead>
    <tbody>${subsRows}</tbody>
  </table>`}

  <h2>المتجر (${report.counts.storeSales})</h2>
  ${report.storeSales.length === 0 ? `<div class="empty">لا توجد مبيعات متجر.</div>` : `
  <table class="tbl">
    <thead><tr><th>الوقت</th><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الدفع</th><th>بواسطة</th></tr></thead>
    <tbody>${saleRows(report.storeSales)}</tbody>
  </table>
  <div class="sub-h">ملخص المتجر حسب المنتج</div>
  ${salesSummaryHTML(report.storeSales)}`}

  <h2>المطبخ (${report.counts.kitchenSales})</h2>
  ${report.kitchenSales.length === 0 ? `<div class="empty">لا توجد مبيعات مطبخ.</div>` : `
  <table class="tbl">
    <thead><tr><th>الوقت</th><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>الدفع</th><th>بواسطة</th></tr></thead>
    <tbody>${saleRows(report.kitchenSales)}</tbody>
  </table>
  <div class="sub-h">ملخص المطبخ حسب المنتج</div>
  ${salesSummaryHTML(report.kitchenSales)}`}

  <h2>InBody (${report.counts.inbody})</h2>
  ${report.inbody.length === 0 ? `<div class="empty">لا توجد جلسات InBody.</div>` : `
  <table class="tbl">
    <thead><tr><th>الوقت</th><th>العضو</th><th>النوع</th><th>المبلغ</th><th>بواسطة</th></tr></thead>
    <tbody>${inbodyRows}</tbody>
  </table>`}

  <h2>المصاريف (${report.expenses.length})</h2>
  ${report.expenses.length === 0 ? `<div class="empty">لا توجد مصاريف.</div>` : `
  <table class="tbl">
    <thead><tr><th>الوقت</th><th>الوصف</th><th>الفئة</th><th>المبلغ ($)</th><th>المبلغ الأصلي</th><th>العملة</th><th>بواسطة</th><th>ملغي؟</th></tr></thead>
    <tbody>${expRows}</tbody>
  </table>`}

  <h2>جرد المطبخ (${report.inventory.kitchen.length})</h2>
  <div class="note">المخزون الافتتاحي محسوب = الحالي + المُباع (قد لا يكون دقيقاً إذا تمت تعبئة المخزون خلال اليوم)</div>
  ${report.inventory.kitchen.length === 0 ? `<div class="empty">لا توجد أصناف.</div>` : `
  <table class="tbl">
    <thead><tr>
      <th>الصنف</th><th>المخزون الافتتاحي</th><th>المُباع</th><th>المخزون الحالي</th>
      <th>الإيراد</th><th>التكلفة</th><th>الربح</th>
    </tr></thead>
    <tbody>${inventoryRowsHTML(report.inventory.kitchen)}</tbody>
  </table>`}

  <h2>جرد المتجر (${report.inventory.store.length})</h2>
  <div class="note">المخزون الافتتاحي محسوب = الحالي + المُباع (قد لا يكون دقيقاً إذا تمت تعبئة المخزون خلال اليوم)</div>
  ${report.inventory.store.length === 0 ? `<div class="empty">لا توجد أصناف.</div>` : `
  <table class="tbl">
    <thead><tr>
      <th>الصنف</th><th>المخزون الافتتاحي</th><th>المُباع</th><th>المخزون الحالي</th>
      <th>الإيراد</th><th>التكلفة</th><th>الربح</th>
    </tr></thead>
    <tbody>${inventoryRowsHTML(report.inventory.store)}</tbody>
  </table>`}

  <h2>سجل المراجعة (${report.activity.length})</h2>
  ${report.activity.length === 0 ? `<div class="empty">لا توجد سجلات.</div>` : `
  <div class="act-list">${activityCards}</div>`}

  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 200);
      window.onafterprint = function () { window.close(); };
    };
  </script>
</body>
</html>`;

      const w = window.open("", "_blank");
      if (!w) {
        alert("الرجاء السماح بالنوافذ المنبثقة لتحميل التقرير");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="ox-input font-mono text-sm"
        dir="ltr"
      />
      <button
        onClick={handleExport}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-[#F5C100]/15 border border-[#F5C100]/30 text-[#F5C100] font-display tracking-wider clip-corner-sm hover:bg-[#F5C100]/25 transition-colors disabled:opacity-40 cursor-pointer"
      >
        <FileText size={15} />
        {loading ? "جاري التحميل..." : "تحميل التقرير اليومي"}
      </button>
    </div>
  );
}
