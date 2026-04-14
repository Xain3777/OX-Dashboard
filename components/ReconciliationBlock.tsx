"use client";

import { useState, useMemo } from "react";
import {
  Lock,
  LockOpen,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  CreditCard,
  ArrowLeft,
  ShieldAlert,
  Calendar,
  Clock,
  ReceiptText,
} from "lucide-react";
import type { CashSession } from "@/lib/types";
import { formatCurrency } from "@/lib/business-logic";
import PriceTag from "@/components/PriceTag";

interface ReconciliationBlockProps {
  session: CashSession;
  onCloseDay: (params: {
    actualCash: number;
    discrepancy: number;
    discrepancyNote: string;
  }) => void;
  totalTransactions?: number;
  cardTransferSales?: number;
}

// ─── Flow Node ──────────────────────────────────────────────────────────────

interface FlowNodeProps {
  label: string;
  value: number;
  variant: "gold" | "success" | "red" | "expected";
}

function FlowNode({ label, value, variant }: FlowNodeProps) {
  const borderClass =
    variant === "gold" ? "border-gold/60"
    : variant === "success" ? "border-success/50"
    : variant === "red" ? "border-red/50"
    : "border-gold border-[1.5px]";

  const bgClass = variant === "expected" ? "bg-gunmetal/80" : "bg-iron/60";

  return (
    <div className={`flex flex-col gap-1 px-4 py-3 border ${borderClass} ${bgClass} min-w-[130px] flex-1`}>
      <span className="font-mono text-[10px] text-secondary tracking-widest leading-none">
        {label}
      </span>
      <PriceTag amount={value} size="lg" className={
        variant === "gold" ? "text-gold"
        : variant === "success" ? "text-success"
        : variant === "red" ? "text-red-bright"
        : "text-offwhite"
      } />
    </div>
  );
}

// ─── Flow Connector (RTL: arrows point left) ────────────────────────────────

function FlowConnector({ sign }: { sign: "+" | "-" | "=" }) {
  const color =
    sign === "+" ? "text-success"
    : sign === "-" ? "text-red-bright"
    : "text-gold";

  return (
    <div className="flex items-center gap-1 shrink-0 select-none">
      <ArrowLeft size={14} className="text-slate" />
      <span className={`font-display text-xl ${color}`}>{sign}</span>
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CashSession["status"] }) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 bg-gold/10 border border-gold/40 font-mono text-xs text-gold tracking-widest">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-gold" />
        </span>
        مفتوحة
      </span>
    );
  }
  if (status === "discrepancy") {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 bg-red/10 border border-red/50 font-mono text-xs text-red-bright tracking-widest glow-red">
        <AlertTriangle size={12} />
        فرق
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 bg-success/10 border border-success/40 font-mono text-xs text-success tracking-widest">
      <CheckCircle2 size={12} />
      تم إغلاق اليوم
    </span>
  );
}

// ─── Difference Indicator ───────────────────────────────────────────────────

