"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChefHat,
  Plus,
  Minus,
  AlertTriangle,
  CheckCircle,
  Pencil,
  X,
  Undo2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import { supabaseBrowser } from "@/lib/supabase/client";

const IS_LOCAL = process.env.NEXT_PUBLIC_LOCAL_AUTH === "true";

interface FoodItem {
  id: string;
  name: string;
  price_usd: number;
  is_active: boolean;
}

interface QtyMap { [id: string]: number }

const LOCAL_FOOD_ITEMS: FoodItem[] = [
  { id: "food-1", name: "أرز",   price_usd: 3.00, is_active: true },
  { id: "food-2", name: "دجاج",  price_usd: 5.00, is_active: true },
  { id: "food-3", name: "سلطة",  price_usd: 2.50, is_active: true },
  { id: "food-4", name: "تونة",  price_usd: 4.00, is_active: true },
  { id: "food-5", name: "شوفان", price_usd: 2.00, is_active: true },
];

export default function KitchenBlock() {
  const { user, isManager } = useAuth();
  const { addSale, cancelSale, sales } = useStore();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [items,   setItems]   = useState<FoodItem[]>(IS_LOCAL ? LOCAL_FOOD_ITEMS : []);
  const [qty,     setQty]     = useState<QtyMap>({});
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState("");

  const [editing,  setEditing]  = useState<FoodItem | null>(null);
  const [newName,  setNewName]  = useState("");
  const [newPrice, setNewPrice] = useState("");

  const refresh = useCallback(async () => {
    if (IS_LOCAL) return;
    const { data, error } = await supabase
      .from("food_items")
      .select("id, name, price_usd, is_active")
      .eq("is_active", true)
      .order("name");
    if (!error && data) setItems(data as FoodItem[]);
  }, [supabase]);

  useEffect(() => {
    if (IS_LOCAL) return;
    void refresh();
    const ch = supabase
      .channel("food_items_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "food_items" }, () => void refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, refresh]);

  const inc = (id: string) => setQty((q) => ({ ...q, [id]: (q[id] ?? 0) + 1 }));
  const dec = (id: string) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) - 1) }));

  const totalUSD = useMemo(
    () => items.reduce((sum, it) => sum + (qty[it.id] ?? 0) * Number(it.price_usd), 0),
    [items, qty]
  );
  const orderedCount = useMemo(
    () => Object.values(qty).reduce((a, n) => a + (n > 0 ? 1 : 0), 0),
    [qty]
  );

  // Today's kitchen sales from store
  const today = new Date().toISOString().slice(0, 10);
  const todayKitchenSales = useMemo(
    () => sales.filter(s => s.source === "kitchen" && !s.isReversal && s.createdAt.startsWith(today))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sales, today]
  );

  function handleOrder() {
    setError(""); setSuccess("");
    if (!user) { setError("يجب تسجيل الدخول."); return; }
    const lines = items.map((it) => ({ it, q: qty[it.id] ?? 0 })).filter((l) => l.q > 0);
    if (lines.length === 0) { setError("اختر صنفاً واحداً على الأقل."); return; }

    setBusy(true);
    for (const { it, q } of lines) {
      const unitPrice = Number(it.price_usd);
      const total     = Number((q * unitPrice).toFixed(4));

      // Write to local store immediately
      addSale({
        productId:     it.id,
        productName:   it.name,
        quantity:      q,
        unitPrice,
        total,
        currency:      "usd",
        source:        "kitchen",
        paymentMethod: "cash",
        createdBy:     user.id,
        isReversal:    false,
      });
    }
    setBusy(false);
    setSuccess(`تم تسجيل الطلب — $${totalUSD.toFixed(2)}`);
    setQty({});
    setTimeout(() => setSuccess(""), 2500);
  }

  async function saveNewItem() {
    setError("");
    const name  = newName.trim();
    const price = Number(newPrice);
    if (!name) { setError("الاسم مطلوب."); return; }
    if (!Number.isFinite(price) || price <= 0) { setError("سعر غير صالح."); return; }
    if (IS_LOCAL) {
      setItems(prev => [...prev, { id: `food-${Date.now()}`, name, price_usd: price, is_active: true }]);
      setNewName(""); setNewPrice("");
      return;
    }
    const { error: e } = await supabase
      .from("food_items")
      .insert({ name, price_usd: price, created_by: user?.id ?? null });
    if (e) { setError(e.message); return; }
    setNewName(""); setNewPrice("");
  }

  async function saveEditItem() {
    if (!editing) return;
    setError("");
    if (IS_LOCAL) {
      setItems(prev => prev.map(it => it.id === editing.id ? editing : it));
      setEditing(null);
      return;
    }
    const { error: e } = await supabase
      .from("food_items")
      .update({ name: editing.name, price_usd: editing.price_usd, updated_at: new Date().toISOString() })
      .eq("id", editing.id);
    if (e) { setError(e.message); return; }
    setEditing(null);
  }

  async function deactivate(id: string) {
    setError("");
    if (IS_LOCAL) {
      setItems(prev => prev.filter(it => it.id !== id));
      setEditing(null);
      return;
    }
    const { error: e } = await supabase
      .from("food_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (e) setError(e.message);
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
            {items.length} صنف
          </span>
        </div>
      </div>

      {/* Items grid */}
      <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {items.length === 0 ? (
          <div className="col-span-full text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest py-6">
            لا توجد أصناف.
          </div>
        ) : (
          items.map((it) => {
            const q         = qty[it.id] ?? 0;
            const lineTotal = q * Number(it.price_usd);
            return (
              <div key={it.id}
                className={`p-3 border rounded-sm transition-colors ${q > 0 ? "border-[#F5C100]/50 bg-[#F5C100]/5" : "border-[#252525] bg-[#111111]"}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-body text-xs text-[#F0EDE6] flex-1">{it.name}</p>
                  {isManager && (
                    <button onClick={() => setEditing(it)} className="text-[#555555] hover:text-[#F5C100] transition-colors" title="تعديل">
                      <Pencil size={11} />
                    </button>
                  )}
                </div>
                <p className="font-display text-base text-[#F5C100] tracking-wider">
                  ${Number(it.price_usd).toFixed(2)}
                </p>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => dec(it.id)} disabled={q === 0}
                      className="w-6 h-6 rounded-sm border border-[#252525] bg-[#111111] hover:border-[#555555] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-[#AAAAAA]">
                      <Minus size={11} />
                    </button>
                    <span className="font-mono tabular-nums text-xs text-[#F0EDE6] w-6 text-center">{q}</span>
                    <button onClick={() => inc(it.id)}
                      className="w-6 h-6 rounded-sm border border-[#F5C100]/40 bg-[#F5C100]/10 hover:bg-[#F5C100]/20 flex items-center justify-center text-[#F5C100]">
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
        <button onClick={handleOrder} disabled={busy || totalUSD === 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm cursor-pointer">
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
              <div key={s.id}
                className={`flex items-center gap-3 px-5 py-2 transition-colors ${s.cancelled ? "opacity-40 bg-[#1A0A0A]/30" : "hover:bg-[#252525]/20"}`}>
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
                  <button onClick={() => cancelSale(s.id)}
                    className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer" title="إلغاء">
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

      {/* Manager: add / edit menu */}
      {isManager && (
        <div className="border-t border-[#252525] px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-2.5">
            إدارة القائمة (المدير فقط)
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">صنف جديد</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="اسم الصنف"
                className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/50" />
            </div>
            <div className="flex flex-col gap-1 w-32">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">السعر ($)</label>
              <input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)}
                placeholder="0.00"
                className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/50 font-mono tabular-nums" />
            </div>
            <button onClick={saveNewItem}
              className="flex items-center gap-1.5 px-3 py-2 border border-[#F5C100]/40 bg-[#F5C100]/10 hover:bg-[#F5C100]/20 text-[#F5C100] font-mono text-[10px] uppercase tracking-widest rounded-sm transition-colors">
              <Plus size={11} />إضافة
            </button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
          <div className="bg-[#1A1A1A] border border-[#252525] p-6 rounded-sm max-w-sm w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base tracking-wider text-[#F0EDE6]">تعديل صنف</h3>
              <button onClick={() => setEditing(null)} className="text-[#555555] hover:text-[#F0EDE6]"><X size={14} /></button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الاسم</label>
                <input type="text" value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full mt-1 bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/50" />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">السعر ($)</label>
                <input type="number" value={editing.price_usd}
                  onChange={(e) => setEditing({ ...editing, price_usd: Number(e.target.value) })}
                  className="w-full mt-1 bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/50" />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button onClick={() => deactivate(editing.id)}
                className="px-3 py-2 border border-[#FF3333]/40 bg-[#FF3333]/10 hover:bg-[#FF3333]/20 text-[#FF3333] font-mono text-[10px] uppercase tracking-widest rounded-sm transition-colors">
                إخفاء من القائمة
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(null)}
                  className="px-3 py-2 border border-[#252525] bg-[#111111] hover:border-[#555555] text-[#AAAAAA] font-mono text-[10px] uppercase tracking-widest rounded-sm transition-colors">
                  إلغاء
                </button>
                <button onClick={saveEditItem}
                  className="px-3 py-2 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display text-[10px] uppercase tracking-widest rounded-sm transition-colors">
                  حفظ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
