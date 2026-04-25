import {
  Member, Subscription, Product, Sale, Expense, CashSession,
  AuditEntry, DashboardKPI, WeeklyReview, MonthlyReview, StaffUser,
} from "./types";

export const STAFF: StaffUser[] = [
  { id: "s1", name: "أدهم (المالك)", role: "owner", active: true },
  { id: "s2", name: "حيدر", role: "manager", active: true },
  { id: "s3", name: "لينا", role: "receptionist", active: true },
  { id: "s4", name: "يوسف", role: "receptionist", active: true },
];

export const MEMBERS: Member[] = [
  { id: "m1", name: "أحمد الراشد", phone: "0501234567", joinDate: "2025-09-15", createdAt: "2025-09-15T08:00:00Z", createdBy: "s3" },
  { id: "m2", name: "فاطمة نور", phone: "0559876543", joinDate: "2025-11-01", createdAt: "2025-11-01T09:30:00Z", createdBy: "s3" },
  { id: "m3", name: "خالد حسن", phone: "0551112233", joinDate: "2026-01-10", createdAt: "2026-01-10T10:00:00Z", createdBy: "s4" },
  { id: "m4", name: "سارة إبراهيم", phone: "0567778899", joinDate: "2026-02-20", createdAt: "2026-02-20T08:15:00Z", createdBy: "s3" },
  { id: "m5", name: "طارق منصور", phone: "0543216789", joinDate: "2026-03-01", createdAt: "2026-03-01T11:00:00Z", createdBy: "s4" },
  { id: "m6", name: "نادية يوسف", phone: "0508887766", joinDate: "2026-03-15", createdAt: "2026-03-15T07:45:00Z", createdBy: "s3" },
  { id: "m7", name: "رامي الأمين", phone: "0523334455", joinDate: "2026-04-01", createdAt: "2026-04-01T09:00:00Z", createdBy: "s3" },
  { id: "m8", name: "ليلى بدران", phone: "0534445566", joinDate: "2026-04-05", createdAt: "2026-04-05T10:30:00Z", createdBy: "s4" },
];

export const SUBSCRIPTIONS: Subscription[] = [
  {
    id: "sub1", memberId: "m1", memberName: "أحمد الراشد",
    planType: "12_months", offer: "12_plus_2_free",
    startDate: "2025-09-15", endDate: "2026-11-14", remainingDays: 214,
    amount: 2400, paidAmount: 2400, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2025-09-15T08:00:00Z", createdBy: "s3",
  },
  {
    id: "sub2", memberId: "m2", memberName: "فاطمة نور",
    planType: "4_months", offer: "4_plus_1_free",
    startDate: "2026-02-01", endDate: "2026-07-01", remainingDays: 78,
    amount: 800, paidAmount: 800, paymentStatus: "paid", paymentMethod: "card",
    status: "active", createdAt: "2026-02-01T09:30:00Z", createdBy: "s3",
  },
  {
    id: "sub3", memberId: "m3", memberName: "خالد حسن",
    planType: "3_months", offer: "3_plus_half_free",
    startDate: "2026-01-10", endDate: "2026-04-25", remainingDays: 11,
    amount: 600, paidAmount: 400, paymentStatus: "partial", paymentMethod: "cash",
    status: "active", createdAt: "2026-01-10T10:00:00Z", createdBy: "s4",
  },
  {
    id: "sub4", memberId: "m4", memberName: "سارة إبراهيم",
    planType: "1_month", offer: "college_student",
    startDate: "2026-03-20", endDate: "2026-04-19", remainingDays: 5,
    amount: 160, paidAmount: 160, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2026-03-20T08:15:00Z", createdBy: "s3",
  },
  {
    id: "sub5", memberId: "m5", memberName: "طارق منصور",
    planType: "9_months", offer: "9_plus_1.5_free",
    startDate: "2026-03-01", endDate: "2026-12-15", remainingDays: 245,
    amount: 1800, paidAmount: 1800, paymentStatus: "paid", paymentMethod: "transfer",
    status: "active", createdAt: "2026-03-01T11:00:00Z", createdBy: "s4",
  },
  {
    id: "sub6", memberId: "m6", memberName: "نادية يوسف",
    planType: "1_month", offer: "none",
    startDate: "2026-03-15", endDate: "2026-04-14", remainingDays: 0,
    amount: 200, paidAmount: 200, paymentStatus: "paid", paymentMethod: "cash",
    status: "expired", createdAt: "2026-03-15T07:45:00Z", createdBy: "s3",
  },
  {
    id: "sub7", memberId: "m7", memberName: "رامي الأمين",
    planType: "3_months", offer: "none",
    startDate: "2026-04-01", endDate: "2026-06-30", remainingDays: 77,
    amount: 600, paidAmount: 0, paymentStatus: "unpaid", paymentMethod: "cash",
    status: "active", createdAt: "2026-04-01T09:00:00Z", createdBy: "s3",
  },
  {
    id: "sub8", memberId: "m8", memberName: "ليلى بدران",
    planType: "daily", offer: "none",
    startDate: "2026-04-14", endDate: "2026-04-14", remainingDays: 0,
    amount: 30, paidAmount: 30, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2026-04-14T10:30:00Z", createdBy: "s4",
  },
];

