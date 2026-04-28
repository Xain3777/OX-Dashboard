"use client";

import { useMemo, useState } from "react";
import { ChefHat, Plus, Minus, AlertTriangle, CheckCircle, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushSale, cancelTransaction } from "@/lib/supabase/intake";
import type { Sale } from "@/lib/types";

interface QtyMap { [id: string]: number }

export default function KitchenBlock() {
  const { user } = useAuth();
  const { foodItems, addSale, cancelSale, sales } = useStore();
  const { exchangeRate } = useCurrency();

  const [qty,     setQty]     = useState<QtyMap>({});
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  const activeItems = useMemo(() => foodItems.filter((f) => f.is_active), [foodItems]);

  const todayKitchenSales = useMemo(
    () => sales
      .filter((s) => s.source === "kitchen" && !s.isReversal && s.createdAt.startsWith(today))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sales, today]
  );

  const totalUSD = useMemo(
    () => activeItems.reduce((sum, it) => sum + (qty[it.id] ?? 0) * Number(it.price_usd), 0),
    [activeItems, qty]
  );
  const orderedCount = useMemo(
    () => Object.values(qty).reduce((a, n) => a + (n > 0 ? 1 : 0), 0),
    [qty]
  );

  const inc = (id: string) => setQty((q) => ({ ...q, [id]: (q[id] ?? 0) + 1 }));
  const dec = (id: string) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) - 1) }));

  async function handleOrder() {
    setError(""); setSuccess("");
    if (!user) { setError("يجب تسجيل الدخول."); return; }
    const lines = activeItems.map((it) => ({ it, q: qty[it.id] ?? 0 })).filter((l) => l.q > 0);
    if (lines.length === 0) { setError("اختر صنفاً واحداً على الأقل."); return; }

    setBusy(true);
    const currentUser = { id: user.id, displayName: user.displayName };
    for (const { it, q } of lines) {
      const unitPrice = Number(it.price_usd);
      const total = Number((q * unitPrice).toFixed(4));
      const r = await pushSale({
        user: currentUser,
        productName: it.name,
        quantity: q,
        unitPrice,
        total,
        currency: "usd",
        exchangeRate,
        source: "kitchen",
        paymentMethod: "cash",
      });
      if (r.error) { setError(r.error); setBusy(false); return; }
      const row = r.data!;
      const sale: Sale = {
        id: String(row.id),
        productId: it.id,
        productName: it.name,
        quantity: q,
        unitPrice,
        total,
        paymentMethod: "cash",
        currency: "usd",
        source: "kitchen",
        createdAt: String(row.created_at ?? new Date().toISOString()),
        createdBy: user.id,
        isReversal: false,
      };
      addSale(sale);
    }
    setBusy(false);
    setSuccess(`تم تسجيل الطلب — $${totalUSD.toFixed(2)}`);
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

      {/* Items grid */}
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {activeItems.length === 0 ? (
          <div className="col-span-full text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest py-6">
            لا توجد أصناف — يضيفها المدير من لوحة الإدارة
          </div>
        ) : (
          activeItems.map((it) => {
            const q         = qty[it.id] ?? 0;
            const lineTotal = q * Number(it.price_usd);
            return (
              <div
                key={it.id}
                className={`p-3 border rounded-sm transition-colors ${q > 0 ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111]"}`}
              >
                <p className="font-body text-xs text-[#F0EDE6] mb-1.5">{it.name}</p>
                <p className="font-display text-base text-[#F5C100] tracking-wider">
                  ${Number(it.price_usd).toFixed(2)}
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
                      onClick={() => inc(it.id)}
                      className="w-6 h-6 rounded-sm border border-[#F5C100]/40 bg-[#F5C100]/10 hover:bg-[#F5C100]/20 flex items-center justify-center text-[#F5C100]"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                  {q > 0 && (
                    <span className="font-mono tabular-nums text-[10px] text-[#5CC45C]">
                      ${lineTotal.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Total + submit */}
      <div className="border-t border-[#252525] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[#111111]/60">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي الطلب</span>
          <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100]">${totalUSD.toFixed(2)}</span>
          <span className="font-mono text-[10px] text-[#555555]">({orderedCount} صنف)</span>
        </div>
        <button
          onClick={handleOrder}
          disabled={busy || totalUSD === 0}
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
            {todayKitchenSales.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-3 px-5 py-2 transition-colors ${s.cancelled ? "opacity-40 bg-[#1A0A0A]/30" : "hover:bg-[#252525]/20"}`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${s.cancelled ? "line-through text-[#777777]" : "text-[#F0EDE6]"} truncate`}>
                    {s.quantity}× {s.productName}
                  </p>
                  <p className="font-mono text-[9px] text-[#555555]">
                    {new Date(s.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <span className={`font-mono tabular-nums text-xs ${s.cancelled ? "text-[#777777] line-through" : "text-[#F5C100]"}`}>
                  ${s.total.toFixed(2)}
                </span>
                {!s.cancelled ? (
                  <button
                    onClick={async () => {
                      if (!user) return;
                      const r = await cancelTransaction({
                        user: { id: user.id, displayName: user.displayName },
                        table: "sales",
                        id: s.id,
                      });
                      if (!r.error) cancelSale(s.id);
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
