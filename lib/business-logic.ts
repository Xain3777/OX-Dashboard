import { PlanType, OfferType, ProductCategory } from "./types";

// ============================================================
// حساب مدة الاشتراك
// ============================================================

const PLAN_DAYS: Record<PlanType, number> = {
  daily: 1,
  "15_days": 15,
  "1_month": 30,
  "3_months": 90,
  "6_months": 180,
  "9_months": 270,
  "12_months": 365,
};

export const PLAN_PRICES: Record<PlanType, number> = {
  daily: 5,
  "15_days": 20,
  "1_month": 35,
  "3_months": 90,
  "6_months": 170,
  "9_months": 235,
  "12_months": 300,
};

const OFFER_BONUS_DAYS: Record<OfferType, number> = {
  none: 0,
  referral_4: 30,
  referral_9: 60,
  couple: 0,
  corporate: 0,
  college: 0,
  owner_family: 0,
  custom_registration: 0,
  group_5: 0,
  group_9: 0,
};

const OFFER_DISCOUNT_PERCENT: Record<OfferType, number> = {
  none: 0,
  referral_4: 0,
  referral_9: 0,
  couple: 0,
  corporate: 15,
  college: 20,
  owner_family: 0,  // owner family priced separately ($20 × months)
  custom_registration: 0,  // amount entered manually by reception
  group_5: 0,  // legacy
  group_9: 0,  // legacy
};

export function calculateEndDate(
  startDate: string,
  plan: PlanType,
  offer: OfferType
): string {
  const start = new Date(startDate);
  const totalDays = PLAN_DAYS[plan] + OFFER_BONUS_DAYS[offer];
  const end = new Date(start);
  end.setDate(end.getDate() + totalDays);
  return end.toISOString().split("T")[0];
}

export function calculateRemainingDays(endDate: string): number {
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

export function calculateDiscountedPrice(
  basePrice: number,
  offer: OfferType,
  plan?: PlanType
): number {
  if (offer === "couple" && plan === "1_month") return 60;
  if (offer === "owner_family" && plan) {
    return Math.round(20 * (PLAN_DAYS[plan] / 30));
  }
  if (offer === "group_5") return Math.round(basePrice * 4 / 5);
  if (offer === "group_9") return Math.round(basePrice * 7 / 9);
  const discount = OFFER_DISCOUNT_PERCENT[offer];
  return Math.round(basePrice * (1 - discount / 100));
}

export function calcGroupPerMember(basePrice: number, groupSize: 5 | 9): number {
  return groupSize === 5
    ? Math.round(basePrice * 4 / 5)
    : Math.round(basePrice * 7 / 9);
}

export function getPlanLabel(plan: PlanType): string {
  const labels: Record<PlanType, string> = {
    daily: "يومي",
    "15_days": "١٥ يوم",
    "1_month": "شهر واحد",
    "3_months": "٣ أشهر",
    "6_months": "٦ أشهر",
    "9_months": "٩ أشهر",
    "12_months": "١٢ شهر",
  };
  return labels[plan];
}

export function getOfferLabel(offer: OfferType): string {
  const labels: Record<OfferType, string> = {
    none: "بدون عرض",
    referral_4: "إحالة ٤ أصدقاء (شهر مجاناً)",
    referral_9: "إحالة ٩ أصدقاء (شهرين مجاناً)",
    couple: "عرض الزوجين ($60 لاثنين — شهر فقط)",
    corporate: "شركات / بنك (خصم ١٥٪)",
    college: "خصم طلاب ٢٠٪",
    owner_family: "عائلة المالك",
    custom_registration: "تسجيل مجاني / مخصص",
    group_5: "مجموعة ٥ (٥ يدفعون ثمن ٤)",
    group_9: "مجموعة ٩ (٩ يدفعون ثمن ٧)",
  };
  return labels[offer];
}

// ============================================================
// تسوية الصندوق
// ============================================================

export function calculateExpectedCash(
  openingCash: number,
  cashSales: number,
  cashExpenses: number
): number {
  return openingCash + cashSales - cashExpenses;
}

export function calculateDiscrepancy(
  expected: number,
  actual: number
): number {
  return Number((actual - expected).toFixed(2));
}

// ============================================================
// إدارة المخزون
// ============================================================

export function isLowStock(current: number, threshold: number): boolean {
  return current <= threshold;
}

export function isOutOfStock(current: number): boolean {
  return current <= 0;
}

// ============================================================
// أدوات التنسيق
// ============================================================

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const SYRIAN_MONTHS: string[] = [
  "كانون الثاني",
  "شباط",
  "آذار",
  "نيسان",
  "أيار",
  "حزيران",
  "تموز",
  "آب",
  "أيلول",
  "تشرين الأول",
  "تشرين الثاني",
  "كانون الأول",
];

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDate();
  const month = SYRIAN_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("ar-SY", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function getCategoryLabel(cat: string): string {
  const expenseLabels: Record<string, string> = {
    salaries: "رواتب",
    rent: "إيجار",
    equipment: "معدات",
    maintenance: "صيانة",
    utilities: "مرافق",
    supplies: "مستلزمات",
    marketing: "تسويق",
    miscellaneous: "متنوعة",
  };
  return expenseLabels[cat] || cat;
}

export function getProductCategoryLabel(cat: ProductCategory): string {
  const labels: Record<ProductCategory, string> = {
    protein:     "بروتين",
    mass_gainer: "ماس جينر",
    creatine:    "كرياتين",
    amino:       "أمينو",
    pre_workout: "بري-ورك أوت",
    fat_burner:  "حرق دهون",
    health:      "صحة وتعافي",
    focus:       "تركيز وأداء",
    accessory:   "إكسسوار",
    drink:       "مشروب",
    water:       "ماء",
    other:       "أخرى",
  };
  return labels[cat];
}

// Auto-derive payment status from total/paid. Mirrors the rule shown
// in the cashier UI: 0 → unpaid, 0 < paid < total → partial, else paid.
export function derivePaymentStatus(amount: number, paidAmount: number): "paid" | "partial" | "unpaid" {
  const safePaid = Math.max(0, paidAmount);
  if (safePaid <= 0) return "unpaid";
  if (safePaid >= amount) return "paid";
  return "partial";
}

// Remaining never goes negative. If reception entered too much, the
// surplus is swallowed silently rather than displayed as -X.
export function calculateRemaining(amount: number, paidAmount: number): number {
  const remaining = amount - Math.max(0, paidAmount);
  return remaining < 0 ? 0 : Number(remaining.toFixed(2));
}

export function getPaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: "نقدي",
    card: "بطاقة",
    transfer: "تحويل",
    other: "أخرى",
  };
  return labels[method] || method;
}
