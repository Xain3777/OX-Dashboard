"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import {
  Product, Sale, Expense, ExpenseCategory, ExpenseFrequency, PaymentMethod, Subscription, FoodItem, FoodItemCategory,
  CatalogItem, CatalogItemCategory, CatalogItemType, ItemSale,
  PlanType, OfferType, PaymentStatus, SubStatus, Currency,
} from "./types";
import { PRODUCTS, FOOD_ITEMS } from "./mock-data";
import { generateId, calculateRemainingDays } from "./business-logic";
import { useAuth } from "./auth-context";
import { supabaseBrowser } from "./supabase/client";
import { fetchSessionIncome, SessionIncome, getActiveSession, getLastClosedSession } from "./supabase/session";
import {
  persistCatalogItemInsert,
  persistCatalogItemUpdate,
  persistCatalogItemDelete,
} from "./supabase/intake";

// ─── InBody ───────────────────────────────────────────────────────────────────

export type InBodyMemberType = "gym_member" | "non_member";

export type InBodySessionType = "single" | "package_5" | "package_10" | "gym_member" | "non_member";

export interface InBodySession {
  id: string;
  memberType: InBodyMemberType;
  memberId?: string;
  memberName: string;
  sessionType?: InBodySessionType;
  priceSYP: number;
  priceUSD: number;
  currency: "usd" | "syp";
  paymentMethod: PaymentMethod;
  cancelled?: boolean;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

// ─── Activity feed ────────────────────────────────────────────────────────────

export type ActivityType = "inbody" | "sale" | "expense" | "subscription" | "price_edit";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  description: string;
  amountUSD?: number;
  amountSYP?: number;
  userId: string;
  userName: string;
  timestamp: string;
}

// ─── Expense rates ────────────────────────────────────────────────────────────

export interface ExpenseRate {
  id: string;
  category: "salary" | "rent" | "utility" | "service" | "other";
  label: string;
  amount: number;
  frequency: "monthly" | "weekly" | "daily";
  active: boolean;
  lastUpdated: string;
}

// ─── Local session ────────────────────────────────────────────────────────────

export interface LocalSession {
  id: string;
  openingCash: number;
  openedAt: string;
  openedByName?: string;
  actualCash?: number;
  closedAt?: string;
  status: "open" | "closed";
  subsIncome?: number;
  storeIncome?: number;
  mealsIncome?: number;
  inbodyIncome?: number;
  totalIncome?: number;
  discrepancyNote?: string;
}

// ─── Full store state ─────────────────────────────────────────────────────────
//
// catalogItems + itemSales are the new unified surface (post-0030/0031).
// products + foodItems + sales are kept for backward compat during the
// component cutover; they're DERIVED from catalogItems / itemSales below
// rather than hydrated independently. Once every component reads from
// catalogItems / itemSales directly, the legacy fields go away.

export interface StoreState {
  // Unified catalog model (canonical)
  catalogItems: CatalogItem[];
  itemSales: ItemSale[];

  // Subscriptions / inbody / expenses / sessions / activity
  subscriptions: Subscription[];
  inBodySessions: InBodySession[];
  expenses: Expense[];
  activityFeed: ActivityEntry[];
  inBodyPrices: { member: number; nonMember: number };
  expenseRates: ExpenseRate[];
  exchangeRate: number;
  localSession: LocalSession | null;
  sessionHistory: LocalSession[];
  lastClosingCash: number;
  lastClosedByName: string;

  // Legacy compat fields — derived from catalogItems / itemSales for any
  // component that still reads them. Will be removed once the cutover is
  // complete.
  products: Product[];
  foodItems: FoodItem[];
  sales: Sale[];
}

// ─── Context type ─────────────────────────────────────────────────────────────

export interface CatalogItemDraft {
  name: string;
  category: CatalogItemCategory;
  itemType: CatalogItemType;
  sellCurrency: Currency;
  sellPrice: number;
  costCurrency?: Currency | null;
  costPrice?: number | null;
  stockQuantity?: number;
  trackStock?: boolean;
  lowStockThreshold?: number;
  sortOrder?: number;
  isActive?: boolean;
  description?: string | null;
}

export interface StoreContextType extends StoreState {
  // ── New unified catalog API ───────────────────────────────────
  addCatalogItem: (item: CatalogItemDraft) => Promise<{ error?: string }>;
  updateCatalogItem: (id: string, updates: Partial<CatalogItemDraft>) => Promise<{ error?: string }>;
  removeCatalogItem: (id: string) => Promise<{ error?: string }>;
  addItemSale: (sale: ItemSale) => void;
  cancelItemSale: (id: string) => void;

