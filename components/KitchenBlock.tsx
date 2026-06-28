"use client";

import { useMemo, useState } from "react";
import { ChefHat, Plus, Minus, AlertTriangle, CheckCircle, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushItemSale, cancelTransaction } from "@/lib/supabase/intake";
import type { ItemSale, PaymentMethod } from "@/lib/types";
import { formatTime, isCurrentBusinessDay } from "@/lib/utils/time";
import { recipeAvailability } from "@/lib/inventory";

interface QtyMap { [id: string]: number }

const KITCHEN_TYPES = new Set(["meal", "water", "drink"]);

// ماء كبير's badge should always render (it shares the same inventory row as
// every other catalog item — its track_stock flag is just sometimes off in
// the DB). UI-only override; sale / inc clamping continue to follow the
// row's own track_stock value.
const FORCE_BADGE_NAMES = new Set(["ماء كبير"]);

type KitchenGroupKey = "meals" | "meal_addons" | "other";

const KITCHEN_GROUP_ORDER: KitchenGroupKey[] = ["meals", "meal_addons", "other"];

const KITCHEN_GROUP_TITLE: Record<KitchenGroupKey, string> = {
  meals: "وجبات رئيسية",
  meal_addons: "إضافات على الوجبة",
  other: "أصناف أخرى",
};

const KITCHEN_GROUP_UNIT: Record<KitchenGroupKey, [string, string]> = {
  // [singular, plural] — Arabic uses plural for ≥3
  meals: ["صنف", "أصناف"],
  meal_addons: ["صنف", "أصناف"],
  other: ["صنف", "أصناف"],
};

function kitchenGroupOf(category: string): KitchenGroupKey {
  if (category === "meals") return "meals";
  if (category === "meal_addons") return "meal_addons";
  return "other";
}

