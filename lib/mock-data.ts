import {
  Member, Subscription, Product, Sale, Expense, CashSession,
  AuditEntry, DashboardKPI, WeeklyReview, MonthlyReview, StaffUser, FoodItem,
} from "./types";
import { calculateRemainingDays } from "./business-logic";

export const STAFF: StaffUser[] = [
  { id: "s1", name: "كوتش ادهم", role: "owner", active: true },
  { id: "s2", name: "محمد", role: "manager", active: true },
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
    id: "seed-001", memberId: "m-001", memberName: "خالد الراشدي",
    planType: "3_months", offer: "none", startDate: "2026-02-10", endDate: "2026-05-10",
    remainingDays: calculateRemainingDays("2026-05-10"), amount: 90, paidAmount: 90,
    paymentStatus: "paid", paymentMethod: "cash", status: "active",
    createdAt: "2026-02-10T09:00:00Z", createdBy: "admin",
  },
  {
    id: "seed-002", memberId: "m-002", memberName: "سارة بن طلال",
    planType: "1_month", offer: "none", startDate: "2026-04-01", endDate: "2026-05-01",
    remainingDays: calculateRemainingDays("2026-05-01"), amount: 35, paidAmount: 17,
    paymentStatus: "partial", paymentMethod: "card", status: "active",
    createdAt: "2026-04-01T10:00:00Z", createdBy: "admin",
  },
  {
    id: "seed-003", memberId: "m-003", memberName: "عمر فيصل",
    planType: "12_months", offer: "referral_9", startDate: "2025-04-01", endDate: "2026-06-01",
    remainingDays: calculateRemainingDays("2026-06-01"), amount: 300, paidAmount: 300,
    paymentStatus: "paid", paymentMethod: "transfer", status: "active",
    createdAt: "2025-04-01T08:00:00Z", createdBy: "admin",
  },
  {
    id: "seed-004", memberId: "m-004", memberName: "نورة القحطاني",
    planType: "1_month", offer: "none", startDate: "2026-03-01", endDate: "2026-03-31",
    remainingDays: 0, amount: 35, paidAmount: 0,
    paymentStatus: "unpaid", paymentMethod: "cash", status: "expired",
    createdAt: "2026-03-01T11:00:00Z", createdBy: "admin",
  },
  {
    id: "seed-005", memberId: "m-005", memberName: "يوسف حمدان",
    planType: "3_months", offer: "referral_4", startDate: "2025-12-01", endDate: "2026-04-01",
    remainingDays: calculateRemainingDays("2026-04-01"), amount: 90, paidAmount: 90,
    paymentStatus: "paid", paymentMethod: "cash", status: "frozen",
    createdAt: "2025-12-01T09:30:00Z", createdBy: "admin",
  },
];

export const FOOD_ITEMS: FoodItem[] = [
  { id: "food-1", name: "أرز",   category: "meals",   price_syp: 40000, is_active: true },
  { id: "food-2", name: "دجاج",  category: "meals",   price_syp: 70000, is_active: true },
  { id: "food-3", name: "سلطة",  category: "salads",  price_syp: 30000, is_active: true },
  { id: "food-4", name: "تونة",  category: "meals",   price_syp: 50000, is_active: true },
  { id: "food-5", name: "شوفان", category: "meals",   price_syp: 25000, is_active: true },
];