export const PRODUCTS: Product[] = [
  { id: "p1", name: "واي بروتين ٢ كجم", category: "supplements", cost: 120, price: 180, stock: 15, lowStockThreshold: 5, createdAt: "2026-01-01" },
  { id: "p2", name: "كبسولات BCAA", category: "supplements", cost: 45, price: 75, stock: 22, lowStockThreshold: 8, createdAt: "2026-01-01" },
  { id: "p3", name: "خلطة بري-ورك أوت", category: "supplements", cost: 55, price: 90, stock: 3, lowStockThreshold: 5, createdAt: "2026-01-01" },
  { id: "p4", name: "قفازات رياضية (زوج)", category: "wearables", cost: 15, price: 35, stock: 30, lowStockThreshold: 10, createdAt: "2026-01-01" },
  { id: "p5", name: "تانك توب OX", category: "wearables", cost: 20, price: 45, stock: 18, lowStockThreshold: 5, createdAt: "2026-01-01" },
  { id: "p6", name: "كوب بروتين (طازج)", category: "protein_cups", cost: 5, price: 15, stock: 40, lowStockThreshold: 10, createdAt: "2026-01-01" },
  { id: "p7", name: "مشروب BCAA (بارد)", category: "bca_drinks", cost: 3, price: 10, stock: 50, lowStockThreshold: 15, createdAt: "2026-01-01" },
  { id: "p8", name: "وجبة دجاج", category: "meals", cost: 12, price: 25, stock: 8, lowStockThreshold: 5, createdAt: "2026-01-01" },
  { id: "p9", name: "كرياتين ٥٠٠ جم", category: "supplements", cost: 35, price: 60, stock: 2, lowStockThreshold: 5, createdAt: "2026-02-15" },
  { id: "p10", name: "حزام رفع أثقال", category: "wearables", cost: 40, price: 85, stock: 7, lowStockThreshold: 3, createdAt: "2026-02-15" },
];

