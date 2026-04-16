"use client";

import { useState, useMemo } from "react";
import {
  AlertTriangle,
  ShoppingCart,
  TrendingUp,
  Package,
  RotateCcw,
  CheckCircle,
} from "lucide-react";
import {
  Product,
  Sale,
  ProductCategory,
  PaymentMethod,
} from "@/lib/types";
import {
  formatCurrency,
  formatTime,
  getProductCategoryLabel,
  getPaymentMethodLabel,
  generateId,
  isLowStock,
  isOutOfStock,
} from "@/lib/business-logic";
import { PRODUCTS, SALES, STAFF } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import BarcodeScanner, { ALL_CATALOG, type CatalogItem } from "@/components/BarcodeScanner";

// ── Category badge colours ────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<ProductCategory, string> = {
  supplements:  "bg-[#F5C100]/15 text-[#F5C100] border border-[#F5C100]/25",
  wearables:    "bg-[#555555]/20 text-[#AAAAAA] border border-[#555555]/30",
  protein_cups: "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  bca_drinks:   "bg-[#C49A00]/15 text-[#C49A00] border border-[#C49A00]/25",
  meals:        "bg-[#F5C100]/10 text-[#FFD740] border border-[#FFD740]/20",
  other:        "bg-[#252525] text-[#777777] border border-[#555555]/30",
};

const METHOD_STYLES: Record<PaymentMethod, string> = {
  cash:     "bg-[#5CC45C]/12 text-[#5CC45C] border border-[#5CC45C]/25",
  card:     "bg-[#F5C100]/12 text-[#F5C100] border border-[#F5C100]/25",
  transfer: "bg-[#AAAAAA]/12 text-[#AAAAAA] border border-[#AAAAAA]/25",
  other:    "bg-[#252525] text-[#777777] border border-[#555555]/30",
};

const TODAY = "2026-04-14";

function isTodaySale(sale: Sale): boolean {
  return sale.createdAt.startsWith(TODAY);
}

// ── Sub-component: Category Badge ─────────────────────────────────────────────

function CategoryBadge({ category }: { category: ProductCategory }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${CATEGORY_STYLES[category]}`}>
      {getProductCategoryLabel(category)}
    </span>
  );
}

function MethodBadge({ method }: { method: PaymentMethod }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide ${METHOD_STYLES[method]}`}>
      {getPaymentMethodLabel(method)}
    </span>
  );
}

// ── Sub-component: Stock Cell ──────────────────────────────────────────────────

