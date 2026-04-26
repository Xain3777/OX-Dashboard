"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Lock,
  CheckCircle2,
  AlertTriangle,
  Users,
  Dumbbell,
  ShoppingCart,
  UtensilsCrossed,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCurrency } from "@/lib/currency-context";
import {
  getOrCreateDailySession,
  computeDailyIncome,
  closeDailySession,
  type DailySessionInfo,
} from "@/lib/supabase/intake";
import { formatCurrency } from "@/lib/business-logic";
import type { DailyIncome } from "@/lib/types";

function fmtUSD(n: number) {
  return `$${formatCurrency(n)}`;
}

function fmtSYP(n: number, rate: number) {
  return `${Math.round(n * rate).toLocaleString("en-US")} ل.س`;
}

const ZERO: DailyIncome = { subsTotal: 0, inbodyTotal: 0, storeTotal: 0, mealsTotal: 0, totalIncome: 0 };

// ─── Income row ──────────────────────────────────────────────────────────────

function IncomeRow({
  icon, label, value, exchangeRate,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  exchangeRate: number;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gunmetal/60 last:border-0">
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-mono text-xs text-secondary">{label}</span>
      </div>
      <div className="text-left">
        <span className="font-display text-sm text-offwhite tabular-nums">{fmtUSD(value)}</span>
        <span className="font-mono text-[10px] text-slate mr-2 tabular-nums">{fmtSYP(value, exchangeRate)}</span>
      </div>
    </div>
  );
}

// ─── Close day panel ─────────────────────────────────────────────────────────

