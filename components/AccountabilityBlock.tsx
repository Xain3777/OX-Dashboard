"use client";

// "تدقيق ومحاسبة" — manager-only accountability view.
//
// Four sections, all driven by Supabase reads (no new writes here):
//   1. القيمة الحالية         — current inventory value (sell + cost, USD)
//   2. تقرير الورديات         — per-shift inventory + sales breakdown
//   3. سجل التعديلات          — activity_feed before/after for catalog &
//                                cash session edits
//   4. سجل سعر الدولار        — exchange_rate_history
//
// Reads only — depends on migration 0041 (stock_snapshots + activity_feed
// old_value/new_value).

import { useEffect, useMemo, useState } from "react";
import {
  Boxes, ChevronDown, ChevronUp, Clock, DollarSign,
  History as HistoryIcon, TrendingUp,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCurrency } from "@/lib/currency-context";
import { formatDate, formatTime } from "@/lib/utils/time";

type Currency = "syp" | "usd";

type CatalogRow = {
  id: string;
  name: string;
  category: string | null;
  sell_currency: Currency;
  sell_price: number;
  cost_currency: Currency | null;
  cost_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
};

type SessionRow = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  opened_by_name: string | null;
  closed_by_name: string | null;
};

type SnapshotRow = {
  catalog_item_id: string;
  snapshot_type: "open" | "close";
  item_name_snapshot: string;
  stock_quantity: number;
  sell_price: number;
  sell_currency: Currency;
  cost_price: number | null;
  cost_currency: Currency | null;
  exchange_rate_to_syp: number;
};

type ItemSaleRow = {
  id: string;
  created_at: string;
  created_by_name: string | null;
  item_name_snapshot: string;
  quantity: number;
  unit_price: number;
  original_currency: Currency;
  original_total: number;
  amount_usd: number;
  amount_syp: number;
  catalog_item_id: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
};

