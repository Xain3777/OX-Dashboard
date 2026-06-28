"use client";

import { useMemo, useState } from "react";
import {
  Plus, Check, X, Edit2, Trash2, AlertTriangle, Link2, Zap,
  ChevronDown, ChevronUp, PackageX,
} from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { CatalogItem, RawMaterial, ItemRecipeLine, CatalogItemCategory } from "@/lib/types";

// Recipes / bill-of-materials (الوصفات) — links a sellable catalog item
// (مادة المبيع) to the warehouse raw_materials it consumes. Selling the item
// auto-deducts these (DB triggers, 0066); cancelling restores them.
//
// This screen lists EVERY active sellable item with its link status so the
// manager can see at a glance what's wired up, link/unlink inline (creating
// the warehouse material on the fly), and fix mistakes per item. A one-click
// "ربط سريع 1:1" handles plain resale items (water/cookie): it creates a
// matching warehouse material, a 1:1 recipe, and turns OFF the item's own
// stock tracking so the same sale isn't counted twice.

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const BTN_ADD = "flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer disabled:opacity-50";
const EDIT_INPUT = "w-20 bg-[#0A0A0A] border border-[#F5C100]/40 rounded-sm px-2 py-0.5 text-xs text-[#F0EDE6] focus:outline-none";