export const SALES: Sale[] = [
  { id: "sl1", productId: "p6", productName: "كوب بروتين (طازج)", quantity: 3, unitPrice: 15, total: 45, paymentMethod: "cash", createdAt: "2026-04-14T07:30:00Z", createdBy: "s3", isReversal: false },
  { id: "sl2", productId: "p7", productName: "مشروب BCAA (بارد)", quantity: 2, unitPrice: 10, total: 20, paymentMethod: "cash", createdAt: "2026-04-14T08:15:00Z", createdBy: "s3", isReversal: false },
  { id: "sl3", productId: "p1", productName: "واي بروتين ٢ كجم", quantity: 1, unitPrice: 180, total: 180, paymentMethod: "card", createdAt: "2026-04-14T09:00:00Z", createdBy: "s4", isReversal: false },
  { id: "sl4", productId: "p4", productName: "قفازات رياضية (زوج)", quantity: 2, unitPrice: 35, total: 70, paymentMethod: "cash", createdAt: "2026-04-14T10:00:00Z", createdBy: "s3", isReversal: false },
  { id: "sl5", productId: "p8", productName: "وجبة دجاج", quantity: 1, unitPrice: 25, total: 25, paymentMethod: "cash", createdAt: "2026-04-14T11:30:00Z", createdBy: "s4", isReversal: false },
  { id: "sl6", productId: "p6", productName: "كوب بروتين (طازج)", quantity: 1, unitPrice: 15, total: 15, paymentMethod: "cash", createdAt: "2026-04-14T12:00:00Z", createdBy: "s3", isReversal: false },
  { id: "sl7", productId: "p5", productName: "تانك توب OX", quantity: 1, unitPrice: 45, total: 45, paymentMethod: "card", createdAt: "2026-04-14T13:45:00Z", createdBy: "s3", isReversal: false },
];

export const EXPENSES: Expense[] = [
  { id: "e1", description: "إمدادات المياه (شهري)", category: "utilities", amount: 150, paymentMethod: "transfer", date: "2026-04-01", createdAt: "2026-04-01T08:00:00Z", createdBy: "s2" },
  { id: "e2", description: "مواد تنظيف", category: "supplies", amount: 75, paymentMethod: "cash", date: "2026-04-10", createdAt: "2026-04-10T09:00:00Z", createdBy: "s3" },
  { id: "e3", description: "استبدال حزام جهاز المشي", category: "maintenance", amount: 320, paymentMethod: "transfer", date: "2026-04-12", createdAt: "2026-04-12T14:00:00Z", createdBy: "s2" },
  { id: "e4", description: "بدل غداء الموظفين", category: "miscellaneous", amount: 60, paymentMethod: "cash", date: "2026-04-14", createdAt: "2026-04-14T12:30:00Z", createdBy: "s3" },
  { id: "e5", description: "إيجار النادي (أبريل)", category: "rent", amount: 5000, paymentMethod: "transfer", date: "2026-04-01", createdAt: "2026-04-01T07:00:00Z", createdBy: "s1" },
  { id: "e6", description: "راتب المدرب — علي", category: "salaries", amount: 3500, paymentMethod: "transfer", date: "2026-04-05", createdAt: "2026-04-05T08:00:00Z", createdBy: "s1" },
  { id: "e7", description: "راتب المدرب — حسن", category: "salaries", amount: 3200, paymentMethod: "transfer", date: "2026-04-05", createdAt: "2026-04-05T08:05:00Z", createdBy: "s1" },
  { id: "e8", description: "مناديل ورقية وصابون", category: "supplies", amount: 45, paymentMethod: "cash", date: "2026-04-14", createdAt: "2026-04-14T08:00:00Z", createdBy: "s4" },
];

export const CASH_SESSION: CashSession = {
  id: "cs1",
  date: "2026-04-14",
  openingCash: 1250,
  lockedOpening: true,
  totalCashSales: 205,
  totalCashExpenses: 105,
  expectedCash: 1350,
  status: "open",
  openedBy: "s3",
  openedAt: "2026-04-14T06:30:00Z",
};

