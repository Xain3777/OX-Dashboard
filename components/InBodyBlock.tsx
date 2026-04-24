"use client";

import { useState, useMemo } from "react";
import {
  Activity,
  Plus,
  CheckCircle,
  AlertTriangle,
  Users,
} from "lucide-react";
import { formatCurrency } from "@/lib/business-logic";
import { MEMBERS } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { useStore, type InBodySessionType } from "@/lib/store-context";

type Currency = "syp" | "usd";

const SESSION_LABELS: Record<InBodySessionType, string> = {
  single: "جلسة واحدة",
  package_5: "باقة 5 جلسات",
  package_10: "باقة 10 جلسات",
};

const CURRENCY_STYLES: Record<Currency, string> = {
  syp: "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  usd: "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25",
};

const CURRENCY_LABELS: Record<Currency, string> = {
  syp: "ل.س",
  usd: "$",
};

function formatPrice(amount: number, currency: Currency): string {
  if (currency === "syp") {
    return `${amount.toLocaleString("en-US")} ل.س`;
  }
  return `$${formatCurrency(amount)}`;
}

export default function InBodyBlock() {
  const { user } = useAuth();
  const {
    inBodySessions,
    inBodyPrices,
    addInBodySession,
    exchangeRate,
  } = useStore();

  // Form state
  const [memberId, setMemberId] = useState("");
  const [sessionType, setSessionType] = useState<InBodySessionType>("single");
  const [currency, setCurrency] = useState<Currency>("syp");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const priceSYP = inBodyPrices[sessionType];
  const displayPrice = currency === "syp"
    ? priceSYP
    : Math.round((priceSYP / exchangeRate) * 100) / 100;

  const todayTotalSYP = useMemo(
    () => inBodySessions.reduce((sum, s) => sum + s.priceSYP, 0),
    [inBodySessions]
  );

  function handleRecord() {
    setError("");
    setSuccess(false);

    const member = MEMBERS.find((m) => m.id === memberId);
    if (!member) {
      setError("اختر عضواً.");
      return;
    }

    addInBodySession({
      memberType: "gym_member",
      memberId: member.id,
      memberName: member.name,
      sessionType,
      priceSYP,
      currency,
      paymentMethod: currency === "syp" ? "cash" : "transfer",
      createdBy: user?.id ?? "s3",
      createdByName: user?.name ?? "موظف",
    });

    setMemberId("");
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Activity size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">
            جهاز InBody
          </h2>
          <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#AAAAAA]">
            {inBodySessions.length} جلسة
          </span>
        </div>
      </div>

      {/* Pricing table */}
      <div className="px-5 pt-4 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-2">
          الأسعار
        </p>
      </div>
      <div className="px-5 grid grid-cols-3 gap-3 pb-4">
        {(Object.keys(SESSION_LABELS) as InBodySessionType[]).map((key) => {
          const price = inBodyPrices[key];
          const perSession = key === "package_5" ? Math.round(price / 5)
            : key === "package_10" ? Math.round(price / 10) : null;
          return (
            <div
              key={key}
              className={`p-3 border rounded-sm text-center transition-colors cursor-pointer ${
                sessionType === key
                  ? "border-[#F5C100]/50 bg-[#F5C100]/5"
                  : "border-[#252525] bg-[#111111] hover:border-[#555555]"
              }`}
              onClick={() => setSessionType(key)}
            >
              <p className="font-body text-xs text-[#AAAAAA]">{SESSION_LABELS[key]}</p>
              <p className="font-display text-xl text-[#F5C100] tracking-wider mt-1">
                {price.toLocaleString("en-US")}
                <span className="text-xs text-[#AAAAAA] mr-1">ل.س</span>
              </p>
              {perSession != null && (
                <p className="font-mono text-[10px] text-[#555555] mt-0.5">
                  {perSession.toLocaleString("en-US")} ل.س/جلسة
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Today's sessions */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          جلسات اليوم
        </p>
        <span className="font-mono text-[10px] text-[#555555]">
          {inBodySessions.length} جلسة
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {["العضو", "النوع", "السعر", "العملة"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inBodySessions.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest"
                >
                  لا توجد جلسات اليوم
                </td>
              </tr>
            ) : (
              inBodySessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-[#252525]/60 hover:bg-[#252525]/30 transition-colors"
                >
                  <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Users size={11} className="text-[#555555]" />
                      {s.memberName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[#AAAAAA]">
                    {SESSION_LABELS[s.sessionType ?? "single"]}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[#F0EDE6]">
                    {formatPrice(
                      s.currency === "usd"
                        ? Math.round((s.priceSYP / exchangeRate) * 100) / 100
                        : s.priceSYP,
                      (s.currency as Currency) ?? "syp"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${CURRENCY_STYLES[(s.currency as Currency) ?? "syp"]}`}
                    >
                      {CURRENCY_LABELS[(s.currency as Currency) ?? "syp"]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Total */}
      <div className="flex items-center justify-end gap-2 px-5 py-2.5 border-t border-[#252525] bg-[#111111]/60">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          إجمالي اليوم
        </span>
        <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100] glow-gold-sm">
          {todayTotalSYP.toLocaleString("en-US")} ل.س
        </span>
      </div>

      {/* Record new session form */}
      <div className="border-t border-[#252525] px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={12} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
            تسجيل جلسة جديدة
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {/* Member select */}
          <div className="flex flex-col gap-1 min-w-[180px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              العضو
            </label>
            <select
              value={memberId}
              onChange={(e) => {
                setMemberId(e.target.value);
                setError("");
              }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              <option value="">— اختر عضواً —</option>
              {MEMBERS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Currency */}
          <div className="flex flex-col gap-1 w-32">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              العملة
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              <option value="syp">ليرة سورية</option>
              <option value="usd">دولار</option>
            </select>
          </div>

          {/* Price preview */}
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              السعر
            </label>
            <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100] whitespace-nowrap">
              {formatPrice(displayPrice, currency)}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleRecord}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm shrink-0 self-end cursor-pointer"
          >
            <Activity size={12} />
            تسجيل جلسة
          </button>
        </div>

        {error && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]">
            <AlertTriangle size={11} />
            {error}
          </div>
        )}
        {success && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]">
            <CheckCircle size={11} />
            تم تسجيل الجلسة بنجاح.
          </div>
        )}
      </div>
    </div>
  );
}
