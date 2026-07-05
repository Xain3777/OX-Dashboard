"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  Shield, LogOut, ChevronDown, ChevronUp, Plus, Trash2,
  Check, X, AlertTriangle, ChefHat, Package, ReceiptText,
  Users, Dumbbell, Clock, Edit2, ShoppingBag, DollarSign,
  TrendingUp, TrendingDown, Banknote, Activity, CreditCard,
  Calendar, Snowflake, CalendarX, CalendarClock, DoorOpen,
  Layers, Boxes, FileText, Link2, BarChart3, SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import type { LocalSession } from "@/lib/store-context";
import type { FoodItem, FoodItemCategory, ProductCategory, ExpenseCategory, ExpenseFrequency, Expense, Currency } from "@/lib/types";
import type { Product } from "@/lib/types";
import {
  getPlanLabel, getOfferLabel, getProductCategoryLabel, getCategoryLabel,
} from "@/lib/business-logic";
import {
  cancelTransaction, pushExpense, updateExpense,
  upsertAnvizMemberMap, updateAnvizMemberMap, deleteAnvizMemberMap,
} from "@/lib/supabase/intake";
import { formatTime, formatDate } from "@/lib/utils/time";
import KPIStrip from "@/components/KPIStrip";
import DailyExportButton from "@/components/DailyExportButton";
import MonthlyExportButton from "@/components/MonthlyExportButton";
import InventoryActivityPanel from "@/components/InventoryActivityPanel";
import AccountabilityBlock from "@/components/AccountabilityBlock";
import ProfitReportBlock from "@/components/ProfitReportBlock";
import ItemsManager from "@/components/ItemsManager";
import WarehouseManager from "@/components/WarehouseManager";
import PurchasesManager from "@/components/PurchasesManager";
import RecipesManager from "@/components/RecipesManager";
import InventoryReports from "@/components/InventoryReports";
import AdjustmentsManager from "@/components/AdjustmentsManager";
import AuditLog from "@/components/AuditLog";
import { findStaffByEmail } from "@/lib/staff-accounts";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  makeDateRange,
  useManagerOverview,
  type DateRangePreset,
  type ManagerDateRange,
  type CurrencyBucket,
  type PlanRow,
  type OfferRow,
} from "@/lib/supabase/dashboard";

// ─── Constants ────────────────────────────────────────────────────────────────

type ManagerSection = "sessions" | "subscriptions" | "inbody" | "items" | "warehouse" | "purchases" | "recipes" | "invreports" | "adjustments" | "store" | "kitchen" | "profit" | "expenses" | "gate" | "audit" | "activity";

const FOOD_CATEGORIES: FoodItemCategory[] = ["meals", "meal_addons", "other", "breakfast", "salads", "drinks", "snacks", "food"];
const FOOD_CAT_LABELS: Record<FoodItemCategory, string> = {
  meals: "وجبات رئيسية", meal_addons: "إضافات وجبة", other: "أصناف أخرى",
  breakfast: "فطور", salads: "سلطات",
  drinks: "مشروبات", snacks: "وجبات خفيفة", food: "مطبخ عام",
};

// Effective cost in SYP. Prefers cost_syp; falls back to cost_usd × rate;
// finally falls back to the legacy `cost` column. Returns null when no
// cost has been recorded — callers must render a "—" placeholder.
function effectiveCostSYP(item: FoodItem, exchangeRate: number): number | null {
  if (item.cost_syp != null && Number.isFinite(item.cost_syp)) return Number(item.cost_syp);
  if (item.cost_usd != null && Number.isFinite(item.cost_usd) && exchangeRate > 0)
    return Number(item.cost_usd) * exchangeRate;
  if (item.cost != null && Number.isFinite(item.cost)) return Number(item.cost);
  return null;
}

const PRODUCT_CATEGORIES: ProductCategory[] = [
  "protein", "mass_gainer", "creatine", "amino",
  "pre_workout", "fat_burner", "health", "focus", "other",
];

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "salaries", "rent", "equipment", "maintenance",
  "utilities", "supplies", "marketing", "miscellaneous",
];

const FREQ_LABELS: Record<ExpenseFrequency, string> = {
  monthly: "شهري", weekly: "أسبوعي", daily: "يومي", one_time: "مرة واحدة",
};

// In modern data, `createdBy` is the auth.users UUID (not an email). Resolution
// order:
//   1. profile map fetched via useProfileNames() — keyed by auth.users.id,
//      values are profiles.display_name. This is the canonical source.
//   2. row-level created_by_name snapshot if passed in (some tables already
//      carry this, e.g. item_sales / sales / inbody_sessions / expenses).
//   3. legacy email lookup against the hardcoded staff roster.
//   4. last-resort UUID prefix so we never show an empty cell.
function fmtEmployee(
  idOrEmail: string,
  profileNames?: Map<string, string>,
  fallbackName?: string,
): string {
  if (idOrEmail && profileNames) {
    const fromProfile = profileNames.get(idOrEmail);
    if (fromProfile) return fromProfile;
  }
  if (fallbackName && fallbackName.trim()) return fallbackName;
  const staff = findStaffByEmail(idOrEmail);
  if (staff) return staff.displayName;
  if (idOrEmail.includes("@")) return idOrEmail.replace(/@.*$/, "");
  return idOrEmail.slice(0, 8);
}

// Caches profiles.display_name keyed by auth.users.id so any table column
// rendering an employee can resolve the name without re-fetching. The
// profiles table is tiny (≈5 rows), and we refetch on insert/update via
// realtime so renaming a staff member propagates immediately.
function useProfileNames(): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const supabase = supabaseBrowser();
    async function load() {
      const { data } = await supabase.from("profiles").select("id, display_name");
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const p of (data ?? []) as Array<Record<string, unknown>>) {
        const id = p.id == null ? "" : String(p.id);
        const name = p.display_name == null ? "" : String(p.display_name);
        if (id) m.set(id, name);
      }
      setMap(m);
    }
    void load();
    const ch = supabase
      .channel("profiles-names")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);
  return map;
}

// ─── Session label helper ─────────────────────────────────────────────────────

