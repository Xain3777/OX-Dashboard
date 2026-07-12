"use client";

// "تقرير الأرباح" — manager profit ledger for everything sold (not
// subscriptions / InBody — those have their own reports). Groups item_sales
// into three sections and shows, per item and per section:
//   الكمية المباعة · التكلفة · البيع (الإجمالي) · الربح
// in BOTH SYP and USD, for a selectable period (today / month / all-time).
//
// Cost basis (0073): each sale row's cost_price_snapshot (taken at sale time)
// wins; rows without one (legacy, or cost entered after the sale) fall back to
// the current catalog cost_price. Unknown everywhere → cost 0, i.e. profit
// shows the full sale until the cost is entered (see the orange checklist).
// Read-only except the inline missing-cost editor.

import { useEffect, useMemo, useState } from "react";
import { Receipt, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { useCurrency } from "@/lib/currency-context";
import { useAuth } from "@/lib/auth-context";
import { persistCatalogItemUpdate } from "@/lib/supabase/intake";
import { formatDate, businessDayStartUTC } from "@/lib/utils/time";

type Currency = "syp" | "usd";
type Period = "today" | "week" | "month" | "all";

type SaleRow = {
  catalog_item_id: string | null;
  item_name_snapshot: string | null;
  category_snapshot: string | null;
  source: string | null;
  quantity: number | null;
  amount_usd: number | null;
  amount_syp: number | null;
  cost_price_snapshot: number | null;
  cost_currency_snapshot: Currency | null;
};
type CatalogRow = {
  id: string; name: string; category: string | null;
  cost_price: number | null; cost_currency: Currency | null;
  sell_price: number | null; sell_currency: Currency | null;
  stock_quantity: number | null; track_stock: boolean | null; is_active: boolean | null;
  updated_at: string | null;
};

type Agg = { name: string; catId: string | null; qty: number; costUSD: number; costSYP: number; revUSD: number; revSYP: number };
type Totals = { qty: number; costUSD: number; costSYP: number; revUSD: number; revSYP: number };

const SECTIONS = [
  { key: "kitchen",     label: "المطبخ",                             short: "المطبخ" },
  { key: "supplements", label: "مكملات / بروتين",                    short: "المكملات" },
  { key: "other",       label: "أصناف أخرى (مياه، كوكيز، إكسسوار…)", short: "المتجر" },
] as const;

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "week",  label: "الأسبوع" },
  { key: "month", label: "هذا الشهر" },
  { key: "all",   label: "الكل" },
];

