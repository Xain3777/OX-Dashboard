"use client";

import { MonthlyReview as MonthlyReviewType } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/business-logic";
import {
  Lock,
  TrendingUp,
  Crown,
  Users,
} from "lucide-react";

interface MonthlyReviewProps {
  data: MonthlyReviewType;
  onLock?: () => void;
}

const MONTH_NAMES = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function getMonthName(monthStr: string): string {
  const idx = parseInt(monthStr, 10) - 1;
  return MONTH_NAMES[idx] ?? monthStr;
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export default function MonthlyReview({ data, onLock }: MonthlyReviewProps) {
  const monthLabel = `${getMonthName(data.month)} ${data.year}`;

  const subRevPct =
    data.totalRevenue > 0
      ? (data.subscriptionRevenue / data.totalRevenue) * 100
      : 0;
  const storeRevPct = 100 - subRevPct;

  const totalSubs = data.activeSubscriptions + data.expiredSubscriptions;
  const activePct = totalSubs > 0 ? (data.activeSubscriptions / totalSubs) * 100 : 0;

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] border-t-2 border-t-[#F5C100] clip-corner">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
          المراجعة الشهرية &mdash; {monthLabel}
        </h2>
        {data.locked && (
          <span className="flex items-center gap-1.5 bg-[#F5C100]/10 border border-[#F5C100]/30 text-[#F5C100] text-[10px] font-mono uppercase tracking-wider px-2 py-1 clip-corner-sm">
            <Lock size={11} />
            مقفل
          </span>
        )}
      </div>

      <div className="p-5 flex flex-col gap-6">
        {/* ── A) REVENUE SUMMARY ── */}
        <section>
          <SectionLabel>ملخص الإيرادات</SectionLabel>
          <div className="grid grid-cols-1 gap-3 mt-2">
            <div className="bg-[#111111] border border-[#252525] border-t-2 border-t-[#5CC45C] p-4 clip-corner-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-[#555555]" />
                <span className="text-xs font-mono uppercase tracking-wider text-[#777777]">إجمالي الإيرادات</span>
              </div>
              <span className="font-display text-2xl tracking-wider tabular-nums text-[#5CC45C]">
                {formatCurrency(data.totalRevenue)}$
              </span>
            </div>
          </div>
        </section>

        {/* ── B) REVENUE BREAKDOWN ── */}
        <section>
          <SectionLabel>تفصيل الإيرادات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] p-4 clip-corner-sm flex flex-col gap-3">
            <div className="h-5 flex rounded overflow-hidden border border-[#252525]">
              <div
                className="bg-[#F5C100] h-full transition-all duration-500"
                style={{ width: `${subRevPct}%` }}
              />
              <div className="bg-[#5CC45C]/60 h-full flex-1 transition-all duration-500" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#F5C100] shrink-0" />
                <span className="font-mono text-xs text-[#AAAAAA]">اشتراكات</span>
                <span className="font-mono text-xs text-[#F0EDE6] tabular-nums ml-1">
                  {formatCurrency(data.subscriptionRevenue)}${" "}
                  <span className="text-[#555555]">({subRevPct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#5CC45C]/60 shrink-0" />
                <span className="font-mono text-xs text-[#AAAAAA]">المتجر</span>
                <span className="font-mono text-xs text-[#F0EDE6] tabular-nums ml-1">
                  {formatCurrency(data.storeRevenue)}${" "}
                  <span className="text-[#555555]">({storeRevPct.toFixed(1)}%)</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── C) TOP PRODUCTS ── */}
        <section>
          <SectionLabel>أفضل المنتجات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] clip-corner-sm overflow-hidden">
            {data.topProducts.slice(0, 5).map((p, i) => (
              <div
                key={p.name}
                className="ox-table-row flex items-center gap-3 px-4 py-2.5 border-b border-[#252525] last:border-b-0"
              >
                <div className="w-6 shrink-0 flex justify-center">
                  {i === 0 ? (
                    <Crown size={14} className="text-[#F5C100]" />
                  ) : (
                    <span className="font-mono text-xs text-[#555555]">#{i + 1}</span>
                  )}
                </div>
                <span className={`font-body text-sm flex-1 truncate ${i === 0 ? "text-[#F0EDE6]" : "text-[#AAAAAA]"}`}>
                  {p.name}
                </span>
                <span className="font-mono text-xs text-[#555555] tabular-nums w-16 text-right">
                  {p.quantity} قطعة
                </span>
                <span className={`font-mono text-xs tabular-nums w-24 text-right ${i === 0 ? "text-[#F5C100]" : "text-[#777777]"}`}>
                  {formatCurrency(p.revenue)}$
                </span>
              </div>
            ))}
            {data.topProducts.length === 0 && (
              <div className="px-4 py-3">
                <span className="font-mono text-xs text-[#555555]">لا توجد مبيعات مسجلة.</span>
              </div>
            )}
          </div>
        </section>

        {/* ── D) SUBSCRIPTION OVERVIEW ── */}
        <section>
          <SectionLabel>نظرة عامة على الاشتراكات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] p-4 clip-corner-sm flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <Users size={14} className="text-[#555555] shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-4 flex rounded overflow-hidden border border-[#252525]">
                  <div className="bg-[#5CC45C] h-full transition-all duration-500" style={{ width: `${activePct}%` }} />
                  <div className="bg-[#D42B2B]/50 h-full flex-1" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 font-mono text-xs text-[#5CC45C]">
                      <span className="w-2 h-2 rounded-sm bg-[#5CC45C]" />
                      نشط: {data.activeSubscriptions}
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-xs text-[#D42B2B]">
                      <span className="w-2 h-2 rounded-sm bg-[#D42B2B]/50" />
                      منتهي: {data.expiredSubscriptions}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-[#555555]">
                    {activePct.toFixed(0)}% نسبة الاحتفاظ
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── E) LOCK ── */}
        <section>
          {data.locked ? (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F5C100]/5 border border-[#F5C100]/20 clip-corner-sm">
              <Lock size={13} className="text-[#F5C100] shrink-0" />
              <span className="font-mono text-xs text-[#F5C100]">
                تم القفل{data.lockedAt ? ` في ${formatDate(data.lockedAt)}` : ""}
                {data.lockedBy ? ` بواسطة ${data.lockedBy}` : ""}
              </span>
            </div>
          ) : (
            <button
              onClick={onLock}
              className="w-full flex items-center justify-center gap-2 bg-[#F5C100]/10 hover:bg-[#F5C100]/20 border border-[#F5C100]/40 hover:border-[#F5C100]/70 text-[#F5C100] font-display text-base tracking-widest uppercase px-4 py-2.5 clip-corner-sm transition-all duration-150 active:scale-[0.98]"
            >
              <Lock size={14} />
              قفل المراجعة الشهرية
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#555555]">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#252525]" />
    </div>
  );
}
