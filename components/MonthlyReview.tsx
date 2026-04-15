"use client";

import { MonthlyReview as MonthlyReviewType, ExpenseCategory } from "@/lib/types";
import { formatCurrency, formatDate, getCategoryLabel } from "@/lib/business-logic";
import {
  Lock,
  TrendingUp,
  TrendingDown,
  Crown,
  Users,
  CheckCircle2,
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

// ── P&L SUMMARY CARD ──────────────────────────────────────────
interface PLCardProps {
  label: string;
  amount: number;
  accent: "green" | "red" | "net";
  icon: React.ReactNode;
}

function PLCard({ label, amount, accent, icon }: PLCardProps) {
  const borderColor =
    accent === "green"
      ? "border-t-[#5CC45C]"
      : accent === "red"
      ? "border-t-[#D42B2B]"
      : amount >= 0
      ? "border-t-[#5CC45C]"
      : "border-t-[#D42B2B]";

  const valueColor =
    accent === "green"
      ? "text-[#5CC45C]"
      : accent === "red"
      ? "text-[#FF3333]"
      : amount >= 0
      ? "text-[#5CC45C]"
      : "text-[#FF3333]";

  return (
    <div
      className={`bg-[#111111] border border-[#252525] border-t-2 ${borderColor} p-4 clip-corner-sm flex flex-col gap-2`}
    >
      <div className="flex items-center justify-between text-[#555555]">
        <span className="text-xs font-mono uppercase tracking-wider text-[#777777]">
          {label}
        </span>
        {icon}
      </div>
      <span
        className={`font-display text-2xl tracking-wider tabular-nums ${valueColor}`}
      >
        {accent === "net" && amount >= 0 ? "+" : ""}{formatCurrency(amount)}$
      </span>
    </div>
  );
}

// ── EXPENSE BAR ROW ───────────────────────────────────────────
interface ExpenseRowProps {
  label: string;
  amount: number;
  total: number;
  pct: number;
}

function ExpenseRow({ label, amount, pct }: ExpenseRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-body text-xs text-[#AAAAAA]">{label}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[#777777] tabular-nums">
            {pct.toFixed(1)}%
          </span>
          <span className="font-mono text-xs text-[#F0EDE6] tabular-nums w-24 text-right">
            {formatCurrency(amount)}$
          </span>
        </div>
      </div>
      <div className="h-[3px] bg-[#252525] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#8A6D00] rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 0.5)}%` }}
        />
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export default function MonthlyReview({ data, onLock }: MonthlyReviewProps) {
  const monthLabel = `${getMonthName(data.month)} ${data.year}`;

  // Revenue breakdown
  const subRevPct =
    data.totalRevenue > 0
      ? (data.subscriptionRevenue / data.totalRevenue) * 100
      : 0;
  const storeRevPct = 100 - subRevPct;

  // Expense breakdown — sorted descending
  const expenseEntries = (
    Object.entries(data.expenseBreakdown) as [ExpenseCategory, number][]
  )
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  // Subscription ratio
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
        {/* ── A) P&L SUMMARY ── */}
        <section>
          <SectionLabel>ملخص الأرباح والخسائر</SectionLabel>
          <div className="grid grid-cols-3 gap-3 mt-2">
            <PLCard
              label="إجمالي الإيرادات"
              amount={data.totalRevenue}
              accent="green"
              icon={<TrendingUp size={14} />}
            />
            <PLCard
              label="إجمالي المصروفات"
              amount={data.totalExpenses}
              accent="red"
              icon={<TrendingDown size={14} />}
            />
            <PLCard
              label={data.netProfit >= 0 ? "صافي الربح" : "صافي الخسارة"}
              amount={data.netProfit}
              accent="net"
              icon={
                data.netProfit >= 0 ? (
                  <TrendingUp size={14} />
                ) : (
                  <TrendingDown size={14} />
                )
              }
            />
          </div>
        </section>

        {/* ── B) REVENUE BREAKDOWN ── */}
        <section>
          <SectionLabel>تفصيل الإيرادات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] p-4 clip-corner-sm flex flex-col gap-3">
            {/* Bar */}
            <div className="h-5 flex rounded overflow-hidden border border-[#252525]">
              <div
                className="bg-[#F5C100] h-full transition-all duration-500"
                style={{ width: `${subRevPct}%` }}
              />
              <div
                className="bg-[#5CC45C]/60 h-full flex-1 transition-all duration-500"
              />
            </div>
            {/* Legend */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#F5C100] shrink-0" />
                <span className="font-mono text-xs text-[#AAAAAA]">
                  اشتراكات
                </span>
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

        {/* ── C) EXPENSE BREAKDOWN ── */}
        <section>
          <SectionLabel>تفصيل المصروفات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] p-4 clip-corner-sm flex flex-col gap-3">
            {expenseEntries.length === 0 ? (
              <span className="font-mono text-xs text-[#555555]">
                لا توجد مصروفات مسجلة.
              </span>
            ) : (
              expenseEntries.map(([cat, amount]) => {
                const pct =
                  data.totalExpenses > 0
                    ? (amount / data.totalExpenses) * 100
                    : 0;
                return (
                  <ExpenseRow
                    key={cat}
                    label={getCategoryLabel(cat)}
                    amount={amount}
                    total={data.totalExpenses}
                    pct={pct}
                  />
                );
              })
            )}
            {expenseEntries.length > 0 && (
              <div className="pt-2 border-t border-[#252525] flex justify-between items-center">
                <span className="font-mono text-xs text-[#555555] uppercase tracking-wider">
                  الإجمالي
                </span>
                <span className="font-mono text-xs text-[#FF3333] tabular-nums">
                  {formatCurrency(data.totalExpenses)}$
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── D) TOP PRODUCTS ── */}
        <section>
          <SectionLabel>أفضل المنتجات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] clip-corner-sm overflow-hidden">
            {data.topProducts.slice(0, 5).map((p, i) => (
              <div
                key={p.name}
                className="ox-table-row flex items-center gap-3 px-4 py-2.5 border-b border-[#252525] last:border-b-0"
              >
                {/* Rank Badge */}
                <div className="w-6 shrink-0 flex justify-center">
                  {i === 0 ? (
                    <Crown size={14} className="text-[#F5C100]" />
                  ) : (
                    <span className="font-mono text-xs text-[#555555]">
                      #{i + 1}
                    </span>
                  )}
                </div>
                {/* Name */}
                <span
                  className={`font-body text-sm flex-1 truncate ${
                    i === 0 ? "text-[#F0EDE6]" : "text-[#AAAAAA]"
                  }`}
                >
                  {p.name}
                </span>
                {/* Qty */}
                <span className="font-mono text-xs text-[#555555] tabular-nums w-16 text-right">
                  {p.quantity} قطعة
                </span>
                {/* Revenue */}
                <span
                  className={`font-mono text-xs tabular-nums w-24 text-right ${
                    i === 0 ? "text-[#F5C100]" : "text-[#777777]"
                  }`}
                >
                  {formatCurrency(p.revenue)}$
                </span>
              </div>
            ))}
            {data.topProducts.length === 0 && (
              <div className="px-4 py-3">
                <span className="font-mono text-xs text-[#555555]">
                  لا توجد مبيعات مسجلة.
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── E) SUBSCRIPTION OVERVIEW ── */}
        <section>
          <SectionLabel>نظرة عامة على الاشتراكات</SectionLabel>
          <div className="mt-2 bg-[#111111] border border-[#252525] p-4 clip-corner-sm flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <Users size={14} className="text-[#555555] shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-4 flex rounded overflow-hidden border border-[#252525]">
                  <div
                    className="bg-[#5CC45C] h-full transition-all duration-500"
                    style={{ width: `${activePct}%` }}
                  />
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

        {/* ── F) LOCK ── */}
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

// ── UTIL ──────────────────────────────────────────────────────
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
