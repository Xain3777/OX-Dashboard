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
  Product, Sale, Expense, PaymentMethod, Subscription, FoodItem,
  PlanType, OfferType, PaymentStatus, SubStatus, Currency, FoodItemCategory,
} from "./types";
import { PRODUCTS, FOOD_ITEMS } from "./mock-data";
import { generateId, calculateRemainingDays } from "./business-logic";
import { useAuth } from "./auth-context";
import { supabaseBrowser } from "./supabase/client";
import { fetchSessionIncome, SessionIncome, getActiveSession, getLastClosedSession } from "./supabase/session";

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

export interface StoreState {
  products: Product[];
  sales: Sale[];
  subscriptions: Subscription[];
  inBodySessions: InBodySession[];
  expenses: Expense[];
  activityFeed: ActivityEntry[];
  inBodyPrices: { member: number; nonMember: number };
  expenseRates: ExpenseRate[];
  exchangeRate: number;
  foodItems: FoodItem[];
  localSession: LocalSession | null;
  sessionHistory: LocalSession[];
  lastClosingCash: number;
  lastClosedByName: string;
}

// ─── Context type ─────────────────────────────────────────────────────────────

export interface StoreContextType extends StoreState {
  addSale: (sale: Sale) => void;
  reverseSale: (saleId: string, reason?: string) => void;
  cancelSale: (id: string) => void;
  updateProductCost: (productId: string, cost: number) => void;
  updateProductPrice: (productId: string, cost: number, price: number) => void;
  adjustStock: (productId: string, delta: number) => void;
  addProduct: (product: Omit<Product, "id" | "createdAt">) => void;
  addFoodItem: (item: Omit<FoodItem, "id">) => void;
  updateFoodItem: (id: string, updates: Partial<FoodItem>) => void;
  removeFoodItem: (id: string) => void;
  addSubscription: (sub: Subscription) => void;
  cancelSubscriptionLocal: (id: string) => void;
  addInBodySession: (session: InBodySession) => void;
  cancelInBodySession: (id: string) => void;
  updateInBodyPrices: (member: number, nonMember: number) => void;
  addExpense: (expense: Expense) => void;
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
  products: PRODUCTS,
  sales: [],
  subscriptions: [],
  inBodySessions: [],
  expenses: [],
  activityFeed: [],
  inBodyPrices: { member: 60000, nonMember: 100000 },
  expenseRates: [],
  exchangeRate: 13200,
  foodItems: FOOD_ITEMS,
  localSession: null,
  sessionHistory: [],
  lastClosingCash: 0,
  lastClosedByName: "",
};

// ─── Supabase hydration ───────────────────────────────────────────────────────

