"use client";

import { useEffect, useState, useCallback } from "react";
import { LogIn, LogOut, Banknote, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { openCashSession, closeCashSession } from "@/lib/supabase/intake";

interface OpenSession {
  id: string;
  opening_cash_syp: number;
  opened_at: string;
}

interface IntakeTotals {
  subscriptionsSYP: number;
  salesSYP: number;
  inbodySYP: number;
  expensesSYP: number;
  subscriptionsUSD: number;
  salesUSD: number;
  inbodyUSD: number;
  expensesUSD: number;
}

const ZERO: IntakeTotals = {
  subscriptionsSYP: 0,
  salesSYP: 0,
  inbodySYP: 0,
  expensesSYP: 0,
  subscriptionsUSD: 0,
  salesUSD: 0,
  inbodyUSD: 0,
  expensesUSD: 0,
};

function fmtSYP(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ل.س`;
}

function fmtUSD(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function CashSessionBlock() {
  const { user } = useAuth();
  const supabase = supabaseBrowser();
  const [session, setSession] = useState<OpenSession | null>(null);
  const [totals, setTotals] = useState<IntakeTotals>(ZERO);
  const [openingInput, setOpeningInput] = useState("");
  const [closingInput, setClosingInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── load current open session for this user ─────────────────
  const refresh = useCallback(async () => {
    if (!user) return;
    const { data: sess } = await supabase
      .from("cash_sessions")
      .select("id, opening_cash_syp, opened_at")
      .eq("opened_by", user.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSession(sess ? { id: sess.id, opening_cash_syp: Number(sess.opening_cash_syp), opened_at: sess.opened_at } : null);

    if (sess) {
      // Pull active (non-cancelled) rows; native amount goes into per-currency
      // bucket for display; amount_syp is the immutable SYP-equivalent.
      const sumOf = async (table: string, nativeCol: string) => {
        const { data } = await supabase
          .from(table)
          .select(`${nativeCol}, amount_syp, currency`)
          .eq("cash_session_id", sess.id)
          .is("cancelled_at", null);
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        let syp = 0, usd = 0;
        for (const r of rows) {
          if ((r.currency as string) === "syp") syp += Number(r[nativeCol] ?? 0);
          else                                  usd += Number(r[nativeCol] ?? 0);
        }
        return { syp, usd };
      };
      const subs     = await sumOf("subscriptions",   "paid_amount");
      const sales    = await sumOf("sales",           "total");
      const inbody   = await sumOf("inbody_sessions", "amount");
      const expenses = await sumOf("expenses",        "amount");
      setTotals({
        subscriptionsSYP: subs.syp,
        salesSYP: sales.syp,
        inbodySYP: inbody.syp,
        expensesSYP: expenses.syp,
        subscriptionsUSD: subs.usd,
        salesUSD: sales.usd,
        inbodyUSD: inbody.usd,
        expensesUSD: expenses.usd,
      });
    } else {
      setTotals(ZERO);
    }
  }, [supabase, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // realtime: any change (insert/update/cancel) in the session's tables refreshes totals.
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`cash-session-${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions",   filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "sales",           filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "inbody_sessions", filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses",        filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, session, refresh]);

  if (!user) return null;

  const intakeSYP   = totals.subscriptionsSYP + totals.salesSYP + totals.inbodySYP;
  const intakeUSD   = totals.subscriptionsUSD + totals.salesUSD + totals.inbodyUSD;
  const opening     = session?.opening_cash_syp ?? 0;
  const expectedSYP = opening + intakeSYP - totals.expensesSYP;
  const closingNum  = Number(closingInput) || 0;
  const discrepancy = closingInput ? closingNum - expectedSYP : null;

  async function handleOpen() {
    setMsg(null);
    const v = Number(openingInput) || 0;
    if (v < 0) { setMsg({ kind: "err", text: "الرصيد الافتتاحي لا يمكن أن يكون سالباً." }); return; }
    setBusy(true);
    const r = await openCashSession({ id: user!.id, displayName: user!.displayName }, v);
    setBusy(false);
    if (r.error) setMsg({ kind: "err", text: r.error });
    else {
      setOpeningInput("");
      setMsg({ kind: "ok", text: "فُتحت الجلسة بنجاح." });
      await refresh();
    }
  }

  async function handleClose() {
    if (!session) return;
    setMsg(null);
    const v = Number(closingInput) || 0;
    if (v < 0) { setMsg({ kind: "err", text: "المبلغ المُحصّل لا يمكن أن يكون سالباً." }); return; }
    setBusy(true);
    const r = await closeCashSession({ id: user!.id, displayName: user!.displayName }, session.id, v);
    setBusy(false);
    if ("error" in r && r.error) {
      setMsg({ kind: "err", text: r.error });
    } else {
      setClosingInput("");
      setMsg({ kind: "ok", text: "أُغلقت الجلسة." });
      await refresh();
    }
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Banknote size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
            جلسة الكاش — {user.displayName}
          </h2>
        </div>
        {session ? (
          <div className="flex items-center gap-2 text-xs font-mono text-[#5CC45C]">
            <span className="w-2 h-2 rounded-full bg-[#5CC45C] animate-pulse" />
            مفتوحة منذ {new Date(session.opened_at).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-mono text-[#777777]">
            <Clock size={12} /> لا توجد جلسة مفتوحة
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!session ? (
          // ── OPEN FORM ──
          <div className="space-y-3">
            <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
              الرصيد الافتتاحي بالليرة السورية
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="0"
                className="ox-input flex-1 font-mono text-lg"
                dir="ltr"
              />
              <button
                onClick={handleOpen}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 bg-[#5CC45C]/15 border border-[#5CC45C]/30 text-[#5CC45C] font-display tracking-wider clip-corner-sm hover:bg-[#5CC45C]/25 transition-colors disabled:opacity-40"
              >
                <LogIn size={16} />
                فتح الجلسة
              </button>
            </div>
          </div>
        ) : (
          // ── OPEN SESSION DASHBOARD ──
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="افتتاحي" value={fmtSYP(opening)} accent="silver" />
              <Stat label="اشتراكات (ل.س)" value={fmtSYP(totals.subscriptionsSYP)} accent="gold" />
              <Stat label="مبيعات (ل.س)"  value={fmtSYP(totals.salesSYP)}        accent="gold" />
              <Stat label="InBody (ل.س)" value={fmtSYP(totals.inbodySYP)}       accent="gold" />
            </div>
            {(totals.expensesSYP > 0 || totals.expensesUSD > 0) && (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="مصروفات (ل.س)" value={`- ${fmtSYP(totals.expensesSYP)}`} accent="red" />
                {totals.expensesUSD > 0 && <Stat label="مصروفات ($)" value={`- ${fmtUSD(totals.expensesUSD)}`} accent="red" />}
              </div>
            )}
            {(intakeUSD > 0) && (
              <div className="grid grid-cols-3 gap-3 pt-1">
                <Stat label="اشتراكات ($)" value={fmtUSD(totals.subscriptionsUSD)} accent="silver" />
                <Stat label="مبيعات ($)"   value={fmtUSD(totals.salesUSD)}        accent="silver" />
                <Stat label="InBody ($)"  value={fmtUSD(totals.inbodyUSD)}       accent="silver" />
              </div>
            )}
            <div className="border-t border-[#252525] pt-3 grid grid-cols-2 gap-3">
              <Stat label="إجمالي المُدخل (ل.س)" value={fmtSYP(intakeSYP)} accent="gold" big />
              <Stat label="المتوقع في الخزنة (ل.س)" value={fmtSYP(expectedSYP)} accent="gold" big />
            </div>

            {/* CLOSE FORM */}
            <div className="border-t border-[#252525] pt-4 space-y-3">
              <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
                المبلغ الفعلي في الخزنة عند الإغلاق (ل.س)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={closingInput}
                  onChange={(e) => setClosingInput(e.target.value)}
                  placeholder="0"
                  className="ox-input flex-1 font-mono text-lg"
                  dir="ltr"
                />
                <button
                  onClick={handleClose}
                  disabled={busy}
                  className="flex items-center gap-2 px-4 py-2 bg-[#FF3333]/15 border border-[#FF3333]/30 text-[#FF3333] font-display tracking-wider clip-corner-sm hover:bg-[#FF3333]/25 transition-colors disabled:opacity-40"
                >
                  <LogOut size={16} />
                  إغلاق الجلسة
                </button>
              </div>
              {discrepancy !== null && (
                <div
                  className={[
                    "flex items-center gap-2 p-2 border clip-corner-sm font-mono text-xs",
                    discrepancy === 0
                      ? "bg-[#5CC45C]/10 border-[#5CC45C]/30 text-[#5CC45C]"
                      : "bg-[#FF3333]/10 border-[#FF3333]/30 text-[#FF3333]",
                  ].join(" ")}
                >
                  {discrepancy === 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  الفرق: {fmtSYP(discrepancy)}
                  {discrepancy < 0 && " (نقص)"}
                  {discrepancy > 0 && " (زيادة)"}
                </div>
              )}
            </div>
          </>
        )}

        {msg && (
          <div className={[
            "p-2 border clip-corner-sm font-mono text-xs",
            msg.kind === "ok"
              ? "bg-[#5CC45C]/10 border-[#5CC45C]/30 text-[#5CC45C]"
              : "bg-[#FF3333]/10 border-[#FF3333]/30 text-[#FF3333]",
          ].join(" ")}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  big,
}: {
  label: string;
  value: string;
  accent: "gold" | "silver" | "red";
  big?: boolean;
}) {
  const color = accent === "gold" ? "text-[#F5C100]" : accent === "red" ? "text-[#FF7777]" : "text-[#AAAAAA]";
  return (
    <div className="bg-[#0F0F0F] border border-[#252525] p-3 clip-corner-sm">
      <div className="font-mono text-[10px] text-[#555555] tracking-widest uppercase mb-1">
        {label}
      </div>
      <div className={`font-mono ${big ? "text-lg" : "text-sm"} ${color} tabular-nums`}>
        {value}
      </div>
    </div>
  );
}