function periodStartISO(p: Period): string | null {
  if (p === "all") return null;
  // "اليوم" = the business day (6 AM → 6 AM Damascus), matching the KPI strip
  // and cash sessions — NOT local midnight, so after-midnight sales stay on
  // the same working day here too.
  if (p === "today") return businessDayStartUTC();
  const d = new Date();
  if (p === "week") d.setDate(d.getDate() - 6);   // last 7 days, including today
  else if (p === "month") d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
const toUSD = (a: number, c: Currency, r: number) => (c === "usd" ? a : r > 0 ? a / r : 0);
const toSYP = (a: number, c: Currency, r: number) => (c === "syp" ? a : a * r);
const fmtSYP = (n: number) => `${Math.round(n).toLocaleString("en-US")} ل.س`;
const fmtUSD = (n: number) => `$${n.toFixed(2)}`;

function sectionOf(source: string | null, category: string | null): "kitchen" | "supplements" | "other" {
  if (source === "kitchen") return "kitchen";
  if (category === "supplements") return "supplements";
  return "other";
}

const ZERO: Totals = { qty: 0, costUSD: 0, costSYP: 0, revUSD: 0, revSYP: 0 };
const add = (t: Totals, i: Agg | Totals): Totals => ({
  qty: t.qty + i.qty,
  costUSD: t.costUSD + i.costUSD, costSYP: t.costSYP + i.costSYP,
  revUSD: t.revUSD + i.revUSD, revSYP: t.revSYP + i.revSYP,
});

function Money({ syp, usd, accent }: { syp: number; usd: number; accent?: string }) {
  return (
    <div className="leading-tight">
      <div className={`font-mono tabular-nums ${accent ?? "text-[#F0EDE6]"}`} dir="ltr">{fmtSYP(syp)}</div>
      <div className="font-mono tabular-nums text-[10px] text-[#666666]" dir="ltr">{fmtUSD(usd)}</div>
    </div>
  );
}

function ProfitBox({ label, syp, usd, highlight }: { label: string; syp: number; usd: number; highlight?: boolean }) {
  return (
    <div className={`rounded-sm px-4 py-3 flex flex-col gap-1 border ${highlight ? "bg-[#F5C100]/10 border-[#F5C100]/40" : "bg-[#111111] border-[#252525]"}`}>
      <span className="font-mono text-[9px] uppercase tracking-widest text-[#777777]">{label}</span>
      <span className={`font-display text-lg leading-none tabular-nums ${highlight ? "text-[#F5C100]" : "text-[#5CC45C]"}`} dir="ltr">{fmtSYP(syp)}</span>
      <span className="font-mono text-[10px] tabular-nums text-[#666666]" dir="ltr">{fmtUSD(usd)}</span>
    </div>
  );
}

function SummaryTile({ label, syp, usd, accent }: { label: string; syp: number; usd: number; accent: string }) {
  return (
    <div className="bg-[#111111] px-4 py-3 flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">{label}</span>
      <span className="font-mono text-sm tabular-nums" style={{ color: accent }} dir="ltr">{fmtSYP(syp)}</span>
      <span className="font-mono text-[10px] tabular-nums text-[#666666]" dir="ltr">{fmtUSD(usd)}</span>
    </div>
  );
}

export default function ProfitReportBlock() {
  const { exchangeRate } = useCurrency();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("today");
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Inline cost entry for the missing-cost checklist.
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  const [costCur, setCostCur] = useState<Record<string, Currency>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const saveCost = async (c: CatalogRow) => {
    if (!user) return;
    const raw = (costDraft[c.id] ?? "").trim();
    const num = Number(raw);
    if (!raw || !Number.isFinite(num) || num < 0) return;
    const cur = costCur[c.id] ?? (c.sell_currency ?? "syp");
    setSavingId(c.id);
    // Manager-only write (RLS). The catalog realtime channel reloads the list,
    // so the item drops off once its cost is locked in.
    await persistCatalogItemUpdate({
      user: { id: user.id, displayName: user.displayName },
      id: c.id,
      fields: { costPrice: num, costCurrency: cur },
    });
    setSavingId(null);
    setCostDraft((p) => { const n = { ...p }; delete n[c.id]; return n; });
  };

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function load() {
      setLoading(true);
      const start = periodStartISO(period);
      // Paged — "الكل" (and busy months) exceed Supabase's silent 1000-row
      // cap; without paging the report undercounts without any error.
      const [salesRes, catRes] = await Promise.all([
        fetchAllRows<SaleRow>((from, to) => {
          let q = supabase
            .from("item_sales")
            .select("catalog_item_id, item_name_snapshot, category_snapshot, source, quantity, amount_usd, amount_syp, cost_price_snapshot, cost_currency_snapshot")
            .is("cancelled_at", null);
          if (start) q = q.gte("created_at", start);
          return q.order("created_at", { ascending: true }).range(from, to);
        }),
        fetchAllRows<CatalogRow>((from, to) =>
          supabase
            .from("catalog_items")
            .select("id, name, category, cost_price, cost_currency, sell_price, sell_currency, stock_quantity, track_stock, is_active, updated_at")
            .order("created_at", { ascending: true })
            .range(from, to)),
      ]);
      if (cancelled) return;
      setSales(salesRes.data);
      setCatalog(catRes.data);
      setLoading(false);
    }
    void load();
    // Debounce realtime refetches — a multi-line kitchen order fires one
    // event per row; coalesce the burst into a single reload.
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { if (!cancelled) void load(); }, 700);
    };
    const ch = supabase
      .channel("profit-report")
      .on("postgres_changes", { event: "*", schema: "public", table: "item_sales" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_items" }, scheduleReload)
      .subscribe();
    return () => { cancelled = true; if (reloadTimer) clearTimeout(reloadTimer); void supabase.removeChannel(ch); };
  }, [period]);

  const { sections, grand, stockById, updatedById, missingCost } = useMemo(() => {
    const costUSD = new Map<string, number>();
    const costSYP = new Map<string, number>();
    const stockById = new Map<string, number>();
    const updatedById = new Map<string, string>();
    const missingCost: CatalogRow[] = [];
    for (const c of catalog) {
      if (c.cost_price != null && c.cost_currency) {
        costUSD.set(c.id, toUSD(Number(c.cost_price), c.cost_currency, exchangeRate));
        costSYP.set(c.id, toSYP(Number(c.cost_price), c.cost_currency, exchangeRate));
      } else if (c.is_active !== false) {
        missingCost.push(c);
      }
      if (c.stock_quantity != null) stockById.set(c.id, Number(c.stock_quantity));
      if (c.updated_at) updatedById.set(c.id, c.updated_at);
    }
    missingCost.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name, "ar"));

    const buckets: Record<string, Map<string, Agg>> = { kitchen: new Map(), supplements: new Map(), other: new Map() };
    for (const s of sales) {
      const sec = sectionOf(s.source, s.category_snapshot);
      const name = String(s.item_name_snapshot ?? "—");
      const qty = Number(s.quantity ?? 0);
      const catId = s.catalog_item_id ?? null;
      // Cost basis: the sale-time snapshot wins; fall back to the current
      // catalog cost for legacy rows / costs entered after the sale.
      let cu: number;
      let cs: number;
      if (s.cost_price_snapshot != null && Number.isFinite(Number(s.cost_price_snapshot))) {
        const snapPrice = Number(s.cost_price_snapshot);
        const snapCur: Currency = s.cost_currency_snapshot === "syp" ? "syp" : "usd";
        cu = toUSD(snapPrice, snapCur, exchangeRate);
        cs = toSYP(snapPrice, snapCur, exchangeRate);
      } else {
        cu = catId ? (costUSD.get(catId) ?? 0) : 0;
        cs = catId ? (costSYP.get(catId) ?? 0) : 0;
      }
      const m = buckets[sec];
      const cur = m.get(name) ?? { name, catId, qty: 0, costUSD: 0, costSYP: 0, revUSD: 0, revSYP: 0 };
      if (!cur.catId && catId) cur.catId = catId;
      cur.qty += qty;
      cur.costUSD += cu * qty;
      cur.costSYP += cs * qty;
      cur.revUSD += Number(s.amount_usd ?? 0);
      cur.revSYP += Number(s.amount_syp ?? 0);
      m.set(name, cur);
    }
    const sections = SECTIONS.map((sec) => {
      const items = Array.from(buckets[sec.key].values()).sort((a, b) => b.revSYP - a.revSYP);
      const subtotal = items.reduce<Totals>(add, ZERO);
      return { ...sec, items, subtotal };
    });
    const grand = sections.reduce<Totals>((t, s) => add(t, s.subtotal), ZERO);
    return { sections, grand, stockById, updatedById, missingCost };
  }, [sales, catalog, exchangeRate]);

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider rounded-sm border transition-colors cursor-pointer ${
              period === p.key
                ? "bg-[#F5C100]/15 border-[#F5C100]/40 text-[#F5C100]"
                : "bg-[#111111] border-[#252525] text-[#777777] hover:text-[#F0EDE6]"
            }`}
          >
            {p.label}
          </button>
        ))}
        {loading && <span className="font-mono text-[10px] text-[#555555]">جاري التحميل…</span>}
      </div>

      {/* Missing cost-price checklist — these items' profit shows as full sale price */}
      {missingCost.length > 0 && (
        <div className="bg-[#FF7A00]/5 border border-[#FF7A00]/30 rounded-sm overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[#FF7A00]/20">
            <AlertTriangle size={14} className="text-[#FF7A00]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#FF9A4A]">
              أصناف بدون سعر تكلفة — {missingCost.length} (ربحها يظهر كامل البيع حتى تُدخل التكلفة)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#111111] text-[10px] font-mono uppercase tracking-widest text-[#555555]">
                <tr>
                  <th className="px-4 py-2 text-right">الصنف</th>
                  <th className="px-4 py-2 text-right">الفئة</th>
                  <th className="px-4 py-2 text-right">سعر البيع</th>
                  <th className="px-4 py-2 text-right">المخزون</th>
                  <th className="px-4 py-2 text-right">سعر التكلفة — أدخله ليُحفظ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#252525]/60">
                {missingCost.map((c) => (
                  <tr key={c.id} className="hover:bg-[#252525]/30">
                    <td className="px-4 py-2 text-[#F0EDE6]">{c.name}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-[#777777]">{c.category ?? "—"}</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]" dir="ltr">
                      {c.sell_price != null
                        ? (c.sell_currency === "usd"
                            ? `$${Number(c.sell_price).toFixed(2)}`
                            : `${Math.round(Number(c.sell_price)).toLocaleString("en-US")} ل.س`)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">
                      {c.stock_quantity != null ? Number(c.stock_quantity).toLocaleString("en-US") : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min="0" step="any"
                          value={costDraft[c.id] ?? ""}
                          onChange={(e) => setCostDraft((p) => ({ ...p, [c.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") void saveCost(c); }}
                          placeholder="التكلفة"
                          className="w-20 bg-[#0A0A0A] border border-[#FF7A00]/30 rounded px-1.5 py-0.5 font-mono text-xs text-[#F0EDE6] tabular-nums focus:outline-none focus:border-[#FF7A00]"
                          dir="ltr"
                        />
                        <select
                          value={costCur[c.id] ?? (c.sell_currency ?? "syp")}
                          onChange={(e) => setCostCur((p) => ({ ...p, [c.id]: e.target.value as Currency }))}
                          className="bg-[#0A0A0A] border border-[#252525] rounded px-1 py-0.5 font-mono text-[10px] text-[#AAAAAA] cursor-pointer"
                        >
                          <option value="syp">ل.س</option>
                          <option value="usd">$</option>
                        </select>
                        <button
                          onClick={() => void saveCost(c)}
                          disabled={savingId === c.id || !(costDraft[c.id] ?? "").trim()}
                          className="px-2.5 py-0.5 bg-[#FF7A00]/15 hover:bg-[#FF7A00]/25 border border-[#FF7A00]/40 text-[#FF9A4A] font-mono text-[10px] rounded cursor-pointer disabled:opacity-40 transition-colors"
                        >
                          {savingId === c.id ? "…" : "حفظ"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-2 font-mono text-[9px] text-[#777777]">حدّث سعر التكلفة من قسم «المتجر» أو «المطبخ» ليصبح الربح دقيقاً.</p>
        </div>
      )}

      {/* Pure profit per section — the "actual money" boxes */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-2">صافي الربح — المال الفعلي</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {sections.map((sec) => (
            <ProfitBox
              key={sec.key}
              label={`ربح ${sec.short}`}
              syp={sec.subtotal.revSYP - sec.subtotal.costSYP}
              usd={sec.subtotal.revUSD - sec.subtotal.costUSD}
            />
          ))}
          <ProfitBox
            label="إجمالي الربح"
            syp={grand.revSYP - grand.costSYP}
            usd={grand.revUSD - grand.costUSD}
            highlight
          />
        </div>
      </div>

      {/* Grand totals (sell / cost / profit / pieces) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#252525] border border-[#252525] rounded-sm overflow-hidden">
        <SummaryTile label="إجمالي البيع" syp={grand.revSYP}  usd={grand.revUSD}  accent="#5CC45C" />
        <SummaryTile label="إجمالي التكلفة" syp={grand.costSYP} usd={grand.costUSD} accent="#FF7A00" />
        <SummaryTile label="إجمالي الربح" syp={grand.revSYP - grand.costSYP} usd={grand.revUSD - grand.costUSD} accent="#F5C100" />
        <div className="bg-[#111111] px-4 py-3 flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">عدد القطع المباعة</span>
          <span className="font-mono text-sm tabular-nums text-[#F0EDE6]" dir="ltr">{grand.qty.toLocaleString("en-US")}</span>
        </div>
      </div>

      {/* Per-section tables */}
      {sections.map((sec) => (
        <div key={sec.key} className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111]">
            <div className="flex items-center gap-2.5">
              <Receipt size={13} className="text-[#F5C100]" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#999999]">{sec.label}</p>
              <span className="font-mono text-[10px] text-[#555555]">{sec.items.length} صنف · {sec.subtotal.qty} قطعة</span>
            </div>
            <div className="text-left">
              <div className="font-mono text-xs tabular-nums text-[#F5C100]" dir="ltr">
                ربح {fmtSYP(sec.subtotal.revSYP - sec.subtotal.costSYP)} / {fmtUSD(sec.subtotal.revUSD - sec.subtotal.costUSD)}
              </div>
            </div>
          </div>
          {sec.items.length === 0 ? (
            <p className="px-5 py-5 text-center font-mono text-[10px] text-[#555555]">لا توجد مبيعات في هذه الفترة</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#111111] text-[10px] font-mono uppercase tracking-widest text-[#555555]">
                  <tr>
                    <th className="px-4 py-2 text-right">الصنف</th>
                    <th className="px-4 py-2 text-right">مُباع</th>
                    <th className="px-4 py-2 text-right">المخزون</th>
                    <th className="px-4 py-2 text-right">آخر إدخال</th>
                    <th className="px-4 py-2 text-right">التكلفة</th>
                    <th className="px-4 py-2 text-right">البيع (الإجمالي)</th>
                    <th className="px-4 py-2 text-right">الربح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#252525]/60">
                  {sec.items.map((i) => {
                    const profitSYP = i.revSYP - i.costSYP;
                    const profitUSD = i.revUSD - i.costUSD;
                    return (
                      <tr key={i.name} className="hover:bg-[#252525]/30">
                        <td className="px-4 py-2 text-[#F0EDE6]">{i.name}</td>
                        <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]" dir="ltr">{i.qty.toLocaleString("en-US")}</td>
                        <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]" dir="ltr">
                          {i.catId && stockById.has(i.catId) ? stockById.get(i.catId)!.toLocaleString("en-US") : "—"}
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums text-[#777777]" dir="ltr">
                          {i.catId && updatedById.has(i.catId) ? formatDate(updatedById.get(i.catId)!) : "—"}
                        </td>
                        <td className="px-4 py-2"><Money syp={i.costSYP} usd={i.costUSD} accent="text-[#FF7A00]" /></td>
                        <td className="px-4 py-2"><Money syp={i.revSYP}  usd={i.revUSD}  accent="text-[#5CC45C]" /></td>
                        <td className="px-4 py-2"><Money syp={profitSYP} usd={profitUSD} accent={profitSYP >= 0 ? "text-[#F5C100]" : "text-[#FF3333]"} /></td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#111111] font-semibold border-t border-[#252525]">
                    <td className="px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-[#777777]">الإجمالي</td>
                    <td className="px-4 py-2 font-mono tabular-nums text-[#F0EDE6]" dir="ltr">{sec.subtotal.qty.toLocaleString("en-US")}</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2"><Money syp={sec.subtotal.costSYP} usd={sec.subtotal.costUSD} accent="text-[#FF7A00]" /></td>
                    <td className="px-4 py-2"><Money syp={sec.subtotal.revSYP}  usd={sec.subtotal.revUSD}  accent="text-[#5CC45C]" /></td>
                    <td className="px-4 py-2"><Money syp={sec.subtotal.revSYP - sec.subtotal.costSYP} usd={sec.subtotal.revUSD - sec.subtotal.costUSD} accent="text-[#F5C100]" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
