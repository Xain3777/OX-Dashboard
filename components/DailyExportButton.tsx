"use client";

// Daily report download — shared by reception (app/page.tsx) and manager
// (ManagerDashboard.tsx). Builds a multi-sheet .xlsx workbook via the `xlsx`
// library (same approach as MonthlyExportButton). Each section of the report
// is its own sheet. Kitchen / Store sheets carry the detailed per-sale list
// AND a per-product summary block below it; the Expenses sheet lists every
// expense including cancelled ones with a "cancelled?" column.

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import {
  fetchDailyReport,
  type ActivityEntryRow,
  type InventoryRow,
  type SaleDailyRow,
} from "@/lib/supabase/dashboard";

function damascusTime(ts: string) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("ar-SY", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
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

// Arabic labels for every activity_feed.action we emit. Anything missing
// falls through to the raw action string so we never silently drop a row.
const ACTION_LABEL: Record<string, string> = {
  sale_create: "بيع",
  item_sale: "بيع",
  sales_cancel: "إلغاء بيع",
  item_sales_cancel: "إلغاء بيع",
  subscription_create: "إنشاء اشتراك",
  subscription_update: "تعديل اشتراك",
  gym_subscriptions_cancel: "حذف اشتراك",
  inbody_session: "جلسة InBody",
  inbody_create: "جلسة InBody",
  inbody_sessions_cancel: "إلغاء InBody",
  private_session_create: "تدريب خاص",
  expense_create: "تسجيل مصروف",
  expense_update: "تعديل مصروف",
  expenses_cancel: "إلغاء مصروف",
  product_stock_adjust: "تعديل المخزون",
  product_price_update: "تعديل السعر",
  food_item_delete: "حذف صنف مطبخ",
  session_opened: "فتح وردية",
  session_closed: "إغلاق وردية",
  catalog_item_create: "صنف جديد",
  catalog_item_update: "تعديل صنف",
  catalog_item_delete: "حذف صنف",
  exchange_rate_update: "تغيير سعر الدولار",
};

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

function num2(n: number | null | undefined): number | string {
  if (n == null) return "";
  return Number(Number(n).toFixed(2));
}

// Flattens an old_value → new_value diff into a single human-readable cell.
function diffString(
  oldV: Record<string, unknown> | null,
  newV: Record<string, unknown> | null,
): string {
  if (!oldV && !newV) return "";
  const keys = new Set<string>();
  Object.keys(oldV ?? {}).forEach((k) => keys.add(k));
  Object.keys(newV ?? {}).forEach((k) => keys.add(k));
  const out: string[] = [];
  for (const k of keys) {
    if (["id", "created_at", "created_by"].includes(k)) continue;
    const o = oldV?.[k] ?? null;
    const n = newV?.[k] ?? null;
    if (o === n) continue;
    const fmt = (v: unknown) =>
      v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
    out.push(`${FIELD_LABEL[k] ?? k}: ${fmt(o)} → ${fmt(n)}`);
  }
  return out.join(" | ");
}

// Per-product rollup for a kitchen/store sales list — total quantity and
// total revenue per product, sorted by revenue, with a grand-total row.
function salesSummaryAoA(rows: SaleDailyRow[]): (string | number)[][] {
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
  return [
    ["المنتج", "الكمية الكلية", "الإجمالي ($)"],
    ...entries.map(([name, v]) => [name, v.qty, num2(v.total)]),
    ["الإجمالي العام", grandQty, num2(grandTotal)],
  ];
}

// Builds a kitchen/store sheet: detailed per-sale rows, a blank spacer,
// then the per-product summary block.
function salesSheetAoA(rows: SaleDailyRow[]): (string | number)[][] {
  const detail: (string | number)[][] = [
    ["الوقت", "المنتج", "الكمية", "سعر الوحدة ($)", "الإجمالي ($)", "الدفع", "بواسطة"],
    ...rows.map((r) => [
      damascusTime(r.time),
      r.productName,
      r.quantity,
      num2(r.unitPriceUSD),
      num2(r.totalUSD),
      PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod,
      r.by,
    ]),
  ];
  return [...detail, [], ["ملخص حسب المنتج"], ...salesSummaryAoA(rows)];
}

function inventoryAoA(rows: InventoryRow[]): (string | number)[][] {
  return [
    [
      "الصنف", "المخزون الافتتاحي", "المُباع", "المخزون الحالي",
      "العملة", "الإيراد", "التكلفة", "الربح",
    ],
    ...rows.map((r) => [
      r.name,
      r.openingStock == null ? "" : r.openingStock,
      r.soldQty,
      r.currentStock == null ? "" : r.currentStock,
      r.currency.toUpperCase(),
      num2(r.revenue),
      r.costKnown ? num2(r.cost) : "",
      r.costKnown ? num2(r.profit) : "",
    ]),
  ];
}

export default function DailyExportButton() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const report = await fetchDailyReport(date);
      const wb = XLSX.utils.book_new();

      // ── Sheet: ملخص اليوم ─────────────────────────────────────────
      const summary: (string | number)[][] = [
        ["تقرير يومي — OX GYM"],
        ["التاريخ", date],
        ["عدد الورديات", report.sessionsCount],
        [],
        ["الفئة", "العدد", "المبلغ ($)"],
        ["اشتراكات", report.counts.subscriptions, num2(report.totals.subscriptionsUSD)],
        ["مبيعات المتجر", report.counts.storeSales, num2(report.totals.storeSalesUSD)],
        ["مبيعات المطبخ", report.counts.kitchenSales, num2(report.totals.kitchenSalesUSD)],
        ["جلسات InBody", report.counts.inbody, num2(report.totals.inbodyUSD)],
        ["مصاريف", report.counts.expenses, num2(-report.totals.expensesUSD)],
        [],
        ["إجمالي الدخل ($)", "", num2(report.totals.incomeUSD)],
        ["إجمالي المصاريف ($)", "", num2(report.totals.expensesUSD)],
        ["الصافي ($)", "", num2(report.totals.netUSD)],
      ];
      const summaryWS = XLSX.utils.aoa_to_sheet(summary);
      summaryWS["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, summaryWS, "ملخص اليوم");

      // ── Sheet: الورديات ──────────────────────────────────────────
      const shiftsHeader = [
        "الوردية", "الموظف", "الفتح", "الإغلاق", "الحالة",
        "الافتتاحي ($)", "المتوقع ($)", "الفعلي ($)", "الفرق ($)",
        "اشتراكات ($)", "متجر ($)", "مطبخ ($)", "InBody ($)",
        "مصاريف ($)", "الدخل ($)", "الصافي ($)",
      ];
      const shiftsRows = report.shifts.map((s) => [
        s.shiftLabel,
        s.employeeName,
        damascusTime(s.openedAt),
        s.closedAt ? damascusTime(s.closedAt) : "—",
        s.status === "open" ? "مفتوحة" : "مغلقة",
        num2(s.openingCashUSD), num2(s.expectedCashUSD), num2(s.actualCashUSD), num2(s.differenceUSD),
        num2(s.subscriptionsUSD), num2(s.storeSalesUSD), num2(s.kitchenSalesUSD), num2(s.inbodyUSD),
        num2(s.expensesUSD), num2(s.incomeUSD), num2(s.netUSD),
      ]);
      const shiftsWS = XLSX.utils.aoa_to_sheet([shiftsHeader, ...shiftsRows]);
      shiftsWS["!cols"] = [
        { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 9 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, shiftsWS, `الورديات (${report.shifts.length})`);

      // ── Sheet: الاشتراكات ────────────────────────────────────────
      const subsHeader = [
        "الوقت", "العضو", "الهاتف", "الباقة", "العرض", "البداية", "النهاية",
        "السعر ($)", "المدفوع ($)", "المتبقي ($)", "حالة الدفع", "الطريقة", "بواسطة",
      ];
      const subsRows = report.subscriptions.map((r) => [
        damascusTime(r.time),
        r.memberName,
        r.phone,
        r.planType,
        r.offer === "none" ? "" : r.offer,
        r.startDate,
        r.endDate,
        num2(r.amount), num2(r.paidAmount), num2(r.remaining),
        STATUS_LABEL[r.paymentStatus] ?? r.paymentStatus,
        PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod,
        r.by,
      ]);
      const subsWS = XLSX.utils.aoa_to_sheet([subsHeader, ...subsRows]);
      subsWS["!cols"] = [
        { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
        { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, subsWS, `الاشتراكات (${report.counts.subscriptions})`);

      // ── Sheets: المتجر / المطبخ (detail + per-product summary) ────
      const storeWS = XLSX.utils.aoa_to_sheet(salesSheetAoA(report.storeSales));
      storeWS["!cols"] = [
        { wch: 10 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, storeWS, `المتجر (${report.counts.storeSales})`);

      const kitchenWS = XLSX.utils.aoa_to_sheet(salesSheetAoA(report.kitchenSales));
      kitchenWS["!cols"] = [
        { wch: 10 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, kitchenWS, `المطبخ (${report.counts.kitchenSales})`);

      // ── Sheet: InBody ────────────────────────────────────────────
      const inbodyHeader = ["الوقت", "العضو", "النوع", "المبلغ ($)", "بواسطة"];
      const inbodyRows = report.inbody.map((r) => [
        damascusTime(r.time), r.memberName, r.sessionType, num2(r.amountUSD), r.by,
      ]);
      const inbodyWS = XLSX.utils.aoa_to_sheet([inbodyHeader, ...inbodyRows]);
      inbodyWS["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, inbodyWS, `InBody (${report.counts.inbody})`);

      // ── Sheet: المصاريف (every expense, cancelled flagged) ────────
      const expHeader = [
        "الوقت", "الوصف", "الفئة", "المبلغ ($)", "المبلغ الأصلي", "العملة", "بواسطة", "ملغي؟",
      ];
      const expRows = report.expenses.map((r) => [
        damascusTime(r.time),
        r.description,
        r.category,
        num2(r.amountUSD),
        r.originalAmount,
        r.currency.toUpperCase(),
        r.by,
        r.cancelled ? "ملغي" : "—",
      ]);
      const expWS = XLSX.utils.aoa_to_sheet([expHeader, ...expRows]);
      expWS["!cols"] = [
        { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
        { wch: 8 }, { wch: 16 }, { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, expWS, `المصاريف (${report.expenses.length})`);

      // ── Sheets: جرد المطبخ / جرد المتجر ──────────────────────────
      const invKitchenWS = XLSX.utils.aoa_to_sheet(inventoryAoA(report.inventory.kitchen));
      invKitchenWS["!cols"] = [
        { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, invKitchenWS, `جرد المطبخ (${report.inventory.kitchen.length})`);

      const invStoreWS = XLSX.utils.aoa_to_sheet(inventoryAoA(report.inventory.store));
      invStoreWS["!cols"] = [
        { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, invStoreWS, `جرد المتجر (${report.inventory.store.length})`);

      // ── Sheet: سجل المراجعة ──────────────────────────────────────
      const actHeader = [
        "الوقت", "الإجراء", "الوصف", "المبلغ ($)", "المبلغ (ل.س)", "بواسطة", "تفاصيل التغيير",
      ];
      const actRows = report.activity.map((a: ActivityEntryRow) => [
        damascusTime(a.time),
        ACTION_LABEL[a.action] ?? a.action,
        a.description,
        a.amountUSD == null ? "" : Number(Number(a.amountUSD).toFixed(2)),
        a.amountSYP == null ? "" : Math.round(Number(a.amountSYP)),
        a.by,
        diffString(a.oldValue, a.newValue),
      ]);
      const actWS = XLSX.utils.aoa_to_sheet([actHeader, ...actRows]);
      actWS["!cols"] = [
        { wch: 10 }, { wch: 16 }, { wch: 36 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 60 },
      ];
      XLSX.utils.book_append_sheet(wb, actWS, `سجل المراجعة (${report.activity.length})`);

      XLSX.writeFile(wb, `OX-Daily-${date}.xlsx`);
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
        <FileSpreadsheet size={15} />
        {loading ? "جاري التحميل..." : "تحميل التقرير اليومي"}
      </button>
    </div>
  );
}
