"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import {
  Shield, LogOut, ChevronDown, ChevronUp, Plus, Trash2,
  Check, X, AlertTriangle, ChefHat, Package, ReceiptText,
  Users, Dumbbell, Clock, Edit2, ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import type { LocalSession } from "@/lib/store-context";
import type { FoodItem, FoodItemCategory, ProductCategory, ExpenseCategory, ExpenseFrequency, Expense } from "@/lib/types";
import type { Product } from "@/lib/types";
import {
  getPlanLabel, getOfferLabel, getProductCategoryLabel, getCategoryLabel,
} from "@/lib/business-logic";
import { pushExpense } from "@/lib/supabase/intake";
import KPIStrip from "@/components/KPIStrip";

// ─── Constants ────────────────────────────────────────────────────────────────

type ManagerSection = "sessions" | "subscriptions" | "inbody" | "store" | "kitchen" | "expenses";

const FOOD_CATEGORIES: FoodItemCategory[] = ["meals", "breakfast", "salads", "drinks", "snacks", "other"];
const FOOD_CAT_LABELS: Record<FoodItemCategory, string> = {
  meals: "وجبات", breakfast: "فطور", salads: "سلطات",
  drinks: "مشروبات", snacks: "وجبات خفيفة", other: "أخرى",
};

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

// Maps local auth email IDs to display names
const EMPLOYEE_MAP: Record<string, string> = {
  "adham@ox.local":      "كوتش أدهم",
  "haider@ox.local":     "حيدر",
  "reception1@ox.local": "نوار",
  "reception2@ox.local": "ساميلا راعي",
  "reception3@ox.local": "آيه ابراهيم",
  "reception4@ox.local": "سالي رجب",
  "reception5@ox.local": "رند اسماعيل",
  "reception6@ox.local": "ناديا ابراهيم",
  "reception7@ox.local": "استقبال ٧",
};

function fmtEmployee(id: string): string {
  return EMPLOYEE_MAP[id] ?? id.replace(/@.*$/, "");
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
    return new Date(sess.openedAt).toLocaleDateString("ar-SY", { month: "short", day: "numeric" });
  }, [sessions]);
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function LogoutModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
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
    </div>
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

