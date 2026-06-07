"use client";

// "سجل المراجعة" — DB-backed audit log. Reads directly from the Supabase
// activity_feed table (the same table the manager's "تدقيق ومحاسبة" section
// reads), so every event written via pushActivity() in lib/supabase/intake.ts
// shows up here regardless of which browser/session triggered it.
//
// Covers:
//   • Sales (create + cancel)               — item_sale, sales_cancel, item_sales_cancel
//   • Subscriptions (create + cancel)       — subscription_create, gym_subscriptions_cancel
//   • InBody (create + cancel)              — inbody_session, inbody_sessions_cancel
//   • Expenses (create + cancel)            — expense_create, expenses_cancel
//   • Cash sessions (open + close)          — session_opened, session_closed
//   • Catalog inventory & price edits       — catalog_item_create/update/delete
//   • Exchange rate changes                 — exchange_rate_update
//
// For edit/delete events we surface the old_value → new_value diff written by
// the audit work in migration 0041.

import { useEffect, useMemo, useState } from "react";
import {
  Activity, UserPlus, ShoppingCart, RotateCcw, Receipt,
  LogIn, LogOut, BarChart2, DollarSign, Edit3, Trash2, Plus, XCircle, AlertTriangle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatTime } from "@/lib/utils/time";

type ActionMeta = {
  label: string;
  color: string;
  borderColor: string;
  icon: React.ReactNode;
};

// One entry per activity_feed.action value. Anything we don't recognize falls
// back to a generic "نشاط" badge so we never silently drop a row.
const ACTION_META: Record<string, ActionMeta> = {
  // Sales
  sale_create:          { label: "بيع",            color: "text-[#5CC45C]", borderColor: "border-l-[#5CC45C]", icon: <ShoppingCart size={13} /> },
  item_sale:            { label: "بيع",            color: "text-[#5CC45C]", borderColor: "border-l-[#5CC45C]", icon: <ShoppingCart size={13} /> },
  sales_cancel:         { label: "إلغاء بيع",      color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <RotateCcw size={13} /> },
  item_sales_cancel:    { label: "إلغاء بيع",      color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <RotateCcw size={13} /> },

  // Subscriptions
  subscription_create:      { label: "إنشاء اشتراك",  color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <UserPlus size={13} /> },
  subscription_update:      { label: "تعديل اشتراك",  color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Edit3 size={13} /> },
  gym_subscriptions_cancel: { label: "حذف اشتراك",   color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <XCircle size={13} /> },

  // InBody
  inbody_session:           { label: "جلسة InBody",   color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Activity size={13} /> },
  inbody_create:            { label: "جلسة InBody",   color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Activity size={13} /> },
  inbody_sessions_cancel:   { label: "إلغاء InBody",  color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <XCircle size={13} /> },

  // Private training
  private_session_create:   { label: "تدريب خاص",     color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Activity size={13} /> },

  // Expenses
  expense_create:           { label: "تسجيل مصروف",  color: "text-[#FF7A00]", borderColor: "border-l-[#FF7A00]", icon: <Receipt size={13} /> },
  expense_update:           { label: "تعديل مصروف",  color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Edit3 size={13} /> },
  expenses_cancel:          { label: "إلغاء مصروف", color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <XCircle size={13} /> },

  // Legacy actions (pre-catalog-cutover) — still present on prod activity_feed.
  product_stock_adjust:     { label: "تعديل المخزون",  color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Edit3 size={13} /> },
  product_price_update:     { label: "تعديل السعر",    color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Edit3 size={13} /> },
  food_item_delete:         { label: "حذف صنف مطبخ",  color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <Trash2 size={13} /> },

  // Cash session lifecycle
  session_opened:           { label: "فتح وردية",    color: "text-[#FFD740]", borderColor: "border-l-[#FFD740]", icon: <LogIn size={13} /> },
  session_closed:           { label: "إغلاق وردية",  color: "text-[#C49A00]", borderColor: "border-l-[#C49A00]", icon: <LogOut size={13} /> },

  // Catalog / inventory / pricing
  catalog_item_create:      { label: "صنف جديد",     color: "text-[#5CC45C]", borderColor: "border-l-[#5CC45C]", icon: <Plus size={13} /> },
  catalog_item_update:      { label: "تعديل صنف",    color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <Edit3 size={13} /> },
  catalog_item_delete:      { label: "حذف صنف",      color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <Trash2 size={13} /> },

  // Exchange rate
  exchange_rate_update:     { label: "تغيير الدولار", color: "text-[#F5C100]", borderColor: "border-l-[#F5C100]", icon: <DollarSign size={13} /> },

  // Write failures — captured by logError() in intake.ts.
  error:                    { label: "خطأ",          color: "text-[#FF3333]", borderColor: "border-l-[#FF3333]", icon: <AlertTriangle size={13} /> },
};

