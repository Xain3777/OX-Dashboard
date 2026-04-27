"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Subscription,
  PlanType,
  OfferType,
  PaymentStatus,
  SubStatus,
} from "@/lib/types";
import {
  PLAN_BASE_PRICES,
  formatCurrency,
  formatDate,
  getPlanLabel,
  getOfferLabel,
  calculateEndDate,
  calculateRemainingDays,
  calculateDiscountedPrice,
  generateId,
} from "@/lib/business-logic";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/lib/auth-context";
import { useCurrency } from "@/lib/currency-context";
import { pushSubscription } from "@/lib/supabase/intake";

// ─── Constants ────────────────────────────────────────────────────────────────

type SortMode = "alpha" | "date";

const PLAN_TYPES: PlanType[] = [
  "daily",
  "1_month",
  "2_months",
  "3_months",
  "4_months",
  "6_months",
  "7_months",
  "8_months",
  "9_months",
  "12_months",
];

const OFFER_TYPES: OfferType[] = ["none", "married_couple", "referral_5", "referral_9", "corporate"];

// Price-affecting offers only apply to 1-month plans
const PRICE_OFFERS: OfferType[] = ["married_couple", "corporate"];

const PHONE_RE = /^09\d{8}$/;
const TODAY = new Date().toISOString().split("T")[0];

// ─── Filter type ──────────────────────────────────────────────────────────────

type FilterTab = "all" | "active" | "expiring" | "unpaid" | "expired";

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  // second person (couple offer)
  firstName2: string;
  lastName2: string;
  phone2: string;
  planType: PlanType;
  offer: OfferType;
  startDate: string;
  amount: string;
  paymentStatus: PaymentStatus;
  paidAmount: string;
}

