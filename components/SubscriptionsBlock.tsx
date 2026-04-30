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
import {
  pushSubscription,
  cancelTransaction,
  pushPrivateSession,
  pushGroupOffer,
} from "@/lib/supabase/intake";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAN_BASE_PRICES: Record<PlanType, number> = {
  "1_month":  35,
  "3_months": 90,
  "6_months": 170,
  "9_months": 235,
  "12_months": 300,
};

const PLAN_DISCOUNTS: Record<PlanType, number> = {
  "1_month":  0,
  "3_months": 15,
  "6_months": 20,
  "9_months": 25,
  "12_months": 30,
};

const PLAN_TYPES: PlanType[] = [
  "1_month",
  "3_months",
  "6_months",
  "9_months",
  "12_months",
];


function ptCalc(n: number) {
  const groupPrice = n <= 2 ? 10 : n <= 5 ? 15 : 18;
  return { groupPrice, trainerFee: 18, total: groupPrice + 18 };
}

// ─── Local types ──────────────────────────────────────────────────────────────

type MainTab  = "subscriptions" | "offers";
type SubType  = "normal" | "private";
type OfferTab = "couple" | "referral" | "corporate" | "college";
type SortMode = "alpha" | "date";
type FilterTab = "all" | "active" | "expiring" | "unpaid" | "expired";
// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  memberName: string;
  phone: string;
  planType: PlanType;
  startDate: string;
  amount: string;
}