async function hydrateFromSupabase(): Promise<Partial<StoreState>> {
  try {
    const supabase = supabaseBrowser();
    const today = new Date().toISOString().slice(0, 10);

    const [subsRes, salesRes, inbodyRes, foodRes, productsRes, rateRes, activeSession, lastClosed] = await Promise.all([
      supabase
        .from("gym_subscriptions")
        .select("*")
        .is("cancelled_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("sales")
        .select("*")
        .gte("created_at", today + "T00:00:00")
        .order("created_at", { ascending: true }),
      supabase
        .from("inbody_sessions")
        .select("*")
        .gte("created_at", today + "T00:00:00"),
      supabase.from("food_items").select("*"),
      supabase.from("products").select("*"),
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
      memberId: String(row.created_by ?? ""),
      memberName: String(row.member_name ?? ""),
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
      createdAt: String(row.created_at ?? ""),
      createdBy: String(row.created_by ?? ""),
      lockedAt: String(row.created_at ?? ""),
    }));

    const sales: Sale[] = (salesRes.data ?? []).map((row: Row) => ({
      id: String(row.id),
      productId: String(row.product_id ?? ""),
      productName: String(row.product_name ?? ""),
      quantity: Number(row.quantity ?? 1),
      unitPrice: Number(row.unit_price ?? 0),
      total: Number(row.total ?? 0),
      paymentMethod: String(row.payment_method ?? "cash") as PaymentMethod,
      currency: String(row.currency ?? "usd") as Currency,
      source: String(row.source ?? "store") as "store" | "kitchen",
      cancelled: !!row.cancelled_at,
      createdAt: String(row.created_at ?? ""),
      createdBy: String(row.created_by ?? ""),
      isReversal: false,
    }));

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

    const foodRows = (foodRes.data ?? []) as Row[];
    const foodItems: FoodItem[] =
      foodRows.length > 0
        ? foodRows.map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            category: String(row.category ?? "other") as FoodItemCategory,
            price_usd: Number(row.price_usd ?? 0),
            is_active: !!row.is_active,
          }))
        : FOOD_ITEMS;

    const productRows = (productsRes.data ?? []) as Row[];
    const products: Product[] =
      productRows.length > 0
        ? productRows.map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            category: String(row.category ?? "other") as Product["category"],
            cost: Number(row.cost ?? 0),
            price: Number(row.price ?? 0),
            stock: Number(row.stock ?? 0),
            lowStockThreshold: Number(row.low_stock_threshold ?? 5),
            createdAt: String(row.created_at ?? ""),
          }))
        : PRODUCTS;

    const rateVal = rateRes.data?.value;
    const rateNum = typeof rateVal === "number" ? rateVal : Number(rateVal);
    const exchangeRate = Number.isFinite(rateNum) && rateNum > 0 ? rateNum : 13200;

    console.log("Supabase hydration:", {
      subscriptions: subscriptions.length,
      sales: sales.length,
      inBodySessions: inBodySessions.length,
      hasOpenSession: !!localSession,
      foodItems: foodItems.length,
      products: products.length,
      exchangeRate,
    });

    return { subscriptions, sales, inBodySessions, localSession, foodItems, products, exchangeRate, lastClosingCash, lastClosedByName };
  } catch (e) {
    console.error("Supabase hydration failed:", e);
    return {};
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const StoreContext = createContext<StoreContextType>({
  ...INITIAL_STATE,
  addSale: () => {},
  reverseSale: () => {},
  cancelSale: () => {},
  updateProductCost: () => {},
  updateProductPrice: () => {},
  adjustStock: () => {},
  addProduct: () => {},
  addFoodItem: () => {},
  updateFoodItem: () => {},
  removeFoodItem: () => {},
  addSubscription: () => {},
  cancelSubscriptionLocal: () => {},
  addInBodySession: () => {},
  cancelInBodySession: () => {},
  updateInBodyPrices: () => {},
  addExpense: () => {},
  updateExpenseRate: () => {},
  addExpenseRate: () => {},
  toggleExpenseRate: () => {},
  setExchangeRate: () => {},
  pushActivity: () => {},
  setLocalSession: () => {},
  openLocalSession: () => {},
  closeLocalSession: (_a: number, _s: SessionIncome, _n?: string) => {},
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
      setStateRaw(INITIAL_STATE);
      return;
    }
    hydrateFromSupabase().then((partial) => {
      setStateRaw((prev) => ({ ...prev, ...partial }));
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

  const updateProductCost = useCallback((productId: string, cost: number) => {
    setState((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? { ...p, cost } : p)),
    }));
  }, [setState]);

  const updateProductPrice = useCallback((productId: string, cost: number, price: number) => {
    const entry: ActivityEntry = {
      id: generateId(),
      type: "price_edit",
      description: `تعديل سعر المنتج — تكلفة: $${cost}، بيع: $${price}`,
      amountUSD: price,
      userId: "manager",
      userName: "المدير",
      timestamp: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? { ...p, cost, price } : p)),
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
    }));
  }, [setState]);

  const adjustStock = useCallback((productId: string, delta: number) => {
    setState((prev) => ({
      ...prev,
      products: prev.products.map((p) =>
        p.id === productId ? { ...p, stock: Math.max(0, p.stock + delta) } : p
      ),
    }));
  }, [setState]);

  const addProduct = useCallback((product: Omit<Product, "id" | "createdAt">) => {
    const full: Product = {
      ...product,
      id: generateId(),
      createdAt: new Date().toISOString().split("T")[0],
    };
    setState((prev) => ({ ...prev, products: [...prev.products, full] }));
  }, [setState]);

  const addFoodItem = useCallback((item: Omit<FoodItem, "id">) => {
    const full: FoodItem = { ...item, id: `food-${generateId()}` };
    setState((prev) => ({ ...prev, foodItems: [...prev.foodItems, full] }));
  }, [setState]);

  const updateFoodItem = useCallback((id: string, updates: Partial<FoodItem>) => {
    setState((prev) => ({
      ...prev,
      foodItems: prev.foodItems.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  }, [setState]);

  const removeFoodItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      foodItems: prev.foodItems.filter((f) => f.id !== id),
    }));
  }, [setState]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "gym_subscriptions", filter: `cash_session_id=eq.${sid}` }, () => void refreshIncome(sid))
      .on("postgres_changes", { event: "*", schema: "public", table: "inbody_sessions", filter: `cash_session_id=eq.${sid}` }, () => void refreshIncome(sid))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [state.localSession?.id, state.localSession?.status, refreshIncome]);

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
    cancelSubscriptionLocal,
    addInBodySession,
    cancelInBodySession,
    updateInBodyPrices,
    addExpense,
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
