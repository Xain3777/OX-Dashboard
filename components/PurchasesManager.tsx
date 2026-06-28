"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Trash2, ShoppingCart } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { formatDate, formatTime } from "@/lib/utils/time";
import type { Currency, PurchaseInvoice } from "@/lib/types";
import PurchaseInvoiceForm from "@/components/PurchaseInvoiceForm";

// Manager view of inventory purchases: the entry form plus a log of recorded
// invoices (expandable to their material lines) with cancel — cancelling an
// invoice reverses the warehouse stock (trigger) and cancels the mirrored
// expense row.

function money(amount: number, currency: Currency): string {
  return currency === "syp"
    ? `${Math.round(amount).toLocaleString("en-US")} ل.س`
    : `$${Number(amount).toFixed(2)}`;
}
function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export default function PurchasesManager() {
  const { purchaseInvoices, cancelPurchaseInvoice } = useStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const invoices = useMemo(
    () => [...purchaseInvoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [purchaseInvoices],
  );

  async function handleCancel(inv: PurchaseInvoice) {
    if (!window.confirm(`إلغاء فاتورة المشتريات${inv.invoiceNumber ? ` (${inv.invoiceNumber})` : ""}؟\nسيُعاد خصم الكميات من المستودع.`)) return;
    setError("");
    setBusyId(inv.id);
    const r = await cancelPurchaseInvoice(inv.id);
    setBusyId(null);
    if (r.error) { setError(r.error); return; }
  }

  return (
    <div className="space-y-4">
      <PurchaseInvoiceForm source="manager" />

      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[#252525] bg-[#111111]">
          <ShoppingCart size={13} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">سجل فواتير المشتريات</p>
          <span className="font-mono text-[10px] text-[#555555]">({invoices.length})</span>
        </div>

        {error && <p className="px-5 pt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}

        {invoices.length === 0 ? (
          <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد فواتير مشتريات</div>
        ) : (
          <div className="divide-y divide-[#252525]/60">
            {invoices.map((inv) => {
              const open = expanded[inv.id];
              return (
                <div key={inv.id}>
                  <div className="flex items-center gap-3 px-5 py-3 hover:bg-[#252525]/20 transition-colors">
                    <button onClick={() => setExpanded((e) => ({ ...e, [inv.id]: !open }))} className="text-[#555555] hover:text-[#F5C100] cursor-pointer">
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[#F0EDE6]">{inv.invoiceNumber || "بدون رقم"}</span>
                        {inv.supplier && <span className="font-mono text-[10px] text-[#777777]">— {inv.supplier}</span>}
                        <span className="font-mono text-[10px] text-[#555555]">· {inv.lines.length} بند</span>
                        {inv.source === "reception_daily" && (
                          <span className="px-1.5 py-0.5 bg-[#F5C100]/15 border border-[#F5C100]/40 rounded text-[9px] font-mono text-[#F5C100]">من الاستقبال</span>
                        )}
                      </div>
                      <span className="font-mono text-[9px] text-[#555555]">{formatDate(inv.invoiceDate)} · {formatTime(inv.createdAt)}{inv.createdByName ? ` · ${inv.createdByName}` : ""}</span>
                    </div>
                    <span className="font-mono tabular-nums text-sm text-[#F5C100]" dir="ltr">{money(inv.total, inv.currency)}</span>
                    <button onClick={() => handleCancel(inv)} disabled={busyId === inv.id} className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer disabled:opacity-40" title="إلغاء الفاتورة">
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {open && (
                    <div className="px-5 pb-3 bg-[#0F0F0F]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[#252525]">
                            {["المادة", "الكمية", "الواحدة", "سعر الوحدة", "الإجمالي", "ملاحظات"].map((h) => (
                              <th key={h} className="px-3 py-1.5 text-right font-mono text-[9px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#252525]/40">
                          {inv.lines.map((l) => (
                            <tr key={l.id}>
                              <td className="px-3 py-1.5 text-[#F0EDE6]">{l.materialNameSnapshot}</td>
                              <td className="px-3 py-1.5 font-mono tabular-nums text-[#5CC45C]" dir="ltr">{fmtQty(l.quantity)}</td>
                              <td className="px-3 py-1.5 font-mono text-[10px] text-[#AAAAAA]">{l.unit}</td>
                              <td className="px-3 py-1.5 font-mono tabular-nums text-[#777777]" dir="ltr">{money(l.unitPurchasePrice, inv.currency)}</td>
                              <td className="px-3 py-1.5 font-mono tabular-nums text-[#F5C100]" dir="ltr">{money(l.lineTotal, inv.currency)}</td>
                              <td className="px-3 py-1.5 font-mono text-[10px] text-[#777777]">{l.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
