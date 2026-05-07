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