  // ── Legacy compat API ─────────────────────────────────────────
  addSale: (sale: Sale) => void;
  reverseSale: (saleId: string, reason?: string) => void;
  cancelSale: (id: string) => void;
  updateProductCost: (productId: string, cost: number) => void;
  updateProductPrice: (productId: string, cost: number, price: number) => Promise<{ error?: string }>;
  adjustStock: (productId: string, delta: number) => Promise<{ error?: string }>;
  addProduct: (product: Omit<Product, "id" | "createdAt">) => Promise<{ error?: string }>;
  addFoodItem: (item: Omit<FoodItem, "id">) => Promise<{ error?: string }>;
  updateFoodItem: (id: string, updates: Partial<FoodItem>) => Promise<{ error?: string }>;
  removeFoodItem: (id: string) => Promise<{ error?: string }>;
  addSubscription: (sub: Subscription) => void;
  replaceSubscription: (id: string, sub: Subscription) => void;
  cancelSubscriptionLocal: (id: string) => void;
  addInBodySession: (session: InBodySession) => void;
  cancelInBodySession: (id: string) => void;
  updateInBodyPrices: (member: number, nonMember: number) => void;
  addExpense: (expense: Expense) => void;
  updateExpenseLocal: (id: string, updates: Partial<Expense>) => void;
  removeExpenseLocal: (id: string) => void;
  updateExpenseRate: (id: string, amount: number) => void;
  addExpenseRate: (rate: Omit<ExpenseRate, "id" | "lastUpdated">) => void;
  toggleExpenseRate: (id: string) => void;
  setExchangeRate: (rate: number) => void;
  pushActivity: (entry: Omit<ActivityEntry, "id" | "timestamp">) => void;
  setLocalSession: (session: LocalSession | null) => void;
  openLocalSession: (openingCash?: number) => void;
  closeLocalSession: (actualCash: number, incomeSnapshot: SessionIncome, discrepancyNote?: string) => void;
  storeIncome: number;
  mealsIncome: number;
  subsIncome: number;
  inbodyIncome: number;
  totalIncome: number;
  runningCash: number;
  lastClosedByName: string;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: StoreState = {
  catalogItems: [],
  itemSales: [],
  products: PRODUCTS,
  foodItems: FOOD_ITEMS,
  sales: [],
  subscriptions: [],
  inBodySessions: [],
  expenses: [],
  activityFeed: [],
  inBodyPrices: { member: 60000, nonMember: 100000 },
  expenseRates: [],
  exchangeRate: 13200,
  localSession: null,
  sessionHistory: [],
  lastClosingCash: 0,
  lastClosedByName: "",
};

// ─── Row mappers + legacy adapters (shared by hydration + realtime) ──────────

type CatalogRow = Record<string, unknown>;

const catalogItemSort = (a: CatalogItem, b: CatalogItem) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);

function rowToCatalogItem(row: CatalogRow): CatalogItem {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? "other") as CatalogItemCategory,
    itemType: String(row.item_type ?? "other") as CatalogItemType,
    // Default to "syp" — this gym is SYP-priced for the vast majority of
    // catalog items. A NULL sell_currency would mean a bad row (every catalog
    // INSERT path supplies it), but defaulting to "syp" is the safer
    // misrecord: a SYP-priced item recorded as SYP at 7000 is fine, while
    // recording it as USD inflates downstream amount_syp by ~exchangeRate×.
    sellCurrency: String(row.sell_currency ?? "syp") as Currency,
    sellPrice: Number(row.sell_price ?? 0),
    costCurrency: row.cost_currency == null ? null : (String(row.cost_currency) as Currency),
    costPrice: row.cost_price == null ? null : Number(row.cost_price),
    stockQuantity: Number(row.stock_quantity ?? 0),
    trackStock: !!row.track_stock,
    lowStockThreshold: Number(row.low_stock_threshold ?? 3),
    sortOrder: Number(row.sort_order ?? 0),
    isActive: !!row.is_active,
    description: row.description == null ? null : String(row.description),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function rowToItemSale(row: CatalogRow): ItemSale {
  return {
    id: String(row.id),
    catalogItemId: row.catalog_item_id == null ? null : String(row.catalog_item_id),
    itemNameSnapshot: String(row.item_name_snapshot ?? ""),
    categorySnapshot: String(row.category_snapshot ?? "other") as CatalogItemCategory,
    itemTypeSnapshot: String(row.item_type_snapshot ?? "other") as CatalogItemType,
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    // Default "syp" for the same reason as sellCurrency above — recording
    // a SYP-priced sale as SYP is the safe misclassification; recording
    // it as USD blows up amount_syp by a 4-figure factor.
    originalCurrency: String(row.original_currency ?? "syp") as Currency,
    originalTotal: Number(row.original_total ?? 0),
    exchangeRateToSyp: row.exchange_rate_to_syp == null ? null : Number(row.exchange_rate_to_syp),
    amountSyp: row.amount_syp == null ? null : Number(row.amount_syp),
    amountUsd: row.amount_usd == null ? null : Number(row.amount_usd),
    source: String(row.source ?? "store") as "kitchen" | "store",
    paymentMethod: row.payment_method == null ? null : (String(row.payment_method) as PaymentMethod),
    cashSessionId: row.cash_session_id == null ? null : String(row.cash_session_id),
    createdBy: String(row.created_by ?? ""),
    createdByName: row.created_by_name == null ? null : String(row.created_by_name),
    createdAt: String(row.created_at ?? ""),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
    cancelledBy: row.cancelled_by == null ? null : String(row.cancelled_by),
    cancelledReason: row.cancelled_reason == null ? null : String(row.cancelled_reason),
  };
}

// ── Legacy adapters: derive FoodItem / Product / Sale from catalog ──
//
// Components that haven't migrated yet still read foodItems / products /
// sales. Until they do, we synthesise those views from the canonical
// catalogItems / itemSales arrays so legacy reads stay consistent with
// the new write paths.

const KITCHEN_TYPES = new Set(["meal", "water", "drink"]);
const STORE_TYPES   = new Set(["supplement", "product", "other", "water", "drink"]);

function catalogToFoodItem(c: CatalogItem): FoodItem {
  return {
    id: c.id,
    name: c.name,
    category: (
      c.category === "meals"       ? "meals"       :
      c.category === "meal_addons" ? "meal_addons" :
      c.category === "drinks"      ? "drinks"      :
      c.category === "other"       ? "other"       :
      "food"
    ) as FoodItemCategory,
    cost_syp: c.costCurrency === "syp" ? c.costPrice : null,
    cost_usd: c.costCurrency === "usd" ? c.costPrice : null,
    price_syp: c.sellCurrency === "syp" ? c.sellPrice : 0,
    is_active: c.isActive,
    description: c.description,
    sort_order: c.sortOrder,
    track_stock: c.trackStock,
    stock_quantity: c.stockQuantity,
    low_stock_threshold: c.lowStockThreshold,
  };
}

