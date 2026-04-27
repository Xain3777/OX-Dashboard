"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  ReactNode,
} from "react";
import { Product, Sale, Subscription } from "./types";
import { PRODUCTS, SALES, SUBSCRIPTIONS } from "./mock-data";
import { generateId } from "./business-logic";

// ─── InBody ───────────────────────────────────────────────────────────────────

export type InBodyMemberType = "gym_member" | "non_member";

export interface InBodySession {
  id: string;
  memberType: InBodyMemberType;
  memberId?: string;
  memberName: string;
  priceUSD: number;
  priceSYP: number;
  currency: "usd" | "syp";
  paymentMethod: "cash";
  createdAt: string;
  createdBy: string;
  createdByName: string;
  cancelled?: boolean;
}

// ─── Local cash session ───────────────────────────────────────────────────────

export interface LocalSession {
  id: string;
  openingCash: number;
  openedAt: string;
  actualCash?: number;
  closedAt?: string;
  status: "open" | "closed";
}

// ─── Activity feed ────────────────────────────────────────────────────────────

export type ActivityType = "inbody" | "sale" | "subscription" | "price_edit";

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

// ─── Full store state ─────────────────────────────────────────────────────────

export interface StoreState {
  products: Product[];
  sales: Sale[];
  subscriptions: Subscription[];
  inBodySessions: InBodySession[];
  activityFeed: ActivityEntry[];
  inBodyPrices: { member: number; nonMember: number };
  exchangeRate: number;
  localSession: LocalSession | null;
  lastClosingCash: number;
}

// ─── Context type ─────────────────────────────────────────────────────────────

