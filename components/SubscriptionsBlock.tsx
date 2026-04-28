"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  type Subscription,
  PlanType,
  OfferType,
  PaymentStatus,
  SubStatus,
} from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getPlanLabel,
  getOfferLabel,
  calculateEndDate,
  calculateRemainingDays,
  calculateDiscountedPrice,
} from "@/lib/business-logic";
import PriceTag from "@/components/PriceTag";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/lib/auth-context";
import { useCurrency } from "@/lib/currency-context";
import { pushSubscription, cancelTransaction } from "@/lib/supabase/intake";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAN_BASE_PRICES: Record<PlanType, number> = {
  "1_month": 35,
  "3_months": 90,
  "6_months": 170,
  "9_months": 235,
  "12_months": 300,
};

type SortMode = "alpha" | "date";

const PLAN_TYPES: PlanType[] = [
  "1_month",
  "3_months",
  "6_months",
  "9_months",
  "12_months",
];

const OFFER_TYPES: OfferType[] = [
  "none",
  "referral_4",
  "referral_9",
  "couple",
  "corporate",
];

// ─── Filter type ──────────────────────────────────────────────────────────────

type FilterTab = "all" | "active" | "expiring" | "unpaid" | "expired";

// ─── Form state ───────────────────────────────────────────────────────────────

type FormCurrency = "syp" | "usd";

interface FormState {
  memberName: string;
  phone: string;
  planType: PlanType;
  offer: OfferType;
  startDate: string;
  amount: string;
  currency: FormCurrency;
  paymentStatus: PaymentStatus;
  paidAmount: string;
}