const DEFAULT_FORM: FormState = {
  memberName: "",
  phone: "",
  planType: "1_month",
  startDate: new Date().toISOString().split("T")[0],
  amount: String(PLAN_BASE_PRICES["1_month"]),
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
    active:    { label: "نشط",    cls: "bg-success/10 text-success border-success/20" },
    expired:   { label: "منتهي",  cls: "bg-gunmetal text-secondary border-gunmetal" },
    frozen:    { label: "مجمّد",  cls: "bg-slate/10 text-slate border-slate/20" },
    cancelled: { label: "ملغي",   cls: "bg-red/10 text-red border-red/20" },
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
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="6" width="10" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7" cy="9.5" r="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"
      className={`transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`} aria-hidden="true">
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

  // ── Main view tabs ─────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState<MainTab>("subscriptions");

  // ── Subscriptions view state ───────────────────────────────────────────────
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [sortMode, setSortMode]         = useState<SortMode>("alpha");
  const [formOpen, setFormOpen]         = useState(false);
  const [subType, setSubType]           = useState<SubType>("normal");
  const [form, setForm]                 = useState<FormState>(DEFAULT_FORM);
  const [submitError, setSubmitError]   = useState<string | null>(null);

  // ── Private training state ─────────────────────────────────────────────────
  const [ptCount, setPtCount]   = useState(1);
  const [ptNames, setPtNames]   = useState<string[]>([""]);
  const [ptNotes, setPtNotes]   = useState("");
  const [ptBusy, setPtBusy]     = useState(false);
  const [ptError, setPtError]   = useState<string | null>(null);

  // ── Offers tab state ───────────────────────────────────────────────────────
  const [offerTab, setOfferTab] = useState<OfferTab>("couple");

  // Couple offer
  const [coupleNames,      setCoupleNames]      = useState(["", ""]);
  const [coupleStart,      setCoupleStart]      = useState(new Date().toISOString().split("T")[0]);
  const [couplePayStatus,  setCouplePayStatus]  = useState<PaymentStatus>("paid");
  const [coupleBusy,       setCoupleBusy]       = useState(false);
  const [coupleError,      setCoupleError]      = useState<string | null>(null);

  // Referral offer
  const [refMain,       setRefMain]       = useState("");
  const [refFriends,    setRefFriends]    = useState<string[]>(["", "", "", "", ""]);
  const [refPlan,       setRefPlan]       = useState<PlanType>("1_month");
  const [refStart,      setRefStart]      = useState(new Date().toISOString().split("T")[0]);
  const [refPayStatus,  setRefPayStatus]  = useState<PaymentStatus>("paid");
  const [refBusy,       setRefBusy]       = useState(false);
  const [refError,      setRefError]      = useState<string | null>(null);

  // Corporate offer
  const [corpName,      setCorpName]      = useState("");
  const [corpOrg,       setCorpOrg]       = useState<"company" | "bank">("company");
  const [corpPlan,      setCorpPlan]      = useState<PlanType>("1_month");
  const [corpStart,     setCorpStart]     = useState(new Date().toISOString().split("T")[0]);
  const [corpPayStatus, setCorpPayStatus] = useState<PaymentStatus>("paid");
  const [corpBusy,      setCorpBusy]      = useState(false);
  const [corpError,     setCorpError]     = useState<string | null>(null);

  // College offer
  const [collegeName,      setCollegeName]      = useState("");
  const [collegePlan,      setCollegePlan]      = useState<PlanType>("1_month");
  const [collegeStart,     setCollegeStart]     = useState(new Date().toISOString().split("T")[0]);
  const [collegePayStatus, setCollegePayStatus] = useState<PaymentStatus>("paid");
  const [collegeBusy,      setCollegeBusy]      = useState(false);
  const [collegeError,     setCollegeError]     = useState<string | null>(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Derived: auto-calculate amount when plan/offer changes ────────────────
  const computedEndDate = calculateEndDate(form.startDate, form.planType, "none");

  const handlePlanChange = useCallback((planType: PlanType) => {
    setForm((prev) => ({ ...prev, planType, amount: String(PLAN_BASE_PRICES[planType]) }));
  }, []);

  // ── Filter logic ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = subscriptions.filter((sub) => {
      if (sub.status === "cancelled") return false;
      if (activeFilter === "all")      return true;
      if (activeFilter === "active")   return sub.status === "active";
      if (activeFilter === "expired")  return sub.status === "expired";
      if (activeFilter === "unpaid")   return sub.paymentStatus === "unpaid" || sub.paymentStatus === "partial";
      if (activeFilter === "expiring") return sub.status === "active" && sub.remainingDays > 0 && sub.remainingDays <= 7;
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
    all:      subscriptions.filter((s) => s.status !== "cancelled").length,
    active:   subscriptions.filter((s) => s.status === "active").length,
    expiring: subscriptions.filter((s) => s.status === "active" && s.remainingDays > 0 && s.remainingDays <= 7).length,
    unpaid:   subscriptions.filter((s) => s.paymentStatus === "unpaid" || s.paymentStatus === "partial").length,
    expired:  subscriptions.filter((s) => s.status === "expired").length,
  };

  // ── Normal subscription submit ─────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitError(null);

    const endDate   = computedEndDate;
    const remaining = calculateRemainingDays(endDate);
    const amount    = Number(form.amount) || 0;

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: form.memberName.trim(),
      planType: form.planType,
      offer: "none",
      startDate: form.startDate,
      endDate,
      amount,
      paidAmount: amount,
      paymentStatus: "paid",
      currency: "usd",
      exchangeRate,
    });

    if (r.error) { setSubmitError(r.error); return; }

    const row = r.data!;
    addSubscription({
      id: String(row.id),
      memberId: String(row.created_by ?? user.id),
      memberName: form.memberName.trim(),
      planType: form.planType,
      offer: "none",
      startDate: form.startDate,
      endDate,
      remainingDays: remaining,
      amount,
      paidAmount: amount,
      paymentStatus: "paid",
      paymentMethod: "cash",
      currency: "usd",
      status: remaining > 0 ? "active" : "expired",
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(row.created_at ?? new Date().toISOString()),
    });
    setForm(DEFAULT_FORM);
    setFormOpen(false);
    setToastMessage("تم حفظ الاشتراك بنجاح");
  };

  // ── Private training submit ────────────────────────────────────────────────
  const handlePrivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setPtError(null);
    const validNames = ptNames.filter((n) => n.trim());
    if (validNames.length === 0) { setPtError("أدخل اسم لاعب واحد على الأقل"); return; }
    setPtBusy(true);
    const r = await pushPrivateSession({
      user: { id: user.id, displayName: user.displayName },
      numberOfPlayers: ptCount,
      playerNames: validNames,
      notes: ptNotes,
      exchangeRate,
    });
    setPtBusy(false);
    if (r.error) { setPtError(r.error); return; }
    setPtCount(1); setPtNames([""]); setPtNotes("");
    setFormOpen(false);
    setToastMessage(`تم حفظ جلسة التدريب الخاص — ${ptCount} لاعبين`);
  };

  // ── Couple offer submit ────────────────────────────────────────────────────
  const handleCoupleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCoupleError(null);
    if (!coupleNames[0].trim() || !coupleNames[1].trim()) { setCoupleError("أدخل اسمَي الشخصين"); return; }
    setCoupleBusy(true);
    const groupId = crypto.randomUUID();
    const endDate = calculateEndDate(coupleStart, "1_month", "couple");
    const paidAmt = couplePayStatus === "paid" ? 30 : 0;

    const r1 = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: coupleNames[0].trim(),
      planType: "1_month", offer: "couple",
      startDate: coupleStart, endDate,
      amount: 30, paidAmount: paidAmt,
      paymentStatus: couplePayStatus,
      currency: "usd", exchangeRate, groupId,
    });
    if (r1.error) { setCoupleError(r1.error); setCoupleBusy(false); return; }

    const r2 = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: coupleNames[1].trim(),
      planType: "1_month", offer: "couple",
      startDate: coupleStart, endDate,
      amount: 30, paidAmount: paidAmt,
      paymentStatus: couplePayStatus,
      currency: "usd", exchangeRate, groupId,
    });
    if (r2.error) { setCoupleError(r2.error); setCoupleBusy(false); return; }

    await pushGroupOffer({
      user: { id: user.id, displayName: user.displayName },
      groupId, offerType: "couple",
      members: coupleNames.map((n) => ({ name: n.trim() })),
      priceApplied: 60,
    });

    const rem = calculateRemainingDays(endDate);
    [r1.data!, r2.data!].forEach((row, i) => {
      addSubscription({
        id: String(row.id),
        memberId: String(row.created_by ?? user.id),
        memberName: coupleNames[i].trim(),
        planType: "1_month", offer: "couple",
        startDate: coupleStart, endDate,
        remainingDays: rem, amount: 30, paidAmount: paidAmt,
        paymentStatus: couplePayStatus, paymentMethod: "cash",
        currency: "usd",
        status: rem > 0 ? "active" : "expired",
        createdAt: String(row.created_at ?? new Date().toISOString()),
        createdBy: user.id,
        lockedAt: String(row.created_at ?? new Date().toISOString()),
      });
    });

    setCoupleBusy(false);
    setCoupleNames(["", ""]);
    setCoupleStart(new Date().toISOString().split("T")[0]);
    setToastMessage("تم تسجيل عرض الزوجين — شخصان مرتبطان بنفس المجموعة");
  };

  // ── Referral offer submit ──────────────────────────────────────────────────
  const handleReferralSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setRefError(null);
    const validFriends = refFriends.filter((n) => n.trim());
    const count = validFriends.length;
    if (count < 5) { setRefError("يجب إدخال 5 أسماء على الأقل للتأهل للعرض"); return; }
    setRefBusy(true);

    const offerType: OfferType = count >= 9 ? "referral_9" : "referral_4";
    const groupId  = crypto.randomUUID();
    const endDate  = calculateEndDate(refStart, refPlan, offerType);
    const amount   = PLAN_BASE_PRICES[refPlan];
    const paidAmt  = refPayStatus === "paid" ? amount : 0;

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: refMain.trim(),
      planType: refPlan, offer: offerType,
      startDate: refStart, endDate,
      amount, paidAmount: paidAmt,
      paymentStatus: refPayStatus,
      currency: "usd", exchangeRate, groupId,
    });
    if (r.error) { setRefError(r.error); setRefBusy(false); return; }

    await pushGroupOffer({
      user: { id: user.id, displayName: user.displayName },
      groupId, offerType: "referral",
      members: [{ name: refMain.trim() }, ...validFriends.map((n) => ({ name: n.trim() }))],
      referralCount: count,
      rewardType: "free_months",
      rewardValue: count >= 9 ? 2 : 1,
    });

    const rem = calculateRemainingDays(endDate);
    addSubscription({
      id: String(r.data!.id),
      memberId: String(r.data!.created_by ?? user.id),
      memberName: refMain.trim(),
      planType: refPlan, offer: offerType,
      startDate: refStart, endDate,
      remainingDays: rem, amount, paidAmount: paidAmt,
      paymentStatus: refPayStatus, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setRefBusy(false);
    setRefMain(""); setRefFriends(["", "", "", "", ""]); setRefPlan("1_month");
    setRefStart(new Date().toISOString().split("T")[0]);
    setToastMessage(count >= 9 ? "إحالة مسجّلة — شهران مجاناً" : "إحالة مسجّلة — شهر مجاناً");
  };

  // ── Corporate offer submit ─────────────────────────────────────────────────
  const handleCorporateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCorpError(null);
    setCorpBusy(true);
    const basePrice      = PLAN_BASE_PRICES[corpPlan];
    const discountedPrice = Math.round(basePrice * 0.85);
    const endDate        = calculateEndDate(corpStart, corpPlan, "corporate");
    const paidAmt        = corpPayStatus === "paid" ? discountedPrice : 0;
    const groupId        = crypto.randomUUID();

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: corpName.trim(),
      planType: corpPlan, offer: "corporate",
      startDate: corpStart, endDate,
      amount: discountedPrice, paidAmount: paidAmt,
      paymentStatus: corpPayStatus,
      currency: "usd", exchangeRate, groupId,
    });
    if (r.error) { setCorpError(r.error); setCorpBusy(false); return; }

    await pushGroupOffer({
      user: { id: user.id, displayName: user.displayName },
      groupId, offerType: "corporate",
      members: [{ name: corpName.trim() }],
      discountPercent: 15,
      organizationType: corpOrg,
      priceApplied: discountedPrice,
    });

    const rem = calculateRemainingDays(endDate);
    addSubscription({
      id: String(r.data!.id),
      memberId: String(r.data!.created_by ?? user.id),
      memberName: corpName.trim(),
      planType: corpPlan, offer: "corporate",
      startDate: corpStart, endDate,
      remainingDays: rem, amount: discountedPrice, paidAmount: paidAmt,
      paymentStatus: corpPayStatus, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setCorpBusy(false);
    setCorpName(""); setCorpPlan("1_month");
    setCorpStart(new Date().toISOString().split("T")[0]);
    setToastMessage(`تم تسجيل اشتراك شركة بخصم ١٥٪ — $${discountedPrice}`);
  };

  // ── College offer submit ───────────────────────────────────────────────────
  const handleCollegeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCollegeError(null);
    setCollegeBusy(true);
    const basePrice       = PLAN_BASE_PRICES[collegePlan];
    const discountedPrice = calculateDiscountedPrice(basePrice, "college");
    const endDate         = calculateEndDate(collegeStart, collegePlan, "college");
    const paidAmt         = collegePayStatus === "paid" ? discountedPrice : 0;

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: collegeName.trim(),
      planType: collegePlan, offer: "college",
      startDate: collegeStart, endDate,
      amount: discountedPrice, paidAmount: paidAmt,
      paymentStatus: collegePayStatus,
      currency: "usd", exchangeRate,
    });
    if (r.error) { setCollegeError(r.error); setCollegeBusy(false); return; }

    const rem = calculateRemainingDays(endDate);
    addSubscription({
      id: String(r.data!.id),
      memberId: String(r.data!.created_by ?? user.id),
      memberName: collegeName.trim(),
      planType: collegePlan, offer: "college",
      startDate: collegeStart, endDate,
      remainingDays: rem, amount: discountedPrice, paidAmount: paidAmt,
      paymentStatus: collegePayStatus, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setCollegeBusy(false);
    setCollegeName(""); setCollegePlan("1_month");
    setCollegeStart(new Date().toISOString().split("T")[0]);
    setToastMessage(`تم تسجيل اشتراك طالب جامعي بخصم ٢٠٪ — $${discountedPrice}`);
  };

  // ── Row accent helper ──────────────────────────────────────────────────────
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

  const refValidCount = refFriends.filter((n) => n.trim()).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {toastMessage && <Toast message={toastMessage} onDone={() => setToastMessage(null)} />}

      <section className="bg-iron border border-gunmetal rounded p-5 space-y-5" dir="rtl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-display text-2xl tracking-wider text-offwhite uppercase leading-none">
              الاشتراكات
            </h2>
            <span className="inline-flex items-center justify-center min-w-[26px] h-[22px] px-2 bg-gunmetal border border-gunmetal rounded-full font-mono text-xs text-gold tabular-nums font-semibold">
              {subscriptions.length}
            </span>
            {/* Main tab toggle */}
            <div className="flex items-center gap-0.5 bg-void border border-gunmetal rounded p-0.5 mr-2">
              {(["subscriptions", "offers"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setMainTab(tab);
                    if (tab === "offers") { setFormOpen(false); setSubType("normal"); }
                  }}
                  className={`px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors rounded-sm ${
                    mainTab === tab ? "bg-gunmetal text-offwhite" : "text-secondary hover:text-ghost"
                  }`}
                >
                  {tab === "subscriptions" ? "اشتراكات" : "عروض"}
                </button>
              ))}
            </div>
          </div>

          {mainTab === "subscriptions" && (
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
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── SUBSCRIPTIONS VIEW ────────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {mainTab === "subscriptions" && (
          <>
            {/* ── Collapsible Form ──────────────────────────────────────── */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${formOpen ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0"}`}>
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <p className="font-mono text-[10px] text-secondary uppercase tracking-widest mb-3">
                  اشتراك جديد
                </p>

                {/* Type toggle */}
                <div className="flex gap-1 mb-4">
                  {(["normal", "private"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSubType(t)}
                      className={`flex-1 py-2 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm ${
                        subType === t
                          ? "bg-gold text-void"
                          : "bg-void border border-gunmetal text-secondary hover:text-ghost"
                      }`}
                    >
                      {t === "normal" ? "عادي" : "تدريب خاص"}
                    </button>
                  ))}
                </div>

                {/* ── Normal subscription form ───────────────────────── */}
                {subType === "normal" && (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>اسم العضو</label>
                        <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                          value={form.memberName}
                          onChange={(e) => setForm((p) => ({ ...p, memberName: e.target.value }))} />
                      </div>
                      <div>
                        <label className={labelCls}>الهاتف</label>
                        <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                          value={form.phone}
                          onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>نوع الخطة</label>
                        <div className="relative">
                          <select className={selectCls} value={form.planType}
                            onChange={(e) => handlePlanChange(e.target.value as PlanType)}>
                            {PLAN_TYPES.map((p) => (
                              <option key={p} value={p}>
                                {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} $
                              </option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>تاريخ البدء</label>
                        <input required type="date" className={inputCls} value={form.startDate}
                          onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
                      </div>
                      <div>
                        <label className={labelCls}>المبلغ ($)</label>
                        <input required type="number" min={0} className={inputCls} value={form.amount}
                          onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
                      </div>
                    </div>

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

                    {submitError && (
                      <div className="flex items-center gap-2 p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{submitError}</div>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                      <button type="submit"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright active:bg-gold-deep text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors duration-150">
                        <LockIcon size={13} />قفل وحفظ الاشتراك
                      </button>
                      <button type="button"
                        onClick={() => { setForm(DEFAULT_FORM); setFormOpen(false); }}
                        className="px-4 py-2.5 bg-transparent border border-gunmetal hover:border-secondary text-secondary hover:text-ghost font-body text-sm rounded transition-colors duration-150">
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}

                {/* ── Private training form ──────────────────────────── */}
                {subType === "private" && (
                  <form onSubmit={handlePrivateSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>عدد اللاعبين</label>
                        <input
                          type="number" min={1} max={30} className={inputCls}
                          value={ptCount}
                          onChange={(e) => {
                            const n = Math.max(1, parseInt(e.target.value) || 1);
                            setPtCount(n);
                            setPtNames(Array.from({ length: n }, (_, i) => ptNames[i] ?? ""));
                          }}
                        />
                      </div>
                      <div className="flex flex-col justify-end pb-0.5">
                        {(() => {
                          const { groupPrice, trainerFee, total } = ptCalc(ptCount);
                          return (
                            <div className="p-3 bg-void border border-gunmetal rounded">
                              <p className="font-mono text-[9px] text-slate uppercase tracking-wider mb-1">التسعيرة</p>
                              <p className="font-mono text-xs text-secondary">${trainerFee} مدرب + ${groupPrice} مجموعة</p>
                              <p className="font-display text-2xl text-gold-bright">${total}</p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>أسماء اللاعبين</label>
                      <div className="space-y-2">
                        {ptNames.map((name, i) => (
                          <input key={i} type="text" className={inputCls}
                            placeholder={`اللاعب ${i + 1}`}
                            value={name}
                            onChange={(e) => {
                              const next = [...ptNames]; next[i] = e.target.value; setPtNames(next);
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>ملاحظات (اختياري)</label>
                      <input type="text" className={inputCls} value={ptNotes}
                        onChange={(e) => setPtNotes(e.target.value)} />
                    </div>

                    {ptError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{ptError}</div>}

                    <div className="flex items-center gap-3 pt-1">
                      <button type="submit" disabled={ptBusy}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                        <LockIcon size={13} />{ptBusy ? "جاري الحفظ…" : "حفظ جلسة التدريب"}
                      </button>
                      <button type="button"
                        onClick={() => { setPtCount(1); setPtNames([""]); setPtNotes(""); setFormOpen(false); }}
                        className="px-4 py-2.5 border border-gunmetal text-secondary hover:text-ghost font-body text-sm rounded transition-colors">
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {/* ── Filter Tabs + Sort ─────────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-gunmetal pb-0 -mb-px">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                {FILTER_TABS.map(({ key, label }) => {
                  const isActive = activeFilter === key;
                  const count    = filterCounts[key];
                  return (
                    <button key={key} onClick={() => setActiveFilter(key)}
                      className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider whitespace-nowrap transition-colors duration-150 border-b-2 -mb-px ${
                        isActive ? "border-gold text-gold" : "border-transparent text-secondary hover:text-ghost"
                      }`}>
                      {label}
                      {count > 0 && (
                        <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full font-mono text-[9px] tabular-nums ${
                          isActive ? "bg-gold/20 text-gold" : "bg-gunmetal text-slate"
                        }`}>{count}</span>
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

            {/* ── Table ─────────────────────────────────────────────────── */}
            <div className="overflow-x-auto rounded border border-gunmetal">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="bg-charcoal">
                    {["اسم العضو","الخطة","العرض","تاريخ البدء","تاريخ الانتهاء","الأيام المتبقية","المبلغ","الحالة",""].map((col, i) => (
                      <th key={i} className="px-3.5 py-2.5 text-right font-mono text-[10px] text-secondary uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center font-mono text-xs text-slate uppercase tracking-wider">
                        {subscriptions.length === 0 ? "لا توجد اشتراكات" : "لا توجد اشتراكات تطابق هذا الفلتر"}
                      </td>
                    </tr>
                  )}
                  {filtered.map((sub) => (
                    <tr key={sub.id}
                      className={`ox-table-row bg-iron/50 border-b border-gunmetal last:border-b-0 transition-colors duration-100 hover:bg-gunmetal/60 ${sub.status === "expired" ? "opacity-60" : ""} ${rowAccent(sub)}`}>
                      <td className="px-3.5 py-3 font-body font-medium text-sm text-offwhite whitespace-nowrap">{sub.memberName}</td>
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
                      <td className="px-3.5 py-3"><SubStatusChip status={sub.status} /></td>
                      <td className="px-3.5 py-3 text-center">
                        {sub.status !== "expired" && sub.status !== "cancelled" ? (
                          <button
                            onClick={async () => {
                              if (!user) return;
                              const r = await cancelTransaction({
                                user: { id: user.id, displayName: user.displayName },
                                table: "gym_subscriptions",
                                id: sub.id,
                              });
                              if (!r.error) cancelSubscriptionLocal(sub.id);
                            }}
                            className="p-1 text-secondary hover:text-red transition-colors cursor-pointer"
                            title="إلغاء الاشتراك"
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M2 11L6.5 6.5M11 2L6.5 6.5M6.5 6.5L2 2M6.5 6.5L11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            </svg>
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between pt-1">
              <p className="font-mono text-[10px] text-slate uppercase tracking-wider">
                عرض {filtered.length} من {subscriptions.length} اشتراك
              </p>
              <p className="font-mono text-[10px] text-slate tabular-nums">
                الإجمالي:{" "}
                <span className="text-gold">
                  {formatCurrency(filtered.reduce((acc, s) => acc + s.amount, 0))} $
                </span>
              </p>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── OFFERS VIEW ───────────────────────────────────────────────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {mainTab === "offers" && (
          <div className="space-y-5">

            {/* Offer sub-tabs */}
            <div className="flex items-center gap-1 border-b border-gunmetal pb-0 -mb-px">
              {(["couple", "referral", "corporate", "college"] as const).map((tab) => (
                <button key={tab} onClick={() => setOfferTab(tab)}
                  className={`px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider border-b-2 -mb-px transition-colors ${
                    offerTab === tab ? "border-gold text-gold" : "border-transparent text-secondary hover:text-ghost"
                  }`}>
                  {tab === "couple" ? "عرض الزوجين" : tab === "referral" ? "الإحالة" : tab === "corporate" ? "شركات / بنوك" : "طلاب جامعات"}
                </button>
              ))}
            </div>

            {/* ── Couple form ─────────────────────────────────────────────── */}
            {offerTab === "couple" && (
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <div className="mb-4">
                  <p className="font-mono text-[10px] text-secondary uppercase tracking-widest">عرض الزوجين</p>
                  <p className="font-mono text-[9px] text-slate mt-0.5">شخصان — اشتراك شهر — $60 إجمالي ($30 لكل شخص) — مرتبطان بنفس المجموعة</p>
                </div>
                <form onSubmit={handleCoupleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>الشخص الأول</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={coupleNames[0]}
                        onChange={(e) => setCoupleNames([e.target.value, coupleNames[1]])} />
                    </div>
                    <div>
                      <label className={labelCls}>الشخص الثاني</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={coupleNames[1]}
                        onChange={(e) => setCoupleNames([coupleNames[0], e.target.value])} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={coupleStart}
                        onChange={(e) => setCoupleStart(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>حالة الدفع</label>
                      <div className="relative">
                        <select className={selectCls} value={couplePayStatus}
                          onChange={(e) => setCouplePayStatus(e.target.value as PaymentStatus)}>
                          <option value="paid">مدفوع</option>
                          <option value="partial">جزئي</option>
                          <option value="unpaid">غير مدفوع</option>
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-void border border-gunmetal rounded">
                    <div>
                      <p className="font-mono text-[9px] text-slate uppercase tracking-wider">إجمالي العرض</p>
                      <p className="font-mono text-[10px] text-secondary mt-0.5">السعر الأصلي: $70 — توفير: $10</p>
                    </div>
                    <span className="font-display text-2xl text-gold-bright">$60</span>
                  </div>
                  {coupleError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{coupleError}</div>}
                  <button type="submit" disabled={coupleBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{coupleBusy ? "جاري الحفظ…" : "تسجيل عرض الزوجين"}
                  </button>
                </form>
              </div>
            )}

            {/* ── Referral form ────────────────────────────────────────────── */}
            {offerTab === "referral" && (
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <div className="mb-4">
                  <p className="font-mono text-[10px] text-secondary uppercase tracking-widest">عرض الإحالة</p>
                  <p className="font-mono text-[9px] text-slate mt-0.5">٥ إحالات → شهر مجاناً · ٩ إحالات → شهرين مجاناً</p>
                </div>
                <form onSubmit={handleReferralSubmit} className="space-y-4">
                  <div>
                    <label className={labelCls}>اسم العضو (المُحيل)</label>
                    <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                      value={refMain} onChange={(e) => setRefMain(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={refPlan}
                          onChange={(e) => setRefPlan(e.target.value as PlanType)}>
                          {PLAN_TYPES.map((p) => {
                            const disc = PLAN_DISCOUNTS[p];
                            return (
                              <option key={p} value={p}>
                                {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} ${disc > 0 ? ` (خصم ${disc}٪)` : ""}
                              </option>
                            );
                          })}
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={refStart}
                        onChange={(e) => setRefStart(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={labelCls}>أسماء الأصدقاء المُحالين</label>
                      <span className={`font-mono text-[10px] ${
                        refValidCount >= 9 ? "text-gold-bright" : refValidCount >= 5 ? "text-gold" : "text-slate"
                      }`}>
                        {refValidCount >= 9 ? "✓ شهرين مجاناً" : refValidCount >= 5 ? "✓ شهر مجاناً" : `${refValidCount}/5 مطلوب`}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {refFriends.map((name, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input type="text" className={inputCls} placeholder={`صديق ${i + 1}`}
                            value={name}
                            onChange={(e) => { const next = [...refFriends]; next[i] = e.target.value; setRefFriends(next); }} />
                          {i >= 5 && (
                            <button type="button"
                              onClick={() => setRefFriends(refFriends.filter((_, j) => j !== i))}
                              className="p-1 text-secondary hover:text-red transition-colors shrink-0">
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                <path d="M2 11L6.5 6.5M11 2L6.5 6.5M6.5 6.5L2 2M6.5 6.5L11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => setRefFriends([...refFriends, ""])}
                        className="w-full py-1.5 border border-dashed border-gunmetal text-secondary hover:text-ghost font-mono text-[10px] uppercase tracking-wider transition-colors rounded">
                        + إضافة صديق
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>حالة الدفع</label>
                    <div className="relative">
                      <select className={selectCls} value={refPayStatus}
                        onChange={(e) => setRefPayStatus(e.target.value as PaymentStatus)}>
                        <option value="paid">مدفوع</option>
                        <option value="partial">جزئي</option>
                        <option value="unpaid">غير مدفوع</option>
                      </select>
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                    </div>
                  </div>
                  {refError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{refError}</div>}
                  <button type="submit" disabled={refBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{refBusy ? "جاري الحفظ…" : "تسجيل اشتراك الإحالة"}
                  </button>
                </form>
              </div>
            )}

            {/* ── Corporate form ─────────────────────────────────────────── */}
            {offerTab === "corporate" && (
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <div className="mb-4">
                  <p className="font-mono text-[10px] text-secondary uppercase tracking-widest">خصم الشركات والبنوك</p>
                  <p className="font-mono text-[9px] text-slate mt-0.5">خصم ١٥٪ على أي خطة — للشركات والبنوك</p>
                </div>
                <form onSubmit={handleCorporateSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>اسم العضو</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={corpName} onChange={(e) => setCorpName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>نوع المنظمة</label>
                      <div className="relative">
                        <select className={selectCls} value={corpOrg}
                          onChange={(e) => setCorpOrg(e.target.value as "company" | "bank")}>
                          <option value="company">شركة</option>
                          <option value="bank">بنك</option>
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={corpPlan}
                          onChange={(e) => setCorpPlan(e.target.value as PlanType)}>
                          {PLAN_TYPES.map((p) => {
                            const disc = PLAN_DISCOUNTS[p];
                            return (
                              <option key={p} value={p}>
                                {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} ${disc > 0 ? ` (خصم ${disc}٪)` : ""}
                              </option>
                            );
                          })}
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={corpStart}
                        onChange={(e) => setCorpStart(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-void border border-gunmetal rounded">
                    <div>
                      <p className="font-mono text-[9px] text-slate uppercase tracking-wider">السعر بعد خصم ١٥٪</p>
                      <p className="font-mono text-xs text-secondary line-through mt-0.5">{PLAN_BASE_PRICES[corpPlan]} $</p>
                    </div>
                    <span className="font-display text-2xl text-gold-bright">${Math.round(PLAN_BASE_PRICES[corpPlan] * 0.85)}</span>
                  </div>
                  <div>
                    <label className={labelCls}>حالة الدفع</label>
                    <div className="relative">
                      <select className={selectCls} value={corpPayStatus}
                        onChange={(e) => setCorpPayStatus(e.target.value as PaymentStatus)}>
                        <option value="paid">مدفوع</option>
                        <option value="partial">جزئي</option>
                        <option value="unpaid">غير مدفوع</option>
                      </select>
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                    </div>
                  </div>
                  {corpError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{corpError}</div>}
                  <button type="submit" disabled={corpBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{corpBusy ? "جاري الحفظ…" : "تسجيل اشتراك الشركة"}
                  </button>
                </form>
              </div>
            )}

            {/* ── College form ────────────────────────────────────────────── */}
            {offerTab === "college" && (
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <div className="mb-4">
                  <p className="font-mono text-[10px] text-secondary uppercase tracking-widest">خصم طلاب الجامعات</p>
                  <p className="font-mono text-[9px] text-slate mt-0.5">خصم ٢٠٪ على أي خطة — لطلاب الجامعات</p>
                </div>
                <form onSubmit={handleCollegeSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>اسم العضو</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={collegeName} onChange={(e) => setCollegeName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={collegePlan}
                          onChange={(e) => setCollegePlan(e.target.value as PlanType)}>
                          {PLAN_TYPES.map((p) => (
                            <option key={p} value={p}>
                              {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} $
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={collegeStart}
                        onChange={(e) => setCollegeStart(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>حالة الدفع</label>
                      <div className="relative">
                        <select className={selectCls} value={collegePayStatus}
                          onChange={(e) => setCollegePayStatus(e.target.value as PaymentStatus)}>
                          <option value="paid">مدفوع</option>
                          <option value="partial">جزئي</option>
                          <option value="unpaid">غير مدفوع</option>
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-void border border-gunmetal rounded">
                    <div>
                      <p className="font-mono text-[9px] text-slate uppercase tracking-wider">السعر بعد خصم ٢٠٪</p>
                      <p className="font-mono text-xs text-secondary line-through mt-0.5">{PLAN_BASE_PRICES[collegePlan]} $</p>
                    </div>
                    <span className="font-display text-2xl text-gold-bright">${calculateDiscountedPrice(PLAN_BASE_PRICES[collegePlan], "college")}</span>
                  </div>
                  {collegeError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{collegeError}</div>}
                  <button type="submit" disabled={collegeBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{collegeBusy ? "جاري الحفظ…" : "تسجيل اشتراك الطالب"}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

      </section>
    </>
  );
}
