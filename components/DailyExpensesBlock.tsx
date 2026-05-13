"use client";

import { useMemo, useState } from "react";
import { ReceiptText, Plus, AlertTriangle, CheckCircle, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushExpense, cancelTransaction } from "@/lib/supabase/intake";
import { formatTime } from "@/lib/utils/time";
import type { Currency, Expense, ExpenseCategory, ExpenseFrequency, PaymentMethod } from "@/lib/types";

// Reception-side daily expenses. Writes go into the same public.expenses
// table that the manager dashboard reads — so totals roll into the live
// KPI strip and closing reconciliation automatically. The `source` column
// (added in migration 0040) is set to 'reception_daily' so the manager UI
// can badge these rows distinctly from their own entries.

const CURRENCY_LABEL: Record<Currency, string> = {
  syp: "ل.س",
  usd: "$",
};

const TODAY = new Date().toISOString().slice(0, 10);

export default function DailyExpensesBlock() {
  const { user } = useAuth();
  const { exchangeRate } = useCurrency();
  const { expenses, addExpense, removeExpenseLocal } = useStore();

  const [description, setDescription] = useState("");
  const [amount,      setAmount]      = useState("");
  const [currency,    setCurrency]    = useState<Currency>("syp");
  const [note,        setNote]        = useState("");
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState("");
  const [busy,        setBusy]        = useState(false);

  // Only show today's reception-entered rows for the logged-in user. The
  // manager can see everything from their dashboard.
  const todayMine = useMemo(
    () =>
      expenses
        .filter((e) =>
          e.source === "reception_daily"
          && e.createdAt.startsWith(TODAY)
          && (user ? e.createdBy === user.id : false))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [expenses, user]
  );

  const totals = useMemo(() => {
    let usd = 0, syp = 0;
    for (const e of todayMine) {
      if (e.currency === "syp") syp += e.amount;
      else usd += e.amount;
    }
    return { usd, syp };
  }, [todayMine]);

  async function handleAdd() {
    setError(""); setSuccess("");
    if (!user) { setError("يجب تسجيل الدخول."); return; }
    const desc = description.trim();
    if (!desc) { setError("أدخل وصف المصروف."); return; }
    const n = parseFloat(amount);
    if (!isFinite(n) || n <= 0) { setError("المبلغ غير صحيح."); return; }
    if (currency === "syp" && (!exchangeRate || exchangeRate <= 0)) {
      setError("سعر الصرف غير صالح — حدّثه من أعلى الصفحة.");
      return;
    }

    setBusy(true);
    const r = await pushExpense({
      user: { id: user.id, displayName: user.displayName },
      description: desc,
      amount: n,
      currency,
      category: "miscellaneous",
      exchangeRate,
      note: note.trim() || null,
      source: "reception_daily",
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }

    const row = r.data!;
    const full: Expense = {
      id: String(row.id),
      description: desc,
      category: "miscellaneous" as ExpenseCategory,
      amount: n,
      paymentMethod: "cash" as PaymentMethod,
      currency,
      frequency: "one_time" as ExpenseFrequency,
      date: TODAY,
      createdAt: String(row.created_at ?? new Date().toISOString()),
      createdBy: user.id,
      createdByName: user.displayName,
      note: note.trim() || null,
      source: "reception_daily",
    };
    addExpense(full);
    setDescription(""); setAmount(""); setNote("");
    setSuccess("تم تسجيل المصروف.");
    setTimeout(() => setSuccess(""), 2500);
  }

  async function handleCancel(exp: Expense) {
    if (!user) return;
    if (!window.confirm(`حذف هذا المصروف؟\n${exp.description}`)) return;
    const r = await cancelTransaction({
      user: { id: user.id, displayName: user.displayName },
      table: "expenses",
      id: exp.id,
      reason: "deleted from reception daily expenses",
    });
    if (r.error) { setError(r.error); return; }
    removeExpenseLocal(exp.id);
  }

  const fmtAmount = (n: number, c: Currency) =>
    c === "syp"
      ? `${Math.round(n).toLocaleString("en-US")} ل.س`
      : `$${n.toFixed(2)}`;

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <ReceiptText size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">
            المصاريف اليومية — الاستقبال
          </h2>
          <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#AAAAAA]">
            {todayMine.length} مصروف
          </span>
        </div>
        {user && (
          <span className="font-mono text-[10px] text-[#777777]">
            باسم: <span className="text-[#F5C100]">{user.displayName}</span>
          </span>
        )}
      </div>

      {/* Entry form */}
      <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]/40">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 min-w-[180px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">اسم المصروف</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: شراء ماء"
              className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/40"
            />
          </div>
          <div className="flex flex-col gap-1 w-28">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">المبلغ</label>
            <input
              type="number" min="0" step={currency === "syp" ? "1" : "0.01"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F5C100] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/40"
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1 w-24">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">العملة</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/40"
            >
              <option value="syp">{CURRENCY_LABEL.syp}</option>
              <option value="usd">{CURRENCY_LABEL.usd}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[180px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">ملاحظة (اختيارية)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="—"
              className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm cursor-pointer disabled:opacity-50"
          >
            <Plus size={12} />
            {busy ? "جاري…" : "تسجيل"}
          </button>
        </div>
        {error   && <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]"><AlertTriangle size={11} />{error}</div>}
        {success && <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]"><CheckCircle  size={11} />{success}</div>}
      </div>

      {/* Today's list */}
      {todayMine.length === 0 ? (
        <div className="px-5 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
          لم تُسجَّل أي مصاريف اليوم
        </div>
      ) : (
        <div className="divide-y divide-[#252525]/50">
          {todayMine.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#252525]/20 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#F0EDE6] truncate">{e.description}</p>
                {e.note && (
                  <p className="font-mono text-[10px] text-[#777777] truncate">{e.note}</p>
                )}
                <p className="font-mono text-[9px] text-[#555555]">{formatTime(e.createdAt)}</p>
              </div>
              <span className="font-mono tabular-nums text-xs text-[#FF7A7A]" dir="ltr">
                {fmtAmount(e.amount, (e.currency ?? "usd") as Currency)}
              </span>
              <button
                onClick={() => void handleCancel(e)}
                className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"
                title="حذف"
              >
                <Undo2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="border-t border-[#252525] px-5 py-2.5 flex items-center justify-end gap-3 bg-[#111111]/60">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي اليوم</span>
        {totals.syp > 0 && (
          <span className="font-mono tabular-nums text-sm font-medium text-[#5CC45C]" dir="ltr">
            {fmtAmount(totals.syp, "syp")}
          </span>
        )}
        {totals.usd > 0 && (
          <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100]" dir="ltr">
            {fmtAmount(totals.usd, "usd")}
          </span>
        )}
        {totals.syp <= 0 && totals.usd <= 0 && (
          <span className="font-mono tabular-nums text-sm font-medium text-[#777777]" dir="ltr">
            —
          </span>
        )}
      </div>
    </div>
  );
}
