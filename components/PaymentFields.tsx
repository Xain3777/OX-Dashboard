"use client";

import type { PaymentStatus } from "@/lib/types";
import { calculateRemaining, derivePaymentStatus } from "@/lib/business-logic";

// Shared payment-fields widget. One component wired across every offer
// form (normal / private / couple / referral / corporate / college /
// owner_family / custom_registration) so the rules
//   paid = 0           → unpaid
//   0 < paid < total   → partial
//   paid >= total      → paid
//   remaining clamped at 0
// live in exactly one place.

export interface PaymentFieldsProps {
  /** Total amount the offer charges. Reception may edit when the offer
   *  computes a default (couple = 60, referral = base, etc.). */
  totalAmount: string;
  onTotalChange: (value: string) => void;
  /** What reception has actually collected so far. */
  paidAmount: string;
  onPaidChange: (value: string) => void;
  /** Some offers (couple / referral / corporate / college / owner_family)
   *  derive total from plan + discount and lock the input. */
  totalLocked?: boolean;
  /** Tailwind classes for input + label, supplied by the parent so the
   *  fields match the rest of that form. */
  inputCls: string;
  labelCls: string;
  currencyLabel?: string; // default "$"
  totalLabel?: string;    // default "المبلغ الكامل"
  /** Optional inline error string surfaced under the row. */
  error?: string | null;
}

export interface ComputedPayment {
  totalNum: number;
  paidNum: number;
  remaining: number;
  status: PaymentStatus;
  /** True when paidNum > totalNum (caller should block submit). */
  overpaid: boolean;
}

export function computePayment(totalAmount: string, paidAmount: string): ComputedPayment {
  const totalNum = Math.max(0, Number(totalAmount) || 0);
  const paidNum  = Math.max(0, Number(paidAmount)  || 0);
  const overpaid = paidNum > totalNum && totalNum > 0;
  const status   = derivePaymentStatus(totalNum, paidNum);
  const remaining = calculateRemaining(totalNum, paidNum);
  return { totalNum, paidNum, remaining, status, overpaid };
}

const STATUS_CHIP: Record<PaymentStatus, { label: string; cls: string }> = {
  paid:    { label: "مدفوع",      cls: "bg-success/10 text-success border-success/25" },
  partial: { label: "جزئي",       cls: "bg-gold/10 text-gold border-gold/25" },
  unpaid:  { label: "غير مدفوع", cls: "bg-red/10 text-red border-red/25" },
};

export default function PaymentFields({
  totalAmount,
  onTotalChange,
  paidAmount,
  onPaidChange,
  totalLocked = false,
  inputCls,
  labelCls,
  currencyLabel = "$",
  totalLabel = "المبلغ الكامل",
  error,
}: PaymentFieldsProps) {
  const { remaining, status, overpaid } = computePayment(totalAmount, paidAmount);
  const chip = STATUS_CHIP[status];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>{totalLabel} ({currencyLabel})</label>
          <input
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            disabled={totalLocked}
            className={`${inputCls} ${totalLocked ? "opacity-70 cursor-not-allowed" : ""}`}
            value={totalAmount}
            onChange={(e) => onTotalChange(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>المدفوع ({currencyLabel})</label>
          <input
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            className={inputCls}
            value={paidAmount}
            onChange={(e) => onPaidChange(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>المتبقي ({currencyLabel}) — تلقائي</label>
          <div className="px-3 py-2 bg-void border border-gunmetal rounded font-mono tabular-nums text-sm text-gold-bright" dir="ltr">
            {remaining.toFixed(2)} {currencyLabel}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between p-2.5 bg-void border border-gunmetal rounded">
        <span className="font-mono text-[10px] text-secondary uppercase tracking-wider">حالة الدفع (محسوبة تلقائياً)</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border uppercase tracking-wider ${chip.cls}`}>
          {chip.label}
        </span>
      </div>
      {overpaid && (
        <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">
          المبلغ المدفوع أكبر من المبلغ الإجمالي — راجع الأرقام قبل الحفظ
        </div>
      )}
      {error && (
        <div className="p-2.5 bg-red/10 border border-red/30 rounded font-mono text-xs text-red">{error}</div>
      )}
    </div>
  );
}