type ActivityRow = {
  id: string;
  action: string;
  description: string;
  created_at: string;
  created_by_name: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

type RateRow = {
  id: string;
  rate: number;
  changed_at: string;
  changed_by_name: string | null;
};

const AUDIT_ACTIONS = [
  "catalog_item_create",
  "catalog_item_update",
  "catalog_item_delete",
  "exchange_rate_update",
  "session_opened",
  "session_closed",
  "sales_cancel",
  "item_sales_cancel",
  "gym_subscriptions_cancel",
  "inbody_sessions_cancel",
  "expenses_cancel",
];

const ACTION_LABEL: Record<string, string> = {
  catalog_item_create: "إضافة صنف",
  catalog_item_update: "تعديل صنف",
  catalog_item_delete: "حذف صنف",
  exchange_rate_update: "تغيير سعر الدولار",
  session_opened: "فتح وردية",
  session_closed: "إغلاق وردية",
  sales_cancel: "إلغاء بيع",
  item_sales_cancel: "إلغاء بيع",
  gym_subscriptions_cancel: "إلغاء اشتراك",
  inbody_sessions_cancel: "إلغاء InBody",
  expenses_cancel: "إلغاء مصروف",
};

const FIELD_LABEL: Record<string, string> = {
  name: "الاسم",
  category: "الفئة",
  item_type: "النوع",
  sell_price: "سعر البيع",
  sell_currency: "عملة البيع",
  cost_price: "سعر التكلفة",
  cost_currency: "عملة التكلفة",
  stock_quantity: "المخزون",
  track_stock: "تتبع المخزون",
  low_stock_threshold: "حد التنبيه",
  is_active: "نشط",
  rate: "السعر",
  opening_cash: "الافتتاحي",
  actual_cash: "النقد الفعلي",
  expected_cash: "النقد المتوقع",
  difference: "الفرق",
  status: "الحالة",
};

function fmtMoney(n: number, currency: Currency): string {
  if (currency === "syp") return `${Math.round(n).toLocaleString("en-US")} ل.س`;
  return `$${Number(n).toFixed(2)}`;
}

function toUSD(amount: number, currency: Currency, rate: number): number {
  if (currency === "usd") return amount;
  return rate > 0 ? amount / rate : 0;
}

// ─── Section 1: current inventory value ───────────────────────

function CurrentInventoryValue() {
  const { exchangeRate } = useCurrency();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("catalog_items")
        .select("id, name, category, sell_currency, sell_price, cost_currency, cost_price, stock_quantity, low_stock_threshold")
        .eq("track_stock", true)
        .eq("is_active", true)
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (cancelled) return;
      setRows((data ?? []) as CatalogRow[]);
      setLoading(false);
    }
    void load();
    const ch = supabase
      .channel("audit-catalog-value")
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_items" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  const totals = useMemo(() => {
    let sellUSD = 0, costUSD = 0;
    for (const r of rows) {
      const sellUnit = toUSD(Number(r.sell_price ?? 0), r.sell_currency, exchangeRate);
      sellUSD += sellUnit * Number(r.stock_quantity ?? 0);
      if (r.cost_price != null && r.cost_currency) {
        const costUnit = toUSD(Number(r.cost_price), r.cost_currency, exchangeRate);
        costUSD += costUnit * Number(r.stock_quantity ?? 0);
      }
    }
    return {
      sellUSD: Number(sellUSD.toFixed(2)),
      costUSD: Number(costUSD.toFixed(2)),
      marginUSD: Number((sellUSD - costUSD).toFixed(2)),
    };
  }, [rows, exchangeRate]);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111]">
        <Boxes size={13} className="text-[#F5C100]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          قيمة المخزون الحالية — الرأسمال المربوط والقيمة البيعية
        </p>
        {loading && <span className="font-mono text-[10px] text-[#555555]">جاري التحميل…</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#252525]">
        <SummaryTile label="قيمة البيع الإجمالية" value={`$${totals.sellUSD.toLocaleString("en-US")}`} accent="#5CC45C" />
        <SummaryTile label="قيمة التكلفة" value={`$${totals.costUSD.toLocaleString("en-US")}`} accent="#FF7A00" />
        <SummaryTile label="الهامش المتوقع" value={`$${totals.marginUSD.toLocaleString("en-US")}`} accent="#F5C100" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#111111] text-[10px] font-mono uppercase tracking-widest text-[#555555]">
            <tr>
              <th className="px-4 py-2 text-right">الصنف</th>
              <th className="px-4 py-2 text-right">الفئة</th>
              <th className="px-4 py-2 text-right">المخزون</th>
              <th className="px-4 py-2 text-right">سعر البيع</th>
              <th className="px-4 py-2 text-right">سعر التكلفة</th>
              <th className="px-4 py-2 text-right">قيمة البيع</th>
              <th className="px-4 py-2 text-right">قيمة التكلفة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252525]/60">
            {rows.map((r) => {
              const sellUnitUSD = toUSD(Number(r.sell_price ?? 0), r.sell_currency, exchangeRate);
              const sellLineUSD = sellUnitUSD * Number(r.stock_quantity ?? 0);
              const costUnitUSD = r.cost_price != null && r.cost_currency
                ? toUSD(Number(r.cost_price), r.cost_currency, exchangeRate)
                : null;
              const costLineUSD = costUnitUSD != null ? costUnitUSD * Number(r.stock_quantity ?? 0) : null;
              const low = Number(r.stock_quantity ?? 0) <= Number(r.low_stock_threshold ?? 0);
              return (
                <tr key={r.id} className="hover:bg-[#252525]/30">
                  <td className="px-4 py-2 text-[#F0EDE6]">{r.name}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-[#777777]">{r.category ?? "—"}</td>
                  <td className={`px-4 py-2 font-mono tabular-nums ${low ? "text-[#FF7A00]" : "text-[#F0EDE6]"}`}>
                    {Number(r.stock_quantity ?? 0).toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{fmtMoney(Number(r.sell_price ?? 0), r.sell_currency)}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#777777]">
                    {r.cost_price != null && r.cost_currency ? fmtMoney(Number(r.cost_price), r.cost_currency) : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#5CC45C]">${sellLineUSD.toFixed(2)}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#FF7A00]">
                    {costLineUSD != null ? `$${costLineUSD.toFixed(2)}` : "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555]">لا توجد أصناف متتبعة المخزون</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-[#1A1A1A] px-5 py-3">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[#555555]">{label}</p>
      <p className="font-mono text-lg tabular-nums mt-1" style={{ color: accent }}>{value}</p>
    </div>
  );
}

// ─── Section 2: per-shift breakdown ───────────────────────────

function ShiftBreakdown() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [sales, setSales] = useState<ItemSaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function loadSessions() {
      const { data: sessRows } = await supabase
        .from("cash_sessions")
        .select("id, opened_at, closed_at, status, opened_by, closed_by")
        .order("opened_at", { ascending: false })
        .limit(30);
      const list = (sessRows ?? []) as Array<Record<string, unknown>>;
      const userIds = Array.from(new Set([
        ...list.map((s) => s.opened_by).filter(Boolean),
        ...list.map((s) => s.closed_by).filter(Boolean),
      ])).map(String);
      let nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", userIds);
        nameMap = new Map((profiles ?? []).map((p) => [String((p as Record<string, unknown>).id), String((p as Record<string, unknown>).display_name ?? "")]));
      }
      const enriched: SessionRow[] = list.map((s) => ({
        id: String(s.id),
        opened_at: String(s.opened_at),
        closed_at: s.closed_at == null ? null : String(s.closed_at),
        status: String(s.status ?? ""),
        opened_by_name: s.opened_by ? nameMap.get(String(s.opened_by)) ?? null : null,
        closed_by_name: s.closed_by ? nameMap.get(String(s.closed_by)) ?? null : null,
      }));
      if (cancelled) return;
      setSessions(enriched);
      if (enriched.length > 0 && !selectedId) setSelectedId(enriched[0].id);
      setLoading(false);
    }
    void loadSessions();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function loadDetails() {
      const [snapRes, saleRes] = await Promise.all([
        supabase
          .from("stock_snapshots")
          .select("catalog_item_id, snapshot_type, item_name_snapshot, stock_quantity, sell_price, sell_currency, cost_price, cost_currency, exchange_rate_to_syp")
          .eq("cash_session_id", selectedId),
        supabase
          .from("item_sales")
          .select("id, created_at, created_by_name, item_name_snapshot, quantity, unit_price, original_currency, original_total, amount_usd, amount_syp, catalog_item_id, cancelled_at, cancelled_reason")
          .eq("cash_session_id", selectedId)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      setSnapshots((snapRes.data ?? []) as SnapshotRow[]);
      setSales((saleRes.data ?? []) as ItemSaleRow[]);
    }
    void loadDetails();
    return () => { cancelled = true; };
  }, [selectedId]);

  const perItem = useMemo(() => {
    const openMap = new Map<string, SnapshotRow>();
    const closeMap = new Map<string, SnapshotRow>();
    for (const s of snapshots) {
      (s.snapshot_type === "open" ? openMap : closeMap).set(s.catalog_item_id, s);
    }
    const ids = new Set<string>([...openMap.keys(), ...closeMap.keys()]);
    const rows: Array<{
      itemId: string;
      name: string;
      opened: number;
      closed: number | null;
      soldFromSales: number;
      revenueUSD: number;
    }> = [];
    for (const id of ids) {
      const o = openMap.get(id);
      const c = closeMap.get(id);
      const itemSales = sales.filter((s) => s.catalog_item_id === id && !s.cancelled_at);
      const soldQty = itemSales.reduce((a, s) => a + Number(s.quantity ?? 0), 0);
      const revUSD  = itemSales.reduce((a, s) => a + Number(s.amount_usd ?? 0), 0);
      rows.push({
        itemId: id,
        name: o?.item_name_snapshot ?? c?.item_name_snapshot ?? "—",
        opened: Number(o?.stock_quantity ?? 0),
        closed: c ? Number(c.stock_quantity) : null,
        soldFromSales: soldQty,
        revenueUSD: revUSD,
      });
    }
    rows.sort((a, b) => b.soldFromSales - a.soldFromSales);
    return rows;
  }, [snapshots, sales]);

  const totals = useMemo(() => {
    const totalSold = perItem.reduce((a, r) => a + r.soldFromSales, 0);
    const totalRevenueUSD = perItem.reduce((a, r) => a + r.revenueUSD, 0);
    return { totalSold, totalRevenueUSD: Number(totalRevenueUSD.toFixed(2)) };
  }, [perItem]);

  const sel = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111] flex-wrap">
        <Clock size={13} className="text-[#F5C100]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          تقرير الورديات — افتتاح، إغلاق، وكل عملية بيع
        </p>
        <div className="flex-1" />
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="bg-[#0A0A0A] border border-[#252525] text-[#F0EDE6] text-xs font-mono px-3 py-1.5 rounded-sm focus:outline-none focus:border-[#F5C100]"
          dir="rtl"
        >
          {sessions.map((s) => {
            const date = formatDate(s.opened_at);
            const time = formatTime(s.opened_at);
            const status = s.status === "open" ? "مفتوحة" : "مغلقة";
            const by = s.opened_by_name ?? "—";
            return (
              <option key={s.id} value={s.id}>
                {date} {time} — {by} — {status}
              </option>
            );
          })}
          {sessions.length === 0 && <option value="">لا توجد ورديات</option>}
        </select>
        {loading && <span className="font-mono text-[10px] text-[#555555]">جاري…</span>}
      </div>

      {sel && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-px bg-[#252525]">
          <SummaryTile label="فتح بواسطة" value={sel.opened_by_name ?? "—"} accent="#F0EDE6" />
          <SummaryTile label="إغلاق بواسطة" value={sel.closed_by_name ?? "—"} accent="#F0EDE6" />
          <SummaryTile label="إجمالي القطع المباعة" value={String(totals.totalSold)} accent="#5CC45C" />
          <SummaryTile label="إيراد المبيعات (USD)" value={`$${totals.totalRevenueUSD.toLocaleString("en-US")}`} accent="#5CC45C" />
        </div>
      )}

      <div className="px-5 py-3 border-b border-[#252525] bg-[#0F0F0F]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#777777]">المخزون لكل صنف</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#111111] text-[10px] font-mono uppercase tracking-widest text-[#555555]">
            <tr>
              <th className="px-4 py-2 text-right">الصنف</th>
              <th className="px-4 py-2 text-right">عند الفتح</th>
              <th className="px-4 py-2 text-right">عند الإغلاق</th>
              <th className="px-4 py-2 text-right">المباع (من المبيعات)</th>
              <th className="px-4 py-2 text-right">الفرق المتوقع</th>
              <th className="px-4 py-2 text-right">إيراد (USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252525]/60">
            {perItem.map((r) => {
              const expected = r.closed != null ? r.opened - r.closed : null;
              const drift = expected != null ? expected - r.soldFromSales : null;
              return (
                <tr key={r.itemId}>
                  <td className="px-4 py-2 text-[#F0EDE6]">{r.name}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{r.opened}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#AAAAAA]">{r.closed ?? "—"}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#5CC45C]">{r.soldFromSales}</td>
                  <td className={`px-4 py-2 font-mono tabular-nums ${drift == null ? "text-[#555555]" : drift === 0 ? "text-[#5CC45C]" : "text-[#FF7A00]"}`}>
                    {drift == null ? "—" : drift === 0 ? "0 ✓" : drift > 0 ? `+${drift}` : String(drift)}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#F5C100]">${r.revenueUSD.toFixed(2)}</td>
                </tr>
              );
            })}
            {perItem.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555]">لا توجد بيانات للوردية المحددة</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-y border-[#252525] bg-[#0F0F0F]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#777777]">قائمة كل عملية بيع — {sales.length} عملية</p>
      </div>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#111111] text-[10px] font-mono uppercase tracking-widest text-[#555555] sticky top-0">
            <tr>
              <th className="px-4 py-2 text-right">الوقت</th>
              <th className="px-4 py-2 text-right">الموظف</th>
              <th className="px-4 py-2 text-right">الصنف</th>
              <th className="px-4 py-2 text-right">الكمية</th>
              <th className="px-4 py-2 text-right">سعر الوحدة</th>
              <th className="px-4 py-2 text-right">الإجمالي</th>
              <th className="px-4 py-2 text-right">USD</th>
              <th className="px-4 py-2 text-right">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252525]/60">
            {sales.map((s) => (
              <tr key={s.id} className={s.cancelled_at ? "opacity-50 line-through" : ""}>
                <td className="px-4 py-1.5 font-mono text-[10px] text-[#AAAAAA]">{formatTime(s.created_at)}</td>
                <td className="px-4 py-1.5 font-mono text-[10px] text-[#F0EDE6]">{s.created_by_name ?? "—"}</td>
                <td className="px-4 py-1.5 text-[#F0EDE6]">{s.item_name_snapshot}</td>
                <td className="px-4 py-1.5 font-mono tabular-nums">{s.quantity}</td>
                <td className="px-4 py-1.5 font-mono tabular-nums">{fmtMoney(Number(s.unit_price), s.original_currency)}</td>
                <td className="px-4 py-1.5 font-mono tabular-nums">{fmtMoney(Number(s.original_total), s.original_currency)}</td>
                <td className="px-4 py-1.5 font-mono tabular-nums text-[#5CC45C]">${Number(s.amount_usd ?? 0).toFixed(2)}</td>
                <td className="px-4 py-1.5 font-mono text-[10px] text-[#FF3333]">{s.cancelled_at ? `ملغى${s.cancelled_reason ? `: ${s.cancelled_reason}` : ""}` : ""}</td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555]">لا توجد مبيعات في الوردية</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section 3: edit audit log with before/after diffs ────────

function EditAuditLog() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("activity_feed")
        .select("id, action, description, created_at, created_by_name, old_value, new_value")
        .in("action", AUDIT_ACTIONS)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      setRows((data ?? []) as ActivityRow[]);
      setLoading(false);
    }
    void load();
    const ch = supabase
      .channel("audit-activity-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed" }, (payload) => {
        const r = payload.new as ActivityRow;
        if (!AUDIT_ACTIONS.includes(r.action)) return;
        setRows((p) => [r, ...p].slice(0, 100));
      })
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.action === filter);
  }, [rows, filter]);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111] flex-wrap">
        <HistoryIcon size={13} className="text-[#F5C100]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          سجل التعديلات — كل تغيير، من قبل من، قبل وبعد
        </p>
        <div className="flex-1" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-[#0A0A0A] border border-[#252525] text-[#F0EDE6] text-xs font-mono px-3 py-1.5 rounded-sm focus:outline-none focus:border-[#F5C100]"
          dir="rtl"
        >
          <option value="all">كل التعديلات</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {loading && <span className="font-mono text-[10px] text-[#555555]">جاري…</span>}
      </div>
      <div className="divide-y divide-[#252525]/60 max-h-[480px] overflow-y-auto">
        {filtered.map((r) => (
          <div key={r.id} className="px-5 py-3 hover:bg-[#252525]/30">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-block px-1.5 py-0.5 bg-[#252525] border border-[#555555]/30 rounded text-[9px] font-mono text-[#777777] uppercase tracking-wide">
                {ACTION_LABEL[r.action] ?? r.action}
              </span>
              <p className="text-xs text-[#F0EDE6] flex-1 truncate">{r.description}</p>
              <span className="font-mono text-[10px] text-[#AAAAAA]">{r.created_by_name ?? "—"}</span>
              <span className="font-mono text-[10px] text-[#777777]">{formatDate(r.created_at)} {formatTime(r.created_at)}</span>
            </div>
            {(r.old_value || r.new_value) && <DiffBlock oldValue={r.old_value} newValue={r.new_value} />}
          </div>
        ))}
        {filtered.length === 0 && !loading && (
          <div className="px-5 py-8 text-center font-mono text-[10px] text-[#555555]">لا توجد سجلات تعديل</div>
        )}
      </div>
    </div>
  );
}

