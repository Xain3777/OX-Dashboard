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
import { Product, Sale, Expense, PaymentMethod } from "./types";
import { PRODUCTS, SALES, EXPENSES } from "./mock-data";
import { generateId } from "./business-logic";

// ─── InBody ───────────────────────────────────────────────────────────────────

export type InBodyMemberType = "gym_member" | "non_member";

export interface InBodySession {
  id: string;
  memberType: InBodyMemberType;
  memberId?: string;   // only for gym_member
  memberName: string;
  priceSYP: number;    // 60000 or 100000
  currency: "usd" | "syp";
  paymentMethod: PaymentMethod;
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

// ─── Expense rates (salaries & fixed costs) ───────────────────────────────────

export interface ExpenseRate {
  id: string;
  category: "salary" | "rent" | "utility" | "service" | "other";
  label: string;
  amount: number;   // in USD
  frequency: "monthly" | "weekly" | "daily";
  active: boolean;
  lastUpdated: string;
}

// ─── Full store state ─────────────────────────────────────────────────────────

export interface StoreState {
  products: Product[];
  sales: Sale[];
  inBodySessions: InBodySession[];
  expenses: Expense[];
  activityFeed: ActivityEntry[];
  inBodyPrices: { member: number; nonMember: number }; // SYP
  expenseRates: ExpenseRate[];
  exchangeRate: number; // 1 USD = X SYP
}

// ─── Context type ─────────────────────────────────────────────────────────────

export interface StoreContextType extends StoreState {
  // Store
  addSale: (sale: Omit<Sale, "id" | "createdAt">) => void;
  reverseSale: (saleId: string, reason?: string) => void;
  updateProductCost: (productId: string, cost: number) => void;
  updateProductPrice: (productId: string, cost: number, price: number) => void;
  adjustStock: (productId: string, delta: number) => void;
  // InBody
  addInBodySession: (session: Omit<InBodySession, "id" | "createdAt">) => void;
  updateInBodyPrices: (member: number, nonMember: number) => void;
  // Expenses
  addExpense: (expense: Omit<Expense, "id" | "createdAt">) => void;
  // Rates
  updateExpenseRate: (id: string, amount: number) => void;
  addExpenseRate: (rate: Omit<ExpenseRate, "id" | "lastUpdated">) => void;
  toggleExpenseRate: (id: string) => void;
  // Currency
  setExchangeRate: (rate: number) => void;
}

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_SESSIONS: InBodySession[] = [
  {
    id: "ib1",
    memberType: "gym_member",
    memberId: "m1",
    memberName: "أحمد الراشد",
    priceSYP: 60000,
    currency: "syp",
    paymentMethod: "cash",
    createdAt: "2026-04-14T09:30:00Z",
    createdBy: "s3",
    createdByName: "لينا",
  },
  {
    id: "ib2",
    memberType: "gym_member",
    memberId: "m3",
    memberName: "خالد حسن",
    priceSYP: 60000,
    currency: "syp",
    paymentMethod: "cash",
    createdAt: "2026-04-14T11:00:00Z",
    createdBy: "s4",
    createdByName: "يوسف",
  },
];

const INITIAL_RATES: ExpenseRate[] = [
  { id: "r1", category: "salary", label: "راتب محمد (المدرب)", amount: 280, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r2", category: "salary", label: "راتب لينا (استقبال)", amount: 250, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r3", category: "salary", label: "راتب يوسف (استقبال)", amount: 200, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r4", category: "salary", label: "راتب عامل النظافة", amount: 120, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r5", category: "salary", label: "راتب الفاليه", amount: 150, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r6", category: "rent", label: "إيجار النادي", amount: 400, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r7", category: "utility", label: "فاتورة الكهرباء", amount: 60, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r8", category: "utility", label: "فاتورة المياه", amount: 15, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r9", category: "utility", label: "إنترنت", amount: 20, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r10", category: "service", label: "مواد تنظيف ومنظفات", amount: 30, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
  { id: "r11", category: "service", label: "صيانة عامة", amount: 50, frequency: "monthly", active: true, lastUpdated: "2026-04-01" },
];

const INITIAL_STATE: StoreState = {
  products: PRODUCTS,
  sales: SALES,
  inBodySessions: INITIAL_SESSIONS,
  expenses: EXPENSES,
  activityFeed: [],
  inBodyPrices: { member: 60000, nonMember: 100000 },
  expenseRates: INITIAL_RATES,
  exchangeRate: 13200,
};

const STORAGE_KEY = "ox_store_v2";

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
  updateProductCost: () => {},
  updateProductPrice: () => {},
  adjustStock: () => {},
  addInBodySession: () => {},
  updateInBodyPrices: () => {},
  addExpense: () => {},
  updateExpenseRate: () => {},
  addExpenseRate: () => {},
  toggleExpenseRate: () => {},
  setExchangeRate: () => {},
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<StoreState>(INITIAL_STATE);
  const stateRef = useRef(state);

  // Helper: update state, save to localStorage, and the storage event
  // fires automatically for OTHER tabs
  const setState = useCallback((updater: (prev: StoreState) => StoreState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      saveState(next);
      return next;
    });
  }, []);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const loaded = loadState();
    setStateRaw(loaded);
    stateRef.current = loaded;
  }, []);

  // Listen for changes made in OTHER tabs
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
    const entry: ActivityEntry = {
      id: generateId(),
      type: "sale",
      description: `بيع ${sale.quantity}× ${sale.productName} — ${sale.total}$`,
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

  const addInBodySession = useCallback(
    (session: Omit<InBodySession, "id" | "createdAt">) => {
      const full: InBodySession = {
        ...session,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      const rate = stateRef.current.exchangeRate || 13200;
      const amountUSD = Math.round((session.priceSYP / rate) * 100) / 100;
      const entry: ActivityEntry = {
        id: generateId(),
        type: "inbody",
        description: `جلسة InBody — ${session.memberName} (${session.memberType === "gym_member" ? "عضو" : "زيارة خارجية"})`,
        amountSYP: session.priceSYP,
        amountUSD,
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

  const updateInBodyPrices = useCallback(
    (member: number, nonMember: number) => {
      setState((prev) => ({
        ...prev,
        inBodyPrices: { member, nonMember },
      }));
    },
    [setState]
  );

  const addExpense = useCallback((expense: Omit<Expense, "id" | "createdAt">) => {
    const full: Expense = { ...expense, id: generateId(), createdAt: new Date().toISOString() };
    const entry: ActivityEntry = {
      id: generateId(),
      type: "expense",
      description: `مصروف: ${expense.description} — ${expense.amount}$`,
      amountUSD: expense.amount,
      userId: expense.createdBy,
      userName: expense.createdBy,
      timestamp: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      expenses: [...prev.expenses, full],
      activityFeed: [entry, ...prev.activityFeed].slice(0, 100),
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

  const addExpenseRate = useCallback(
    (rate: Omit<ExpenseRate, "id" | "lastUpdated">) => {
      const full: ExpenseRate = {
        ...rate,
        id: generateId(),
        lastUpdated: new Date().toISOString().split("T")[0],
      };
      setState((prev) => ({
        ...prev,
        expenseRates: [...prev.expenseRates, full],
      }));
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

  // ── Provide ────────────────────────────────────────────────────────────────

  const value: StoreContextType = {
    ...state,
    addSale,
    reverseSale,
    updateProductCost,
    updateProductPrice,
    adjustStock,
    addInBodySession,
    updateInBodyPrices,
    addExpense,
    updateExpenseRate,
    addExpenseRate,
    toggleExpenseRate,
    setExchangeRate,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
