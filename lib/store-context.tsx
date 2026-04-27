"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
  useMemo,
} from "react";
import { Product, Sale, Expense, PaymentMethod, Subscription, FoodItem } from "./types";
import { PRODUCTS, SALES, EXPENSES, SUBSCRIPTIONS, FOOD_ITEMS } from "./mock-data";
import { generateId } from "./business-logic";

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
  actualCash?: number;
  closedAt?: string;
  status: "open" | "closed";
  // Income snapshot recorded at close time
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
  // Local session
  localSession: LocalSession | null;
  sessionHistory: LocalSession[];
  lastClosingCash: number;
}

// ─── Context type ─────────────────────────────────────────────────────────────

export interface StoreContextType extends StoreState {
  // Store
  addSale: (sale: Omit<Sale, "id" | "createdAt">) => void;
  reverseSale: (saleId: string, reason?: string) => void;
  cancelSale: (id: string) => void;
  updateProductCost: (productId: string, cost: number) => void;
  updateProductPrice: (productId: string, cost: number, price: number) => void;
  adjustStock: (productId: string, delta: number) => void;
  addProduct: (product: Omit<Product, "id" | "createdAt">) => void;
  // Food items
  addFoodItem: (item: Omit<FoodItem, "id">) => void;
  updateFoodItem: (id: string, updates: Partial<FoodItem>) => void;
  removeFoodItem: (id: string) => void;
  // Subscriptions
  addSubscription: (sub: Omit<Subscription, "id" | "createdAt">) => void;
  cancelSubscriptionLocal: (id: string) => void;
  // InBody
  addInBodySession: (session: Omit<InBodySession, "id" | "createdAt">) => void;
  cancelInBodySession: (id: string) => void;
  updateInBodyPrices: (member: number, nonMember: number) => void;
  // Expenses
  addExpense: (expense: Omit<Expense, "id" | "createdAt">) => void;
  // Rates
  updateExpenseRate: (id: string, amount: number) => void;
  addExpenseRate: (rate: Omit<ExpenseRate, "id" | "lastUpdated">) => void;
  toggleExpenseRate: (id: string) => void;
  // Currency
  setExchangeRate: (rate: number) => void;
  // Activity
  pushActivity: (entry: Omit<ActivityEntry, "id" | "timestamp">) => void;
  // Local session
  openLocalSession: (openingCash?: number) => void;
  closeLocalSession: (actualCash: number, discrepancyNote?: string) => void;
  // Computed income (today's, non-cancelled)
  storeIncome: number;
  mealsIncome: number;
  subsIncome: number;
  inbodyIncome: number;
  totalIncome: number;
  runningCash: number;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: StoreState = {
  products: PRODUCTS,
  sales: SALES,
  subscriptions: SUBSCRIPTIONS,
  inBodySessions: [],
  expenses: EXPENSES,
  activityFeed: [],
  inBodyPrices: { member: 60000, nonMember: 100000 },
  expenseRates: [],
  exchangeRate: 13200,
  foodItems: FOOD_ITEMS,
  localSession: null,
  sessionHistory: [],
  lastClosingCash: 0,
};

const STORAGE_KEY = "ox_store_v5";

function loadState(): StoreState {
  if (typeof window === "undefined") return INITIAL_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_STATE;
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    return { ...INITIAL_STATE, ...parsed };
  } catch {
    return INITIAL_STATE;
  }
}

function saveState(state: StoreState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
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
  openLocalSession: () => {},
  closeLocalSession: (_a: number, _n?: string) => {},
  storeIncome: 0,
  mealsIncome: 0,
  subsIncome: 0,
  inbodyIncome: 0,
  totalIncome: 0,
  runningCash: 0,
});

