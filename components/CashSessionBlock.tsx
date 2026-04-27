"use client";

import { useState } from "react";
import { LogIn, LogOut, Banknote, Clock, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";

function fmt(n: number) { return `$${n.toFixed(2)}`; }

function Stat({
  label, value, accent, big,
}: {
  label: string; value: string; accent?: "gold" | "silver"; big?: boolean;
}) {
  const color = accent === "gold" ? "text-[#F5C100]" : "text-[#AAAAAA]";
  return (
    <div className="bg-[#0F0F0F] border border-[#252525] p-3 clip-corner-sm">
      <div className="font-mono text-[10px] text-[#555555] tracking-widest uppercase mb-1">{label}</div>
      <div className={`font-mono ${big ? "text-lg" : "text-sm"} ${color} tabular-nums`}>{value}</div>
    </div>
  );
}

export default function CashSessionBlock() {
  const { user } = useAuth();
  const {
    localSession,
    lastClosingCash,
    openLocalSession,
    closeLocalSession,
    storeIncome,
    mealsIncome,
    subsIncome,
    inbodyIncome,
    totalIncome,
    runningCash,
  } = useStore();

  const [openingInput, setOpeningInput] = useState("");
  const [closingInput, setClosingInput] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (!user) return null;

  const isOpen   = localSession?.status === "open";
  const isClosed = localSession?.status === "closed";

  function handleOpen() {
    setMsg(null);
    // If a previous session was closed today, opening is locked to lastClosingCash
    const isHandoff = lastClosingCash > 0;
    const opening   = isHandoff ? lastClosingCash : Math.max(0, Number(openingInput) || 0);
    openLocalSession(opening);
    setOpeningInput("");
    setMsg({ kind: "ok", text: `فُتحت الجلسة — افتتاحي ${fmt(opening)}` });
  }

  function handleClose() {
    setMsg(null);
    const v = Number(closingInput) || 0;
    if (v < 0) { setMsg({ kind: "err", text: "المبلغ لا يمكن أن يكون سالباً." }); return; }
    closeLocalSession(v);
    setClosingInput("");
    setMsg({ kind: "ok", text: `أُغلقت الجلسة — الفعلي: ${fmt(v)}` });
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Banknote size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
            جلسة الكاش — {user.displayName}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {isOpen ? (
            <div className="flex items-center gap-2 text-xs font-mono text-[#5CC45C]">
              <span className="w-2 h-2 rounded-full bg-[#5CC45C] animate-pulse" />
              مفتوحة منذ {new Date(localSession!.openedAt).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-mono text-[#777777]">
              <Clock size={12} /> {isClosed ? "الجلسة مغلقة" : "لا توجد جلسة مفتوحة"}
            </div>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {!isOpen ? (
          /* ── OPEN FORM ── */
          <div className="space-y-3">
            {lastClosingCash > 0 ? (
              <div className="flex items-center gap-2 p-3 bg-[#F5C100]/5 border border-[#F5C100]/20 clip-corner-sm">
                <Lock size={14} className="text-[#F5C100]" />
                <p className="font-mono text-xs text-[#AAAAAA] leading-snug">
                  استلام من الجلسة السابقة — رصيد افتتاحي مقفل:{" "}
                  <span className="text-[#F5C100] tabular-nums">{fmt(lastClosingCash)}</span>
                </p>
              </div>
            ) : (
              <>
                <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
                  الرصيد الافتتاحي ($) — أول وردية اليوم
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#5CC45C]/15 border border-[#5CC45C]/30 text-[#5CC45C] font-display tracking-wider clip-corner-sm hover:bg-[#5CC45C]/25 transition-colors cursor-pointer"
            >
              <LogIn size={16} />
              فتح الجلسة
            </button>
          </div>
        ) : (
          /* ── OPEN SESSION DASHBOARD ── */
          <>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-2">دخل هذه الوردية</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="الاشتراكات" value={fmt(subsIncome)}   accent="gold" />
                <Stat label="InBody"     value={fmt(inbodyIncome)} accent="gold" />
                <Stat label="المتجر"     value={fmt(storeIncome)}  accent="gold" />
                <Stat label="المطبخ"     value={fmt(mealsIncome)}  accent="gold" />
              </div>
            </div>

            <div className="border-t border-[#252525] pt-3 grid grid-cols-2 gap-3">
              <Stat label="افتتاحي ($)"       value={fmt(localSession!.openingCash)} accent="silver" big />
              <Stat label="إجمالي الخزنة ($)" value={fmt(runningCash)}               accent="gold"   big />
            </div>

            {/* Close form */}
            <div className="border-t border-[#252525] pt-4 space-y-3">
              <label className="block font-mono text-[11px] text-[#777777] tracking-widest">
                المبلغ الفعلي في الخزنة عند الإغلاق ($)
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
                  disabled={!closingInput}
                  className="flex items-center gap-2 px-4 py-2 bg-[#FF3333]/15 border border-[#FF3333]/30 text-[#FF3333] font-display tracking-wider clip-corner-sm hover:bg-[#FF3333]/25 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <LogOut size={16} />
                  إغلاق الجلسة
                </button>
              </div>
            </div>
          </>
        )}

        {msg && (
          <div className={[
            "flex items-center gap-2 p-2 border clip-corner-sm font-mono text-xs",
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
