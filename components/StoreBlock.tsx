"use client";

import { Fragment, useState, useMemo } from "react";
import {
  AlertTriangle,
  ShoppingCart,
  TrendingUp,
  Package,
  Check,
  X,
  Pencil,
  Plus,
  Clock,
  Undo2,
} from "lucide-react";
import {
  Product,
  Sale,
  ProductCategory,
  Currency,
} from "@/lib/types";
import {
  formatCurrency,
  formatTime,
  getProductCategoryLabel,
  isLowStock,
  isOutOfStock,
} from "@/lib/business-logic";
import { STAFF } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { useStore } from "@/lib/store-context";
import { useCurrency } from "@/lib/currency-context";
import { pushSale, cancelTransaction, persistProductStockAdjustment } from "@/lib/supabase/intake";
import BarcodeScanner, { type CatalogItem } from "@/components/BarcodeScanner";

const PRODUCT_CATEGORY_OPTIONS: ProductCategory[] = [
  "protein", "mass_gainer", "creatine", "amino",
  "pre_workout", "fat_burner", "health", "focus",
  "accessory", "drink", "water", "other",
];

// ── Category badge colours ────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<ProductCategory, string> = {
  protein:     "bg-[#F5C100]/15 text-[#F5C100] border border-[#F5C100]/25",
  mass_gainer: "bg-[#C49A00]/15 text-[#C49A00] border border-[#C49A00]/25",
  creatine:    "bg-[#5CC45C]/15 text-[#5CC45C] border border-[#5CC45C]/25",
  amino:       "bg-[#4AA8E8]/15 text-[#4AA8E8] border border-[#4AA8E8]/25",
  pre_workout: "bg-[#E85454]/15 text-[#E85454] border border-[#E85454]/25",
  fat_burner:  "bg-[#FF7A00]/15 text-[#FF7A00] border border-[#FF7A00]/25",
  health:      "bg-[#7DDE7D]/15 text-[#7DDE7D] border border-[#7DDE7D]/25",
  focus:       "bg-[#9B59B6]/15 text-[#9B59B6] border border-[#9B59B6]/25",
  accessory:   "bg-[#AAAAAA]/15 text-[#AAAAAA] border border-[#AAAAAA]/25",
  drink:       "bg-[#4AA8E8]/15 text-[#4AA8E8] border border-[#4AA8E8]/25",
  water:       "bg-[#7DDEDE]/15 text-[#7DDEDE] border border-[#7DDEDE]/25",
  other:       "bg-[#252525] text-[#777777] border border-[#555555]/30",
};

const CURRENCY_STYLES: Record<Currency, string> = {
  syp: "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  usd: "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25",
};

const CURRENCY_LABEL: Record<Currency, string> = {
  syp: "ل.س",
  usd: "$",
};

const CATEGORY_GROUP_ORDER: ProductCategory[] = [
  "protein",
  "mass_gainer",
  "creatine",
  "amino",
  "pre_workout",
  "fat_burner",
  "health",
  "focus",
  "accessory",
  "drink",
  "water",
  "other",
];

const TODAY = new Date().toISOString().slice(0, 10);

function isTodaySale(sale: Sale): boolean {
  return sale.createdAt.startsWith(TODAY);
}

function CategoryBadge({ category }: { category: ProductCategory }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${CATEGORY_STYLES[category]}`}>
      {getProductCategoryLabel(category)}
    </span>
  );
}

function CurrencyBadge({ currency }: { currency: Currency }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${CURRENCY_STYLES[currency]}`}>
      {CURRENCY_LABEL[currency]}
    </span>
  );
}

function StockCell({ stock, threshold }: { stock: number; threshold: number }) {
  if (isOutOfStock(stock)) {
    return (
      <span className="font-mono tabular-nums text-[#D42B2B] flex items-center gap-1">
        <AlertTriangle size={11} className="shrink-0" />0
      </span>
    );
  }
  if (isLowStock(stock, threshold)) {
    return (
      <span className="font-mono tabular-nums text-[#F5C100] flex items-center gap-1">
        <AlertTriangle size={11} className="shrink-0" />{stock}
      </span>
    );
  }
  return <span className="font-mono tabular-nums text-[#5CC45C]">{stock}</span>;
}

