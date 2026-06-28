"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, Plus, AlertTriangle, Check, ArrowDown, ArrowUp } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { formatDate, formatTime } from "@/lib/utils/time";
import type { AdjustmentReason } from "@/lib/types";

// Stock adjustments / wastage ledger (تعديلات وهدر المخزون). Records a signed
// manual warehouse movement (spoilage, breakage, count correction, gift) that
// a DB trigger applies to the material's quantity (0067). Append-only — to
// undo, record an opposite entry.

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";

const REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: "waste", label: "تلف" },
  { value: "breakage", label: "كسر" },
  { value: "count", label: "جرد تصحيحي" },
  { value: "gift", label: "هدية" },
  { value: "other", label: "أخرى" },
];
const REASON_LABEL: Record<AdjustmentReason, string> = {
  waste: "تلف", breakage: "كسر", count: "جرد تصحيحي", gift: "هدية", other: "أخرى",
};

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export default function AdjustmentsManager() {
  const { rawMaterials, stockAdjustments, addStockAdjustment } = useStore();

  const [materialId, setMaterialId] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("waste");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const activeMaterials = useMemo(() => rawMaterials.filter((m) => m.isActive).sort((a, b) => a.name.localeCompare(b.name)), [rawMaterials]);
  const selected = rawMaterials.find((m) => m.id === materialId);
  const log = useMemo(() => [...stockAdjustments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [stockAdjustments]);

  async function handleSubmit() {
    setError("");
    if (!materialId) { setError("اختر المادة."); return; }
    const qAbs = parseFloat(quantity);
    if (!Number.isFinite(qAbs) || qAbs <= 0) { setError("الكمية غير صالحة."); return; }
    const delta = direction === "out" ? -qAbs : qAbs;
    setBusy(true);
    const r = await addStockAdjustment({
      rawMaterialId: materialId,
      materialName: selected?.name ?? "",
      delta,
      reason,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setQuantity(""); setNotes("");
    setOk("تم تسجيل التعديل وتحديث المخزون.");
    setTimeout(() => setOk(""), 2500);
  }

  return (
    <div className="space-y-4">
      {/* Record form */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex items-center gap-2">
          <SlidersHorizontal size={13} className="text-[#F5C100]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تسجيل تعديل / هدر مخزون</span>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={`flex-1 min-w-[180px] ${SELECT}`}>
              <option value="">— اختر المادة —</option>
              {activeMaterials.map((m) => <option key={m.id} value={m.id}>{m.name} (متبقي {fmtQty(m.currentQuantity)} {m.unit})</option>)}
            </select>

            {/* Direction toggle */}
            <div className="flex rounded-sm border border-[#252525] overflow-hidden">
              <button
                onClick={() => setDirection("out")}
                className={`flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] transition-colors cursor-pointer ${direction === "out" ? "bg-[#FF3333]/15 text-[#FF3333]" : "text-[#777777] hover:text-[#AAAAAA]"}`}
              >
                <ArrowDown size={11} /> نقص
              </button>
              <button
                onClick={() => setDirection("in")}
                className={`flex items-center gap-1 px-3 py-1.5 font-mono text-[10px] transition-colors cursor-pointer ${direction === "in" ? "bg-[#5CC45C]/15 text-[#5CC45C]" : "text-[#777777] hover:text-[#AAAAAA]"}`}
              >
                <ArrowUp size={11} /> زيادة
              </button>
            </div>

            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="الكمية" type="number" min="0" step="0.001" className={`w-28 ${INPUT}`} dir="ltr" />
            <select value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)} className={SELECT}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات (اختياري)" className={`flex-1 min-w-[140px] ${INPUT}`} />
            <button onClick={handleSubmit} disabled={busy} className="flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer disabled:opacity-50">
              <Plus size={12} /> تسجيل
            </button>
          </div>
          {selected && (
            <p className="mt-2 font-mono text-[10px] text-[#777777]">
              المتبقي الحالي: <span className="text-[#5CC45C]" dir="ltr">{fmtQty(selected.currentQuantity)} {selected.unit}</span>
              {quantity && Number.isFinite(parseFloat(quantity)) && (
                <> → بعد التعديل: <span className="text-[#F5C100]" dir="ltr">{fmtQty(selected.currentQuantity + (direction === "out" ? -parseFloat(quantity) : parseFloat(quantity)))} {selected.unit}</span></>
              )}
            </p>
          )}
          {error && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]"><AlertTriangle size={11} />{error}</p>}
          {ok && <p className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]"><Check size={11} />{ok}</p>}
          <p className="mt-1.5 font-mono text-[9px] text-[#555555]">السجل غير قابل للتعديل — لتصحيح خطأ، سجّل حركة معاكسة.</p>
        </div>
      </div>

      {/* Ledger */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">سجل التعديلات ({log.length})</span>
        </div>
        {log.length === 0 ? (
          <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا تعديلات مسجّلة</div>
        ) : (
          <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-[#252525] bg-[#111111]">
                  {["المادة", "التغيير", "السبب", "ملاحظات", "بواسطة", "التاريخ"].map((h) => (
                    <th key={h} className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#252525]/60">
                {log.map((a) => (
                  <tr key={a.id} className="hover:bg-[#252525]/20">
                    <td className="px-4 py-2 text-[#F0EDE6]">{a.materialNameSnapshot}</td>
                    <td className={`px-4 py-2 font-mono tabular-nums ${a.delta < 0 ? "text-[#FF3333]" : "text-[#5CC45C]"}`} dir="ltr">{a.delta > 0 ? "+" : ""}{fmtQty(a.delta)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#AAAAAA]">{REASON_LABEL[a.reason]}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#777777] max-w-[200px] truncate">{a.notes || "—"}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#777777]">{a.createdByName || "—"}</td>
                    <td className="px-4 py-2 font-mono text-[9px] text-[#555555] whitespace-nowrap">{formatDate(a.createdAt)} · {formatTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
