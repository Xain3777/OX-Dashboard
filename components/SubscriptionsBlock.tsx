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
  calcGroupPerMember,
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
  findOrCreateMember,
  updateSubscription,
} from "@/lib/supabase/intake";
import PaymentFields, { computePayment } from "@/components/PaymentFields";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAN_BASE_PRICES: Record<PlanType, number> = {
  daily:       5,
  "15_days":   20,
  "1_month":   35,
  "3_months":  90,
  "6_months":  170,
  "9_months":  235,
  "12_months": 300,
};

// Owner-family offer pricing: $20 × months. Sub-month plans aren't eligible
// for the owner_family discount, so we map them to 0 (the form can be locked
// to monthly+ if you want to enforce that — for now, picking daily/15_days
// here yields a $0 total which makes the absurdity obvious to the cashier).
const OWNER_FAMILY_MONTHS: Record<PlanType, number> = {
  daily:       0,
  "15_days":   0,
  "1_month":   1,
  "3_months":  3,
  "6_months":  6,
  "9_months":  9,
  "12_months": 12,
};

const PLAN_DISCOUNTS: Record<PlanType, number> = {
  daily:       0,
  "15_days":   0,
  "1_month":   0,
  "3_months":  15,
  "6_months":  20,
  "9_months":  25,
  "12_months": 30,
};

// All plans, in display order. Used by the normal subscription form and the
// edit-subscription modal — both must accept any plan a member could buy.
const ALL_PLAN_TYPES: PlanType[] = [
  "daily",
  "15_days",
  "1_month",
  "3_months",
  "6_months",
  "9_months",
  "12_months",
];

// Monthly+ plans only. Discount-style offers (referral, corporate, college,
// owner_family) and group offers don't apply to sub-month plans, so their
// dropdowns expose just these.
const MONTHLY_PLAN_TYPES: PlanType[] = [
  "1_month",
  "3_months",
  "6_months",
  "9_months",
  "12_months",
];

const OWNER_FAMILY_PLAN_TYPES = MONTHLY_PLAN_TYPES;


function ptCalc(n: number) {
  const groupPrice = n <= 2 ? 10 : n <= 5 ? 15 : 18;
  return { groupPrice, trainerFee: 18, total: groupPrice + 18 };
}

// ─── Local types ──────────────────────────────────────────────────────────────

