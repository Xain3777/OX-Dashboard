"use client";

import { useState, useMemo } from "react";
import {
  Lock,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  Receipt,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import {
  ExpenseCategory,
  Currency,
} from "@/lib/types";
import {
  formatCurrency,
  formatDate,
  getCategoryLabel,
} from "@/lib/business-logic";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/lib/auth-context";

// ── Category badge colours ────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<ExpenseCategory, string> = {
  salaries:      "bg-[#8A6D00]/20 text-[#8A6D00] border border-[#8A6D00]/30",
  rent:          "bg-[#777777]/15 text-[#777777] border border-[#777777]/25",
  equipment:     "bg-[#555555]/20 text-[#AAAAAA] border border-[#555555]/30",
  maintenance:   "bg-[#C49A00]/15 text-[#C49A00] border border-[#C49A00]/25",
  utilities:     "bg-[#AAAAAA]/12 text-[#AAAAAA] border border-[#AAAAAA]/25",
  supplies:      "bg-[#777777]/15 text-[#777777] border border-[#777777]/25",
  marketing:     "bg-[#F5C100]/15 text-[#F5C100] border border-[#F5C100]/25",
  miscellaneous: "bg-[#555555]/20 text-[#AAAAAA] border border-[#555555]/30",
};

const CURRENCY_STYLES: Record<Currency, string> = {
  syp: "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  usd: "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25",
};

const CURRENCY_LABEL: Record<Currency, string> = {
  syp: "ل.س",
  usd: "$",
};

const CURRENT_MONTH = "2026-04";
const TODAY_DATE    = "2026-04-14";

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "salaries",
  "rent",
  "equipment",
  "maintenance",
  "utilities",
  "supplies",
  "marketing",
  "miscellaneous",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: ExpenseCategory }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${CATEGORY_STYLES[category]}`}>
      {getCategoryLabel(category)}
    </span>
  );
}

function CurrencyBadge({ currency }: { currency: Currency }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${CURRENCY_STYLES[currency]}`}>
      {CURRENCY_LABEL[currency]}
    </span>
  );
}

// ── Form state type ───────────────────────────────────────────────────────────

interface ExpenseFormState {
  description: string;
  category:    ExpenseCategory;
  amount:      string;
  currency:    Currency;
  date:        string;
}

