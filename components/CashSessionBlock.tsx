"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Dumbbell, ShoppingCart, UtensilsCrossed, RefreshCw, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCurrency } from "@/lib/currency-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  getOrCreateDailySession,
  computeDailyIncome,
  getCurrentBusinessDate,
  type DailySessionInfo,
} from "@/lib/supabase/intake";
import type { DailyIncome } from "@/lib/types";

function fmtUSD(n: number) {
  return `$${Number(n.toFixed(2)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSYP(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ل.س`;
}

const ZERO_INCOME: DailyIncome = { subsTotal: 0, inbodyTotal: 0, storeTotal: 0, mealsTotal: 0, totalIncome: 0 };

export default function CashSessionBlock() {
  const { user } = useAuth();
  const { exchangeRate } = useCurrency();
  const supabase = supabaseBrowser();

  const [session, setSession] = useState<DailySessionInfo | null>(null);
  const [income,  setIncome]  = useState<DailyIncome>(ZERO_INCOME);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const { session: sess, error: sessErr } = await getOrCreateDailySession({ id: user.id, displayName: user.displayName });
      if (sessErr) { setError(sessErr); return; }
      setSession(sess ?? null);
      if (sess?.status === "open") {
        const inc = await computeDailyIncome(sess.id);
        setIncome(inc);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Auto-open on mount
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: refresh whenever subscriptions / sales / inbody change
  useEffect(() => {
    if (!session?.id) return;
    const sid = session.id;
    const channel = supabase
      .channel(`session-income-${sid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions",   filter: `cash_session_id=eq.${sid}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "sales",           filter: `cash_session_id=eq.${sid}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "inbody_sessions", filter: `cash_session_id=eq.${sid}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session?.id, supabase, refresh]);

  if (loading) {
    return (
      <div className="bg-charcoal border border-gunmetal rounded-sm px-5 py-4 flex items-center gap-3 animate-pulse">
        <RefreshCw size={14} className="text-slate animate-spin" />
        <span className="font-mono text-xs text-slate">جارٍ تحميل بيانات اليوم…</span>
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

  const businessDate = session?.businessDate ?? getCurrentBusinessDate();
  const isOpen = session?.status === "open";
  const totalSYP = income.totalIncome * exchangeRate;

  const sources = [
    { icon: <Users size={14} className="text-[#5CC45C]" />, label: "الاشتراكات", value: income.subsTotal },
    { icon: <Dumbbell size={14} className="text-[#F5C100]" />, label: "InBody", value: income.inbodyTotal },
    { icon: <ShoppingCart size={14} className="text-[#60A5FA]" />, label: "المتجر", value: income.storeTotal },
    { icon: <UtensilsCrossed size={14} className="text-[#F97316]" />, label: "المطبخ", value: income.mealsTotal },
  ];

  return (
    <div className="bg-charcoal border border-gunmetal rounded-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gunmetal bg-iron/40">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isOpen ? "bg-success animate-pulse" : "bg-slate"}`} />
          <span className="font-display text-sm tracking-widest text-offwhite uppercase">
            {isOpen ? "جلسة اليوم — مفتوحة" : "جلسة اليوم — مغلقة"}
          </span>
          <span className="font-mono text-[10px] text-slate">{businessDate}</span>
        </div>
        <button
          onClick={() => { setLoading(true); void refresh(); }}
          className="p-1 text-slate hover:text-offwhite transition-colors cursor-pointer"
          title="تحديث"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Income breakdown grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-x-reverse divide-gunmetal">
        {sources.map(({ icon, label, value }) => (
          <div key={label} className="px-4 py-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              {icon}
              <span className="font-mono text-[10px] text-slate uppercase tracking-wider">{label}</span>
            </div>
            <span className="font-display text-lg text-offwhite tabular-nums">{fmtUSD(value)}</span>
            <span className="font-mono text-[10px] text-slate tabular-nums">{fmtSYP(value * exchangeRate)}</span>
          </div>
        ))}
      </div>

      {/* Total footer */}
      <div className="flex items-center justify-between px-5 py-3 bg-iron/30 border-t border-gunmetal">
        <span className="font-mono text-xs text-slate uppercase tracking-widest">إجمالي الدخل</span>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-slate tabular-nums">{fmtSYP(totalSYP)}</span>
          <span className="font-display text-xl text-gold tabular-nums">{fmtUSD(income.totalIncome)}</span>
        </div>
      </div>
    </div>
  );
}