export const PRODUCTS: Product[] = [
  // ── Protein ────────────────────────────────────────────────────────────────
  { id: "p01", name: "Levrone GOLD Whey 2kg",              category: "protein",     cost: 30, price: 47, stock: 8,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p02", name: "Levrone GOLD Iso 2kg",               category: "protein",     cost: 37, price: 57, stock: 6,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p03", name: "Levro Whey Supreme 2kg",             category: "protein",     cost: 32, price: 50, stock: 5,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p04", name: "Bad Ass Whey 2kg",                   category: "protein",     cost: 29, price: 45, stock: 7,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p05", name: "Bad Ass Anabolic Iso 2kg Vanilla",   category: "protein",     cost: 35, price: 54, stock: 4,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  // ── Mass Gainer ────────────────────────────────────────────────────────────
  { id: "p06", name: "Levrone GOLD Lean Mass 6kg",         category: "mass_gainer", cost: 39, price: 60, stock: 5,  lowStockThreshold: 2, createdAt: "2026-01-01" },
  { id: "p07", name: "Levrone GOLD Lean Mass 3kg Choco",   category: "mass_gainer", cost: 22, price: 35, stock: 7,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p08", name: "Levrone Anabolic Prime Pro 2kg Straw",category: "mass_gainer", cost: 36, price: 55, stock: 4,  lowStockThreshold: 2, createdAt: "2026-01-01" },
  { id: "p09", name: "Levrone Anabolic Cream of Rice 2kg", category: "mass_gainer", cost: 19, price: 30, stock: 6,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  // ── Creatine ───────────────────────────────────────────────────────────────
  { id: "p10", name: "Levrone GOLD Creatine 300g (2028)",  category: "creatine",    cost: 8,  price: 13, stock: 12, lowStockThreshold: 4, createdAt: "2026-01-01" },
  { id: "p11", name: "Levrone GOLD Creatine 300g (2027)",  category: "creatine",    cost: 7,  price: 12, stock: 9,  lowStockThreshold: 4, createdAt: "2026-01-01" },
  { id: "p12", name: "Levrone GOLD Creatine 500g",         category: "creatine",    cost: 14, price: 22, stock: 8,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p13", name: "Levrone GOLD Creatine 1kg",          category: "creatine",    cost: 20, price: 32, stock: 5,  lowStockThreshold: 2, createdAt: "2026-01-01" },
  { id: "p14", name: "Levro Crea 240g",                    category: "creatine",    cost: 8,  price: 13, stock: 10, lowStockThreshold: 4, createdAt: "2026-01-01" },
  { id: "p15", name: "Anabolic Crea 1kg",                  category: "creatine",    cost: 21, price: 33, stock: 4,  lowStockThreshold: 2, createdAt: "2026-01-01" },
  // ── Amino Acids ────────────────────────────────────────────────────────────
  { id: "p16", name: "Levrone GOLD Amino 350 tabs",        category: "amino",       cost: 15, price: 24, stock: 8,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p17", name: "Levrone GOLD Beef Amino 600 tabs",   category: "amino",       cost: 19, price: 30, stock: 6,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p18", name: "Levrone Anabolic Amino 300 tabs",    category: "amino",       cost: 17, price: 26, stock: 7,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p19", name: "Levrone Anabolic LEAA9 240g",        category: "amino",       cost: 13, price: 20, stock: 5,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p20", name: "Levrone Anabolic EAA+BCAA 1000ml Orange", category: "amino",  cost: 16, price: 25, stock: 9,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p21", name: "Levrone Anabolic Ice BCAA 375g",     category: "amino",       cost: 14, price: 21, stock: 7,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p22", name: "Levrone Anabolic Ice EAA 420g",      category: "amino",       cost: 14, price: 22, stock: 6,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p23", name: "Bad Ass BCAA 8:1:1 400g Exotic",    category: "amino",       cost: 13, price: 20, stock: 8,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p24", name: "Amino EAA Xplode 520g",              category: "amino",       cost: 17, price: 27, stock: 5,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p25", name: "Amino Target Xplode 275g Lemon",     category: "amino",       cost: 12, price: 19, stock: 6,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  // ── Pre-Workout / Pump ─────────────────────────────────────────────────────
  { id: "p26", name: "Levrone Shaaboom Pump 385g",         category: "pre_workout", cost: 14, price: 22, stock: 6,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p27", name: "Bad Ass Pump 350g",                  category: "pre_workout", cost: 13, price: 20, stock: 5,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  // ── Fat Burners / Cutting ──────────────────────────────────────────────────
  { id: "p28", name: "Levro Legendary Lipo Burn 90 tabs",  category: "fat_burner",  cost: 11, price: 18, stock: 7,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p29", name: "Levrone Anabolic Test 90 tabs",      category: "fat_burner",  cost: 19, price: 30, stock: 4,  lowStockThreshold: 2, createdAt: "2026-01-01" },
  // ── Health / Recovery ──────────────────────────────────────────────────────
  { id: "p30", name: "Levrone GOLD Glutamine 300g",        category: "health",      cost: 8,  price: 13, stock: 10, lowStockThreshold: 4, createdAt: "2026-01-01" },
  { id: "p31", name: "Levrone GOLD PRO ZMAX 90 tabs",      category: "health",      cost: 9,  price: 14, stock: 8,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  { id: "p32", name: "Levrone Omega 3 90 caps",            category: "health",      cost: 9,  price: 14, stock: 9,  lowStockThreshold: 3, createdAt: "2026-01-01" },
  // ── Focus / Performance ────────────────────────────────────────────────────
  { id: "p33", name: "R-Weiler Focus 300g",                category: "focus",       cost: 8,  price: 13, stock: 5,  lowStockThreshold: 3, createdAt: "2026-01-01" },
];

export const SALES: Sale[] = [
  { id: "sl1", productId: "p01", productName: "Levrone GOLD Whey 2kg",        quantity: 1, unitPrice: 47, total: 47,  paymentMethod: "cash",     currency: "usd", createdAt: "2026-04-14T07:30:00Z", createdBy: "s3", isReversal: false },
  { id: "sl2", productId: "p20", productName: "Levrone Anabolic EAA+BCAA 1000ml Orange", quantity: 2, unitPrice: 25, total: 50, paymentMethod: "cash", currency: "usd", createdAt: "2026-04-14T08:15:00Z", createdBy: "s3", isReversal: false },
  { id: "sl3", productId: "p10", productName: "Levrone GOLD Creatine 300g (2028)", quantity: 2, unitPrice: 13, total: 26, paymentMethod: "transfer", currency: "usd", createdAt: "2026-04-14T09:00:00Z", createdBy: "s4", isReversal: false },
  { id: "sl4", productId: "p26", productName: "Levrone Shaaboom Pump 385g",   quantity: 1, unitPrice: 22, total: 22,  paymentMethod: "cash",     currency: "usd", createdAt: "2026-04-14T10:00:00Z", createdBy: "s3", isReversal: false },
  { id: "sl5", productId: "p30", productName: "Levrone GOLD Glutamine 300g",  quantity: 1, unitPrice: 13, total: 13,  paymentMethod: "cash",     currency: "usd", createdAt: "2026-04-14T11:30:00Z", createdBy: "s4", isReversal: false },
  { id: "sl6", productId: "p02", productName: "Levrone GOLD Iso 2kg",         quantity: 1, unitPrice: 57, total: 57,  paymentMethod: "cash",     currency: "usd", createdAt: "2026-04-14T12:00:00Z", createdBy: "s3", isReversal: false },
  { id: "sl7", productId: "p33", productName: "R-Weiler Focus 300g",          quantity: 2, unitPrice: 13, total: 26,  paymentMethod: "transfer", currency: "usd", createdAt: "2026-04-14T13:45:00Z", createdBy: "s3", isReversal: false },
];

export const EXPENSES: Expense[] = [
  { id: "e1", description: "إمدادات المياه (شهري)", category: "utilities", amount: 150, paymentMethod: "transfer", date: "2026-04-01", createdAt: "2026-04-01T08:00:00Z", createdBy: "s2" },
  { id: "e2", description: "مواد تنظيف", category: "supplies", amount: 75, paymentMethod: "cash", date: "2026-04-10", createdAt: "2026-04-10T09:00:00Z", createdBy: "s3" },
  { id: "e3", description: "استبدال حزام جهاز المشي", category: "maintenance", amount: 320, paymentMethod: "transfer", date: "2026-04-12", createdAt: "2026-04-12T14:00:00Z", createdBy: "s2" },
  { id: "e4", description: "بدل غداء الموظفين", category: "miscellaneous", amount: 60, paymentMethod: "cash", date: "2026-04-14", createdAt: "2026-04-14T12:30:00Z", createdBy: "s3" },
  { id: "e5", description: "إيجار النادي (أبريل)", category: "rent", amount: 5000, paymentMethod: "transfer", date: "2026-04-01", createdAt: "2026-04-01T07:00:00Z", createdBy: "s1" },
  { id: "e6", description: "راتب محمد (مدرب)", category: "salaries", amount: 3500, paymentMethod: "transfer", date: "2026-04-05", createdAt: "2026-04-05T08:00:00Z", createdBy: "s1" },
  { id: "e7", description: "راتب لينا (استقبال)", category: "salaries", amount: 3200, paymentMethod: "transfer", date: "2026-04-05", createdAt: "2026-04-05T08:05:00Z", createdBy: "s1" },
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
