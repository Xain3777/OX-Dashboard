"use client";

import { useState, useMemo } from "react";
import {
  Activity,
  Plus,
  CheckCircle,
  AlertTriangle,
  Users,
} from "lucide-react";
import { formatCurrency, generateId } from "@/lib/business-logic";
import type { PaymentMethod } from "@/lib/types";
import { MEMBERS } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";

interface InBodySession {
  id: string;
  memberId: string;
  memberName: string;
  sessionType: "single" | "package_5" | "package_10";
  price: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  createdBy: string;
}

const SESSION_PRICES: Record<string, { label: string; price: number }> = {
  single: { label: "جلسة واحدة", price: 15 },
  package_5: { label: "باقة 5 جلسات", price: 60 },
  package_10: { label: "باقة 10 جلسات", price: 100 },
};

const METHOD_STYLES: Record<PaymentMethod, string> = {
  cash: "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  card: "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25",
  transfer: "bg-[#AAAAAA]/12 text-[#AAAAAA] border border-[#AAAAAA]/25",
  other: "bg-[#252525] text-[#777777] border border-[#555555]/30",
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "نقدي",
  card: "بطاقة",
  transfer: "تحويل",
  other: "أخرى",
};

const INITIAL_SESSIONS: InBodySession[] = [
  {
    id: "ib1",
    memberId: "m1",
    memberName: "أحمد الراشد",
    sessionType: "package_5",
    price: 60,
    paymentMethod: "cash",
    createdAt: "2026-04-14T09:30:00Z",
    createdBy: "s3",
  },
  {
    id: "ib2",
    memberId: "m3",
    memberName: "خالد حسن",
    sessionType: "single",
    price: 15,
    paymentMethod: "cash",
    createdAt: "2026-04-14T11:00:00Z",
    createdBy: "s4",
  },
];

export default function InBodyBlock() {
  const { isManager } = useAuth();
  const [sessions, setSessions] = useState<InBodySession[]>(INITIAL_SESSIONS);

  // Form state
  const [memberId, setMemberId] = useState("");
  const [sessionType, setSessionType] = useState<string>("single");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const todayTotal = useMemo(
    () => sessions.reduce((sum, s) => sum + s.price, 0),
    [sessions]
  );

  const selected = SESSION_PRICES[sessionType];

  function handleRecord() {
    setError("");
    setSuccess(false);

    const member = MEMBERS.find((m) => m.id === memberId);
    if (!member) {
      setError("اختر عضواً.");
      return;
    }

    const newSession: InBodySession = {
      id: generateId(),
      memberId: member.id,
      memberName: member.name,
      sessionType: sessionType as InBodySession["sessionType"],
      price: selected.price,
      paymentMethod: payMethod,
      createdAt: new Date().toISOString(),
      createdBy: "s3",
    };

    setSessions((prev) => [...prev, newSession]);
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
            {sessions.length} جلسة
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
        {Object.entries(SESSION_PRICES).map(([key, { label, price }]) => (
          <div
            key={key}
            className={`p-3 border rounded-sm text-center transition-colors cursor-pointer ${
              sessionType === key
                ? "border-[#F5C100]/50 bg-[#F5C100]/5"
                : "border-[#252525] bg-[#111111] hover:border-[#555555]"
            }`}
            onClick={() => setSessionType(key)}
          >
            <p className="font-body text-xs text-[#AAAAAA]">{label}</p>
            <p className="font-display text-xl text-[#F5C100] tracking-wider mt-1">
              {formatCurrency(price)}$
            </p>
            {key !== "single" && (
              <p className="font-mono text-[10px] text-[#555555] mt-0.5">
                {formatCurrency(Math.round(price / (key === "package_5" ? 5 : 10)))}$/جلسة
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Today's sessions */}
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          جلسات اليوم
        </p>
        <span className="font-mono text-[10px] text-[#555555]">
          {sessions.length} جلسة
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {["العضو", "النوع", "السعر", "الطريقة"].map((h) => (
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
            {sessions.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest"
                >
                  لا توجد جلسات اليوم
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
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
                    {SESSION_PRICES[s.sessionType]?.label}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[#F0EDE6]">
                    {formatCurrency(s.price)}$
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${METHOD_STYLES[s.paymentMethod]}`}
                    >
                      {METHOD_LABELS[s.paymentMethod]}
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
          {formatCurrency(todayTotal)}$
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

          {/* Payment method */}
          <div className="flex flex-col gap-1 w-28">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              الطريقة
            </label>
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              <option value="cash">نقدي</option>
              <option value="card">بطاقة</option>
              <option value="transfer">تحويل</option>
            </select>
          </div>

          {/* Price preview */}
          {selected && (
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                السعر
              </label>
              <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100]">
                {formatCurrency(selected.price)}$
              </div>
            </div>
          )}

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