export function StoreProvider({ children }: { children: ReactNode }) {
  // Lazy initializer reads localStorage synchronously on first render —
  // no INITIAL_STATE flash, data is available before the first paint.
  const [state, setStateRaw] = useState<StoreState>(loadState);
  const stateRef = useRef(state);

  const setState = useCallback((updater: (prev: StoreState) => StoreState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      saveState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const newState = JSON.parse(e.newValue) as StoreState;
          setStateRaw({ ...INITIAL_STATE, ...newState });
          stateRef.current = { ...INITIAL_STATE, ...newState };
        } catch {}
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const addSale = useCallback((sale: Omit<Sale, "id" | "createdAt">) => {
    const full: Sale = { ...sale, id: generateId(), createdAt: new Date().toISOString() };
    const cur = sale.currency ?? "usd";
    const amountLabel = cur === "syp"
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
      timestamp: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      sales: [...prev.sales, full],
      products: prev.products.map((p) =>
        p.id === sale.productId ? { ...p, stock: Math.max(0, p.stock - sale.quantity) } : p
      ),
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
    }));
  }, [setState]);

  const cancelSale = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sales: prev.sales.map((s) => s.id === id ? { ...s, cancelled: true } : s),
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
      products: prev.products.map((p) =>
        p.id === productId ? { ...p, cost } : p
      ),
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
      products: prev.products.map((p) =>
        p.id === productId ? { ...p, cost, price } : p
      ),
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
    const full: Product = { ...product, id: generateId(), createdAt: new Date().toISOString().split("T")[0] };
    setState((prev) => ({ ...prev, products: [...prev.products, full] }));
  }, [setState]);

  const addFoodItem = useCallback((item: Omit<FoodItem, "id">) => {
    const full: FoodItem = { ...item, id: `food-${generateId()}` };
    setState((prev) => ({ ...prev, foodItems: [...prev.foodItems, full] }));
  }, [setState]);

  const updateFoodItem = useCallback((id: string, updates: Partial<FoodItem>) => {
    setState((prev) => ({
      ...prev,
      foodItems: prev.foodItems.map((f) => f.id === id ? { ...f, ...updates } : f),
    }));
  }, [setState]);

  const removeFoodItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      foodItems: prev.foodItems.filter((f) => f.id !== id),
    }));
  }, [setState]);

  const addInBodySession = useCallback(
    (session: Omit<InBodySession, "id" | "createdAt">) => {
      const full: InBodySession = {
        ...session,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      const entry: ActivityEntry = {
        id: generateId(),
        type: "inbody",
        description: `جلسة InBody — ${session.memberName} — $${session.priceUSD}`,
        amountUSD: session.priceUSD,
        userId: session.createdBy,
        userName: session.createdByName,
        timestamp: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        inBodySessions: [...prev.inBodySessions, full],
        activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
      }));
    },
    [setState]
  );

  const cancelInBodySession = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      inBodySessions: prev.inBodySessions.map((s) =>
        s.id === id ? { ...s, cancelled: true } : s
      ),
    }));
  }, [setState]);

  const updateInBodyPrices = useCallback(
    (member: number, nonMember: number) => {
      setState((prev) => ({ ...prev, inBodyPrices: { member, nonMember } }));
    },
    [setState]
  );

  const addExpense = useCallback((expense: Omit<Expense, "id" | "createdAt">) => {
    const full: Expense = { ...expense, id: generateId(), createdAt: new Date().toISOString() };
    setState((prev) => ({ ...prev, expenses: [...prev.expenses, full] }));
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

  const addExpenseRate = useCallback(
    (rate: Omit<ExpenseRate, "id" | "lastUpdated">) => {
      const full: ExpenseRate = {
        ...rate,
        id: generateId(),
        lastUpdated: new Date().toISOString().split("T")[0],
      };
      setState((prev) => ({ ...prev, expenseRates: [...prev.expenseRates, full] }));
    },
    [setState]
  );

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

  const addSubscription = useCallback(
    (sub: Omit<Subscription, "id" | "createdAt">) => {
      const full: Subscription = { ...sub, id: generateId(), createdAt: new Date().toISOString() };
      const cur = sub.currency ?? "usd";
      const entry: ActivityEntry = {
        id: generateId(),
        type: "subscription",
        description: `اشتراك جديد — ${sub.memberName} ($${sub.paidAmount})`,
        amountUSD: cur === "usd" ? sub.paidAmount : undefined,
        userId: sub.createdBy,
        userName: sub.createdBy,
        timestamp: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        subscriptions: [full, ...prev.subscriptions],
        activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
      }));
    },
    [setState]
  );

  const cancelSubscriptionLocal = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      subscriptions: prev.subscriptions.map((s) =>
        s.id === id ? { ...s, status: "cancelled" as const } : s
      ),
    }));
  }, [setState]);

  const pushActivity = useCallback(
    (entry: Omit<ActivityEntry, "id" | "timestamp">) => {
      const full: ActivityEntry = { ...entry, id: generateId(), timestamp: new Date().toISOString() };
      setState((prev) => ({
        ...prev,
        activityFeed: [full, ...prev.activityFeed].slice(0, 100),
      }));
    },
    [setState]
  );

  // ── Local session ──────────────────────────────────────────────────────────

  const openLocalSession = useCallback((openingCash?: number) => {
    setState((prev) => {
      if (prev.localSession?.status === "open") return prev;
      const opening = openingCash !== undefined ? openingCash : prev.lastClosingCash;
      // Archive previous closed session to history before opening a new one
      const newHistory: LocalSession[] = prev.localSession?.status === "closed"
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

  const closeLocalSession = useCallback((actualCash: number, discrepancyNote?: string) => {
    setState((prev) => {
      if (!prev.localSession || prev.localSession.status !== "open") return prev;
      const sessionStart = prev.localSession.openedAt;
      const todayStr = new Date().toISOString().slice(0, 10);
      const inSess = (t: string) => t.startsWith(todayStr) && (!sessionStart || t >= sessionStart);

      const subsIncome = prev.subscriptions
        .filter((s) => s.status !== "cancelled" && inSess(s.createdAt))
        .reduce((sum, s) => sum + s.paidAmount, 0);
      const storeIncome = prev.sales
        .filter((s) => !s.isReversal && !s.cancelled && s.source !== "kitchen" && inSess(s.createdAt))
        .reduce((sum, s) => sum + s.total, 0);
      const mealsIncome = prev.sales
        .filter((s) => !s.isReversal && !s.cancelled && s.source === "kitchen" && inSess(s.createdAt))
        .reduce((sum, s) => sum + s.total, 0);
      const inbodyIncome = prev.inBodySessions
        .filter((s) => !s.cancelled && inSess(s.createdAt))
        .reduce((sum, s) => sum + s.priceUSD, 0);

      const closedSession: LocalSession = {
        ...prev.localSession,
        actualCash,
        closedAt: new Date().toISOString(),
        status: "closed",
        subsIncome,
        storeIncome,
        mealsIncome,
        inbodyIncome,
        totalIncome: subsIncome + storeIncome + mealsIncome + inbodyIncome,
        discrepancyNote,
      };
      return {
        ...prev,
        localSession: closedSession,
        lastClosingCash: actualCash,
      };
    });
  }, [setState]);

  // ── Computed income values ─────────────────────────────────────────────────

  const today = todayPrefix();
  const sessionStart = state.localSession?.openedAt;

  const computedValues = useMemo(() => {
    const isInSession = (createdAt: string) =>
      createdAt.startsWith(today) && (!sessionStart || createdAt >= sessionStart);

    const storeIncome = state.sales
      .filter((s) => !s.isReversal && !s.cancelled && s.source !== "kitchen" && isInSession(s.createdAt))
      .reduce((sum, s) => sum + s.total, 0);

    const mealsIncome = state.sales
      .filter((s) => !s.isReversal && !s.cancelled && s.source === "kitchen" && isInSession(s.createdAt))
      .reduce((sum, s) => sum + s.total, 0);

    const subsIncome = state.subscriptions
      .filter((s) => s.status !== "cancelled" && isInSession(s.createdAt))
      .reduce((sum, s) => sum + s.paidAmount, 0);

    const inbodyIncome = state.inBodySessions
      .filter((s) => !s.cancelled && isInSession(s.createdAt))
      .reduce((sum, s) => sum + s.priceUSD, 0);

    const totalIncome = storeIncome + mealsIncome + subsIncome + inbodyIncome;
    const runningCash = (state.localSession?.openingCash ?? 0) + totalIncome;

    return { storeIncome, mealsIncome, subsIncome, inbodyIncome, totalIncome, runningCash };
  }, [state.sales, state.subscriptions, state.inBodySessions, state.localSession, today, sessionStart]);

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
    openLocalSession,
    closeLocalSession,
    ...computedValues,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