function catalogToProduct(c: CatalogItem): Product {
  // Map flat catalog_items.category back to the more granular legacy
  // ProductCategory union. Most rows came in as 'supplements' which we
  // can't disambiguate without a subcategory column — surface as 'other'
  // so the dropdown still rounds-trips.
  const cat: Product["category"] =
    c.itemType === "water"      ? "water" :
    c.itemType === "drink"      ? "drink" :
    c.itemType === "supplement" ? "other" :
    c.itemType === "product"    ? "accessory" :
    "other";
  return {
    id: c.id,
    name: c.name,
    category: cat,
    cost: c.costPrice,
    costCurrency: c.costCurrency ?? undefined,
    price: c.sellPrice,
    priceCurrency: c.sellCurrency,
    stock: c.stockQuantity,
    lowStockThreshold: c.lowStockThreshold,
    createdAt: c.createdAt,
  };
}

function itemSaleToSale(s: ItemSale): Sale {
  return {
    id: s.id,
    productId: s.catalogItemId ?? "",
    productName: s.itemNameSnapshot,
    quantity: s.quantity,
    unitPrice: s.unitPrice,
    total: s.originalTotal,
    paymentMethod: (s.paymentMethod ?? "cash") as PaymentMethod,
    currency: s.originalCurrency,
    source: s.source,
    cancelled: s.cancelledAt != null,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    isReversal: false,
  };
}

function deriveLegacyFromCatalog(
  catalogItems: CatalogItem[],
  itemSales: ItemSale[],
): { foodItems: FoodItem[]; products: Product[]; sales: Sale[] } {
  const foodItems = catalogItems
    .filter((c) => KITCHEN_TYPES.has(c.itemType))
    .map(catalogToFoodItem);
  const products = catalogItems
    .filter((c) => STORE_TYPES.has(c.itemType))
    .map(catalogToProduct);
  const sales = itemSales.map(itemSaleToSale);
  return { foodItems, products, sales };
}

// ─── Supabase hydration ───────────────────────────────────────────────────────

