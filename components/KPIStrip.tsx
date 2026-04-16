"use client";

import {
  DollarSign,
  Receipt,
  Users,
  CalendarClock,
  Banknote,
  TrendingUp,
  TrendingDown,
  Package,
  AlertTriangle,
} from "lucide-react";
import type { DashboardKPI } from "@/lib/types";
import { formatCurrency } from "@/lib/business-logic";

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KPICardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "gold" | "green" | "red" | "default";
  badge?: React.ReactNode;
}

function KPICard({ label, value, icon, accent = "default", badge }: KPICardProps) {
  const valueColor =
    accent === "gold"
      ? "text-gold"
      : accent === "green"
      ? "text-success"
      : accent === "red"
      ? "text-red"
      : "text-offwhite";

  const glowClass =
    accent === "red" ? "glow-red" : accent === "gold" ? "glow-gold-sm" : "";

  return (
    <div
      className={`ox-card relative flex flex-col gap-1 p-3 bg-charcoal border border-gunmetal clip-corner-sm ${glowClass}`}
    >
      {/* Icon + Badge row */}
      <div className="flex items-center justify-between">
        <span className="text-secondary">{icon}</span>
        {badge && <span>{badge}</span>}
      </div>

      {/* Value */}
      <p
        className={`font-display text-2xl leading-none tabular-nums tracking-wide ${valueColor}`}
      >
        {value}
      </p>

      {/* Label */}
      <p className="font-mono text-xs text-secondary uppercase tracking-wider truncate">
        {label}
      </p>
    </div>
  );
}

// ─── Badge helpers ─────────────────────────────────────────────────────────────

function GoldBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-sm bg-gold/10 border border-gold/40 text-gold font-mono text-[10px] font-bold tabular-nums">
      {count}
    </span>
  );
}

function RedBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-sm bg-red/15 border border-red/50 text-red-bright font-mono text-[10px] font-bold tabular-nums">
      {count}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface KPIStripProps {
  kpi: DashboardKPI;
  hideProfit?: boolean;
}

export default function KPIStrip({ kpi, hideProfit }: KPIStripProps) {
  const {
    todayRevenue,
    todayExpenses,
    activeMembers,
    expiringThisWeek,
    cashOnHand,
    monthlyProfit,
    lowStockItems,
    unresolvedDiscrepancies,
  } = kpi;

  const profitAccent: "green" | "red" | "default" =
    monthlyProfit > 0 ? "green" : monthlyProfit < 0 ? "red" : "default";

  const profitPrefix = monthlyProfit > 0 ? "+" : "";

  return (
    <section
      aria-label="مؤشرات الأداء الرئيسية"
      className="w-full border-t-2 border-gold pt-4"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {/* 1 — إيرادات اليوم */}
        <KPICard
          label="إيرادات اليوم"
          value={`${formatCurrency(todayRevenue)} $`}
          icon={<DollarSign size={14} />}
          accent="gold"
        />

        {/* 2 — مصروفات اليوم */}
        <KPICard
          label="مصروفات اليوم"
          value={`${formatCurrency(todayExpenses)} $`}
          icon={<Receipt size={14} />}
          accent="default"
        />

        {/* 3 — الأعضاء النشطين */}
        <KPICard
          label="الأعضاء النشطين"
          value={String(activeMembers)}
          icon={<Users size={14} />}
          accent="default"
        />

        {/* 4 — تنتهي هذا الأسبوع */}
        <KPICard
          label="تنتهي هذا الأسبوع"
          value={String(expiringThisWeek)}
          icon={<CalendarClock size={14} />}
          accent={expiringThisWeek > 0 ? "gold" : "default"}
          badge={expiringThisWeek > 0 ? <GoldBadge count={expiringThisWeek} /> : undefined}
        />

        {/* 5 — النقد المتوفر */}
        <KPICard
          label="النقد المتوفر"
          value={`${formatCurrency(cashOnHand)} $`}
          icon={<Banknote size={14} />}
          accent="default"
        />

        {/* 6 — الربح الشهري (manager only) */}
        {!hideProfit && (
          <KPICard
            label="الربح الشهري"
            value={`${profitPrefix}${formatCurrency(monthlyProfit)} $`}
            icon={
              monthlyProfit >= 0 ? (
                <TrendingUp size={14} />
              ) : (
                <TrendingDown size={14} />
              )
            }
            accent={profitAccent}
          />
        )}

        {/* 7 — مخزون منخفض */}
        <KPICard
          label="مخزون منخفض"
          value={String(lowStockItems)}
          icon={<Package size={14} />}
          accent={lowStockItems > 0 ? "red" : "default"}
          badge={lowStockItems > 0 ? <RedBadge count={lowStockItems} /> : undefined}
        />

        {/* 8 — فروقات */}
        <KPICard
          label="فروقات"
          value={String(unresolvedDiscrepancies)}
          icon={<AlertTriangle size={14} />}
          accent={unresolvedDiscrepancies > 0 ? "red" : "default"}
          badge={
            unresolvedDiscrepancies > 0 ? (
              <RedBadge count={unresolvedDiscrepancies} />
            ) : undefined
          }
        />
      </div>
    </section>
  );
}