type MainTab  = "subscriptions" | "offers";
type SubType  = "normal" | "private";
type OfferTab = "couple" | "referral" | "corporate" | "college" | "owner_family" | "custom_registration";
type SortMode = "alpha" | "date";
type FilterTab = "all" | "active" | "expiring" | "unpaid" | "expired" | "partial";
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
    daily:      "bg-gunmetal/60 text-secondary border-gunmetal",
    "15_days":  "bg-gunmetal text-ghost border-gunmetal",
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
  const { subscriptions, addSubscription, replaceSubscription, cancelSubscriptionLocal } = useStore();
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
  const [searchQuery, setSearchQuery]   = useState("");

  // ── Private training state ─────────────────────────────────────────────────
  const [ptCount, setPtCount]   = useState(1);
  const [ptNames, setPtNames]   = useState<string[]>([""]);
  const [ptCoach, setPtCoach]   = useState("");
  const [ptNotes, setPtNotes]   = useState("");
  // ptTotal default = trainerFee + groupPrice (computed via ptCalc).
  // Reception can override before saving.
  const [ptTotal, setPtTotal]   = useState(String(ptCalc(1).total));
  const [ptPaid,  setPtPaid]    = useState(String(ptCalc(1).total));
  const [ptBusy, setPtBusy]     = useState(false);
  const [ptError, setPtError]   = useState<string | null>(null);

  // ── Offers tab state ───────────────────────────────────────────────────────
  const [offerTab, setOfferTab] = useState<OfferTab>("couple");

  // Couple offer
  const [coupleNames,      setCoupleNames]      = useState(["", ""]);
  const [couplePhones,     setCouplePhones]     = useState(["", ""]);
  const [coupleStart,      setCoupleStart]      = useState(new Date().toISOString().split("T")[0]);
  const [coupleTotal,      setCoupleTotal]      = useState("60"); // couple offer is $60 flat
  const [couplePaid,       setCouplePaid]       = useState("60");
  const [coupleBusy,       setCoupleBusy]       = useState(false);
  const [coupleError,      setCoupleError]      = useState<string | null>(null);

  // Referral offer
  const [refMain,         setRefMain]         = useState("");
  const [refMainPhone,    setRefMainPhone]    = useState("");
  const [refFriends,      setRefFriends]      = useState<string[]>(["", "", "", "", ""]);
  const [refFriendPhones, setRefFriendPhones] = useState<string[]>(["", "", "", "", ""]);
  const [refPlan,         setRefPlan]         = useState<PlanType>("1_month");
  const [refStart,        setRefStart]        = useState(new Date().toISOString().split("T")[0]);
  const [refTotal,        setRefTotal]        = useState(String(PLAN_BASE_PRICES["1_month"]));
  const [refPaid,         setRefPaid]         = useState(String(PLAN_BASE_PRICES["1_month"]));
  const [refBusy,         setRefBusy]         = useState(false);
  const [refError,        setRefError]        = useState<string | null>(null);

  // Owner family offer ($20 × months)
  const [ofName,        setOfName]        = useState("");
  const [ofPhone,       setOfPhone]       = useState("");
  const [ofPlan,        setOfPlan]        = useState<PlanType>("1_month");
  const [ofStart,       setOfStart]       = useState(new Date().toISOString().split("T")[0]);
  const [ofTotal,       setOfTotal]       = useState(String(20 * 1)); // $20 × months
  const [ofPaid,        setOfPaid]        = useState(String(20 * 1));
  const [ofBusy,        setOfBusy]        = useState(false);
  const [ofError,       setOfError]       = useState<string | null>(null);

  // Corporate offer
  const [corpName,      setCorpName]      = useState("");
  const [corpPhone,     setCorpPhone]     = useState("");
  const [corpOrg,       setCorpOrg]       = useState<"company" | "bank">("company");
  const [corpPlan,      setCorpPlan]      = useState<PlanType>("1_month");
  const [corpStart,     setCorpStart]     = useState(new Date().toISOString().split("T")[0]);
  const [corpTotal,     setCorpTotal]     = useState(String(Math.round(PLAN_BASE_PRICES["1_month"] * 0.85)));
  const [corpPaid,      setCorpPaid]      = useState(String(Math.round(PLAN_BASE_PRICES["1_month"] * 0.85)));
  const [corpBusy,      setCorpBusy]      = useState(false);
  const [corpError,     setCorpError]     = useState<string | null>(null);

  // College offer
  const [collegeName,      setCollegeName]      = useState("");
  const [collegePhone,     setCollegePhone]     = useState("");
  const [collegePlan,      setCollegePlan]      = useState<PlanType>("1_month");
  const [collegeStart,     setCollegeStart]     = useState(new Date().toISOString().split("T")[0]);
  const [collegeTotal,     setCollegeTotal]     = useState(String(calculateDiscountedPrice(PLAN_BASE_PRICES["1_month"], "college")));
  const [collegePaid,      setCollegePaid]      = useState(String(calculateDiscountedPrice(PLAN_BASE_PRICES["1_month"], "college")));
  const [collegeBusy,      setCollegeBusy]      = useState(false);
  const [collegeError,     setCollegeError]     = useState<string | null>(null);

  // Free / custom registration offer
  const [customName,    setCustomName]    = useState("");
  const [customPhone,   setCustomPhone]   = useState("");
  const [customPlan,    setCustomPlan]    = useState<PlanType>("1_month");
  const [customStart,   setCustomStart]   = useState(new Date().toISOString().split("T")[0]);
  const [customAmount,  setCustomAmount]  = useState("0");      // empty/zero by default — editable
  const [customPaid,    setCustomPaid]    = useState("0");
  const [customNote,    setCustomNote]    = useState("");
  const [customBusy,    setCustomBusy]    = useState(false);
  const [customError,   setCustomError]   = useState<string | null>(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Edit modal state ───────────────────────────────────────────────────────
  const [editSub,        setEditSub]        = useState<Subscription | null>(null);
  const [editForm,       setEditForm]       = useState<{ memberName: string; phone: string; planType: PlanType; offer: OfferType; startDate: string; endDate: string; amount: string; paidAmount: string; paymentStatus: PaymentStatus; privateCoachName: string; note: string } | null>(null);
  const [editBusy,       setEditBusy]       = useState(false);
  const [editError,      setEditError]      = useState<string | null>(null);

  const openEditModal = useCallback((sub: Subscription) => {
    setEditSub(sub);
    setEditForm({
      memberName: sub.memberName,
      phone: sub.phone ?? "",
      planType: sub.planType,
      offer: sub.offer,
      startDate: sub.startDate,
      endDate: sub.endDate,
      amount: String(sub.amount),
      paidAmount: String(sub.paidAmount),
      paymentStatus: sub.paymentStatus,
      privateCoachName: sub.privateCoachName ?? "",
      note: sub.note ?? "",
    });
    setEditError(null);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditSub(null);
    setEditForm(null);
    setEditError(null);
  }, []);

  // ── Derived: auto-calculate amount when plan/offer changes ────────────────
  const computedEndDate = calculateEndDate(form.startDate, form.planType, "none");

  // Normal plan change: keep paid in sync with total when both already match
  // (i.e., the cashier hadn't started typing partial payments yet).
  const [normalPaid, setNormalPaid] = useState(String(PLAN_BASE_PRICES["1_month"]));
  const handlePlanChange = useCallback((planType: PlanType) => {
    const newAmount = String(PLAN_BASE_PRICES[planType]);
    setForm((prev) => {
      const next = { ...prev, planType, amount: newAmount };
      return next;
    });
    setNormalPaid(newAmount);
  }, []);

  // Auto-sync totals for offers that derive total from plan.
  const handleRefPlanChange = useCallback((p: PlanType) => {
    setRefPlan(p);
    const t = String(PLAN_BASE_PRICES[p]);
    setRefTotal(t);
    setRefPaid(t);
  }, []);
  const handleCorpPlanChange = useCallback((p: PlanType) => {
    setCorpPlan(p);
    const t = String(Math.round(PLAN_BASE_PRICES[p] * 0.85));
    setCorpTotal(t);
    setCorpPaid(t);
  }, []);
  const handleCollegePlanChange = useCallback((p: PlanType) => {
    setCollegePlan(p);
    const t = String(calculateDiscountedPrice(PLAN_BASE_PRICES[p], "college"));
    setCollegeTotal(t);
    setCollegePaid(t);
  }, []);
  const handleOfPlanChange = useCallback((p: PlanType) => {
    setOfPlan(p);
    const t = String(20 * OWNER_FAMILY_MONTHS[p]);
    setOfTotal(t);
    setOfPaid(t);
  }, []);
  const handlePtCountChange = useCallback((n: number) => {
    const safe = Math.max(1, n);
    setPtCount(safe);
    setPtNames((prev) => Array.from({ length: safe }, (_, i) => prev[i] ?? ""));
    const t = String(ptCalc(safe).total);
    setPtTotal(t);
    setPtPaid(t);
  }, []);

  // ── Filter logic ───────────────────────────────────────────────────────────
  // Search matches across name, phone, coach, plan, offer, payment status —
  // case-insensitive and friendly to both Arabic and Latin input.
  const normalize = (s: string) => s.toLocaleLowerCase("ar-SY").trim();
  const subMatchesSearch = useCallback((sub: Subscription, q: string) => {
    if (!q) return true;
    const needle = normalize(q);
    const haystack = [
      sub.memberName,
      sub.phone ?? "",
      sub.privateCoachName ?? "",
      sub.planType,
      getPlanLabel(sub.planType),
      sub.offer,
      sub.offer === "none" ? "" : getOfferLabel(sub.offer),
      sub.paymentStatus,
      sub.paymentStatus === "paid" ? "مدفوع" : sub.paymentStatus === "partial" ? "جزئي" : "غير مدفوع",
    ]
      .map(normalize)
      .join(" | ");
    return haystack.includes(needle);
  }, []);

  const filtered = useMemo(() => {
    let result = subscriptions.filter((sub) => {
      if (sub.status === "cancelled") return false;
      if (!subMatchesSearch(sub, searchQuery)) return false;
      if (activeFilter === "all")      return true;
      if (activeFilter === "active")   return sub.status === "active";
      if (activeFilter === "expired")  return sub.status === "expired";
      if (activeFilter === "unpaid")   return sub.paymentStatus === "unpaid" || sub.paymentStatus === "partial";
      if (activeFilter === "partial")  return sub.paymentStatus === "partial";
      if (activeFilter === "expiring") return sub.status === "active" && sub.remainingDays > 0 && sub.remainingDays <= 7;
      return true;
    });
    if (sortMode === "alpha") {
      result = [...result].sort((a, b) => a.memberName.localeCompare(b.memberName, "ar"));
    } else {
      result = [...result].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    }
    return result;
  }, [subscriptions, activeFilter, sortMode, searchQuery, subMatchesSearch]);

  const filterCounts: Record<FilterTab, number> = {
    all:      subscriptions.filter((s) => s.status !== "cancelled").length,
    active:   subscriptions.filter((s) => s.status === "active").length,
    expiring: subscriptions.filter((s) => s.status === "active" && s.remainingDays > 0 && s.remainingDays <= 7).length,
    unpaid:   subscriptions.filter((s) => s.paymentStatus === "unpaid" || s.paymentStatus === "partial").length,
    partial:  subscriptions.filter((s) => s.paymentStatus === "partial" && s.status !== "cancelled").length,
    expired:  subscriptions.filter((s) => s.status === "expired").length,
  };

  // ── Normal subscription submit ─────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitError(null);

    const endDate   = computedEndDate;
    const remaining = calculateRemainingDays(endDate);
    const pay = computePayment(form.amount, normalPaid);
    if (pay.overpaid) { setSubmitError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    console.log("Normal subscription submit:", { memberName: form.memberName, phone: form.phone, planType: form.planType, total: pay.totalNum, paid: pay.paidNum, status: pay.status });

    const m = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: form.memberName, phone: form.phone });
    if (m.error) { setSubmitError(m.error); return; }

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: form.memberName.trim(),
      memberId: m.data?.id,
      phone: form.phone,
      planType: form.planType,
      offer: "none",
      startDate: form.startDate,
      endDate,
      amount: pay.totalNum,
      paidAmount: pay.paidNum,
      paymentStatus: pay.status,
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
      amount: pay.totalNum,
      paidAmount: pay.paidNum,
      paymentStatus: pay.status,
      paymentMethod: "cash",
      currency: "usd",
      status: remaining > 0 ? "active" : "expired",
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(row.created_at ?? new Date().toISOString()),
    });
    setForm(DEFAULT_FORM);
    setNormalPaid(String(PLAN_BASE_PRICES[DEFAULT_FORM.planType]));
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
    const pay = computePayment(ptTotal, ptPaid);
    if (pay.overpaid) { setPtError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setPtBusy(true);
    const r = await pushPrivateSession({
      user: { id: user.id, displayName: user.displayName },
      numberOfPlayers: ptCount,
      playerNames: validNames,
      notes: ptNotes,
      exchangeRate,
      privateCoachName: ptCoach.trim() || null,
      totalPriceOverride: pay.totalNum,
      paidAmount: pay.paidNum,
      paymentStatus: pay.status,
    });
    setPtBusy(false);
    if (r.error) { setPtError(r.error); return; }
    setPtCount(1); setPtNames([""]); setPtNotes(""); setPtCoach("");
    setPtTotal(String(ptCalc(1).total));
    setPtPaid(String(ptCalc(1).total));
    setFormOpen(false);
    setToastMessage(`تم حفظ جلسة التدريب الخاص — ${ptCount} لاعبين — حالة: ${pay.status}`);
  };

  // ── Couple offer submit ────────────────────────────────────────────────────
  const handleCoupleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCoupleError(null);
    if (!coupleNames[0].trim() || !coupleNames[1].trim()) { setCoupleError("أدخل اسمَي الشخصين"); return; }
    const pay = computePayment(coupleTotal, couplePaid);
    if (pay.overpaid) { setCoupleError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setCoupleBusy(true);
    const groupId = crypto.randomUUID();
    const endDate = calculateEndDate(coupleStart, "1_month", "couple");
    // Split per-member: each row stores half the couple total so the
    // gym_subscriptions list shows the correct individual amount, but
    // payment status stays consistent across both rows.
    const halfTotal = Number((pay.totalNum / 2).toFixed(2));
    const halfPaid  = Number((pay.paidNum  / 2).toFixed(2));
    console.log("Couple submit:", { groupId, coupleNames, couplePhones, endDate, total: pay.totalNum, paid: pay.paidNum, status: pay.status });

    const m1 = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: coupleNames[0], phone: couplePhones[0] });
    if (m1.error) { setCoupleError(m1.error); setCoupleBusy(false); return; }
    const m2 = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: coupleNames[1], phone: couplePhones[1] });
    if (m2.error) { setCoupleError(m2.error); setCoupleBusy(false); return; }

    const r1 = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: coupleNames[0].trim(),
      memberId: m1.data?.id,
      phone: couplePhones[0],
      planType: "1_month", offer: "couple",
      startDate: coupleStart, endDate,
      amount: halfTotal, paidAmount: halfPaid,
      paymentStatus: pay.status,
      currency: "usd", exchangeRate, groupId,
    });
    if (r1.error) { setCoupleError(r1.error); setCoupleBusy(false); return; }

    const r2 = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: coupleNames[1].trim(),
      memberId: m2.data?.id,
      phone: couplePhones[1],
      planType: "1_month", offer: "couple",
      startDate: coupleStart, endDate,
      amount: halfTotal, paidAmount: halfPaid,
      paymentStatus: pay.status,
      currency: "usd", exchangeRate, groupId,
    });
    if (r2.error) { setCoupleError(r2.error); setCoupleBusy(false); return; }

    await pushGroupOffer({
      user: { id: user.id, displayName: user.displayName },
      groupId, offerType: "couple",
      members: coupleNames.map((n) => ({ name: n.trim() })),
      priceApplied: pay.totalNum,
    });

    const rem = calculateRemainingDays(endDate);
    [r1.data!, r2.data!].forEach((row, i) => {
      addSubscription({
        id: String(row.id),
        memberId: String(row.created_by ?? user.id),
        memberName: coupleNames[i].trim(),
        planType: "1_month", offer: "couple",
        startDate: coupleStart, endDate,
        remainingDays: rem, amount: halfTotal, paidAmount: halfPaid,
        paymentStatus: pay.status, paymentMethod: "cash",
        currency: "usd",
        status: rem > 0 ? "active" : "expired",
        createdAt: String(row.created_at ?? new Date().toISOString()),
        createdBy: user.id,
        lockedAt: String(row.created_at ?? new Date().toISOString()),
      });
    });

    setCoupleBusy(false);
    setCoupleNames(["", ""]);
    setCouplePhones(["", ""]);
    setCoupleStart(new Date().toISOString().split("T")[0]);
    setCoupleTotal("60"); setCouplePaid("60");
    setToastMessage(`تم تسجيل عرض الزوجين — حالة الدفع: ${pay.status}`);
  };

  // ── Referral offer submit ──────────────────────────────────────────────────
  const handleReferralSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setRefError(null);
    const validFriends = refFriends
      .map((n, i) => ({ name: n.trim(), phone: (refFriendPhones[i] ?? "").trim() }))
      .filter((f) => f.name);
    const count = validFriends.length;
    if (count < 5) { setRefError("يجب إدخال 5 أسماء على الأقل للتأهل للعرض"); return; }
    const pay = computePayment(refTotal, refPaid);
    if (pay.overpaid) { setRefError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setRefBusy(true);

    const offerType: OfferType = count >= 9 ? "referral_9" : "referral_4";
    const groupId  = crypto.randomUUID();
    const endDate  = calculateEndDate(refStart, refPlan, offerType);
    console.log("Referral submit:", { groupId, refMain, refMainPhone, friendsCount: count, offerType, total: pay.totalNum, paid: pay.paidNum, status: pay.status });

    const m = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: refMain, phone: refMainPhone });
    if (m.error) { setRefError(m.error); setRefBusy(false); return; }

    // Create member rows for each friend so they exist in the members table.
    for (const f of validFriends) {
      const fr = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: f.name, phone: f.phone });
      if (fr.error) { setRefError(fr.error); setRefBusy(false); return; }
    }

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: refMain.trim(),
      memberId: m.data?.id,
      phone: refMainPhone,
      planType: refPlan, offer: offerType,
      startDate: refStart, endDate,
      amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status,
      currency: "usd", exchangeRate, groupId,
    });
    if (r.error) { setRefError(r.error); setRefBusy(false); return; }

    await pushGroupOffer({
      user: { id: user.id, displayName: user.displayName },
      groupId, offerType: "referral",
      members: [{ name: refMain.trim() }, ...validFriends.map((f) => ({ name: f.name }))],
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
      remainingDays: rem, amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setRefBusy(false);
    setRefMain(""); setRefMainPhone("");
    setRefFriends(["", "", "", "", ""]); setRefFriendPhones(["", "", "", "", ""]);
    setRefPlan("1_month");
    setRefStart(new Date().toISOString().split("T")[0]);
    setRefTotal(String(PLAN_BASE_PRICES["1_month"]));
    setRefPaid(String(PLAN_BASE_PRICES["1_month"]));
    setToastMessage(count >= 9 ? "إحالة مسجّلة — شهران مجاناً" : "إحالة مسجّلة — شهر مجاناً");
  };

  // ── Owner family offer submit ($20 × months) ───────────────────────────────
  const handleOwnerFamilySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setOfError(null);
    if (!ofName.trim()) { setOfError("أدخل اسم العضو"); return; }
    const pay = computePayment(ofTotal, ofPaid);
    if (pay.overpaid) { setOfError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setOfBusy(true);

    const endDate  = calculateEndDate(ofStart, ofPlan, "owner_family");
    const groupId  = crypto.randomUUID();
    console.log("Owner family submit:", { ofName, ofPhone, ofPlan, total: pay.totalNum, paid: pay.paidNum, status: pay.status });

    const m = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: ofName, phone: ofPhone });
    if (m.error) { setOfError(m.error); setOfBusy(false); return; }

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: ofName.trim(),
      memberId: m.data?.id,
      phone: ofPhone,
      planType: ofPlan, offer: "owner_family",
      startDate: ofStart, endDate,
      amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status,
      currency: "usd", exchangeRate, groupId,
    });
    if (r.error) { setOfError(r.error); setOfBusy(false); return; }

    const rem = calculateRemainingDays(endDate);
    addSubscription({
      id: String(r.data!.id),
      memberId: String(r.data!.created_by ?? user.id),
      memberName: ofName.trim(),
      planType: ofPlan, offer: "owner_family",
      startDate: ofStart, endDate,
      remainingDays: rem, amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setOfBusy(false);
    setOfName(""); setOfPhone(""); setOfPlan("1_month");
    setOfStart(new Date().toISOString().split("T")[0]);
    setOfTotal(String(20 * OWNER_FAMILY_MONTHS["1_month"]));
    setOfPaid(String(20 * OWNER_FAMILY_MONTHS["1_month"]));
    setToastMessage(`تم تسجيل اشتراك عائلة المالك — $${pay.totalNum}`);
  };

  // ── Corporate offer submit ─────────────────────────────────────────────────
  const handleCorporateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCorpError(null);
    const pay = computePayment(corpTotal, corpPaid);
    if (pay.overpaid) { setCorpError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setCorpBusy(true);
    const endDate        = calculateEndDate(corpStart, corpPlan, "corporate");
    const groupId        = crypto.randomUUID();
    console.log("Corporate submit:", { corpName, corpPhone, corpOrg, corpPlan, total: pay.totalNum, paid: pay.paidNum, status: pay.status });

    const m = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: corpName, phone: corpPhone });
    if (m.error) { setCorpError(m.error); setCorpBusy(false); return; }

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: corpName.trim(),
      memberId: m.data?.id,
      phone: corpPhone,
      planType: corpPlan, offer: "corporate",
      startDate: corpStart, endDate,
      amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status,
      currency: "usd", exchangeRate, groupId,
    });
    if (r.error) { setCorpError(r.error); setCorpBusy(false); return; }

    await pushGroupOffer({
      user: { id: user.id, displayName: user.displayName },
      groupId, offerType: "corporate",
      members: [{ name: corpName.trim() }],
      discountPercent: 15,
      organizationType: corpOrg,
      priceApplied: pay.totalNum,
    });

    const rem = calculateRemainingDays(endDate);
    addSubscription({
      id: String(r.data!.id),
      memberId: String(r.data!.created_by ?? user.id),
      memberName: corpName.trim(),
      planType: corpPlan, offer: "corporate",
      startDate: corpStart, endDate,
      remainingDays: rem, amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setCorpBusy(false);
    setCorpName(""); setCorpPhone(""); setCorpPlan("1_month");
    setCorpStart(new Date().toISOString().split("T")[0]);
    const reset = String(Math.round(PLAN_BASE_PRICES["1_month"] * 0.85));
    setCorpTotal(reset); setCorpPaid(reset);
    setToastMessage(`تم تسجيل اشتراك شركة بخصم ١٥٪ — $${pay.totalNum}`);
  };

  // ── College offer submit ───────────────────────────────────────────────────
  const handleCollegeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCollegeError(null);
    const pay = computePayment(collegeTotal, collegePaid);
    if (pay.overpaid) { setCollegeError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setCollegeBusy(true);
    const endDate         = calculateEndDate(collegeStart, collegePlan, "college");
    console.log("College submit:", { collegeName, collegePhone, collegePlan, total: pay.totalNum, paid: pay.paidNum, status: pay.status });

    const m = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: collegeName, phone: collegePhone });
    if (m.error) { setCollegeError(m.error); setCollegeBusy(false); return; }

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: collegeName.trim(),
      memberId: m.data?.id,
      phone: collegePhone,
      planType: collegePlan, offer: "college",
      startDate: collegeStart, endDate,
      amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status,
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
      remainingDays: rem, amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setCollegeBusy(false);
    setCollegeName(""); setCollegePhone(""); setCollegePlan("1_month");
    setCollegeStart(new Date().toISOString().split("T")[0]);
    const reset = String(calculateDiscountedPrice(PLAN_BASE_PRICES["1_month"], "college"));
    setCollegeTotal(reset); setCollegePaid(reset);
    setToastMessage(`تم تسجيل اشتراك طالب جامعي بخصم ٢٠٪ — $${pay.totalNum}`);
  };

  // ── Custom / free registration submit ─────────────────────────────────────
  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCustomError(null);
    if (!customName.trim()) { setCustomError("أدخل اسم العضو"); return; }
    const pay = computePayment(customAmount, customPaid);
    if (pay.overpaid) { setCustomError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي"); return; }
    setCustomBusy(true);
    const endDate = calculateEndDate(customStart, customPlan, "custom_registration");

    const m = await findOrCreateMember({ user: { id: user.id, displayName: user.displayName }, name: customName, phone: customPhone });
    if (m.error) { setCustomError(m.error); setCustomBusy(false); return; }

    const r = await pushSubscription({
      user: { id: user.id, displayName: user.displayName },
      memberName: customName.trim(),
      memberId: m.data?.id,
      phone: customPhone,
      planType: customPlan, offer: "custom_registration",
      startDate: customStart, endDate,
      amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status,
      currency: "usd", exchangeRate,
      note: customNote.trim() || null,
    });
    if (r.error) { setCustomError(r.error); setCustomBusy(false); return; }

    const rem = calculateRemainingDays(endDate);
    addSubscription({
      id: String(r.data!.id),
      memberId: String(r.data!.created_by ?? user.id),
      memberName: customName.trim(),
      planType: customPlan, offer: "custom_registration",
      startDate: customStart, endDate,
      remainingDays: rem, amount: pay.totalNum, paidAmount: pay.paidNum,
      paymentStatus: pay.status, paymentMethod: "cash",
      currency: "usd",
      status: rem > 0 ? "active" : "expired",
      privateCoachName: null,
      note: customNote.trim() || null,
      createdAt: String(r.data!.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      lockedAt: String(r.data!.created_at ?? new Date().toISOString()),
    });

    setCustomBusy(false);
    setCustomName(""); setCustomPhone(""); setCustomPlan("1_month");
    setCustomStart(new Date().toISOString().split("T")[0]);
    setCustomAmount("0"); setCustomPaid("0"); setCustomNote("");
    setToastMessage(`تم تسجيل تسجيل مخصص — $${pay.totalNum} — ${pay.status}`);
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
    { key: "partial",  label: "جزئي" },
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
                            {ALL_PLAN_TYPES.map((p) => (
                              <option key={p} value={p}>
                                {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} $
                              </option>
                            ))}
                          </select>
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-1 gap-4">
                      <div>
                        <label className={labelCls}>تاريخ البدء</label>
                        <input required type="date" className={inputCls} value={form.startDate}
                          onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
                      </div>
                    </div>

                    <PaymentFields
                      totalAmount={form.amount}
                      onTotalChange={(v) => setForm((p) => ({ ...p, amount: v }))}
                      paidAmount={normalPaid}
                      onPaidChange={setNormalPaid}
                      inputCls={inputCls}
                      labelCls={labelCls}
                    />

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
                            handlePtCountChange(n);
                          }}
                        />
                      </div>
                      <div className="flex flex-col justify-end pb-0.5">
                        {(() => {
                          const { groupPrice, trainerFee, total } = ptCalc(ptCount);
                          return (
                            <div className="p-3 bg-void border border-gunmetal rounded">
                              <p className="font-mono text-[9px] text-slate uppercase tracking-wider mb-1">التسعيرة الافتراضية</p>
                              <p className="font-mono text-xs text-secondary">${trainerFee} مدرب + ${groupPrice} مجموعة</p>
                              <p className="font-display text-2xl text-gold-bright">${total}</p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <PaymentFields
                      totalAmount={ptTotal}
                      onTotalChange={setPtTotal}
                      paidAmount={ptPaid}
                      onPaidChange={setPtPaid}
                      inputCls={inputCls}
                      labelCls={labelCls}
                    />

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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>اسم المدرب الخاص (اختياري)</label>
                        <input type="text" className={inputCls} placeholder="اسم الكوتش"
                          value={ptCoach}
                          onChange={(e) => setPtCoach(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelCls}>ملاحظات (اختياري)</label>
                        <input type="text" className={inputCls} value={ptNotes}
                          onChange={(e) => setPtNotes(e.target.value)} />
                      </div>
                    </div>

                    {ptError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{ptError}</div>}

                    <div className="flex items-center gap-3 pt-1">
                      <button type="submit" disabled={ptBusy}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                        <LockIcon size={13} />{ptBusy ? "جاري الحفظ…" : "حفظ جلسة التدريب"}
                      </button>
                      <button type="button"
                        onClick={() => { setPtCount(1); setPtNames([""]); setPtNotes(""); setPtCoach(""); setFormOpen(false); }}
                        className="px-4 py-2.5 border border-gunmetal text-secondary hover:text-ghost font-body text-sm rounded transition-colors">
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {/* ── Search ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 bg-charcoal border border-gunmetal rounded p-2">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-secondary shrink-0 mr-1">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم، الهاتف، اسم الكوتش، الخطة، العرض، حالة الدفع…"
                className="flex-1 bg-transparent border-0 text-offwhite font-body text-sm focus:outline-none placeholder:text-slate"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="px-2 py-0.5 font-mono text-[10px] text-secondary hover:text-offwhite transition-colors cursor-pointer"
                >
                  مسح
                </button>
              )}
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
                    {["اسم العضو","الهاتف","الكوتش","الخطة","العرض","تاريخ البدء","تاريخ الانتهاء","الأيام المتبقية","المبلغ","الدفع","الحالة",""].map((col, i) => (
                      <th key={i} className="px-3.5 py-2.5 text-right font-mono text-[10px] text-secondary uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-10 text-center font-mono text-xs text-slate uppercase tracking-wider">
                        {subscriptions.length === 0 ? "لا توجد اشتراكات" : (searchQuery ? "لا توجد نتائج للبحث" : "لا توجد اشتراكات تطابق هذا الفلتر")}
                      </td>
                    </tr>
                  )}
                  {filtered.map((sub) => (
                    <tr key={sub.id}
                      className={`ox-table-row bg-iron/50 border-b border-gunmetal last:border-b-0 transition-colors duration-100 hover:bg-gunmetal/60 ${sub.status === "expired" ? "opacity-60" : ""} ${rowAccent(sub)}`}>
                      <td className="px-3.5 py-3 font-body font-medium text-sm text-offwhite whitespace-nowrap">
                        {sub.memberName}
                        {sub.note && (
                          <span className="block font-mono text-[9px] text-slate italic mt-0.5 truncate max-w-[180px]" title={sub.note}>
                            {sub.note}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-xs text-ghost tabular-nums whitespace-nowrap" dir="ltr">
                        {sub.phone ? sub.phone : <span className="text-slate">—</span>}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-xs text-ghost whitespace-nowrap">
                        {sub.privateCoachName ? sub.privateCoachName : <span className="text-slate">—</span>}
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
                          <span className="block font-mono text-[9px] text-gold tabular-nums">
                            مدفوع: {formatCurrency(sub.paidAmount)} $ · متبقي: {formatCurrency(Math.max(0, sub.amount - sub.paidAmount))} $
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-3"><PaymentStatusChip status={sub.paymentStatus} /></td>
                      <td className="px-3.5 py-3"><SubStatusChip status={sub.status} /></td>
                      <td className="px-3.5 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {sub.status !== "cancelled" ? (
                            <button
                              onClick={() => openEditModal(sub)}
                              className="p-1 text-secondary hover:text-gold transition-colors cursor-pointer"
                              title="تعديل الاشتراك"
                            >
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                <path d="M9 1.5L11.5 4M2 11l1-3.5L9 1.5l2.5 2.5L5.5 10 2 11z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          ) : null}
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
                        </div>
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
            <div className="flex items-center gap-1 border-b border-gunmetal pb-0 -mb-px overflow-x-auto">
              {(["couple", "referral", "corporate", "college", "owner_family", "custom_registration"] as const).map((tab) => (
                <button key={tab} onClick={() => setOfferTab(tab)}
                  className={`px-3.5 py-2 font-mono text-[11px] uppercase tracking-wider border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    offerTab === tab ? "border-gold text-gold" : "border-transparent text-secondary hover:text-ghost"
                  }`}>
                  {tab === "couple" ? "عرض الزوجين"
                    : tab === "referral" ? "الإحالة"
                    : tab === "corporate" ? "شركات / بنوك"
                    : tab === "college" ? "طلاب جامعات"
                    : tab === "owner_family" ? "عائلة المالك"
                    : "تسجيل مجاني / مخصص"}
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
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>الشخص الأول</label>
                        <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                          value={coupleNames[0]}
                          onChange={(e) => setCoupleNames([e.target.value, coupleNames[1]])} />
                      </div>
                      <div>
                        <label className={labelCls}>هاتف الشخص الأول</label>
                        <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                          value={couplePhones[0]}
                          onChange={(e) => setCouplePhones([e.target.value, couplePhones[1]])} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className={labelCls}>الشخص الثاني</label>
                        <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                          value={coupleNames[1]}
                          onChange={(e) => setCoupleNames([coupleNames[0], e.target.value])} />
                      </div>
                      <div>
                        <label className={labelCls}>هاتف الشخص الثاني</label>
                        <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                          value={couplePhones[1]}
                          onChange={(e) => setCouplePhones([couplePhones[0], e.target.value])} />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>تاريخ البدء</label>
                    <input required type="date" className={inputCls} value={coupleStart}
                      onChange={(e) => setCoupleStart(e.target.value)} />
                  </div>
                  <PaymentFields
                    totalAmount={coupleTotal}
                    onTotalChange={setCoupleTotal}
                    paidAmount={couplePaid}
                    onPaidChange={setCouplePaid}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    error={coupleError}
                  />
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>اسم العضو (المُحيل)</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={refMain} onChange={(e) => setRefMain(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>هاتف العضو</label>
                      <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                        value={refMainPhone} onChange={(e) => setRefMainPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={refPlan}
                          onChange={(e) => handleRefPlanChange(e.target.value as PlanType)}>
                          {MONTHLY_PLAN_TYPES.map((p) => {
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
                        <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
                          <input type="text" className={inputCls} placeholder={`صديق ${i + 1}`}
                            value={name}
                            onChange={(e) => { const next = [...refFriends]; next[i] = e.target.value; setRefFriends(next); }} />
                          <div className="flex items-center gap-2">
                            <input type="tel" className={inputCls} placeholder={`هاتف صديق ${i + 1}`}
                              value={refFriendPhones[i] ?? ""}
                              onChange={(e) => { const next = [...refFriendPhones]; next[i] = e.target.value; setRefFriendPhones(next); }} />
                            {i >= 5 && (
                              <button type="button"
                                onClick={() => {
                                  setRefFriends(refFriends.filter((_, j) => j !== i));
                                  setRefFriendPhones(refFriendPhones.filter((_, j) => j !== i));
                                }}
                                className="p-1 text-secondary hover:text-red transition-colors shrink-0">
                                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                  <path d="M2 11L6.5 6.5M11 2L6.5 6.5M6.5 6.5L2 2M6.5 6.5L11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => { setRefFriends([...refFriends, ""]); setRefFriendPhones([...refFriendPhones, ""]); }}
                        className="w-full py-1.5 border border-dashed border-gunmetal text-secondary hover:text-ghost font-mono text-[10px] uppercase tracking-wider transition-colors rounded">
                        + إضافة صديق
                      </button>
                    </div>
                  </div>
                  <PaymentFields
                    totalAmount={refTotal}
                    onTotalChange={setRefTotal}
                    paidAmount={refPaid}
                    onPaidChange={setRefPaid}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    error={refError}
                  />
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>اسم العضو</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={corpName} onChange={(e) => setCorpName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>الهاتف</label>
                      <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                        value={corpPhone} onChange={(e) => setCorpPhone(e.target.value)} />
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
                          onChange={(e) => handleCorpPlanChange(e.target.value as PlanType)}>
                          {MONTHLY_PLAN_TYPES.map((p) => {
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
                  <PaymentFields
                    totalAmount={corpTotal}
                    onTotalChange={setCorpTotal}
                    paidAmount={corpPaid}
                    onPaidChange={setCorpPaid}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    error={corpError}
                  />
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>اسم العضو</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={collegeName} onChange={(e) => setCollegeName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>الهاتف</label>
                      <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                        value={collegePhone} onChange={(e) => setCollegePhone(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={collegePlan}
                          onChange={(e) => handleCollegePlanChange(e.target.value as PlanType)}>
                          {MONTHLY_PLAN_TYPES.map((p) => (
                            <option key={p} value={p}>
                              {getPlanLabel(p)} — {PLAN_BASE_PRICES[p]} $
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-1 gap-4">
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={collegeStart}
                        onChange={(e) => setCollegeStart(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-void border border-gunmetal rounded">
                    <div>
                      <p className="font-mono text-[9px] text-slate uppercase tracking-wider">السعر بعد خصم ٢٠٪</p>
                      <p className="font-mono text-xs text-secondary line-through mt-0.5">{PLAN_BASE_PRICES[collegePlan]} $</p>
                    </div>
                    <span className="font-display text-2xl text-gold-bright">${calculateDiscountedPrice(PLAN_BASE_PRICES[collegePlan], "college")}</span>
                  </div>
                  <PaymentFields
                    totalAmount={collegeTotal}
                    onTotalChange={setCollegeTotal}
                    paidAmount={collegePaid}
                    onPaidChange={setCollegePaid}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    error={collegeError}
                  />
                  <button type="submit" disabled={collegeBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{collegeBusy ? "جاري الحفظ…" : "تسجيل اشتراك الطالب"}
                  </button>
                </form>
              </div>
            )}

            {/* ── Owner family form ($20 × months) ───────────────────────── */}
            {offerTab === "owner_family" && (
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <div className="mb-4">
                  <p className="font-mono text-[10px] text-secondary uppercase tracking-widest">عائلة المالك</p>
                  <p className="font-mono text-[9px] text-slate mt-0.5">السعر $20 لكل شهر</p>
                </div>
                <form onSubmit={handleOwnerFamilySubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>اسم العضو</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={ofName} onChange={(e) => setOfName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>الهاتف</label>
                      <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                        value={ofPhone} onChange={(e) => setOfPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={ofPlan}
                          onChange={(e) => handleOfPlanChange(e.target.value as PlanType)}>
                          {OWNER_FAMILY_PLAN_TYPES.map((p) => (
                            <option key={p} value={p}>
                              {getPlanLabel(p)} — ${20 * OWNER_FAMILY_MONTHS[p]}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={ofStart}
                        onChange={(e) => setOfStart(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-void border border-gunmetal rounded">
                    <div>
                      <p className="font-mono text-[9px] text-slate uppercase tracking-wider">الإجمالي الافتراضي ($20 × {OWNER_FAMILY_MONTHS[ofPlan]} شهر)</p>
                    </div>
                    <span className="font-display text-2xl text-gold-bright">${20 * OWNER_FAMILY_MONTHS[ofPlan]}</span>
                  </div>
                  <PaymentFields
                    totalAmount={ofTotal}
                    onTotalChange={setOfTotal}
                    paidAmount={ofPaid}
                    onPaidChange={setOfPaid}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    error={ofError}
                  />
                  <button type="submit" disabled={ofBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{ofBusy ? "جاري الحفظ…" : "تسجيل اشتراك عائلة المالك"}
                  </button>
                </form>
              </div>
            )}

            {/* ── Free / Custom registration form ────────────────────────── */}
            {offerTab === "custom_registration" && (
              <div className="border border-gunmetal bg-charcoal rounded clip-corner p-5">
                <div className="mb-4">
                  <p className="font-mono text-[10px] text-secondary uppercase tracking-widest">تسجيل مجاني / مخصص</p>
                  <p className="font-mono text-[9px] text-slate mt-0.5">
                    حالات خاصة: صديق المالك، اتفاق يدوي، خصم خاص — المبلغ قابل للتعديل من قبل الاستقبال
                  </p>
                </div>
                <form onSubmit={handleCustomSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>الاسم</label>
                      <input required type="text" className={inputCls} placeholder="الاسم الكامل"
                        value={customName} onChange={(e) => setCustomName(e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>الهاتف</label>
                      <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                        value={customPhone} onChange={(e) => setCustomPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>نوع الخطة</label>
                      <div className="relative">
                        <select className={selectCls} value={customPlan}
                          onChange={(e) => setCustomPlan(e.target.value as PlanType)}>
                          {ALL_PLAN_TYPES.map((p) => (
                            <option key={p} value={p}>{getPlanLabel(p)}</option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>تاريخ البدء</label>
                      <input required type="date" className={inputCls} value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)} />
                    </div>
                  </div>
                  <PaymentFields
                    totalAmount={customAmount}
                    onTotalChange={setCustomAmount}
                    paidAmount={customPaid}
                    onPaidChange={setCustomPaid}
                    inputCls={inputCls}
                    labelCls={labelCls}
                    error={customError}
                  />
                  <div>
                    <label className={labelCls}>ملاحظة (مثال: صديق المالك، اتفاق يدوي…)</label>
                    <input type="text" className={inputCls} placeholder="ملاحظة الاستقبال"
                      value={customNote} onChange={(e) => setCustomNote(e.target.value)} />
                  </div>
                  <button type="submit" disabled={customBusy}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase clip-corner-sm transition-colors disabled:opacity-40">
                    <LockIcon size={13} />{customBusy ? "جاري الحفظ…" : "تسجيل التسجيل المخصص"}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* ── Edit subscription modal ───────────────────────────────────── */}
        {editSub && editForm && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center bg-void/80 backdrop-blur-sm" dir="rtl">
            <div className="bg-charcoal border border-gunmetal rounded clip-corner p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" style={{ borderTop: "3px solid #F5C100" }}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display text-lg tracking-widest text-offwhite">تعديل اشتراك</h3>
                <button onClick={closeEditModal} className="text-secondary hover:text-offwhite cursor-pointer transition-colors">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L8 8M13 3L8 8M8 8L3 3M8 8L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                </button>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!user || !editSub || !editForm) return;
                setEditError(null);
                setEditBusy(true);
                const newAmount = Math.max(0, Number(editForm.amount) || 0);
                const newPaid   = Math.max(0, Number(editForm.paidAmount) || 0);
                if (newPaid > newAmount && newAmount > 0) {
                  setEditError("المبلغ المدفوع لا يمكن أن يتجاوز المبلغ الإجمالي");
                  setEditBusy(false);
                  return;
                }
                const computedStatus: PaymentStatus =
                  newPaid <= 0 ? "unpaid" :
                  newPaid >= newAmount ? "paid" : "partial";
                const r = await updateSubscription(editSub.id, {
                  memberName: editForm.memberName.trim(),
                  phone: editForm.phone.trim() || null,
                  planType: editForm.planType,
                  offer: editForm.offer,
                  startDate: editForm.startDate,
                  endDate: editForm.endDate,
                  amount: newAmount,
                  paidAmount: newPaid,
                  paymentStatus: computedStatus,
                  privateCoachName: editForm.privateCoachName.trim() || null,
                  note: editForm.note.trim() || null,
                }, { id: user.id, displayName: user.displayName });
                setEditBusy(false);
                if (r.error) { setEditError(r.error); return; }
                const row = r.data!;
                const updatedSub: Subscription = {
                  ...editSub,
                  memberName: String(row.member_name ?? editForm.memberName),
                  phone: row.phone == null ? null : String(row.phone),
                  planType: String(row.plan_type ?? editForm.planType) as PlanType,
                  offer: String(row.offer ?? editForm.offer) as OfferType,
                  startDate: String(row.start_date ?? editForm.startDate),
                  endDate: String(row.end_date ?? editForm.endDate),
                  remainingDays: calculateRemainingDays(String(row.end_date ?? editForm.endDate)),
                  amount: Number(row.amount ?? newAmount),
                  paidAmount: Number(row.paid_amount ?? newPaid),
                  paymentStatus: String(row.payment_status ?? computedStatus) as PaymentStatus,
                  privateCoachName: row.private_coach_name == null ? null : String(row.private_coach_name),
                  note: row.note == null ? null : String(row.note),
                };
                replaceSubscription(editSub.id, updatedSub);
                closeEditModal();
                setToastMessage("تم تحديث الاشتراك");
              }} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>اسم العضو</label>
                    <input required type="text" className={inputCls}
                      value={editForm.memberName}
                      onChange={(e) => setEditForm({ ...editForm, memberName: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>الهاتف</label>
                    <input type="tel" className={inputCls} placeholder="+963 9x xxx xxxx"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>نوع الخطة</label>
                    <div className="relative">
                      <select className={selectCls} value={editForm.planType}
                        onChange={(e) => setEditForm({ ...editForm, planType: e.target.value as PlanType })}>
                        {ALL_PLAN_TYPES.map((p) => (<option key={p} value={p}>{getPlanLabel(p)}</option>))}
                      </select>
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>العرض</label>
                    <div className="relative">
                      <select className={selectCls} value={editForm.offer}
                        onChange={(e) => setEditForm({ ...editForm, offer: e.target.value as OfferType })}>
                        <option value="none">بدون</option>
                        <option value="couple">زوجين</option>
                        <option value="referral_4">إحالة ٤</option>
                        <option value="referral_9">إحالة ٩</option>
                        <option value="corporate">شركات</option>
                        <option value="college">طلاب</option>
                        <option value="owner_family">عائلة المالك</option>
                        <option value="custom_registration">تسجيل مجاني / مخصص</option>
                      </select>
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary"><ChevronIcon open={false} /></span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>تاريخ البدء</label>
                    <input required type="date" className={inputCls}
                      value={editForm.startDate}
                      onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>تاريخ الانتهاء</label>
                    <input required type="date" className={inputCls}
                      value={editForm.endDate}
                      onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
                  </div>
                </div>
                <PaymentFields
                  totalAmount={editForm.amount}
                  onTotalChange={(v) => setEditForm({ ...editForm, amount: v })}
                  paidAmount={editForm.paidAmount}
                  onPaidChange={(v) => setEditForm({ ...editForm, paidAmount: v })}
                  inputCls={inputCls}
                  labelCls={labelCls}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>اسم المدرب الخاص</label>
                    <input type="text" className={inputCls} placeholder="اختياري"
                      value={editForm.privateCoachName}
                      onChange={(e) => setEditForm({ ...editForm, privateCoachName: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>ملاحظة</label>
                    <input type="text" className={inputCls} placeholder="ملاحظة الاستقبال"
                      value={editForm.note}
                      onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
                  </div>
                </div>
                {editError && <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{editError}</div>}
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={editBusy}
                    className="flex-1 py-2.5 bg-gold hover:bg-gold-bright text-void font-display text-sm tracking-widest uppercase rounded clip-corner-sm transition-colors disabled:opacity-40">
                    {editBusy ? "جاري الحفظ…" : "حفظ التعديلات"}
                  </button>
                  <button type="button" onClick={closeEditModal} disabled={editBusy}
                    className="px-5 py-2.5 border border-gunmetal text-secondary hover:text-offwhite font-mono text-xs uppercase tracking-wider rounded transition-colors disabled:opacity-40">
                    إلغاء
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </section>
    </>
  );
}