function DiffBlock({ oldValue, newValue }: { oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }) {
  const keys = useMemo(() => {
    const ks = new Set<string>();
    if (oldValue) Object.keys(oldValue).forEach((k) => ks.add(k));
    if (newValue) Object.keys(newValue).forEach((k) => ks.add(k));
    return Array.from(ks);
  }, [oldValue, newValue]);
  if (keys.length === 0) return null;
  const renderVal = (v: unknown) => {
    if (v == null) return "—";
    if (typeof v === "boolean") return v ? "نعم" : "لا";
    if (typeof v === "number") return v.toLocaleString("en-US");
    return String(v);
  };
  return (
    <div className="mt-2 px-3 py-2 bg-[#0F0F0F] border border-[#252525] rounded-sm">
      <table className="w-full text-[10px] font-mono">
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="py-0.5 pr-3 text-[#777777]">{FIELD_LABEL[k] ?? k}</td>
              <td className="py-0.5 pl-2 text-[#FF7A00] tabular-nums">{renderVal(oldValue?.[k])}</td>
              <td className="py-0.5 px-2 text-[#555555]">→</td>
              <td className="py-0.5 pl-2 text-[#5CC45C] tabular-nums">{renderVal(newValue?.[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Section 4: exchange rate history ─────────────────────────

function ExchangeRateHistory() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("exchange_rate_history")
        .select("id, rate, changed_at, changed_by")
        .order("changed_at", { ascending: false })
        .limit(50);
      const list = (data ?? []) as Array<Record<string, unknown>>;
      const ids = Array.from(new Set(list.map((r) => r.changed_by).filter(Boolean))).map(String);
      let nameMap = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", ids);
        nameMap = new Map((profiles ?? []).map((p) => [String((p as Record<string, unknown>).id), String((p as Record<string, unknown>).display_name ?? "")]));
      }
      const enriched: RateRow[] = list.map((r) => ({
        id: String(r.id),
        rate: Number(r.rate ?? 0),
        changed_at: String(r.changed_at),
        changed_by_name: r.changed_by ? nameMap.get(String(r.changed_by)) ?? null : null,
      }));
      if (cancelled) return;
      setRows(enriched);
      setLoading(false);
    }
    void load();
    const ch = supabase
      .channel("audit-rate-history")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "exchange_rate_history" }, () => void load())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111]">
        <DollarSign size={13} className="text-[#F5C100]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          سجل سعر الدولار — كل تغيير، من ومتى
        </p>
        {loading && <span className="font-mono text-[10px] text-[#555555]">جاري…</span>}
      </div>
      <div className="overflow-x-auto max-h-72 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#111111] text-[10px] font-mono uppercase tracking-widest text-[#555555] sticky top-0">
            <tr>
              <th className="px-4 py-2 text-right">التاريخ</th>
              <th className="px-4 py-2 text-right">الوقت</th>
              <th className="px-4 py-2 text-right">السعر (ل.س)</th>
              <th className="px-4 py-2 text-right">بواسطة</th>
              <th className="px-4 py-2 text-right">التغيير</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#252525]/60">
            {rows.map((r, idx) => {
              const prev = rows[idx + 1]?.rate;
              const delta = prev != null ? r.rate - prev : null;
              return (
                <tr key={r.id} className="hover:bg-[#252525]/30">
                  <td className="px-4 py-2 font-mono text-[10px] text-[#AAAAAA]">{formatDate(r.changed_at)}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-[#777777]">{formatTime(r.changed_at)}</td>
                  <td className="px-4 py-2 font-mono tabular-nums text-[#F0EDE6]">{Math.round(r.rate).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-[#F0EDE6]">{r.changed_by_name ?? "—"}</td>
                  <td className={`px-4 py-2 font-mono tabular-nums text-[10px] ${delta == null ? "text-[#555555]" : delta > 0 ? "text-[#FF7A00]" : "text-[#5CC45C]"}`}>
                    {delta == null ? "—" : delta > 0 ? `+${Math.round(delta).toLocaleString("en-US")}` : Math.round(delta).toLocaleString("en-US")}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555]">لا توجد تغييرات مسجلة</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main composite ───────────────────────────────────────────

type SubSection = "value" | "shifts" | "edits" | "rate";

function SubRow({
  isOpen, onToggle, icon, title, desc,
}: {
  isOpen: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[#252525]/30 transition-colors text-right"
    >
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#F0EDE6]">{title}</p>
        <p className="font-mono text-[10px] text-[#555555]">{desc}</p>
      </div>
      {isOpen ? <ChevronUp size={14} className="text-[#777777]" /> : <ChevronDown size={14} className="text-[#777777]" />}
    </button>
  );
}

export default function AccountabilityBlock() {
  const [open, setOpen] = useState<Record<SubSection, boolean>>({
    value: false, shifts: false, edits: false, rate: false,
  });
  const toggle = (k: SubSection) => setOpen((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-3">
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm divide-y divide-[#252525]/60">
        <SubRow isOpen={open.value}  onToggle={() => toggle("value")}  icon={<Boxes       size={14} className="text-[#5CC45C]" />} title="قيمة المخزون الحالية" desc="الرأسمال المربوط وسعر البيع الإجمالي" />
        {open.value && <div className="p-3 bg-[#0A0A0A]"><CurrentInventoryValue /></div>}

        <SubRow isOpen={open.shifts} onToggle={() => toggle("shifts")} icon={<Clock       size={14} className="text-[#F5C100]" />} title="تقرير الورديات" desc="افتتاح، إغلاق، وكل عملية بيع لكل وردية" />
        {open.shifts && <div className="p-3 bg-[#0A0A0A]"><ShiftBreakdown /></div>}

        <SubRow isOpen={open.edits}  onToggle={() => toggle("edits")}  icon={<HistoryIcon size={14} className="text-[#F5C100]" />} title="سجل التعديلات (قبل / بعد)" desc="كل تعديل سعر، كل تعديل مخزون، كل إلغاء" />
        {open.edits && <div className="p-3 bg-[#0A0A0A]"><EditAuditLog /></div>}

        <SubRow isOpen={open.rate}   onToggle={() => toggle("rate")}   icon={<TrendingUp  size={14} className="text-[#F5C100]" />} title="سجل سعر الدولار" desc="كل تغيير لسعر الصرف، من ومتى" />
        {open.rate && <div className="p-3 bg-[#0A0A0A]"><ExchangeRateHistory /></div>}
      </div>
    </div>
  );
}