// Margin display with colour
function MarginPct({ cost, price }: { cost: number; price: number }) {
  const pct = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  const cls = pct >= 40 ? "text-[#5CC45C]" : pct >= 25 ? "text-[#F5C100]" : "text-[#D42B2B]";
  return <span className={`font-mono tabular-nums text-xs ${cls}`}>{pct}%</span>;
}

// ── Price-edit popover for managers ───────────────────────────────────────────

interface PriceEditRowProps {
  product: Product;
  onSave: (cost: number, price: number) => void;
  onCancel: () => void;
}

function PriceEditRow({ product, onSave, onCancel }: PriceEditRowProps) {
  const [costInput, setCostInput]   = useState(product.cost == null ? "" : String(product.cost));
  const [markupInput, setMarkupInput] = useState("");

  // Compute preview
  const cost  = parseFloat(costInput) || 0;
  const markup = markupInput.trim();
  let previewPrice = product.price;
  let markupPct = 0;

  if (markup.endsWith("%")) {
    const pct = parseFloat(markup);
    if (!isNaN(pct) && pct > 0) {
      previewPrice = Math.round(cost / (1 - pct / 100));
      markupPct = Math.round(((previewPrice - cost) / previewPrice) * 100);
    }
  } else if (markup !== "") {
    const added = parseFloat(markup);
    if (!isNaN(added) && added >= 0) {
      previewPrice = Math.round(cost + added);
      markupPct = previewPrice > 0 ? Math.round(((previewPrice - cost) / previewPrice) * 100) : 0;
    }
  } else {
    markupPct = previewPrice > 0 ? Math.round(((previewPrice - cost) / previewPrice) * 100) : 0;
  }

  function handleSave() {
    if (cost <= 0) return;
    onSave(cost, previewPrice);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] text-[#555555]">تكلفة ($)</span>
        <input
          type="number"
          value={costInput}
          onChange={(e) => setCostInput(e.target.value)}
          className="w-20 bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-xs text-[#F5C100] font-mono focus:outline-none focus:border-[#F5C100]/50"
          dir="ltr"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] text-[#555555]">ربح (مبلغ أو %)</span>
        <input
          type="text"
          value={markupInput}
          onChange={(e) => setMarkupInput(e.target.value)}
          placeholder="مثال: 50 أو 30%"
          className="w-28 bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-xs text-[#AAAAAA] font-mono focus:outline-none focus:border-[#F5C100]/50"
          dir="ltr"
        />
      </div>
      <div className="flex flex-col gap-0.5 opacity-70">
        <span className="font-mono text-[9px] text-[#555555]">سعر البيع</span>
        <span className="font-mono text-xs text-[#F0EDE6] px-2 py-1 bg-[#111111] border border-[#252525] rounded-sm">
          {formatCurrency(previewPrice)}$
          <span className="text-[#555555] mr-1 text-[10px]">({markupPct}%)</span>
        </span>
      </div>
      <div className="flex items-center gap-1 self-end pb-0.5">
        <button onClick={handleSave} className="p-1 text-[#5CC45C] hover:text-[#7DDE7D] cursor-pointer"><Check size={14} /></button>
        <button onClick={onCancel} className="p-1 text-[#777777] hover:text-[#FF3333] cursor-pointer"><X size={14} /></button>
      </div>
    </div>
  );
}

// ── Reception price-edit row (only sell price; no cost/markup/margin) ────────

interface ReceptionPriceEditRowProps {
  product: Product;
  onSave: (price: number) => void;
  onCancel: () => void;
}