const CATEGORY_LABELS: Record<CatalogItemCategory, string> = {
  meals: "وجبات", meal_addons: "إضافات وجبة", drinks: "مشروبات",
  supplements: "مكملات", accessories: "إكسسوارات", other: "أخرى",
};

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export default function RecipesManager() {
  const {
    catalogItems, rawMaterials, itemRecipes,
    addItemRecipe, updateItemRecipe, removeItemRecipe,
    addRawMaterial, updateCatalogItem,
  } = useStore();

  const [query, setQuery] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // Per-item "add component" draft.
  const [addDraft, setAddDraft] = useState<Record<string, { name: string; quantity: string; unit: string; notes: string }>>({});
  // Inline edit of an existing component line.
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");

  const materialById = useMemo(() => {
    const m = new Map<string, RawMaterial>();
    for (const r of rawMaterials) m.set(r.id, r);
    return m;
  }, [rawMaterials]);

  const byItem = useMemo(() => {
    const m = new Map<string, ItemRecipeLine[]>();
    for (const r of itemRecipes) {
      const arr = m.get(r.catalogItemId) ?? [];
      arr.push(r);
      m.set(r.catalogItemId, arr);
    }
    return m;
  }, [itemRecipes]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return catalogItems
      .filter((c) => c.isActive)
      .filter((c) => (onlyUnlinked ? !byItem.has(c.id) : true))
      .filter((c) => (q ? c.name.toLocaleLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogItems, byItem, query, onlyUnlinked]);

  const linkedCount = useMemo(() => catalogItems.filter((c) => c.isActive && byItem.has(c.id)).length, [catalogItems, byItem]);

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(""), 2500); }
  function draftFor(id: string) { return addDraft[id] ?? { name: "", quantity: "", unit: "", notes: "" }; }
  function setDraft(id: string, patch: Partial<{ name: string; quantity: string; unit: string; notes: string }>) {
    setAddDraft((prev) => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));
  }

  // Find an active material by name (case-insensitive) or create it.
  async function resolveMaterial(name: string, unit: string): Promise<{ id: string; unit: string } | { error: string }> {
    const existing = rawMaterials.find((m) => m.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    if (existing) return { id: existing.id, unit: existing.unit };
    const r = await addRawMaterial({ name: name.trim(), unit: unit.trim() || "قطعة", lowStockThreshold: 0 });
    if (r.error || !r.data) return { error: r.error ?? "تعذّر إنشاء المادة" };
    return { id: r.data.id, unit: r.data.unit };
  }

  async function handleAddComponent(item: CatalogItem) {
    setError("");
    const d = draftFor(item.id);
    const name = d.name.trim();
    if (!name) { setError("اكتب اسم المادة الأساسية أو اخترها."); return; }
    const q = parseFloat(d.quantity);
    if (!Number.isFinite(q) || q <= 0) { setError("الكمية غير صالحة."); return; }
    setBusyId(item.id);
    const mat = await resolveMaterial(name, d.unit);
    if ("error" in mat) { setBusyId(null); setError(mat.error); return; }
    const r = await addItemRecipe({
      catalogItemId: item.id,
      rawMaterialId: mat.id,
      quantity: q,
      unit: d.unit.trim() || mat.unit,
      notes: d.notes.trim() || null,
    });
    setBusyId(null);
    if (r.error) { setError(r.error); return; }
    setAddDraft((prev) => ({ ...prev, [item.id]: { name: "", quantity: "", unit: "", notes: "" } }));
    flash("تمت إضافة المكوّن.");
  }

  // One click: create a same-named warehouse material (if missing), a 1:1
  // recipe, and disable the item's own stock tracking to avoid double counting.
  async function handleQuickLink(item: CatalogItem) {
    setError("");
    setBusyId(item.id);
    const mat = await resolveMaterial(item.name, "قطعة");
    if ("error" in mat) { setBusyId(null); setError(mat.error); return; }
    const r = await addItemRecipe({ catalogItemId: item.id, rawMaterialId: mat.id, quantity: 1, unit: mat.unit });
    if (r.error) { setBusyId(null); setError(r.error); return; }
    if (item.trackStock) await updateCatalogItem(item.id, { trackStock: false });
    setBusyId(null);
    setExpanded((e) => ({ ...e, [item.id]: true }));
    flash(`تم ربط «${item.name}» بمادة مخزون 1:1.`);
  }

  async function handleDisableSelfStock(item: CatalogItem) {
    setBusyId(item.id);
    const r = await updateCatalogItem(item.id, { trackStock: false });
    setBusyId(null);
    if (r.error) { setError(r.error); return; }
    flash("تم إيقاف المخزون الذاتي للصنف.");
  }

  function startEditLine(line: ItemRecipeLine) {
    setError("");
    setEditLineId(line.id);
    setEditQty(String(line.quantity));
    setEditUnit(line.unit);
  }
  function cancelEditLine() { setEditLineId(null); setEditQty(""); setEditUnit(""); }
  async function saveEditLine(id: string) {
    setError("");
    const q = parseFloat(editQty);
    if (!Number.isFinite(q) || q <= 0) { setError("الكمية غير صالحة."); return; }
    setBusyId(id);
    const r = await updateItemRecipe(id, { quantity: q, unit: editUnit.trim() || "قطعة" });
    setBusyId(null);
    if (r.error) { setError(r.error); return; }
    cancelEditLine();
    flash("تم الحفظ.");
  }
  async function handleRemoveLine(line: ItemRecipeLine) {
    const matName = materialById.get(line.rawMaterialId)?.name ?? "المكوّن";
    if (!window.confirm(`حذف ${matName} من وصفة هذا الصنف؟`)) return;
    setBusyId(line.id);
    const r = await removeItemRecipe(line.id);
    setBusyId(null);
    if (r.error) { setError(r.error); return; }
    flash("تم الحذف.");
  }

  return (
    <div className="space-y-4">
      {/* How it works */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-3 flex items-start gap-2">
        <Link2 size={14} className="text-[#F5C100] mt-0.5 shrink-0" />
        <p className="font-mono text-[10px] leading-relaxed text-[#777777]">
          اربط كل صنف مبيع بمكوّناته من المستودع. عند البيع تُخصم المكوّنات تلقائياً، وعند الإلغاء تُعاد.
          للأصناف البسيطة (مي، بسكويت) استخدم «ربط سريع 1:1» — بينشئ مادة مخزون بنفس الاسم ويوقف المخزون الذاتي حتى ما ينعدّ البيع مرتين.
          الكمية لكل وحدة مبيعة وبواحدة المادة في المستودع.
        </p>
      </div>

      {/* Toolbar */}
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex flex-wrap items-center gap-3">
          <Link2 size={14} className="text-[#F5C100]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">{linkedCount} مرتبط من {rows.length === 0 && !query && !onlyUnlinked ? 0 : catalogItems.filter((c) => c.isActive).length}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم" className={`w-44 ${INPUT}`} />
          <button
            onClick={() => setOnlyUnlinked((v) => !v)}
            className={`font-mono text-[10px] px-2.5 py-1 rounded border cursor-pointer transition-colors ${onlyUnlinked ? "text-[#F5C100] border-[#F5C100]/40 bg-[#F5C100]/10" : "text-[#777777] border-[#252525] hover:border-[#555555]"}`}
          >
            غير المرتبطة فقط
          </button>
        </div>

        {error && <p className="px-5 pt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
        {ok && <p className="px-5 pt-2 text-[11px] font-mono text-[#5CC45C]">{ok}</p>}

        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا أصناف</div>
        ) : (
          <div className="divide-y divide-[#252525]/60">
            {rows.map((item) => {
              const lines = byItem.get(item.id) ?? [];
              const linked = lines.length > 0;
              const doubleTrack = linked && item.trackStock;
              const open = expanded[item.id];
              const busy = busyId === item.id;
              const d = draftFor(item.id);
              return (
                <div key={item.id}>
                  {/* Item row */}
                  <div className="flex items-center gap-3 px-5 py-3 hover:bg-[#252525]/20 transition-colors">
                    <button onClick={() => setExpanded((e) => ({ ...e, [item.id]: !open }))} className="text-[#555555] hover:text-[#F5C100] cursor-pointer shrink-0">
                      {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[#F0EDE6]">{item.name}</span>
                        <span className="font-mono text-[9px] text-[#555555]">{CATEGORY_LABELS[item.category]}</span>
                        {linked
                          ? <span className="px-1.5 py-0.5 bg-[#5CC45C]/12 border border-[#5CC45C]/30 rounded text-[9px] font-mono text-[#5CC45C] whitespace-nowrap">{lines.length} مكوّن</span>
                          : <span className="px-1.5 py-0.5 bg-[#252525] border border-[#333] rounded text-[9px] font-mono text-[#777777] whitespace-nowrap">غير مرتبط</span>}
                        {doubleTrack && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#FF7A00]/12 border border-[#FF7A00]/30 rounded text-[9px] font-mono text-[#FF7A00] whitespace-nowrap">
                            <AlertTriangle size={9} /> مخزون مزدوج
                          </span>
                        )}
                      </div>
                    </div>
                    {doubleTrack && (
                      <button onClick={() => handleDisableSelfStock(item)} disabled={busy} className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded border border-[#FF7A00]/30 text-[#FF7A00] hover:bg-[#FF7A00]/10 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap" title="أوقف عدّ مخزون الصنف نفسه — اعتمد على المستودع">
                        <PackageX size={11} /> أوقف الذاتي
                      </button>
                    )}
                    {!linked && (
                      <button onClick={() => handleQuickLink(item)} disabled={busy} className="flex items-center gap-1 font-mono text-[10px] px-2.5 py-1 rounded border border-[#F5C100]/40 text-[#F5C100] hover:bg-[#F5C100]/10 transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap" title="إنشاء مادة مخزون بنفس الاسم + وصفة 1:1 + إيقاف المخزون الذاتي">
                        <Zap size={11} /> ربط سريع 1:1
                      </button>
                    )}
                  </div>

                  {/* Expanded editor */}
                  {open && (
                    <div className="px-5 pb-4 bg-[#0F0F0F]">
                      {lines.length > 0 && (
                        <table className="w-full text-xs mb-3">
                          <thead>
                            <tr className="border-b border-[#252525]">
                              {["المادة الأساسية", "الكمية / وحدة مبيعة", "الواحدة", "المخزون الحالي", ""].map((h) => (
                                <th key={h} className="px-3 py-1.5 text-right font-mono text-[9px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#252525]/40">
                            {lines.map((line) => {
                              const mat = materialById.get(line.rawMaterialId);
                              const editing = editLineId === line.id;
                              const low = mat ? mat.lowStockThreshold > 0 && mat.currentQuantity <= mat.lowStockThreshold : false;
                              return (
                                <tr key={line.id}>
                                  <td className="px-3 py-1.5 text-[#F0EDE6]">{mat?.name ?? <span className="text-[#FF3333]">مادة محذوفة</span>}</td>
                                  <td className="px-3 py-1.5">
                                    {editing
                                      ? <input value={editQty} onChange={(e) => setEditQty(e.target.value)} type="number" min="0" step="0.001" className={`${EDIT_INPUT} text-[#F5C100]`} dir="ltr" />
                                      : <span className="font-mono tabular-nums text-[#F5C100]" dir="ltr">{fmtQty(line.quantity)}</span>}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {editing
                                      ? <input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} className={`w-20 ${EDIT_INPUT}`} />
                                      : <span className="font-mono text-[10px] text-[#AAAAAA]">{line.unit}</span>}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono tabular-nums text-[10px] whitespace-nowrap" dir="ltr">
                                    {mat ? <span className={low ? "text-[#FF3333]" : "text-[#5CC45C]"}>{fmtQty(mat.currentQuantity)} {mat.unit}</span> : "—"}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <div className="flex items-center gap-1">
                                      {editing ? (
                                        <>
                                          <button onClick={() => saveEditLine(line.id)} disabled={busyId === line.id} className="text-[#5CC45C] hover:opacity-80 cursor-pointer disabled:opacity-40"><Check size={13} /></button>
                                          <button onClick={cancelEditLine} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={13} /></button>
                                        </>
                                      ) : (
                                        <>
                                          <button onClick={() => startEditLine(line)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"><Edit2 size={11} /></button>
                                          <button onClick={() => handleRemoveLine(line)} className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"><Trash2 size={11} /></button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}

                      {/* Add component (with inline material create) */}
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          list="rm-list"
                          value={d.name}
                          onChange={(e) => {
                            const name = e.target.value;
                            const m = rawMaterials.find((x) => x.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
                            setDraft(item.id, m ? { name, unit: m.unit } : { name });
                          }}
                          placeholder="المادة الأساسية (اختر أو اكتب جديد)"
                          className={`flex-1 min-w-[200px] ${INPUT}`}
                        />
                        <input value={d.quantity} onChange={(e) => setDraft(item.id, { quantity: e.target.value })} placeholder="الكمية لكل وحدة" type="number" min="0" step="0.001" className={`w-36 ${INPUT}`} dir="ltr" />
                        <input value={d.unit} onChange={(e) => setDraft(item.id, { unit: e.target.value })} placeholder="الواحدة" className={`w-24 ${INPUT}`} />
                        <input value={d.notes} onChange={(e) => setDraft(item.id, { notes: e.target.value })} placeholder="ملاحظات (اختياري)" className={`flex-1 min-w-[120px] ${INPUT}`} />
                        <button onClick={() => handleAddComponent(item)} disabled={busy} className={BTN_ADD}><Plus size={12} />إضافة مكوّن</button>
                      </div>
                      <p className="mt-1.5 font-mono text-[9px] text-[#555555]">إذا كتبت اسم مادة غير موجودة، رح تنضاف للمستودع تلقائياً بكمية صفر.</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Shared datalist of existing materials for the add-component inputs */}
      <datalist id="rm-list">
        {rawMaterials.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.name} />)}
      </datalist>
    </div>
  );
}
