"use client";

import { useMemo, useState } from "react";
import { Plus, Check, X, Edit2, AlertTriangle, Boxes } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { RawMaterial, Currency } from "@/lib/types";

// Warehouse (المستودع) — raw materials with current quantity + low-stock
// alerts. Stock is bumped by purchase invoices (trigger) and can be
// corrected here by the manager. Reception sees this read-only-ish (the
// add/edit calls are manager-gated by RLS; errors surface inline).

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";
const BTN_ADD = "flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer disabled:opacity-50";
const EDIT_INPUT = "w-20 bg-[#0A0A0A] border border-[#F5C100]/40 rounded-sm px-2 py-0.5 text-xs text-[#F0EDE6] focus:outline-none";

const UNIT_SUGGESTIONS = ["قطعة", "علبة", "كيس", "كرتونة", "كغ", "غرام", "لتر", "مل"];

function money(amount: number | null, currency: Currency | null): string {
  if (amount == null) return "—";
  return (currency ?? "usd") === "syp"
    ? `${Math.round(amount).toLocaleString("en-US")} ل.س`
    : `$${Number(amount).toFixed(2)}`;
}

function fmtQty(n: number): string {
  // Drop trailing zeros for whole numbers but keep fractional precision.
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

type MatDraft = { name: string; unit: string; currentQuantity: string; lowStockThreshold: string; notes: string };

export default function WarehouseManager() {
  const { rawMaterials, addRawMaterial, updateRawMaterial } = useStore();

  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => rawMaterials.filter((m) => m.isActive), [rawMaterials]);
  const lowStock = useMemo(
    () => active.filter((m) => m.currentQuantity <= m.lowStockThreshold),
    [active],
  );

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(""), 2000); }

  // ── Add form ──
  const [nName, setNName] = useState("");
  const [nUnit, setNUnit] = useState("قطعة");
  const [nThreshold, setNThreshold] = useState("0");
  const [nNotes, setNNotes] = useState("");

  async function handleAdd() {
    setError("");
    if (!nName.trim()) { setError("اسم المادة مطلوب."); return; }
    const thr = parseFloat(nThreshold);
    setBusy(true);
    const r = await addRawMaterial({
      name: nName.trim(),
      unit: nUnit.trim() || "قطعة",
      lowStockThreshold: Number.isFinite(thr) && thr >= 0 ? thr : 0,
      notes: nNotes.trim() || null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setNName(""); setNNotes(""); setNThreshold("0");
    flash("تمت إضافة المادة.");
  }

  // ── Inline edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MatDraft | null>(null);

  function startEdit(m: RawMaterial) {
    setError("");
    setEditId(m.id);
    setDraft({
      name: m.name,
      unit: m.unit,
      currentQuantity: fmtQty(m.currentQuantity),
      lowStockThreshold: fmtQty(m.lowStockThreshold),
      notes: m.notes ?? "",
    });
  }
  function cancelEdit() { setEditId(null); setDraft(null); }

  async function saveEdit(id: string) {
    if (!draft) return;
    setError("");
    if (!draft.name.trim()) { setError("اسم المادة مطلوب."); return; }
    const qty = parseFloat(draft.currentQuantity);
    const thr = parseFloat(draft.lowStockThreshold);
    if (!Number.isFinite(qty) || qty < 0) { setError("الكمية غير صالحة."); return; }
    setBusy(true);
    const r = await updateRawMaterial(id, {
      name: draft.name.trim(),
      unit: draft.unit.trim() || "قطعة",
      currentQuantity: qty,
      lowStockThreshold: Number.isFinite(thr) && thr >= 0 ? thr : 0,
      notes: draft.notes.trim() || null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    cancelEdit();
    flash("تم الحفظ.");
  }

  return (
    <div className="space-y-4">
      {/* Low-stock alert */}
      {lowStock.length > 0 && (
        <div className="bg-[#FF3333]/8 border border-[#FF3333]/30 rounded-sm px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={13} className="text-[#FF3333]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#FF7A7A]">مواد بلغت الحد الأدنى — يُنصح بإعادة الطلب ({lowStock.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStock.map((m) => (
              <span key={m.id} className="px-2 py-0.5 bg-[#FF3333]/10 border border-[#FF3333]/30 rounded text-[10px] font-mono text-[#FF7A7A] whitespace-nowrap">
                {m.name}: {fmtQty(m.currentQuantity)} {m.unit}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        {/* Add form */}
        <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]">
          <div className="flex items-center gap-2 mb-3">
            <Boxes size={13} className="text-[#F5C100]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إضافة مادة للمستودع</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="اسم المادة" className={`flex-1 min-w-[160px] ${INPUT}`} />
            <select value={nUnit} onChange={(e) => setNUnit(e.target.value)} className={SELECT}>
              {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <input value={nThreshold} onChange={(e) => setNThreshold(e.target.value)} placeholder="حد التنبيه" type="number" min="0" step="0.001" className={`w-28 ${INPUT}`} dir="ltr" />
            <input value={nNotes} onChange={(e) => setNNotes(e.target.value)} placeholder="ملاحظات (اختياري)" className={`flex-1 min-w-[140px] ${INPUT}`} />
            <button onClick={handleAdd} disabled={busy} className={BTN_ADD}><Plus size={12} />إضافة</button>
          </div>
          {error && <p className="mt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
          {ok && <p className="mt-2 text-[11px] font-mono text-[#5CC45C]">{ok}</p>}
        </div>

        {active.length === 0 ? (
          <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد مواد في المستودع</div>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr className="border-b border-[#252525] bg-[#111111]">
                  {["المادة", "الواحدة", "الكمية الحالية", "حد التنبيه", "سعر الشراء الأخير", "ملاحظات", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#252525]/60">
                {active.map((m) => {
                  const editing = editId === m.id && draft;
                  const low = m.currentQuantity <= m.lowStockThreshold;
                  return (
                    <tr key={m.id} className={`transition-colors ${low ? "bg-[#FF3333]/5 border-r-2 border-r-[#FF3333]/40" : "hover:bg-[#252525]/20"}`}>
                      {editing ? (
                        <>
                          <td className="px-4 py-2.5"><input value={draft!.name} onChange={(e) => setDraft({ ...draft!, name: e.target.value })} className={`w-40 ${EDIT_INPUT}`} /></td>
                          <td className="px-4 py-2.5"><input value={draft!.unit} onChange={(e) => setDraft({ ...draft!, unit: e.target.value })} className={`w-20 ${EDIT_INPUT}`} /></td>
                          <td className="px-4 py-2.5"><input value={draft!.currentQuantity} onChange={(e) => setDraft({ ...draft!, currentQuantity: e.target.value })} type="number" step="0.001" className={`${EDIT_INPUT} text-[#5CC45C]`} dir="ltr" /></td>
                          <td className="px-4 py-2.5"><input value={draft!.lowStockThreshold} onChange={(e) => setDraft({ ...draft!, lowStockThreshold: e.target.value })} type="number" step="0.001" className={EDIT_INPUT} dir="ltr" /></td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]" dir="ltr">{money(m.lastPurchasePrice, m.costCurrency)}</td>
                          <td className="px-4 py-2.5"><input value={draft!.notes} onChange={(e) => setDraft({ ...draft!, notes: e.target.value })} className={`w-full ${EDIT_INPUT} text-[#AAAAAA]`} /></td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <button onClick={() => saveEdit(m.id)} disabled={busy} className="text-[#5CC45C] hover:opacity-80 cursor-pointer disabled:opacity-40"><Check size={13} /></button>
                              <button onClick={cancelEdit} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={13} /></button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 text-[#F0EDE6]">
                            <div className="flex items-center gap-2">
                              {m.name}
                              {low && <AlertTriangle size={11} className="text-[#FF3333] shrink-0" />}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{m.unit}</td>
                          <td className={`px-4 py-2.5 font-mono tabular-nums whitespace-nowrap ${low ? "text-[#FF3333]" : "text-[#5CC45C]"}`} dir="ltr">{fmtQty(m.currentQuantity)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777] whitespace-nowrap" dir="ltr">{fmtQty(m.lowStockThreshold)}</td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777] whitespace-nowrap" dir="ltr">{money(m.lastPurchasePrice, m.costCurrency)}</td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-[#AAAAAA] max-w-[200px] truncate">{m.notes || <span className="text-[#555555]">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => startEdit(m)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"><Edit2 size={11} /></button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