const FALLBACK_META: ActionMeta = {
  label: "نشاط",
  color: "text-[#777777]",
  borderColor: "border-l-[#555555]",
  icon: <BarChart2 size={13} />,
};

// Friendly labels for the diff rows. Anything missing falls through to the raw
// column name so we never block on a label we forgot to add.
const FIELD_LABEL: Record<string, string> = {
  name: "الاسم", category: "الفئة", item_type: "النوع",
  sell_price: "سعر البيع", sell_currency: "عملة البيع",
  cost_price: "سعر التكلفة", cost_currency: "عملة التكلفة",
  stock_quantity: "المخزون", track_stock: "تتبع المخزون",
  low_stock_threshold: "حد التنبيه", is_active: "نشط",
  rate: "سعر الدولار",
  opening_cash: "الافتتاحي", actual_cash: "النقد الفعلي",
  expected_cash: "النقد المتوقع", difference: "الفرق", status: "الحالة",
  cancelled_reason: "سبب الإلغاء",
  paid_amount: "المبلغ المدفوع", amount: "المبلغ", member_name: "اسم العضو",
  plan_type: "الخطة", offer: "العرض", end_date: "تاريخ الانتهاء",
  start_date: "تاريخ البدء", note: "ملاحظة", source: "المصدر",
  currency: "العملة", description: "الوصف", phone: "الهاتف",
  payment_status: "حالة الدفع", payment_method: "طريقة الدفع",
};

// Internal / bookkeeping columns that are noise in a human-facing diff —
// UUIDs, audit stamps, and per-row currency snapshots. Hidden everywhere.
const HIDDEN_DIFF_FIELDS = new Set<string>([
  "id", "created_at", "created_by", "updated_at",
  "cash_session_id", "cancelled_by", "created_by_name",
  "member_id", "entity_id", "amount_syp", "exchange_rate",
  "cancelled_at",
]);

// Enum values rendered in Arabic instead of their raw DB strings.
const VALUE_LABEL: Record<string, string> = {
  syp: "ليرة", usd: "دولار",
  cash: "نقدي", card: "بطاقة", transfer: "حوالة",
  miscellaneous: "متنوّع", reception_daily: "مصروف استقبال يومي",
  paid: "مدفوع", partial: "جزئي", unpaid: "غير مدفوع",
  open: "مفتوحة", closed: "مغلقة",
};

// ── FILTER TABS ───────────────────────────────────────────────

type FilterTab = "all" | "sales" | "subscriptions" | "expenses" | "inbody" | "sessions" | "catalog" | "rate" | "cancels" | "errors";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all",           label: "الكل" },
  { key: "sales",         label: "المبيعات" },
  { key: "subscriptions", label: "الاشتراكات" },
  { key: "expenses",      label: "المصروفات" },
  { key: "inbody",        label: "InBody" },
  { key: "sessions",      label: "الورديات" },
  { key: "catalog",       label: "المخزون والأسعار" },
  { key: "rate",          label: "سعر الدولار" },
  { key: "cancels",       label: "الإلغاءات" },
  { key: "errors",        label: "الأخطاء" },
];

