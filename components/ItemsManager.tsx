"use client";

import { useMemo, useState } from "react";
import { Plus, Check, X, Edit2, Trash2, AlertTriangle, Package } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { CatalogItem, CatalogItemCategory, CatalogItemType, Currency } from "@/lib/types";

// Unified manager editor over catalog_items — one place to set cost / sell
// price / category / type / stock-tracking / description for EVERY sellable
// item, including rows reception created without a cost. A "معلومات ناقصة"
// badge flags incomplete rows (no cost, or sell price ≤ 0). Reads/writes go
// through the store's addCatalogItem / updateCatalogItem / removeCatalogItem,
// which already enforce the manager-only column rules (migration 0030).

const CATEGORY_OPTIONS: CatalogItemCategory[] = ["meals", "meal_addons", "drinks", "supplements", "accessories", "other"];
const CATEGORY_LABELS: Record<CatalogItemCategory, string> = {
  meals: "وجبات", meal_addons: "إضافات وجبة", drinks: "مشروبات",
  supplements: "مكملات", accessories: "إكسسوارات", other: "أخرى",
};
const TYPE_OPTIONS: CatalogItemType[] = ["meal", "water", "drink", "supplement", "product", "other"];
const TYPE_LABELS: Record<CatalogItemType, string> = {
  meal: "وجبة", water: "ماء", drink: "مشروب", supplement: "مكمل", product: "منتج", other: "أخرى",
};

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";
const BTN_ADD = "flex items-center gap-1.5 px-4 py-1.5 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-xs tracking-widest uppercase rounded-sm transition-colors cursor-pointer disabled:opacity-50";
const EDIT_INPUT = "w-20 bg-[#0A0A0A] border border-[#F5C100]/40 rounded-sm px-2 py-0.5 text-xs text-[#F0EDE6] focus:outline-none";

function money(amount: number, currency: Currency): string {
  return currency === "syp"
    ? `${Math.round(amount).toLocaleString("en-US")} ل.س`
    : `$${Number(amount).toFixed(2)}`;
}

function isMissingInfo(c: CatalogItem): boolean {
  return c.costPrice == null || !(c.sellPrice > 0);
}

type ItemDraft = {
  name: string;
  category: CatalogItemCategory;
  itemType: CatalogItemType;
  sellCurrency: Currency;
  sellPrice: string;
  costCurrency: Currency;
  costPrice: string;
  trackStock: boolean;
  lowStockThreshold: string;
  description: string;
  isActive: boolean;
};

function toDraft(c: CatalogItem): ItemDraft {
  return {
    name: c.name,
    category: c.category,
    itemType: c.itemType,
    sellCurrency: c.sellCurrency,
    sellPrice: String(c.sellPrice ?? ""),
    costCurrency: c.costCurrency ?? "usd",
    costPrice: c.costPrice == null ? "" : String(c.costPrice),
    trackStock: c.trackStock,
    lowStockThreshold: String(c.lowStockThreshold ?? 3),
    description: c.description ?? "",
    isActive: c.isActive,
  };
}

