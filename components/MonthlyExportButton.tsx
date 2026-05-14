"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { fetchMonthlyReport } from "@/lib/supabase/dashboard";

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

function damascusDate(ts: string) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Damascus" });
}

// Same action labels as the daily export — kept inline here so the two
// buttons don't fight over a shared module.
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

function defaultRange(): { start: string; end: string } {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Damascus" });
  const start = `${today.slice(0, 7)}-01`;
  return { start, end: today };
}

export default function MonthlyExportButton() {
  const def = defaultRange();
  const [startDate, setStartDate] = useState(def.start);
  const [endDate,   setEndDate]   = useState(def.end);
  const [loading,   setLoading]   = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const report = await fetchMonthlyReport(startDate, endDate);
      const wb = XLSX.utils.book_new();

      // ── Sheet: ملخص الشهر ─────────────────────────────────────────
      const summary: (string | number)[][] = [
        ["تقرير شهري — OX GYM"],
        ["من", startDate],
        ["إلى", endDate],
        ["عدد الورديات", report.counts.shifts],
        ["عدد سجلات النشاط", report.counts.activity],
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
      summaryWS["!cols"] = [{ wch: 38 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, summaryWS, "ملخص الشهر");

      // ── Sheet: تفصيل يومي ────────────────────────────────────────
      const dailyHeader = [
        "التاريخ", "اشتراكات ($)", "InBody ($)", "متجر ($)", "مطبخ ($)",
        "مصاريف ($)", "الدخل ($)", "الصافي ($)", "# ورديات", "# نشاط",
      ];
      const dailyRows = report.dailyRollup.map((d) => [
        d.date,
        d.subscriptionsUSD, d.inbodyUSD, d.storeSalesUSD, d.kitchenSalesUSD,
        d.expensesUSD, d.incomeUSD, d.netUSD,
        d.shiftsCount, d.activityCount,
      ]);
      const dailyWS = XLSX.utils.aoa_to_sheet([dailyHeader, ...dailyRows]);
      dailyWS["!cols"] = [
        { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      ];
      XLSX.utils.book_append_sheet(wb, dailyWS, "تفصيل يومي");

      // ── Sheet: تفصيل الورديات ────────────────────────────────────
      const shiftsHeader = [
        "التاريخ", "الوردية", "الموظف", "وقت الفتح", "وقت الإغلاق", "الحالة",
        "الافتتاحي ($)", "المتوقع ($)", "الفعلي ($)", "الفرق ($)",
        "اشتراكات ($)", "InBody ($)", "متجر ($)", "مطبخ ($)",
        "مصاريف ($)", "الدخل ($)", "الصافي ($)",
        "# اشتراكات", "# InBody", "# متجر", "# مطبخ", "# مصاريف",
      ];
      const shiftsRows = report.shifts.map((s) => [
        damascusDate(s.openedAt),
        s.shiftLabel,
        s.employeeName,
        damascusTime(s.openedAt),
        s.closedAt ? damascusTime(s.closedAt) : "—",
        s.status === "open" ? "مفتوحة" : "مغلقة",
        s.openingCashUSD, fmtMoney(s.expectedCashUSD), fmtMoney(s.actualCashUSD), fmtMoney(s.differenceUSD),
        s.subscriptionsUSD, s.inbodyUSD, s.storeSalesUSD, s.kitchenSalesUSD,
        s.expensesUSD, s.incomeUSD, s.netUSD,
        s.counts.subscriptions, s.counts.inbody, s.counts.storeSales, s.counts.kitchenSales, s.counts.expenses,
      ]);
      const shiftsWS = XLSX.utils.aoa_to_sheet([shiftsHeader, ...shiftsRows]);
      shiftsWS["!cols"] = [
        { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      ];
      XLSX.utils.book_append_sheet(wb, shiftsWS, `الورديات (${report.shifts.length})`);

      // ── Sheet: تقرير الموظفين ────────────────────────────────────
      const empHeader = [
        "الموظف", "# ورديات", "إجمالي الدخل ($)",
        "# إلغاءات", "# تغيير سعر الدولار", "# تعديلات المخزون/الأسعار",
      ];
      const empRows = report.employees.map((e) => [
        e.name, e.shifts, e.totalIncomeUSD, e.voidsCount, e.exchangeRateChanges, e.stockEdits,
      ]);
      const empWS = XLSX.utils.aoa_to_sheet([empHeader, ...empRows]);
      empWS["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(wb, empWS, "تقرير الموظفين");

      // ── Sheet: سجل النشاط ────────────────────────────────────────
      const actHeader = [
        "التاريخ", "الوقت", "الموظف", "الإجراء", "الوصف",
        "المبلغ ($)", "المبلغ (ل.س)", "تفاصيل التغيير",
      ];
      const actRows = report.activity.map((a) => [
        damascusDate(a.time),
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
        { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 36 },
        { wch: 10 }, { wch: 12 }, { wch: 60 },
      ];
      XLSX.utils.book_append_sheet(wb, actWS, `سجل النشاط (${report.activity.length})`);

      XLSX.writeFile(wb, `OX-Monthly-${startDate}_${endDate}.xlsx`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-slate uppercase tracking-widest">من</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="ox-input font-mono text-sm"
          dir="ltr"
        />
        <span className="font-mono text-[10px] text-slate uppercase tracking-widest">إلى</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="ox-input font-mono text-sm"
          dir="ltr"
        />
      </div>
      <button
        onClick={handleExport}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-[#F5C100]/15 border border-[#F5C100]/30 text-[#F5C100] font-display tracking-wider clip-corner-sm hover:bg-[#F5C100]/25 transition-colors disabled:opacity-40 cursor-pointer"
      >
        <FileSpreadsheet size={15} />
        {loading ? "جاري التحميل..." : "تحميل التقرير الشهري"}
      </button>
    </div>
  );
}