const FILTER_ACTIONS: Record<FilterTab, string[] | null> = {
  all:           null,
  sales:         ["sale_create", "item_sale"],
  subscriptions: ["subscription_create", "subscription_update"],
  expenses:      ["expense_create", "expense_update"],
  inbody:        ["inbody_session", "inbody_create"],
  sessions:      ["session_opened", "session_closed"],
  catalog:       ["catalog_item_create", "catalog_item_update", "catalog_item_delete", "product_stock_adjust", "product_price_update", "food_item_delete"],
  rate:          ["exchange_rate_update"],
  cancels:       ["sales_cancel", "item_sales_cancel", "gym_subscriptions_cancel", "inbody_sessions_cancel", "expenses_cancel"],
  errors:        ["error"],
};

// ── Types ─────────────────────────────────────────────────────

type FeedRow = {
  id: string;
  action: string;
  description: string;
  amount_syp: number | null;
  amount_usd: number | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  created_by_name: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

// ── Row ───────────────────────────────────────────────────────

function renderVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") {
    if (VALUE_LABEL[v]) return VALUE_LABEL[v];
    // ISO timestamp → readable Damascus date+time
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString("ar-SY", {
          timeZone: "Asia/Damascus",
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        });
      }
    }
    return v;
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

function DiffRows({ oldValue, newValue }: { oldValue: Record<string, unknown> | null; newValue: Record<string, unknown> | null }) {
  const keys = useMemo(() => {
    const ks = new Set<string>();
    if (oldValue) Object.keys(oldValue).forEach((k) => ks.add(k));
    if (newValue) Object.keys(newValue).forEach((k) => ks.add(k));
    return Array.from(ks)
      .filter((k) => !HIDDEN_DIFF_FIELDS.has(k))
      // Only rows that actually changed — drops the noise of unchanged fields.
      .filter((k) => (oldValue?.[k] ?? null) !== (newValue?.[k] ?? null));
  }, [oldValue, newValue]);
  if (keys.length === 0) return null;

  const oldEmpty = !oldValue || Object.keys(oldValue).length === 0;
  const newEmpty = !newValue || Object.keys(newValue).length === 0;
  // Snapshot = a create or cancellation record (one side absent). Render it as
  // a plain label/value list instead of a misleading "value → —" diff.
  const snapshot = oldEmpty || newEmpty;
  const snap = newEmpty ? oldValue : newValue;

  return (
    <div className="mt-1.5 px-2.5 py-1.5 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm">
      <table className="w-full text-[10px] font-mono">
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="py-0.5 pr-2 text-[#666666] whitespace-nowrap">{FIELD_LABEL[k] ?? k}</td>
              {snapshot ? (
                <td className="py-0.5 px-1.5 text-[#AAAAAA] truncate max-w-[260px]" title={renderVal(snap?.[k])}>
                  {renderVal(snap?.[k])}
                </td>
              ) : (
                <>
                  <td className="py-0.5 px-1.5 text-[#FF7A00] tabular-nums truncate max-w-[120px]" title={renderVal(oldValue?.[k])}>{renderVal(oldValue?.[k])}</td>
                  <td className="py-0.5 px-1 text-[#555555]">→</td>
                  <td className="py-0.5 px-1.5 text-[#5CC45C] tabular-nums truncate max-w-[120px]" title={renderVal(newValue?.[k])}>{renderVal(newValue?.[k])}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryRow({ row }: { row: FeedRow }) {
  const meta = ACTION_META[row.action] ?? FALLBACK_META;
  // Cancellations render as a clean one-liner: description + amount + (optional)
  // reason chip. The raw old_value/new_value remains in the DB for forensics
  // but is not surfaced in the audit panel — it was an unreadable UUID/column
  // dump for non-technical staff.
  const isCancel = row.action.endsWith("_cancel");
  const cancelReason = isCancel
    ? (row.new_value?.cancelled_reason ?? row.old_value?.cancelled_reason ?? null)
    : null;
  const cancelReasonText = typeof cancelReason === "string" && cancelReason.trim()
    ? cancelReason.trim()
    : null;
  const hasDiff = !isCancel && (
    (row.old_value && Object.keys(row.old_value).length > 0)
    || (row.new_value && Object.keys(row.new_value).length > 0)
  );
  // intake.ts embeds the reason in parens at the end of cancel descriptions;
  // strip it so the reason appears only as the chip below, not twice.
  const renderedDescription = isCancel && cancelReasonText
    ? row.description.replace(/\s*\([^)]*\)\s*$/, "")
    : row.description;
  return (
    <div className={`flex items-start gap-3 px-4 py-2.5 border-b border-[#252525] border-l-2 ${meta.borderColor} hover:bg-[#111111]/60 transition-colors`}>
      <div className="shrink-0 flex flex-col items-end pt-px w-[52px]">
        <span className="font-mono text-[11px] text-[#F0EDE6] tabular-nums leading-tight">{formatTime(row.created_at)}</span>
        <span className="font-mono text-[10px] text-[#555555] tabular-nums leading-tight">
          {new Date(row.created_at).toLocaleDateString("ar-SY", { timeZone: "Asia/Damascus", day: "2-digit", month: "short" })}
        </span>
      </div>
      <div className={`shrink-0 mt-0.5 ${meta.color}`}>{meta.icon}</div>
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm text-[#AAAAAA] leading-snug">{renderedDescription}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="font-mono text-[10px] text-[#777777]">{row.created_by_name ?? "—"}</span>
          {row.amount_usd != null && row.amount_usd !== 0 && (
            <>
              <span className="text-[#252525] text-[10px]">·</span>
              <span className="font-mono text-[10px] text-[#5CC45C] tabular-nums">${Number(row.amount_usd).toFixed(2)}</span>
            </>
          )}
          {cancelReasonText && (
            <>
              <span className="text-[#252525] text-[10px]">·</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#FF3333]/10 border border-[#FF3333]/25 rounded-sm font-mono text-[10px] text-[#FF7A7A]">
                <span className="text-[#FF3333]/70">السبب:</span>
                <span>{cancelReasonText}</span>
              </span>
            </>
          )}
        </div>
        {hasDiff && <DiffRows oldValue={row.old_value} newValue={row.new_value} />}
      </div>
      <div className="shrink-0 pt-0.5">
        <span className={`font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────

export default function AuditLog() {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("activity_feed")
        .select("id, action, description, amount_syp, amount_usd, entity_type, entity_id, created_at, created_by_name, old_value, new_value")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setRows((data ?? []) as FeedRow[]);
      setLoading(false);
    }
    void load();
    const ch = supabase
      .channel("audit-log-page")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_feed" }, (payload) => {
        setRows((p) => [payload.new as FeedRow, ...p].slice(0, 200));
      })
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const allowed = FILTER_ACTIONS[activeFilter];
    if (!allowed) return rows;
    return rows.filter((r) => allowed.includes(r.action));
  }, [rows, activeFilter]);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#252525] shrink-0">
        <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
          سجل المراجعة
        </h2>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-[#555555]" />
          <span className="font-mono text-xs text-[#555555] tabular-nums">
            {filtered.length}
            {filtered.length !== rows.length && <span className="text-[#252525]"> / {rows.length}</span>}{" "}
            سجل
          </span>
          {loading && <span className="font-mono text-[10px] text-[#555555]">جاري…</span>}
        </div>
      </div>

      <div className="flex items-center gap-px px-4 py-2.5 border-b border-[#252525] shrink-0 overflow-x-auto">
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
          const count = tab.key === "all"
            ? rows.length
            : rows.filter((r) => (FILTER_ACTIONS[tab.key] ?? []).includes(r.action)).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={[
                "flex items-center gap-1.5 px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors duration-100 clip-corner-sm shrink-0",
                isActive
                  ? "bg-[#F5C100]/10 text-[#F5C100] border border-[#F5C100]/30"
                  : "text-[#555555] hover:text-[#AAAAAA] border border-transparent hover:border-[#252525]",
              ].join(" ")}
            >
              {tab.label}
              <span className={`tabular-nums ${isActive ? "text-[#F5C100]/60" : "text-[#252525]"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto max-h-[480px]" style={{ scrollbarWidth: "thin", scrollbarColor: "#252525 #111111" }}>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <span className="font-mono text-xs text-[#555555]">لا توجد سجلات.</span>
          </div>
        ) : (
          <div>
            {filtered.map((r) => <EntryRow key={r.id} row={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
