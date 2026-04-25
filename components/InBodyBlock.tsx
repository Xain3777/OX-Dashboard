"use client";

import { useState, useMemo } from "react";
import {
  Activity,
  Plus,
  CheckCircle,
  AlertTriangle,
  Users,
  Clock,
  Settings,
} from "lucide-react";
import type { PaymentMethod } from "@/lib/types";
import { MEMBERS } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { useStore, type InBodyMemberType } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushInBody } from "@/lib/supabase/intake";

type Currency = "syp" | "usd";

const METHOD_STYLES: Record<PaymentMethod, string> = {
  cash:     "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  card:     "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25",
  transfer: "bg-[#AAAAAA]/12 text-[#AAAAAA] border border-[#AAAAAA]/25",
  other:    "bg-[#252525] text-[#777777] border border-[#555555]/30",
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي", card: "بطاقة", transfer: "تحويل", other: "أخرى",
};

function formatSYP(n: number) { return n.toLocaleString("en-US"); }
function formatUSD(n: number)  { return n.toFixed(2); }

export default function InBodyBlock() {
  const { user, isManager } = useAuth();
  const { exchangeRate } = useCurrency();
  const { inBodySessions, inBodyPrices, addInBodySession, updateInBodyPrices, activityFeed } = useStore();

  // form
  const [memberType, setMemberType] = useState<InBodyMemberType>("gym_member");
  const [memberId,   setMemberId]   = useState("");
  const [guestName,  setGuestName]  = useState("");
  const [currency,   setCurrency]   = useState<Currency>("syp");
  const [payMethod,  setPayMethod]  = useState<PaymentMethod>("cash");
  const [error,      setError]      = useState("");
  const [success,    setSuccess]    = useState(false);
  const [busy,       setBusy]       = useState(false);

  // manager price editor
  const [showPriceEdit, setShowPriceEdit] = useState(false);
  const [editMember,    setEditMember]    = useState(String(inBodyPrices.member));
  const [editNonMember, setEditNonMember] = useState(String(inBodyPrices.nonMember));

  const todaySessions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return inBodySessions.filter((s) => s.createdAt.startsWith(today));
  }, [inBodySessions]);

  const todayTotalSYP = useMemo(
    () => todaySessions.reduce((sum, s) => sum + s.priceSYP, 0),
    [todaySessions]
  );

  const currentPriceSYP = memberType === "gym_member" ? inBodyPrices.member : inBodyPrices.nonMember;
  const currentPriceUSD = Math.round((currentPriceSYP / exchangeRate) * 100) / 100;
  const displayAmount   = currency === "syp" ? currentPriceSYP : currentPriceUSD;

  const inBodyFeed = useMemo(
    () => activityFeed.filter((e) => e.type === "inbody").slice(0, 10),
    [activityFeed]
  );

  async function handleRecord() {
    setError(""); setSuccess(false);

    let name = "";
    if (memberType === "gym_member") {
      const m = MEMBERS.find((m) => m.id === memberId);
      if (!m) { setError("اختر عضواً."); return; }
      name = m.name;
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
      amount: displayAmount,
      currency,
      exchangeRate,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }

    addInBodySession({
      memberType,
      memberId: memberType === "gym_member" ? memberId : undefined,
      memberName: name,
      priceSYP: currentPriceSYP,
      currency,
      paymentMethod: payMethod,
      createdBy: user.id,
      createdByName: user.displayName,
    });

    setMemberId(""); setGuestName("");
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  }

  function handleSavePrices() {
    const m  = parseInt(editMember, 10);
    const nm = parseInt(editNonMember, 10);
    if (!isNaN(m) && !isNaN(nm) && m > 0 && nm > 0) {
      updateInBodyPrices(m, nm);
      setShowPriceEdit(false);
    }
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
        {isManager && (
          <button
            onClick={() => { setShowPriceEdit(!showPriceEdit); setEditMember(String(inBodyPrices.member)); setEditNonMember(String(inBodyPrices.nonMember)); }}
            className="flex items-center gap-1.5 px-2 py-1 border border-[#252525] hover:border-[#F5C100]/40 text-[#777777] hover:text-[#F5C100] transition-colors rounded-sm cursor-pointer"
          >
            <Settings size={12} />
            <span className="font-mono text-[10px]">تعديل الأسعار</span>
          </button>
        )}
      </div>

      {/* Manager price editor */}
      {isManager && showPriceEdit && (
        <div className="px-5 py-4 bg-[#111111] border-b border-[#252525]">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#F5C100] mb-3">تعديل أسعار جلسة InBody (ل.س)</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-[#555555] uppercase tracking-widest">عضو النادي (ل.س)</label>
              <input type="number" value={editMember} onChange={(e) => setEditMember(e.target.value)}
                className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F5C100] font-mono w-40 focus:outline-none focus:border-[#F5C100]/50" dir="ltr" />
              <span className="font-mono text-[9px] text-[#555555]">≈ {formatUSD(parseInt(editMember || "0") / exchangeRate)}$</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] text-[#555555] uppercase tracking-widest">زيارة خارجية (ل.س)</label>
              <input type="number" value={editNonMember} onChange={(e) => setEditNonMember(e.target.value)}
                className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F5C100] font-mono w-40 focus:outline-none focus:border-[#F5C100]/50" dir="ltr" />
              <span className="font-mono text-[9px] text-[#555555]">≈ {formatUSD(parseInt(editNonMember || "0") / exchangeRate)}$</span>
            </div>
            <button onClick={handleSavePrices}
              className="px-4 py-2 bg-[#F5C100] text-[#0A0A0A] font-display text-xs tracking-widest rounded-sm hover:bg-[#FFD740] transition-colors cursor-pointer self-center mt-4">
              حفظ
            </button>
            <button onClick={() => setShowPriceEdit(false)}
              className="px-4 py-2 border border-[#252525] text-[#777777] font-mono text-xs rounded-sm hover:text-[#F0EDE6] transition-colors cursor-pointer self-center mt-4">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Price cards */}
      <div className="px-5 pt-4 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">الأسعار</p>
      </div>
      <div className="px-5 grid grid-cols-2 gap-3 pb-4">
        <div onClick={() => setMemberType("gym_member")}
          className={`p-4 border rounded-sm text-center cursor-pointer transition-colors ${memberType === "gym_member" ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111] hover:border-[#555555]"}`}>
          <p className="font-body text-xs text-[#AAAAAA] mb-1">عضو النادي</p>
          <p className="font-display text-2xl text-[#F5C100] tracking-wider">{formatSYP(inBodyPrices.member)}</p>
          <p className="font-mono text-[10px] text-[#555555] mt-0.5">ل.س</p>
          <p className="font-mono text-[10px] text-[#555555]">≈ {formatUSD(inBodyPrices.member / exchangeRate)}$</p>
        </div>
        <div onClick={() => setMemberType("non_member")}
          className={`p-4 border rounded-sm text-center cursor-pointer transition-colors ${memberType === "non_member" ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111] hover:border-[#555555]"}`}>
          <p className="font-body text-xs text-[#AAAAAA] mb-1">زيارة خارجية</p>
          <p className="font-display text-2xl text-[#F5C100] tracking-wider">{formatSYP(inBodyPrices.nonMember)}</p>
          <p className="font-mono text-[10px] text-[#555555] mt-0.5">ل.س</p>
          <p className="font-mono text-[10px] text-[#555555]">≈ {formatUSD(inBodyPrices.nonMember / exchangeRate)}$</p>
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
              {["العضو", "النوع", "السعر", "الطريقة", "الموظف"].map((h) => (
                <th key={h} className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {todaySessions.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">لا توجد جلسات اليوم</td></tr>
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
                    <span className="text-[#F5C100]">{formatSYP(s.priceSYP)} ل.س</span>
                    <span className="text-[#555555] text-[10px] mr-1">≈ {formatUSD(s.priceSYP / exchangeRate)}$</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${METHOD_STYLES[s.paymentMethod]}`}>
                      {METHOD_LABELS[s.paymentMethod]}
                    </span>
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
          <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100] glow-gold-sm">{formatSYP(todayTotalSYP)} ل.س</span>
          <span className="font-mono text-[10px] text-[#555555]">≈ {formatUSD(todayTotalSYP / exchangeRate)}$</span>
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
            <select value={memberType} onChange={(e) => { setMemberType(e.target.value as InBodyMemberType); setError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors">
              <option value="gym_member">عضو في النادي</option>
              <option value="non_member">زيارة خارجية</option>
            </select>
          </div>

          {/* Member or guest */}
          {memberType === "gym_member" ? (
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">العضو</label>
              <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setError(""); }}
                className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors">
                <option value="">— اختر عضواً —</option>
                {MEMBERS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1 min-w-[160px] flex-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">اسم الزائر</label>
              <input type="text" value={guestName} onChange={(e) => { setGuestName(e.target.value); setError(""); }}
                placeholder="أدخل الاسم..."
                className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors" />
            </div>
          )}

          {/* Currency toggle */}
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">عملة الدفع</label>
            <div className="flex border border-[#252525] rounded-sm overflow-hidden">
              {(["syp", "usd"] as const).map((c) => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={`px-3 py-2 text-xs font-mono cursor-pointer transition-colors ${currency === c ? "bg-[#F5C100] text-[#0A0A0A]" : "bg-[#111111] text-[#777777] hover:text-[#F0EDE6]"}`}>
                  {c === "syp" ? "ل.س" : "$"}
                </button>
              ))}
            </div>
          </div>

          {/* Payment method */}
          <div className="flex flex-col gap-1 w-28">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الطريقة</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors">
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Price preview */}
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">السعر</label>
            <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100] whitespace-nowrap">
              {currency === "syp" ? `${formatSYP(currentPriceSYP)} ل.س` : `${formatUSD(currentPriceUSD)}$`}
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
                    {entry.amountSYP && <span className="font-mono text-[10px] text-[#F5C100]">{formatSYP(entry.amountSYP)} ل.س</span>}
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
