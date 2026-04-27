"use client";

import { useMemo } from "react";
import {
  DollarSign,
  Users,
  CalendarClock,
  CalendarX,
  Banknote,
  Package,
} from "lucide-react";
import { useStore } from "@/lib/store-context";
import { isLowStock, isOutOfStock } from "@/lib/business-logic";

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
      <div className="flex items-center justify-between">
        <span className="text-secondary">{icon}</span>
        {badge && <span>{badge}</span>}
      </div>
      <p className={`font-display text-2xl leading-none tabular-nums tracking-wide ${valueColor}`}>
        {value}
      </p>
      <p className="font-mono text-xs text-secondary uppercase tracking-wider truncate">
        {label}
      </p>
    </div>
  );
}

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

function fmtUSD(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function KPIStrip() {
  const { subscriptions, products, totalIncome, runningCash } = useStore();

  const activeMembers = useMemo(
    () => subscriptions.filter((s) => s.status === "active").length,
    [subscriptions]
  );

  const expiringThisWeek = useMemo(
    () => subscriptions.filter((s) => s.status === "active" && s.remainingDays > 0 && s.remainingDays <= 7).length,
    [subscriptions]
  );

  const expiredCount = useMemo(
    () => subscriptions.filter((s) => s.status === "expired").length,
    [subscriptions]
  );

  const lowStockItems = useMemo(
    () => products.filter((p) => isLowStock(p.stock, p.lowStockThreshold) && !isOutOfStock(p.stock)).length,
    [products]
  );

  return (
    <section
      aria-label="مؤشرات الأداء الرئيسية"
      className="w-full border-t-2 border-gold pt-4"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KPICard
          label="إيرادات الوردية"
          value={fmtUSD(totalIncome)}
          icon={<DollarSign size={14} />}
          accent="gold"
        />

        <KPICard
          label="الأعضاء النشطين"
          value={String(activeMembers)}
          icon={<Users size={14} />}
        />

        <KPICard
          label="تنتهي هذا الأسبوع"
          value={String(expiringThisWeek)}
          icon={<CalendarClock size={14} />}
          accent={expiringThisWeek > 0 ? "gold" : "default"}
          badge={expiringThisWeek > 0 ? <GoldBadge count={expiringThisWeek} /> : undefined}
        />

        <KPICard
          label="اشتراكات منتهية"
          value={String(expiredCount)}
          icon={<CalendarX size={14} />}
          accent={expiredCount > 0 ? "red" : "default"}
          badge={expiredCount > 0 ? <RedBadge count={expiredCount} /> : undefined}
        />

        <KPICard
          label="النقد في الخزنة ($)"
          value={fmtUSD(runningCash)}
          icon={<Banknote size={14} />}
          accent="gold"
        />

        <KPICard
          label="مخزون منخفض"
          value={String(lowStockItems)}
          icon={<Package size={14} />}
          accent={lowStockItems > 0 ? "red" : "default"}
          badge={lowStockItems > 0 ? <RedBadge count={lowStockItems} /> : undefined}
        />
      </div>
    </section>
  );
}
