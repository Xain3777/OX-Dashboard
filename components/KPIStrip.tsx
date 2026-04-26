"use client";

import {
  DollarSign,
  Users,
  CalendarClock,
  CalendarX,
  Banknote,
  Package,
} from "lucide-react";
import { useLiveKPI } from "@/lib/supabase/dashboard";

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KPICardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "gold" | "green" | "red" | "default";
  badge?: React.ReactNode;
  href?: string;
}

function KPICard({ label, value, icon, accent = "default", badge, href }: KPICardProps) {
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

  const inner = (
    <div
      className={`ox-card relative flex flex-col gap-1 p-3 bg-charcoal border border-gunmetal clip-corner-sm ${glowClass} ${href ? "cursor-pointer hover:border-gold/40 transition-colors" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-secondary">{icon}</span>
        {badge && <span>{badge}</span>}
      </div>
      <p
        className={`font-display text-2xl leading-none tabular-nums tracking-wide ${valueColor}`}
      >
        {value}
      </p>
      <p className="font-mono text-xs text-secondary uppercase tracking-wider truncate">
        {label}
      </p>
    </div>
  );

  return href ? <a href={href}>{inner}</a> : inner;
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

interface KPIStripProps {
  hideProfit?: boolean;
}

function fmtUSD(n: number) {
  return `${n.toFixed(2)} $`;
}
function fmtSYP(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ل.س`;
}

export default function KPIStrip({ hideProfit: _hideProfit }: KPIStripProps) {
  const { kpi, loading } = useLiveKPI();

  return (
    <section
      aria-label="مؤشرات الأداء الرئيسية"
      className="w-full border-t-2 border-gold pt-4"
      data-loading={loading}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KPICard
          label="إيرادات اليوم"
          value={fmtUSD(kpi.todayRevenueUSD)}
          icon={<DollarSign size={14} />}
          accent="gold"
        />

        <KPICard
          label="الأعضاء النشطين"
          value={String(kpi.activeMembers)}
          icon={<Users size={14} />}
        />

        <KPICard
          label="تنتهي هذا الأسبوع"
          value={String(kpi.expiringThisWeek)}
          icon={<CalendarClock size={14} />}
          accent={kpi.expiringThisWeek > 0 ? "gold" : "default"}
          badge={kpi.expiringThisWeek > 0 ? <GoldBadge count={kpi.expiringThisWeek} /> : undefined}
        />

        <KPICard
          label="اشتراكات منتهية"
          value={String(kpi.endedCount)}
          icon={<CalendarX size={14} />}
          accent={kpi.endedCount > 0 ? "red" : "default"}
          badge={kpi.endedCount > 0 ? <RedBadge count={kpi.endedCount} /> : undefined}
        />

        <KPICard
          label="النقد في الخزنة"
          value={fmtSYP(kpi.cashOnHandSYP)}
          icon={<Banknote size={14} />}
        />

        <KPICard
          label="مخزون منخفض"
          value={String(kpi.lowStockItems)}
          icon={<Package size={14} />}
          accent={kpi.lowStockItems > 0 ? "red" : "default"}
          badge={kpi.lowStockItems > 0 ? <RedBadge count={kpi.lowStockItems} /> : undefined}
        />
      </div>
    </section>
  );
}
