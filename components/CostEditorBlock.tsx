"use client";

import { useMemo, useState } from "react";
import { DollarSign, AlertTriangle, Check } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { CatalogItem, Currency } from "@/lib/types";

// Cost-price editor for a reception account that has the per-user cost unlock
// (auth `canEditCost`). Lists every active sellable item and lets the user set
// its cost price. Writes go through the store's updateCatalogItem, which only
// sends the cost columns — allowed by the migration-0068 trigger for
// can_edit_cost users. Managers use the fuller editors instead.

const INPUT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-1.5 text-xs text-[#F0EDE6] placeholder-[#555555] focus:outline-none focus:border-[#F5C100]/40";
const SELECT = "bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1.5 text-xs text-[#AAAAAA] focus:outline-none focus:border-[#F5C100]/40";

function sellLabel(c: CatalogItem): string {
  if (!(c.sellPrice > 0)) return "—";
  return c.sellCurrency === "syp"
    ? `${Math.round(c.sellPrice).toLocaleString("en-US")} ل.س`
    : `$${Number(c.sellPrice).toFixed(2)}`;
}

export default function CostEditorBlock() {
  const { catalogItems, updateCatalogItem } = useStore();

  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [cur, setCur] = useState<Record<string, Currency>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const missingCount = useMemo(() => catalogItems.filter((c) => c.isActive && c.costPrice == null).length, [catalogItems]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return catalogItems
      .filter((c) => c.isActive)
      .filter((c) => (onlyMissing ? c.costPrice == null : true))
      .filter((c) => (q ? c.name.toLocaleLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [catalogItems, onlyMissing, query]);

  async function save(c: CatalogItem) {
    setError("");
    const raw = (draft[c.id] ?? "").trim();
    if (!raw) { setError("أدخل قيمة التكلفة."); return; }
    const num = parseFloat(raw);
    if (!Number.isFinite(num) || num < 0) { setError("التكلفة غير صالحة."); return; }
    const currency = cur[c.id] ?? c.sellCurrency ?? "usd";
    setSavingId(c.id);
    const r = await updateCatalogItem(c.id, { costPrice: num, costCurrency: currency });
    setSavingId(null);
    if (r.error) { setError(r.error); return; }
    setDraft((p) => { const n = { ...p }; delete n[c.id]; return n; });
    setOk(`تم حفظ تكلفة ${c.name}.`);
    setTimeout(() => setOk(""), 2000);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-[#252525] bg-[#111111] flex flex-wrap items-center gap-3">
        <DollarSign size={14} className="text-[#F5C100]" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">{catalogItems.filter((c) => c.isActive).length} صنف</span>
        {missingCount > 0 && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-[#FF7A00]/12 border border-[#FF7A00]/30 rounded text-[10px] font-mono text-[#FF7A00]">
            <AlertTriangle size={10} /> {missingCount} بدون تكلفة
          </span>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم" className={`w-44 ${INPUT}`} />
        <button
          onClick={() => setOnlyMissing((v) => !v)}
          className={`font-mono text-[10px] px-2.5 py-1 rounded border cursor-pointer transition-colors ${onlyMissing ? "text-[#FF7A00] border-[#FF7A00]/40 bg-[#FF7A00]/10" : "text-[#777777] border-[#252525] hover:border-[#555555]"}`}
        >
          الناقص فقط
        </button>
      </div>

      {error && <p className="px-5 pt-2 text-[11px] font-mono text-[#FF3333]">{error}</p>}
      {ok && <p className="px-5 pt-2 text-[11px] font-mono text-[#5CC45C]">{ok}</p>}

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا توجد أصناف</div>
      ) : (
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="border-b border-[#252525] bg-[#111111]">
                {["الصنف", "سعر البيع", "التكلفة الحالية", "تعديل التكلفة", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#252525]/60">
              {rows.map((c) => {
                const missing = c.costPrice == null;
                return (
                  <tr key={c.id} className={`transition-colors ${missing ? "bg-[#FF7A00]/5" : "hover:bg-[#252525]/20"}`}>
                    <td className="px-4 py-2.5 text-[#F0EDE6]">
                      <div className="flex items-center gap-2">
                        {c.name}
                        {missing && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#FF7A00]/15 border border-[#FF7A00]/40 rounded text-[9px] font-mono text-[#FF7A00] whitespace-nowrap"><AlertTriangle size={9} /> بدون تكلفة</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA] whitespace-nowrap" dir="ltr">{sellLabel(c)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777] whitespace-nowrap" dir="ltr">
                      {c.costPrice == null ? "—" : (c.costCurrency === "syp" ? `${Math.round(c.costPrice).toLocaleString("en-US")} ل.س` : `$${Number(c.costPrice).toFixed(2)}`)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min="0" step="any" dir="ltr"
                          value={draft[c.id] ?? ""}
                          onChange={(e) => setDraft((p) => ({ ...p, [c.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") void save(c); }}
                          placeholder="التكلفة"
                          className={`w-24 ${INPUT}`}
                        />
                        <select value={cur[c.id] ?? c.sellCurrency ?? "usd"} onChange={(e) => setCur((p) => ({ ...p, [c.id]: e.target.value as Currency }))} className={SELECT}>
                          <option value="usd">$</option>
                          <option value="syp">ل.س</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => void save(c)}
                        disabled={savingId === c.id || !(draft[c.id] ?? "").trim()}
                        className="flex items-center gap-1 px-3 py-1 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-[11px] tracking-widest uppercase rounded-sm cursor-pointer disabled:opacity-40 transition-colors"
                      >
                        <Check size={12} /> {savingId === c.id ? "…" : "حفظ"}
                      </button>
                    </td>
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
