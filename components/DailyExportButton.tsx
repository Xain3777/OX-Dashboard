"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { fetchDailyReport } from "@/lib/supabase/dashboard";

function damascusTime(ts: string) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("ar-SY", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
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
  gym_subscriptions_cancel: "إلغاء اشتراك",
  inbody_create: "جلسة InBody",
  inbody_session: "جلسة InBody",
  inbody_sessions_cancel: "إلغاء InBody",
  expense_create: "تسجيل مصروف",
  expense_update: "تعديل مصروف",
  expenses_cancel: "إلغاء مصروف",
  session_opened: "فتح وردية",
  session_closed: "إغلاق وردية",
  catalog_item_create: "صنف جديد",
  catalog_item_update: "تعديل صنف",
  catalog_item_delete: "حذف صنف",
  exchange_rate_update: "تغيير سعر الدولار",
  private_session_create: "جلسة تدريب خاص",
  // Legacy action names (pre-catalog-cutover) — still present in old
  // activity_feed rows on the production DB.
  product_stock_adjust: "تعديل المخزون",
  product_price_update: "تعديل السعر",
  food_item_delete: "حذف صنف مطبخ",
};

function fmtMoney(n: number | null): string {
  if (n == null) return "";
  return Number(n).toFixed(2);
}

function diffString(oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null): string {
  if (!oldV && !newV) return "";
  const keys = new Set<string>();
  Object.keys(oldV ?? {}).forEach((k) => keys.add(k));
  Object.keys(newV ?? {}).forEach((k) => keys.add(k));
  const out: string[] = [];
  for (const k of keys) {
    if (["id", "created_at", "created_by"].includes(k)) continue;
    const o = oldV?.[k]; const n = newV?.[k];
    if (o === n) continue;
    const ov = o == null ? "—" : typeof o === "object" ? JSON.stringify(o) : String(o);
    const nv = n == null ? "—" : typeof n === "object" ? JSON.stringify(n) : String(n);
    out.push(`${k}: ${ov} → ${nv}`);
  }
  return out.join(" | ");
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

      // ── Sheet 1: ملخص (Summary) ────────────────────────────────────
      const summary: (string | number)[][] = [
        ["تقرير يومي — OX GYM"],
        ["التاريخ", date],
        ["عدد الجلسات النقدية المفتوحة في هذا اليوم", report.sessionsCount],
        [],
        ["الفئة", "العدد", "المبلغ ($)"],
        ["اشتراكات", report.counts.subscriptions, report.totals.subscriptionsUSD],
        ["مبيعات المتجر", report.counts.storeSales, report.totals.storeSalesUSD],
        ["مبيعات المطبخ", report.counts.kitchenSales, report.totals.kitchenSalesUSD],
        ["جلسات InBody", report.counts.inbody, report.totals.inbodyUSD],
        ["مصاريف", report.counts.expenses, -report.totals.expensesUSD],
        [],
        ["إجمالي الدخل ($)", "", report.totals.incomeUSD],
        ["إجمالي المصاريف ($)", "", report.totals.expensesUSD],
        ["الصافي ($)", "", report.totals.netUSD],
      ];
      const summaryWS = XLSX.utils.aoa_to_sheet(summary);
      summaryWS["!cols"] = [{ wch: 38 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, summaryWS, "ملخص");

      // ── Sheet: تفصيل الورديات ────────────────────────────────────
      // One row per shift in the day. Columns mirror the day summary but
      // scoped to that shift's cash_session_id. The shift label is derived
      // from the open hour (صباحية / ظهيرة / مسائية / ليلية).
      const shiftsHeader = [
        "الوردية", "الموظف", "وقت الفتح", "وقت الإغلاق", "الحالة",
        "الافتتاحي ($)", "المتوقع ($)", "الفعلي ($)", "الفرق ($)",
        "اشتراكات ($)", "InBody ($)", "متجر ($)", "مطبخ ($)",
        "مصاريف ($)", "الدخل ($)", "الصافي ($)",
        "# اشتراكات", "# InBody", "# متجر", "# مطبخ", "# مصاريف",
      ];
      const shiftsRows = report.shifts.map((s) => [
        s.shiftLabel,
        s.employeeName,
        damascusTime(s.openedAt),
        s.closedAt ? damascusTime(s.closedAt) : "—",
        s.status === "open" ? "مفتوحة" : "مغلقة",
        s.openingCashUSD,
        fmtMoney(s.expectedCashUSD),
        fmtMoney(s.actualCashUSD),
        fmtMoney(s.differenceUSD),
        s.subscriptionsUSD, s.inbodyUSD, s.storeSalesUSD, s.kitchenSalesUSD,
        s.expensesUSD, s.incomeUSD, s.netUSD,
        s.counts.subscriptions, s.counts.inbody, s.counts.storeSales, s.counts.kitchenSales, s.counts.expenses,
      ]);
      const shiftsWS = XLSX.utils.aoa_to_sheet([shiftsHeader, ...shiftsRows]);
      shiftsWS["!cols"] = [
        { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      ];
      XLSX.utils.book_append_sheet(wb, shiftsWS, `تفصيل الورديات (${report.shifts.length})`);

      // ── Sheet 2: الاشتراكات ───────────────────────────────────────
      const subsHeader = [
        "الوقت", "العضو", "الهاتف", "الباقة", "العرض",
        "تاريخ البداية", "تاريخ النهاية",
        "السعر الكامل ($)", "المدفوع ($)", "المتبقي ($)",
        "حالة الدفع", "طريقة الدفع", "بواسطة",
      ];
      const subsRows = report.subscriptions.map(r => [
        damascusTime(r.time),
        r.memberName,
        r.phone,
        r.planType,
        r.offer === "none" ? "" : r.offer,
        r.startDate,
        r.endDate,
        r.amount,
        r.paidAmount,
        r.remaining,
        STATUS_LABEL[r.paymentStatus] ?? r.paymentStatus,
        PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod,
        r.by,
      ]);
      const subsWS = XLSX.utils.aoa_to_sheet([subsHeader, ...subsRows]);
      subsWS["!cols"] = [
        { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
        { wch: 12 }, { wch: 12 },
        { wch: 14 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(wb, subsWS, `اشتراكات (${report.counts.subscriptions})`);

      // ── Sheet 3: المتجر ──────────────────────────────────────────
      const storeHeader = [
        "الوقت", "المنتج", "الكمية", "سعر الوحدة ($)", "الإجمالي ($)", "طريقة الدفع", "بواسطة",
      ];
      const storeRows = report.storeSales.map(r => [
        damascusTime(r.time),
        r.productName,
        r.quantity,
        r.unitPriceUSD,
        r.totalUSD,
        PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod,
        r.by,
      ]);
      const storeWS = XLSX.utils.aoa_to_sheet([storeHeader, ...storeRows]);
      storeWS["!cols"] = [
        { wch: 10 }, { wch: 26 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(wb, storeWS, `متجر (${report.counts.storeSales})`);

      // ── Sheet 4: المطبخ ──────────────────────────────────────────
      const kitchenRows = report.kitchenSales.map(r => [
        damascusTime(r.time),
        r.productName,
        r.quantity,
        r.unitPriceUSD,
        r.totalUSD,
        PAYMENT_LABEL[r.paymentMethod] ?? r.paymentMethod,
        r.by,
      ]);
      const kitchenWS = XLSX.utils.aoa_to_sheet([storeHeader, ...kitchenRows]);
      kitchenWS["!cols"] = storeWS["!cols"];
      XLSX.utils.book_append_sheet(wb, kitchenWS, `مطبخ (${report.counts.kitchenSales})`);

      // ── Sheet 5: InBody ──────────────────────────────────────────
      const inbodyHeader = ["الوقت", "العضو", "النوع", "المبلغ ($)", "بواسطة"];
      const inbodyRows = report.inbody.map(r => [
        damascusTime(r.time),
        r.memberName,
        r.sessionType,
        r.amountUSD,
        r.by,
      ]);
      const inbodyWS = XLSX.utils.aoa_to_sheet([inbodyHeader, ...inbodyRows]);
      inbodyWS["!cols"] = [{ wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, inbodyWS, `InBody (${report.counts.inbody})`);

      // ── Sheet 6: المصاريف ────────────────────────────────────────
      const expHeader = [
        "الوقت", "الوصف", "الفئة", "المبلغ ($)", "المبلغ الأصلي", "العملة", "بواسطة",
      ];
      const expRows = report.expenses.map(r => [
        damascusTime(r.time),
        r.description,
        r.category,
        r.amountUSD,
        r.originalAmount,
        r.currency.toUpperCase(),
        r.by,
      ]);
      const expWS = XLSX.utils.aoa_to_sheet([expHeader, ...expRows]);
      expWS["!cols"] = [
        { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(wb, expWS, `مصاريف (${report.counts.expenses})`);

      // ── Sheet: سجل النشاط ────────────────────────────────────────
      // Every event from activity_feed for the day: who, what, when, with
      // the structured before/after diff for edit/delete events. This is
      // the "what did each employee do today" view.
      const actHeader = [
        "الوقت", "الموظف", "الإجراء", "الوصف",
        "المبلغ ($)", "المبلغ (ل.س)", "تفاصيل التغيير",
      ];
      const actRows = report.activity.map((a) => [
        damascusTime(a.time),
        a.by,
        ACTION_LABEL[a.action] ?? a.action,
        a.description,
        a.amountUSD == null ? "" : Number(a.amountUSD).toFixed(2),
        a.amountSYP == null ? "" : Math.round(Number(a.amountSYP)),
        diffString(a.oldValue, a.newValue),
      ]);
      const actWS = XLSX.utils.aoa_to_sheet([actHeader, ...actRows]);
      actWS["!cols"] = [
        { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 36 },
        { wch: 10 }, { wch: 12 }, { wch: 60 },
      ];
      XLSX.utils.book_append_sheet(wb, actWS, `سجل النشاط (${report.activity.length})`);

      XLSX.writeFile(wb, `OX-Report-${date}.xlsx`);
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
