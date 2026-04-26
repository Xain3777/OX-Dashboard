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
  | "1_month"
  | "2_months"
  | "3_months"
  | "4_months"
  | "6_months"
  | "7_months"
  | "8_months"
  | "9_months"
  | "12_months";

// Price offers apply only to 1-month plans. Referral offers add days to any plan.
export type OfferType =
  | "none"
  | "married_couple" // $30/person (couple pays $60 total instead of $70)
  | "referral_5"     // +1 month free (30 extra days, any plan)
  | "referral_9"     // +2 months free (60 extra days, any plan)
  | "corporate";     // 15% off, 1-month only

export type PaymentStatus = "paid" | "partial" | "unpaid";
export type SubStatus = "active" | "expired" | "frozen" | "cancelled";

export interface Subscription {
  id: string;
  memberId: string;
  memberName: string;
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
  createdAt: string;
  createdBy: string;
  lockedAt?: string;
}

// --- STORE / INVENTORY ---
export type ProductCategory =
  | "supplements"
  | "wearables"
  | "protein_cups"
  | "bca_drinks"
  | "meals"
  | "other";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  cost: number;
  price: number;
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
  createdAt: string;
  createdBy: string;
  isReversal: boolean;
  reversalOf?: string;  // references original sale ID
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

export type PaymentMethod = "cash" | "card" | "transfer" | "other";

export type Currency = "syp" | "usd";

export interface Expense {
  id: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: PaymentMethod;
  currency?: Currency;
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
