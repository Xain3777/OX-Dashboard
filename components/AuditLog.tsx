"use client";

import { useState, useMemo } from "react";
import { AuditEntry, AuditAction } from "@/lib/types";
import {
  UserPlus,
  ShoppingCart,
  RotateCcw,
  Receipt,
  LogIn,
  LogOut,
  ShieldCheck,
  PackagePlus,
  BarChart2,
  Lock,
  Activity,
} from "lucide-react";

interface AuditLogProps {
  entries: AuditEntry[];
}

// ── ACTION METADATA ───────────────────────────────────────────

const ACTION_META: Record<
  AuditAction,
  { label: string; color: string; borderColor: string; icon: React.ReactNode }
> = {
  subscription_created: {
    label: "إنشاء اشتراك",
    color: "text-[#F5C100]",
    borderColor: "border-l-[#F5C100]",
    icon: <UserPlus size={13} />,
  },
  sale_created: {
    label: "عملية بيع",
    color: "text-[#5CC45C]",
    borderColor: "border-l-[#5CC45C]",
    icon: <ShoppingCart size={13} />,
  },
  sale_reversed: {
    label: "استرجاع بيع",
    color: "text-[#FF3333]",
    borderColor: "border-l-[#FF3333]",
    icon: <RotateCcw size={13} />,
  },
  expense_created: {
    label: "تسجيل مصروف",
    color: "text-[#777777]",
    borderColor: "border-l-[#777777]",
    icon: <Receipt size={13} />,
  },
  session_opened: {
    label: "فتح جلسة",
    color: "text-[#FFD740]",
    borderColor: "border-l-[#FFD740]",
    icon: <LogIn size={13} />,
  },
  session_closed: {
    label: "إغلاق جلسة",
    color: "text-[#C49A00]",
    borderColor: "border-l-[#C49A00]",
    icon: <LogOut size={13} />,
  },
  discrepancy_resolved: {
    label: "حل فرق",
    color: "text-[#D42B2B]",
    borderColor: "border-l-[#D42B2B]",
    icon: <ShieldCheck size={13} />,
  },
  product_added: {
    label: "إضافة منتج",
    color: "text-[#AAAAAA]",
    borderColor: "border-l-[#AAAAAA]",
    icon: <PackagePlus size={13} />,
  },
  stock_adjusted: {
    label: "تعديل مخزون",
    color: "text-[#777777]",
    borderColor: "border-l-[#777777]",
    icon: <BarChart2 size={13} />,
  },
  monthly_locked: {
    label: "قفل شهري",
    color: "text-[#F5C100]",
    borderColor: "border-l-[#F5C100]",
    icon: <Lock size={13} />,
  },
};

// ── FILTER TABS ───────────────────────────────────────────────

type FilterTab = "all" | "sales" | "subscriptions" | "expenses" | "sessions";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "sales", label: "المبيعات" },
  { key: "subscriptions", label: "الاشتراكات" },
  { key: "expenses", label: "المصروفات" },
  { key: "sessions", label: "الجلسات" },
];

const FILTER_ACTIONS: Record<FilterTab, AuditAction[] | null> = {
  all: null,
  sales: ["sale_created", "sale_reversed"],
  subscriptions: ["subscription_created"],
  expenses: ["expense_created"],
  sessions: ["session_opened", "session_closed", "discrepancy_resolved"],
};

// ── TIMESTAMP FORMAT ──────────────────────────────────────────

