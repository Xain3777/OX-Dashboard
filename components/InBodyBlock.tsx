"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Activity, Plus, CheckCircle, AlertTriangle, Users, Clock } from "lucide-react";
import { MEMBERS } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { useStore, type InBodyMemberType } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushInBody } from "@/lib/supabase/intake";

// Fixed USD prices — not editable from reception
const MEMBER_PRICE_USD     = 5;
const NON_MEMBER_PRICE_USD = 8;

function fmtUSD(n: number) { return `$${Number(n.toFixed(2)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`; }
function fmtSYP(n: number) { return `${Math.round(n).toLocaleString("en-US")} ل.س`; }

// ── Member search dropdown ─────────────────────────────────────────────────────

function MemberSearch({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const ref               = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return MEMBERS.slice(0, 8);
    const q = query.toLowerCase();
    return MEMBERS.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const selectedMember = MEMBERS.find((m) => m.id === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-w-[180px]">
      <label className="block font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-1">العضو</label>
      <input
        type="text"
        value={selectedMember ? selectedMember.name : query}
        placeholder="ابحث باسم العضو…"
        className="w-full bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
        onFocus={() => { setQuery(""); onChange("", ""); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); onChange("", ""); setOpen(true); }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-[#1A1A1A] border border-[#333333] rounded-sm shadow-lg max-h-48 overflow-y-auto">
          {results.map((m) => (
            <button key={m.id} type="button"
              className="w-full text-right px-3 py-2 text-xs text-[#F0EDE6] hover:bg-[#252525] font-body transition-colors"
              onClick={() => { onChange(m.id, m.name); setQuery(""); setOpen(false); }}>
              <span className="flex items-center gap-2">
                <Users size={10} className="text-[#555555]" />
                {m.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function InBodyBlock() {
  const { user }         = useAuth();
  const { exchangeRate } = useCurrency();
  const { inBodySessions, addInBodySession, activityFeed } = useStore();

  const [memberType,  setMemberType]  = useState<InBodyMemberType>("gym_member");
  const [memberId,    setMemberId]    = useState("");
  const [memberName,  setMemberName]  = useState("");
  const [guestName,   setGuestName]   = useState("");
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState(false);
  const [busy,        setBusy]        = useState(false);

  const priceUSD = memberType === "gym_member" ? MEMBER_PRICE_USD : NON_MEMBER_PRICE_USD;
  const priceSYP = Math.round(priceUSD * exchangeRate);

  const todaySessions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return inBodySessions.filter((s) => s.createdAt.startsWith(today));
  }, [inBodySessions]);

  const todayTotalUSD = useMemo(
    () => Number((todaySessions.reduce((sum, s) => sum + (s.priceSYP / exchangeRate), 0)).toFixed(2)),
    [todaySessions, exchangeRate]
  );

  const inBodyFeed = useMemo(
    () => activityFeed.filter((e) => e.type === "inbody").slice(0, 10),
    [activityFeed]
  );

  async function handleRecord() {
    setError(""); setSuccess(false);

    let name = "";
    if (memberType === "gym_member") {
      if (!memberId) { setError("اختر عضواً من القائمة."); return; }
      name = memberName;
    } else {
      if (!guestName.trim()) { setError("أدخل اسم الزائر."); return; }
      name = guestName.trim();
    }
    if (!user) { setError("يجب تسجيل الدخول."); return; }

    setBusy(true);
    const r = await pushInBody({
      user: { id: user.id, displayName: user.displayName },
      memberName: name,
      memberType,
      amountUSD: priceUSD,
      exchangeRate,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }

    addInBodySession({
      memberType,
      memberId:      memberType === "gym_member" ? memberId : undefined,
      memberName:    name,
      priceSYP,
      currency:      "usd",
      paymentMethod: "cash",
      createdBy:     user.id,
      createdByName: user.displayName,
    });

    setMemberId(""); setMemberName(""); setGuestName("");
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Activity size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">جهاز InBody</h2>
          <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#AAAAAA]">
            {todaySessions.length} جلسة اليوم
          </span>
        </div>
      </div>

      {/* Fixed price cards */}
      <div className="px-5 pt-4 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">الأسعار الثابتة</p>
      </div>
      <div className="px-5 grid grid-cols-2 gap-3 pb-4">
        <div onClick={() => { setMemberType("gym_member"); setError(""); }}
          className={`p-4 border rounded-sm text-center cursor-pointer transition-colors ${memberType === "gym_member" ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111] hover:border-[#555555]"}`}>
          <p className="font-body text-xs text-[#AAAAAA] mb-1">عضو النادي</p>
          <p className="font-display text-3xl text-[#F5C100] tracking-wider">${MEMBER_PRICE_USD}</p>
          <p className="font-mono text-[10px] text-[#555555] mt-1">{fmtSYP(MEMBER_PRICE_USD * exchangeRate)}</p>
        </div>
        <div onClick={() => { setMemberType("non_member"); setError(""); }}
          className={`p-4 border rounded-sm text-center cursor-pointer transition-colors ${memberType === "non_member" ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111] hover:border-[#555555]"}`}>
          <p className="font-body text-xs text-[#AAAAAA] mb-1">زيارة خارجية</p>
          <p className="font-display text-3xl text-[#F5C100] tracking-wider">${NON_MEMBER_PRICE_USD}</p>
          <p className="font-mono text-[10px] text-[#555555] mt-1">{fmtSYP(NON_MEMBER_PRICE_USD * exchangeRate)}</p>
        </div>
      </div>

      {/* Today's sessions */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">جلسات اليوم</p>
        <span className="font-mono text-[10px] text-[#555555]">{todaySessions.length} جلسة</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {["العضو", "النوع", "المبلغ ($)", "الموظف"].map((h) => (
                <th key={h} className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {todaySessions.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">لا توجد جلسات اليوم</td></tr>
            ) : (
              todaySessions.map((s) => (
                <tr key={s.id} className="border-b border-[#252525]/60 hover:bg-[#252525]/30 transition-colors">
                  <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap">
                    <div className="flex items-center gap-1.5"><Users size={11} className="text-[#555555]" />{s.memberName}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${s.memberType === "gym_member" ? "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25" : "bg-[#555555]/20 text-[#AAAAAA] border border-[#555555]/30"}`}>
                      {s.memberType === "gym_member" ? "عضو" : "زيارة"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums whitespace-nowrap">
                    <span className="text-[#F5C100]">{fmtUSD(s.priceSYP / exchangeRate)}</span>
                    <span className="text-[#555555] text-[10px] mr-1">({fmtSYP(s.priceSYP)})</span>
                  </td>
                  <td className="px-4 py-2.5 text-[#777777] text-xs whitespace-nowrap">{s.createdByName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Daily total */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-[#252525] bg-[#111111]/60">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي اليوم</span>
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100] glow-gold-sm">{fmtUSD(todayTotalUSD)}</span>
          <span className="font-mono text-[10px] text-[#555555]">({fmtSYP(todayTotalUSD * exchangeRate)})</span>
        </div>
      </div>

      {/* Record form */}
      <div className="border-t border-[#252525] px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={12} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تسجيل جلسة جديدة</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {/* Visit type */}
          <div className="flex flex-col gap-1 w-36">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">نوع الزيارة</label>
            <select value={memberType} onChange={(e) => { setMemberType(e.target.value as InBodyMemberType); setMemberId(""); setMemberName(""); setGuestName(""); setError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors">
              <option value="gym_member">عضو في النادي</option>
              <option value="non_member">زيارة خارجية</option>
            </select>
          </div>

          {/* Member search or guest name */}
          {memberType === "gym_member" ? (
            <MemberSearch
              value={memberId}
              onChange={(id, name) => { setMemberId(id); setMemberName(name); setError(""); }}
            />
          ) : (
            <div className="flex flex-col gap-1 min-w-[180px] flex-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">اسم الزائر</label>
              <input type="text" value={guestName} onChange={(e) => { setGuestName(e.target.value); setError(""); }}
                placeholder="أدخل الاسم…"
                className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors" />
            </div>
          )}

          {/* Price preview */}
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">السعر</label>
            <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100] whitespace-nowrap">
              {fmtUSD(priceUSD)}
            </div>
          </div>

          {/* Submit */}
          <button onClick={handleRecord} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm shrink-0 self-end cursor-pointer">
            <Activity size={12} />
            {busy ? "جاري التسجيل…" : "تسجيل جلسة"}
          </button>
        </div>

        {error && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]">
            <AlertTriangle size={11} />{error}
          </div>
        )}
        {success && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]">
            <CheckCircle size={11} />تم تسجيل الجلسة بنجاح.
          </div>
        )}
      </div>

      {/* Live feed */}
      {inBodyFeed.length > 0 && (
        <div className="border-t border-[#252525] px-5 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={11} className="text-[#555555]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">سجل الجلسات</p>
            <span className="w-1.5 h-1.5 rounded-full bg-[#5CC45C] animate-pulse" />
          </div>
          <div className="space-y-1">
            {inBodyFeed.map((entry) => {
              const time = new Date(entry.timestamp).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={entry.id} className="flex items-center justify-between py-1 border-b border-[#252525]/40 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[#555555]">{time}</span>
                    <span className="text-xs text-[#AAAAAA]">{entry.description}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {entry.amountUSD != null && <span className="font-mono text-[10px] text-[#F5C100]">{fmtUSD(entry.amountUSD)}</span>}
                    <span className="font-mono text-[10px] text-[#555555]">{entry.userName}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