export const AUDIT_LOG: AuditEntry[] = [
  { id: "a1", action: "session_opened", description: "تم فتح جلسة اليوم — الرصيد الافتتاحي: 1,250", entityType: "session", entityId: "cs1", userId: "s3", userName: "لينا", timestamp: "2026-04-14T06:30:00Z" },
  { id: "a2", action: "sale_created", description: "بيع 3× كوب بروتين (طازج) — 45$", entityType: "sale", entityId: "sl1", userId: "s3", userName: "لينا", timestamp: "2026-04-14T07:30:00Z" },
  { id: "a3", action: "sale_created", description: "بيع 2× مشروب BCAA (بارد) — 20$", entityType: "sale", entityId: "sl2", userId: "s3", userName: "لينا", timestamp: "2026-04-14T08:15:00Z" },
  { id: "a4", action: "expense_created", description: "مناديل ورقية وصابون — 45$ (نقدي)", entityType: "expense", entityId: "e8", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T08:00:00Z" },
  { id: "a5", action: "sale_created", description: "بيع 1× واي بروتين 2 كجم — 180$ (بطاقة)", entityType: "sale", entityId: "sl3", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T09:00:00Z" },
  { id: "a6", action: "subscription_created", description: "اشتراك يومي — ليلى بدران — 30$", entityType: "subscription", entityId: "sub8", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T10:30:00Z" },
  { id: "a7", action: "sale_created", description: "بيع 2× قفازات رياضية — 70$ (نقدي)", entityType: "sale", entityId: "sl4", userId: "s3", userName: "لينا", timestamp: "2026-04-14T10:00:00Z" },
  { id: "a8", action: "sale_created", description: "بيع 1× وجبة دجاج — 25$ (نقدي)", entityType: "sale", entityId: "sl5", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T11:30:00Z" },
  { id: "a9", action: "expense_created", description: "بدل غداء الموظفين — 60$ (نقدي)", entityType: "expense", entityId: "e4", userId: "s3", userName: "لينا", timestamp: "2026-04-14T12:30:00Z" },
  { id: "a10", action: "sale_created", description: "بيع 1× كوب بروتين — 15$ (نقدي)", entityType: "sale", entityId: "sl6", userId: "s3", userName: "لينا", timestamp: "2026-04-14T12:00:00Z" },
  { id: "a11", action: "sale_created", description: "بيع 1× تانك توب OX — 45$ (بطاقة)", entityType: "sale", entityId: "sl7", userId: "s3", userName: "لينا", timestamp: "2026-04-14T13:45:00Z" },
];

export const KPI: DashboardKPI = {
  todayRevenue: 430,
  todayExpenses: 105,
  activeMembers: 7,
  expiringThisWeek: 2,
  cashOnHand: 1350,
  monthlyProfit: 3820,
  lowStockItems: 2,
  unresolvedDiscrepancies: 0,
};

export const WEEKLY_REVIEW: WeeklyReview = {
  weekStart: "2026-04-07",
  weekEnd: "2026-04-13",
  totalRevenue: 2850,
  totalExpenses: 780,
  subscriptionRevenue: 1630,
  storeRevenue: 1220,
  newSubscriptions: 2,
  expiredSubscriptions: 1,
  expiringThisWeek: 2,
  pendingPayments: 1,
  stockMovements: 34,
  unresolvedDiscrepancies: 0,
};

export const MONTHLY_REVIEW: MonthlyReview = {
  month: "أبريل",
  year: 2026,
  totalRevenue: 8620,
  totalExpenses: 12350,
  netProfit: -3730,
  subscriptionRevenue: 5790,
  storeRevenue: 2830,
  expenseBreakdown: {
    salaries: 6700,
    rent: 5000,
    equipment: 0,
    maintenance: 320,
    utilities: 150,
    supplies: 120,
    marketing: 0,
    miscellaneous: 60,
  },
  topProducts: [
    { name: "كوب بروتين (طازج)", quantity: 48, revenue: 720 },
    { name: "مشروب BCAA (بارد)", quantity: 38, revenue: 380 },
    { name: "واي بروتين ٢ كجم", quantity: 6, revenue: 1080 },
    { name: "قفازات رياضية (زوج)", quantity: 8, revenue: 280 },
    { name: "وجبة دجاج", quantity: 12, revenue: 300 },
  ],
  activeSubscriptions: 7,
  expiredSubscriptions: 1,
  locked: false,
};