const EMPTY_FORM: ExpenseFormState = {
  description: "",
  category:    "miscellaneous",
  amount:      "",
  currency:    "usd",
  date:        TODAY_DATE,
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ExpensesBlock() {
  // ── State ──────────────────────────────────────────────────────────────────
  const { expenses, addExpense } = useStore();
  const { user } = useAuth();
  const [formOpen,    setFormOpen]    = useState<boolean>(false);
  const [form,        setForm]        = useState<ExpenseFormState>(EMPTY_FORM);
  const [formError,   setFormError]   = useState<string>("");
  const [formSuccess, setFormSuccess] = useState<boolean>(false);

  // ── Derived values ─────────────────────────────────────────────────────────

  const thisMonthExpenses = useMemo(
    () => expenses.filter(e => e.date.startsWith(CURRENT_MONTH)),
    [expenses]
  );

  const thisMonthTotal = useMemo(
    () => thisMonthExpenses.reduce((sum, e) => sum + e.amount, 0),
    [thisMonthExpenses]
  );

  // Sort: newest date first, then by createdAt descending
  const sortedExpenses = useMemo(
    () => [...expenses].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }),
    [expenses]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  function updateForm(field: keyof ExpenseFormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    setFormError("");
  }

  function handleSaveExpense() {
    setFormError("");
    setFormSuccess(false);

    const { description, category, amount, currency, date } = form;

    if (!description.trim()) {
      setFormError("الوصف مطلوب.");
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError("أدخل مبلغاً صحيحاً أكبر من 0.");
      return;
    }
    if (!date) {
      setFormError("التاريخ مطلوب.");
      return;
    }

    const now = new Date().toISOString();

    addExpense({
      description:   description.trim(),
      category,
      amount:        parsedAmount,
      paymentMethod: currency === "syp" ? "cash" : "transfer",
      currency,
      date,
      createdBy:     user?.id ?? "s3",
      lockedAt:      now,
    });

    setForm(EMPTY_FORM);
    setFormSuccess(true);
    setTimeout(() => setFormSuccess(false), 2500);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">

      {/* ── Section Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Receipt size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">
            المصروفات
          </h2>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded">
            <span className="font-mono text-[10px] text-[#555555] uppercase tracking-widest">
              هذا الشهر:
            </span>
            <span className="font-mono tabular-nums text-[10px] text-[#F5C100]">
              {formatCurrency(thisMonthTotal)}$
            </span>
          </div>
        </div>

        {/* Collapse / expand form toggle */}
        <button
          onClick={() => setFormOpen(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#252525] hover:bg-[#2E2E2E] border border-[#555555]/40 rounded-sm text-[10px] font-mono uppercase tracking-widest text-[#AAAAAA] hover:text-[#F0EDE6] transition-colors"
        >
          <PlusCircle size={11} />
          إضافة مصروف
          {formOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          ADD EXPENSE FORM (collapsible)
      ════════════════════════════════════════════════════════════════════ */}
      {formOpen && (
        <div className="border-b border-[#252525] bg-[#111111]/50 px-5 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

            {/* Description */}
            <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                الوصف
              </label>
              <input
                type="text"
                placeholder="مثال: بدل غداء الموظفين"
                value={form.description}
                onChange={e => updateForm("description", e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body placeholder:text-[#555555] focus:outline-none focus:border-[#F5C100]/50 transition-colors"
              />
            </div>

            {/* Category */}
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                التصنيف
              </label>
              <select
                value={form.category}
                onChange={e => updateForm("category", e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
              >
                {EXPENSE_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>
                    {getCategoryLabel(cat)}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                المبلغ ($)
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={form.amount}
                onChange={e => updateForm("amount", e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-mono tabular-nums placeholder:text-[#555555] focus:outline-none focus:border-[#F5C100]/50 transition-colors"
              />
            </div>

            {/* Currency */}
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                العملة
              </label>
              <select
                value={form.currency}
                onChange={e => updateForm("currency", e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
              >
                <option value="usd">دولار</option>
                <option value="syp">ليرة سورية</option>
              </select>
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                التاريخ
              </label>
              <input
                type="date"
                value={form.date}
                onChange={e => updateForm("date", e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-mono focus:outline-none focus:border-[#F5C100]/50 transition-colors"
              />
            </div>

            {/* Save button — full width on last row */}
            <div className="flex flex-col gap-1 justify-end">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555] invisible select-none">
                &nbsp;
              </label>
              <button
                onClick={handleSaveExpense}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm w-full"
              >
                <Lock size={11} />
                حفظ المصروف
              </button>
            </div>
          </div>

          {/* Error / success feedback */}
          {formError && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]">
              <AlertTriangle size={11} />
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]">
              <CheckCircle size={11} />
              تم حفظ المصروف وتأمينه.
            </div>
          )}

          {/* Lock notice */}
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-[#555555]">
            <Lock size={9} className="text-[#8A6D00]" />
            هذا الإجراء دائم ولا يمكن التراجع عنه
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          EXPENSES TABLE
      ════════════════════════════════════════════════════════════════════ */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#252525] bg-[#111111]">
              {["التاريخ", "الوصف", "التصنيف", "المبلغ", "العملة", "بواسطة", ""].map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedExpenses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
                  لا توجد مصروفات مسجلة
                </td>
              </tr>
            ) : (
              sortedExpenses.map(expense => (
                <tr
                  key={expense.id}
                  className="border-b border-[#252525]/60 hover:bg-[#252525]/30 transition-colors"
                >
                  {/* Date */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] tabular-nums whitespace-nowrap">
                    {formatDate(expense.date)}
                  </td>
                  {/* Description */}
                  <td className="px-4 py-2.5 text-[#F0EDE6] font-body max-w-[220px]">
                    <span className="line-clamp-1" title={expense.description}>
                      {expense.description}
                    </span>
                  </td>
                  {/* Category */}
                  <td className="px-4 py-2.5">
                    <CategoryBadge category={expense.category} />
                  </td>
                  {/* Amount */}
                  <td className="px-4 py-2.5 font-mono tabular-nums font-medium text-[#F0EDE6]">
                    {formatCurrency(expense.amount)}
                  </td>
                  {/* Method */}
                  <td className="px-4 py-2.5">
                    <CurrencyBadge currency={(expense.currency as Currency) ?? "usd"} />
                  </td>
                  {/* Recorded By */}
                  <td className="px-4 py-2.5 text-[10px] text-[#777777] whitespace-nowrap">
                    {expense.createdBy}
                  </td>
                  {/* Lock indicator */}
                  <td className="px-4 py-2.5">
                    <span
                      title={`مؤمَّن في ${expense.lockedAt ?? expense.createdAt}`}
                      className="inline-flex"
                    >
                      <Lock size={11} className="text-[#8A6D00]" />
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer: total ── */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[#252525] bg-[#111111]/60">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
            جميع المصروفات ({expenses.length})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              هذا الشهر:
            </span>
            <span className="font-mono tabular-nums text-sm font-medium text-[#D42B2B]">
              {formatCurrency(thisMonthTotal)}$
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