async function hydrateFromSupabase(): Promise<Partial<StoreState>> {
  try {
    const supabase = supabaseBrowser();
    const today = new Date().toISOString().slice(0, 10);

    const [subsRes, salesRes, inbodyRes, expensesRes, catalogRes, rateRes, activeSession, lastClosed] = await Promise.all([
      supabase
        .from("gym_subscriptions")
        .select("*")
        .is("cancelled_at", null)
        .not("member_name", "ilike", "%test%")
        .order("created_at", { ascending: false }),
      supabase
        .from("item_sales")
        .select("*")
        .gte("created_at", today + "T00:00:00")
        .order("created_at", { ascending: true }),
      supabase
        .from("inbody_sessions")
        .select("*")
        .gte("created_at", today + "T00:00:00")
        .not("member_name", "ilike", "%test%"),
      supabase
        .from("expenses")
        .select("*")
        .is("cancelled_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("catalog_items").select("*"),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "exchange_rate_usd_syp")
        .maybeSingle(),
      getActiveSession(),
      getLastClosedSession(),
    ]);

    type Row = Record<string, unknown>;

    const subscriptions: Subscription[] = (subsRes.data ?? []).map((row: Row) => ({
      id: String(row.id),
      memberId: String(row.member_id ?? ""),
      memberName: String(row.member_name ?? ""),
      phone: row.phone == null ? null : String(row.phone),
      planType: String(row.plan_type ?? "1_month") as PlanType,
      offer: String(row.offer ?? "none") as OfferType,
      startDate: String(row.start_date ?? ""),
      endDate: String(row.end_date ?? ""),
      remainingDays: calculateRemainingDays(String(row.end_date ?? "")),
      amount: Number(row.amount ?? 0),
      paidAmount: Number(row.paid_amount ?? 0),
      paymentStatus: String(row.payment_status ?? "paid") as PaymentStatus,
      paymentMethod: String(row.payment_method ?? "cash") as PaymentMethod,
      currency: String(row.currency ?? "usd") as Currency,
      status: String(row.status ?? "active") as SubStatus,
      privateCoachName: row.private_coach_name == null ? null : String(row.private_coach_name),
      note: row.note == null ? null : String(row.note),
      activationCode: row.activation_code == null ? null : String(row.activation_code),
      createdAt: String(row.created_at ?? ""),
      createdBy: String(row.created_by ?? ""),
      lockedAt: String(row.created_at ?? ""),
    }));

    const itemSales: ItemSale[] = (salesRes.data ?? []).map((row: Row) => rowToItemSale(row));

    const inBodySessions: InBodySession[] = (inbodyRes.data ?? []).map((row: Row) => {
      // session_type historically held both "category" labels (single, package_5,
      // package_10) and "audience" labels (gym_member, non_member). Only the
      // audience values map to InBodyMemberType — anything else is legacy data
      // and defaults to gym_member.
      const sessionType = String(row.session_type ?? "");
      const memberType: InBodyMemberType =
        sessionType === "non_member" ? "non_member" : "gym_member";
      return {
        id: String(row.id),
        memberType,
        memberName: String(row.member_name ?? ""),
        priceUSD: Number(row.amount ?? 0),
        priceSYP: Number(row.amount_syp ?? 0),
        currency: "usd" as const,
        paymentMethod: "cash" as PaymentMethod,
        cancelled: !!row.cancelled_at,
        createdAt: String(row.created_at ?? ""),
        createdBy: String(row.created_by ?? ""),
        createdByName: String(row.created_by_name ?? ""),
      };
    });

    const expenses: Expense[] = (expensesRes.data ?? []).map((row: Row) => ({
      id: String(row.id),
      description: String(row.description ?? ""),
      category: String(row.category ?? "miscellaneous") as ExpenseCategory,
      amount: Number(row.amount ?? 0),
      paymentMethod: "cash" as PaymentMethod,
      currency: String(row.currency ?? "usd") as Currency,
      frequency: "one_time" as ExpenseFrequency,
      date: String(row.created_at ?? new Date().toISOString()).slice(0, 10),
      createdAt: String(row.created_at ?? ""),
      createdBy: String(row.created_by ?? ""),
      lockedAt: String(row.created_at ?? ""),
    }));

    let localSession: LocalSession | null = null;
    if (activeSession) {
      localSession = {
        id: activeSession.id,
        openingCash: activeSession.openingCash,
        openedAt: activeSession.openedAt,
        openedByName: activeSession.employeeName,
        status: "open",
      };
    }

    const lastClosingCash = lastClosed?.actualCash ?? 0;
    const lastClosedByName = lastClosed?.openedByName ?? "";

    const catalogRows = (catalogRes.data ?? []) as Row[];
    const catalogItems: CatalogItem[] = catalogRows.map(rowToCatalogItem).sort(catalogItemSort);

    // Derive legacy-shaped views for any component that still reads them.
    const { foodItems, products, sales } = deriveLegacyFromCatalog(catalogItems, itemSales);

    const rateVal = rateRes.data?.value;
    const rateNum = typeof rateVal === "number" ? rateVal : Number(rateVal);
    const exchangeRate = Number.isFinite(rateNum) && rateNum > 0 ? rateNum : 13200;

    console.log("Supabase hydration:", {
      subscriptions: subscriptions.length,
      itemSales: itemSales.length,
      inBodySessions: inBodySessions.length,
      expenses: expenses.length,
      hasOpenSession: !!localSession,
      catalogItems: catalogItems.length,
      exchangeRate,
    });

    return {
      catalogItems,
      itemSales,
      subscriptions,
      inBodySessions,
      expenses,
      localSession,
      exchangeRate,
      lastClosingCash,
      lastClosedByName,
      // Legacy compat fields derived from canonical state
      foodItems,
      products,
      sales,
    };
  } catch (e) {
    console.error("Supabase hydration failed:", e);
    return {};
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const StoreContext = createContext<StoreContextType>({
  ...INITIAL_STATE,
  addCatalogItem: async () => ({}),
  updateCatalogItem: async () => ({}),
  removeCatalogItem: async () => ({}),
  addItemSale: () => {},
  cancelItemSale: () => {},
  addSale: () => {},
  reverseSale: () => {},
  cancelSale: () => {},
  updateProductCost: () => {},
  updateProductPrice: async () => ({}),
  adjustStock: async () => ({}),
  addProduct: async () => ({}),
  addFoodItem: async () => ({}),
  updateFoodItem: async () => ({}),
  removeFoodItem: async () => ({}),
  addSubscription: () => {},
  replaceSubscription: () => {},
  cancelSubscriptionLocal: () => {},
  addInBodySession: () => {},
  cancelInBodySession: () => {},
  updateInBodyPrices: () => {},
  addExpense: () => {},
  updateExpenseLocal: () => {},
  removeExpenseLocal: () => {},
  updateExpenseRate: () => {},
  addExpenseRate: () => {},
  toggleExpenseRate: () => {},
  setExchangeRate: () => {},
  pushActivity: () => {},
  setLocalSession: () => {},
  openLocalSession: () => {},
  closeLocalSession: () => {},
  storeIncome: 0,
  mealsIncome: 0,
  subsIncome: 0,
  inbodyIncome: 0,
  totalIncome: 0,
  runningCash: 0,
  lastClosedByName: "",
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<StoreState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const { user } = useAuth();

  const setState = useCallback((updater: (prev: StoreState) => StoreState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  // ── Hydration on login / logout ────────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      stateRef.current = INITIAL_STATE;
      setStateRaw(INITIAL_STATE);
      return;
    }
    hydrateFromSupabase().then((partial) => {
      setStateRaw((prev) => {
        const next = { ...prev, ...partial };
        stateRef.current = next;
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const addSale = useCallback((sale: Sale) => {
    const cur = sale.currency ?? "usd";
    const amountLabel =
      cur === "syp"
        ? `${sale.total.toLocaleString("en-US")} ل.س`
        : `$${sale.total}`;
    const entry: ActivityEntry = {
      id: generateId(),
      type: "sale",
      description: `بيع ${sale.quantity}× ${sale.productName} — ${amountLabel}`,
      amountUSD: cur === "usd" ? sale.total : undefined,
      amountSYP: cur === "syp" ? sale.total : undefined,
      userId: sale.createdBy,
      userName: sale.createdBy,
      timestamp: sale.createdAt,
    };
    setState((prev) => ({
      ...prev,
      sales: [...prev.sales, sale],
      products: prev.products.map((p) =>
        p.id === sale.productId ? { ...p, stock: Math.max(0, p.stock - sale.quantity) } : p
      ),
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
    }));
  }, [setState]);

  const cancelSale = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sales: prev.sales.map((s) => (s.id === id ? { ...s, cancelled: true } : s)),
    }));
  }, [setState]);

  const reverseSale = useCallback((saleId: string, reason?: string) => {
    setState((prev) => {
      const original = prev.sales.find((s) => s.id === saleId);
      if (!original) return prev;
      const reversal: Sale = {
        ...original,
        id: generateId(),
        isReversal: true,
        reversalOf: saleId,
        reversalReason: reason,
        createdAt: new Date().toISOString(),
      };
      return {
        ...prev,
        sales: [...prev.sales, reversal],
        products: prev.products.map((p) =>
          p.id === original.productId ? { ...p, stock: p.stock + original.quantity } : p
        ),
      };
    });
  }, [setState]);

  // ── New unified catalog + sales actions ─────────────────────────────

  const addItemSale = useCallback((sale: ItemSale) => {
    const usd = sale.amountUsd != null && sale.amountUsd > 0 ? sale.amountUsd : undefined;
    const syp = sale.amountSyp != null && sale.amountSyp > 0 ? sale.amountSyp : undefined;
    const label = sale.originalCurrency === "syp"
      ? `${Math.round(sale.originalTotal).toLocaleString("en-US")} ل.س`
      : `$${sale.originalTotal}`;
    const entry: ActivityEntry = {
      id: generateId(),
      type: "sale",
      description: `بيع ${sale.quantity}× ${sale.itemNameSnapshot} — ${label}`,
      amountUSD: usd,
      amountSYP: syp,
      userId: sale.createdBy,
      userName: sale.createdByName ?? sale.createdBy,
      timestamp: sale.createdAt,
    };
    setState((prev) => {
      const itemSales = [...prev.itemSales, sale];
      // Mirror stock decrement for catalog items that track inventory.
      const catalogItems = prev.catalogItems.map((c) =>
        c.id === sale.catalogItemId && c.trackStock
          ? { ...c, stockQuantity: Math.max(0, c.stockQuantity - sale.quantity) }
          : c,
      );
      const { foodItems, products, sales } = deriveLegacyFromCatalog(catalogItems, itemSales);
      return {
        ...prev,
        itemSales,
        catalogItems,
        foodItems,
        products,
        sales,
        activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
      };
    });
  }, [setState]);

  const cancelItemSale = useCallback((id: string) => {
    setState((prev) => {
      const now = new Date().toISOString();
      const original = prev.itemSales.find((s) => s.id === id);
      const itemSales = prev.itemSales.map((s) =>
        s.id === id ? { ...s, cancelledAt: s.cancelledAt ?? now } : s,
      );
      const shouldRestore = original != null && original.cancelledAt == null;
      const catalogItems = shouldRestore
        ? prev.catalogItems.map((c) =>
            c.id === original.catalogItemId && c.trackStock
              ? { ...c, stockQuantity: c.stockQuantity + original.quantity }
              : c,
          )
        : prev.catalogItems;
      const { foodItems, products, sales } = deriveLegacyFromCatalog(catalogItems, itemSales);
      return { ...prev, itemSales, catalogItems, foodItems, products, sales };
    });
  }, [setState]);

  const addCatalogItem = useCallback(
    async (draft: CatalogItemDraft): Promise<{ error?: string }> => {
      if (!user) return { error: "يجب تسجيل الدخول." };
      const r = await persistCatalogItemInsert({
        user: { id: user.id, displayName: user.displayName },
        name: draft.name,
        category: draft.category,
        itemType: draft.itemType,
        sellCurrency: draft.sellCurrency,
        sellPrice: draft.sellPrice,
        costCurrency: draft.costCurrency ?? null,
        costPrice: draft.costPrice ?? null,
        stockQuantity: draft.stockQuantity,
        trackStock: draft.trackStock,
        lowStockThreshold: draft.lowStockThreshold,
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
        description: draft.description ?? null,
      });
      if (r.error || !r.data) return { error: r.error ?? "فشل إضافة الصنف" };
      const next = rowToCatalogItem(r.data as CatalogRow);
      setState((prev) => {
        const catalogItems = [...prev.catalogItems, next].sort(catalogItemSort);
        const { foodItems, products } = deriveLegacyFromCatalog(catalogItems, prev.itemSales);
        return { ...prev, catalogItems, foodItems, products };
      });
      return {};
    },
    [setState, user],
  );

  const updateCatalogItem = useCallback(
    async (id: string, updates: Partial<CatalogItemDraft>): Promise<{ error?: string }> => {
      if (!user) return { error: "يجب تسجيل الدخول." };
      const prev = stateRef.current.catalogItems.find((c) => c.id === id);
      // Optimistic patch
      setState((s) => {
        const catalogItems = s.catalogItems.map((c) =>
          c.id === id
            ? {
                ...c,
                ...(updates.name !== undefined && { name: updates.name }),
                ...(updates.category !== undefined && { category: updates.category }),
                ...(updates.itemType !== undefined && { itemType: updates.itemType }),
                ...(updates.sellCurrency !== undefined && { sellCurrency: updates.sellCurrency }),
                ...(updates.sellPrice !== undefined && { sellPrice: updates.sellPrice }),
                ...(updates.costCurrency !== undefined && { costCurrency: updates.costCurrency ?? null }),
                ...(updates.costPrice !== undefined && { costPrice: updates.costPrice ?? null }),
                ...(updates.stockQuantity !== undefined && { stockQuantity: updates.stockQuantity }),
                ...(updates.trackStock !== undefined && { trackStock: updates.trackStock }),
                ...(updates.lowStockThreshold !== undefined && { lowStockThreshold: updates.lowStockThreshold }),
                ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
                ...(updates.isActive !== undefined && { isActive: updates.isActive }),
                ...(updates.description !== undefined && { description: updates.description ?? null }),
              }
            : c,
        );
        const { foodItems, products } = deriveLegacyFromCatalog(catalogItems, s.itemSales);
        return { ...s, catalogItems, foodItems, products };
      });
      const r = await persistCatalogItemUpdate({
        user: { id: user.id, displayName: user.displayName },
        id,
        fields: updates,
      });
      if (r.error) {
        // Roll back optimistic change
        if (prev) {
          setState((s) => {
            const catalogItems = s.catalogItems.map((c) => (c.id === id ? prev : c));
            const { foodItems, products } = deriveLegacyFromCatalog(catalogItems, s.itemSales);
            return { ...s, catalogItems, foodItems, products };
          });
        }
        return { error: r.error };
      }
      return {};
    },
    [setState, user],
  );

  const removeCatalogItem = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      if (!user) return { error: "يجب تسجيل الدخول." };
      const prev = stateRef.current.catalogItems.find((c) => c.id === id);
      // Optimistic remove
      setState((s) => {
        const catalogItems = s.catalogItems.filter((c) => c.id !== id);
        const { foodItems, products } = deriveLegacyFromCatalog(catalogItems, s.itemSales);
        return { ...s, catalogItems, foodItems, products };
      });
      const r = await persistCatalogItemDelete({
        user: { id: user.id, displayName: user.displayName },
        id,
      });
      if (r.error) {
        if (prev) {
          setState((s) => {
            const catalogItems = [...s.catalogItems, prev].sort(catalogItemSort);
            const { foodItems, products } = deriveLegacyFromCatalog(catalogItems, s.itemSales);
            return { ...s, catalogItems, foodItems, products };
          });
        }
        return { error: r.error };
      }
      return {};
    },
    [setState, user],
  );

  const updateProductCost = useCallback((productId: string, cost: number) => {
    setState((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? { ...p, cost } : p)),
    }));
  }, [setState]);

  const updateProductPrice = useCallback(async (productId: string, cost: number, price: number): Promise<{ error?: string }> => {
    // Route price+cost edits through the unified catalog API. The trigger
    // from migration 0030 enforces that reception can only change
    // sell_price/stock_quantity/low_stock_threshold; managers can change
    // both price and cost. The error surface is the same as before.
    const entry: ActivityEntry = {
      id: generateId(),
      type: "price_edit",
      description: Number.isFinite(cost)
        ? `تعديل سعر — تكلفة: ${cost}، بيع: ${price}`
        : `تعديل سعر — بيع: ${price}`,
      amountUSD: price,
      userId: "manager",
      userName: "المدير",
      timestamp: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
    }));
    return updateCatalogItem(productId, {
      sellPrice: price,
      ...(Number.isFinite(cost) ? { costPrice: cost } : {}),
    });
  }, [setState, updateCatalogItem]);

  const adjustStock = useCallback(async (productId: string, delta: number): Promise<{ error?: string }> => {
    const current = stateRef.current.catalogItems.find((c) => c.id === productId);
    if (!current) return { error: "المنتج غير موجود" };
    const nextStock = Math.max(0, current.stockQuantity + delta);
    return updateCatalogItem(productId, { stockQuantity: nextStock });
  }, [updateCatalogItem]);

  // Legacy write paths now delegate to the unified catalog API. The
  // store/kitchen tabs in the manager dashboard call these functions; we
  // route them into catalog_items so old UI keeps working while the
  // single canonical table is the only thing being mutated.

  const addProduct = useCallback(async (product: Omit<Product, "id" | "createdAt">): Promise<{ error?: string }> => {
    return addCatalogItem({
      name: product.name,
      // Legacy ProductCategory → flat catalog category. Most rows will be
      // 'supplements'; accessory becomes 'accessories'; drink/water becomes
      // 'drinks'; everything else falls back to 'other'.
      category:
        product.category === "accessory" ? "accessories" :
        product.category === "drink"     ? "drinks"      :
        product.category === "water"     ? "drinks"      :
        product.category === "other"     ? "other"       :
        "supplements",
      itemType:
        product.category === "water"     ? "water" :
        product.category === "drink"     ? "drink" :
        product.category === "accessory" ? "product" :
        "supplement",
      sellCurrency: product.priceCurrency ?? "usd",
      sellPrice: product.price,
      costCurrency: product.cost == null ? null : (product.costCurrency ?? "usd"),
      costPrice: product.cost,
      stockQuantity: product.stock,
      trackStock: true,
      lowStockThreshold: product.lowStockThreshold,
      sortOrder: 0,
      isActive: true,
    });
  }, [addCatalogItem]);

  const addFoodItem = useCallback(async (item: Omit<FoodItem, "id">): Promise<{ error?: string }> => {
    // Legacy FoodItemCategory uses 'meals' / 'meal_addons' / 'drinks' etc.
    // Map cleanly into the new flat catalog enum; 'food' (default in the
    // pre-0023 seed) becomes 'meals' or 'other' based on item type.
    const isWater  = /ماء/.test(item.name);
    const isDrinkName = ["قهوة", "شاي", "مشروب طاقة", "BCAA", "Pre-workout"].includes(item.name)
      || isWater;
    const newCategory: CatalogItemCategory =
      item.category === "meals"       ? "meals"       :
      item.category === "meal_addons" ? "meal_addons" :
      item.category === "drinks"      ? "other"       :
      item.category === "other"       ? "other"       :
      isDrinkName                     ? "other"       :
      "meals";
    const newItemType: CatalogItemType =
      isWater                    ? "water" :
      isDrinkName                ? "drink" :
      "meal";
    return addCatalogItem({
      name: item.name,
      category: newCategory,
      itemType: newItemType,
      sellCurrency: "syp",
      sellPrice: item.price_syp,
      costCurrency: item.cost_syp != null ? "syp" : item.cost_usd != null ? "usd" : null,
      costPrice: item.cost_syp ?? item.cost_usd ?? null,
      stockQuantity: 0,
      trackStock: false,
      lowStockThreshold: 3,
      sortOrder: item.sort_order ?? 0,
      isActive: item.is_active,
      description: item.description ?? null,
    });
  }, [addCatalogItem]);

  const updateFoodItem = useCallback(async (id: string, updates: Partial<FoodItem>): Promise<{ error?: string }> => {
    // Map FoodItem partial → catalog partial. Only fields the manager
    // can change here actually move through; we don't try to derive
    // category/item_type from a category change because the legacy
    // category enum is wider than ours — manager edits the new fields
    // directly via the catalog dashboard for those.
    const fields: Partial<CatalogItemDraft> = {};
    if (updates.name !== undefined)        fields.name              = updates.name;
    if (updates.price_syp !== undefined) { fields.sellPrice         = updates.price_syp; fields.sellCurrency = "syp"; }
    if (updates.cost_syp !== undefined)  { fields.costPrice         = updates.cost_syp ?? null; fields.costCurrency = updates.cost_syp == null ? null : "syp"; }
    if (updates.cost_usd !== undefined)  { fields.costPrice         = updates.cost_usd ?? null; fields.costCurrency = updates.cost_usd == null ? null : "usd"; }
    if (updates.is_active !== undefined)   fields.isActive          = updates.is_active;
    if (updates.sort_order !== undefined)  fields.sortOrder         = updates.sort_order;
    if (updates.description !== undefined) fields.description       = updates.description ?? null;
    if (updates.stock_quantity !== undefined && Number.isFinite(updates.stock_quantity) && updates.stock_quantity >= 0) {
      fields.stockQuantity = Math.floor(updates.stock_quantity);
    }
    return updateCatalogItem(id, fields);
  }, [updateCatalogItem]);

  const removeFoodItem = useCallback(async (id: string): Promise<{ error?: string }> => {
    return removeCatalogItem(id);
  }, [removeCatalogItem]);

  const addInBodySession = useCallback((session: InBodySession) => {
    const entry: ActivityEntry = {
      id: generateId(),
      type: "inbody",
      description: `جلسة InBody — ${session.memberName} — $${session.priceUSD}`,
      amountUSD: session.priceUSD,
      userId: session.createdBy,
      userName: session.createdByName,
      timestamp: session.createdAt,
    };
    setState((prev) => ({
      ...prev,
      inBodySessions: [...prev.inBodySessions, session],
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
    }));
  }, [setState]);

  const cancelInBodySession = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      inBodySessions: prev.inBodySessions.map((s) =>
        s.id === id ? { ...s, cancelled: true } : s
      ),
    }));
  }, [setState]);

  const updateInBodyPrices = useCallback((member: number, nonMember: number) => {
    setState((prev) => ({ ...prev, inBodyPrices: { member, nonMember } }));
  }, [setState]);

  const addExpense = useCallback((expense: Expense) => {
    setState((prev) => ({ ...prev, expenses: [...prev.expenses, expense] }));
  }, [setState]);

  const updateExpenseLocal = useCallback((id: string, updates: Partial<Expense>) => {
    setState((prev) => ({
      ...prev,
      expenses: prev.expenses.map((expense) =>
        expense.id === id ? { ...expense, ...updates } : expense
      ),
    }));
  }, [setState]);

  const removeExpenseLocal = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      expenses: prev.expenses.filter((expense) => expense.id !== id),
    }));
  }, [setState]);

  const updateExpenseRate = useCallback((id: string, amount: number) => {
    setState((prev) => ({
      ...prev,
      expenseRates: prev.expenseRates.map((r) =>
        r.id === id
          ? { ...r, amount, lastUpdated: new Date().toISOString().split("T")[0] }
          : r
      ),
    }));
  }, [setState]);

  const addExpenseRate = useCallback((rate: Omit<ExpenseRate, "id" | "lastUpdated">) => {
    const full: ExpenseRate = {
      ...rate,
      id: generateId(),
      lastUpdated: new Date().toISOString().split("T")[0],
    };
    setState((prev) => ({ ...prev, expenseRates: [...prev.expenseRates, full] }));
  }, [setState]);

  const toggleExpenseRate = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      expenseRates: prev.expenseRates.map((r) =>
        r.id === id ? { ...r, active: !r.active } : r
      ),
    }));
  }, [setState]);

  const setExchangeRate = useCallback((rate: number) => {
    setState((prev) => ({ ...prev, exchangeRate: rate }));
  }, [setState]);

  const addSubscription = useCallback((sub: Subscription) => {
    const cur = sub.currency ?? "usd";
    const entry: ActivityEntry = {
      id: generateId(),
      type: "subscription",
      description: `اشتراك جديد — ${sub.memberName} ($${sub.paidAmount})`,
      amountUSD: cur === "usd" ? sub.paidAmount : undefined,
      userId: sub.createdBy,
      userName: sub.createdBy,
      timestamp: sub.createdAt,
    };
    setState((prev) => ({
      ...prev,
      subscriptions: [sub, ...prev.subscriptions],
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
    }));
  }, [setState]);

  const cancelSubscriptionLocal = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      subscriptions: prev.subscriptions.map((s) =>
        s.id === id ? { ...s, status: "cancelled" as const } : s
      ),
    }));
  }, [setState]);

  const replaceSubscription = useCallback((id: string, sub: Subscription) => {
    setState((prev) => ({
      ...prev,
      subscriptions: prev.subscriptions.map((s) => (s.id === id ? sub : s)),
    }));
  }, [setState]);

  const pushActivity = useCallback((entry: Omit<ActivityEntry, "id" | "timestamp">) => {
    const full: ActivityEntry = { ...entry, id: generateId(), timestamp: new Date().toISOString() };
    setState((prev) => ({
      ...prev,
      activityFeed: [full, ...prev.activityFeed].slice(0, 100),
    }));
  }, [setState]);

  // ── DB-backed income ───────────────────────────────────────────────────────

  const [incomeData, setIncomeData] = useState<SessionIncome>({
    subsIncome: 0, storeIncome: 0, mealsIncome: 0, inbodyIncome: 0, totalIncome: 0,
  });

  const refreshIncome = useCallback(async (sessionId: string) => {
    const data = await fetchSessionIncome(sessionId);
    setIncomeData(data);
  }, []);

  useEffect(() => {
    const sid = state.localSession?.id;
    if (!sid || state.localSession?.status !== "open") {
      setIncomeData({ subsIncome: 0, storeIncome: 0, mealsIncome: 0, inbodyIncome: 0, totalIncome: 0 });
      return;
    }
    void refreshIncome(sid);
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`store-income-${sid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales",           filter: `cash_session_id=eq.${sid}` }, () => void refreshIncome(sid))
      .on("postgres_changes", { event: "*", schema: "public", table: "item_sales",      filter: `cash_session_id=eq.${sid}` }, () => void refreshIncome(sid))
      .on("postgres_changes", { event: "*", schema: "public", table: "gym_subscriptions", filter: `cash_session_id=eq.${sid}` }, () => void refreshIncome(sid))
      .on("postgres_changes", { event: "*", schema: "public", table: "inbody_sessions", filter: `cash_session_id=eq.${sid}` }, () => void refreshIncome(sid))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [state.localSession?.id, state.localSession?.status, state.itemSales.length, refreshIncome]);

  // ── Catalog realtime: keep catalog_items in sync across roles ─────
  // When the manager edits a price/cost/stock, every reception session must
  // see the new value without a hard refresh. Subscribe to catalog_items and
  // refetch on any insert/update/delete. Legacy compat fields (foodItems,
  // products) are re-derived from the catalogItems result.
  // Depend on user?.id (not the full user object) so the channel is only
  // re-created on actual sign-in/out, never on incidental useAuth re-renders.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const supabase = supabaseBrowser();

    async function refetchCatalog() {
      const { data } = await supabase.from("catalog_items").select("*");
      const rows = (data ?? []) as CatalogRow[];
      const catalogItems = rows.map(rowToCatalogItem).sort(catalogItemSort);
      setState((prev) => {
        const { foodItems, products } = deriveLegacyFromCatalog(catalogItems, prev.itemSales);
        return { ...prev, catalogItems, foodItems, products };
      });
    }

    const channel = supabase
      .channel(`catalog-items-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_items" }, () => void refetchCatalog())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, setState]);

  // ── Local session ──────────────────────────────────────────────────────────

  const setLocalSession = useCallback((session: LocalSession | null) => {
    setState((prev) => ({ ...prev, localSession: session }));
  }, [setState]);

  const openLocalSession = useCallback((openingCash?: number) => {
    setState((prev) => {
      if (prev.localSession?.status === "open") return prev;
      const opening = openingCash !== undefined ? openingCash : prev.lastClosingCash;
      const newHistory: LocalSession[] =
        prev.localSession?.status === "closed"
          ? [prev.localSession, ...prev.sessionHistory.filter((s) => s.id !== prev.localSession!.id)]
          : prev.sessionHistory;
      return {
        ...prev,
        localSession: {
          id: generateId(),
          openingCash: opening,
          openedAt: new Date().toISOString(),
          status: "open",
        },
        sessionHistory: newHistory,
      };
    });
  }, [setState]);

  const closeLocalSession = useCallback((actualCash: number, incomeSnapshot: SessionIncome, discrepancyNote?: string) => {
    setState((prev) => {
      if (!prev.localSession || prev.localSession.status !== "open") return prev;
      const closedSession: LocalSession = {
        ...prev.localSession,
        actualCash,
        closedAt: new Date().toISOString(),
        status: "closed",
        subsIncome: incomeSnapshot.subsIncome,
        storeIncome: incomeSnapshot.storeIncome,
        mealsIncome: incomeSnapshot.mealsIncome,
        inbodyIncome: incomeSnapshot.inbodyIncome,
        totalIncome: incomeSnapshot.totalIncome,
        discrepancyNote,
      };
      return { ...prev, localSession: closedSession, lastClosingCash: actualCash };
    });
  }, [setState]);

  // ── Provide ────────────────────────────────────────────────────────────────

  const value: StoreContextType = {
    ...state,
    addCatalogItem,
    updateCatalogItem,
    removeCatalogItem,
    addItemSale,
    cancelItemSale,
    addSale,
    reverseSale,
    cancelSale,
    updateProductCost,
    updateProductPrice,
    adjustStock,
    addProduct,
    addFoodItem,
    updateFoodItem,
    removeFoodItem,
    addSubscription,
    replaceSubscription,
    cancelSubscriptionLocal,
    addInBodySession,
    cancelInBodySession,
    updateInBodyPrices,
    addExpense,
    updateExpenseLocal,
    removeExpenseLocal,
    updateExpenseRate,
    addExpenseRate,
    toggleExpenseRate,
    setExchangeRate,
    pushActivity,
    setLocalSession,
    openLocalSession,
    closeLocalSession,
    ...incomeData,
    runningCash: (state.localSession?.openingCash ?? 0) + incomeData.totalIncome,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