const DEFAULT_FORM: FormState = {
  firstName: "",
  lastName: "",
  phone: "",
  firstName2: "",
  lastName2: "",
  phone2: "",
  planType: "1_month",
  offer: "none",
  startDate: TODAY,
  amount: String(PLAN_BASE_PRICES["1_month"]),
  paymentStatus: "paid",
  paidAmount: "",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: PlanType }) {
  const colorMap: Partial<Record<PlanType, string>> = {
    daily:      "bg-slate/30 text-ghost border-slate/40",
    "1_month":  "bg-gunmetal text-offwhite border-gunmetal",
    "2_months": "bg-gold-dim/15 text-gold border-gold-dim/30",
    "3_months": "bg-gold-dim/20 text-gold border-gold-dim/40",
    "4_months": "bg-gold-dim/30 text-gold-bright border-gold-dim/50",
    "6_months": "bg-gold/10 text-gold-bright border-gold/20",
    "7_months": "bg-gold/12 text-gold-bright border-gold/25",
    "8_months": "bg-gold/14 text-gold-bright border-gold/28",
    "9_months": "bg-gold/15 text-gold-bright border-gold/30",
    "12_months":"bg-gold/25 text-gold-bright border-gold/40 glow-gold-sm",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium border uppercase tracking-wider ${colorMap[plan] ?? "bg-gunmetal text-offwhite border-gunmetal"}`}>
      {getPlanLabel(plan)}
    </span>
  );
}

function OfferTag({ offer }: { offer: OfferType }) {
  if (offer === "none") return null;
  return (
    <span className="inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded-sm bg-gold-dim/10 text-gold-dim border border-gold-dim/20 text-[9px] font-mono uppercase tracking-wider leading-tight">
      {getOfferLabel(offer)}
    </span>
  );
}

function RemainingDaysBadge({ days, status }: { days: number; status: SubStatus }) {
  if (status === "expired" || days === 0) {
    return <span className="font-mono text-xs text-slate tabular-nums">—</span>;
  }
  if (status === "frozen") {
    return (
      <span className="font-mono text-xs text-secondary tabular-nums flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="5" y1="2" x2="5" y2="8" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        {days}
      </span>
    );
  }
  if (days > 30) return <span className="font-mono text-xs text-success tabular-nums font-medium">{days}</span>;
  if (days >= 7)  return <span className="font-mono text-xs text-gold tabular-nums font-medium">{days}</span>;
  return <span className="font-mono text-xs text-red tabular-nums font-bold animate-pulse">{days}</span>;
}

function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { label: string; cls: string }> = {
    paid:    { label: "مدفوع",       cls: "bg-success/10 text-success border-success/25" },
    partial: { label: "جزئي",        cls: "bg-gold/10 text-gold border-gold/25" },
    unpaid:  { label: "غير مدفوع",  cls: "bg-red/10 text-red border-red/25" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

function SubStatusChip({ status }: { status: SubStatus }) {
  const map: Record<SubStatus, { label: string; cls: string }> = {
    active:    { label: "نشط",   cls: "bg-success/10 text-success border-success/20" },
    expired:   { label: "منتهي", cls: "bg-gunmetal text-secondary border-gunmetal" },
    frozen:    { label: "مجمّد", cls: "bg-slate/10 text-slate border-slate/20" },
    cancelled: { label: "ملغي",  cls: "bg-red/10 text-red border-red/20" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="10" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7" cy="9.5" r="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
      className={`transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`} aria-hidden="true">
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-gunmetal border border-success/30 rounded clip-corner-sm shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-200">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-success shrink-0">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="font-body text-sm text-offwhite">{message}</p>
    </div>
  );
}

function CoupleSummaryPanel({ perPerson, total }: { perPerson: number; total: number }) {
  return (
    <div className="p-3 bg-gold/5 border border-gold/20 rounded flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-gold animate-pulse" />
        <span className="font-mono text-[10px] text-gold uppercase tracking-widest">عرض الزوجين — خصم ١٥٪</span>
      </div>
      <div className="flex items-center gap-6 mr-auto">
        <div className="text-center">
          <p className="font-mono text-[9px] text-slate uppercase tracking-wider mb-0.5">للشخص الواحد</p>
          <p className="font-display text-lg text-gold-bright tabular-nums">${perPerson.toFixed(2)}</p>
        </div>
        <div className="text-secondary font-mono text-xs">×٢</div>
        <div className="text-center">
          <p className="font-mono text-[9px] text-slate uppercase tracking-wider mb-0.5">المجموع</p>
          <p className="font-display text-lg text-gold-bright tabular-nums">${total.toFixed(2)}</p>
        </div>
        <div className="text-center">
          <p className="font-mono text-[9px] text-slate uppercase tracking-wider mb-0.5">الوفر</p>
          <p className="font-display text-lg text-success tabular-nums">${(35 * 2 - total).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SubscriptionsBlock() {
  const { subscriptions, addSubscription, cancelSubscriptionLocal } = useStore();
  const { user } = useAuth();
  const { exchangeRate } = useCurrency();
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [sortMode, setSortMode] = useState<SortMode>("alpha");
  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [phoneError, setPhoneError] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const computedEndDate = calculateEndDate(form.startDate, form.planType, form.offer);
  const isCouple = form.offer === "married_couple" && form.planType === "1_month";
  const perPersonAmount = Number(Number(form.amount).toFixed(2));

  const recalcAmount = useCallback((planType: PlanType, offer: OfferType) => {
    return Number(calculateDiscountedPrice(planType, offer).toFixed(2));
  }, []);

  const handlePlanChange = useCallback((planType: PlanType) => {
    // Reset price-affecting offers when switching away from 1-month; keep referral offers
    const offerToUse = planType !== "1_month" && PRICE_OFFERS.includes(form.offer) ? "none" : form.offer;
    setForm((prev) => ({
      ...prev,
      planType,
      offer: offerToUse,
      amount: String(recalcAmount(planType, offerToUse)),
    }));
  }, [form.offer, recalcAmount]);

  const handleOfferChange = useCallback((offer: OfferType) => {
    setForm((prev) => ({
      ...prev,
      offer,
      amount: String(recalcAmount(prev.planType, offer)),
    }));
  }, [recalcAmount]);

  // ── Filter + search logic ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = subscriptions.filter((sub) => {
      if (activeFilter === "active")   return sub.status === "active";
      if (activeFilter === "expired")  return sub.status === "expired";
      if (activeFilter === "unpaid")   return sub.paymentStatus === "unpaid" || sub.paymentStatus === "partial";
      if (activeFilter === "expiring") return sub.status === "active" && sub.remainingDays > 0 && sub.remainingDays <= 7;
      return true;
    });
    if (q) {
      result = result.filter((sub) =>
        sub.memberName.toLowerCase().includes(q) ||
        (sub as Subscription & { phoneNumber?: string }).phoneNumber?.toLowerCase().includes(q)
      );
    }
    if (sortMode === "alpha") {
      result = [...result].sort((a, b) => a.memberName.localeCompare(b.memberName, "ar"));
    } else {
      result = [...result].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }
    return result;
  }, [subscriptions, activeFilter, sortMode, searchQuery]);

  const filterCounts: Record<FilterTab, number> = {
    all:      subscriptions.length,
    active:   subscriptions.filter((s) => s.status === "active").length,
    expiring: subscriptions.filter((s) => s.status === "active" && s.remainingDays > 0 && s.remainingDays <= 7).length,
    unpaid:   subscriptions.filter((s) => s.paymentStatus === "unpaid" || s.paymentStatus === "partial").length,
    expired:  subscriptions.filter((s) => s.status === "expired").length,
  };

  // ── Form submit ────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const phone = form.phone.trim();
    if (phone && !PHONE_RE.test(phone)) {
      setPhoneError("رقم الهاتف يجب أن يبدأ بـ 09 ويتكون من 10 أرقام");
      return;
    }
    setPhoneError("");

    const endDate   = computedEndDate;
    const remaining = calculateRemainingDays(endDate);
    const amountUSD = perPersonAmount;
    const paidUSD   =
      form.paymentStatus === "partial" ? Number(Number(form.paidAmount).toFixed(2)) :
      form.paymentStatus === "paid"    ? amountUSD : 0;

    const makeSub = (name: string, phone?: string): Omit<Subscription, "id" | "createdAt"> => ({
      memberId:      generateId(),
      memberName:    name,
      phoneNumber:   phone || undefined,
      planType:      form.planType,
      offer:         form.offer,
      startDate:     form.startDate,
      endDate,
      remainingDays: remaining,
      amount:        amountUSD,
      paidAmount:    paidUSD,
      paymentStatus: form.paymentStatus,
      paymentMethod: "cash",
      currency:      "usd",
      status:        remaining > 0 ? "active" : "expired",
      createdBy:     user?.id ?? "unknown",
      lockedAt:      new Date().toISOString(),
    });

    const name1 = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    const name2 = isCouple ? `${form.firstName2.trim()} ${form.lastName2.trim()}`.trim() : "";
    const phone2 = isCouple ? form.phone2.trim() : "";

    const sub1 = makeSub(name1, phone);
    const newSubs: Omit<Subscription, "id" | "createdAt">[] = [sub1];

    if (isCouple && name2) {
      newSubs.push(makeSub(name2, phone2 || undefined));
    }

    for (const sub of newSubs) {
      addSubscription(sub);

      if (user) {
        void pushSubscription({
          user:          { id: user.id, displayName: user.displayName },
          memberName:    sub.memberName,
          phoneNumber:   sub.phoneNumber,
          planType:      form.planType,
          offer:         form.offer,
          startDate:     form.startDate,
          endDate,
          amountUSD,
          paidAmountUSD: paidUSD,
          paymentStatus: form.paymentStatus,
          exchangeRate,
        }).catch(() => {});
      }
    }

    setForm(DEFAULT_FORM);
    setPhoneError("");
    setFormOpen(false);
    setToastMessage(isCouple && name2 ? "تم حفظ اشتراكَي الزوجين بنجاح" : "تم حفظ الاشتراك بنجاح");
  };

  const rowAccent = (sub: Subscription): string => {
    if (sub.paymentStatus === "unpaid")  return "border-l-2 border-l-red";
    if (sub.paymentStatus === "partial") return "border-l-2 border-l-gold";
    return "border-l-2 border-l-transparent";
  };

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: "all",      label: "الكل" },
    { key: "active",   label: "نشط" },
    { key: "expiring", label: "ينتهي قريباً" },
    { key: "unpaid",   label: "غير مدفوع" },
    { key: "expired",  label: "منتهي" },
  ];

  const inputCls  = "ox-input w-full bg-charcoal border border-gunmetal text-offwhite font-body text-sm px-3 py-2 rounded focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20 placeholder:text-slate transition-colors";
  const selectCls = "ox-select w-full bg-charcoal border border-gunmetal text-offwhite font-body text-sm px-3 py-2 rounded focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20 transition-colors appearance-none cursor-pointer";
  const labelCls  = "block font-mono text-[10px] text-secondary uppercase tracking-wider mb-1.5";

  return (
    <>
      {toastMessage && <Toast message={toastMessage} onDone={() => setToastMessage(null)} />}

      <section className="bg-iron border border-gunmetal rounded p-5 space-y-5" dir="rtl">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl tracking-wider text-offwhite uppercase leading-none">
              الاشتراكات
            </h2>
            <span className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-2 bg-gunmetal border border-gunmetal rounded-full font-mono text-xs text-gold tabular-nums font-semibold">
              {subscriptions.length}
            </span>
          </div>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className={`inline-flex items-center gap-2 px-4 py-2 clip-corner-sm font-display text-sm tracking-wider uppercase transition-all duration-150 ${
              formOpen
                ? "bg-gunmetal border border-gold/30 text-gold"
                : "bg-gold text-void hover:bg-gold-bright active:bg-gold-deep"
            }`}
          >
            {formOpen ? <><ChevronIcon open={true} />إلغاء</> : <><PlusIcon />اشتراك جديد</>}
          </button>
        </div>

        {/* ── Collapsible Form ──────────────────────────────────────────────── */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${formOpen ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
            <p className="font-mono text-[10px] text-secondary uppercase tracking-widest mb-4">اشتراك جديد</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Row 1: First person name */}
              <div>
                {isCouple && (
                  <p className="font-mono text-[9px] text-gold uppercase tracking-widest mb-2">الشخص الأول</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>الاسم الأول</label>
                    <input required type="text" className={inputCls} placeholder="مثال: خالد"
                      value={form.firstName}
                      onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>الاسم الأخير</label>
                    <input required type="text" className={inputCls} placeholder="مثال: الراشدي"
                      value={form.lastName}
                      onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Row 2: Phone */}
              <div className="sm:w-1/2">
                <label className={labelCls}>رقم الهاتف (اختياري)</label>
                <input type="tel" className={`${inputCls} ${phoneError ? "border-red/60" : ""}`}
                  placeholder="09XXXXXXXX" dir="ltr"
                  value={form.phone}
                  onChange={(e) => { setForm((p) => ({ ...p, phone: e.target.value })); setPhoneError(""); }} />
                {phoneError && <p className="mt-1 font-mono text-[10px] text-red">{phoneError}</p>}
              </div>

              {/* Couple: second person */}
              {isCouple && (
                <div className="space-y-4 border-t border-gold/20 pt-4">
                  <p className="font-mono text-[9px] text-gold uppercase tracking-widest">الشخص الثاني</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>الاسم الأول</label>
                      <input required type="text" className={inputCls} placeholder="مثال: نورا"
                        value={form.firstName2}
                        onChange={(e) => setForm((p) => ({ ...p, firstName2: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>الاسم الأخير</label>
                      <input required type="text" className={inputCls} placeholder="مثال: الراشدي"
                        value={form.lastName2}
                        onChange={(e) => setForm((p) => ({ ...p, lastName2: e.target.value }))} />
                    </div>
                  </div>
                  <div className="sm:w-1/2">
                    <label className={labelCls}>رقم الهاتف (اختياري)</label>
                    <input type="tel" className={inputCls} placeholder="09XXXXXXXX" dir="ltr"
                      value={form.phone2}
                      onChange={(e) => setForm((p) => ({ ...p, phone2: e.target.value }))} />
                  </div>
                  <CoupleSummaryPanel perPerson={perPersonAmount} total={perPersonAmount * 2} />
                </div>
              )}

              {/* Row 3: Plan / Offer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>نوع الخطة</label>
                  <div className="relative">
                    <select className={selectCls} value={form.planType}
                      onChange={(e) => handlePlanChange(e.target.value as PlanType)}>
                      {PLAN_TYPES.map((p) => (
                        <option key={p} value={p}>{getPlanLabel(p)} — ${PLAN_BASE_PRICES[p]}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                      <ChevronIcon open={false} />
                    </span>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>العرض</label>
                  <div className="relative">
                    <select className={selectCls} value={form.offer}
                      onChange={(e) => handleOfferChange(e.target.value as OfferType)}>
                      {OFFER_TYPES.map((o) => {
                        const isPriceOffer = PRICE_OFFERS.includes(o);
                        const disabled = isPriceOffer && form.planType !== "1_month";
                        return (
                          <option key={o} value={o} disabled={disabled}>
                            {getOfferLabel(o)}{disabled ? " — شهر واحد فقط" : ""}
                          </option>
                        );
                      })}
                    </select>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                      <ChevronIcon open={false} />
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 4: Start Date / Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>تاريخ البدء</label>
                  <input required type="date" className={inputCls} value={form.startDate}
                    onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>المبلغ ($)</label>
                  <input required type="number" min={0} step="0.01" className={inputCls}
                    value={form.amount}
                    onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
                </div>
              </div>

              {/* Row 5: Payment status */}
              <div className="sm:w-1/2">
                <label className={labelCls}>حالة الدفع</label>
                <div className="relative">
                  <select className={selectCls} value={form.paymentStatus}
                    onChange={(e) => setForm((p) => ({ ...p, paymentStatus: e.target.value as PaymentStatus, paidAmount: "" }))}>
                    <option value="paid">مدفوع</option>
                    <option value="partial">جزئي</option>
                    <option value="unpaid">غير مدفوع</option>
                  </select>
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                    <ChevronIcon open={false} />
                  </span>
                </div>
              </div>

              {form.paymentStatus === "partial" && (
                <div className="sm:w-1/2">
                  <label className={labelCls}>المبلغ المدفوع ($)</label>
                  <input required type="number" min={0} max={Number(form.amount)} step="0.01" className={inputCls}
                    placeholder="المبلغ المحصّل حتى الآن"
                    value={form.paidAmount}
                    onChange={(e) => setForm((p) => ({ ...p, paidAmount: e.target.value }))} />
                </div>
              )}

              {/* End-date preview */}
              {form.startDate && (
                <div className="flex items-start gap-4 p-3 bg-void border border-gunmetal rounded">
                  <div>
                    <p className="font-mono text-[9px] text-slate uppercase tracking-widest mb-0.5">البدء</p>
                    <p className="font-mono text-sm text-ghost tabular-nums">{formatDate(form.startDate)}</p>
                  </div>
                  <div className="self-center text-slate/40 font-mono text-xs">←</div>
                  <div>
                    <p className="font-mono text-[9px] text-slate uppercase tracking-widest mb-0.5">تاريخ الانتهاء (محسوب تلقائياً)</p>
                    <p className="font-display text-xl tracking-wider text-gold-bright leading-none">{formatDate(computedEndDate)}</p>
                  </div>
                  <div className="mr-auto text-left">
                    <p className="font-mono text-[9px] text-slate uppercase tracking-widest mb-0.5">المدة</p>
                    <p className="font-mono text-sm text-offwhite tabular-nums">{calculateRemainingDays(computedEndDate)} يوم متبقي</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright active:bg-gold-deep text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors duration-150">
                  <LockIcon size={13} />
                  {isCouple ? "قفل وحفظ اشتراكَي الزوجين" : "قفل وحفظ الاشتراك"}
                </button>
                <button type="button"
                  onClick={() => { setForm(DEFAULT_FORM); setPhoneError(""); setFormOpen(false); }}
                  className="px-4 py-2.5 bg-transparent border border-gunmetal hover:border-secondary text-secondary hover:text-ghost font-body text-sm rounded transition-colors duration-150">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Search bar ────────────────────────────────────────────────────── */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم أو رقم الهاتف…"
            className="w-full bg-charcoal border border-gunmetal text-offwhite font-body text-sm px-4 py-2 rounded focus:outline-none focus:border-gold/50 placeholder:text-slate transition-colors"
            dir="rtl"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate hover:text-ghost font-mono text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* ── Filter Tabs + Sort ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-gunmetal pb-0 -mb-px">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {FILTER_TABS.map(({ key, label }) => {
              const isActive = activeFilter === key;
              const count = filterCounts[key];
              return (
                <button key={key} onClick={() => setActiveFilter(key)}
                  className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider whitespace-nowrap transition-colors duration-150 border-b-2 -mb-px ${
                    isActive ? "border-gold text-gold" : "border-transparent text-secondary hover:text-ghost"
                  }`}>
                  {label}
                  {count > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full font-mono text-[9px] tabular-nums ${isActive ? "bg-gold/20 text-gold" : "bg-gunmetal text-slate"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-slate">ترتيب:</span>
            <button onClick={() => setSortMode("alpha")}
              className={`px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer ${sortMode === "alpha" ? "bg-gunmetal text-offwhite" : "text-secondary hover:text-ghost"}`}>
              أبجدي
            </button>
            <button onClick={() => setSortMode("date")}
              className={`px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer ${sortMode === "date" ? "bg-gunmetal text-offwhite" : "text-secondary hover:text-ghost"}`}>
              بالتاريخ
            </button>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded border border-gunmetal">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="bg-charcoal">
                {["اسم العضو", "الهاتف", "الخطة", "العرض", "تاريخ البدء", "تاريخ الانتهاء", "الأيام المتبقية", "المبلغ", "حالة الدفع", "الحالة", ""].map((col) => (
                  <th key={col} className="px-3.5 py-2.5 text-right font-mono text-[10px] text-secondary uppercase tracking-wider whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center font-mono text-xs text-slate uppercase tracking-wider">
                    لا توجد اشتراكات تطابق هذا الفلتر
                  </td>
                </tr>
              )}
              {filtered.map((sub) => {
                const isCancelled = sub.status === "cancelled";
                return (
                  <tr key={sub.id}
                    className={`ox-table-row bg-iron/50 border-b border-gunmetal last:border-b-0 transition-colors duration-100 hover:bg-gunmetal/60 ${sub.status === "expired" || isCancelled ? "opacity-60" : ""} ${rowAccent(sub)}`}>
                    <td className="px-3.5 py-3 font-body font-medium text-sm text-offwhite whitespace-nowrap">{sub.memberName}</td>
                    <td className="px-3.5 py-3 font-mono text-xs text-ghost tabular-nums whitespace-nowrap dir-ltr">
                      {sub.phoneNumber ?? <span className="text-slate">—</span>}
                    </td>
                    <td className="px-3.5 py-3"><PlanBadge plan={sub.planType} /></td>
                    <td className="px-3.5 py-3">
                      {sub.offer !== "none" ? <OfferTag offer={sub.offer} /> : <span className="text-slate font-mono text-xs">—</span>}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-xs text-ghost tabular-nums whitespace-nowrap">{formatDate(sub.startDate)}</td>
                    <td className="px-3.5 py-3 font-mono text-xs text-ghost tabular-nums whitespace-nowrap">{formatDate(sub.endDate)}</td>
                    <td className="px-3.5 py-3"><RemainingDaysBadge days={sub.remainingDays} status={sub.status} /></td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <span className="font-mono text-xs text-offwhite tabular-nums font-semibold">{formatCurrency(sub.amount)} $</span>
                      {sub.paymentStatus === "partial" && (
                        <span className="block font-mono text-[9px] text-gold tabular-nums">مدفوع: {formatCurrency(sub.paidAmount)} $</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3"><PaymentStatusChip status={sub.paymentStatus} /></td>
                    <td className="px-3.5 py-3"><SubStatusChip status={sub.status} /></td>
                    <td className="px-3.5 py-3 text-center">
                      {!isCancelled ? (
                        <button
                          onClick={() => cancelSubscriptionLocal(sub.id)}
                          className="p-1 text-secondary hover:text-red transition-colors cursor-pointer"
                          title="إلغاء الاشتراك"
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M2 11L11 2M2 2l9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                          </svg>
                        </button>
                      ) : (
                        <span className="font-mono text-[9px] text-red">ملغي</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Footer meta ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <p className="font-mono text-[10px] text-slate uppercase tracking-wider">
            عرض {filtered.length} من {subscriptions.length} اشتراك
          </p>
          <p className="font-mono text-[10px] text-slate tabular-nums">
            الإجمالي: <span className="text-gold">{formatCurrency(filtered.reduce((acc, s) => acc + s.amount, 0))} $</span>
          </p>
        </div>
      </section>
    </>
  );
}