function useSessionLabel() {
  const { localSession, sessionHistory } = useStore();
  const sessions = useMemo<LocalSession[]>(() => {
    const arr: LocalSession[] = localSession ? [localSession] : [];
    return [...arr, ...sessionHistory];
  }, [localSession, sessionHistory]);

  return useCallback((createdAt: string): string => {
    const sess = sessions.find(
      (s) => s.openedAt <= createdAt && (!s.closedAt || s.closedAt >= createdAt)
    );
    if (!sess) return "—";
    return new Date(sess.openedAt).toLocaleDateString("ar-SY", { timeZone: "Asia/Damascus", month: "short", day: "numeric" });
  }, [sessions]);
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function LogoutModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  if (typeof document === "undefined") return null;
  // Portal-rendered to escape any ancestor stacking context.
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="bg-[#1A1A1A] border border-[#252525] p-6 rounded-sm max-w-sm w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={18} className="text-[#F5C100] shrink-0" />
          <h3 className="font-display text-lg tracking-wider text-[#F0EDE6]">تسجيل الخروج</h3>
        </div>
        <p className="font-body text-sm text-[#AAAAAA] mb-6">هل أنت متأكد من تسجيل الخروج؟</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 bg-[#D42B2B] hover:bg-[#FF3333] text-white font-display text-sm tracking-widest rounded-sm cursor-pointer">خروج</button>
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 border border-[#252525] text-[#777777] hover:text-[#F0EDE6] font-mono text-xs rounded-sm cursor-pointer">إلغاء</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Section({ title, icon, collapsed, onToggle, children }: {
  title: string; icon: React.ReactNode; collapsed: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center justify-between py-2 group cursor-pointer">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 className="font-display text-lg tracking-wider text-[#F0EDE6] group-hover:text-[#F5C100] transition-colors">{title}</h2>
        </div>
        <div className="flex items-center gap-2 text-[#555555] group-hover:text-[#F5C100] transition-colors">
          <span className="font-mono text-[10px] tracking-wider">{collapsed ? "توسيع" : "طي"}</span>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </button>
      {!collapsed && <div className="animate-fade-in">{children}</div>}
    </div>
  );
}

function SubHeader({ label }: { label: string }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">{label}</p>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-1">{label}</p>
      <p className={`font-mono tabular-nums text-sm ${highlight ? "text-[#F5C100]" : "text-[#F0EDE6]"}`}>{value}</p>
    </div>
  );
}

function THead({ cols, className }: { cols: string[]; className?: string }) {
  return (
    <thead className={className}>
      <tr className="border-b border-[#252525] bg-[#111111]">
        {cols.map((h) => (
          <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
        ))}
      </tr>
    </thead>
  );
}

function EmptyTable({ label }: { label: string }) {
  return <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">{label}</div>;
}

// Inline editor for the stock count of a tracked kitchen item. While the
// input is focused, `draft` holds the user's typed value so realtime
// sales (which mutate item.stock_quantity) don't yank the input from
// under them. On blur we commit when the value actually changed and
// fall back to the latest prop value. Non-tracked rows render a dash.
function StockCell({
  item,
  onChange,
}: {
  item: FoodItem;
  onChange: (next: number) => void;
}) {
  const current = item.stock_quantity ?? 0;
  const [draft, setDraft] = useState<string | null>(null);

  if (!item.track_stock) {
    return <span className="font-mono text-[10px] text-[#555555]">—</span>;
  }
  const isLow = current <= (item.low_stock_threshold ?? 3);
  const colour = isLow ? "text-[#FF3333]" : "text-[#5CC45C]";
  const displayed = draft ?? String(current);
  return (
    <input
      type="number"
      min="0"
      step="1"
      value={displayed}
      onFocus={() => setDraft(String(current))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const n = parseInt(draft, 10);
        setDraft(null);
        if (Number.isFinite(n) && n >= 0 && n !== current) onChange(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`w-16 bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-0.5 text-xs font-mono tabular-nums text-right ${colour} focus:outline-none focus:border-[#F5C100]/40`}
    />
  );
}

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";
const BTN_ADD = "flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer";
const EDIT_INPUT = "w-20 bg-[#0A0A0A] border border-[#F5C100]/40 rounded-sm px-2 py-0.5 text-xs focus:outline-none";

// ─── Sessions accordion ───────────────────────────────────────────────────────

function SessionsAccordion() {
  const store = useStore();
  const allSessions = useMemo<LocalSession[]>(() => {
    const arr: LocalSession[] = store.localSession ? [store.localSession] : [];
    return [...arr, ...store.sessionHistory].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }, [store.localSession, store.sessionHistory]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, idx: number) => expanded[id] !== undefined ? expanded[id] : idx === 0;
  const toggle = (id: string, idx: number) => setExpanded((e) => ({ ...e, [id]: !isOpen(id, idx) }));

  if (allSessions.length === 0) {
    return <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-8 text-center"><EmptyTable label="لا توجد جلسات مسجلة بعد" /></div>;
  }

  return (
    <div className="space-y-2">
      {allSessions.map((sess, idx) => {
        const open     = isOpen(sess.id, idx);
        const isLive   = sess.status === "open";
        const subsI    = isLive ? store.subsIncome    : (sess.subsIncome    ?? 0);
        const storeI   = isLive ? store.storeIncome   : (sess.storeIncome   ?? 0);
        const mealsI   = isLive ? store.mealsIncome   : (sess.mealsIncome   ?? 0);
        const inbodyI  = isLive ? store.inbodyIncome  : (sess.inbodyIncome  ?? 0);
        const totalI   = isLive ? store.totalIncome   : (sess.totalIncome   ?? 0);
        const expenses = isLive ? store.expensesTotal : (sess.expensesTotal ?? 0);
        const running  = isLive ? store.runningCash   : (sess.actualCash    ?? 0);
        const expectedAtClose = sess.openingCash + totalI - expenses;
        const openedDt = sess.openedAt;
        const closedDt = sess.closedAt ?? null;
        const diff     = sess.actualCash != null ? sess.actualCash - expectedAtClose : null;

        return (
          <div key={sess.id} className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
            <button onClick={() => toggle(sess.id, idx)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#252525]/30 transition-colors cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isLive ? "bg-[#5CC45C] animate-pulse" : "bg-[#555555]"}`} />
                <span className="font-display text-sm tracking-wider text-[#F0EDE6] truncate">
                  {new Date(openedDt).toLocaleDateString("ar-SY", { timeZone: "Asia/Damascus", weekday: "short", month: "short", day: "numeric" })}
                </span>
                <span className="font-mono text-[10px] text-[#555555] whitespace-nowrap">
                  {formatTime(openedDt)}
                  {closedDt && ` ← ${formatTime(closedDt)}`}
                </span>
                {isLive
                  ? <span className="px-2 py-0.5 bg-[#5CC45C]/10 border border-[#5CC45C]/30 rounded text-[9px] font-mono text-[#5CC45C]">مفتوحة</span>
                  : <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/30 rounded text-[9px] font-mono text-[#777777]">مغلقة</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono tabular-nums text-sm text-[#F5C100]">${totalI.toFixed(2)}</span>
                {open ? <ChevronUp size={14} className="text-[#555555]" /> : <ChevronDown size={14} className="text-[#555555]" />}
              </div>
            </button>

            {open && (
              <div className="border-t border-[#252525] px-5 py-4 animate-fade-in space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="اشتراكات" value={`$${subsI.toFixed(2)}`} />
                  <Stat label="متجر" value={`$${storeI.toFixed(2)}`} />
                  <Stat label="مطبخ" value={`$${mealsI.toFixed(2)}`} />
                  <Stat label="InBody" value={`$${inbodyI.toFixed(2)}`} highlight />
                </div>

                {/* Reception-style totals stack: gross income / expenses / net.
                    Same labels + colors as CashSessionBlock so reception and
                    manager read the same numbers off the same UI shape. */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#0F0F0F] border border-[#252525] rounded-sm">
                    <span className="font-mono text-[10px] text-[#555555] tracking-widest uppercase">إجمالي الدخل</span>
                    <span className="font-mono text-sm text-[#AAAAAA] tabular-nums" dir="ltr">${totalI.toFixed(2)}</span>
                  </div>
                  <div className={`flex items-center justify-between px-3 py-2 border rounded-sm ${
                    expenses > 0 ? "bg-[#FF3333]/5 border-[#FF3333]/25" : "bg-[#0F0F0F] border-[#252525]"
                  }`}>
                    <span className="font-mono text-[10px] tracking-widest uppercase text-[#555555]">مصاريف الوردية</span>
                    <span className={`font-mono text-sm tabular-nums ${expenses > 0 ? "text-[#FF7A7A]" : "text-[#555555]"}`} dir="ltr">
                      {expenses > 0 ? `−$${expenses.toFixed(2)}` : "$0.00"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 bg-[#F5C100]/5 border border-[#F5C100]/30 rounded-sm">
                    <span className="font-mono text-[10px] tracking-widest uppercase text-[#F5C100]/70">
                      {isLive ? "إجمالي الخزنة المتوقع ($)" : "صافي الربح ($)"}
                    </span>
                    <span className="font-mono text-base text-[#F5C100] tabular-nums" dir="ltr">
                      ${(isLive ? running : expectedAtClose).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="border-t border-[#252525]/60 pt-3 flex flex-wrap gap-6">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">فتح الصندوق</p>
                    <p className="font-mono tabular-nums text-sm text-[#F0EDE6]">${sess.openingCash.toFixed(2)}</p>
                  </div>
                  {!isLive && sess.actualCash != null && (
                    <>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الفعلي بالصندوق</p>
                        <p className="font-mono tabular-nums text-sm text-[#5CC45C]">${sess.actualCash.toFixed(2)}</p>
                      </div>
                      {diff !== null && (
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الفرق</p>
                          <p className={`font-mono tabular-nums text-sm ${diff < 0 ? "text-[#FF3333]" : diff > 0 ? "text-[#F5C100]" : "text-[#5CC45C]"}`}>
                            {diff >= 0 ? "+" : ""}${diff.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {/* Discrepancy note — shown when manager reviews a closed session */}
                {!isLive && sess.discrepancyNote && (
                  <div className="border border-[#F5C100]/20 bg-[#F5C100]/5 rounded-sm px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#F5C100]/60 mb-1">سبب الفرق — بقلم الاستقبال</p>
                    <p className="font-mono text-xs text-[#F0EDE6] leading-relaxed">{sess.discrepancyNote}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Subscriptions log ────────────────────────────────────────────────────────

const SUB_STATUS_COLOR: Record<string, string> = {
  active: "text-[#5CC45C]", expired: "text-[#777777]", frozen: "text-[#AAAAAA]", cancelled: "text-[#FF3333]",
};
const SUB_STATUS_LABEL: Record<string, string> = {
  active: "نشط", expired: "منتهي", frozen: "مجمد", cancelled: "ملغي",
};

function SubscriptionsLog() {
  const { subscriptions } = useStore();
  const sessionLabel = useSessionLabel();
  const profileNames = useProfileNames();
  const sorted = useMemo(
    () => [...subscriptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [subscriptions]
  );

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      {sorted.length === 0 ? (
        <EmptyTable label="لا توجد اشتراكات مسجلة" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <THead cols={["تاريخ التسجيل", "العضو", "الكوتش", "الخطة", "العرض", "المبلغ المدفوع", "الموظف", "الجلسة", "الحالة"]} />
            <tbody className="divide-y divide-[#252525]/60">
              {sorted.map((sub) => (
                <tr key={sub.id} className="hover:bg-[#252525]/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                    {formatDate(sub.createdAt)}{" "}
                    <span className="text-[9px] text-[#555555]">{formatTime(sub.createdAt)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap font-medium">{sub.memberName}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                    {sub.privateCoachName
                      ? <span className="text-[#F5C100]">{sub.privateCoachName}</span>
                      : <span className="text-[#555555]">—</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{getPlanLabel(sub.planType)}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                    {sub.offer === "none"
                      ? <span className="text-[#555555]">—</span>
                      : <span className="text-[#F5C100]">{getOfferLabel(sub.offer)}</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[#5CC45C] whitespace-nowrap">${sub.paidAmount.toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{fmtEmployee(sub.createdBy, profileNames)}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] whitespace-nowrap">{sessionLabel(sub.createdAt)}</td>
                  <td className={`px-4 py-2.5 font-mono text-[10px] whitespace-nowrap ${SUB_STATUS_COLOR[sub.status] ?? "text-[#AAAAAA]"}`}>
                    {SUB_STATUS_LABEL[sub.status] ?? sub.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── InBody log ───────────────────────────────────────────────────────────────

function InBodyLog() {
  const { inBodySessions } = useStore();
  const sessionLabel = useSessionLabel();
  const sorted = useMemo(
    () => [...inBodySessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inBodySessions]
  );

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      {sorted.length === 0 ? (
        <EmptyTable label="لا توجد جلسات InBody" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <THead cols={["تاريخ التسجيل", "الاسم", "عضو / خارجي", "المبلغ المدفوع", "الموظف", "الجلسة", "الحالة"]} />
            <tbody className="divide-y divide-[#252525]/60">
              {sorted.map((s) => {
                return (
                  <tr key={s.id} className={`hover:bg-[#252525]/20 transition-colors ${s.cancelled ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                      {formatDate(s.createdAt)}{" "}
                      <span className="text-[9px] text-[#555555]">{formatTime(s.createdAt)}</span>
                    </td>
                    <td className={`px-4 py-2.5 font-medium whitespace-nowrap ${s.cancelled ? "line-through text-[#777777]" : "text-[#F0EDE6]"}`}>
                      {s.memberName}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">
                      {s.memberType === "gym_member" ? "عضو النادي" : "زيارة خارجية"}
                    </td>
                    <td className={`px-4 py-2.5 font-mono tabular-nums whitespace-nowrap ${s.cancelled ? "line-through text-[#777777]" : "text-[#5CC45C]"}`}>
                      ${s.priceUSD.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{s.createdByName}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] whitespace-nowrap">{sessionLabel(s.createdAt)}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                      {s.cancelled
                        ? <span className="text-[#FF3333]">ملغي</span>
                        : <span className="text-[#5CC45C]">مسجل</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Store dashboard (sales log + inventory) ──────────────────────────────────

type ProdEdit = { cost: string; price: string; stock: string };

function StoreDashboard() {
  const { sales, products, addProduct, updateProductPrice, adjustStock } = useStore();
  const sessionLabel = useSessionLabel();
  const profileNames = useProfileNames();

  // Sales log
  const storeSales = useMemo(
    () => sales
      .filter((s) => !s.isReversal && !s.cancelled && s.source !== "kitchen")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sales]
  );

  // Add form
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<ProductCategory>("protein");
  const [newCost, setNewCost] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState("");
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState("");

  const liveProfit = useMemo(() => {
    const c = parseFloat(newCost), p = parseFloat(newPrice);
    return !isNaN(c) && !isNaN(p) ? p - c : null;
  }, [newCost, newPrice]);

  async function handleAdd() {
    setAddErr(""); setAddOk("");
    if (!newName.trim()) { setAddErr("أدخل اسم المنتج."); return; }
    const c = parseFloat(newCost), p = parseFloat(newPrice), s = parseInt(newStock);
    if (isNaN(c) || c < 0) { setAddErr("السعر الأصلي غير صحيح."); return; }
    if (isNaN(p) || p <= 0) { setAddErr("سعر البيع غير صحيح."); return; }
    if (isNaN(s) || s < 0) { setAddErr("الكمية غير صحيحة."); return; }
    const r = await addProduct({ name: newName.trim(), category: newCat, cost: c, price: p, stock: s, lowStockThreshold: 3 });
    if (r.error) { setAddErr(r.error); return; }
    setNewName(""); setNewCost(""); setNewPrice(""); setNewStock("");
    setAddOk("تمت الإضافة."); setTimeout(() => setAddOk(""), 2000);
  }

  // Inline editing
  const [editRows, setEditRows] = useState<Record<string, ProdEdit>>({});

  function startEdit(p: Product) {
    setEditRows((prev) => ({ ...prev, [p.id]: { cost: p.cost == null ? "" : String(p.cost), price: String(p.price), stock: String(p.stock) } }));
  }
  function cancelEdit(id: string) {
    setEditRows((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }
  async function saveEdit(p: Product) {
    const row = editRows[p.id];
    if (!row) return;
    const c = parseFloat(row.cost), pr = parseFloat(row.price), ns = parseInt(row.stock);
    if (!isNaN(c) && !isNaN(pr) && c >= 0 && pr > 0) {
      const r = await updateProductPrice(p.id, c, pr);
      if (r.error) console.error("updateProductPrice failed:", r.error);
    }
    if (!isNaN(ns) && ns >= 0) void adjustStock(p.id, ns - p.stock);
    cancelEdit(p.id);
  }

  return (
    <div className="space-y-4">
      {/* ── Sales log ── */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[#252525] bg-[#111111]">
          <ShoppingBag size={13} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">مبيعات الاستقبال</p>
          <span className="font-mono text-[10px] text-[#555555]">({storeSales.length} عملية)</span>
        </div>
        {storeSales.length === 0 ? (
          <EmptyTable label="لا توجد مبيعات" />
        ) : (
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <THead cols={["التاريخ", "المنتج", "الكمية", "سعر الوحدة", "الإجمالي", "الموظف", "الجلسة"]} />
              <tbody className="divide-y divide-[#252525]/60">
                {storeSales.map((s) => (
                  <tr key={s.id} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2 font-mono text-[#777777] whitespace-nowrap">
                      {formatDate(s.createdAt)}{" "}
                      <span className="text-[9px] text-[#555555]">{formatTime(s.createdAt)}</span>
                    </td>
                    <td className="px-4 py-2 text-[#F0EDE6] max-w-[180px] truncate">{s.productName}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{s.quantity}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]">${s.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#F5C100]">${s.total.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{fmtEmployee(s.createdBy, profileNames)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#777777] whitespace-nowrap">{sessionLabel(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Inventory management ── */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
          <SubHeader label="إضافة منتج جديد" />
          <div className="flex flex-wrap gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم المنتج" className={`flex-1 min-w-[160px] ${INPUT}`} />
            <select value={newCat} onChange={(e) => setNewCat(e.target.value as ProductCategory)} className={SELECT}>
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{getProductCategoryLabel(c)}</option>)}
            </select>
            <input value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="السعر الأصلي $" type="number" min="0" step="0.01" className={`w-32 ${INPUT}`} />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="سعر البيع $" type="number" min="0" step="0.01" className={`w-32 ${INPUT}`} />
            {liveProfit !== null && (
              <div className="flex items-center px-3 py-1.5 bg-[#111111] border border-[#252525] rounded-sm">
                <span className="font-mono text-[10px] text-[#555555] ml-1.5">ربح:</span>
                <span className={`font-mono tabular-nums text-xs ${liveProfit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}`}>
                  ${liveProfit.toFixed(2)}
                </span>
              </div>
            )}
            <input value={newStock} onChange={(e) => setNewStock(e.target.value)} placeholder="الكمية" type="number" min="0" className={`w-24 ${INPUT}`} />
            <button onClick={handleAdd} className={BTN_ADD}><Plus size={12} />إضافة</button>
          </div>
          {addErr && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{addErr}</p>}
          {addOk  && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{addOk}</p>}
        </div>

        {products.length === 0 ? (
          <EmptyTable label="لا توجد منتجات" />
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <THead cols={["المنتج", "الفئة", "السعر الأصلي", "سعر البيع", "الربح", "المخزون", ""]} />
              </thead>
              <tbody className="divide-y divide-[#252525]/60">
                {products.map((p) => {
                  const editing = editRows[p.id];
                  const profit = p.cost == null ? null : p.price - p.cost;
                  const low = p.stock <= p.lowStockThreshold;
                  return (
                    <tr key={p.id} className="hover:bg-[#252525]/20 transition-colors">
                      <td className="px-4 py-2.5 text-[#F0EDE6] max-w-[180px] truncate">{p.name}</td>
                      <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{getProductCategoryLabel(p.category)}</td>
                      {editing ? (
                        <>
                          <td className="px-4 py-2.5">
                            <input value={editing.cost} onChange={(e) => setEditRows((r) => ({ ...r, [p.id]: { ...r[p.id], cost: e.target.value } }))}
                              type="number" step="0.01" className={`${EDIT_INPUT} text-[#777777]`} />
                          </td>
                          <td className="px-4 py-2.5">
                            <input value={editing.price} onChange={(e) => setEditRows((r) => ({ ...r, [p.id]: { ...r[p.id], price: e.target.value } }))}
                              type="number" step="0.01" className={`${EDIT_INPUT} text-[#F5C100]`} />
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[10px]">
                            {(() => {
                              const diff = parseFloat(editing.price) - parseFloat(editing.cost);
                              return isNaN(diff) ? "—" : <span className={diff >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}>${diff.toFixed(2)}</span>;
                            })()}
                          </td>
                          <td className="px-4 py-2.5">
                            <input value={editing.stock} onChange={(e) => setEditRows((r) => ({ ...r, [p.id]: { ...r[p.id], stock: e.target.value } }))}
                              type="number" min="0" className={`w-16 ${EDIT_INPUT} text-[#AAAAAA]`} />
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => saveEdit(p)} className="text-[#5CC45C] hover:opacity-80 cursor-pointer"><Check size={12} /></button>
                              <button onClick={() => cancelEdit(p.id)} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={12} /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">{p.cost == null ? "—" : `$${p.cost.toFixed(2)}`}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">${p.price.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums text-[10px] ${profit == null ? "text-[#555555]" : profit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}`}>{profit == null ? "—" : `$${profit.toFixed(2)}`}</td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums ${low ? "text-[#FF3333]" : "text-[#AAAAAA]"}`}>
                            {p.stock}{low && <span className="mr-1 text-[9px]">↓</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => startEdit(p)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer">
                              <Edit2 size={11} />
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kitchen dashboard (sales log + food items) ───────────────────────────────

type FoodEdit = { price: string; costSyp: string; costUsd: string };

function KitchenDashboard() {
  const { sales, foodItems, addFoodItem, updateFoodItem, removeFoodItem } = useStore();
  const { exchangeRate, openRateModal } = useCurrency();
  const sessionLabel = useSessionLabel();
  const profileNames = useProfileNames();

  // Kitchen sales log
  const kitchenSales = useMemo(
    () => sales
      .filter((s) => !s.isReversal && !s.cancelled && s.source === "kitchen")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sales]
  );

  // Add form
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<FoodItemCategory>("meals");
  const [newCostSyp, setNewCostSyp] = useState("");
  const [newCostUsd, setNewCostUsd] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState("");

  const liveProfit = useMemo(() => {
    const p = parseFloat(newPrice);
    if (isNaN(p)) return null;
    const cs = parseFloat(newCostSyp);
    const cu = parseFloat(newCostUsd);
    const cost = !isNaN(cs)
      ? cs
      : !isNaN(cu) && exchangeRate > 0
        ? cu * exchangeRate
        : null;
    return cost == null ? null : p - cost;
  }, [newCostSyp, newCostUsd, newPrice, exchangeRate]);

  async function handleAdd() {
    setAddErr(""); setAddOk("");
    if (!newName.trim()) { setAddErr("أدخل اسم الصنف."); return; }
    const p = parseFloat(newPrice);
    if (isNaN(p) || p < 0) { setAddErr("سعر البيع غير صحيح."); return; }
    const cs = parseFloat(newCostSyp);
    const cu = parseFloat(newCostUsd);
    const r = await addFoodItem({
      name: newName.trim(),
      category: newCat,
      price_syp: p,
      cost_syp: !isNaN(cs) ? cs : null,
      cost_usd: !isNaN(cu) ? cu : null,
      is_active: true,
    });
    if (r.error) { setAddErr(r.error); return; }
    setNewName(""); setNewCostSyp(""); setNewCostUsd(""); setNewPrice("");
    setAddOk("تمت الإضافة."); setTimeout(() => setAddOk(""), 2000);
  }

  // Inline editing
  const [foodEdits, setFoodEdits] = useState<Record<string, FoodEdit>>({});

  function startFoodEdit(f: FoodItem) {
    setFoodEdits((prev) => ({
      ...prev,
      [f.id]: {
        price: String(f.price_syp ?? 0),
        costSyp: f.cost_syp != null ? String(f.cost_syp) : f.cost != null ? String(f.cost) : "",
        costUsd: f.cost_usd != null ? String(f.cost_usd) : "",
      },
    }));
  }
  function cancelFoodEdit(id: string) {
    setFoodEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }
  async function saveFoodEdit(f: FoodItem) {
    const row = foodEdits[f.id];
    if (!row) return;
    const updates: Partial<FoodItem> = {};
    const pr = parseFloat(row.price);
    if (!isNaN(pr) && pr >= 0) updates.price_syp = pr;
    // Empty string clears the cost; numeric value sets it.
    if (row.costSyp === "") updates.cost_syp = null;
    else { const c = parseFloat(row.costSyp); if (!isNaN(c)) updates.cost_syp = c; }
    if (row.costUsd === "") updates.cost_usd = null;
    else { const c = parseFloat(row.costUsd); if (!isNaN(c)) updates.cost_usd = c; }
    if (Object.keys(updates).length) {
      const r = await updateFoodItem(f.id, updates);
      if (r.error) {
        // Keep the edit row open so the manager can retry / correct, and
        // surface the actual error instead of silently closing.
        setAddErr(r.error);
        return;
      }
      setAddOk("تم الحفظ.");
      setTimeout(() => setAddOk(""), 2000);
    }
    cancelFoodEdit(f.id);
  }

  return (
    <div className="space-y-4">
      {/* ── Kitchen sales log ── */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[#252525] bg-[#111111]">
          <ChefHat size={13} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">طلبات المطبخ — الاستقبال</p>
          <span className="font-mono text-[10px] text-[#555555]">({kitchenSales.length} طلب)</span>
        </div>
        {kitchenSales.length === 0 ? (
          <EmptyTable label="لا توجد طلبات مطبخ مسجلة" />
        ) : (
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <THead cols={["التاريخ", "الصنف", "الكمية", "سعر الوحدة", "الإجمالي", "الموظف", "الجلسة"]} />
              <tbody className="divide-y divide-[#252525]/60">
                {kitchenSales.map((s) => (
                  <tr key={s.id} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2 font-mono text-[#777777] whitespace-nowrap">
                      {formatDate(s.createdAt)}{" "}
                      <span className="text-[9px] text-[#555555]">{formatTime(s.createdAt)}</span>
                    </td>
                    <td className="px-4 py-2 text-[#F0EDE6]">{s.productName}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{s.quantity}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">{s.currency === "syp" ? `${Math.round(s.unitPrice).toLocaleString("ar-SY")} ل.س` : `$${s.unitPrice.toFixed(2)}`}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#F5C100]" dir="ltr">{s.currency === "syp" ? `${Math.round(s.total).toLocaleString("ar-SY")} ل.س` : `$${s.total.toFixed(2)}`}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{fmtEmployee(s.createdBy, profileNames)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#777777] whitespace-nowrap">{sessionLabel(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Food items management ── */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">سعر الصرف الحالي</p>
          <button onClick={openRateModal} className="font-mono tabular-nums text-xs text-[#F5C100] hover:underline cursor-pointer" dir="ltr">
            1$ = {Math.round(exchangeRate).toLocaleString("en-US")} ل.س
          </button>
        </div>
        <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
          <SubHeader label="إضافة صنف جديد للمطبخ" />
          <div className="flex flex-wrap gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم الصنف" className={`flex-1 min-w-[140px] ${INPUT}`} />
            <select value={newCat} onChange={(e) => setNewCat(e.target.value as FoodItemCategory)} className={SELECT}>
              {FOOD_CATEGORIES.map((c) => <option key={c} value={c}>{FOOD_CAT_LABELS[c]}</option>)}
            </select>
            <input value={newCostSyp} onChange={(e) => setNewCostSyp(e.target.value)} placeholder="تكلفة (ل.س)" type="number" min="0" step="1" className={`w-36 ${INPUT}`} />
            <input value={newCostUsd} onChange={(e) => setNewCostUsd(e.target.value)} placeholder="تكلفة ($)" type="number" min="0" step="0.01" className={`w-32 ${INPUT}`} />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="السعر (ل.س)" type="number" min="0" step="1" className={`w-36 ${INPUT}`} />
            {liveProfit !== null && (
              <div className="flex items-center px-3 py-1.5 bg-[#111111] border border-[#252525] rounded-sm">
                <span className="font-mono text-[10px] text-[#555555] ml-1.5">ربح:</span>
                <span className={`font-mono tabular-nums text-xs ${liveProfit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}`}>
                  {Math.round(liveProfit).toLocaleString("ar-SY")} ل.س
                </span>
              </div>
            )}
            <button onClick={handleAdd} className={BTN_ADD}><Plus size={12} />إضافة</button>
          </div>
          {addErr && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{addErr}</p>}
          {addOk  && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{addOk}</p>}
        </div>

        {foodItems.length === 0 ? (
          <EmptyTable label="لا توجد أصناف" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <THead cols={["الاسم", "تكلفة (ل.س)", "تكلفة ($)", "سعر البيع (ل.س)", "الربح", "الهامش", "الفئة", "المخزون", "الحالة", ""]} />
              <tbody className="divide-y divide-[#252525]/60">
                {foodItems.map((item) => {
                  const editing = foodEdits[item.id];
                  const effCost = effectiveCostSYP(item, exchangeRate);
                  const profit  = effCost != null ? item.price_syp - effCost : null;
                  const margin  = profit != null && item.price_syp > 0 ? (profit / item.price_syp) * 100 : null;
                  return (
                    <tr key={item.id} className={`hover:bg-[#252525]/20 transition-colors ${!item.is_active ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 text-[#F0EDE6]">
                        {item.name}
                        {item.description && (
                          <span className="block font-mono text-[9px] text-[#555555] mt-0.5">{item.description}</span>
                        )}
                      </td>
                      {editing ? (
                        <>
                          <td className="px-4 py-2.5">
                            <input value={editing.costSyp} onChange={(e) => setFoodEdits((r) => ({ ...r, [item.id]: { ...r[item.id], costSyp: e.target.value } }))}
                              type="number" step="1" placeholder="—" className={`${EDIT_INPUT} text-[#777777]`} />
                          </td>
                          <td className="px-4 py-2.5">
                            <input value={editing.costUsd} onChange={(e) => setFoodEdits((r) => ({ ...r, [item.id]: { ...r[item.id], costUsd: e.target.value } }))}
                              type="number" step="0.01" placeholder="—" className={`${EDIT_INPUT} text-[#777777]`} />
                          </td>
                          <td className="px-4 py-2.5">
                            <input value={editing.price} onChange={(e) => setFoodEdits((r) => ({ ...r, [item.id]: { ...r[item.id], price: e.target.value } }))}
                              type="number" step="1" className={`${EDIT_INPUT} text-[#F5C100]`} />
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[10px]">
                            {(() => {
                              const pr = parseFloat(editing.price);
                              const cs = parseFloat(editing.costSyp);
                              const cu = parseFloat(editing.costUsd);
                              const c  = !isNaN(cs) ? cs : !isNaN(cu) && exchangeRate > 0 ? cu * exchangeRate : NaN;
                              if (isNaN(pr) || isNaN(c)) return "—";
                              const diff = pr - c;
                              return <span className={diff >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}>{Math.round(diff).toLocaleString("ar-SY")} ل.س</span>;
                            })()}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[10px] text-[#777777]">—</td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA]">{FOOD_CAT_LABELS[item.category]}</td>
                          <td className="px-4 py-2.5">
                            <StockCell item={item} onChange={(n) => void updateFoodItem(item.id, { stock_quantity: n })} />
                          </td>
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => void saveFoodEdit(item)} className="text-[#5CC45C] hover:opacity-80 cursor-pointer"><Check size={12} /></button>
                              <button onClick={() => cancelFoodEdit(item.id)} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={12} /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">
                            {item.cost_syp != null ? `${Math.round(item.cost_syp).toLocaleString("ar-SY")} ل.س` : "—"}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]" dir="ltr">
                            {item.cost_usd != null ? `$${Number(item.cost_usd).toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">
                            {item.price_syp > 0 ? `${Math.round(item.price_syp).toLocaleString("ar-SY")} ل.س` : "—"}
                          </td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums text-[10px] ${profit != null ? (profit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]") : "text-[#555555]"}`}>
                            {profit != null ? `${Math.round(profit).toLocaleString("ar-SY")} ل.س` : "—"}
                          </td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums text-[10px] ${margin != null ? (margin >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]") : "text-[#555555]"}`}>
                            {margin != null ? `${margin.toFixed(1)}%` : "—"}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA]">{FOOD_CAT_LABELS[item.category]}</td>
                          <td className="px-4 py-2.5">
                            <StockCell item={item} onChange={(n) => void updateFoodItem(item.id, { stock_quantity: n })} />
                          </td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => void updateFoodItem(item.id, { is_active: !item.is_active })}
                              className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${item.is_active ? "text-[#5CC45C] border-[#5CC45C]/30 bg-[#5CC45C]/10" : "text-[#777777] border-[#555555]/30"}`}>
                              {item.is_active ? "مفعل" : "متوقف"}
                            </button>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => startFoodEdit(item)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"><Edit2 size={11} /></button>
                              <button
                                onClick={async () => {
                                  if (!window.confirm(`هل أنت متأكد من حذف ${item.name}؟`)) return;
                                  await removeFoodItem(item.id);
                                }}
                                className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Expenses manager ─────────────────────────────────────────────────────────

// Time-of-day label derived from Asia/Damascus hour:
//   05:00–11:59 → صباحاً
//   12:00–16:59 → ظهراً
//   17:00–20:59 → مساءً
//   21:00–04:59 → ليلاً
function shiftLabel(createdAt: string): string {
  try {
    const hh = new Date(createdAt).toLocaleString("en-GB", {
      timeZone: "Asia/Damascus",
      hour: "2-digit",
      hour12: false,
    });
    const h = parseInt(hh, 10);
    if (!Number.isFinite(h)) return "";
    if (h >= 5  && h < 12) return "صباحاً";
    if (h >= 12 && h < 17) return "ظهراً";
    if (h >= 17 && h < 21) return "مساءً";
    return "ليلاً";
  } catch {
    return "";
  }
}

function ExpensesManager() {
  const { expenses, addExpense, updateExpenseLocal, removeExpenseLocal } = useStore();
  const { user } = useAuth();
  const { exchangeRate } = useCurrency();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("salaries");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("usd");
  const [frequency, setFrequency] = useState<ExpenseFrequency>("monthly");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState<ExpenseCategory>("salaries");
  const [editAmount, setEditAmount] = useState("");
  const [editCurrency, setEditCurrency] = useState<Currency>("usd");
  const [editFrequency, setEditFrequency] = useState<ExpenseFrequency>("one_time");
  const [editReceiptNumber, setEditReceiptNumber] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Exclude rows mirrored from a purchase invoice — those show under the
  // Purchases section. Their amounts still count in totals / cash close.
  const sorted = useMemo(
    () => expenses
      .filter((e) => e.purchaseInvoiceId == null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [expenses]
  );
  // Totals tracked per currency so reception-entered SYP rows aren't summed
  // alongside manager USD entries as if they were the same number.
  const totals = useMemo(() => {
    let usd = 0, syp = 0;
    for (const e of sorted) {
      if ((e.currency ?? "usd") === "syp") syp += e.amount;
      else usd += e.amount;
    }
    return { usd, syp };
  }, [sorted]);

  async function handleAdd() {
    setError(""); setSuccess("");
    if (!description.trim()) { setError("أدخل وصف المصروف."); return; }
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) { setError("المبلغ غير صحيح."); return; }
    if (!user) return;
    const r = await pushExpense({
      user: { id: user.id, displayName: user.displayName },
      description: description.trim(),
      amount: a,
      currency,
      category,
      exchangeRate,
      receiptNumber: receiptNumber.trim() || null,
      source: "manager",
    });
    if (r.error) { setError(r.error); return; }
    const row = r.data!;
    const full: Expense = {
      id: String(row.id),
      description: description.trim(),
      category,
      amount: a,
      paymentMethod: "cash",
      currency,
      frequency,
      date: new Date().toISOString().slice(0, 10),
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      createdByName: user.displayName,
      receiptNumber: receiptNumber.trim() || null,
      source: "manager",
    };
    addExpense(full);
    setDescription(""); setAmount(""); setReceiptNumber("");
    setSuccess("تم تسجيل المصروف."); setTimeout(() => setSuccess(""), 2000);
  }

  function startEdit(expense: Expense) {
    setError("");
    setSuccess("");
    setEditingId(expense.id);
    setEditDescription(expense.description);
    setEditCategory(expense.category);
    setEditAmount(String(expense.amount));
    setEditCurrency((expense.currency ?? "usd") as Currency);
    setEditFrequency(expense.frequency ?? "one_time");
    setEditReceiptNumber(expense.receiptNumber ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDescription("");
    setEditAmount("");
    setEditCurrency("usd");
    setEditFrequency("one_time");
    setEditCategory("salaries");
    setEditReceiptNumber("");
  }

  async function handleSaveEdit(expense: Expense) {
    setError("");
    setSuccess("");
    if (!user) return;
    if (!window.confirm("Are you sure you want to edit this expense?")) return;
    const nextDescription = editDescription.trim();
    const nextAmount = parseFloat(editAmount);
    if (!nextDescription) { setError("أدخل وصف المصروف."); return; }
    if (isNaN(nextAmount) || nextAmount <= 0) { setError("المبلغ غير صحيح."); return; }
    const r = await updateExpense({
      user: { id: user.id, displayName: user.displayName },
      id: expense.id,
      description: nextDescription,
      amount: nextAmount,
      currency: editCurrency,
      category: editCategory,
      exchangeRate,
      receiptNumber: editReceiptNumber.trim() || null,
    });
    if (r.error) { setError(r.error); return; }
    updateExpenseLocal(expense.id, {
      description: nextDescription,
      amount: nextAmount,
      currency: editCurrency,
      category: editCategory,
      frequency: editFrequency,
      receiptNumber: editReceiptNumber.trim() || null,
    });
    cancelEdit();
    setSuccess("تم تعديل المصروف.");
    setTimeout(() => setSuccess(""), 2000);
  }

  async function handleDelete(expense: Expense) {
    setError("");
    setSuccess("");
    if (!user) return;
    if (!window.confirm("Are you sure you want to delete this expense?")) return;
    const r = await cancelTransaction({
      user: { id: user.id, displayName: user.displayName },
      table: "expenses",
      id: expense.id,
      reason: "deleted from manager expenses tab",
    });
    if (r.error) { setError(r.error); return; }
    removeExpenseLocal(expense.id);
    if (editingId === expense.id) cancelEdit();
    setSuccess("تم حذف المصروف.");
    setTimeout(() => setSuccess(""), 2000);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
        <SubHeader label="تسجيل مصروف" />
        <div className="flex flex-wrap gap-2">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="الوصف / الاسم" className={`flex-1 min-w-[160px] ${INPUT}`} />
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={SELECT}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{getCategoryLabel(c)}</option>)}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={currency === "syp" ? "المبلغ ل.س" : "المبلغ $"}
            type="number" min="0" step={currency === "syp" ? "1" : "0.01"}
            className={`w-32 ${INPUT}`}
          />
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={SELECT}>
            <option value="usd">$</option>
            <option value="syp">ل.س</option>
          </select>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as ExpenseFrequency)} className={SELECT}>
            {(["monthly", "weekly", "daily", "one_time"] as ExpenseFrequency[]).map((f) => (
              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
            ))}
          </select>
          <input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} placeholder="رقم الإيصال (اختياري)" className={`w-40 ${INPUT}`} />
          <button onClick={handleAdd} className={BTN_ADD}><Plus size={12} />تسجيل</button>
        </div>
        {error   && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
        {success && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{success}</p>}
      </div>

      {sorted.length === 0 ? (
        <EmptyTable label="لا توجد مصاريف مسجلة" />
      ) : (
        <>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <THead className="sticky top-0" cols={["التاريخ", "الوصف", "ملاحظة", "الإيصال", "الفئة", "المبلغ", "المصدر", "التكرار", ""]} />
              <tbody className="divide-y divide-[#252525]/60">
                {sorted.map((exp) => {
                  const editing = editingId === exp.id;
                  const isReception = exp.source === "reception_daily";
                  const expCurrency = (exp.currency ?? "usd") as Currency;
                  const amountText = expCurrency === "syp"
                    ? `${Math.round(exp.amount).toLocaleString("en-US")} ل.س`
                    : `$${exp.amount.toFixed(2)}`;
                  const receptionName = exp.createdByName ?? "—";
                  const shift = shiftLabel(exp.createdAt);
                  return (
                    <tr
                      key={exp.id}
                      className={[
                        "transition-colors",
                        isReception
                          ? "bg-[#F5C100]/5 hover:bg-[#F5C100]/10 border-r-2 border-r-[#F5C100]/40"
                          : "hover:bg-[#252525]/20",
                      ].join(" ")}
                    >
                      <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                        {formatDate(exp.createdAt)}
                        <span className="block text-[9px] text-[#555555]">{formatTime(exp.createdAt)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[#F0EDE6]">
                        {editing ? (
                          <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className={`min-w-[160px] ${INPUT}`} />
                        ) : exp.description}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] max-w-[220px] truncate">
                        {exp.note ? exp.note : <span className="text-[#555555]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">
                        {editing ? (
                          <input value={editReceiptNumber} onChange={(e) => setEditReceiptNumber(e.target.value)} placeholder="—" className={`w-28 ${INPUT}`} />
                        ) : exp.receiptNumber ? exp.receiptNumber : <span className="text-[#555555]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">
                        {editing ? (
                          <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as ExpenseCategory)} className={SELECT}>
                            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{getCategoryLabel(c)}</option>)}
                          </select>
                        ) : getCategoryLabel(exp.category)}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-[#FF3333] whitespace-nowrap" dir="ltr">
                        {editing ? (
                          <div className="flex items-center gap-1">
                            <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} type="number" min="0" step={editCurrency === "syp" ? "1" : "0.01"} className={`w-28 ${INPUT}`} />
                            <select value={editCurrency} onChange={(e) => setEditCurrency(e.target.value as Currency)} className={SELECT}>
                              <option value="usd">$</option>
                              <option value="syp">ل.س</option>
                            </select>
                          </div>
                        ) : amountText}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                        {isReception ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F5C100]/15 border border-[#F5C100]/40 rounded text-[#F5C100]">
                            <span>من الاستقبال — {receptionName}</span>
                            {shift && <span className="text-[#F5C100]/70">· {shift}</span>}
                          </span>
                        ) : (
                          <span className="text-[#777777]">المدير{exp.createdByName ? ` — ${exp.createdByName}` : ""}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] whitespace-nowrap">
                        {editing ? (
                          <select value={editFrequency} onChange={(e) => setEditFrequency(e.target.value as ExpenseFrequency)} className={SELECT}>
                            {(["monthly", "weekly", "daily", "one_time"] as ExpenseFrequency[]).map((f) => (
                              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                            ))}
                          </select>
                        ) : exp.frequency ? FREQ_LABELS[exp.frequency] : "مرة واحدة"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {editing ? (
                            <>
                              <button onClick={() => void handleSaveEdit(exp)} className="p-1 text-[#5CC45C] hover:text-[#7DDE7D] cursor-pointer" title="حفظ التعديل">
                                <Check size={12} />
                              </button>
                              <button onClick={cancelEdit} className="p-1 text-[#777777] hover:text-[#FF3333] cursor-pointer" title="إلغاء التعديل">
                                <X size={12} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(exp)} className="p-1 text-[#777777] hover:text-[#F5C100] cursor-pointer" title="تعديل">
                                <Edit2 size={12} />
                              </button>
                              <button onClick={() => void handleDelete(exp)} className="p-1 text-[#777777] hover:text-[#FF3333] cursor-pointer" title="حذف">
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#252525] px-5 py-3 flex items-center justify-between bg-[#111111]/60">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الإجمالي المسجل</span>
            <div className="flex items-center gap-3" dir="ltr">
              {totals.usd > 0 && (
                <span className="font-mono tabular-nums text-sm text-[#FF3333]">${totals.usd.toFixed(2)}</span>
              )}
              {totals.syp > 0 && (
                <span className="font-mono tabular-nums text-sm text-[#FF7A7A]">
                  {Math.round(totals.syp).toLocaleString("en-US")} ل.س
                </span>
              )}
              {totals.usd <= 0 && totals.syp <= 0 && (
                <span className="font-mono tabular-nums text-sm text-[#777777]">—</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── New manager overview blocks (KPI redesign) ──────────────────────────────

function fmtSYP(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("en-US")} ل.س`;
}
function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

const PLAN_AR: Record<string, string> = {
  daily: "يومي", "15_days": "١٥ يوم", "1_month": "شهر",
  "3_months": "٣ أشهر", "6_months": "٦ أشهر",
  "9_months": "٩ أشهر", "12_months": "١٢ شهر",
  custom: "مخصص",
  other: "أخرى",
};

function SummaryCard({
  label, syp, usd, icon, accent = "default", subtitle, badge, skipped,
}: {
  label: string;
  syp: number;
  usd?: number;
  icon: React.ReactNode;
  accent?: "default" | "gold" | "green" | "red";
  subtitle?: string;
  badge?: React.ReactNode;
  skipped?: number;
}) {
  const valueColor =
    accent === "gold" ? "text-[#F5C100]" :
    accent === "green" ? "text-[#5CC45C]" :
    accent === "red" ? "text-[#FF3333]" : "text-[#F0EDE6]";
  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[#777777]">{icon}</span>
        {badge ?? null}
      </div>
      <p className={`font-display text-xl leading-none tabular-nums tracking-wide ${valueColor}`} dir="ltr">
        {fmtSYP(syp)}
      </p>
      {usd != null && (
        <p className="font-mono text-[10px] tabular-nums text-[#777777]" dir="ltr">{fmtUSD(usd)}</p>
      )}
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] truncate">
        {label}
        {subtitle ? ` — ${subtitle}` : ""}
      </p>
      {skipped != null && skipped > 0 && (
        <p className="font-mono text-[9px] text-[#FF7A00]" title="صفوف تم استبعادها من الإجمالي بالدولار بسبب سعر صرف مفقود">
          ⚠ {skipped} صفوف بدون سعر صرف
        </p>
      )}
    </div>
  );
}

function CountCard({
  label, value, icon, accent = "default", subtitle, badge,
}: {
  label: string; value: number; icon: React.ReactNode;
  accent?: "default" | "gold" | "green" | "red";
  subtitle?: string;
  badge?: React.ReactNode;
}) {
  const valueColor =
    accent === "gold" ? "text-[#F5C100]" :
    accent === "green" ? "text-[#5CC45C]" :
    accent === "red" ? "text-[#FF3333]" : "text-[#F0EDE6]";
  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[#777777]">{icon}</span>
        {badge ?? null}
      </div>
      <p className={`font-display text-2xl leading-none tabular-nums tracking-wide ${valueColor}`}>
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] truncate">
        {label}
        {subtitle ? ` — ${subtitle}` : ""}
      </p>
    </div>
  );
}

function DateRangePicker({
  range, setRange,
}: {
  range: ManagerDateRange;
  setRange: (r: ManagerDateRange) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState(range.startDate);
  const [customEnd,   setCustomEnd]   = useState(range.endDate);

  const presets: { id: DateRangePreset; label: string }[] = [
    { id: "today", label: "اليوم" },
    { id: "week",  label: "هذا الأسبوع" },
    { id: "month", label: "هذا الشهر" },
  ];

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-4 py-3 flex flex-wrap items-center gap-2">
      <Calendar size={14} className="text-[#F5C100]" />
      <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555] ml-2">الفترة</span>
      {presets.map((p) => {
        const active = range.preset === p.id;
        return (
          <button
            key={p.id}
            onClick={() => setRange(makeDateRange(p.id))}
            className={`px-3 py-1 rounded-sm border font-mono text-[11px] cursor-pointer transition-colors ${
              active
                ? "bg-[#F5C100]/15 border-[#F5C100]/40 text-[#F5C100]"
                : "border-[#252525] text-[#AAAAAA] hover:border-[#555555]"
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <button
        onClick={() => setCustomOpen((v) => !v)}
        className={`px-3 py-1 rounded-sm border font-mono text-[11px] cursor-pointer transition-colors ${
          range.preset === "custom"
            ? "bg-[#F5C100]/15 border-[#F5C100]/40 text-[#F5C100]"
            : "border-[#252525] text-[#AAAAAA] hover:border-[#555555]"
        }`}
      >
        مخصص
      </button>
      {customOpen && (
        <div className="flex items-center gap-2 mr-2">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
            className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-[11px] text-[#F0EDE6]" />
          <span className="text-[#555555] font-mono text-xs">→</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
            className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-[11px] text-[#F0EDE6]" />
          <button
            onClick={() => {
              if (!customStart || !customEnd || customStart > customEnd) return;
              setRange(makeDateRange("custom", { startDate: customStart, endDate: customEnd }));
              setCustomOpen(false);
            }}
            className="px-3 py-1 bg-[#F5C100] text-[#0A0A0A] font-display text-[11px] tracking-widest rounded-sm cursor-pointer"
          >
            تطبيق
          </button>
        </div>
      )}
      <span className="mr-auto font-mono text-[10px] text-[#555555]">
        {range.startDate} → {range.endDate}
      </span>
    </div>
  );
}

function bucketSkipped(b: CurrencyBucket | undefined): number | undefined {
  return b?.skippedUSD && b.skippedUSD > 0 ? b.skippedUSD : undefined;
}

function RevenueSummaryCards({
  loading, summary,
}: {
  loading: boolean;
  summary: ReturnType<typeof useManagerOverview>["summary"];
}) {
  if (loading && !summary) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="bg-[#1A1A1A] border border-[#252525] rounded-sm p-3 h-[88px] animate-pulse" />
        ))}
      </div>
    );
  }
  if (!summary) return null;
  const s = summary;
  const otherIncome = bucketSum(s.store, s.kitchen);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2">
      <SummaryCard
        label="إجمالي الإيرادات" syp={s.totalRevenue.syp} usd={s.totalRevenue.usd}
        icon={<DollarSign size={14} />} accent="gold"
        skipped={bucketSkipped(s.totalRevenue)}
      />
      <SummaryCard
        label="إيرادات الاشتراكات" syp={s.subscriptions.syp} usd={s.subscriptions.usd}
        icon={<Users size={14} />} skipped={bucketSkipped(s.subscriptions)}
      />
      <SummaryCard
        label="InBody" syp={s.inbody.syp} usd={s.inbody.usd}
        icon={<Dumbbell size={14} />} skipped={bucketSkipped(s.inbody)}
      />
      <SummaryCard
        label="إيرادات أخرى" syp={otherIncome.syp} usd={otherIncome.usd}
        icon={<ShoppingBag size={14} />} subtitle="متجر + مطبخ"
        skipped={bucketSkipped(otherIncome)}
      />
      <SummaryCard
        label="جلسات خاصة" syp={s.privateSessions.syp} usd={s.privateSessions.usd}
        icon={<Activity size={14} />} subtitle="ضمن الاشتراكات"
        skipped={bucketSkipped(s.privateSessions)}
      />
      <SummaryCard
        label="المصاريف" syp={s.expenses.syp} usd={s.expenses.usd}
        icon={<TrendingDown size={14} />} accent="red"
        skipped={bucketSkipped(s.expenses)}
      />
      <SummaryCard
        label="صافي الدخل" syp={s.netIncome.syp} usd={s.netIncome.usd}
        icon={<TrendingUp size={14} />}
        accent={s.netIncome.syp >= 0 ? "green" : "red"}
        skipped={bucketSkipped(s.netIncome)}
      />
      <CountCard
        label="Total Members / إجمالي الأعضاء" value={s.totalMembers}
        icon={<Users size={14} />}
        subtitle="نفس رقم الاشتراكات في الاستقبال"
      />
      <CountCard
        label="أعضاء نشطون" value={s.activeMembers.distinct}
        icon={<Users size={14} />}
        subtitle={s.activeMembers.unattached > 0 ? `${s.activeMembers.unattached} بدون member_id` : undefined}
      />
    </div>
  );
}

function bucketSum(...xs: CurrencyBucket[]): CurrencyBucket {
  return xs.reduce((acc, x) => ({
    syp: acc.syp + x.syp,
    usd: acc.usd + x.usd,
    skippedUSD: acc.skippedUSD + x.skippedUSD,
  }), { syp: 0, usd: 0, skippedUSD: 0 });
}

function CashOnHandRow({ summary }: { summary: ReturnType<typeof useManagerOverview>["summary"] }) {
  if (!summary) return null;
  const c = summary.cashOnHand;
  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm p-4 flex flex-wrap items-center gap-6">
      <div className="flex items-center gap-2">
        <Banknote size={16} className="text-[#F5C100]" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">النقد في الخزنة</span>
      </div>
      {c.hasOpenSession ? (
        <>
          <div>
            <p className="font-display text-xl text-[#F5C100] tabular-nums" dir="ltr">{fmtSYP(c.syp)}</p>
            <p className="font-mono text-[10px] text-[#777777]" dir="ltr">{fmtUSD(c.usd)}</p>
          </div>
          <span className="font-mono text-[10px] text-[#555555]">
            (افتتاحي + دخل الجلسة − مصاريف الجلسة)
          </span>
        </>
      ) : (
        <span className="font-mono text-xs text-[#777777]">لا توجد جلسة نقدية مفتوحة</span>
      )}
      <div className="mr-auto flex items-center gap-2">
        <CreditCard size={14} className="text-[#777777]" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">غير مكتمل الدفع</span>
        <span className="font-display text-sm text-[#F5C100] tabular-nums">{summary.partiallyPaid.count}</span>
        {summary.partiallyPaid.remainingSYP > 0 && (
          <span className="font-mono text-[10px] text-[#777777]" dir="ltr">
            متبقي {fmtSYP(summary.partiallyPaid.remainingSYP)}
          </span>
        )}
      </div>
    </div>
  );
}

function SubscriptionRevenueSection({
  loading, subs,
}: {
  loading: boolean;
  subs: ReturnType<typeof useManagerOverview>["subs"];
}) {
  if (loading && !subs) return <div className="font-mono text-[10px] text-[#555555]">جاري التحميل…</div>;
  if (!subs) return null;
  const t = subs.totals;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        <SummaryCard label="شهري"        syp={t.monthlySYP}    icon={<Calendar size={14} />} />
        <SummaryCard label="متعدد الأشهر" syp={t.multiMonthSYP} icon={<Calendar size={14} />} />
        <SummaryCard label="بعروض"       syp={t.offerSYP}      icon={<TrendingUp size={14} />} accent="gold" />
        <SummaryCard label="بدون عروض"   syp={t.normalSYP}     icon={<Users size={14} />} />
        <SummaryCard label="متبقي جزئي"  syp={t.partialRemainingSYP} icon={<CreditCard size={14} />} accent="gold" />
        <SummaryCard label="متبقي غير مدفوع" syp={t.unpaidRemainingSYP} icon={<AlertTriangle size={14} />} accent="red" />
      </div>

      {/* Plan-type breakdown */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-2 border-b border-[#252525] bg-[#111111]">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تفصيل حسب الخطة</p>
        </div>
        {subs.byPlanType.length === 0 ? (
          <EmptyTable label="لا توجد اشتراكات في هذه الفترة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <THead cols={["الخطة", "العدد", "أعضاء فريدون", "إجمالي مدفوع", "متوسط مدفوع", "جزئي", "غير مدفوع"]} />
              <tbody className="divide-y divide-[#252525]/60">
                {subs.byPlanType.map((p: PlanRow) => (
                  <tr key={p.plan} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2.5 text-[#F0EDE6]">{PLAN_AR[p.plan] ?? p.plan}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA]">{p.count}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA]">{p.members}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]" dir="ltr">{fmtSYP(p.paidSYP)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]" dir="ltr">{fmtSYP(p.avgPaidSYP)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">{p.partialCount}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#FF3333]">{p.unpaidCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Offer breakdown */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-2 border-b border-[#252525] bg-[#111111]">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تفصيل حسب العرض</p>
        </div>
        {subs.byOffer.length === 0 ? (
          <EmptyTable label="لا توجد بيانات عروض" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <THead cols={["العرض", "العدد", "إجمالي مدفوع"]} />
              <tbody className="divide-y divide-[#252525]/60">
                {subs.byOffer.map((o: OfferRow) => (
                  <tr key={o.offer} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2.5 text-[#F0EDE6]">{getOfferLabel(o.offer as Parameters<typeof getOfferLabel>[0]) ?? o.offer}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA]">{o.count}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]" dir="ltr">{fmtSYP(o.paidSYP)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCategoriesSection({
  loading, members,
}: {
  loading: boolean;
  members: ReturnType<typeof useManagerOverview>["members"];
}) {
  if (loading && !members) return <div className="font-mono text-[10px] text-[#555555]">جاري التحميل…</div>;
  if (!members) return null;
  const m = members;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2">
        <CountCard label="نشطون"             value={m.totalActive}      icon={<Users size={14} />} accent="green" />
        <CountCard label="مجمدون"            value={m.frozen}           icon={<Snowflake size={14} />} />
        <CountCard label="منتهون"            value={m.expired}          icon={<CalendarX size={14} />} accent={m.expired > 0 ? "red" : "default"} />
        <CountCard label="ينتهون هذا الأسبوع" value={m.expiringThisWeek} icon={<CalendarClock size={14} />} accent={m.expiringThisWeek > 0 ? "gold" : "default"} />
        <CountCard label="عروض متعددة الأشهر" value={m.multiMonthOfferTotal} icon={<TrendingUp size={14} />} accent="gold" />
        <CountCard label="شهري عادي"          value={m.monthlyNormal}    icon={<Calendar size={14} />} />
        <CountCard label="شهري بعرض"          value={m.monthlyOffer}     icon={<Calendar size={14} />} accent="gold" />
        <CountCard label="بدون member_id"     value={m.unattachedActive} icon={<AlertTriangle size={14} />} accent={m.unattachedActive > 0 ? "red" : "default"} />
      </div>

      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-2 border-b border-[#252525] bg-[#111111]">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تفصيل النشطين حسب الخطة (أعضاء فريدون)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <THead cols={["الخطة", "بدون عرض", "بعرض", "الإجمالي"]} />
            <tbody className="divide-y divide-[#252525]/60">
              <PlanCategoryRow label="شهر"     normal={m.monthlyNormal}    offer={m.monthlyOffer} />
              <PlanCategoryRow label="٣ أشهر"  normal={m.threeMonthNormal} offer={m.threeMonthOffer} />
              <PlanCategoryRow label="٦ أشهر"  normal={m.sixMonthNormal}   offer={m.sixMonthOffer} />
              <PlanCategoryRow label="٩ أشهر"  normal={m.nineMonthNormal}  offer={m.nineMonthOffer} />
              <PlanCategoryRow label="١٢ شهر"  normal={m.yearlyNormal}     offer={m.yearlyOffer} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PlanCategoryRow({ label, normal, offer }: { label: string; normal: number; offer: number }) {
  return (
    <tr className="hover:bg-[#252525]/20 transition-colors">
      <td className="px-4 py-2.5 text-[#F0EDE6]">{label}</td>
      <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA]">{normal}</td>
      <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">{offer}</td>
      <td className="px-4 py-2.5 font-mono tabular-nums text-[#5CC45C]">{normal + offer}</td>
    </tr>
  );
}

function OtherIncomeSection({
  loading, other,
}: {
  loading: boolean;
  other: ReturnType<typeof useManagerOverview>["other"];
}) {
  if (loading && !other) return <div className="font-mono text-[10px] text-[#555555]">جاري التحميل…</div>;
  if (!other) return null;
  const o = other;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryCard label="InBody — الإجمالي" syp={o.inbody.bucket.syp} usd={o.inbody.bucket.usd}
          icon={<Dumbbell size={14} />} subtitle={`${o.inbody.sessionCount} جلسة`}
          skipped={bucketSkipped(o.inbody.bucket)} />
        <SummaryCard label="مطبخ" syp={o.kitchen.bucket.syp} usd={o.kitchen.bucket.usd}
          icon={<ChefHat size={14} />} subtitle={`${o.kitchen.orderCount} طلب`}
          skipped={bucketSkipped(o.kitchen.bucket)} />
        <SummaryCard label="متجر" syp={o.store.bucket.syp} usd={o.store.bucket.usd}
          icon={<Package size={14} />} subtitle={`${o.store.saleCount} عملية بيع`}
          skipped={bucketSkipped(o.store.bucket)} />
        <SummaryCard label="جلسات خاصة" syp={o.privateSessions.bucket.syp} usd={o.privateSessions.bucket.usd}
          icon={<Activity size={14} />} subtitle={`${o.privateSessions.sessionCount} جلسة`}
          skipped={bucketSkipped(o.privateSessions.bucket)} />
      </div>
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-3 flex flex-wrap gap-6 font-mono text-[11px]">
        <div>
          <span className="text-[#555555] uppercase tracking-widest text-[10px]">جلسات الأعضاء</span>
          <span className="mr-2 text-[#F0EDE6] tabular-nums">{o.inbody.gymMember}</span>
        </div>
        <div>
          <span className="text-[#555555] uppercase tracking-widest text-[10px]">زيارات خارجية</span>
          <span className="mr-2 text-[#F0EDE6] tabular-nums">{o.inbody.nonMember}</span>
        </div>
        <div>
          <span className="text-[#555555] uppercase tracking-widest text-[10px]">جلسات باقات (legacy)</span>
          <span className="mr-2 text-[#F0EDE6] tabular-nums">{o.inbody.packageSessions}</span>
        </div>
        <div>
          <span className="text-[#555555] uppercase tracking-widest text-[10px]">حصة النادي من الخاص</span>
          <span className="mr-2 text-[#5CC45C] tabular-nums" dir="ltr">{fmtUSD(o.privateSessions.gymShare.usd)}</span>
        </div>
        <div>
          <span className="text-[#555555] uppercase tracking-widest text-[10px]">حصة الكوتش من الخاص</span>
          <span className="mr-2 text-[#F5C100] tabular-nums" dir="ltr">{fmtUSD(o.privateSessions.coachShare.usd)}</span>
        </div>
      </div>
    </div>
  );
}

function ExpensesNetSection({
  loading, expenses, summary,
}: {
  loading: boolean;
  expenses: ReturnType<typeof useManagerOverview>["expenses"];
  summary: ReturnType<typeof useManagerOverview>["summary"];
}) {
  if (loading && !expenses) return <div className="font-mono text-[10px] text-[#555555]">جاري التحميل…</div>;
  if (!expenses || !summary) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryCard label="إجمالي الإيرادات" syp={summary.totalRevenue.syp} usd={summary.totalRevenue.usd}
          icon={<TrendingUp size={14} />} accent="green" skipped={bucketSkipped(summary.totalRevenue)} />
        <SummaryCard label="الربح (بضائع)" syp={summary.goodsProfit.syp} usd={summary.goodsProfit.usd}
          icon={<DollarSign size={14} />} accent="gold" subtitle="بيع − تكلفة (متجر + مطبخ)"
          skipped={bucketSkipped(summary.goodsProfit)} />
        <SummaryCard label="إجمالي المصاريف" syp={expenses.total.syp} usd={expenses.total.usd}
          icon={<TrendingDown size={14} />} accent="red" skipped={bucketSkipped(expenses.total)} />
        <SummaryCard label="صافي الدخل" syp={summary.netIncome.syp} usd={summary.netIncome.usd}
          icon={<DollarSign size={14} />} accent={summary.netIncome.syp >= 0 ? "green" : "red"}
          skipped={bucketSkipped(summary.netIncome)} />
      </div>
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-2 border-b border-[#252525] bg-[#111111]">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تفصيل المصاريف حسب الفئة</p>
        </div>
        {expenses.byCategory.length === 0 ? (
          <EmptyTable label="لا توجد مصاريف في هذه الفترة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <THead cols={["الفئة", "العدد", "الإجمالي ل.س", "الإجمالي $", "صفوف بدون سعر صرف"]} />
              <tbody className="divide-y divide-[#252525]/60">
                {expenses.byCategory.map((c) => (
                  <tr key={c.category} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2.5 text-[#F0EDE6]">{getCategoryLabel(c.category)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA]">{c.count}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#FF3333]" dir="ltr">{fmtSYP(c.bucket.syp)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]" dir="ltr">{fmtUSD(c.bucket.usd)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#FF7A00]">{c.bucket.skippedUSD || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Gate access (Anviz) ──────────────────────────────────────────────────────
//
// Maps Anviz device UserIDs to gym members by name and shows each member's
// live gate status. Reads anviz_member_map directly (mirrors useProfileNames);
// writes go through intake.ts. The external sync script turns these rows +
// subscription state into UserFlag 1/0 on the physical gate.

interface AnvizMapRow {
  id: string;
  anvizUserid: number;
  memberName: string;
  blocked: boolean;
  notes: string | null;
}

function useAnvizMap(): { rows: AnvizMapRow[]; loading: boolean; refetch: () => void } {
  const [rows, setRows] = useState<AnvizMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const supabase = supabaseBrowser();
    async function load() {
      const { data, error } = await supabase
        .from("anviz_member_map")
        .select("id, anviz_userid, member_name, blocked, notes")
        .order("anviz_userid", { ascending: true });
      if (cancelled) return;
      if (!error) {
        setRows((data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          anvizUserid: Number(r.anviz_userid),
          memberName: r.member_name == null ? "" : String(r.member_name),
          blocked: Boolean(r.blocked),
          notes: r.notes == null ? null : String(r.notes),
        })));
      }
      setLoading(false);
    }
    void load();
    const ch = supabase
      .channel("anviz-member-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "anviz_member_map" }, () => { if (!cancelled) void load(); })
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [tick]);

  return { rows, loading, refetch };
}

// Arabic has no letter case, so this just lowercases (no-op for Arabic) and
// trims, so trailing spaces / casing don't accidentally unlink a member.
const normalizeGateName = (s: string) => s.toLocaleLowerCase("ar-SY").trim();

function GateManager() {
  const { user } = useAuth();
  const { subscriptions } = useStore();
  const { rows, loading, refetch } = useAnvizMap();

  // normalized member name -> presence flags, from the local subscription mirror.
  const subIndex = useMemo(() => {
    const m = new Map<string, { hasAny: boolean; hasActive: boolean }>();
    for (const s of subscriptions) {
      const key = normalizeGateName(s.memberName);
      if (!key) continue;
      const cur = m.get(key) ?? { hasAny: false, hasActive: false };
      cur.hasAny = true;
      if (s.status === "active") cur.hasActive = true;
      m.set(key, cur);
    }
    return m;
  }, [subscriptions]);

  const gateStatus = useCallback((row: AnvizMapRow): { label: string; cls: string } => {
    const found = subIndex.get(normalizeGateName(row.memberName));
    if (!found)         return { label: "غير مرتبط", cls: "text-[#777777] border-[#555555]/30 bg-[#252525]" };
    if (row.blocked)    return { label: "محظور",     cls: "text-[#FF3333] border-[#FF3333]/30 bg-[#FF3333]/10" };
    if (found.hasActive) return { label: "مفعّل",     cls: "text-[#5CC45C] border-[#5CC45C]/30 bg-[#5CC45C]/10" };
    return { label: "منتهي", cls: "text-[#FF3333] border-[#FF3333]/30 bg-[#FF3333]/10" };
  }, [subIndex]);

  // ── Add form ──
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newBlocked, setNewBlocked] = useState(false);
  const [newNotes, setNewNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    setMsg(""); setOk("");
    if (!user) return;
    const id = parseInt(newId, 10);
    if (!Number.isInteger(id) || id <= 0) { setMsg("رقم البوابة غير صحيح."); return; }
    if (!newName.trim()) { setMsg("أدخل اسم العضو."); return; }
    setBusy(true);
    const r = await upsertAnvizMemberMap({
      user: { id: user.id, displayName: user.displayName },
      anvizUserid: id, memberName: newName.trim(),
      blocked: newBlocked, notes: newNotes.trim() || null,
    });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    setNewId(""); setNewName(""); setNewBlocked(false); setNewNotes("");
    setOk("تم الحفظ."); setTimeout(() => setOk(""), 2000);
    void refetch();
  }

  // ── Inline edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [eAnviz, setEAnviz] = useState("");
  const [eName, setEName] = useState("");
  const [eBlocked, setEBlocked] = useState(false);
  const [eNotes, setENotes] = useState("");

  function startEdit(row: AnvizMapRow) {
    setEditId(row.id);
    setEAnviz(String(row.anvizUserid));
    setEName(row.memberName);
    setEBlocked(row.blocked);
    setENotes(row.notes ?? "");
    setMsg("");
  }

  async function saveEdit(row: AnvizMapRow) {
    if (!user) return;
    const id = parseInt(eAnviz, 10);
    if (!Number.isInteger(id) || id <= 0) { setMsg("رقم البوابة غير صحيح."); return; }
    if (!eName.trim()) { setMsg("أدخل اسم العضو."); return; }
    setBusy(true);
    const r = await updateAnvizMemberMap({
      user: { id: user.id, displayName: user.displayName },
      id: row.id, anvizUserid: id, memberName: eName.trim(),
      blocked: eBlocked, notes: eNotes.trim() || null,
    });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    setEditId(null);
    void refetch();
  }

  async function toggleBlocked(row: AnvizMapRow) {
    if (!user) return;
    setBusy(true);
    const r = await updateAnvizMemberMap({ user: { id: user.id, displayName: user.displayName }, id: row.id, blocked: !row.blocked });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    void refetch();
  }

  async function handleDelete(row: AnvizMapRow) {
    if (!user) return;
    if (!window.confirm(`حذف ربط البوابة للعضو ${row.memberName} (رقم ${row.anvizUserid})؟`)) return;
    setBusy(true);
    const r = await deleteAnvizMemberMap({ user: { id: user.id, displayName: user.displayName }, id: row.id });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    if (editId === row.id) setEditId(null);
    void refetch();
  }

  return (
    <div className="space-y-4">
      {/* Add / link form */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
          <SubHeader label="ربط رقم بوابة بعضو" />
          <div className="flex flex-wrap gap-2">
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="رقم البوابة" type="number" min="1" className={`w-28 ${INPUT}`} />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم العضو (كما في الاشتراكات)" className={`flex-1 min-w-[200px] ${INPUT}`} />
            <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="ملاحظات (اختياري)" className={`flex-1 min-w-[160px] ${INPUT}`} />
            <button type="button" onClick={() => setNewBlocked((v) => !v)}
              className={`font-mono text-[10px] px-3 py-1.5 rounded-sm border cursor-pointer transition-colors ${newBlocked ? "text-[#FF3333] border-[#FF3333]/30 bg-[#FF3333]/10" : "text-[#777777] border-[#252525]"}`}>
              {newBlocked ? "محظور ✓" : "حظر يدوي"}
            </button>
            <button onClick={handleAdd} disabled={busy} className={`${BTN_ADD} disabled:opacity-40`}><Plus size={12} />حفظ</button>
          </div>
          {msg && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{msg}</p>}
          {ok  && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{ok}</p>}
          <p className="mt-2 font-mono text-[9px] text-[#555555] leading-relaxed">
            الحالة تُحسب تلقائياً: «مفعّل» عند وجود اشتراك نشط وعدم الحظر، «منتهي» عند انتهاء الاشتراك، «محظور» عند الحظر اليدوي، «غير مرتبط» إذا لم يُطابق الاسم أي عضو.
          </p>
        </div>
      </div>

      {/* Map table */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[#252525] bg-[#111111]">
          <DoorOpen size={13} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">روابط البوابة</p>
          <span className="font-mono text-[10px] text-[#555555]">({rows.length})</span>
        </div>
        {loading ? (
          <EmptyTable label="جاري التحميل…" />
        ) : rows.length === 0 ? (
          <EmptyTable label="لا توجد روابط بعد" />
        ) : (
          <table className="w-full text-xs table-fixed">
            <colgroup>
              <col className="w-[92px]" />
              <col />
              <col className="w-[96px]" />
              <col className="w-[80px]" />
              <col className="w-[24%]" />
              <col className="w-[84px]" />
            </colgroup>
            <THead cols={["رقم البوابة", "اسم العضو", "الحالة", "حظر يدوي", "ملاحظات", "إجراءات"]} />
            <tbody className="divide-y divide-[#252525]/60">
              {rows.map((row) => {
                const editing = editId === row.id;
                const st = gateStatus(row);
                return (
                  <tr key={row.id} className="hover:bg-[#252525]/20 transition-colors align-top">
                    <td className="px-3 py-2.5 font-mono tabular-nums text-[#F0EDE6]">
                      {editing
                        ? <input value={eAnviz} onChange={(e) => setEAnviz(e.target.value)} type="number" min="1" className={`w-16 ${EDIT_INPUT} text-[#F0EDE6]`} />
                        : row.anvizUserid}
                    </td>
                    <td className="px-3 py-2.5 text-[#F0EDE6]">
                      {editing
                        ? <input value={eName} onChange={(e) => setEName(e.target.value)} className={`w-full ${EDIT_INPUT} text-[#F0EDE6]`} />
                        : <span className="block truncate" title={row.memberName}>{row.memberName}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border font-mono text-[10px] whitespace-nowrap ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {editing ? (
                        <button type="button" onClick={() => setEBlocked((v) => !v)}
                          className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer ${eBlocked ? "text-[#FF3333] border-[#FF3333]/30 bg-[#FF3333]/10" : "text-[#777777] border-[#252525]"}`}>
                          {eBlocked ? "نعم" : "لا"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => void toggleBlocked(row)} disabled={busy}
                          className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer disabled:opacity-40 ${row.blocked ? "text-[#FF3333] border-[#FF3333]/30 bg-[#FF3333]/10" : "text-[#777777] border-[#252525]"}`}>
                          {row.blocked ? "نعم" : "لا"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#AAAAAA]">
                      {editing
                        ? <input value={eNotes} onChange={(e) => setENotes(e.target.value)} className={`w-full ${EDIT_INPUT} text-[#AAAAAA]`} />
                        : (row.notes ? <span className="block truncate font-mono text-[10px]" title={row.notes}>{row.notes}</span> : <span className="text-[#555555]">—</span>)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {editing ? (
                          <>
                            <button onClick={() => void saveEdit(row)} disabled={busy} className="p-1 text-[#5CC45C] hover:opacity-80 cursor-pointer disabled:opacity-40" title="حفظ"><Check size={12} /></button>
                            <button onClick={() => setEditId(null)} className="p-1 text-[#777777] hover:text-[#FF3333] cursor-pointer" title="إلغاء"><X size={12} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(row)} className="p-1 text-[#777777] hover:text-[#F5C100] cursor-pointer" title="تعديل"><Edit2 size={12} /></button>
                            <button onClick={() => void handleDelete(row)} disabled={busy} className="p-1 text-[#777777] hover:text-[#FF3333] cursor-pointer disabled:opacity-40" title="حذف"><Trash2 size={12} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type OverviewSection = "revenue" | "subs" | "members" | "other" | "expensesNet";

export default function ManagerDashboard() {
  const { user, signOut } = useAuth();
  const [showLogout, setShowLogout] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<ManagerSection, boolean>>({
    sessions: true, subscriptions: true, inbody: true,
    items: true, warehouse: true, purchases: true, recipes: true, invreports: true, adjustments: true,
    store: true, kitchen: true, profit: true, expenses: true, gate: true, audit: true, activity: false,
  });
  const [ovCollapsed, setOvCollapsed] = useState<Record<OverviewSection, boolean>>({
    revenue: false, subs: false, members: false, other: false, expensesNet: false,
  });
  const toggle = useCallback((s: ManagerSection) => setCollapsed((p) => ({ ...p, [s]: !p[s] })), []);
  const toggleOv = useCallback((s: OverviewSection) => setOvCollapsed((p) => ({ ...p, [s]: !p[s] })), []);
  const handleLogout = useCallback(() => { setShowLogout(false); void signOut(); }, [signOut]);

  const [range, setRange] = useState<ManagerDateRange>(() => makeDateRange("today"));
  const overview = useManagerOverview(range);

  return (
    <div className="min-h-screen bg-void" dir="rtl">
      {showLogout && <LogoutModal onConfirm={handleLogout} onCancel={() => setShowLogout(false)} />}

      <nav className="sticky top-0 bg-charcoal border-b border-gunmetal px-6 py-3 flex items-center justify-between" style={{ zIndex: 100 }}>
        <div className="flex items-center gap-3">
          <Image src="/logo-full.png" alt="OX GYM" width={48} height={48} className="h-10 w-auto" />
          <div>
            <h1 className="font-display text-xl tracking-wider text-offwhite leading-none">لوحة المدير</h1>
            <p className="font-mono text-[10px] text-slate tracking-widest">إدارة العمليات والمالية</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-iron border border-gunmetal">
            <Shield size={14} className="text-gold-dim" />
            <span className="font-mono text-xs text-ghost">{user?.displayName}</span>
            <span className="font-mono text-[10px] text-slate">مدير</span>
          </div>
          <div className="relative group">
            <button onClick={() => setShowLogout(true)} className="flex items-center px-2 py-1.5 text-[#777777] hover:text-[#FF3333] transition-colors cursor-pointer">
              <LogOut size={14} />
            </button>
            <div className="absolute top-full mt-2 left-0 px-2 py-1 bg-[#0A0A0A] border border-[#F5C100]/30 rounded text-[10px] font-mono text-[#F0EDE6] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" style={{ zIndex: 99999 }}>
              تسجيل الخروج
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Date range */}
        <DateRangePicker range={range} setRange={setRange} />

        {/* Live revenue summary cards */}
        <Section
          title={`نظرة عامة — ${range.label}`}
          icon={<DollarSign size={18} className="text-[#F5C100]" />}
          collapsed={ovCollapsed.revenue}
          onToggle={() => toggleOv("revenue")}
        >
          <div className="space-y-3">
            <RevenueSummaryCards loading={overview.loading} summary={overview.summary} />
            <CashOnHandRow summary={overview.summary} />
          </div>
        </Section>

        {/* Subscription revenue */}
        <Section
          title="إيرادات الاشتراكات"
          icon={<Users size={18} className="text-[#F5C100]" />}
          collapsed={ovCollapsed.subs}
          onToggle={() => toggleOv("subs")}
        >
          <SubscriptionRevenueSection loading={overview.loading} subs={overview.subs} />
        </Section>

        {/* Member categories */}
        <Section
          title="فئات الأعضاء"
          icon={<Users size={18} className="text-[#F5C100]" />}
          collapsed={ovCollapsed.members}
          onToggle={() => toggleOv("members")}
        >
          <MemberCategoriesSection loading={overview.loading} members={overview.members} />
        </Section>

        {/* Other income */}
        <Section
          title="إيرادات أخرى — InBody / المطبخ / المتجر / الجلسات الخاصة"
          icon={<ShoppingBag size={18} className="text-[#F5C100]" />}
          collapsed={ovCollapsed.other}
          onToggle={() => toggleOv("other")}
        >
          <OtherIncomeSection loading={overview.loading} other={overview.other} />
        </Section>

        {/* Expenses + Net */}
        <Section
          title="المصاريف وصافي الدخل"
          icon={<TrendingDown size={18} className="text-[#F5C100]" />}
          collapsed={ovCollapsed.expensesNet}
          onToggle={() => toggleOv("expensesNet")}
        >
          <ExpensesNetSection
            loading={overview.loading}
            expenses={overview.expenses}
            summary={overview.summary}
          />
        </Section>

        {/* Reception-style live KPI strip — kept for parity with the
            cashier view, useful at a glance regardless of date range. */}
        <KPIStrip hideProfit={false} />

        <Section title="الجلسات" icon={<Clock size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.sessions} onToggle={() => toggle("sessions")}>
          <SessionsAccordion />
        </Section>

        <Section title="سجل الاشتراكات" icon={<Users size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.subscriptions} onToggle={() => toggle("subscriptions")}>
          <SubscriptionsLog />
        </Section>

        <Section title="سجل جلسات InBody" icon={<Dumbbell size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.inbody} onToggle={() => toggle("inbody")}>
          <InBodyLog />
        </Section>

        <Section title="إدارة الأصناف — الأسعار والمعلومات الناقصة" icon={<Layers size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.items} onToggle={() => toggle("items")}>
          <ItemsManager />
        </Section>

        <Section title="المستودع — المواد والكميات" icon={<Boxes size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.warehouse} onToggle={() => toggle("warehouse")}>
          <WarehouseManager />
        </Section>

        <Section title="المشتريات — فواتير المخزون" icon={<FileText size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.purchases} onToggle={() => toggle("purchases")}>
          <PurchasesManager />
        </Section>

        <Section title="الوصفات — ربط المبيعات بالمخزون" icon={<Link2 size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.recipes} onToggle={() => toggle("recipes")}>
          <RecipesManager />
        </Section>

        <Section title="تقارير المخزون" icon={<BarChart3 size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.invreports} onToggle={() => toggle("invreports")}>
          <InventoryReports />
        </Section>

        <Section title="تعديلات وهدر المخزون" icon={<SlidersHorizontal size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.adjustments} onToggle={() => toggle("adjustments")}>
          <AdjustmentsManager />
        </Section>

        <Section title="المتجر — المبيعات والمخزون" icon={<Package size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.store} onToggle={() => toggle("store")}>
          <div className="space-y-4">
            <StoreDashboard />
            <InventoryActivityPanel />
          </div>
        </Section>

        <Section title="المطبخ — الطلبات والأصناف" icon={<ChefHat size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.kitchen} onToggle={() => toggle("kitchen")}>
          <KitchenDashboard />
        </Section>

        <Section title="تقرير الأرباح" icon={<TrendingUp size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.profit} onToggle={() => toggle("profit")}>
          <ProfitReportBlock />
        </Section>

        <Section title="المصاريف" icon={<ReceiptText size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.expenses} onToggle={() => toggle("expenses")}>
          <ExpensesManager />
        </Section>

        <Section title="البوابة" icon={<DoorOpen size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.gate} onToggle={() => toggle("gate")}>
          <GateManager />
        </Section>

        <Section title="تدقيق ومحاسبة" icon={<Shield size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.audit} onToggle={() => toggle("audit")}>
          <AccountabilityBlock />
        </Section>

        {/* Reception activity feed — every edit/create/cancel made by any
            staff member, with old→new diff for edits. Open by default so
            the manager sees it without hunting. */}
        <Section title="سجل نشاط الفريق" icon={<Activity size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.activity} onToggle={() => toggle("activity")}>
          <AuditLog />
        </Section>

        <footer className="border-t border-gunmetal pt-6 pb-8 space-y-4">
          <DailyExportButton />
          <MonthlyExportButton />
          <div className="flex items-center gap-2">
            <Image src="/logo-icon.png" alt="OX" width={20} height={20} className="h-5 w-auto" />
            <span className="font-mono text-[10px] text-slate">نظام OX GYM المالي — لوحة المدير</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