const DEFAULT_FORM: FormState = {
  memberName: "",
  phone: "",
  planType: "1_month",
  offer: "none",
  startDate: new Date().toISOString().split("T")[0],
  amount: String(PLAN_BASE_PRICES["1_month"]),
  currency: "usd",
  paymentStatus: "paid",
  paidAmount: "",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: PlanType }) {
  const colorMap: Record<PlanType, string> = {
    "1_month":  "bg-gunmetal text-offwhite border-gunmetal",
    "3_months": "bg-gold-dim/20 text-gold border-gold-dim/40",
    "6_months": "bg-gold-dim/30 text-gold-bright border-gold-dim/50",
    "9_months": "bg-gold/15 text-gold-bright border-gold/30",
    "12_months":"bg-gold/25 text-gold-bright border-gold/40 glow-gold-sm",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium border uppercase tracking-wider ${colorMap[plan]}`}
    >
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
    return (
      <span className="font-mono text-xs text-slate tabular-nums">—</span>
    );
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
  if (days > 30) {
    return (
      <span className="font-mono text-xs text-success tabular-nums font-medium">{days}</span>
    );
  }
  if (days >= 7) {
    return (
      <span className="font-mono text-xs text-gold tabular-nums font-medium">{days}</span>
    );
  }
  return (
    <span className="font-mono text-xs text-red tabular-nums font-bold animate-pulse">{days}</span>
  );
}

function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { label: string; cls: string }> = {
    paid: {
      label: "مدفوع",
      cls: "bg-success/10 text-success border-success/25",
    },
    partial: {
      label: "جزئي",
      cls: "bg-gold/10 text-gold border-gold/25",
    },
    unpaid: {
      label: "غير مدفوع",
      cls: "bg-red/10 text-red border-red/25",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function SubStatusChip({ status }: { status: SubStatus }) {
  const map: Record<SubStatus, { label: string; cls: string }> = {
    active: {
      label: "نشط",
      cls: "bg-success/10 text-success border-success/20",
    },
    expired: {
      label: "منتهي",
      cls: "bg-gunmetal text-secondary border-gunmetal",
    },
    frozen: {
      label: "مجمّد",
      cls: "bg-slate/10 text-slate border-slate/20",
    },
    cancelled: {
      label: "ملغي",
      cls: "bg-red/10 text-red border-red/20",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="6" width="10" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="7" cy="9.5" r="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`}
      aria-hidden="true"
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SubscriptionsBlock() {
  const { subscriptions, addSubscription, cancelSubscriptionLocal } = useStore();
  const { user } = useAuth();
  const { exchangeRate } = useCurrency();
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [sortMode, setSortMode] = useState<SortMode>("alpha");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Derived: auto-calculate amount when plan/offer changes ──────────────────

  const computedEndDate = calculateEndDate(form.startDate, form.planType, form.offer);

  const handlePlanChange = useCallback(
    (planType: PlanType) => {
      const base = PLAN_BASE_PRICES[planType];
      const discounted = calculateDiscountedPrice(base, form.offer, planType);
      setForm((prev) => ({
        ...prev,
        planType,
        amount: String(discounted),
      }));
    },
    [form.offer]
  );

  const handleOfferChange = useCallback(
    (offer: OfferType) => {
      const base = PLAN_BASE_PRICES[form.planType];
      const discounted = calculateDiscountedPrice(base, offer, form.planType);
      setForm((prev) => ({
        ...prev,
        offer,
        amount: String(discounted),
      }));
    },
    [form.planType]
  );

  // ── Filter logic ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = subscriptions.filter((sub) => {
      if (sub.status === "cancelled") return activeFilter === "all" ? false : false;
      if (activeFilter === "all") return true;
      if (activeFilter === "active") return sub.status === "active";
      if (activeFilter === "expired") return sub.status === "expired";
      if (activeFilter === "unpaid")
        return sub.paymentStatus === "unpaid" || sub.paymentStatus === "partial";
      if (activeFilter === "expiring")
        return sub.status === "active" && sub.remainingDays > 0 && sub.remainingDays <= 7;
      return true;
    });
    if (sortMode === "alpha") {
      result = [...result].sort((a, b) => a.memberName.localeCompare(b.memberName, "ar"));
    } else {
      result = [...result].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }
    return result;
  }, [subscriptions, activeFilter, sortMode]);

  const filterCounts: Record<FilterTab, number> = {
    all: subscriptions.filter(s => s.status !== "cancelled").length,
    active: subscriptions.filter((s) => s.status === "active").length,
    expiring: subscriptions.filter(
      (s) => s.status === "active" && s.remainingDays > 0 && s.remainingDays <= 7
    ).length,
    unpaid: subscriptions.filter(
      (s) => s.paymentStatus === "unpaid" || s.paymentStatus === "partial"
    ).length,
    expired: subscriptions.filter((s) => s.status === "expired").length,
  };

  // ── Form submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitError(null);

    const endDate = computedEndDate;
    const remaining = calculateRemainingDays(endDate);
    const amount = Number(form.amount) || 0;
    const paidAmt =
      form.paymentStatus === "partial"
        ? Number(form.paidAmount) || 0
        : form.paymentStatus === "paid"
        ? amount
        : 0;
    const cur = form.currency;

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: form.memberName.trim(),
      planType: form.planType,
      offer: form.offer,
      startDate: form.startDate,
      endDate,
      amount,
      paidAmount: paidAmt,
      paymentStatus: form.paymentStatus,
      currency: cur as "syp" | "usd",
      exchangeRate,
    });

    if (r.error) { setSubmitError(r.error); return; }

    const row = r.data!;
    const sub: Subscription = {
      id: String(row.id),
      memberId: String(row.created_by ?? user.id),
      memberName: form.memberName.trim(),
      planType: form.planType,
      offer: form.offer,
      startDate: form.startDate,
      endDate,
      remainingDays: remaining,
      amount,
      paidAmount: paidAmt,
      paymentStatus: form.paymentStatus,
      paymentMethod: cur === "syp" ? "cash" : "transfer",
      currency: cur,
      status: remaining > 0 ? "active" : "expired",
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(row.created_at ?? new Date().toISOString()),
    };
    addSubscription(sub);
    setForm(DEFAULT_FORM);
    setFormOpen(false);
    setToastMessage("تم حفظ الاشتراك بنجاح");
  };

  // ── Row accent helper ────────────────────────────────────────────────────────

  const rowAccent = (sub: Subscription): string => {
    if (sub.paymentStatus === "unpaid") return "border-l-2 border-l-red";
    if (sub.paymentStatus === "partial") return "border-l-2 border-l-gold";
    return "border-l-2 border-l-transparent";
  };

  const FILTER_TABS: { key: FilterTab; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "active", label: "نشط" },
    { key: "expiring", label: "ينتهي قريباً" },
    { key: "unpaid", label: "غير مدفوع" },
    { key: "expired", label: "منتهي" },
  ];

  // ── Input / select base classes ──────────────────────────────────────────────
  const inputCls =
    "ox-input w-full bg-charcoal border border-gunmetal text-offwhite font-body text-sm px-3 py-2 rounded focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20 placeholder:text-slate transition-colors";
  const selectCls =
    "ox-select w-full bg-charcoal border border-gunmetal text-offwhite font-body text-sm px-3 py-2 rounded focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/20 transition-colors appearance-none cursor-pointer";
  const labelCls = "block font-mono text-[10px] text-secondary uppercase tracking-wider mb-1.5";

  return (
    <>
      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toastMessage && (
        <Toast message={toastMessage} onDone={() => setToastMessage(null)} />
      )}

      {/* ── Main block ────────────────────────────────────────────────────── */}
      <section className="bg-iron border border-gunmetal rounded p-5 space-y-5" dir="rtl">
        {/* ── Header ──────────────────────────────────────────────────────── */}
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
            {formOpen ? (
              <>
                <ChevronIcon open={true} />
                إلغاء
              </>
            ) : (
              <>
                <PlusIcon />
                اشتراك جديد
              </>
            )}
          </button>
        </div>

        {/* ── Collapsible Form ─────────────────────────────────────────────── */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            formOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
            <p className="font-mono text-[10px] text-secondary uppercase tracking-widest mb-4">
              اشتراك جديد
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Row 1: Member / Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>اسم العضو</label>
                  <input
                    required
                    type="text"
                    className={inputCls}
                    placeholder="الاسم الكامل"
                    value={form.memberName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, memberName: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>الهاتف</label>
                  <input
                    type="tel"
                    className={inputCls}
                    placeholder="+966 5x xxx xxxx"
                    value={form.phone}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, phone: e.target.value }))
                    }
                  />
                </div>
              </div>

              {/* Row 2: Plan / Offer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>نوع الخطة</label>
                  <div className="relative">
                    <select
                      className={selectCls}
                      value={form.planType}
                      onChange={(e) => handlePlanChange(e.target.value as PlanType)}
                    >
                      {PLAN_TYPES.map((p) => (
                        <option key={p} value={p}>
                          {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} $
                        </option>
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
                    <select
                      className={selectCls}
                      value={form.offer}
                      onChange={(e) => handleOfferChange(e.target.value as OfferType)}
                    >
                      {OFFER_TYPES.map((o) => (
                        <option key={o} value={o}>
                          {getOfferLabel(o)}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                      <ChevronIcon open={false} />
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 3: Start Date / Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>تاريخ البدء</label>
                  <input
                    required
                    type="date"
                    className={inputCls}
                    value={form.startDate}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, startDate: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>المبلغ ($)</label>
                  <input
                    required
                    type="number"
                    min={0}
                    className={inputCls}
                    value={form.amount}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, amount: e.target.value }))
                    }
                  />
                </div>
              </div>

              {/* Row 4: Currency / Payment status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>العملة</label>
                  <div className="relative">
                    <select
                      className={selectCls}
                      value={form.currency}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          currency: e.target.value as FormCurrency,
                        }))
                      }
                    >
                      <option value="usd">دولار</option>
                      <option value="syp">ليرة سورية</option>
                    </select>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                      <ChevronIcon open={false} />
                    </span>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>حالة الدفع</label>
                  <div className="relative">
                    <select
                      className={selectCls}
                      value={form.paymentStatus}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          paymentStatus: e.target.value as PaymentStatus,
                          paidAmount: "",
                        }))
                      }
                    >
                      <option value="paid">مدفوع</option>
                      <option value="partial">جزئي</option>
                      <option value="unpaid">غير مدفوع</option>
                    </select>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary">
                      <ChevronIcon open={false} />
                    </span>
                  </div>
                </div>
              </div>

              {/* Paid amount — only when partial */}
              {form.paymentStatus === "partial" && (
                <div className="sm:w-1/2">
                  <label className={labelCls}>المبلغ المدفوع ($)</label>
                  <input
                    required
                    type="number"
                    min={0}
                    max={Number(form.amount)}
                    className={inputCls}
                    placeholder="المبلغ المحصّل حتى الآن"
                    value={form.paidAmount}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, paidAmount: e.target.value }))
                    }
                  />
                </div>
              )}

              {/* ── End-date preview ──────────────────────────────────────── */}
              {form.startDate && (
                <div className="flex items-start gap-4 p-3 bg-void border border-gunmetal rounded">
                  <div>
                    <p className="font-mono text-[9px] text-slate uppercase tracking-widest mb-0.5">
                      البدء
                    </p>
                    <p className="font-mono text-sm text-ghost tabular-nums">
                      {formatDate(form.startDate)}
                    </p>
                  </div>
                  <div className="self-center text-slate/40 font-mono text-xs">←</div>
                  <div>
                    <p className="font-mono text-[9px] text-slate uppercase tracking-widest mb-0.5">
                      تاريخ الانتهاء (محسوب تلقائياً)
                    </p>
                    <p className="font-display text-xl tracking-wider text-gold-bright leading-none">
                      {formatDate(computedEndDate)}
                    </p>
                  </div>
                  <div className="mr-auto text-left">
                    <p className="font-mono text-[9px] text-slate uppercase tracking-widest mb-0.5">
                      المدة
                    </p>
                    <p className="font-mono text-sm text-offwhite tabular-nums">
                      {calculateRemainingDays(computedEndDate)} يوم متبقي
                    </p>
                  </div>
                </div>
              )}

              {submitError && (
                <div className="flex items-center gap-2 p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">
                  {submitError}
                </div>
              )}

              {/* ── Actions ──────────────────────────────────────────────── */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright active:bg-gold-deep text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors duration-150"
                >
                  <LockIcon size={13} />
                  قفل وحفظ الاشتراك
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForm(DEFAULT_FORM);
                    setFormOpen(false);
                  }}
                  className="px-4 py-2.5 bg-transparent border border-gunmetal hover:border-secondary text-secondary hover:text-ghost font-body text-sm rounded transition-colors duration-150"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* ── Filter Tabs + Sort ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-gunmetal pb-0 -mb-px">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {FILTER_TABS.map(({ key, label }) => {
            const isActive = activeFilter === key;
            const count = filterCounts[key];
            return (
              <button
                key={key}
                onClick={() => setActiveFilter(key)}
                className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider whitespace-nowrap transition-colors duration-150 border-b-2 -mb-px ${
                  isActive
                    ? "border-gold text-gold"
                    : "border-transparent text-secondary hover:text-ghost"
                }`}
              >
                {label}
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full font-mono text-[9px] tabular-nums ${
                      isActive
                        ? "bg-gold/20 text-gold"
                        : "bg-gunmetal text-slate"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          </div>
          {/* Sort controls */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-slate">ترتيب:</span>
            <button
              onClick={() => setSortMode("alpha")}
              className={`px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer ${sortMode === "alpha" ? "bg-gunmetal text-offwhite" : "text-secondary hover:text-ghost"}`}
            >أبجدي</button>
            <button
              onClick={() => setSortMode("date")}
              className={`px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer ${sortMode === "date" ? "bg-gunmetal text-offwhite" : "text-secondary hover:text-ghost"}`}
            >بالتاريخ</button>
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="overflow-x-auto rounded border border-gunmetal">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="bg-charcoal">
                {[
                  "اسم العضو",
                  "الخطة",
                  "العرض",
                  "تاريخ البدء",
                  "تاريخ الانتهاء",
                  "الأيام المتبقية",
                  "المبلغ",
                  "الحالة",
                  "",
                ].map((col, i) => (
                  <th
                    key={i}
                    className="px-3.5 py-2.5 text-right font-mono text-[10px] text-secondary uppercase tracking-wider whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center font-mono text-xs text-slate uppercase tracking-wider"
                  >
                    {subscriptions.length === 0 ? "لا توجد اشتراكات" : "لا توجد اشتراكات تطابق هذا الفلتر"}
                  </td>
                </tr>
              )}
              {filtered.map((sub) => (
                <tr
                  key={sub.id}
                  className={`ox-table-row bg-iron/50 border-b border-gunmetal last:border-b-0 transition-colors duration-100 hover:bg-gunmetal/60 ${
                    sub.status === "expired" ? "opacity-60" : ""
                  } ${rowAccent(sub)}`}
                >
                  {/* Member Name */}
                  <td className="px-3.5 py-3 font-body font-medium text-sm text-offwhite whitespace-nowrap">
                    {sub.memberName}
                  </td>

                  {/* Plan */}
                  <td className="px-3.5 py-3">
                    <PlanBadge plan={sub.planType} />
                  </td>

                  {/* Offer */}
                  <td className="px-3.5 py-3">
                    {sub.offer !== "none" ? (
                      <OfferTag offer={sub.offer} />
                    ) : (
                      <span className="text-slate font-mono text-xs">—</span>
                    )}
                  </td>

                  {/* Start Date */}
                  <td className="px-3.5 py-3 font-mono text-xs text-ghost tabular-nums whitespace-nowrap">
                    {formatDate(sub.startDate)}
                  </td>

                  {/* End Date */}
                  <td className="px-3.5 py-3 font-mono text-xs text-ghost tabular-nums whitespace-nowrap">
                    {formatDate(sub.endDate)}
                  </td>

                  {/* Remaining Days */}
                  <td className="px-3.5 py-3">
                    <RemainingDaysBadge days={sub.remainingDays} status={sub.status} />
                  </td>

                  {/* Amount */}
                  <td className="px-3.5 py-3 whitespace-nowrap">
                    <span className="font-mono text-xs text-offwhite tabular-nums font-semibold">
                      {formatCurrency(sub.amount)} $
                    </span>
                    {sub.paymentStatus === "partial" && (
                      <span className="block font-mono text-[9px] text-gold tabular-nums">
                        مدفوع: {formatCurrency(sub.paidAmount)} $
                      </span>
                    )}
                  </td>

                  {/* Sub Status */}
                  <td className="px-3.5 py-3">
                    <SubStatusChip status={sub.status} />
                  </td>

                  {/* Cancel */}
                  <td className="px-3.5 py-3 text-center">
                    {sub.status !== "expired" && sub.status !== "cancelled" ? (
                      <button
                        onClick={async () => {
                          if (!user) return;
                          const r = await cancelTransaction({
                            user: { id: user.id, displayName: user.displayName },
                            table: "subscriptions",
                            id: sub.id,
                          });
                          if (!r.error) cancelSubscriptionLocal(sub.id);
                        }}
                        className="p-1 text-secondary hover:text-red transition-colors cursor-pointer"
                        title="إلغاء الاشتراك"
                      >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 11L6.5 6.5M11 2L6.5 6.5M6.5 6.5L2 2M6.5 6.5L11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer meta ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <p className="font-mono text-[10px] text-slate uppercase tracking-wider">
            عرض {filtered.length} من {subscriptions.length} اشتراك
          </p>
          <p className="font-mono text-[10px] text-slate tabular-nums">
            الإجمالي:{" "}
            <span className="text-gold">
              {formatCurrency(
                filtered.reduce((acc, s) => acc + s.amount, 0)
              )}{" "}
              $
            </span>
          </p>
        </div>
      </section>
    </>
  );
}