export default function KitchenBlock() {
  const { user } = useAuth();
  const { catalogItems, addItemSale, cancelItemSale, itemSales, rawMaterials, itemRecipes } = useStore();
  const { exchangeRate } = useCurrency();

  const [qty,     setQty]     = useState<QtyMap>({});
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  // Kitchen UI shows catalog items whose item_type is meal / water / drink.
  // Currency comes from the catalog row (sellCurrency); the cashier never
  // picks it. Zero-priced rows still render — they're sub-portion add-ons
  // tracked for cost reporting that the cashier can mark on a meal even
  // when free.
  const activeItems = useMemo(
    () =>
      catalogItems
        .filter((c) => c.isActive && KITCHEN_TYPES.has(c.itemType))
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)),
    [catalogItems]
  );

  // Three visual groups: main meals, meal add-ons, everything else (drinks
  // / water / supplements sold from the kitchen). Order in render is fixed
  // by KITCHEN_GROUP_ORDER so the layout stays stable as items are toggled.
  const groupedItems = useMemo(() => {
    const map: Record<KitchenGroupKey, typeof activeItems> = {
      meals: [],
      meal_addons: [],
      other: [],
    };
    for (const it of activeItems) map[kitchenGroupOf(it.category)].push(it);
    return map;
  }, [activeItems]);

  const todayKitchenSales = useMemo(
    () => itemSales
      .filter((s) => s.source === "kitchen" && isCurrentBusinessDay(s.createdAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [itemSales]
  );

  // SYP-only ordering total (kitchen items today are all SYP-priced).
  // If a future kitchen item is USD-priced, this just won't include it
  // in the SYP total — but we render the per-line total in its native
  // currency below so the cashier sees the right number.
  const totalSYP = useMemo(
    () =>
      activeItems.reduce((sum, it) => {
        const q = qty[it.id] ?? 0;
        if (q === 0) return sum;
        return it.sellCurrency === "syp" ? sum + q * Number(it.sellPrice) : sum;
      }, 0),
    [activeItems, qty]
  );
  const orderedCount = useMemo(
    () => Object.values(qty).reduce((a, n) => a + (n > 0 ? 1 : 0), 0),
    [qty]
  );

  const fmtSYP = (n: number) => `${new Intl.NumberFormat("ar-SY", { maximumFractionDigits: 0 }).format(Math.round(n))} ل.س`;
  const fmtUSD = (n: number) => `$${n.toFixed(2)}`;
  const fmtPrice = (n: number, cur: "syp" | "usd") => (cur === "syp" ? fmtSYP(n) : fmtUSD(n));

  const inc = (item: (typeof activeItems)[number]) => {
    setQty((q) => {
      const current = q[item.id] ?? 0;
      if (item.trackStock && current >= item.stockQuantity) return q;
      return { ...q, [item.id]: current + 1 };
    });
  };
  const dec = (id: string) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) - 1) }));

  async function handleOrder() {
    setError(""); setSuccess("");
    if (!user) { setError("يجب تسجيل الدخول."); return; }
    const lines = activeItems.map((it) => ({ it, q: qty[it.id] ?? 0 })).filter((l) => l.q > 0);
    if (lines.length === 0) { setError("اختر صنفاً واحداً على الأقل."); return; }
    if (!exchangeRate || exchangeRate <= 0) { setError("سعر الصرف غير صالح — حدّثه من أعلى الصفحة."); return; }
    const short = lines.find(({ it, q }) => it.trackStock && q > it.stockQuantity);
    if (short) {
      setError(`مخزون غير كافٍ لـ ${short.it.name}. المتاح: ${short.it.stockQuantity}.`);
      return;
    }
    // Soft warning when a recipe item's linked warehouse stock can't cover the
    // order (recipe stock is allowed to go negative — confirm, don't block).
    const recipeShort = lines
      .map(({ it, q }) => ({ it, q, avail: recipeAvailability(it.id, rawMaterials, itemRecipes) }))
      .filter((l) => l.avail != null && l.q > l.avail);
    if (recipeShort.length > 0) {
      const names = recipeShort.map((l) => `${l.it.name} (متوفر ${l.avail})`).join("، ");
      if (!window.confirm(`المخزون غير كافٍ حسب الوصفة لـ: ${names}.\nتسجيل الطلب على أي حال؟`)) return;
    }

    setBusy(true);
    const currentUser = { id: user.id, displayName: user.displayName };
    console.log("Kitchen order start:", {
      user: currentUser,
      exchangeRate,
      lines: lines.map((l) => ({
        name: l.it.name, q: l.q,
        sellPrice: l.it.sellPrice, sellCurrency: l.it.sellCurrency,
      })),
    });

    for (const { it, q } of lines) {
      const r = await pushItemSale({
        user: currentUser,
        catalogItem: {
          id: it.id,
          name: it.name,
          category: it.category,
          itemType: it.itemType,
          sellCurrency: it.sellCurrency,
          sellPrice: Number(it.sellPrice),
        },
        quantity: q,
        exchangeRate,
        paymentMethod: "cash",
        source: "kitchen",
      });
      if (r.error) { setError(r.error); setBusy(false); return; }
      const row = r.data!;
      const sale: ItemSale = {
        id: String(row.id),
        catalogItemId: it.id,
        itemNameSnapshot: it.name,
        categorySnapshot: it.category,
        itemTypeSnapshot: it.itemType,
        quantity: q,
        unitPrice: Number(it.sellPrice),
        originalCurrency: it.sellCurrency,
        originalTotal: Number(it.sellPrice) * q,
        exchangeRateToSyp: exchangeRate,
        amountSyp: row.amount_syp == null ? null : Number(row.amount_syp),
        amountUsd: row.amount_usd == null ? null : Number(row.amount_usd),
        source: "kitchen",
        paymentMethod: "cash" as PaymentMethod,
        cashSessionId: row.cash_session_id == null ? null : String(row.cash_session_id),
        createdBy: user.id,
        createdByName: user.displayName,
        createdAt: String(row.created_at ?? new Date().toISOString()),
        cancelledAt: null,
        cancelledBy: null,
        cancelledReason: null,
      };
      addItemSale(sale);
    }

    setBusy(false);
    setSuccess(totalSYP > 0 ? `تم تسجيل الطلب — ${fmtSYP(totalSYP)}` : "تم تسجيل الطلب");
    setQty({});
    setTimeout(() => setSuccess(""), 2500);
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <ChefHat size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">
            المطبخ — طلبات الاستقبال
          </h2>
          <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#AAAAAA]">
            {activeItems.length} صنف
          </span>
        </div>
      </div>

      {/* Grouped item sections */}
      {activeItems.length === 0 ? (
        <div className="px-5 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
          لا توجد أصناف — يضيفها المدير من لوحة الإدارة
        </div>
      ) : (
        <div className="px-5 py-4 space-y-6">
          {KITCHEN_GROUP_ORDER.map((g) => {
            const items = groupedItems[g];
            if (items.length === 0) return null;
            const [singular, plural] = KITCHEN_GROUP_UNIT[g];
            const unit = items.length >= 3 ? plural : singular;
            return (
              <section key={g}>
                <div className="flex items-center justify-between border-b border-[#252525] pb-2 mb-3">
                  <h3 className="font-display text-[#F0EDE6] tracking-widest text-xs uppercase">
                    {KITCHEN_GROUP_TITLE[g]}
                  </h3>
                  <span className="font-mono text-[10px] text-[#777777]">{items.length} {unit}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {items.map((it) => {
                    const q         = qty[it.id] ?? 0;
                    const lineTotal = q * Number(it.sellPrice);
                    const tracked   = it.trackStock;
                    // Recipe-linked items derive availability from the warehouse
                    // (how many units the linked materials can make) instead of
                    // the item's own stock_quantity.
                    const recipeAvail = recipeAvailability(it.id, rawMaterials, itemRecipes);
                    const hasRecipe = recipeAvail != null;
                    const baseStock = hasRecipe ? recipeAvail! : it.stockQuantity;
                    const out       = (tracked && it.stockQuantity <= 0) || (hasRecipe && recipeAvail! <= 0);
                    const maxed     = tracked && q >= it.stockQuantity;
                    const showBadge = tracked || FORCE_BADGE_NAMES.has(it.name) || hasRecipe;
                    // Badge shows the live remaining inventory: available stock
                    // minus what's already in this pending order. Drops in
                    // real-time as the cashier presses "+", so they see
                    // "what's left after this order" while building it.
                    const remaining = Math.max(0, baseStock - q);
                    const badgeIsOut = showBadge && remaining <= 0;
                    return (
                      <div
                        key={it.id}
                        className={`relative p-3 border rounded-sm transition-colors ${q > 0 ? "border-[#F5C100]/50 bg-[#F5C100]/5" : out ? "border-[#D42B2B]/50 bg-[#1A0A0A]/25" : "border-[#252525] bg-[#111111]"}`}
                      >
                        {showBadge && (
                          <div
                            className={`absolute left-2 top-2 min-w-10 rounded-sm border px-2 py-0.5 text-center font-mono tabular-nums text-[10px] ${badgeIsOut ? "border-[#D42B2B]/40 bg-[#D42B2B]/10 text-[#FF3333]" : "border-[#252525] bg-[#0A0A0A] text-[#5CC45C]"}`}
                            title="المخزون"
                          >
                            <span className={`min-w-5 text-center font-mono tabular-nums text-[10px] ${badgeIsOut ? "text-[#FF3333]" : "text-[#5CC45C]"}`}>
                              {remaining}
                            </span>
                          </div>
                        )}
                        <p className={`font-body text-xs text-[#F0EDE6] mb-1 ${showBadge ? "pl-20" : ""}`}>{it.name}</p>
                        {it.description && (
                          <p className="font-mono text-[9px] text-[#777777] leading-snug mb-1.5">{it.description}</p>
                        )}
                        <p className="font-display text-base text-[#F5C100] tracking-wider" dir="ltr">
                          {fmtPrice(Number(it.sellPrice), it.sellCurrency)}
                        </p>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => dec(it.id)}
                              disabled={q === 0}
                              className="w-6 h-6 rounded-sm border border-[#252525] bg-[#111111] hover:border-[#555555] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-[#AAAAAA]"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="font-mono tabular-nums text-xs text-[#F0EDE6] w-6 text-center">{q}</span>
                            <button
                              onClick={() => inc(it)}
                              disabled={maxed}
                              className="w-6 h-6 rounded-sm border border-[#F5C100]/40 bg-[#F5C100]/10 hover:bg-[#F5C100]/20 flex items-center justify-center text-[#F5C100] disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                          {q > 0 && (
                            <span className="font-mono tabular-nums text-[10px] text-[#5CC45C]" dir="ltr">
                              {fmtPrice(lineTotal, it.sellCurrency)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Total + submit */}
      <div className="border-t border-[#252525] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[#111111]/60">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي الطلب</span>
          <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100]" dir="ltr">{fmtSYP(totalSYP)}</span>
          <span className="font-mono text-[10px] text-[#555555]">({orderedCount} صنف)</span>
        </div>
        <button
          onClick={handleOrder}
          disabled={busy || orderedCount === 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm cursor-pointer"
        >
          <ChefHat size={12} />
          {busy ? "جاري التسجيل…" : "تسجيل الطلب"}
        </button>
      </div>

      {error   && <div className="px-5 pb-3 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]"><AlertTriangle size={11} />{error}</div>}
      {success && <div className="px-5 pb-3 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]"><CheckCircle size={11} />{success}</div>}

      {/* Today's orders log */}
      {todayKitchenSales.length > 0 && (
        <div className="border-t border-[#252525]">
          <div className="px-5 py-2 flex items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">طلبات اليوم</p>
          </div>
          <div className="divide-y divide-[#252525]/50 max-h-48 overflow-y-auto">
            {todayKitchenSales.map((s) => {
              const cancelled = s.cancelledAt != null;
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 px-5 py-2 transition-colors ${cancelled ? "opacity-40 bg-[#1A0A0A]/30" : "hover:bg-[#252525]/20"}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${cancelled ? "line-through text-[#777777]" : "text-[#F0EDE6]"} truncate`}>
                      {s.quantity}× {s.itemNameSnapshot}
                    </p>
                    <p className="font-mono text-[9px] text-[#555555]">
                      {formatTime(s.createdAt)}
                    </p>
                  </div>
                  <span className={`font-mono tabular-nums text-xs ${cancelled ? "text-[#777777] line-through" : "text-[#F5C100]"}`} dir="ltr">
                    {fmtPrice(Number(s.originalTotal), s.originalCurrency)}
                  </span>
                  {!cancelled ? (
                    <button
                      onClick={async () => {
                        if (!user) return;
                        const r = await cancelTransaction({
                          user: { id: user.id, displayName: user.displayName },
                          table: "item_sales",
                          id: s.id,
                        });
                        if (!r.error) cancelItemSale(s.id);
                      }}
                      className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"
                      title="إلغاء"
                    >
                      <Undo2 size={12} />
                    </button>
                  ) : (
                    <span className="font-mono text-[9px] text-[#FF3333]">ملغي</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
