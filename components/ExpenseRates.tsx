"use client";

import { useState } from "react";
import { Pencil, Plus, Check, X, DollarSign, Lock } from "lucide-react";
import PriceTag from "@/components/PriceTag";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/lib/auth-context";
import type { ExpenseRate } from "@/lib/store-context";

const CAT_LABELS: Record<ExpenseRate["category"], string> = {
  salary: "الرواتب", rent: "الإيجار", utility: "المرافق", service: "الخدمات", other: "أخرى",
};
const CAT_COLORS: Record<ExpenseRate["category"], string> = {
  salary: "bg-gold-dim/20 text-gold border-gold-dim/30",
  rent: "bg-red-deep/20 text-red border-red-deep/30",
  utility: "bg-secondary/10 text-ghost border-secondary/20",
  service: "bg-slate/15 text-ghost border-slate/25",
  other: "bg-gunmetal text-ghost border-gunmetal",
};
const FREQ_LABELS: Record<ExpenseRate["frequency"], string> = { monthly: "شهري", weekly: "أسبوعي", daily: "يومي" };

const GROUPED_CATS: ExpenseRate["category"][] = ["salary", "rent", "utility", "service", "other"];

export default function ExpenseRates() {
  const { expenseRates, updateExpenseRate, addExpenseRate, toggleExpenseRate } = useStore();
  const { isManager } = useAuth();

  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [showAdd, setShowAdd]       = useState(false);
  const [newRate, setNewRate]       = useState({
    label: "", category: "salary" as ExpenseRate["category"],
    amount: "", frequency: "monthly" as ExpenseRate["frequency"],
  });

  const startEdit = (rate: ExpenseRate) => { setEditingId(rate.id); setEditAmount(String(rate.amount)); };
  const cancelEdit = () => { setEditingId(null); setEditAmount(""); };
  const saveEdit = (rate: ExpenseRate) => {
    const newAmt = parseFloat(editAmount);
    if (isNaN(newAmt) || newAmt <= 0) return;
    updateExpenseRate(rate.id, newAmt);
    cancelEdit();
  };

  const handleAdd = () => {
    if (!newRate.label.trim() || !newRate.amount) return;
    const amt = parseFloat(newRate.amount);
    if (isNaN(amt) || amt <= 0) return;
    addExpenseRate({
      category: newRate.category,
      label: newRate.label.trim(),
      amount: amt,
      frequency: newRate.frequency,
      active: true,
    });
    setNewRate({ label: "", category: "salary", amount: "", frequency: "monthly" });
    setShowAdd(false);
  };

  const activeSalaries = expenseRates.filter((r) => r.category === "salary" && r.active);
  const totalSalaries  = activeSalaries.reduce((s, r) => s + r.amount, 0);
  const totalFixed     = expenseRates.filter((r) => r.active).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="bg-iron border border-gunmetal p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-xl tracking-wider text-offwhite">
            {isManager ? "جدول الأسعار والرواتب" : "الرواتب والمصروفات الثابتة"}
          </h3>
          {!isManager && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#777777]">
              <Lock size={9} />
              <span>عرض فقط</span>
            </div>
          )}
        </div>
        {isManager && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-gold text-void font-display text-xs tracking-wider hover:bg-gold-bright transition-colors cursor-pointer"
          >
            <Plus size={14} /> إضافة سعر جديد
          </button>
        )}
      </div>

      {isManager && showAdd && (
        <div className="bg-charcoal border border-gunmetal p-4 animate-fade-in space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block font-mono text-[10px] text-secondary tracking-widest mb-1">الوصف</label>
              <input className="ox-input" placeholder="مثال: راتب المدرب..." value={newRate.label}
                onChange={(e) => setNewRate({ ...newRate, label: e.target.value })} />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-secondary tracking-widest mb-1">التصنيف</label>
              <select className="ox-select" value={newRate.category}
                onChange={(e) => setNewRate({ ...newRate, category: e.target.value as ExpenseRate["category"] })}>
                {GROUPED_CATS.map((c) => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-secondary tracking-widest mb-1">المبلغ ($)</label>
              <input type="number" className="ox-input" dir="ltr" placeholder="0"
                value={newRate.amount} onChange={(e) => setNewRate({ ...newRate, amount: e.target.value })} />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-secondary tracking-widest mb-1">التكرار</label>
              <select className="ox-select" value={newRate.frequency}
                onChange={(e) => setNewRate({ ...newRate, frequency: e.target.value as ExpenseRate["frequency"] })}>
                <option value="monthly">شهري</option>
                <option value="weekly">أسبوعي</option>
                <option value="daily">يومي</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd}
              className="px-4 py-2 bg-gold text-void font-display text-xs tracking-wider hover:bg-gold-bright transition-colors cursor-pointer">
              <Check size={14} className="inline ml-1" />حفظ
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-gunmetal text-secondary hover:text-offwhite transition-colors cursor-pointer font-display text-xs tracking-wider">
              <X size={14} className="inline ml-1" />إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Rate table grouped by category */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gunmetal">
              <th className="text-right font-mono text-[10px] text-secondary tracking-widest py-2 px-3">الوصف</th>
              <th className="text-right font-mono text-[10px] text-secondary tracking-widest py-2 px-3">التصنيف</th>
              <th className="text-right font-mono text-[10px] text-secondary tracking-widest py-2 px-3">المبلغ</th>
              <th className="text-right font-mono text-[10px] text-secondary tracking-widest py-2 px-3">التكرار</th>
              <th className="text-right font-mono text-[10px] text-secondary tracking-widest py-2 px-3">آخر تحديث</th>
              {isManager && <>
                <th className="text-center font-mono text-[10px] text-secondary tracking-widest py-2 px-3">الحالة</th>
                <th className="text-center font-mono text-[10px] text-secondary tracking-widest py-2 px-3">تعديل</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {GROUPED_CATS.map((cat) => {
              const catRates = expenseRates.filter((r) => r.category === cat);
              if (catRates.length === 0) return null;
              return catRates.map((rate, i) => (
                <tr key={rate.id} className={`border-b border-gunmetal/50 ox-table-row ${!rate.active ? "opacity-40" : ""}`}>
                  <td className="py-2 px-3 font-body text-offwhite">{rate.label}</td>
                  <td className="py-2 px-3">
                    {i === 0 && (
                      <span className={`inline-flex px-2 py-0.5 text-[10px] font-mono border ${CAT_COLORS[cat]}`}>
                        {CAT_LABELS[cat]}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {isManager && editingId === rate.id ? (
                      <input type="number" className="ox-input w-20 text-center" dir="ltr"
                        value={editAmount} onChange={(e) => setEditAmount(e.target.value)} autoFocus />
                    ) : (
                      <PriceTag amount={rate.amount} size="sm" />
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs text-ghost">{FREQ_LABELS[rate.frequency]}</td>
                  <td className="py-2 px-3 font-mono text-xs text-slate">{rate.lastUpdated}</td>
                  {isManager && (
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => toggleExpenseRate(rate.id)}
                        className={`w-8 h-4 rounded-full transition-colors cursor-pointer relative ${rate.active ? "bg-success/30" : "bg-gunmetal"}`}
                      >
                        <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${rate.active ? "right-0.5 bg-success" : "left-0.5 bg-slate"}`} />
                      </button>
                    </td>
                  )}
                  {isManager && (
                    <td className="py-2 px-3 text-center">
                      {editingId === rate.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => saveEdit(rate)} className="text-success hover:text-success cursor-pointer"><Check size={14} /></button>
                          <button onClick={cancelEdit} className="text-red hover:text-red-bright cursor-pointer"><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(rate)} className="text-slate hover:text-gold transition-colors cursor-pointer">
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-gunmetal">
        <div className="flex items-center gap-1">
          <DollarSign size={14} className="text-gold-dim" />
          <span className="font-mono text-xs text-secondary">إجمالي الرواتب الشهرية:</span>
          <PriceTag amount={totalSalaries} size="sm" className="text-gold font-bold" />
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-secondary">إجمالي المصروفات الثابتة:</span>
          <PriceTag amount={totalFixed} size="sm" className="text-offwhite font-bold" />
        </div>
      </div>
    </div>
  );
}