function StockCell({ stock, threshold }: { stock: number; threshold: number }) {
  const outOfStock = isOutOfStock(stock);
  const lowStock   = isLowStock(stock, threshold);

  if (outOfStock) {
    return (
      <span className="font-mono tabular-nums text-[#D42B2B] flex items-center gap-1">
        <AlertTriangle size={11} className="shrink-0" />
        0
      </span>
    );
  }
  if (lowStock) {
    return (
      <span className="font-mono tabular-nums text-[#F5C100] flex items-center gap-1">
        <AlertTriangle size={11} className="shrink-0" />
        {stock}
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums text-[#5CC45C]">{stock}</span>
  );
}

// ── Sub-component: Margin Cell ────────────────────────────────────────────────

function MarginCell({ cost, price }: { cost: number; price: number }) {
  const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
  const colorClass =
    margin >= 40 ? "text-[#5CC45C]" :
    margin >= 25 ? "text-[#F5C100]" :
    "text-[#D42B2B]";

  return (
    <span className={`font-mono tabular-nums text-xs ${colorClass}`}>
      {margin}%
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function StoreBlock() {
  const { isManager } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const [sales,    setSales]    = useState<Sale[]>(SALES);

  // Quick-sale form state
  const [saleProductId, setSaleProductId] = useState<string>(PRODUCTS[0]?.id ?? "");
  const [saleQty,       setSaleQty]       = useState<number>(1);
  const [saleMethod,    setSaleMethod]    = useState<PaymentMethod>("cash");
  const [saleError,     setSaleError]     = useState<string>("");
  const [saleSuccess,   setSaleSuccess]   = useState<boolean>(false);

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

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleRecordSale() {
    setSaleError("");
    setSaleSuccess(false);

    if (!saleProductId) {
      setSaleError("اختر منتجاً.");
      return;
    }
    if (!saleQty || saleQty < 1) {
      setSaleError("يجب أن تكون الكمية 1 على الأقل.");
      return;
    }

    const product = products.find(p => p.id === saleProductId);
    if (!product) {
      setSaleError("المنتج غير موجود.");
      return;
    }
    if (saleQty > product.stock) {
      setSaleError(
        `مخزون غير كافٍ. المتاح: ${product.stock} وحدة.`
      );
      return;
    }

    const newSale: Sale = {
      id:            generateId(),
      productId:     product.id,
      productName:   product.name,
      quantity:      saleQty,
      unitPrice:     product.price,
      total:         product.price * saleQty,
      paymentMethod: saleMethod,
      createdAt:     new Date().toISOString(),
      createdBy:     "s3", // active session user
      isReversal:    false,
    };

    setProducts(prev =>
      prev.map(p =>
        p.id === product.id ? { ...p, stock: p.stock - saleQty } : p
      )
    );
    setSales(prev => [...prev, newSale]);
    setSaleQty(1);
    setSaleSuccess(true);
    setTimeout(() => setSaleSuccess(false), 2500);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm">

      {/* ── Section Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Package size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">
            المتجر والمخزون
          </h2>
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

      {/* ════════════════════════════════════════════════════════════════════
          A) INVENTORY TABLE
      ════════════════════════════════════════════════════════════════════ */}
      <div className="px-5 pt-4 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555] mb-2">
          المخزون
        </p>
      </div>

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
              ].map(h => (
                <th
                  key={h}
                  className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap"
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

              return (
                <tr
                  key={product.id}
                  className={[
                    "border-b border-[#252525]/60 transition-colors",
                    outOfStock
                      ? "hazard-stripe"
                      : lowStock
                      ? "border-l-2 border-l-[#D42B2B]/60 bg-[#D42B2B]/4 hover:bg-[#D42B2B]/8"
                      : "hover:bg-[#252525]/40",
                  ].join(" ")}
                >
                  {/* Product Name */}
                  <td className="px-4 py-2.5 font-medium text-[#F0EDE6] whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {lowStock && !outOfStock && (
                        <AlertTriangle size={11} className="text-[#D42B2B] shrink-0" />
                      )}
                      {product.name}
                    </div>
                  </td>
                  {/* Category */}
                  <td className="px-4 py-2.5">
                    <CategoryBadge category={product.category} />
                  </td>
                  {/* Cost — manager only */}
                  {isManager && (
                    <td className="px-4 py-2.5 font-mono text-[#777777] tabular-nums">
                      {formatCurrency(product.cost)}
                    </td>
                  )}
                  {/* Price */}
                  <td className="px-4 py-2.5 font-mono text-[#F0EDE6] tabular-nums">
                    {formatCurrency(product.price)}
                  </td>
                  {/* Stock */}
                  <td className="px-4 py-2.5">
                    <StockCell stock={product.stock} threshold={product.lowStockThreshold} />
                  </td>
                  {/* Margin — manager only */}
                  {isManager && (
                    <td className="px-4 py-2.5">
                      <MarginCell cost={product.cost} price={product.price} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          B) TODAY'S SALES TABLE
      ════════════════════════════════════════════════════════════════════ */}
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          مبيعات اليوم
        </p>
        <span className="font-mono text-[10px] text-[#555555]">
          {todaySales.length} معاملة
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-[#252525] bg-[#111111]">
              {["الوقت", "المنتج", "الكمية", "سعر الوحدة", "الإجمالي", "الطريقة", "الموظف"].map(h => (
                <th
                  key={h}
                  className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-[#555555] whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {todaySales.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
                  لا توجد مبيعات مسجلة اليوم
                </td>
              </tr>
            ) : (
              todaySales.map(sale => {
                const staff = STAFF.find(s => s.id === sale.createdBy);
                return (
                  <tr
                    key={sale.id}
                    className={[
                      "border-b border-[#252525]/60 hover:bg-[#252525]/30 transition-colors",
                      sale.isReversal ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    {/* Time */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-[#777777] tabular-nums whitespace-nowrap">
                      {formatTime(sale.createdAt)}
                    </td>
                    {/* Product */}
                    <td className="px-4 py-2.5 text-[#F0EDE6] whitespace-nowrap">
                      {sale.isReversal ? (
                        <span className="line-through text-[#777777]">{sale.productName}</span>
                      ) : (
                        sale.productName
                      )}
                    </td>
                    {/* Qty */}
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#AAAAAA]">
                      {sale.isReversal ? (
                        <span className="line-through">{sale.quantity}</span>
                      ) : (
                        sale.quantity
                      )}
                    </td>
                    {/* Unit Price */}
                    <td className="px-4 py-2.5 font-mono tabular-nums text-[#777777]">
                      {sale.isReversal ? (
                        <span className="line-through">{formatCurrency(sale.unitPrice)}</span>
                      ) : (
                        formatCurrency(sale.unitPrice)
                      )}
                    </td>
                    {/* Total */}
                    <td className="px-4 py-2.5 font-mono tabular-nums font-medium">
                      {sale.isReversal ? (
                        <span className="line-through text-[#D42B2B]">
                          {formatCurrency(sale.total)}
                        </span>
                      ) : (
                        <span className="text-[#F0EDE6]">{formatCurrency(sale.total)}</span>
                      )}
                    </td>
                    {/* Method */}
                    <td className="px-4 py-2.5">
                      <MethodBadge method={sale.paymentMethod} />
                    </td>
                    {/* Staff */}
                    <td className="px-4 py-2.5 text-[#777777] whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {staff?.name ?? sale.createdBy}
                        {sale.isReversal && (
                          <span className="inline-block px-1.5 py-0.5 bg-[#D42B2B]/15 border border-[#D42B2B]/35 rounded text-[9px] font-mono uppercase tracking-wide text-[#FF3333]">
                            مُسترجع
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sales summary line */}
      <div className="flex items-center justify-end gap-2 px-5 py-2.5 border-t border-[#252525] bg-[#111111]/60">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          إجمالي اليوم
        </span>
        <span className="font-mono tabular-nums text-sm font-medium text-[#F5C100] glow-gold-sm">
          {formatCurrency(todayTotal)}$
        </span>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          QUICK SALE FORM
      ════════════════════════════════════════════════════════════════════ */}
      <div className="border-t border-[#252525] px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingCart size={12} className="text-[#F5C100]" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
            بيع سريع
          </p>
          <BarcodeScanner
            onItemFound={(item: CatalogItem) => {
              // Find matching product in our store products
              const match = products.find(
                (p) => p.name === item.name || p.id === item.id
              );
              if (match) {
                setSaleProductId(match.id);
                setSaleQty(1);
                setSaleError("");
              }
            }}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {/* Product select */}
          <div className="flex flex-col gap-1 min-w-[180px] flex-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              المنتج
            </label>
            <select
              value={saleProductId}
              onChange={e => { setSaleProductId(e.target.value); setSaleError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              {products.map(p => (
                <option key={p.id} value={p.id} disabled={isOutOfStock(p.stock)}>
                  {p.name}
                  {isOutOfStock(p.stock) ? " — نفد المخزون" : isLowStock(p.stock, p.lowStockThreshold) ? ` (${p.stock} متبقي)` : ""}
                  {" · "}{p.price}{"$"}
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="flex flex-col gap-1 w-20">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              الكمية
            </label>
            <input
              type="number"
              min={1}
              max={selectedProduct?.stock ?? 999}
              value={saleQty}
              onChange={e => { setSaleQty(Number(e.target.value)); setSaleError(""); }}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-mono tabular-nums focus:outline-none focus:border-[#F5C100]/50 transition-colors text-center"
            />
          </div>

          {/* Payment method */}
          <div className="flex flex-col gap-1 w-28">
            <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
              الطريقة
            </label>
            <select
              value={saleMethod}
              onChange={e => setSaleMethod(e.target.value as PaymentMethod)}
              className="bg-[#111111] border border-[#252525] rounded-sm px-3 py-2 text-xs text-[#F0EDE6] font-body focus:outline-none focus:border-[#F5C100]/50 transition-colors"
            >
              <option value="cash">نقدي</option>
              <option value="card">بطاقة</option>
              <option value="transfer">تحويل</option>
            </select>
          </div>

          {/* Total preview */}
          {selectedProduct && saleQty > 0 && (
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
                الإجمالي
              </label>
              <div className="px-3 py-2 bg-[#0A0A0A] border border-[#252525]/60 rounded-sm font-mono tabular-nums text-xs text-[#F5C100]">
                {formatCurrency(selectedProduct.price * saleQty)}$
              </div>
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleRecordSale}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] active:bg-[#C49A00] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors clip-corner-sm shrink-0 self-end"
          >
            <ShoppingCart size={12} />
            تسجيل بيع
          </button>
        </div>

        {/* Error / success feedback */}
        {saleError && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#FF3333]">
            <AlertTriangle size={11} />
            {saleError}
          </div>
        )}
        {saleSuccess && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[#5CC45C]">
            <CheckCircle size={11} />
            تم تسجيل البيع بنجاح.
          </div>
        )}
      </div>
    </div>
  );
}
