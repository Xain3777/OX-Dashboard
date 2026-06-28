"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, TrendingUp, Boxes, BarChart3, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { recipeUnitCost, convertCurrency } from "@/lib/inventory";
import { fetchItemSalesRange, type ItemSaleRangeRow } from "@/lib/supabase/intake";
import type { Currency } from "@/lib/types";

// Manager inventory reports — all read-only:
//   1. reorder list (materials at/below threshold)
//   2. warehouse value (qty × last purchase price)
//   3. profit per recipe item (sell − recipe cost)
//   4. consumption over a month (materials used, from sales × recipes)
// Cards 1–3 derive synchronously from store state; the consumption report
// fetches sales for a chosen month on demand.

function money(n: number, cur: Currency): string {
  return cur === "syp" ? `${Math.round(n).toLocaleString("en-US")} ل.س` : `$${n.toFixed(2)}`;
}
function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

const CARD = "bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden";
const CARD_HEAD = "px-5 py-3 border-b border-[#252525] bg-[#111111] flex items-center gap-2";
const TH = "px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap";

export default function InventoryReports() {
  const { rawMaterials, itemRecipes, catalogItems, exchangeRate } = useStore();

  // ── 1. Reorder list ──
  const reorder = useMemo(
    () => rawMaterials
      .filter((m) => m.isActive && m.lowStockThreshold > 0 && m.currentQuantity <= m.lowStockThreshold)
      .sort((a, b) => (a.currentQuantity - a.lowStockThreshold) - (b.currentQuantity - b.lowStockThreshold)),
    [rawMaterials],
  );

  // ── 2. Warehouse value ──
  const value = useMemo(() => {
    const perCur: Record<Currency, number> = { syp: 0, usd: 0 };
    let missing = 0;
    for (const m of rawMaterials) {
      if (!m.isActive) continue;
      if (m.lastPurchasePrice == null) { if (m.currentQuantity !== 0) missing++; continue; }
      const cur = (m.costCurrency ?? "usd") as Currency;
      perCur[cur] += m.currentQuantity * m.lastPurchasePrice;
    }
    const totalUsd = perCur.usd + convertCurrency(perCur.syp, "syp", "usd", exchangeRate);
    return { perCur, totalUsd, missing };
  }, [rawMaterials, exchangeRate]);

  // ── 3. Profit per recipe item ──
  const profit = useMemo(() => {
    return catalogItems
      .filter((c) => c.isActive && itemRecipes.some((r) => r.catalogItemId === c.id))
      .map((c) => {
        const cur = c.sellCurrency;
        const { cost, hasMissingPrice } = recipeUnitCost(c.id, rawMaterials, itemRecipes, cur, exchangeRate);
        const sell = Number(c.sellPrice);
        const margin = sell - cost;
        const pct = sell > 0 ? Math.round((margin / sell) * 100) : 0;
        return { id: c.id, name: c.name, cur, sell, cost, margin, pct, hasMissingPrice };
      })
      .sort((a, b) => a.pct - b.pct);
  }, [catalogItems, itemRecipes, rawMaterials, exchangeRate]);

  // ── 4. Consumption over a month (on-demand fetch) ──
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [salesRows, setSalesRows] = useState<ItemSaleRangeRow[] | null>(null);

  async function loadConsumption() {
    setLoadErr("");
    setLoading(true);
    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const end = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month
    const r = await fetchItemSalesRange({ start, end });
    setLoading(false);
    if (r.error || !r.data) { setLoadErr(r.error ?? "تعذّر تحميل المبيعات"); return; }
    setSalesRows(r.data);
  }

  const consumption = useMemo(() => {
    if (!salesRows) return null;
    const used = new Map<string, number>();
    for (const row of salesRows) {
      if (!row.catalog_item_id) continue;
      const lines = itemRecipes.filter((r) => r.catalogItemId === row.catalog_item_id);
      for (const line of lines) {
        used.set(line.rawMaterialId, (used.get(line.rawMaterialId) ?? 0) + line.quantity * Number(row.quantity ?? 0));
      }
    }
    const rows = [...used.entries()].map(([matId, qty]) => {
      const mat = rawMaterials.find((m) => m.id === matId);
      const cur = (mat?.costCurrency ?? "usd") as Currency;
      const cost = mat?.lastPurchasePrice != null ? mat.lastPurchasePrice * qty : null;
      return { matId, name: mat?.name ?? "مادة محذوفة", unit: mat?.unit ?? "", qty, cur, cost };
    }).sort((a, b) => b.qty - a.qty);
    const costUsd = rows.reduce((s, r) => s + (r.cost != null ? convertCurrency(r.cost, r.cur, "usd", exchangeRate) : 0), 0);
    return { rows, costUsd };
  }, [salesRows, itemRecipes, rawMaterials, exchangeRate]);

  return (
    <div className="space-y-4">
      {/* 1. Reorder list */}
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <AlertTriangle size={13} className="text-[#FF3333]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">قائمة إعادة الطلب ({reorder.length})</span>
        </div>
        {reorder.length === 0 ? (
          <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا مواد تحت حد التنبيه</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-[#252525] bg-[#111111]">{["المادة", "المتبقي", "حد التنبيه", "النقص", "آخر سعر شراء"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#252525]/60">
                {reorder.map((m) => (
                  <tr key={m.id} className="bg-[#FF3333]/5">
                    <td className="px-4 py-2 text-[#F0EDE6]">{m.name}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#FF3333]" dir="ltr">{fmtQty(m.currentQuantity)} {m.unit}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">{fmtQty(m.lowStockThreshold)}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#FF7A00]" dir="ltr">{fmtQty(Math.max(0, m.lowStockThreshold - m.currentQuantity))}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">{m.lastPurchasePrice == null ? "—" : money(m.lastPurchasePrice, (m.costCurrency ?? "usd") as Currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2. Warehouse value */}
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <Boxes size={13} className="text-[#F5C100]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">قيمة المخزون</span>
        </div>
        <div className="px-5 py-4 flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">بالليرة</span>
            <span className="font-mono tabular-nums text-base text-[#5CC45C]" dir="ltr">{money(value.perCur.syp, "syp")}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">بالدولار</span>
            <span className="font-mono tabular-nums text-base text-[#F5C100]" dir="ltr">{money(value.perCur.usd, "usd")}</span>
          </div>
          <div className="flex flex-col gap-1 border-r border-[#252525] pr-6">
            <span className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">الإجمالي (تقريبي $)</span>
            <span className="font-mono tabular-nums text-base text-[#F0EDE6]" dir="ltr">{money(value.totalUsd, "usd")}</span>
          </div>
          {value.missing > 0 && (
            <span className="font-mono text-[10px] text-[#FF7A00]">{value.missing} مادة بلا سعر شراء — غير محتسبة</span>
          )}
        </div>
      </div>

      {/* 3. Profit per recipe item */}
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <TrendingUp size={13} className="text-[#5CC45C]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">ربح الأصناف المرتبطة بوصفة ({profit.length})</span>
        </div>
        {profit.length === 0 ? (
          <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا أصناف مرتبطة بوصفات</div>
        ) : (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0"><tr className="border-b border-[#252525] bg-[#111111]">{["الصنف", "سعر البيع", "تكلفة الوصفة", "الربح", "الهامش"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#252525]/60">
                {profit.map((p) => {
                  const cls = p.pct >= 40 ? "text-[#5CC45C]" : p.pct >= 20 ? "text-[#F5C100]" : "text-[#FF3333]";
                  return (
                    <tr key={p.id} className="hover:bg-[#252525]/20">
                      <td className="px-4 py-2 text-[#F0EDE6]">
                        {p.name}
                        {p.hasMissingPrice && <span className="mr-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#FF7A00]/12 border border-[#FF7A00]/30 rounded text-[9px] font-mono text-[#FF7A00]"><AlertTriangle size={9} /> تكلفة ناقصة</span>}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums text-[#F0EDE6]" dir="ltr">{money(p.sell, p.cur)}</td>
                      <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">{money(p.cost, p.cur)}</td>
                      <td className={`px-4 py-2 font-mono tabular-nums ${cls}`} dir="ltr">{money(p.margin, p.cur)}</td>
                      <td className={`px-4 py-2 font-mono tabular-nums ${cls}`} dir="ltr">{p.pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Consumption over a month */}
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <BarChart3 size={13} className="text-[#4AA8E8]" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">استهلاك المواد</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mr-auto bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/40" />
          <button onClick={loadConsumption} disabled={loading} className="flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded border border-[#4AA8E8]/40 text-[#4AA8E8] hover:bg-[#4AA8E8]/10 transition-colors cursor-pointer disabled:opacity-40">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> {loading ? "جاري…" : "تحديث"}
          </button>
        </div>
        {loadErr && <p className="px-5 pt-2 text-[11px] font-mono text-[#FF3333]">{loadErr}</p>}
        {consumption == null ? (
          <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">اختر الشهر واضغط «تحديث» لعرض الاستهلاك</div>
        ) : consumption.rows.length === 0 ? (
          <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[#555555]">لا استهلاك مسجّل في هذا الشهر</div>
        ) : (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0"><tr className="border-b border-[#252525] bg-[#111111]">{["المادة", "الكمية المستهلكة", "التكلفة التقديرية"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#252525]/60">
                {consumption.rows.map((r) => (
                  <tr key={r.matId} className="hover:bg-[#252525]/20">
                    <td className="px-4 py-2 text-[#F0EDE6]">{r.name}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#4AA8E8]" dir="ltr">{fmtQty(r.qty)} {r.unit}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">{r.cost == null ? "—" : money(r.cost, r.cur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#252525] bg-[#111111]">
                  <td className="px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي التكلفة (تقريبي $)</td>
                  <td></td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#F5C100]" dir="ltr">{money(consumption.costUsd, "usd")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
