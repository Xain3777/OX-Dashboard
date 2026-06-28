"use client";

import { useMemo, useState } from "react";
import { Plus, Check, X, Edit2, Trash2, AlertTriangle, Link2, Soup } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { CatalogItem, RawMaterial, ItemRecipeLine } from "@/lib/types";

// Recipes / bill-of-materials (الوصفات) — links a sellable catalog item
// (مادة المبيع) to the warehouse raw_materials it consumes (المكونات
// الأساسية). Selling the item auto-deducts these from the warehouse and
// cancelling restores them (DB triggers, 0066). Manager-only.

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";
const BTN_ADD = "flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer disabled:opacity-50";
const EDIT_INPUT = "w-20 bg-[#0A0A0A] border border-[#F5C100]/40 rounded-sm px-2 py-0.5 text-xs text-[#F0EDE6] focus:outline-none";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export default function RecipesManager() {
  const { catalogItems, rawMaterials, itemRecipes, addItemRecipe, updateItemRecipe, removeItemRecipe } = useStore();

  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // New-component form
  const [nMaterialId, setNMaterialId] = useState("");
  const [nQuantity, setNQuantity] = useState("");
  const [nUnit, setNUnit] = useState("");
  const [nNotes, setNNotes] = useState("");

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");

  const materialById = useMemo(() => {
    const m = new Map<string, RawMaterial>();
    for (const r of rawMaterials) m.set(r.id, r);
    return m;
  }, [rawMaterials]);

  const itemById = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const c of catalogItems) m.set(c.id, c);
    return m;
  }, [catalogItems]);

  // Recipe lines grouped by catalog item.
  const byItem = useMemo(() => {
    const m = new Map<string, ItemRecipeLine[]>();
    for (const r of itemRecipes) {
      const arr = m.get(r.catalogItemId) ?? [];
      arr.push(r);
      m.set(r.catalogItemId, arr);
    }
    return m;
  }, [itemRecipes]);

  const itemsWithRecipes = useMemo(
    () => [...byItem.keys()].map((id) => itemById.get(id)).filter((c): c is CatalogItem => !!c).sort((a, b) => a.name.localeCompare(b.name)),
    [byItem, itemById],
  );

  const selectedLines = selectedItemId ? (byItem.get(selectedItemId) ?? []) : [];
  const sortedItems = useMemo(() => [...catalogItems].sort((a, b) => a.name.localeCompare(b.name)), [catalogItems]);

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(""), 2000); }

  // Default the unit field to the chosen material's stocking unit.
  function onPickMaterial(id: string) {
    setNMaterialId(id);
    const mat = materialById.get(id);
    if (mat) setNUnit(mat.unit);
  }

  async function handleAddComponent() {
    setError("");
    if (!selectedItemId) { setError("اختر صنف المبيع أولاً."); return; }
    if (!nMaterialId) { setError("اختر المادة الأساسية."); return; }
    const q = parseFloat(nQuantity);
    if (!Number.isFinite(q) || q <= 0) { setError("الكمية غير صالحة."); return; }
    const mat = materialById.get(nMaterialId);
    setBusy(true);
    const r = await addItemRecipe({
      catalogItemId: selectedItemId,
      rawMaterialId: nMaterialId,
      quantity: q,
      unit: nUnit.trim() || mat?.unit || "piece",
      notes: nNotes.trim() || null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setNMaterialId(""); setNQuantity(""); setNUnit(""); setNNotes("");
    flash("تمت إضافة المكوّن.");
  }

  function startEdit(line: ItemRecipeLine) {
    setError("");
    setEditId(line.id);
    setEditQty(String(line.quantity));
    setEditUnit(line.unit);
  }
  function cancelEdit() { setEditId(null); setEditQty(""); setEditUnit(""); }

  async function saveEdit(id: string) {
    setError("");
    const q = parseFloat(editQty);
    if (!Number.isFinite(q) || q <= 0) { setError("الكمية غير صالحة."); return; }
    setBusy(true);
    const r = await updateItemRecipe(id, { quantity: q, unit: editUnit.trim() || "piece" });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    cancelEdit();
    flash("تم الحفظ.");
  }

  async function handleRemove(line: ItemRecipeLine) {
    const matName = materialById.get(line.rawMaterialId)?.name ?? "المكوّن";
    if (!window.confirm(`حذف ${matName} من وصفة هذا الصنف؟`)) return;
    setBusy(true);
    const r = await removeItemRecipe(line.id);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    flash("تم الحذف.");
  }

  const noMaterials = rawMaterials.filter((m) => m.isActive).length === 0;

  return (
    <div className="space-y-4">
      {/* Intro / how it works */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-3 flex items-start gap-2">
        <Link2 size={14} className="text-[#F5C100] mt-0.5 shrink-0" />
        <p className="font-mono text-[10px] leading-relaxed text-[#777777]">
          اربط صنف المبيع بمكوّناته من المستودع. عند بيع الصنف تُخصم المكوّنات تلقائياً من المخزون، وعند إلغاء البيع تُعاد.
          الكمية تُحسب لكل وحدة مبيعة وبواحدة المادة في المستودع.
        </p>
      </div>

      {noMaterials && (
        <div className="bg-[#FF7A00]/8 border border-[#FF7A00]/30 rounded-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={13} className="text-[#FF7A00]" />
          <span className="font-mono text-[10px] text-[#FF7A00]">لا توجد مواد في المستودع بعد — أضف مواد من قسم «المستودع» قبل تعريف الوصفات.</span>
        </div>
      )}

      {/* Editor for the selected item */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex flex-wrap items-center gap-3">
          <Soup size={14} className="text-[#F5C100]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">صنف المبيع</span>
          <select value={selectedItemId} onChange={(e) => { setSelectedItemId(e.target.value); setEditId(null); setError(""); }} className={`min-w-[220px] ${SELECT}`}>
            <option value="">— اختر صنفاً —</option>
            {sortedItems.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{byItem.has(c.id) ? ` (${byItem.get(c.id)!.length} مكوّن)` : ""}</option>
            ))}
          </select>
        </div>

        {error && <p className="px-5 pt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
        {ok && <p className="px-5 pt-2 text-[11px] font-mono text-[#5CC45C]">{ok}</p>}

        {!selectedItemId ? (
          <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">اختر صنفاً لعرض وتعديل وصفته</div>
        ) : (
          <>
            {/* Component lines */}
            {selectedLines.length === 0 ? (
              <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا مكوّنات بعد لهذا الصنف</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#252525] bg-[#111111]">
                      {["المادة الأساسية", "الكمية / وحدة مبيعة", "الواحدة", "المخزون الحالي", ""].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#252525]/60">
                    {selectedLines.map((line) => {
                      const mat = materialById.get(line.rawMaterialId);
                      const editing = editId === line.id;
                      const low = mat ? mat.lowStockThreshold > 0 && mat.currentQuantity <= mat.lowStockThreshold : false;
                      return (
                        <tr key={line.id} className="hover:bg-[#252525]/20 transition-colors">
                          <td className="px-4 py-2.5 text-[#F0EDE6]">{mat?.name ?? <span className="text-[#FF3333]">مادة محذوفة</span>}</td>
                          <td className="px-4 py-2.5">
                            {editing
                              ? <input value={editQty} onChange={(e) => setEditQty(e.target.value)} type="number" min="0" step="0.001" className={`${EDIT_INPUT} text-[#F5C100]`} dir="ltr" />
                              : <span className="font-mono tabular-nums text-[#F5C100]" dir="ltr">{fmtQty(line.quantity)}</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {editing
                              ? <input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} className={`w-20 ${EDIT_INPUT}`} />
                              : <span className="font-mono text-[10px] text-[#AAAAAA]">{line.unit}</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums text-[10px] whitespace-nowrap" dir="ltr">
                            {mat ? <span className={low ? "text-[#FF3333]" : "text-[#5CC45C]"}>{fmtQty(mat.currentQuantity)} {mat.unit}</span> : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              {editing ? (
                                <>
                                  <button onClick={() => saveEdit(line.id)} disabled={busy} className="text-[#5CC45C] hover:opacity-80 cursor-pointer disabled:opacity-40"><Check size={13} /></button>
                                  <button onClick={cancelEdit} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={13} /></button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => startEdit(line)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"><Edit2 size={11} /></button>
                                  <button onClick={() => handleRemove(line)} className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"><Trash2 size={11} /></button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add component */}
            <div className="px-5 py-4 border-t border-[#252525] bg-[#0F0F0F]">
              <div className="flex flex-wrap items-center gap-2">
                <select value={nMaterialId} onChange={(e) => onPickMaterial(e.target.value)} className={`flex-1 min-w-[180px] ${SELECT}`} disabled={noMaterials}>
                  <option value="">— اختر مادة أساسية —</option>
                  {rawMaterials.filter((m) => m.isActive).map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                  ))}
                </select>
                <input value={nQuantity} onChange={(e) => setNQuantity(e.target.value)} placeholder="الكمية لكل وحدة" type="number" min="0" step="0.001" className={`w-36 ${INPUT}`} dir="ltr" />
                <input value={nUnit} onChange={(e) => setNUnit(e.target.value)} placeholder="الواحدة" className={`w-24 ${INPUT}`} />
                <input value={nNotes} onChange={(e) => setNNotes(e.target.value)} placeholder="ملاحظات (اختياري)" className={`flex-1 min-w-[120px] ${INPUT}`} />
                <button onClick={handleAddComponent} disabled={busy || noMaterials} className={BTN_ADD}><Plus size={12} />إضافة مكوّن</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Summary of items that have recipes */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex items-center gap-2">
          <Link2 size={13} className="text-[#F5C100]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">أصناف لها وصفات ({itemsWithRecipes.length})</span>
        </div>
        {itemsWithRecipes.length === 0 ? (
          <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا أصناف مرتبطة بمكوّنات بعد</div>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {itemsWithRecipes.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedItemId(c.id); setEditId(null); setError(""); }}
                className={`px-3 py-1.5 rounded border font-mono text-[11px] transition-colors cursor-pointer ${selectedItemId === c.id ? "text-[#F5C100] border-[#F5C100]/50 bg-[#F5C100]/10" : "text-[#AAAAAA] border-[#252525] hover:border-[#555555]"}`}
              >
                {c.name} <span className="text-[#555555]">· {byItem.get(c.id)!.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