function DifferenceRow({ expected, actual }: { expected: number; actual: number | null }) {
  if (actual === null) {
    return <p className="font-mono text-xs text-slate">أدخل النقد المعدود لعرض المقارنة</p>;
  }
  const diff = actual - expected;
  const isMatch = diff === 0;
  const isOver = diff > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-secondary tracking-widest">المتوقع</span>
          <PriceTag amount={expected} size="md" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-secondary tracking-widest">المُدخل</span>
          <PriceTag amount={actual} size="md" />
        </div>
      </div>
      {isMatch ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-success/10 border border-success/40">
          <CheckCircle2 size={14} className="text-success shrink-0" />
          <span className="font-mono text-xs text-success">النقد مطابق تماماً — لا يوجد فرق</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 bg-red/10 border border-red/50 glow-red">
          <AlertTriangle size={14} className="text-red-bright shrink-0" />
          <span className="font-mono text-xs text-red-bright">
            تم اكتشاف فرق: <strong>{isOver ? "+" : ""}{formatCurrency(diff)}$</strong>
            {isOver ? " (زيادة)" : " (عجز)"}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Daily Summary Grid ─────────────────────────────────────────────────────

function DailySummaryGrid({ session, totalTransactions, cardTransferSales }: {
  session: CashSession; totalTransactions: number; cardTransferSales: number;
}) {
  const items = [
    { label: "إجمالي العمليات", value: totalTransactions, isMoney: false, icon: <ReceiptText size={13} />, accent: "default" as const },
    { label: "النقد الوارد", value: session.totalCashSales, isMoney: true, icon: <TrendingUp size={13} />, accent: "success" as const },
    { label: "النقد الصادر", value: session.totalCashExpenses, isMoney: true, icon: <TrendingDown size={13} />, accent: "red" as const },
    { label: "بطاقة/تحويل", value: cardTransferSales, isMoney: true, icon: <CreditCard size={13} />, accent: "default" as const },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 px-3 py-2.5 bg-iron/50 border border-gunmetal">
          <div className="flex items-center gap-1.5 text-secondary">
            {item.icon}
            <span className="font-mono text-[10px] tracking-widest">{item.label}</span>
          </div>
          {item.isMoney ? (
            <PriceTag amount={item.value} size="sm" className={
              item.accent === "success" ? "text-success" : item.accent === "red" ? "text-red-bright" : "text-offwhite"
            } />
          ) : (
            <span className="font-mono text-sm tabular-nums text-offwhite">{item.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Close Day Panel ────────────────────────────────────────────────────────

function CloseDayPanel({ session, onCloseDay }: { session: CashSession; onCloseDay: ReconciliationBlockProps["onCloseDay"] }) {
  const [actualCashStr, setActualCashStr] = useState("");
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);

  const actualCash = useMemo(() => {
    const parsed = parseFloat(actualCashStr.replace(/,/g, ""));
    return isNaN(parsed) ? null : parsed;
  }, [actualCashStr]);

  const diff = actualCash !== null ? actualCash - session.expectedCash : null;
  const hasDiscrepancy = diff !== null && diff !== 0;
  const noteRequired = hasDiscrepancy && discrepancyNote.trim().length === 0;
  const canSubmit = actualCash !== null && (!hasDiscrepancy || !noteRequired);

  function handleConfirm() {
    if (!canSubmit || actualCash === null) return;
    onCloseDay({ actualCash, discrepancy: diff ?? 0, discrepancyNote: discrepancyNote.trim() });
  }

  return (
    <div className="relative overflow-hidden border border-gunmetal">
      <div className="absolute inset-0 pointer-events-none opacity-[0.025] hazard-stripe" aria-hidden="true" />
      <div className="relative z-10 p-5 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="actual-cash" className="font-mono text-[10px] text-secondary tracking-widest">
            النقد الفعلي (العد)
          </label>
          <input
            id="actual-cash"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            value={actualCashStr}
            onChange={(e) => { setActualCashStr(e.target.value); setConfirmStep(false); }}
            dir="ltr"
            className={[
              "w-full bg-void text-center font-mono text-3xl tabular-nums text-offwhite",
              "py-4 px-5 border outline-none transition-all placeholder:text-slate",
              actualCash !== null
                ? hasDiscrepancy ? "border-red/60 focus:border-red" : "border-success/60 focus:border-success"
                : "border-gunmetal focus:border-gold",
            ].join(" ")}
          />
          <p className="text-center font-mono text-[10px] text-slate tracking-widest">
            $ — قم بعدّ النقد الفعلي في الخزينة
          </p>
        </div>

        <DifferenceRow expected={session.expectedCash} actual={actualCash} />

        {hasDiscrepancy && (
          <div className="flex flex-col gap-2">
            <label htmlFor="discrepancy-note" className="flex items-center gap-1.5 font-mono text-[10px] text-red-bright tracking-widest">
              <ShieldAlert size={11} />
              ملاحظة الفرق <span className="text-red-bright">*</span>
              <span className="text-slate">— مطلوب</span>
            </label>
            <textarea
              id="discrepancy-note"
              rows={3}
              value={discrepancyNote}
              onChange={(e) => { setDiscrepancyNote(e.target.value); setConfirmStep(false); }}
              placeholder="اشرح سبب الفرق..."
              className="w-full bg-void text-sm font-body text-offwhite placeholder:text-slate border border-red/40 focus:border-red focus:outline-none px-3 py-2 resize-none transition-colors"
            />
          </div>
        )}

        {!confirmStep ? (
          <button
            onClick={() => setConfirmStep(true)}
            disabled={!canSubmit}
            className={[
              "w-full py-3.5 px-6 font-display text-xl tracking-wider transition-all cursor-pointer",
              "disabled:opacity-30 disabled:cursor-not-allowed",
              hasDiscrepancy
                ? "bg-red/20 border border-red/70 text-red-bright hover:bg-red/30 glow-red"
                : "bg-gold text-void hover:bg-gold-bright glow-gold",
            ].join(" ")}
          >
            {hasDiscrepancy ? "إغلاق مع وجود فرق" : "إغلاق اليوم وقفله"}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="px-4 py-3 bg-red/10 border border-red/50 flex items-start gap-3">
              <ShieldAlert size={16} className="text-red-bright shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <p className="font-mono text-xs text-red-bright font-bold tracking-wider">تأكيد إغلاق اليوم</p>
                <p className="font-body text-xs text-ghost leading-snug">
                  أنت على وشك قفل <strong className="text-offwhite">{session.date}</strong>.
                  {actualCash !== null && <> النقد الفعلي: <PriceTag amount={actualCash} size="sm" className="inline text-offwhite font-bold" />.</>}
                  {hasDiscrepancy && diff !== null && <> الفرق: <strong className="text-red-bright">{diff > 0 ? "+" : ""}{formatCurrency(diff)}$</strong>.</>}
                  {" "}هذا الإجراء دائم ولا يمكن التراجع عنه.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmStep(false)} className="flex-1 py-3 font-display text-base tracking-wider text-secondary border border-gunmetal hover:border-slate hover:text-offwhite transition-colors cursor-pointer">
                إلغاء
              </button>
              <button
                onClick={handleConfirm}
                className={[
                  "flex-1 py-3 font-display text-base tracking-wider transition-all cursor-pointer",
                  hasDiscrepancy ? "bg-red/80 text-offwhite hover:bg-red border border-red/80 glow-red" : "bg-gold text-void hover:bg-gold-bright glow-gold",
                ].join(" ")}
              >
                تأكيد وقفل
              </button>
            </div>
          </div>
        )}

        <p className="text-center font-mono text-[10px] text-slate tracking-widest">هذا الإجراء دائم ولا يمكن التراجع عنه</p>
      </div>
    </div>
  );
}

// ─── Closed State View ──────────────────────────────────────────────────────

function ClosedStateView({ session }: { session: CashSession }) {
  const hasDisc = session.status === "discrepancy" || (session.discrepancy !== undefined && session.discrepancy !== 0);
  const diff = session.discrepancy ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-iron border border-gunmetal">
        <div className="flex items-center gap-2">
          <Lock size={14} className="text-success shrink-0" />
          <span className="font-mono text-xs text-success tracking-widest">تم إغلاق اليوم</span>
        </div>
        <div className="flex items-center gap-4">
          {session.closedBy && <span className="font-mono text-[10px] text-secondary">بواسطة <span className="text-ghost">{session.closedBy}</span></span>}
          {session.closedAt && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-secondary">
              <Clock size={10} />
              تم الإغلاق في {new Date(session.closedAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 px-3 py-2.5 bg-iron/50 border border-gunmetal">
          <span className="font-mono text-[10px] text-secondary tracking-widest">النقد المتوقع</span>
          <PriceTag amount={session.expectedCash} size="md" />
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2.5 bg-iron/50 border border-gunmetal">
          <span className="font-mono text-[10px] text-secondary tracking-widest">النقد الفعلي</span>
          {session.actualCash !== undefined ? <PriceTag amount={session.actualCash} size="md" /> : <span className="font-mono text-base text-slate">—</span>}
        </div>
        <div className={`flex flex-col gap-0.5 px-3 py-2.5 border col-span-2 sm:col-span-1 ${hasDisc ? "bg-red/10 border-red/40" : "bg-success/10 border-success/40"}`}>
          <span className="font-mono text-[10px] text-secondary tracking-widest">الفرق</span>
          {hasDisc ? (
            <span className="font-mono text-base tabular-nums text-red-bright">{diff > 0 ? "+" : ""}{formatCurrency(diff)}$</span>
          ) : (
            <span className="font-mono text-base text-success">لا يوجد</span>
          )}
        </div>
      </div>
      {hasDisc && session.discrepancyNote && (
        <div className="flex flex-col gap-1.5 px-4 py-3 bg-red/5 border border-red/30">
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-red-bright tracking-widest"><ShieldAlert size={10} /> ملاحظة الفرق</span>
          <p className="font-body text-sm text-ghost leading-snug">{session.discrepancyNote}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ReconciliationBlock({
  session, onCloseDay, totalTransactions = 0, cardTransferSales = 0,
}: ReconciliationBlockProps) {
  const isOpen = session.status === "open";
  const isClosed = session.status === "closed" || session.status === "discrepancy";

  const formattedDate = useMemo(() => {
    const d = new Date(session.date);
    return d.toLocaleDateString("ar-SA", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }, [session.date]);

  return (
    <section aria-label="تسوية الصندوق اليومية" className="w-full">
      <div className="ox-card relative flex flex-col gap-6 p-6 sm:p-8 bg-charcoal border border-gunmetal" style={{ borderTop: "3px solid #F5C100" }}>
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-2xl tracking-wider text-offwhite">تسوية الصندوق اليومية</h2>
            <div className="flex items-center gap-2 font-mono text-gold text-sm">
              <Calendar size={12} className="shrink-0" />
              {formattedDate}
            </div>
          </div>
          <StatusBadge status={session.status} />
        </div>

        <div className="h-px bg-gunmetal" />

        {/* Cash Flow — RTL: Opening is rightmost, Expected is leftmost */}
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-[10px] text-secondary tracking-widest">تدفق النقد</h3>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap overflow-x-auto" dir="rtl">
            <FlowNode label="الرصيد الافتتاحي" value={session.openingCash} variant="gold" />
            <FlowConnector sign="+" />
            <FlowNode label="المبيعات النقدية" value={session.totalCashSales} variant="success" />
            <FlowConnector sign="-" />
            <FlowNode label="المصروفات النقدية" value={session.totalCashExpenses} variant="red" />
            <FlowConnector sign="=" />
            <FlowNode label="النقد المتوقع" value={session.expectedCash} variant="expected" />
          </div>
        </div>

        <div className="h-px bg-gunmetal" />

        {isOpen ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <LockOpen size={13} className="text-gold" />
              <span className="font-mono text-[10px] text-gold tracking-widest">الجلسة مفتوحة — إغلاق اليوم</span>
            </div>
            <CloseDayPanel session={session} onCloseDay={onCloseDay} />
          </div>
        ) : isClosed ? (
          <ClosedStateView session={session} />
        ) : null}

        <div className="h-px bg-gunmetal" />

        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-[10px] text-secondary tracking-widest">ملخص اليوم</h3>
          <DailySummaryGrid session={session} totalTransactions={totalTransactions} cardTransferSales={cardTransferSales} />
        </div>

        <ChevronLeft size={10} className="absolute bottom-3 left-3 text-gunmetal" aria-hidden="true" />
      </div>
    </section>
  );
}