function CloseDayPanel({
  session,
  income,
  exchangeRate,
  onClose,
}: {
  session: DailySessionInfo;
  income: DailyIncome;
  exchangeRate: number;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [busy,    setBusy]    = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  async function handleClose() {
    if (!user) return;
    setBusy(true);
    setMsg(null);
    const { error } = await closeDailySession({ id: user.id, displayName: user.displayName }, session.id);
    setBusy(false);
    if (error) { setMsg(error); return; }
    onClose();
  }

  if (!confirm) {
    return (
      <button
        onClick={() => setConfirm(true)}
        className="flex items-center gap-2 px-4 py-2.5 bg-iron border border-gunmetal hover:border-gold/40 text-secondary hover:text-offwhite font-display text-sm tracking-widest transition-colors rounded-sm cursor-pointer"
      >
        <Lock size={13} />
        إغلاق اليوم
      </button>
    );
  }

  return (
    <div className="bg-iron/60 border border-gunmetal rounded-sm p-4 space-y-3">
      <p className="font-body text-sm text-secondary">
        سيتم تسجيل إجمالي الدخل اليوم (<span className="text-gold font-display">{fmtUSD(income.totalIncome)}</span>) وإغلاق جلسة {session.businessDate}. لا يمكن التراجع.
      </p>
      {msg && (
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-red shrink-0" />
          <span className="font-mono text-xs text-red">{msg}</span>
        </div>
      )}
      <div className="flex gap-3">
        <button
          onClick={handleClose}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-red/80 hover:bg-red text-white font-display text-sm tracking-widest transition-colors rounded-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? <RefreshCw size={13} className="animate-spin" /> : <Lock size={13} />}
          {busy ? "جارٍ الإغلاق…" : "تأكيد الإغلاق"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          disabled={busy}
          className="px-4 py-2 border border-gunmetal text-slate hover:text-offwhite font-mono text-xs transition-colors rounded-sm cursor-pointer"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

// ─── Closed view ─────────────────────────────────────────────────────────────

function ClosedView({ session, income, exchangeRate }: { session: DailySessionInfo; income: DailyIncome; exchangeRate: number }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-success">
        <CheckCircle2 size={15} />
        <span className="font-display text-sm tracking-widest">تم إغلاق يوم {session.businessDate}</span>
        {session.closedAt && (
          <span className="font-mono text-[10px] text-slate mr-2">
            {new Date(session.closedAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <IncomeBreakdown income={income} exchangeRate={exchangeRate} />
    </div>
  );
}

// ─── Income breakdown ────────────────────────────────────────────────────────

function IncomeBreakdown({ income, exchangeRate }: { income: DailyIncome; exchangeRate: number }) {
  return (
    <div className="bg-iron/30 border border-gunmetal rounded-sm px-4 py-2">
      <IncomeRow
        icon={<Users size={12} className="text-success" />}
        label="الاشتراكات"
        value={income.subsTotal}
        exchangeRate={exchangeRate}
      />
      <IncomeRow
        icon={<Dumbbell size={12} className="text-gold" />}
        label="InBody"
        value={income.inbodyTotal}
        exchangeRate={exchangeRate}
      />
      <IncomeRow
        icon={<ShoppingCart size={12} className="text-[#60A5FA]" />}
        label="المتجر"
        value={income.storeTotal}
        exchangeRate={exchangeRate}
      />
      <IncomeRow
        icon={<UtensilsCrossed size={12} className="text-[#F97316]" />}
        label="المطبخ"
        value={income.mealsTotal}
        exchangeRate={exchangeRate}
      />
      <div className="flex items-center justify-between pt-3 mt-1 border-t border-gunmetal">
        <span className="font-mono text-xs text-slate uppercase tracking-widest">إجمالي الدخل</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-slate tabular-nums">{fmtSYP(income.totalIncome, exchangeRate)}</span>
          <span className="font-display text-xl text-gold tabular-nums">{fmtUSD(income.totalIncome)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReconciliationBlock() {
  const { user, isManager } = useAuth();
  const { exchangeRate } = useCurrency();

  const [session, setSession] = useState<DailySessionInfo | null>(null);
  const [income,  setIncome]  = useState<DailyIncome>(ZERO);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const { session: sess, error: e } = await getOrCreateDailySession({ id: user.id, displayName: user.displayName });
      if (e) { setError(e); return; }
      setSession(sess ?? null);
      if (sess) {
        const inc = await computeDailyIncome(sess.id);
        setIncome(inc);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="bg-charcoal border border-gunmetal rounded-sm px-5 py-6 flex items-center gap-3 animate-pulse">
        <RefreshCw size={14} className="text-slate animate-spin" />
        <span className="font-mono text-xs text-slate">جارٍ التحميل…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-charcoal border border-red/30 rounded-sm px-5 py-4 flex items-center gap-3">
        <AlertTriangle size={14} className="text-red shrink-0" />
        <span className="font-mono text-xs text-red">{error}</span>
        <button onClick={() => { setLoading(true); void refresh(); }} className="mr-auto font-mono text-xs text-slate hover:text-offwhite transition-colors cursor-pointer">
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bg-charcoal border border-gunmetal rounded-sm px-5 py-6 text-center">
        <p className="font-mono text-xs text-slate">لا توجد جلسة لهذا اليوم</p>
      </div>
    );
  }

  if (session.status === "closed") {
    return (
      <div className="bg-charcoal border border-gunmetal rounded-sm p-5 space-y-4">
        <ClosedView session={session} income={income} exchangeRate={exchangeRate} />
      </div>
    );
  }

  // Open session
  return (
    <div className="bg-charcoal border border-gunmetal rounded-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="font-display text-sm tracking-widest text-offwhite">الجلسة مفتوحة — {session.businessDate}</span>
        </div>
        <button onClick={() => { setLoading(true); void refresh(); }} className="p-1 text-slate hover:text-offwhite transition-colors cursor-pointer">
          <RefreshCw size={13} />
        </button>
      </div>

      <IncomeBreakdown income={income} exchangeRate={exchangeRate} />

      {isManager && (
        <CloseDayPanel
          session={session}
          income={income}
          exchangeRate={exchangeRate}
          onClose={refresh}
        />
      )}
    </div>
  );
}
