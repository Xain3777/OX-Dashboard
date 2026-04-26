"use client";

import { useEffect, useState, useCallback } from "react";
import { LogIn, LogOut, Banknote, AlertTriangle, CheckCircle2, Clock, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCurrency } from "@/lib/currency-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { openCashSession, closeCashSession, fetchHandoffOpening } from "@/lib/supabase/intake";

interface OpenSession {
  id: string;
  opening_cash_syp: number;
  opened_at: string;
  opening_locked: boolean;
  previous_session_id: string | null;
}

interface IntakeTotals {
  subscriptionsUSD: number;
  salesUSD: number;
  inbodyUSD: number;
}

const ZERO: IntakeTotals = { subscriptionsUSD: 0, salesUSD: 0, inbodyUSD: 0 };

function fmtUSD(n: number) {
  return `$${Number(n.toFixed(2)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSYP(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ل.س`;
}

export default function CashSessionBlock() {
  const { user } = useAuth();
  const { exchangeRate } = useCurrency();
  const supabase = supabaseBrowser();
  const [session,       setSession]       = useState<OpenSession | null>(null);
  const [totals,        setTotals]        = useState<IntakeTotals>(ZERO);
  const [openingInput,  setOpeningInput]  = useState("");
  const [closingInput,  setClosingInput]  = useState("");
  const [reasonInput,   setReasonInput]   = useState("");
  const [busy,          setBusy]          = useState(false);
  const [msg,           setMsg]           = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showSYP,       setShowSYP]       = useState(false);

  const [handoff, setHandoff] = useState<{ openingUSD: number; previousSessionId: string | null }>({
    openingUSD: 0,
    previousSessionId: null,
  });

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data: sess } = await supabase
      .from("cash_sessions")
      .select("id, opening_cash_syp, opened_at, opening_locked, previous_session_id")
      .eq("opened_by", user.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    setSession(sess ? {
      id: sess.id,
      opening_cash_syp: Number(sess.opening_cash_syp),
      opened_at: sess.opened_at,
      opening_locked: Boolean(sess.opening_locked),
      previous_session_id: sess.previous_session_id ?? null,
    } : null);

    if (!sess) {
      const h = await fetchHandoffOpening();
      const openingUSD = Number((h.openingSYP / exchangeRate).toFixed(2));
      setHandoff({ openingUSD, previousSessionId: h.previousSessionId });
      setOpeningInput(String(openingUSD));
    }

    if (sess) {
      // Sum native USD amounts from each table.
      const sumUSD = async (table: string, col: string) => {
        const { data } = await supabase
          .from(table)
          .select(col)
          .eq("cash_session_id", sess.id)
          .is("cancelled_at", null);
        const total = (data as unknown as Record<string, unknown>[])
          ?.reduce((a, r) => a + Number(r[col] ?? 0), 0) ?? 0;
        return Number(total.toFixed(2));
      };
      const subs   = await sumUSD("subscriptions",   "paid_amount");
      const sales  = await sumUSD("sales",           "total");
      const inbody = await sumUSD("inbody_sessions", "amount");
      setTotals({ subscriptionsUSD: subs, salesUSD: sales, inbodyUSD: inbody });
    } else {
      setTotals(ZERO);
    }
  }, [supabase, user, exchangeRate]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: refresh totals on any change in the session's tables.
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`cash-session-${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions",   filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "sales",           filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "inbody_sessions", filter: `cash_session_id=eq.${session.id}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, session, refresh]);

  if (!user) return null;

  // All calculations in USD.
  const openingUSD   = Number((Number(session?.opening_cash_syp ?? 0) / exchangeRate).toFixed(2));
  const totalCashUSD = Number((totals.subscriptionsUSD + totals.salesUSD + totals.inbodyUSD).toFixed(2));
  const expectedUSD  = Number((openingUSD + totalCashUSD).toFixed(2));
  const closingNum   = Number(Number(closingInput || 0).toFixed(2));
  const discrepancy  = closingInput ? Number((closingNum - expectedUSD).toFixed(2)) : null;

  async function handleOpen() {
    setMsg(null);
    setBusy(true);
    const overrideSYP = handoff.previousSessionId === null
      ? Math.round(Math.max(0, Number(openingInput) || 0) * exchangeRate)
      : undefined;
    const r = await openCashSession({ id: user!.id, displayName: user!.displayName }, overrideSYP);
    setBusy(false);
    if (r.error) setMsg({ kind: "err", text: r.error });
    else { setOpeningInput(""); setMsg({ kind: "ok", text: "فُتحت الجلسة بنجاح." }); await refresh(); }
  }

  async function handleClose() {
    if (!session) return;
    setMsg(null);
    if (closingNum < 0) { setMsg({ kind: "err", text: "المبلغ لا يمكن أن يكون سالباً." }); return; }
    if (discrepancy !== 0 && discrepancy !== null && !reasonInput.trim()) {
      setMsg({ kind: "err", text: "هناك فرق — يجب إدخال السبب قبل الإغلاق." });
      return;
    }
    setBusy(true);
    const r = await closeCashSession(
      { id: user!.id, displayName: user!.displayName },
      session.id,
      closingNum,
      exchangeRate,
      discrepancy !== 0 ? reasonInput.trim() : undefined,
    );
    setBusy(false);
    if ("error" in r && r.error) {
      setMsg({ kind: "err", text: r.error });
    } else {
      setClosingInput(""); setReasonInput("");
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
            {handoff.previousSessionId !== null ? (
              <div className="flex items-center gap-2 p-3 bg-[#F5C100]/5 border border-[#F5C100]/20 clip-corner-sm">
                <Lock size={14} className="text-[#F5C100]" />
                <p className="font-mono text-xs text-[#AAAAAA] leading-snug">
                  استلام من الوردية السابقة — رصيد افتتاحي مقفل:{" "}
                  <span className="text-[#F5C100] tabular-nums">{fmtUSD(handoff.openingUSD)}</span>
                </p>
              </div>
            ) : (
              <>
                <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
                  الرصيد الافتتاحي ($) — أول وردية لليوم
                </label>
                <input
                  type="number"
                  value={openingInput}
                  onChange={(e) => setOpeningInput(e.target.value)}
                  placeholder="0"
                  className="ox-input w-full font-mono text-lg"
                  dir="ltr"
                />
              </>
            )}
            <button
              onClick={handleOpen}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#5CC45C]/15 border border-[#5CC45C]/30 text-[#5CC45C] font-display tracking-wider clip-corner-sm hover:bg-[#5CC45C]/25 transition-colors disabled:opacity-40"
            >
              <LogIn size={16} />
              فتح الجلسة
            </button>
          </div>
        ) : (
          // ── OPEN SESSION DASHBOARD ──
          <>
            {/* Breakdown */}
            <div className="grid grid-cols-3 gap-3">
              <Stat label="اشتراكات"  value={fmtUSD(totals.subscriptionsUSD)} accent="gold" />
              <Stat label="مبيعات"    value={fmtUSD(totals.salesUSD)}         accent="gold" />
              <Stat label="InBody"    value={fmtUSD(totals.inbodyUSD)}        accent="gold" />
            </div>

            {/* Single total — clickable to toggle SYP */}
            <div className="border-t border-[#252525] pt-3">
              <button
                type="button"
                onClick={() => setShowSYP((p) => !p)}
                className="w-full bg-[#0F0F0F] border border-[#F5C100]/30 p-4 clip-corner-sm hover:border-[#F5C100]/60 transition-colors cursor-pointer group text-right"
                title={showSYP ? "اضغط لعرض الدولار" : "اضغط لعرض الليرة السورية"}
              >
                <div className="font-mono text-[10px] text-[#555555] tracking-widest uppercase mb-1 flex items-center gap-1">
                  إجمالي الكاش
                  <span className="text-[#F5C100]/40 group-hover:text-[#F5C100]/70 transition-colors">⇄</span>
                </div>
                <div className="font-mono text-2xl text-[#F5C100] tabular-nums">
                  {showSYP ? fmtSYP(totalCashUSD * exchangeRate) : fmtUSD(totalCashUSD)}
                </div>
              </button>
            </div>

            {/* CLOSE FORM */}
            <div className="border-t border-[#252525] pt-4 space-y-3">
              <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
                المبلغ الفعلي في الخزنة عند الإغلاق ($)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={closingInput}
                  onChange={(e) => setClosingInput(e.target.value)}
                  placeholder="0.00"
                  className="ox-input flex-1 font-mono text-lg"
                  dir="ltr"
                  step="0.01"
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
                <>
                  <div className={[
                    "flex items-center gap-2 p-2 border clip-corner-sm font-mono text-xs",
                    discrepancy === 0
                      ? "bg-[#5CC45C]/10 border-[#5CC45C]/30 text-[#5CC45C]"
                      : "bg-[#FF3333]/10 border-[#FF3333]/30 text-[#FF3333]",
                  ].join(" ")}>
                    {discrepancy === 0 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    الفرق: {fmtUSD(discrepancy)}
                    {discrepancy < 0 && " (نقص)"}
                    {discrepancy > 0 && " (زيادة)"}
                  </div>
                  {discrepancy !== 0 && (
                    <div className="space-y-1">
                      <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
                        سبب الفرق (إلزامي)
                      </label>
                      <input
                        type="text"
                        value={reasonInput}
                        onChange={(e) => setReasonInput(e.target.value)}
                        placeholder="مثال: ردّيت بقشيش، خصم منتج تالف، …"
                        className="ox-input w-full font-body text-sm"
                        dir="rtl"
                      />
                    </div>
                  )}
                </>
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

function Stat({ label, value, accent }: { label: string; value: string; accent: "gold" | "silver" | "red" }) {
  const color = accent === "gold" ? "text-[#F5C100]" : accent === "red" ? "text-[#FF7777]" : "text-[#AAAAAA]";
  return (
    <div className="bg-[#0F0F0F] border border-[#252525] p-3 clip-corner-sm">
      <div className="font-mono text-[10px] text-[#555555] tracking-widest uppercase mb-1">{label}</div>
      <div className={`font-mono text-sm ${color} tabular-nums`}>{value}</div>
    </div>
  );
}
