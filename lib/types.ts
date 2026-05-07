// ============================================================
// OX GYM FINANCE DASHBOARD — TYPE DEFINITIONS
// ============================================================

// --- MEMBERS ---
export interface Member {
  id: string;
  name: string;
  phone: string;
  email?: string;
  joinDate: string; // ISO date
  notes?: string;
  createdAt: string;
  createdBy: string;
}

// --- SUBSCRIPTIONS ---
export type PlanType =
  | "daily"
  | "15_days"
  | "1_month"
  | "3_months"
  | "6_months"
  | "9_months"
  | "12_months";

export type OfferType =
  | "none"
  | "referral_4"          // bring 4+ friends → 1 month free
  | "referral_9"          // bring 9+ friends → 2 months free
  | "couple"              // 2 people on 1-month → $60 flat
  | "corporate"           // 15% discount on any plan
  | "college"             // 20% discount for university students
  | "owner_family"        // owner family — $20 × months
  | "custom_registration" // free / custom registration with manual amount + note
  | "group_5"             // legacy — 5 people pay for 4 (kept for backward compat with old DB rows)
  | "group_9";            // legacy — 9 people pay for 7 (kept for backward compat with old DB rows)

export type PaymentStatus = "paid" | "partial" | "unpaid";
export type SubStatus = "active" | "expired" | "frozen" | "cancelled";

export interface Subscription {
  id: string;
  memberId: string;
  memberName: string;
  phone?: string | null;
  planType: PlanType;
  offer: OfferType;
  startDate: string;
  endDate: string;       // auto-calculated
  remainingDays: number; // computed
  amount: number;
  paidAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  currency?: Currency;
  status: SubStatus;
  privateCoachName?: string | null;
  note?: string | null;
  createdAt: string;
  createdBy: string;
  lockedAt?: string;
}

// --- KITCHEN / FOOD ITEMS ---
export type FoodItemCategory = "meals" | "breakfast" | "salads" | "drinks" | "snacks" | "other" | "food";

export interface FoodItem {
  id: string;
  name: string;
  category: FoodItemCategory;
  /** Legacy single-currency cost. Prefer cost_syp / cost_usd. */
  cost?: number;
  cost_syp?: number | null;
  cost_usd?: number | null;
  price_syp: number;
  is_active: boolean;
  description?: string | null;
  sort_order?: number;
}

// --- STORE / INVENTORY ---
export type ProductCategory =
  | "protein"
  | "mass_gainer"
  | "creatine"
  | "amino"
  | "pre_workout"
  | "fat_burner"
  | "health"
  | "focus"
  | "accessory"
  | "drink"
  | "water"
  | "other";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  cost: number | null;
  costCurrency?: Currency;
  price: number;
  priceCurrency?: Currency;
  stock: number;
  lowStockThreshold: number;
  createdAt: string;
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  paymentMethod: PaymentMethod;
  currency?: Currency;
  source?: "store" | "kitchen";
  cancelled?: boolean;
  createdAt: string;
  createdBy: string;
  isReversal: boolean;
  reversalOf?: string;
  reversalReason?: string;
}

// --- EXPENSES ---
export type ExpenseCategory =
  | "salaries"
  | "rent"
  | "equipment"
  | "maintenance"
  | "utilities"
  | "supplies"
  | "marketing"
  | "miscellaneous";

export type ExpenseFrequency = "monthly" | "weekly" | "daily" | "one_time";

export type PaymentMethod = "cash" | "card" | "transfer" | "other";

export type Currency = "syp" | "usd";

export interface Expense {
  id: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: PaymentMethod;
  currency?: Currency;
  frequency?: ExpenseFrequency;
  date: string;
  createdAt: string;
  createdBy: string;
  lockedAt?: string;
}

// --- CASH SESSION / RECONCILIATION ---
export type SessionStatus = "open" | "closed" | "discrepancy";

export interface CashSession {
  id: string;
  date: string;
  openingCash: number;
  lockedOpening: boolean;
  totalCashSales: number;        // subscriptions + store (cash only)
  totalCashExpenses: number;     // expenses (cash only)
  expectedCash: number;          // opening + sales - expenses
  actualCash?: number;           // counted at close
  discrepancy?: number;          // actual - expected
  discrepancyNote?: string;
  status: SessionStatus;
  openedBy: string;
  openedAt: string;
  closedBy?: string;
  closedAt?: string;
}

// --- AUDIT LOG ---
export type AuditAction =
  | "subscription_created"
  | "sale_created"
  | "sale_reversed"
  | "expense_created"
  | "session_opened"
  | "session_closed"
  | "discrepancy_resolved"
  | "product_added"
  | "stock_adjusted"
  | "inbody_session"
  | "price_edit"
  | "monthly_locked";

export interface AuditEntry {
  id: string;
  action: AuditAction;
  description: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// --- WEEKLY / MONTHLY REVIEW ---
export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  totalRevenue: number;
  totalExpenses: number;
  subscriptionRevenue: number;
  storeRevenue: number;
  newSubscriptions: number;
  expiredSubscriptions: number;
  expiringThisWeek: number;
  pendingPayments: number;
  stockMovements: number;
  unresolvedDiscrepancies: number;
}

export interface MonthlyReview {
  month: string;
  year: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  subscriptionRevenue: number;
  storeRevenue: number;
  expenseBreakdown: Record<ExpenseCategory, number>;
  topProducts: { name: string; quantity: number; revenue: number }[];
  activeSubscriptions: number;
  expiredSubscriptions: number;
  locked: boolean;
  lockedAt?: string;
  lockedBy?: string;
}

// --- STAFF ---
export type StaffRole = "owner" | "manager" | "receptionist";

export interface StaffUser {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
}

// --- KPI ---
export interface DashboardKPI {
  todayRevenue: number;
  todayExpenses: number;
  activeMembers: number;
  expiringThisWeek: number;
  cashOnHand: number;
  monthlyProfit: number;
  lowStockItems: number;
  unresolvedDiscrepancies: number;
}