function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
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
        const subsI    = isLive ? store.subsIncome   : (sess.subsIncome   ?? 0);
        const storeI   = isLive ? store.storeIncome  : (sess.storeIncome  ?? 0);
        const mealsI   = isLive ? store.mealsIncome  : (sess.mealsIncome  ?? 0);
        const inbodyI  = isLive ? store.inbodyIncome : (sess.inbodyIncome ?? 0);
        const totalI   = isLive ? store.totalIncome  : (sess.totalIncome  ?? 0);
        const running  = isLive ? store.runningCash  : (sess.actualCash   ?? 0);
        const openedDt = new Date(sess.openedAt);
        const closedDt = sess.closedAt ? new Date(sess.closedAt) : null;
        const diff     = sess.actualCash != null ? sess.actualCash - (sess.openingCash + totalI) : null;

        return (
          <div key={sess.id} className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
            <button onClick={() => toggle(sess.id, idx)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#252525]/30 transition-colors cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isLive ? "bg-[#5CC45C] animate-pulse" : "bg-[#555555]"}`} />
                <span className="font-display text-sm tracking-wider text-[#F0EDE6] truncate">
                  {openedDt.toLocaleDateString("ar-SY", { weekday: "short", month: "short", day: "numeric" })}
                </span>
                <span className="font-mono text-[10px] text-[#555555] whitespace-nowrap">
                  {openedDt.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                  {closedDt && ` ← ${closedDt.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}`}
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
                <div className="border-t border-[#252525]/60 pt-3 flex flex-wrap gap-6">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">فتح الصندوق</p>
                    <p className="font-mono tabular-nums text-sm text-[#F0EDE6]">${sess.openingCash.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي الدخل</p>
                    <p className="font-mono tabular-nums text-sm text-[#F5C100]">${totalI.toFixed(2)}</p>
                  </div>
                  {isLive ? (
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">متوقع بالصندوق</p>
                      <p className="font-mono tabular-nums text-sm text-[#5CC45C]">${running.toFixed(2)}</p>
                    </div>
                  ) : sess.actualCash != null && (
                    <>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الفعلي بالصندوق</p>
                        <p className="font-mono tabular-nums text-sm text-[#5CC45C]">${sess.actualCash.toFixed(2)}</p>
                      </div>
                      {diff !== null && (
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الفرق</p>
                          <p className={`font-mono tabular-nums text-sm ${diff < 0 ? "text-[#FF3333]" : diff > 0 ? "text-[#F5C100]" : "text-[#5CC45C]"}`}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(2)}
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
            <THead cols={["تاريخ التسجيل", "العضو", "الخطة", "العرض", "المبلغ المدفوع", "الموظف", "الجلسة", "الحالة"]} />
            <tbody className="divide-y divide-[#252525]/60">
              {sorted.map((sub) => (
                <tr key={sub.id} className="hover:bg-[#252525]/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                    {new Date(sub.createdAt).toLocaleDateString("ar-SY")}{" "}
                    <span className="text-[9px] text-[#555555]">
                      {new Date(sub.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap font-medium">{sub.memberName}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{getPlanLabel(sub.planType)}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] whitespace-nowrap">
                    {sub.offer === "none"
                      ? <span className="text-[#555555]">—</span>
                      : <span className="text-[#F5C100]">{getOfferLabel(sub.offer)}</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[#5CC45C] whitespace-nowrap">${sub.paidAmount.toFixed(2)}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{fmtEmployee(sub.createdBy)}</td>
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
                const d = new Date(s.createdAt);
                return (
                  <tr key={s.id} className={`hover:bg-[#252525]/20 transition-colors ${s.cancelled ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                      {d.toLocaleDateString("ar-SY")}{" "}
                      <span className="text-[9px] text-[#555555]">{d.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}</span>
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

  function handleAdd() {
    setAddErr(""); setAddOk("");
    if (!newName.trim()) { setAddErr("أدخل اسم المنتج."); return; }
    const c = parseFloat(newCost), p = parseFloat(newPrice), s = parseInt(newStock);
    if (isNaN(c) || c < 0) { setAddErr("السعر الأصلي غير صحيح."); return; }
    if (isNaN(p) || p <= 0) { setAddErr("سعر البيع غير صحيح."); return; }
    if (isNaN(s) || s < 0) { setAddErr("الكمية غير صحيحة."); return; }
    addProduct({ name: newName.trim(), category: newCat, cost: c, price: p, stock: s, lowStockThreshold: 3 });
    setNewName(""); setNewCost(""); setNewPrice(""); setNewStock("");
    setAddOk("تمت الإضافة."); setTimeout(() => setAddOk(""), 2000);
  }

  // Inline editing
  const [editRows, setEditRows] = useState<Record<string, ProdEdit>>({});

  function startEdit(p: Product) {
    setEditRows((prev) => ({ ...prev, [p.id]: { cost: String(p.cost), price: String(p.price), stock: String(p.stock) } }));
  }
  function cancelEdit(id: string) {
    setEditRows((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }
  function saveEdit(p: Product) {
    const row = editRows[p.id];
    if (!row) return;
    const c = parseFloat(row.cost), pr = parseFloat(row.price), ns = parseInt(row.stock);
    if (!isNaN(c) && !isNaN(pr) && c >= 0 && pr > 0) updateProductPrice(p.id, c, pr);
    if (!isNaN(ns) && ns >= 0) adjustStock(p.id, ns - p.stock);
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
                      {new Date(s.createdAt).toLocaleDateString("ar-SY")}{" "}
                      <span className="text-[9px] text-[#555555]">{new Date(s.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}</span>
                    </td>
                    <td className="px-4 py-2 text-[#F0EDE6] max-w-[180px] truncate">{s.productName}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{s.quantity}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]">${s.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#F5C100]">${s.total.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{fmtEmployee(s.createdBy)}</td>
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
                  const profit = p.price - p.cost;
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
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">${p.cost.toFixed(2)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">${p.price.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums text-[10px] ${profit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}`}>${profit.toFixed(2)}</td>
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

type FoodEdit = { cost: string; price: string };

function KitchenDashboard() {
  const { sales, foodItems, addFoodItem, updateFoodItem, removeFoodItem } = useStore();
  const sessionLabel = useSessionLabel();

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
  const [newCost, setNewCost] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState("");

  const liveProfit = useMemo(() => {
    const c = parseFloat(newCost), p = parseFloat(newPrice);
    return !isNaN(c) && !isNaN(p) ? p - c : null;
  }, [newCost, newPrice]);

  function handleAdd() {
    setAddErr(""); setAddOk("");
    if (!newName.trim()) { setAddErr("أدخل اسم الصنف."); return; }
    const p = parseFloat(newPrice);
    if (isNaN(p) || p <= 0) { setAddErr("سعر البيع غير صحيح."); return; }
    addFoodItem({ name: newName.trim(), category: newCat, cost: newCost ? parseFloat(newCost) : undefined, price_usd: p, is_active: true });
    setNewName(""); setNewCost(""); setNewPrice("");
    setAddOk("تمت الإضافة."); setTimeout(() => setAddOk(""), 2000);
  }

  // Inline editing
  const [foodEdits, setFoodEdits] = useState<Record<string, FoodEdit>>({});

  function startFoodEdit(f: FoodItem) {
    setFoodEdits((prev) => ({ ...prev, [f.id]: { cost: f.cost != null ? String(f.cost) : "", price: String(f.price_usd) } }));
  }
  function cancelFoodEdit(id: string) {
    setFoodEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }
  function saveFoodEdit(f: FoodItem) {
    const row = foodEdits[f.id];
    if (!row) return;
    const updates: Partial<FoodItem> = {};
    const pr = parseFloat(row.price);
    if (!isNaN(pr) && pr > 0) updates.price_usd = pr;
    if (row.cost !== "") { const c = parseFloat(row.cost); if (!isNaN(c)) updates.cost = c; }
    if (Object.keys(updates).length) updateFoodItem(f.id, updates);
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
                      {new Date(s.createdAt).toLocaleDateString("ar-SY")}{" "}
                      <span className="text-[9px] text-[#555555]">{new Date(s.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}</span>
                    </td>
                    <td className="px-4 py-2 text-[#F0EDE6]">{s.productName}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{s.quantity}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]">${s.unitPrice.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#F5C100]">${s.total.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{fmtEmployee(s.createdBy)}</td>
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
        <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
          <SubHeader label="إضافة صنف جديد للمطبخ" />
          <div className="flex flex-wrap gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم الصنف" className={`flex-1 min-w-[140px] ${INPUT}`} />
            <select value={newCat} onChange={(e) => setNewCat(e.target.value as FoodItemCategory)} className={SELECT}>
              {FOOD_CATEGORIES.map((c) => <option key={c} value={c}>{FOOD_CAT_LABELS[c]}</option>)}
            </select>
            <input value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="السعر الأصلي $ (اختياري)" type="number" min="0" step="0.01" className={`w-40 ${INPUT}`} />
            <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="سعر البيع $" type="number" min="0" step="0.01" className={`w-32 ${INPUT}`} />
            {liveProfit !== null && (
              <div className="flex items-center px-3 py-1.5 bg-[#111111] border border-[#252525] rounded-sm">
                <span className="font-mono text-[10px] text-[#555555] ml-1.5">ربح:</span>
                <span className={`font-mono tabular-nums text-xs ${liveProfit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}`}>${liveProfit.toFixed(2)}</span>
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
              <THead cols={["الاسم", "السعر الأصلي", "سعر البيع", "الربح", "الفئة", "الحالة", ""]} />
              <tbody className="divide-y divide-[#252525]/60">
                {foodItems.map((item) => {
                  const editing = foodEdits[item.id];
                  const profit = item.cost != null ? item.price_usd - item.cost : null;
                  return (
                    <tr key={item.id} className={`hover:bg-[#252525]/20 transition-colors ${!item.is_active ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 text-[#F0EDE6]">{item.name}</td>
                      {editing ? (
                        <>
                          <td className="px-4 py-2.5">
                            <input value={editing.cost} onChange={(e) => setFoodEdits((r) => ({ ...r, [item.id]: { ...r[item.id], cost: e.target.value } }))}
                              type="number" step="0.01" placeholder="—" className={`${EDIT_INPUT} text-[#777777]`} />
                          </td>
                          <td className="px-4 py-2.5">
                            <input value={editing.price} onChange={(e) => setFoodEdits((r) => ({ ...r, [item.id]: { ...r[item.id], price: e.target.value } }))}
                              type="number" step="0.01" className={`${EDIT_INPUT} text-[#F5C100]`} />
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[10px]">
                            {(() => {
                              const diff = parseFloat(editing.price) - parseFloat(editing.cost || "0");
                              return isNaN(diff) ? "—" : <span className={diff >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]"}>${diff.toFixed(2)}</span>;
                            })()}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA]">{FOOD_CAT_LABELS[item.category]}</td>
                          <td className="px-4 py-2.5" />
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => saveFoodEdit(item)} className="text-[#5CC45C] hover:opacity-80 cursor-pointer"><Check size={12} /></button>
                              <button onClick={() => cancelFoodEdit(item.id)} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={12} /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">
                            {item.cost != null ? `$${item.cost.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">${item.price_usd.toFixed(2)}</td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums text-[10px] ${profit != null ? (profit >= 0 ? "text-[#5CC45C]" : "text-[#FF3333]") : "text-[#555555]"}`}>
                            {profit != null ? `$${profit.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA]">{FOOD_CAT_LABELS[item.category]}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => updateFoodItem(item.id, { is_active: !item.is_active })}
                              className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${item.is_active ? "text-[#5CC45C] border-[#5CC45C]/30 bg-[#5CC45C]/10" : "text-[#777777] border-[#555555]/30"}`}>
                              {item.is_active ? "مفعل" : "متوقف"}
                            </button>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => startFoodEdit(item)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"><Edit2 size={11} /></button>
                              <button onClick={() => removeFoodItem(item.id)} className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"><Trash2 size={11} /></button>
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

function ExpensesManager() {
  const { expenses, addExpense } = useStore();
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("salaries");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<ExpenseFrequency>("monthly");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sorted = useMemo(
    () => [...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [expenses]
  );
  const total = useMemo(() => sorted.reduce((s, e) => s + e.amount, 0), [sorted]);

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
      currency: "usd",
      category,
    });
    if (r.error) { setError(r.error); return; }
    const row = r.data!;
    const full: Expense = {
      id: String(row.id),
      description: description.trim(),
      category,
      amount: a,
      paymentMethod: "cash",
      currency: "usd",
      frequency,
      date: new Date().toISOString().slice(0, 10),
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
    };
    addExpense(full);
    setDescription(""); setAmount("");
    setSuccess("تم تسجيل المصروف."); setTimeout(() => setSuccess(""), 2000);
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
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="المبلغ $" type="number" min="0" step="0.01" className={`w-32 ${INPUT}`} />
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as ExpenseFrequency)} className={SELECT}>
            {(["monthly", "weekly", "daily", "one_time"] as ExpenseFrequency[]).map((f) => (
              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
            ))}
          </select>
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
              <thead className="sticky top-0"><THead cols={["التاريخ", "الوصف", "الفئة", "المبلغ", "التكرار"]} /></thead>
              <tbody className="divide-y divide-[#252525]/60">
                {sorted.map((exp) => (
                  <tr key={exp.id} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">{new Date(exp.createdAt).toLocaleDateString("ar-SY")}</td>
                    <td className="px-4 py-2.5 text-[#F0EDE6]">{exp.description}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{getCategoryLabel(exp.category)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#FF3333]">${exp.amount.toFixed(2)}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] whitespace-nowrap">{exp.frequency ? FREQ_LABELS[exp.frequency] : "مرة واحدة"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#252525] px-5 py-3 flex items-center justify-between bg-[#111111]/60">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الإجمالي المسجل</span>
            <span className="font-mono tabular-nums text-sm text-[#FF3333]">${total.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ManagerDashboard() {
  const { user, signOut } = useAuth();
  const [showLogout, setShowLogout] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<ManagerSection, boolean>>({
    sessions: false, subscriptions: false, inbody: false,
    store: false, kitchen: false, expenses: false,
  });
  const toggle = useCallback((s: ManagerSection) => setCollapsed((p) => ({ ...p, [s]: !p[s] })), []);
  const handleLogout = useCallback(() => { setShowLogout(false); void signOut(); }, [signOut]);

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

        <Section title="المتجر — المبيعات والمخزون" icon={<Package size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.store} onToggle={() => toggle("store")}>
          <StoreDashboard />
        </Section>

        <Section title="المطبخ — الطلبات والأصناف" icon={<ChefHat size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.kitchen} onToggle={() => toggle("kitchen")}>
          <KitchenDashboard />
        </Section>

        <Section title="المصاريف" icon={<ReceiptText size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.expenses} onToggle={() => toggle("expenses")}>
          <ExpensesManager />
        </Section>

        <footer className="border-t border-gunmetal pt-6 pb-8 flex items-center gap-2">
          <Image src="/logo-icon.png" alt="OX" width={20} height={20} className="h-5 w-auto" />
          <span className="font-mono text-[10px] text-slate">نظام OX GYM المالي — لوحة المدير</span>
        </footer>
      </main>
    </div>
  );
}
