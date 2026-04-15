"use client";

import { WeeklyReview as WeeklyReviewType } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/business-logic";
import {
  TrendingUp,
  TrendingDown,
  UserPlus,
  UserMinus,
  Clock,
  AlertCircle,
  Package,
  ShieldAlert,
} from "lucide-react";

interface WeeklyReviewProps {
  data: WeeklyReviewType;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: "default" | "red" | "gold" | "success";
  sub?: React.ReactNode;
  glowRed?: boolean;
}

function StatCard({ label, icon, value, accent = "default", sub, glowRed }: StatCardProps) {
  const valueColor =
    accent === "red"
      ? "text-[#FF3333]"
      : accent === "gold"
      ? "text-[#F5C100]"
      : accent === "success"
      ? "text-[#5CC45C]"
      : "text-[#F0EDE6]";

  return (
    <div
      className={[
        "bg-[#111111] border border-[#252525] p-3 flex flex-col gap-1.5 clip-corner-sm",
        glowRed ? "glow-gold-sm" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={glowRed ? { boxShadow: "0 0 8px 1px rgba(212,43,43,0.35)" } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[#777777] uppercase font-mono tracking-wider leading-none">
          {label}
        </span>
        <span className="text-[#555555]">{icon}</span>
      </div>
      <span className={`font-mono text-lg leading-tight tabular-nums ${valueColor}`}>
        {value}
      </span>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );
}

export default function WeeklyReview({ data }: WeeklyReviewProps) {
  const net = data.totalRevenue - data.totalExpenses;
  const netPositive = net >= 0;

  const subPct =
    data.totalRevenue > 0
      ? Math.round((data.subscriptionRevenue / data.totalRevenue) * 100)
      : 0;
  const storePct = 100 - subPct;

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#252525]">
        <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
          المراجعة الأسبوعية
        </h2>
        <span className="font-mono text-xs text-[#555555]">
          {formatDate(data.weekStart)} &mdash; {formatDate(data.weekEnd)}
        </span>
      </div>

      {/* Stat Grid */}
      <div className="grid grid-cols-2 gap-2 p-4">
        {/* الإيرادات */}
        <StatCard
          label="الإيرادات"
          icon={<TrendingUp size={14} />}
          accent="success"
          value={`${formatCurrency(data.totalRevenue)}$`}
          sub={
            <div className="flex gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-[#555555]">
                اشتراكات:{" "}
                <span className="text-[#AAAAAA]">
                  {formatCurrency(data.subscriptionRevenue)}$
                </span>{" "}
                <span className="text-[#555555]">({subPct}%)</span>
              </span>
              <span className="font-mono text-[10px] text-[#555555]">
                المتجر:{" "}
                <span className="text-[#AAAAAA]">
                  {formatCurrency(data.storeRevenue)}$
                </span>{" "}
                <span className="text-[#555555]">({storePct}%)</span>
              </span>
            </div>
          }
        />

        {/* المصروفات */}
        <StatCard
          label="المصروفات"
          icon={<TrendingDown size={14} />}
          accent="red"
          value={`${formatCurrency(data.totalExpenses)}$`}
        />

        {/* اشتراكات جديدة */}
        <StatCard
          label="اشتراكات جديدة"
          icon={<UserPlus size={14} />}
          value={data.newSubscriptions}
          accent={data.newSubscriptions > 0 ? "success" : "default"}
        />

        {/* اشتراكات منتهية */}
        <StatCard
          label="اشتراكات منتهية"
          icon={<UserMinus size={14} />}
          value={data.expiredSubscriptions}
          accent={data.expiredSubscriptions > 0 ? "red" : "default"}
        />

        {/* تنتهي هذا الأسبوع */}
        <StatCard
          label="تنتهي هذا الأسبوع"
          icon={<Clock size={14} />}
          value={data.expiringThisWeek}
          accent={data.expiringThisWeek > 0 ? "gold" : "default"}
        />

        {/* مدفوعات معلقة */}
        <StatCard
          label="مدفوعات معلقة"
          icon={<AlertCircle size={14} />}
          value={data.pendingPayments}
          accent={data.pendingPayments > 0 ? "red" : "default"}
        />

        {/* حركة المخزون */}
        <StatCard
          label="حركة المخزون"
          icon={<Package size={14} />}
          value={data.stockMovements}
        />

        {/* فروقات غير محلولة */}
        <StatCard
          label="فروقات غير محلولة"
          icon={<ShieldAlert size={14} />}
          value={data.unresolvedDiscrepancies}
          accent={data.unresolvedDiscrepancies > 0 ? "red" : "default"}
          glowRed={data.unresolvedDiscrepancies > 0}
        />
      </div>

      {/* Net Line */}
      <div className="mx-4 mb-4 border border-[#252525] bg-[#0A0A0A] px-4 py-3 clip-corner-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap text-xs font-mono text-[#555555]">
            <span>
              <span className="text-[#5CC45C]">
                {formatCurrency(data.totalRevenue)}$
              </span>{" "}
              إيرادات
            </span>
            <span className="text-[#252525]">—</span>
            <span>
              <span className="text-[#FF3333]">
                {formatCurrency(data.totalExpenses)}$
              </span>{" "}
              مصروفات
            </span>
            <span className="text-[#252525]">=</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-mono text-[#555555] uppercase tracking-wider">
              الصافي
            </span>
            <span
              className={`font-display text-xl tabular-nums tracking-wider ${
                netPositive ? "text-[#5CC45C]" : "text-[#FF3333]"
              }`}
            >
              {netPositive ? "+" : ""}{formatCurrency(net)}$
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