function formatHHMM(isoStr: string): string {
  const d = new Date(isoStr);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDateShort(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString("ar-EG-u-nu-latn", {
    day: "2-digit",
    month: "short",
  });
}

// ── ENTRY ROW ─────────────────────────────────────────────────

interface EntryRowProps {
  entry: AuditEntry;
}

function EntryRow({ entry }: EntryRowProps) {
  const meta = ACTION_META[entry.action] ?? {
    label: entry.action,
    color: "text-[#555555]",
    borderColor: "border-l-[#555555]",
    icon: <Activity size={13} />,
  };

  const truncatedId =
    entry.entityId.length > 14
      ? `${entry.entityId.slice(0, 6)}…${entry.entityId.slice(-5)}`
      : entry.entityId;

  return (
    <div
      className={`flex items-start gap-3 px-4 py-2.5 border-b border-[#252525] border-l-2 ${meta.borderColor} hover:bg-[#111111]/60 transition-colors duration-100 last:border-b-0`}
    >
      {/* Timestamp */}
      <div className="shrink-0 flex flex-col items-end pt-px w-[52px]">
        <span className="font-mono text-[11px] text-[#F0EDE6] tabular-nums leading-tight">
          {formatHHMM(entry.timestamp)}
        </span>
        <span className="font-mono text-[10px] text-[#555555] tabular-nums leading-tight">
          {formatDateShort(entry.timestamp)}
        </span>
      </div>

      {/* Icon */}
      <div className={`shrink-0 mt-0.5 ${meta.color}`}>{meta.icon}</div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm text-[#AAAAAA] leading-snug truncate">
          {entry.description}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="font-mono text-[10px] text-[#777777]">
            {entry.userName}
          </span>
          {entry.entityId && (
            <>
              <span className="text-[#252525] text-[10px]">·</span>
              <span
                className="font-mono text-[10px] text-[#555555] truncate"
                title={entry.entityId}
              >
                {truncatedId}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Action badge */}
      <div className="shrink-0 pt-0.5">
        <span className={`font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
          {meta.label}
        </span>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────

export default function AuditLog({ entries }: AuditLogProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [entries]
  );

  const filtered = useMemo(() => {
    const allowed = FILTER_ACTIONS[activeFilter];
    if (!allowed) return sorted;
    return sorted.filter((e) => allowed.includes(e.action));
  }, [sorted, activeFilter]);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner flex flex-col">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#252525] shrink-0">
        <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
          سجل المراجعة
        </h2>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-[#555555]" />
          <span className="font-mono text-xs text-[#555555] tabular-nums">
            {filtered.length}
            {filtered.length !== entries.length && (
              <span className="text-[#252525]"> / {entries.length}</span>
            )}{" "}
            سجل
          </span>
        </div>
      </div>

      {/* ── FILTER TABS ── */}
      <div className="flex items-center gap-px px-4 py-2.5 border-b border-[#252525] shrink-0 overflow-x-auto">
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
          const count =
            tab.key === "all"
              ? entries.length
              : entries.filter((e) => {
                  const allowed = FILTER_ACTIONS[tab.key];
                  return allowed ? allowed.includes(e.action) : true;
                }).length;

          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={[
                "flex items-center gap-1.5 px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors duration-100 clip-corner-sm shrink-0",
                isActive
                  ? "bg-[#F5C100]/10 text-[#F5C100] border border-[#F5C100]/30"
                  : "text-[#555555] hover:text-[#AAAAAA] border border-transparent hover:border-[#252525]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {tab.label}
              <span
                className={`tabular-nums ${
                  isActive ? "text-[#F5C100]/60" : "text-[#252525]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── ENTRY LIST ── */}
      <div
        className="flex-1 overflow-y-auto max-h-[400px]"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "#252525 #111111",
        }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <span className="font-mono text-xs text-[#555555]">
              لا توجد سجلات.
            </span>
          </div>
        ) : (
          <div>
            {filtered.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      {/* ── FOOTER ── */}
      {filtered.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-[#252525] flex items-center justify-between">
          <span className="font-mono text-[10px] text-[#252525] uppercase tracking-wider">
            الأحدث أولاً
          </span>
          <div className="flex items-center gap-3">
            {Object.entries(ACTION_META)
              .filter(([, m]) =>
                filtered.some((e) => ACTION_META[e.action]?.color === m.color)
              )
              .slice(0, 4)
              .map(([key, meta]) => (
                <span
                  key={key}
                  className={`font-mono text-[10px] uppercase tracking-wider ${meta.color} opacity-50`}
                >
                  {meta.label}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
