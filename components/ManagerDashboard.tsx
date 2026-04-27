"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import {
  Shield, LogOut, ChevronDown, ChevronUp, Plus, Trash2,
  Check, X, AlertTriangle, ChefHat, Package, ReceiptText,
  Users, Dumbbell, Clock,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import type { LocalSession } from "@/lib/store-context";
import type {
  FoodItemCategory, ProductCategory, ExpenseCategory, ExpenseFrequency,
} from "@/lib/types";
import {
  getPlanLabel, getOfferLabel, getProductCategoryLabel, getCategoryLabel,
} from "@/lib/business-logic";
import KPIStrip from "@/components/KPIStrip";

// ─── Section types ────────────────────────────────────────────────────────────

type ManagerSection = "sessions" | "subscriptions" | "inbody" | "food" | "inventory" | "expenses";

// ─── Label maps ───────────────────────────────────────────────────────────────

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

// ─── Logout modal ─────────────────────────────────────────────────────────────

function LogoutModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="bg-[#1A1A1A] border border-[#252525] p-6 rounded-sm max-w-sm w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={18} className="text-[#F5C100] shrink-0" />
          <h3 className="font-display text-lg tracking-wider text-[#F0EDE6]">تسجيل الخروج</h3>
        </div>
        <p className="font-body text-sm text-[#AAAAAA] mb-6">هل أنت متأكد من تسجيل الخروج؟</p>
        <div className="flex items-center gap-3">
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 bg-[#D42B2B] hover:bg-[#FF3333] text-white font-display text-sm tracking-widest transition-colors rounded-sm cursor-pointer">خروج</button>
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 border border-[#252525] text-[#777777] hover:text-[#F0EDE6] font-mono text-xs transition-colors rounded-sm cursor-pointer">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title, icon, collapsed, onToggle, children,
}: {
  title: string;
  icon: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
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

// ─── Stat card ────────────────────────────────────────────────────────────────

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-1">{label}</p>
      <p className={`font-mono tabular-nums text-sm ${highlight ? "text-[#F5C100]" : "text-[#F0EDE6]"}`}>{value}</p>
    </div>
  );
}

// ─── Sessions accordion ────────────────────────────────────────────────────────

function SessionsAccordion() {
  const store = useStore();

  const allSessions = useMemo<LocalSession[]>(() => {
    const arr: LocalSession[] = [];
    if (store.localSession) arr.push(store.localSession);
    arr.push(...store.sessionHistory);
    return arr.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }, [store.localSession, store.sessionHistory]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, idx: number) => expanded[id] !== undefined ? expanded[id] : idx === 0;
  const toggle = (id: string, idx: number) => setExpanded((e) => ({ ...e, [id]: !isOpen(id, idx) }));

  if (allSessions.length === 0) {
    return (
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد جلسات مسجلة بعد</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {allSessions.map((sess, idx) => {
        const open = isOpen(sess.id, idx);
        const isLive = sess.status === "open";
        const subsI    = isLive ? store.subsIncome    : (sess.subsIncome    ?? 0);
        const storeI   = isLive ? store.storeIncome   : (sess.storeIncome   ?? 0);
        const mealsI   = isLive ? store.mealsIncome   : (sess.mealsIncome   ?? 0);
        const inbodyI  = isLive ? store.inbodyIncome  : (sess.inbodyIncome  ?? 0);
        const totalI   = isLive ? store.totalIncome   : (sess.totalIncome   ?? 0);
        const running  = isLive ? store.runningCash   : (sess.actualCash    ?? 0);
        const openedDt = new Date(sess.openedAt);
        const closedDt = sess.closedAt ? new Date(sess.closedAt) : null;
        const expected = sess.openingCash + totalI;
        const diff     = sess.actualCash != null ? sess.actualCash - expected : null;

        return (
          <div key={sess.id} className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
            <button
              onClick={() => toggle(sess.id, idx)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[#252525]/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                {isLive
                  ? <span className="w-2 h-2 rounded-full bg-[#5CC45C] animate-pulse shrink-0" />
                  : <span className="w-2 h-2 rounded-full bg-[#555555] shrink-0" />}
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
                  ) : (
                    sess.actualCash != null && (
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
                    )
                  )}
                </div>
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
  active: "text-[#5CC45C]", expired: "text-[#777777]",
  frozen: "text-[#AAAAAA]", cancelled: "text-[#FF3333]",
};
const SUB_STATUS_LABEL: Record<string, string> = {
  active: "نشط", expired: "منتهي", frozen: "مجمد", cancelled: "ملغي",
};
const PAY_STATUS_COLOR: Record<string, string> = {
  paid: "text-[#5CC45C]", partial: "text-[#F5C100]", unpaid: "text-[#FF3333]",
};
const PAY_STATUS_LABEL: Record<string, string> = {
  paid: "مدفوع", partial: "جزئي", unpaid: "غير مدفوع",
};

function SubscriptionsLog() {
  const { subscriptions } = useStore();
  const sorted = useMemo(
    () => [...subscriptions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [subscriptions]
  );

  if (sorted.length === 0) {
    return (
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد اشتراكات</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#252525] bg-[#111111]">
              {["التاريخ", "العضو", "الخطة", "المبلغ", "المدفوع", "الدفع", "الحالة"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252525]/60">
            {sorted.map((sub) => (
              <tr key={sub.id} className="hover:bg-[#252525]/20 transition-colors">
                <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                  {new Date(sub.createdAt).toLocaleDateString("ar-SY")}
                </td>
                <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap">{sub.memberName}</td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">
                  {getPlanLabel(sub.planType)}
                  {sub.offer !== "none" && (
                    <span className="mr-1.5 text-[#F5C100]/70">{getOfferLabel(sub.offer).split(" ")[0]}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">${sub.amount.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono tabular-nums text-[#5CC45C]">${sub.paidAmount.toFixed(2)}</td>
                <td className={`px-4 py-2.5 font-mono text-[10px] ${PAY_STATUS_COLOR[sub.paymentStatus] ?? "text-[#AAAAAA]"}`}>
                  {PAY_STATUS_LABEL[sub.paymentStatus] ?? sub.paymentStatus}
                </td>
                <td className={`px-4 py-2.5 font-mono text-[10px] ${SUB_STATUS_COLOR[sub.status] ?? "text-[#AAAAAA]"}`}>
                  {SUB_STATUS_LABEL[sub.status] ?? sub.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── InBody log ───────────────────────────────────────────────────────────────

function InBodyLog() {
  const { inBodySessions } = useStore();
  const sorted = useMemo(
    () => [...inBodySessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [inBodySessions]
  );

  if (sorted.length === 0) {
    return (
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد جلسات InBody</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#252525] bg-[#111111]">
              {["التاريخ", "الوقت", "الاسم", "النوع", "السعر", "الموظف", "الحالة"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252525]/60">
            {sorted.map((s) => {
              const d = new Date(s.createdAt);
              return (
                <tr key={s.id} className={`hover:bg-[#252525]/20 transition-colors ${s.cancelled ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">{d.toLocaleDateString("ar-SY")}</td>
                  <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">{d.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className={`px-4 py-2.5 whitespace-nowrap ${s.cancelled ? "line-through text-[#777777]" : "text-[#F0EDE6]"}`}>{s.memberName}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">
                    {s.memberType === "gym_member" ? "عضو" : "خارجي"}
                  </td>
                  <td className={`px-4 py-2.5 font-mono tabular-nums ${s.cancelled ? "line-through text-[#777777]" : "text-[#F5C100]"}`}>
                    ${s.priceUSD.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777]">{s.createdByName}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px]">
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
    </div>
  );
}

// ─── Food items manager ───────────────────────────────────────────────────────

function FoodItemsManager() {
  const { foodItems, addFoodItem, updateFoodItem, removeFoodItem } = useStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<FoodItemCategory>("meals");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");

  function handleAdd() {
    setError(""); setSuccess("");
    if (!name.trim()) { setError("أدخل اسم الصنف."); return; }
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) { setError("سعر البيع غير صحيح."); return; }
    addFoodItem({ name: name.trim(), category, cost: cost ? parseFloat(cost) : undefined, price_usd: p, is_active: true });
    setName(""); setCost(""); setPrice("");
    setSuccess("تمت الإضافة."); setTimeout(() => setSuccess(""), 2000);
  }

  function handleSaveEdit(id: string) {
    const p = parseFloat(editPrice);
    if (isNaN(p) || p <= 0) return;
    updateFoodItem(id, { price_usd: p });
    setEditId(null);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">إضافة صنف للمطبخ</p>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الصنف"
            className="flex-1 min-w-[140px] bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <select value={category} onChange={(e) => setCategory(e.target.value as FoodItemCategory)}
            className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40">
            {FOOD_CATEGORIES.map((c) => <option key={c} value={c}>{FOOD_CAT_LABELS[c]}</option>)}
          </select>
          <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="التكلفة $ (اختياري)"
            type="number" min="0" step="0.01"
            className="w-36 bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="سعر البيع $"
            type="number" min="0" step="0.01"
            className="w-36 bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <button onClick={handleAdd}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer">
            <Plus size={12} />إضافة
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
        {success && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{success}</p>}
      </div>

      {foodItems.length === 0 ? (
        <div className="px-5 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">لا توجد أصناف</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#252525]">
                {["الاسم", "الفئة", "التكلفة", "البيع", "الحالة", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252525]/60">
              {foodItems.map((item) => (
                <tr key={item.id} className={`hover:bg-[#252525]/20 transition-colors ${!item.is_active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 text-[#F0EDE6]">{item.name}</td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA]">{FOOD_CAT_LABELS[item.category]}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">
                    {item.cost != null ? `$${item.cost.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">
                    {editId === item.id ? (
                      <div className="flex items-center gap-1">
                        <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} type="number" step="0.01"
                          className="w-20 bg-[#0A0A0A] border border-[#F5C100]/40 rounded-sm px-2 py-0.5 text-xs text-[#F5C100] focus:outline-none" />
                        <button onClick={() => handleSaveEdit(item.id)} className="text-[#5CC45C] hover:opacity-80 cursor-pointer"><Check size={11} /></button>
                        <button onClick={() => setEditId(null)} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={11} /></button>
                      </div>
                    ) : (
                      <span className="cursor-pointer hover:underline" onClick={() => { setEditId(item.id); setEditPrice(String(item.price_usd)); }}>
                        ${item.price_usd.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => updateFoodItem(item.id, { is_active: !item.is_active })}
                      className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${item.is_active ? "text-[#5CC45C] border-[#5CC45C]/30 bg-[#5CC45C]/10" : "text-[#777777] border-[#555555]/30 hover:border-[#5CC45C]/30"}`}>
                      {item.is_active ? "مفعل" : "متوقف"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => removeFoodItem(item.id)} className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer">
                      <Trash2 size={11} />
                    </button>
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

// ─── Inventory manager ────────────────────────────────────────────────────────

function InventoryManager() {
  const { products, addProduct } = useStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("protein");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function handleAdd() {
    setError(""); setSuccess("");
    if (!name.trim()) { setError("أدخل اسم المنتج."); return; }
    const c = parseFloat(cost), p = parseFloat(price), s = parseInt(stock);
    if (isNaN(c) || c < 0) { setError("التكلفة غير صحيحة."); return; }
    if (isNaN(p) || p <= 0) { setError("سعر البيع غير صحيح."); return; }
    if (isNaN(s) || s < 0) { setError("الكمية غير صحيحة."); return; }
    addProduct({ name: name.trim(), category, cost: c, price: p, stock: s, lowStockThreshold: 3 });
    setName(""); setCost(""); setPrice(""); setStock("");
    setSuccess("تمت الإضافة."); setTimeout(() => setSuccess(""), 2000);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">إضافة منتج للمتجر</p>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المنتج"
            className="flex-1 min-w-[160px] bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}
            className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40">
            {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{getProductCategoryLabel(c)}</option>)}
          </select>
          <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="التكلفة $"
            type="number" min="0" step="0.01"
            className="w-28 bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="البيع $"
            type="number" min="0" step="0.01"
            className="w-28 bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="الكمية"
            type="number" min="0"
            className="w-24 bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <button onClick={handleAdd}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer">
            <Plus size={12} />إضافة
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
        {success && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{success}</p>}
      </div>

      {products.length === 0 ? (
        <div className="px-5 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">لا توجد منتجات</div>
      ) : (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="border-b border-[#252525] bg-[#111111]">
                {["المنتج", "الفئة", "التكلفة", "البيع", "الهامش", "المخزون"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252525]/60">
              {products.map((p) => {
                const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
                const low = p.stock <= p.lowStockThreshold;
                return (
                  <tr key={p.id} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2.5 text-[#F0EDE6] max-w-[180px] truncate">{p.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{getProductCategoryLabel(p.category)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">${p.cost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#F5C100]">${p.price.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 font-mono tabular-nums text-[10px] ${margin >= 20 ? "text-[#5CC45C]" : "text-[#F5C100]"}`}>{margin}%</td>
                    <td className={`px-4 py-2.5 font-mono tabular-nums ${low ? "text-[#FF3333]" : "text-[#AAAAAA]"}`}>
                      {p.stock}{low && <span className="mr-1 text-[9px]">↓</span>}
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

  function handleAdd() {
    setError(""); setSuccess("");
    if (!description.trim()) { setError("أدخل وصف المصروف."); return; }
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) { setError("المبلغ غير صحيح."); return; }
    if (!user) return;
    addExpense({
      description: description.trim(), category, amount: a,
      paymentMethod: "cash", currency: "usd", frequency,
      date: new Date().toISOString().slice(0, 10), createdBy: user.id,
    });
    setDescription(""); setAmount("");
    setSuccess("تم تسجيل المصروف."); setTimeout(() => setSuccess(""), 2000);
  }

  const totalExpenses = useMemo(() => sorted.reduce((s, e) => s + e.amount, 0), [sorted]);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">تسجيل مصروف</p>
        <div className="flex flex-wrap gap-2">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="الوصف / الاسم"
            className="flex-1 min-w-[160px] bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40">
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{getCategoryLabel(c)}</option>)}
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="المبلغ $"
            type="number" min="0" step="0.01"
            className="w-32 bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40" />
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as ExpenseFrequency)}
            className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40">
            {(["monthly", "weekly", "daily", "one_time"] as ExpenseFrequency[]).map((f) => (
              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
            ))}
          </select>
          <button onClick={handleAdd}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer">
            <Plus size={12} />تسجيل
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
        {success && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{success}</p>}
      </div>

      {sorted.length === 0 ? (
        <div className="px-5 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">لا توجد مصاريف مسجلة</div>
      ) : (
        <>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-[#252525] bg-[#111111]">
                  {["التاريخ", "الوصف", "الفئة", "المبلغ", "التكرار"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#252525]/60">
                {sorted.map((exp) => (
                  <tr key={exp.id} className="hover:bg-[#252525]/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[#777777] whitespace-nowrap">
                      {new Date(exp.createdAt).toLocaleDateString("ar-SY")}
                    </td>
                    <td className="px-4 py-2.5 text-[#F0EDE6]">{exp.description}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{getCategoryLabel(exp.category)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#FF3333]">${exp.amount.toFixed(2)}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] whitespace-nowrap">
                      {exp.frequency ? FREQ_LABELS[exp.frequency] : "مرة واحدة"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#252525] px-5 py-3 flex items-center justify-between bg-[#111111]/60">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الإجمالي المسجل</span>
            <span className="font-mono tabular-nums text-sm text-[#FF3333]">${totalExpenses.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main manager dashboard ───────────────────────────────────────────────────

export default function ManagerDashboard() {
  const { user, signOut } = useAuth();
  const [showLogout, setShowLogout] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<ManagerSection, boolean>>({
    sessions: false,
    subscriptions: false,
    inbody: false,
    food: false,
    inventory: false,
    expenses: false,
  });

  const toggle = useCallback((s: ManagerSection) => {
    setCollapsed((prev) => ({ ...prev, [s]: !prev[s] }));
  }, []);

  const handleLogout = useCallback(() => { setShowLogout(false); void signOut(); }, [signOut]);

  return (
    <div className="min-h-screen bg-void" dir="rtl">
      {showLogout && <LogoutModal onConfirm={handleLogout} onCancel={() => setShowLogout(false)} />}

      {/* Navbar */}
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
            <button onClick={() => setShowLogout(true)} className="flex items-center gap-1 px-2 py-1.5 text-[#777777] hover:text-[#FF3333] transition-colors cursor-pointer">
              <LogOut size={14} />
            </button>
            <div className="absolute top-full mt-2 left-0 px-2 py-1 bg-[#0A0A0A] border border-[#F5C100]/30 rounded text-[10px] font-mono text-[#F0EDE6] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" style={{ zIndex: 99999 }}>
              تسجيل الخروج
            </div>
          </div>
        </div>
      </nav>

      {/* Main */}
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

        <Section title="إدارة أصناف المطبخ" icon={<ChefHat size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.food} onToggle={() => toggle("food")}>
          <FoodItemsManager />
        </Section>

        <Section title="إدارة المخزون" icon={<Package size={18} className="text-[#F5C100]" />}
          collapsed={collapsed.inventory} onToggle={() => toggle("inventory")}>
          <InventoryManager />
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
