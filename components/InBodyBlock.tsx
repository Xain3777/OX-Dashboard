"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Activity, Plus, CheckCircle, AlertTriangle, Users, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore, type InBodyMemberType, type InBodySession } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushInBody, cancelTransaction } from "@/lib/supabase/intake";
import { supabaseBrowser } from "@/lib/supabase/client";

const MEMBER_PRICE_USD     = 5;
const NON_MEMBER_PRICE_USD = 8;

function fmtUSD(n: number) { return `$${n.toFixed(2)}`; }

// ── Member search ─────────────────────────────────────────────────────────────

type DbMember = { id: string; name: string; phone: string | null };

function MemberSearch({
  value,
  onChange,
  members,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
  members: DbMember[];
}) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return members.slice(0, 8);
    // Arabic-friendly normalization to match the SubscriptionsBlock search
    // (locale-aware lowercase + trim) so receptionists can find members by
    // name or phone in either Arabic or Latin script.
    const needle = query.toLocaleLowerCase("ar-SY").trim();
    return members
      .filter((m) => {
        const haystack = [m.name, m.phone ?? ""]
          .map((s) => s.toLocaleLowerCase("ar-SY"))
          .join(" | ");
        return haystack.includes(needle);
      })
      .slice(0, 8);
  }, [query, members]);

  const selected = members.find((m) => m.id === value);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-w-[180px]">
      <label className="block font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-1">العضو</label>
      <input
        type="text"
        value={selected ? selected.name : query}
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
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <Users size={10} className="text-[#555555] shrink-0" />
                  <span className="truncate">{m.name}</span>
                </span>
                {m.phone && (
                  <span className="font-mono text-[10px] text-[#777777] shrink-0" dir="ltr">{m.phone}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InBodyBlock() {
  const { user }         = useAuth();
  const { exchangeRate } = useCurrency();
  const { inBodySessions, addInBodySession, cancelInBodySession } = useStore();

  const [members,    setMembers]    = useState<DbMember[]>([]);
  const [memberType, setMemberType] = useState<InBodyMemberType>("gym_member");
  const [memberId,   setMemberId]   = useState("");
  const [memberName, setMemberName] = useState("");
  const [guestName,  setGuestName]  = useState("");
  const [error,      setError]      = useState("");
  const [success,    setSuccess]    = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const supabase = supabaseBrowser();
    // Load every row in the members table — receptionists need to attach
    // an InBody session to anyone who walks in, including coaches and
    // staff who occasionally use the machine for themselves. The earlier
    // role='player' filter was too restrictive and hid most Arabic-named
    // entries (which happen to be coaches in this dev DB).
    supabase
      .from("members")
      .select("id, full_name, phone")
      .order("full_name")
      .then(({ data }) => {
        if (!data) return;
        const rows = (
          data as Array<{ id: string; full_name: string; phone: string | null }>
        ).map((m) => ({
          id: m.id,
          name: m.full_name,
          phone: m.phone ?? null,
        }));
        setMembers(rows);
      });
  }, []);

  const priceUSD = memberType === "gym_member" ? MEMBER_PRICE_USD : NON_MEMBER_PRICE_USD;

  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = useMemo(
    () => inBodySessions.filter((s) => s.createdAt.startsWith(today)),
    [inBodySessions, today]
  );
  const todayTotalUSD = useMemo(
    () => todaySessions.filter(s => !s.cancelled).reduce((sum, s) => sum + s.priceUSD, 0),
    [todaySessions]
  );

  // Search across name, member type label, and (when known) phone — mirrors
  // the SubscriptionsBlock search bar so receptionists have the same UX in
  // both sections. Phone is looked up via the in-memory `members` cache.
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return todaySessions;
    const needle = searchQuery.toLocaleLowerCase("ar-SY").trim();
    const phoneById = new Map(members.map((m) => [m.id, m.phone ?? ""]));
    return todaySessions.filter((s) => {
      const haystack = [
        s.memberName,
        s.memberType === "gym_member" ? "عضو النادي عضو" : "زيارة خارجية زائر",
        s.memberId ? phoneById.get(s.memberId) ?? "" : "",
        s.createdByName ?? "",
      ]
        .map((x) => x.toLocaleLowerCase("ar-SY"))
        .join(" | ");
      return haystack.includes(needle);
    });
  }, [todaySessions, searchQuery, members]);

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

    const r = await pushInBody({
      user: { id: user.id, displayName: user.displayName },
      memberId: memberType === "gym_member" ? memberId : undefined,
      memberName: name,
      memberType,
      amountUSD: priceUSD,
      exchangeRate,
    });

    if (r.error) { setError(r.error); return; }

    const row = r.data!;
    const session: InBodySession = {
      id: String(row.id),
      memberType,
      memberId: memberType === "gym_member" ? memberId : undefined,
      memberName: name,
      priceUSD,
      priceSYP: Math.round(priceUSD * exchangeRate),
      currency: "usd",
      paymentMethod: "cash",
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      createdByName: user.displayName,
    };
    addInBodySession(session);

    setMemberId(""); setMemberName(""); setGuestName("");
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">
      {/* Header */}
      <div className="flex items-center px-5 py-3.5 border-b border-[#252525] gap-3">
        <Activity size={15} className="text-[#F5C100]" />
        <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">جهاز InBody</h2>
        <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#AAAAAA]">
          {todaySessions.filter(s => !s.cancelled).length} جلسة اليوم
        </span>
      </div>

      {/* Price cards */}
      <div className="px-5 pt-4 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-3">الأسعار الثابتة</p>
      </div>
      <div className="px-5 grid grid-cols-2 gap-3 pb-4">
        <div onClick={() => { setMemberType("gym_member"); setError(""); }}
          className={`p-4 border rounded-sm text-center cursor-pointer transition-colors ${memberType === "gym_member" ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111] hover:border-[#555555]"}`}>
          <p className="font-body text-xs text-[#AAAAAA] mb-1">عضو النادي</p>
          <p className="font-display text-3xl text-[#F5C100] tracking-wider">${MEMBER_PRICE_USD}</p>
        </div>
        <div onClick={() => { setMemberType("non_member"); setError(""); }}
          className={`p-4 border rounded-sm text-center cursor-pointer transition-colors ${memberType === "non_member" ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111] hover:border-[#555555]"}`}>
          <p className="font-body text-xs text-[#AAAAAA] mb-1">زيارة خارجية</p>
          <p className="font-display text-3xl text-[#F5C100] tracking-wider">${NON_MEMBER_PRICE_USD}</p>
        </div>
      </div>

      {/* Today's sessions */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">جلسات اليوم</p>
        <div className="flex items-center gap-2 bg-[#111111] border border-[#252525] rounded px-2 py-1 min-w-[260px]">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-[#555555] shrink-0">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، الهاتف، نوع الزيارة، الموظف…"
            className="flex-1 bg-transparent border-0 text-[#F0EDE6] font-body text-xs focus:outline-none placeholder:text-[#555555]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="px-1.5 font-mono text-[10px] text-[#777777] hover:text-[#F0EDE6] transition-colors cursor-pointer"
            >
              مسح
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {["العضو", "النوع", "المبلغ ($)", "الموظف", ""].map((h, i) => (
                <th key={i} className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredSessions.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
                {todaySessions.length === 0 ? "لا توجد جلسات اليوم" : "لا توجد نتائج للبحث"}
              </td></tr>
            ) : (
              filteredSessions.map((s) => (
                <tr key={s.id} className={`border-b border-[#252525]/60 transition-colors ${s.cancelled ? "opacity-40 bg-[#1A0A0A]/30" : "hover:bg-[#252525]/30"}`}>
                  <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap">
                    <div className={`flex items-center gap-1.5 ${s.cancelled ? "line-through text-[#777777]" : ""}`}>
                      <Users size={11} className="text-[#555555]" />{s.memberName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${s.memberType === "gym_member" ? "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25" : "bg-[#555555]/20 text-[#AAAAAA] border border-[#555555]/30"}`}>
                      {s.memberType === "gym_member" ? "عضو" : "زيارة"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums whitespace-nowrap text-[#F5C100]">
                    {fmtUSD(s.priceUSD)}
                  </td>
                  <td className="px-4 py-2.5 text-[#777777] text-xs whitespace-nowrap">{s.createdByName}</td>
                  <td className="px-4 py-2.5 text-center">
                    {!s.cancelled ? (
                      <button
                        onClick={async () => {
                          if (!user) return;
                          const r = await cancelTransaction({
                            user: { id: user.id, displayName: user.displayName },
                            table: "inbody_sessions",
                            id: s.id,
                          });
                          if (!r.error) cancelInBodySession(s.id);
                        }}
                        className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer" title="إلغاء">
                        <Undo2 size={13} />
                      </button>
                    ) : (
                      <span className="font-mono text-[9px] text-[#FF3333]">ملغاة</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Daily total */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-[#252525] bg-[#111111]/60">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي اليوم</span>
        <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100]">{fmtUSD(todayTotalUSD)}</span>
      </div>

      {/* Record form */}
      <div className="border-t border-[#252525] px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={12} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تسجيل جلسة جديدة</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 w-36">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">نوع الزيارة</label>
            <select value={memberType}
              onChange={(e) => { setMemberType(e.target.value as InBodyMemberType); setMemberId(""); setMemberName(""); setGuestName(""); setError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors">
              <option value="gym_member">عضو في النادي</option>
              <option value="non_member">زيارة خارجية</option>
            </select>
          </div>

          {memberType === "gym_member" ? (
            <MemberSearch value={memberId} members={members}
              onChange={(id, name) => { setMemberId(id); setMemberName(name); setError(""); }} />
          ) : (
            <div className="flex flex-col gap-1 min-w-[180px] flex-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">اسم الزائر</label>
              <input type="text" value={guestName}
                onChange={(e) => { setGuestName(e.target.value); setError(""); }}
                placeholder="أدخل الاسم…"
                className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors" />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">السعر</label>
            <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100] whitespace-nowrap">
              {fmtUSD(priceUSD)}
            </div>
          </div>

          <button onClick={handleRecord}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm shrink-0 self-end cursor-pointer">
            <Activity size={12} />
            تسجيل جلسة
          </button>
        </div>

        {error   && <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]"><AlertTriangle size={11} />{error}</div>}
        {success && <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]"><CheckCircle size={11} />تم تسجيل الجلسة بنجاح.</div>}
      </div>
    </div>
  );
}
