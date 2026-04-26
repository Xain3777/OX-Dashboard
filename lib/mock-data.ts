import {
  Member, Subscription, Product, Sale,
  AuditEntry, DashboardKPI, WeeklyReview, MonthlyReview, StaffUser,
} from "./types";

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
    id: "sub1", memberId: "m1", memberName: "أحمد الراشد",
    planType: "12_months", offer: "none",
    startDate: "2025-09-15", endDate: "2026-09-15", remainingDays: 142,
    amount: 300, paidAmount: 300, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2025-09-15T08:00:00Z", createdBy: "s3",
  },
  {
    id: "sub2", memberId: "m2", memberName: "فاطمة نور",
    planType: "4_months", offer: "none",
    startDate: "2026-02-01", endDate: "2026-06-01", remainingDays: 36,
    amount: 140, paidAmount: 140, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2026-02-01T09:30:00Z", createdBy: "s3",
  },
  {
    id: "sub3", memberId: "m3", memberName: "خالد حسن",
    planType: "3_months", offer: "none",
    startDate: "2026-01-10", endDate: "2026-04-10", remainingDays: 0,
    amount: 90, paidAmount: 60, paymentStatus: "partial", paymentMethod: "cash",
    status: "active", createdAt: "2026-01-10T10:00:00Z", createdBy: "s4",
  },
  {
    id: "sub4", memberId: "m4", memberName: "سارة إبراهيم",
    planType: "1_month", offer: "married_couple",
    startDate: "2026-03-20", endDate: "2026-04-19", remainingDays: 5,
    amount: 29.75, paidAmount: 29.75, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2026-03-20T08:15:00Z", createdBy: "s3",
  },
  {
    id: "sub5", memberId: "m5", memberName: "طارق منصور",
    planType: "9_months", offer: "none",
    startDate: "2026-03-01", endDate: "2026-11-27", remainingDays: 215,
    amount: 235, paidAmount: 235, paymentStatus: "paid", paymentMethod: "cash",
    status: "active", createdAt: "2026-03-01T11:00:00Z", createdBy: "s4",
  },
  {
    id: "sub6", memberId: "m6", memberName: "نادية يوسف",
    planType: "1_month", offer: "none",
    startDate: "2026-03-15", endDate: "2026-04-14", remainingDays: 0,
    amount: 35, paidAmount: 35, paymentStatus: "paid", paymentMethod: "cash",
    status: "expired", createdAt: "2026-03-15T07:45:00Z", createdBy: "s3",
  },
  {
    id: "sub7", memberId: "m7", memberName: "رامي الأمين",
    planType: "6_months", offer: "referral_5",
    startDate: "2026-04-01", endDate: "2026-10-29", remainingDays: 186,
    amount: 170, paidAmount: 0, paymentStatus: "unpaid", paymentMethod: "cash",
    status: "active", createdAt: "2026-04-01T09:00:00Z", createdBy: "s3",
  },
  {
    id: "sub8", memberId: "m8", memberName: "ليلى بدران",
    planType: "daily", offer: "none",
    startDate: "2026-04-14", endDate: "2026-04-14", remainingDays: 0,
    amount: 5, paidAmount: 5, paymentStatus: "paid", paymentMethod: "cash",
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

export const AUDIT_LOG: AuditEntry[] = [
  { id: "a1", action: "session_opened", description: "تم فتح جلسة اليوم", entityType: "session", entityId: "cs1", userId: "s3", userName: "لينا", timestamp: "2026-04-14T06:30:00Z" },
  { id: "a2", action: "sale_created", description: "بيع 3× كوب بروتين (طازج) — 45$", entityType: "sale", entityId: "sl1", userId: "s3", userName: "لينا", timestamp: "2026-04-14T07:30:00Z" },
  { id: "a3", action: "sale_created", description: "بيع 2× مشروب BCAA (بارد) — 20$", entityType: "sale", entityId: "sl2", userId: "s3", userName: "لينا", timestamp: "2026-04-14T08:15:00Z" },
  { id: "a4", action: "sale_created", description: "بيع 1× واي بروتين 2 كجم — 180$ (بطاقة)", entityType: "sale", entityId: "sl3", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T09:00:00Z" },
  { id: "a5", action: "subscription_created", description: "اشتراك يومي — ليلى بدران — 5$", entityType: "subscription", entityId: "sub8", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T10:30:00Z" },
  { id: "a6", action: "sale_created", description: "بيع 2× قفازات رياضية — 70$ (نقدي)", entityType: "sale", entityId: "sl4", userId: "s3", userName: "لينا", timestamp: "2026-04-14T10:00:00Z" },
  { id: "a7", action: "sale_created", description: "بيع 1× وجبة دجاج — 25$ (نقدي)", entityType: "sale", entityId: "sl5", userId: "s4", userName: "يوسف", timestamp: "2026-04-14T11:30:00Z" },
  { id: "a8", action: "sale_created", description: "بيع 1× كوب بروتين — 15$ (نقدي)", entityType: "sale", entityId: "sl6", userId: "s3", userName: "لينا", timestamp: "2026-04-14T12:00:00Z" },
  { id: "a9", action: "sale_created", description: "بيع 1× تانك توب OX — 45$ (بطاقة)", entityType: "sale", entityId: "sl7", userId: "s3", userName: "لينا", timestamp: "2026-04-14T13:45:00Z" },
];

export const KPI: DashboardKPI = {
  todayRevenue: 430,
  activeMembers: 7,
  expiringThisWeek: 2,
  cashOnHand: 1350,
  lowStockItems: 2,
};

export const WEEKLY_REVIEW: WeeklyReview = {
  weekStart: "2026-04-07",
  weekEnd: "2026-04-13",
  totalRevenue: 2850,
  subscriptionRevenue: 1630,
  storeRevenue: 1220,
  newSubscriptions: 2,
  expiredSubscriptions: 1,
  expiringThisWeek: 2,
  pendingPayments: 1,
  stockMovements: 34,
};

export const MONTHLY_REVIEW: MonthlyReview = {
  month: "أبريل",
  year: 2026,
  totalRevenue: 8620,
  subscriptionRevenue: 5790,
  storeRevenue: 2830,
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
