"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Check, AlertTriangle, FileText } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { Currency } from "@/lib/types";

// Shared inventory-purchase entry: an invoice header (date + number +
// supplier + currency) with one or more material lines (name / qty / unit /
// purchase price / notes). Recording it increases warehouse stock (via the
// 0064 trigger) and mirrors the total into one expenses row. Used by both
// the manager Purchases section and the reception block — the `source` prop
// distinguishes them.

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";

const UNIT_SUGGESTIONS = ["قطعة", "علبة", "كيس", "كرتونة", "كغ", "غرام", "لتر", "مل"];

type LineRow = { materialName: string; unit: string; quantity: string; unitPrice: string; notes: string };

function emptyLine(): LineRow {
  return { materialName: "", unit: "قطعة", quantity: "", unitPrice: "", notes: "" };
}

export default function PurchaseInvoiceForm({
  source,
  onDone,
}: {
  source: "manager" | "reception_daily";
  onDone?: () => void;
}) {
  const { rawMaterials, addPurchaseInvoice } = useStore();

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState("");
  const [currency, setCurrency] = useState<Currency>("syp");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const total = useMemo(
    () => lines.reduce((a, l) => {
      const q = parseFloat(l.quantity), p = parseFloat(l.unitPrice);
      return a + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
    }, 0),
    [lines],
  );

  function setLine(i: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // When a material name matches an existing one, prefill its unit.
  function onMaterialName(i: number, name: string) {
    const match = rawMaterials.find((m) => m.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    setLine(i, match ? { materialName: name, unit: match.unit } : { materialName: name });
  }

  function addLine() { setLines((prev) => [...prev, emptyLine()]); }
  function removeLine(i: number) { setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)); }

  async function handleSubmit() {
    setError(""); setOk("");
    const clean = lines
      .map((l) => ({
        materialName: l.materialName.trim(),
        unit: l.unit.trim() || "قطعة",
        quantity: parseFloat(l.quantity),
        unitPurchasePrice: parseFloat(l.unitPrice),
        notes: l.notes.trim() || null,
        rawMaterialId:
          rawMaterials.find((m) => m.name.trim().toLocaleLowerCase() === l.materialName.trim().toLocaleLowerCase())?.id ?? null,
      }))
      .filter((l) => l.materialName);
    if (clean.length === 0) { setError("أضف بنداً واحداً على الأقل."); return; }
    for (const l of clean) {
      if (!Number.isFinite(l.quantity) || l.quantity <= 0) { setError(`الكمية غير صالحة للمادة: ${l.materialName}`); return; }
      if (!Number.isFinite(l.unitPurchasePrice) || l.unitPurchasePrice < 0) { setError(`سعر الشراء غير صالح للمادة: ${l.materialName}`); return; }
    }

    setBusy(true);
    const r = await addPurchaseInvoice({
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceDate,
      supplier: supplier.trim() || null,
      currency,
      lines: clean,
      source,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setInvoiceNumber(""); setSupplier(""); setLines([emptyLine()]);
    setOk("تم تسجيل الفاتورة وتحديث المستودع.");
    setTimeout(() => setOk(""), 2500);
    onDone?.();
  }

  return (
    <div className="bg-[#0F0F0F] border border-[#252525] rounded-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FileText size={13} className="text-[#F5C100]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">فاتورة مشتريات — تزيد المخزون</p>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">رقم الفاتورة</label>
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="—" className={`w-32 ${INPUT}`} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">التاريخ</label>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={INPUT} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">المورّد (اختياري)</label>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="—" className={`w-full ${INPUT}`} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">العملة</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={SELECT}>
            <option value="syp">ل.س</option>
            <option value="usd">$</option>
          </select>
        </div>
      </div>

      {/* Datalist of existing materials for quick select */}
      <datalist id="raw-materials-list">
        {rawMaterials.map((m) => <option key={m.id} value={m.name} />)}
      </datalist>

      {/* Lines */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_90px_80px_110px_1fr_28px] gap-2 px-1">
          {["المادة", "الواحدة", "الكمية", "سعر الوحدة", "ملاحظات", ""].map((h) => (
            <span key={h} className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">{h}</span>
          ))}
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_80px_110px_1fr_28px] gap-2 items-center">
            <input list="raw-materials-list" value={l.materialName} onChange={(e) => onMaterialName(i, e.target.value)} placeholder="اسم المادة" className={INPUT} />
            <input list="units-list" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} className={INPUT} />
            <input value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} type="number" min="0" step="0.001" placeholder="0" className={`${INPUT} text-[#5CC45C]`} dir="ltr" />
            <input value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} type="number" min="0" step="0.01" placeholder="0" className={`${INPUT} text-[#F5C100]`} dir="ltr" />
            <input value={l.notes} onChange={(e) => setLine(i, { notes: e.target.value })} placeholder="—" className={INPUT} />
            <button onClick={() => removeLine(i)} disabled={lines.length === 1} className="p-1 text-[#555555] hover:text-[#FF3333] cursor-pointer disabled:opacity-30 disabled:cursor-default" title="حذف البند">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <datalist id="units-list">
          {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
        </datalist>
        <button onClick={addLine} className="flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded border border-[#5CC45C]/30 text-[#5CC45C] hover:bg-[#5CC45C]/10 transition-colors cursor-pointer">
          <Plus size={11} /> إضافة بند
        </button>
      </div>

      {/* Footer: total + submit */}
      <div className="flex items-center justify-between border-t border-[#252525] pt-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الإجمالي</span>
          <span className="font-mono tabular-nums text-sm text-[#F5C100]" dir="ltr">
            {currency === "syp" ? `${Math.round(total).toLocaleString("en-US")} ل.س` : `$${total.toFixed(2)}`}
          </span>
        </div>
        <button onClick={handleSubmit} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer disabled:opacity-50">
          <Check size={12} /> {busy ? "جاري…" : "تسجيل الفاتورة"}
        </button>
      </div>

      {error && <p className="flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]"><AlertTriangle size={11} />{error}</p>}
      {ok && <p className="flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]"><Check size={11} />{ok}</p>}
    </div>
  );
}