export interface StoreContextType extends StoreState {
  // Store
  addSale: (sale: Omit<Sale, "id" | "createdAt">) => void;
  reverseSale: (saleId: string, reason?: string) => void;
  cancelSale: (saleId: string) => void;
  updateProductCost: (productId: string, cost: number) => void;
  updateProductPrice: (productId: string, cost: number, price: number) => void;
  adjustStock: (productId: string, delta: number) => void;
  // Subscriptions
  addSubscription: (sub: Omit<Subscription, "id" | "createdAt">) => void;
  cancelSubscriptionLocal: (subId: string) => void;
  // InBody
  addInBodySession: (session: Omit<InBodySession, "id" | "createdAt">) => void;
  cancelInBodySession: (sessionId: string) => void;
  updateInBodyPrices: (member: number, nonMember: number) => void;
  // Currency
  setExchangeRate: (rate: number) => void;
  // Session
  openLocalSession: (openingCash?: number) => void;
  closeLocalSession: (actualCash: number) => void;
  // Activity
  pushActivity: (entry: Omit<ActivityEntry, "id" | "timestamp">) => void;
  // Computed income (session-scoped, today only)
  storeIncome: number;
  mealsIncome: number;
  subsIncome: number;
  inbodyIncome: number;
  totalIncome: number;
  runningCash: number;
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_STATE: StoreState = {
  products: PRODUCTS,
  sales: SALES,
  subscriptions: SUBSCRIPTIONS,
  inBodySessions: [],
  activityFeed: [],
  inBodyPrices: { member: 60000, nonMember: 100000 },
  exchangeRate: 13200,
  localSession: null,
  lastClosingCash: 0,
};

const STORAGE_KEY = "ox_store_v4";

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

// ─── Context ──────────────────────────────────────────────────────────────────

const StoreContext = createContext<StoreContextType>({
  ...INITIAL_STATE,
  addSale: () => {},
  reverseSale: () => {},
  cancelSale: () => {},
  updateProductCost: () => {},
  updateProductPrice: () => {},
  adjustStock: () => {},
  addSubscription: () => {},
  cancelSubscriptionLocal: () => {},
  addInBodySession: () => {},
  cancelInBodySession: () => {},
  updateInBodyPrices: () => {},
  setExchangeRate: () => {},
  openLocalSession: () => {},
  closeLocalSession: () => {},
  pushActivity: () => {},
  storeIncome: 0,
  mealsIncome: 0,
  subsIncome: 0,
  inbodyIncome: 0,
  totalIncome: 0,
  runningCash: 0,
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<StoreState>(INITIAL_STATE);
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
    const loaded = loadState();
    setStateRaw(loaded);
    stateRef.current = loaded;
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

  // ── Computed income values ─────────────────────────────────────────────────

  const computedValues = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sessionStart = state.localSession?.status === "open"
      ? state.localSession.openedAt
      : null;

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
  }, [state.sales, state.subscriptions, state.inBodySessions, state.localSession]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const addSale = useCallback((sale: Omit<Sale, "id" | "createdAt">) => {
    const full: Sale = { ...sale, id: generateId(), createdAt: new Date().toISOString() };
    const amountLabel = `${sale.total}$`;
    const entry: ActivityEntry = {
      id: generateId(),
      type: "sale",
      description: `بيع ${sale.quantity}× ${sale.productName} — ${amountLabel}`,
      amountUSD: sale.total,
      userId: sale.createdBy,
      userName: sale.createdBy,
      timestamp: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      sales: [...prev.sales, full],
      products: prev.products.map((p) =>
        p.id === sale.productId ? { ...p, stock: p.stock - sale.quantity } : p
      ),
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
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

  const cancelSale = useCallback((saleId: string) => {
    setState((prev) => {
      const sale = prev.sales.find((s) => s.id === saleId);
      if (!sale || sale.cancelled) return prev;
      return {
        ...prev,
        sales: prev.sales.map((s) => s.id === saleId ? { ...s, cancelled: true } : s),
        products: prev.products.map((p) =>
          p.id === sale.productId ? { ...p, stock: p.stock + sale.quantity } : p
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
      description: `تعديل سعر المنتج — تكلفة: ${cost}$، بيع: ${price}$`,
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

  const addSubscription = useCallback(
    (sub: Omit<Subscription, "id" | "createdAt">) => {
      const full: Subscription = {
        ...sub,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      const entry: ActivityEntry = {
        id: generateId(),
        type: "subscription",
        description: `اشتراك جديد — ${sub.memberName} ($${sub.paidAmount})`,
        amountUSD: sub.paidAmount,
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

  const cancelSubscriptionLocal = useCallback((subId: string) => {
    setState((prev) => ({
      ...prev,
      subscriptions: prev.subscriptions.map((s) =>
        s.id === subId ? { ...s, status: "cancelled" as const } : s
      ),
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

  const cancelInBodySession = useCallback((sessionId: string) => {
    setState((prev) => ({
      ...prev,
      inBodySessions: prev.inBodySessions.map((s) =>
        s.id === sessionId ? { ...s, cancelled: true } : s
      ),
    }));
  }, [setState]);

  const updateInBodyPrices = useCallback(
    (member: number, nonMember: number) => {
      setState((prev) => ({
        ...prev,
        inBodyPrices: { member, nonMember },
      }));
    },
    [setState]
  );

  const setExchangeRate = useCallback((rate: number) => {
    setState((prev) => ({ ...prev, exchangeRate: rate }));
  }, [setState]);

  const openLocalSession = useCallback((openingCash?: number) => {
    setState((prev) => {
      const opening = prev.lastClosingCash > 0
        ? prev.lastClosingCash
        : Math.max(0, openingCash ?? 0);
      const session: LocalSession = {
        id: generateId(),
        openingCash: opening,
        openedAt: new Date().toISOString(),
        status: "open",
      };
      return { ...prev, localSession: session };
    });
  }, [setState]);

  const closeLocalSession = useCallback((actualCash: number) => {
    setState((prev) => {
      if (!prev.localSession || prev.localSession.status !== "open") return prev;
      return {
        ...prev,
        localSession: {
          ...prev.localSession,
          actualCash,
          closedAt: new Date().toISOString(),
          status: "closed",
        },
        lastClosingCash: actualCash,
      };
    });
  }, [setState]);

  const pushActivity = useCallback(
    (entry: Omit<ActivityEntry, "id" | "timestamp">) => {
      const full: ActivityEntry = {
        ...entry,
        id: generateId(),
        timestamp: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        activityFeed: [full, ...prev.activityFeed].slice(0, 100),
      }));
    },
    [setState]
  );

  // ── Provide ────────────────────────────────────────────────────────────────

  const value: StoreContextType = {
    ...state,
    ...computedValues,
    addSale,
    reverseSale,
    cancelSale,
    updateProductCost,
    updateProductPrice,
    adjustStock,
    addSubscription,
    cancelSubscriptionLocal,
    addInBodySession,
    cancelInBodySession,
    updateInBodyPrices,
    setExchangeRate,
    openLocalSession,
    closeLocalSession,
    pushActivity,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
