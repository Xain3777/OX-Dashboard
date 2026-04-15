import { PlanType, OfferType, ExpenseCategory, ProductCategory } from "./types";

// ============================================================
// حساب مدة الاشتراك
// ============================================================

const PLAN_DAYS: Record<PlanType, number> = {
  daily: 1,
  "1_month": 30,
  "3_months": 90,
  "4_months": 120,
  "9_months": 270,
  "12_months": 365,
};

const OFFER_BONUS_DAYS: Record<OfferType, number> = {
  none: 0,
  "4_plus_1_free": 30,
  "3_plus_half_free": 15,
  "9_plus_1.5_free": 45,
  "12_plus_2_free": 60,
  married_couple: 0,
  college_student: 0,
};

const OFFER_DISCOUNT_PERCENT: Record<OfferType, number> = {
  none: 0,
  "4_plus_1_free": 0,
  "3_plus_half_free": 0,
  "9_plus_1.5_free": 0,
  "12_plus_2_free": 0,
  married_couple: 15,
  college_student: 20,
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
  offer: OfferType
): number {
  const discount = OFFER_DISCOUNT_PERCENT[offer];
  return Math.round(basePrice * (1 - discount / 100));
}

export function getPlanLabel(plan: PlanType): string {
  const labels: Record<PlanType, string> = {
    daily: "يومي",
    "1_month": "شهر واحد",
    "3_months": "٣ أشهر",
    "4_months": "٤ أشهر",
    "9_months": "٩ أشهر",
    "12_months": "١٢ شهر",
  };
  return labels[plan];
}

export function getOfferLabel(offer: OfferType): string {
  const labels: Record<OfferType, string> = {
    none: "بدون عرض",
    "4_plus_1_free": "٤ أشهر + شهر مجاناً",
    "3_plus_half_free": "٣ أشهر + نصف شهر مجاناً",
    "9_plus_1.5_free": "٩ أشهر + شهر ونصف مجاناً",
    "12_plus_2_free": "١٢ شهر + شهرين مجاناً",
    married_couple: "عرض المتزوجين (خصم ١٥٪)",
    college_student: "عرض الطلاب (خصم ٢٠٪)",
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
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
    supplements: "مكملات",
    wearables: "ملابس رياضية",
    protein_cups: "أكواب بروتين",
    bca_drinks: "مشروبات BCAA",
    meals: "وجبات",
    other: "أخرى",
  };
  return labels[cat];
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