function ReceptionPriceEditRow({ product, onSave, onCancel }: ReceptionPriceEditRowProps) {
  const [priceInput, setPriceInput] = useState(String(product.price));

  function handleSave() {
    const p = parseFloat(priceInput);
    if (!isFinite(p) || p <= 0) return;
    onSave(p);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[9px] text-[#555555]">سعر البيع ($)</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          className="w-24 bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-xs text-[#F5C100] font-mono focus:outline-none focus:border-[#F5C100]/50"
          dir="ltr"
          autoFocus
        />
      </div>
      <div className="flex items-center gap-1 self-end pb-0.5">
        <button onClick={handleSave} className="p-1 text-[#5CC45C] hover:text-[#7DDE7D] cursor-pointer"><Check size={14} /></button>
        <button onClick={onCancel} className="p-1 text-[#777777] hover:text-[#FF3333] cursor-pointer"><X size={14} /></button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function StoreBlock() {
  const { user, isManager } = useAuth();
  const { exchangeRate } = useCurrency();
  const {
    products,
    sales,
    addSale,
    cancelSale,
    reverseSale,
    updateProductPrice,
    adjustStock,
    addProduct,
    activityFeed,
  } = useStore();

  // Quick-sale form state
  const [saleProductId, setSaleProductId] = useState<string>(products[0]?.id ?? "");
  const [saleQty,       setSaleQty]       = useState<number>(1);
  const [saleCurrency,  setSaleCurrency]  = useState<Currency>("usd");
  const [saleError,     setSaleError]     = useState<string>("");
  const [saleSuccess,   setSaleSuccess]   = useState<boolean>(false);

  // Inline price editing (manager: cost+price, reception: price only)
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  // Inline stock-add (all roles)
  const [stockAddingId,    setStockAddingId]    = useState<string | null>(null);
  const [stockAddQty,      setStockAddQty]      = useState<string>("");
  const [stockAddBusy,     setStockAddBusy]     = useState(false);
  const [stockAddError,    setStockAddError]    = useState<string>("");
  const [productToast,     setProductToast]     = useState<string>("");

  // Add-product form (visible to all roles; reception-friendly — no cost field)
  const [showAddForm,       setShowAddForm]       = useState(false);
  const [newProductName,    setNewProductName]    = useState("");
  const [newProductCat,     setNewProductCat]     = useState<ProductCategory>("protein");
  const [newProductPrice,   setNewProductPrice]   = useState("");
  const [newProductCost,    setNewProductCost]    = useState("");
  const [newProductStock,   setNewProductStock]   = useState("");
  const [addProductError,   setAddProductError]   = useState("");
  const [addProductBusy,    setAddProductBusy]    = useState(false);

  // ── Derived values ─────────────────────────────────────────────────────────
  const todaySales = useMemo(
    () => sales.filter(isTodaySale).sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    ),
    [sales]
  );

  const todayTotal = useMemo(
    () => todaySales.reduce((sum, s) => sum + (s.isReversal ? -s.total : s.total), 0),
    [todaySales]
  );

  const lowStockCount = useMemo(
    () => products.filter(p => isLowStock(p.stock, p.lowStockThreshold) && !isOutOfStock(p.stock)).length,
    [products]
  );

  const selectedProduct = products.find(p => p.id === saleProductId);

  // Activity feed: sales only
  const saleFeed = useMemo(
    () => activityFeed.filter((e) => e.type === "sale" || e.type === "price_edit").slice(0, 15),
    [activityFeed]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleRecordSale() {
    setSaleError("");
    setSaleSuccess(false);

    if (!user) { setSaleError("يجب تسجيل الدخول."); return; }
    if (!saleProductId) { setSaleError("اختر منتجاً."); return; }
    if (!saleQty || saleQty < 1) { setSaleError("يجب أن تكون الكمية 1 على الأقل."); return; }

    const product = products.find(p => p.id === saleProductId);
    if (!product) { setSaleError("المنتج غير موجود."); return; }
    if (saleQty > product.stock) {
      setSaleError(`مخزون غير كافٍ. المتاح: ${product.stock} وحدة.`);
      return;
    }

    const r = await pushSale({
      user: { id: user.id, displayName: user.displayName },
      productName: product.name,
      quantity: saleQty,
      unitPrice: product.price,
      total: product.price * saleQty,
      currency: saleCurrency,
      exchangeRate,
      source: "store",
    });
    if (r.error) { setSaleError(r.error); return; }

    const row = r.data!;
    addSale({
      id:            String(row.id),
      productId:     product.id,
      productName:   product.name,
      quantity:      saleQty,
      unitPrice:     product.price,
      total:         product.price * saleQty,
      paymentMethod: saleCurrency === "syp" ? "cash" : "transfer",
      currency:      saleCurrency,
      source:        "store",
      createdAt:     String(row.created_at ?? new Date().toISOString()),
      createdBy:     user.id,
      isReversal:    false,
    });

    setSaleQty(1);
    setSaleSuccess(true);
    setTimeout(() => setSaleSuccess(false), 2500);
  }

  async function handleAddProduct() {
    setAddProductError("");
    const name = newProductName.trim();
    if (!name) { setAddProductError("أدخل اسم المنتج."); return; }
    const price = parseFloat(newProductPrice);
    if (!isFinite(price) || price <= 0) { setAddProductError("سعر البيع غير صالح."); return; }
    const stock = newProductStock === "" ? 0 : parseInt(newProductStock, 10);
    if (!Number.isInteger(stock) || stock < 0) { setAddProductError("الكمية غير صالحة."); return; }
    // Cost is manager-only. Reception's input is hidden, so the value parses to 0.
    const cost = isManager && newProductCost !== "" ? parseFloat(newProductCost) : 0;
    if (isManager && newProductCost !== "" && (!isFinite(cost) || cost < 0)) {
      setAddProductError("التكلفة غير صالحة.");
      return;
    }

    setAddProductBusy(true);
    const r = await addProduct({
      name,
      category: newProductCat,
      cost,
      price,
      stock,
      lowStockThreshold: 3,
    });
    setAddProductBusy(false);
    if (r.error) { setAddProductError(r.error); return; }

    setNewProductName("");
    setNewProductPrice("");
    setNewProductCost("");
    setNewProductStock("");
    setShowAddForm(false);
    setProductToast("تمت إضافة المنتج");
    setTimeout(() => setProductToast(""), 2000);
  }

  // Group products by category for the sale select
  const productsByCategory = useMemo(() => {
    const groups: Partial<Record<ProductCategory, Product[]>> = {};
    for (const p of products) {
      (groups[p.category] ||= []).push(p);
    }
    return groups;
  }, [products]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">

      {/* ── Section Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Package size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">المتجر والمخزون</h2>
          <span className="px-2 py-0.5 bg-[#252525] border border-[#555555]/40 rounded text-[10px] font-mono text-[#AAAAAA]">
            {products.length} منتج
          </span>
          {lowStockCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-[#D42B2B]/12 border border-[#D42B2B]/30 rounded text-[10px] font-mono text-[#FF3333]">
              <AlertTriangle size={9} />
              مخزون منخفض: {lowStockCount}
            </span>
          )}
        </div>
        <TrendingUp size={13} className="text-[#555555]" />
      </div>

      {/* ════════════ QUICK SALE FORM (placed first) ════════════ */}
      <div className="px-5 py-4 border-b border-[#252525] bg-[#111111]/40">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingCart size={12} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">تسجيل بيع</p>
          <BarcodeScanner
            onItemFound={(item: CatalogItem) => {
              const match = products.find(p => p.name === item.name || p.id === item.id);
              if (match) { setSaleProductId(match.id); setSaleQty(1); setSaleError(""); }
            }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {/* Product select — grouped by category */}
          <div className="flex flex-col gap-1 min-w-[220px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">المنتج</label>
            <select
              value={saleProductId}
              onChange={e => { setSaleProductId(e.target.value); setSaleError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              {CATEGORY_GROUP_ORDER.map(cat => {
                const list = productsByCategory[cat];
                if (!list || list.length === 0) return null;
                return (
                  <optgroup key={cat} label={`— ${getProductCategoryLabel(cat)} —`}>
                    {list.map(p => (
                      <option key={p.id} value={p.id} disabled={isOutOfStock(p.stock)}>
                        {p.name}
                        {isOutOfStock(p.stock) ? " — نفد المخزون" : isLowStock(p.stock, p.lowStockThreshold) ? ` (${p.stock} متبقي)` : ""}
                        {" · "}{p.price}{"$"}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          {/* Quantity */}
          <div className="flex flex-col gap-1 w-20">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الكمية</label>
            <input
              type="number" min={1} max={selectedProduct?.stock ?? 999}
              value={saleQty}
              onChange={e => { setSaleQty(Number(e.target.value)); setSaleError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/50 transition-colors text-center"
            />
          </div>

          {/* Currency */}
          <div className="flex flex-col gap-1 w-32">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">العملة</label>
            <select
              value={saleCurrency}
              onChange={e => setSaleCurrency(e.target.value as Currency)}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              <option value="usd">دولار</option>
              <option value="syp">ليرة سورية</option>
            </select>
          </div>

          {/* Total preview */}
          {selectedProduct && saleQty > 0 && (
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">الإجمالي</label>
              <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100] whitespace-nowrap">
                {formatCurrency(selectedProduct.price * saleQty)}$
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleRecordSale}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm shrink-0 self-end cursor-pointer"
          >
            <ShoppingCart size={12} />
            تسجيل بيع
          </button>
        </div>

        {saleError && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]">
            <AlertTriangle size={11} />{saleError}
          </div>
        )}
        {saleSuccess && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]">
            <Check size={11} />تم تسجيل البيع بنجاح.
          </div>
        )}
      </div>

      {/* ════════════ A) INVENTORY TABLE ════════════ */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">المخزون</p>
        <button
          onClick={() => { setShowAddForm(v => !v); setAddProductError(""); }}
          className="flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded border border-[#F5C100]/30 text-[#F5C100] hover:bg-[#F5C100]/10 transition-colors cursor-pointer"
        >
          {showAddForm ? <X size={11} /> : <Plus size={11} />}
          {showAddForm ? "إلغاء" : "إضافة منتج جديد"}
        </button>
      </div>

      {showAddForm && (
        <div className="px-5 pb-3">
          <div className="bg-[#111111]/60 border border-[#252525] rounded-sm p-3 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1 min-w-[180px] flex-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">اسم المنتج</label>
              <input
                value={newProductName}
                onChange={e => setNewProductName(e.target.value)}
                placeholder="مثال: واي بروتين"
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/40"
              />
            </div>
            <div className="flex flex-col gap-1 w-44">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">التصنيف</label>
              <select
                value={newProductCat}
                onChange={e => setNewProductCat(e.target.value as ProductCategory)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/40"
              >
                {PRODUCT_CATEGORY_OPTIONS.map(c => (
                  <option key={c} value={c}>{getProductCategoryLabel(c)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 w-28">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">سعر البيع ($)</label>
              <input
                type="number" min="0" step="0.01"
                value={newProductPrice}
                onChange={e => setNewProductPrice(e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F5C100] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/40"
                dir="ltr"
              />
            </div>
            {isManager && (
              <div className="flex flex-col gap-1 w-28">
                <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">التكلفة ($)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={newProductCost}
                  onChange={e => setNewProductCost(e.target.value)}
                  className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#777777] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/40"
                  dir="ltr"
                />
              </div>
            )}
            <div className="flex flex-col gap-1 w-24">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">المخزون</label>
              <input
                type="number" min="0" step="1"
                value={newProductStock}
                onChange={e => setNewProductStock(e.target.value)}
                className="bg-[#0A0A0A] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/40"
                dir="ltr"
              />
            </div>
            <button
              onClick={handleAddProduct}
              disabled={addProductBusy}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm cursor-pointer disabled:opacity-50"
            >
              <Plus size={12} />
              {addProductBusy ? "جاري…" : "إضافة"}
            </button>
          </div>
          {addProductError && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]">
              <AlertTriangle size={11} />{addProductError}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {[
                "اسم المنتج",
                "التصنيف",
                ...(isManager ? ["التكلفة ($)"] : []),
                "السعر ($)",
                "المخزون",
                ...(isManager ? ["هامش الربح"] : []),
                "",
              ].map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map(product => {
              const outOfStock = isOutOfStock(product.stock);
              const lowStock   = isLowStock(product.stock, product.lowStockThreshold);
              const isEditing  = editingProductId === product.id;

              return (
                <Fragment key={product.id}>
                  <tr
                    className={[
                      "border-b border-[#252525]/60 transition-colors",
                      outOfStock ? "hazard-stripe" :
                      lowStock ? "border-l-2 border-l-[#D42B2B]/60 bg-[#D42B2B]/4 hover:bg-[#D42B2B]/8" :
                      "hover:bg-[#252525]/40",
                    ].join(" ")}
                  >
                    {/* Product Name */}
                    <td className="px-4 py-2.5 font-medium text-[#F0EDE6] whitespace-nowrap text-right">
                      <div className="flex items-center gap-2 justify-start">
                        {product.name}
                        {lowStock && !outOfStock && (
                          <AlertTriangle size={11} className="text-[#D42B2B] shrink-0" />
                        )}
                      </div>
                    </td>
                    {/* Category */}
                    <td className="px-4 py-2.5 text-right">
                      <CategoryBadge category={product.category} />
                    </td>
                    {/* Cost — manager only */}
                    {isManager && (
                      <td className="px-4 py-2.5 font-mono text-[#777777] tabular-nums text-right">
                        {product.cost == null ? "—" : formatCurrency(product.cost)}
                      </td>
                    )}
                    {/* Price */}
                    <td className="px-4 py-2.5 font-mono text-[#F0EDE6] tabular-nums text-right">
                      {formatCurrency(product.price)}
                    </td>
                    {/* Stock */}
                    <td className="px-4 py-2.5 text-right">
                      <StockCell stock={product.stock} threshold={product.lowStockThreshold} />
                    </td>
                    {/* Margin — manager only */}
                    {isManager && (
                      <td className="px-4 py-2.5 text-right">
                        {product.cost == null ? <span className="font-mono text-xs text-[#555555]">—</span> : <MarginPct cost={product.cost} price={product.price} />}
                      </td>
                    )}
                    {/* Actions: edit price + add stock — all roles */}
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {isEditing ? (
                          <button
                            onClick={() => setEditingProductId(null)}
                            className="text-[#555555] hover:text-[#FF3333] cursor-pointer"
                            title="إلغاء"
                          >
                            <X size={13} />
                          </button>
                        ) : (
                          <button
                            onClick={() => { setEditingProductId(product.id); setStockAddingId(null); }}
                            className="text-[#555555] hover:text-[#F5C100] transition-colors cursor-pointer"
                            title="تعديل السعر"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setStockAddingId(stockAddingId === product.id ? null : product.id);
                            setStockAddQty("");
                            setStockAddError("");
                            if (editingProductId === product.id) setEditingProductId(null);
                          }}
                          className="font-mono text-[10px] px-2 py-0.5 rounded border border-[#5CC45C]/30 text-[#5CC45C] hover:bg-[#5CC45C]/10 transition-colors cursor-pointer whitespace-nowrap"
                          title="إضافة مخزون"
                        >
                          إضافة مخزون
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Inline price-edit row */}
                  {isEditing && (
                    <tr key={`edit-${product.id}`} className="bg-[#111111] border-b border-[#252525]/60">
                      <td colSpan={isManager ? 7 : 5} className="px-4 py-2">
                        {isManager ? (
                          <PriceEditRow
                            product={product}
                            onSave={async (cost, price) => {
                              const r = await updateProductPrice(product.id, cost, price);
                              if (r.error) { setStockAddError(r.error); return; }
                              setEditingProductId(null);
                              setProductToast("تم تحديث السعر");
                              setTimeout(() => setProductToast(""), 2000);
                            }}
                            onCancel={() => setEditingProductId(null)}
                          />
                        ) : (
                          <ReceptionPriceEditRow
                            product={product}
                            onSave={async (price) => {
                              const r = await updateProductPrice(product.id, product.cost ?? 0, price);
                              if (r.error) { setStockAddError(r.error); return; }
                              setEditingProductId(null);
                              setProductToast("تم تحديث السعر");
                              setTimeout(() => setProductToast(""), 2000);
                            }}
                            onCancel={() => setEditingProductId(null)}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                  {/* Inline stock-add row */}
                  {stockAddingId === product.id && (
                    <tr key={`stock-${product.id}`} className="bg-[#111111] border-b border-[#252525]/60">
                      <td colSpan={isManager ? 7 : 5} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إضافة مخزون لـ {product.name}</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={stockAddQty}
                            onChange={(e) => setStockAddQty(e.target.value)}
                            placeholder="الكمية"
                            className="w-24 bg-[#0A0A0A] border border-[#252525] rounded-sm px-2 py-1 text-xs text-[#F0EDE6] focus:outline-none focus:border-[#F5C100]/40"
                          />
                          <button
                            onClick={async () => {
                              if (!user) { setStockAddError("يجب تسجيل الدخول"); return; }
                              const n = parseInt(stockAddQty, 10);
                              if (!Number.isInteger(n) || n <= 0) { setStockAddError("كمية غير صالحة"); return; }
                              setStockAddBusy(true);
                              setStockAddError("");
                              const r = await persistProductStockAdjustment(product.id, n, { id: user.id, displayName: user.displayName });
                              setStockAddBusy(false);
                              if (r.error) { setStockAddError(r.error); return; }
                              adjustStock(product.id, n);
                              setStockAddingId(null);
                              setStockAddQty("");
                              setProductToast(`تمت إضافة ${n} وحدة`);
                              setTimeout(() => setProductToast(""), 2000);
                            }}
                            disabled={stockAddBusy}
                            className="font-mono text-[10px] px-3 py-1 rounded bg-[#5CC45C]/15 border border-[#5CC45C]/40 text-[#5CC45C] hover:bg-[#5CC45C]/25 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {stockAddBusy ? "جاري…" : "تأكيد"}
                          </button>
                          <button
                            onClick={() => { setStockAddingId(null); setStockAddQty(""); setStockAddError(""); }}
                            disabled={stockAddBusy}
                            className="font-mono text-[10px] text-[#777777] hover:text-[#FF3333] cursor-pointer"
                          >
                            إلغاء
                          </button>
                          {stockAddError && <span className="font-mono text-[10px] text-[#FF3333]">{stockAddError}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {productToast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-[#1A1A1A] border border-[#5CC45C]/40 rounded-sm font-mono text-xs text-[#5CC45C] shadow-lg">
          {productToast}
        </div>
      )}

      {/* ════════════ B) TODAY'S SALES TABLE ════════════ */}
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">مبيعات اليوم</p>
        <span className="font-mono text-[10px] text-[#555555]">{todaySales.length} معاملة</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {["الوقت", "المنتج", "الكمية", "سعر الوحدة", "الإجمالي", "العملة", "الموظف", ""].map(h => (
                <th key={h} className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {todaySales.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
                  لا توجد مبيعات مسجلة اليوم
                </td>
              </tr>
            ) : (
              todaySales.map(sale => {
                const staff = STAFF.find(s => s.id === sale.createdBy);
                return (
                  <tr
                    key={sale.id}
                    className={["border-b border-[#252525]/60 transition-colors", sale.isReversal || sale.cancelled ? "opacity-40 bg-[#1A0A0A]/30" : "hover:bg-[#252525]/30"].join(" ")}
                  >
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] tabular-nums whitespace-nowrap text-right">
                      {formatTime(sale.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap text-right">
                      {sale.isReversal || sale.cancelled ? <span className="line-through text-[#777777]">{sale.productName}</span> : sale.productName}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA] text-right">
                      {sale.isReversal ? <span className="line-through">{sale.quantity}</span> : sale.quantity}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777] text-right">
                      {sale.isReversal ? <span className="line-through">{formatCurrency(sale.unitPrice)}</span> : formatCurrency(sale.unitPrice)}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums font-medium text-right">
                      {sale.isReversal
                        ? <span className="line-through text-[#D42B2B]">{formatCurrency(sale.total)}</span>
                        : <span className="text-[#F0EDE6]">{formatCurrency(sale.total)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <CurrencyBadge currency={(sale.currency as Currency) ?? "usd"} />
                    </td>
                    <td className="px-4 py-2.5 text-[#777777] whitespace-nowrap text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        {staff?.name ?? sale.createdBy}
                        {sale.isReversal && (
                          <span className="inline-block px-1.5 py-0.5 bg-[#D42B2B]/15 border border-[#D42B2B]/35 rounded text-[9px] font-mono uppercase tracking-wide text-[#FF3333]">
                            مُسترجع
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!sale.isReversal && !sale.cancelled ? (
                        <button
                          onClick={async () => {
                            if (!user) return;
                            const r = await cancelTransaction({
                              user: { id: user.id, displayName: user.displayName },
                              table: "sales",
                              id: sale.id,
                            });
                            if (!r.error) cancelSale(sale.id);
                          }}
                          className="p-1 text-[#555555] hover:text-[#FF3333] transition-colors cursor-pointer"
                          title="إلغاء"
                        >
                          <Undo2 size={12} />
                        </button>
                      ) : sale.cancelled ? (
                        <span className="font-mono text-[9px] text-[#FF3333]">ملغي</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sales summary */}
      <div className="flex items-center justify-end gap-2 px-5 py-2.5 border-t border-[#252525] bg-[#111111]/60">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">إجمالي اليوم</span>
        <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100] glow-gold-sm">
          {formatCurrency(todayTotal)}$
        </span>
      </div>

      {/* Live activity feed */}
      {saleFeed.length > 0 && (
        <div className="border-t border-[#252525] px-5 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={11} className="text-[#555555]" />
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">سجل المبيعات</p>
            <span className="w-1.5 h-1.5 rounded-full bg-[#5CC45C] animate-pulse" />
          </div>
          <div className="space-y-1">
            {saleFeed.map((entry) => {
              const time = formatTime(entry.timestamp);
              return (
                <div key={entry.id} className="flex items-center justify-between py-1 border-b border-[#252525]/40 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[#555555]">{time}</span>
                    <span className="text-xs text-[#AAAAAA]">{entry.description}</span>
                  </div>
                  {entry.amountUSD != null && (
                    <span className="font-mono text-[10px] text-[#F5C100]">{formatCurrency(entry.amountUSD)}$</span>
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