export default function ItemsManager() {
  const { catalogItems, addCatalogItem, updateCatalogItem, removeCatalogItem } = useStore();

  const [onlyMissing, setOnlyMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const missingCount = useMemo(() => catalogItems.filter(isMissingInfo).length, [catalogItems]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return [...catalogItems]
      .filter((c) => (onlyMissing ? isMissingInfo(c) : true))
      .filter((c) => (q ? c.name.toLocaleLowerCase().includes(q) : true))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  }, [catalogItems, onlyMissing, query]);

  // ── New item form (manager: full fields incl. cost) ──
  const [nNew, setNNew] = useState<ItemDraft>({
    name: "", category: "supplements", itemType: "supplement",
    sellCurrency: "usd", sellPrice: "", costCurrency: "usd", costPrice: "",
    trackStock: false, lowStockThreshold: "3", description: "", isActive: true,
  });
  const [showAdd, setShowAdd] = useState(false);

  function flash(msg: string) { setOk(msg); setTimeout(() => setOk(""), 2000); }

  async function handleAdd() {
    setError("");
    const name = nNew.name.trim();
    if (!name) { setError("أدخل اسم الصنف."); return; }
    const sp = parseFloat(nNew.sellPrice);
    if (!Number.isFinite(sp) || sp < 0) { setError("سعر البيع غير صالح."); return; }
    const cpRaw = nNew.costPrice.trim();
    const cp = cpRaw === "" ? null : parseFloat(cpRaw);
    if (cp != null && (!Number.isFinite(cp) || cp < 0)) { setError("التكلفة غير صالحة."); return; }
    const thr = parseInt(nNew.lowStockThreshold, 10);
    setBusy(true);
    const r = await addCatalogItem({
      name,
      category: nNew.category,
      itemType: nNew.itemType,
      sellCurrency: nNew.sellCurrency,
      sellPrice: sp,
      costCurrency: cp == null ? null : nNew.costCurrency,
      costPrice: cp,
      stockQuantity: 0,
      trackStock: nNew.trackStock,
      lowStockThreshold: Number.isInteger(thr) && thr >= 0 ? thr : 3,
      isActive: nNew.isActive,
      description: nNew.description.trim() || null,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setNNew((p) => ({ ...p, name: "", sellPrice: "", costPrice: "", description: "" }));
    setShowAdd(false);
    flash("تمت الإضافة.");
  }

  function startEdit(c: CatalogItem) {
    setError("");
    setEditId(c.id);
    setDraft(toDraft(c));
  }
  function cancelEdit() { setEditId(null); setDraft(null); }

  async function saveEdit(id: string) {
    if (!draft) return;
    setError("");
    const name = draft.name.trim();
    if (!name) { setError("الاسم مطلوب."); return; }
    const sp = parseFloat(draft.sellPrice);
    if (!Number.isFinite(sp) || sp < 0) { setError("سعر البيع غير صالح."); return; }
    const cpRaw = draft.costPrice.trim();
    const cp = cpRaw === "" ? null : parseFloat(cpRaw);
    if (cp != null && (!Number.isFinite(cp) || cp < 0)) { setError("التكلفة غير صالحة."); return; }
    const thr = parseInt(draft.lowStockThreshold, 10);
    setBusy(true);
    const r = await updateCatalogItem(id, {
      name,
      category: draft.category,
      itemType: draft.itemType,
      sellCurrency: draft.sellCurrency,
      sellPrice: sp,
      costCurrency: cp == null ? null : draft.costCurrency,
      costPrice: cp,
      trackStock: draft.trackStock,
      lowStockThreshold: Number.isInteger(thr) && thr >= 0 ? thr : 3,
      description: draft.description.trim() || null,
      isActive: draft.isActive,
    });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    cancelEdit();
    flash("تم الحفظ.");
  }

  async function handleDelete(c: CatalogItem) {
    if (!window.confirm(`حذف ${c.name}؟`)) return;
    setBusy(true);
    const r = await removeCatalogItem(c.id);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    flash("تم الحذف.");
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex flex-wrap items-center gap-3">
        <Package size={14} className="text-[#F5C100]" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">{catalogItems.length} صنف</span>
        {missingCount > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-[#FF7A00]/12 border border-[#FF7A00]/30 rounded text-[10px] font-mono text-[#FF7A00]">
            <AlertTriangle size={10} /> {missingCount} بمعلومات ناقصة
          </span>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم" className={`w-44 ${INPUT}`} />
        <button
          onClick={() => setOnlyMissing((v) => !v)}
          className={`font-mono text-[10px] px-2.5 py-1 rounded border cursor-pointer transition-colors ${onlyMissing ? "text-[#FF7A00] border-[#FF7A00]/40 bg-[#FF7A00]/10" : "text-[#777777] border-[#252525] hover:border-[#555555]"}`}
        >
          إظهار الناقص فقط
        </button>
        <button onClick={() => { setShowAdd((v) => !v); setError(""); }} className="mr-auto flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded border border-[#F5C100]/30 text-[#F5C100] hover:bg-[#F5C100]/10 transition-colors cursor-pointer">
          {showAdd ? <X size={11} /> : <Plus size={11} />} {showAdd ? "إلغاء" : "إضافة صنف"}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-5 py-4 border-b border-[#252525] bg-[#0F0F0F]">
          <div className="flex flex-wrap items-center gap-2">
            <input value={nNew.name} onChange={(e) => setNNew({ ...nNew, name: e.target.value })} placeholder="اسم الصنف" className={`flex-1 min-w-[160px] ${INPUT}`} />
            <select value={nNew.category} onChange={(e) => setNNew({ ...nNew, category: e.target.value as CatalogItemCategory })} className={SELECT}>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            <select value={nNew.itemType} onChange={(e) => setNNew({ ...nNew, itemType: e.target.value as CatalogItemType })} className={SELECT}>
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <input value={nNew.sellPrice} onChange={(e) => setNNew({ ...nNew, sellPrice: e.target.value })} placeholder="سعر البيع" type="number" min="0" step="0.01" className={`w-28 ${INPUT}`} dir="ltr" />
            <select value={nNew.sellCurrency} onChange={(e) => setNNew({ ...nNew, sellCurrency: e.target.value as Currency })} className={SELECT}>
              <option value="usd">$</option><option value="syp">ل.س</option>
            </select>
            <input value={nNew.costPrice} onChange={(e) => setNNew({ ...nNew, costPrice: e.target.value })} placeholder="التكلفة (اختياري)" type="number" min="0" step="0.01" className={`w-32 ${INPUT}`} dir="ltr" />
            <select value={nNew.costCurrency} onChange={(e) => setNNew({ ...nNew, costCurrency: e.target.value as Currency })} className={SELECT}>
              <option value="usd">$</option><option value="syp">ل.س</option>
            </select>
            <label className="flex items-center gap-1.5 font-mono text-[10px] text-[#AAAAAA] cursor-pointer">
              <input type="checkbox" checked={nNew.trackStock} onChange={(e) => setNNew({ ...nNew, trackStock: e.target.checked })} />
              تتبّع المخزون
            </label>
            <button onClick={handleAdd} disabled={busy} className={BTN_ADD}><Plus size={12} />إضافة</button>
          </div>
        </div>
      )}

      {error && <p className="px-5 pt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
      {ok && <p className="px-5 pt-2 text-[11px] font-mono text-[#5CC45C]">{ok}</p>}

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد أصناف</div>
      ) : (
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="border-b border-[#252525] bg-[#111111]">
                {["الصنف", "الفئة", "النوع", "سعر البيع", "التكلفة", "المخزون", "الحالة", ""].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252525]/60">
              {rows.map((c) => {
                const editing = editId === c.id && draft;
                const missing = isMissingInfo(c);
                return (
                  <tr key={c.id} className={`transition-colors ${missing ? "bg-[#FF7A00]/5 border-r-2 border-r-[#FF7A00]/40" : "hover:bg-[#252525]/20"} ${!c.isActive ? "opacity-50" : ""}`}>
                    {editing ? (
                      <>
                        <td className="px-3 py-2.5">
                          <input value={draft!.name} onChange={(e) => setDraft({ ...draft!, name: e.target.value })} className={`w-40 ${EDIT_INPUT}`} />
                        </td>
                        <td className="px-3 py-2.5">
                          <select value={draft!.category} onChange={(e) => setDraft({ ...draft!, category: e.target.value as CatalogItemCategory })} className={SELECT}>
                            {CATEGORY_OPTIONS.map((x) => <option key={x} value={x}>{CATEGORY_LABELS[x]}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2.5">
                          <select value={draft!.itemType} onChange={(e) => setDraft({ ...draft!, itemType: e.target.value as CatalogItemType })} className={SELECT}>
                            {TYPE_OPTIONS.map((x) => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <input value={draft!.sellPrice} onChange={(e) => setDraft({ ...draft!, sellPrice: e.target.value })} type="number" step="0.01" className={`${EDIT_INPUT} text-[#F5C100]`} dir="ltr" />
                            <select value={draft!.sellCurrency} onChange={(e) => setDraft({ ...draft!, sellCurrency: e.target.value as Currency })} className={SELECT}>
                              <option value="usd">$</option><option value="syp">ل.س</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <input value={draft!.costPrice} onChange={(e) => setDraft({ ...draft!, costPrice: e.target.value })} type="number" step="0.01" placeholder="—" className={`${EDIT_INPUT} text-[#777777]`} dir="ltr" />
                            <select value={draft!.costCurrency} onChange={(e) => setDraft({ ...draft!, costCurrency: e.target.value as Currency })} className={SELECT}>
                              <option value="usd">$</option><option value="syp">ل.س</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <label className="flex items-center gap-1.5 font-mono text-[10px] text-[#AAAAAA] cursor-pointer whitespace-nowrap">
                            <input type="checkbox" checked={draft!.trackStock} onChange={(e) => setDraft({ ...draft!, trackStock: e.target.checked })} />
                            تتبّع
                          </label>
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => setDraft({ ...draft!, isActive: !draft!.isActive })} className={`font-mono text-[10px] px-2 py-0.5 rounded border cursor-pointer ${draft!.isActive ? "text-[#5CC45C] border-[#5CC45C]/30 bg-[#5CC45C]/10" : "text-[#777777] border-[#555555]/30"}`}>
                            {draft!.isActive ? "مفعل" : "متوقف"}
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEdit(c.id)} disabled={busy} className="text-[#5CC45C] hover:opacity-80 cursor-pointer disabled:opacity-40"><Check size={13} /></button>
                            <button onClick={cancelEdit} className="text-[#FF3333] hover:opacity-80 cursor-pointer"><X size={13} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-[#F0EDE6]">
                          <div className="flex items-center gap-2">
                            {c.name}
                            {missing && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#FF7A00]/15 border border-[#FF7A00]/40 rounded text-[9px] font-mono text-[#FF7A00] whitespace-nowrap">
                                <AlertTriangle size={9} /> معلومات ناقصة
                              </span>
                            )}
                          </div>
                          {c.description && <span className="block font-mono text-[9px] text-[#555555] mt-0.5">{c.description}</span>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-[#AAAAAA] whitespace-nowrap">{CATEGORY_LABELS[c.category]}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px] text-[#777777] whitespace-nowrap">{TYPE_LABELS[c.itemType]}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-[#F5C100] whitespace-nowrap" dir="ltr">{c.sellPrice > 0 ? money(c.sellPrice, c.sellCurrency) : "—"}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-[#777777] whitespace-nowrap" dir="ltr">{c.costPrice == null ? "—" : money(c.costPrice, c.costCurrency ?? "usd")}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-[10px] whitespace-nowrap">
                          {c.trackStock
                            ? <span className={c.stockQuantity <= c.lowStockThreshold ? "text-[#FF3333]" : "text-[#5CC45C]"}>{c.stockQuantity}</span>
                            : <span className="text-[#555555]">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`font-mono text-[10px] ${c.isActive ? "text-[#5CC45C]" : "text-[#777777]"}`}>{c.isActive ? "مفعل" : "متوقف"}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEdit(c)} className="p-1 text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"><Edit2 size={11} /></button>
                            <button onClick={() => handleDelete(c)} className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"><Trash2 size={11} /></button>
                          </div>
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
  );
}
