import { PlanType, OfferType, ProductCategory } from "./types";

// ============================================================
// Plan prices — canonical USD amounts
// ============================================================

export const PLAN_BASE_PRICES: Record<PlanType, number> = {
  daily:       5,
  "1_month":   35,
  "2_months":  70,
  "3_months":  90,  // 15% off vs 3×$35
  "4_months":  140,
  "6_months":  170, // 20% off vs 6×$35
  "7_months":  210,
  "8_months":  245,
  "9_months":  235, // 25% off vs 9×$35
  "12_months": 300, // 30% off vs 12×$35
};

// Duration in calendar days — no free months baked in (referral bonuses handled separately)
const PLAN_DAYS: Record<PlanType, number> = {
  daily:       1,
  "1_month":   30,
  "2_months":  60,
  "3_months":  90,
  "4_months":  120,
  "6_months":  180,
  "7_months":  210,
  "8_months":  240,
  "9_months":  270,
  "12_months": 365,
};

// ============================================================
// Subscription calculations
// ============================================================

export function calculateEndDate(
  startDate: string,
  plan: PlanType,
  offer: OfferType,
): string {
  const start = new Date(startDate);
  const end   = new Date(start);
  let days = PLAN_DAYS[plan];
  if (offer === "referral_5") days += 30;  // +1 month free
  if (offer === "referral_9") days += 60;  // +2 months free
  end.setDate(end.getDate() + days);
  return end.toISOString().split("T")[0];
}

export function calculateRemainingDays(endDate: string): number {
  const end   = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// Referral offers add days but never change the price.
// married_couple and corporate only discount 1-month plans.
export function calculateDiscountedPrice(planType: PlanType, offer: OfferType): number {
  const base = PLAN_BASE_PRICES[planType];
  if (offer === "none" || offer === "referral_5" || offer === "referral_9") return base;
  if (planType !== "1_month") return base;
  if (offer === "married_couple") return Number((base * 0.85).toFixed(2)); // 15% off, $29.75/person
  if (offer === "corporate")      return Number((base * 0.85).toFixed(2)); // 15% off
  return base;
}

export function getPlanLabel(plan: PlanType): string {
  const labels: Record<PlanType, string> = {
    daily:      "يومي",
    "1_month":  "شهر واحد",
    "2_months": "شهران",
    "3_months": "٣ أشهر",
    "4_months": "٤ أشهر",
    "6_months": "٦ أشهر",
    "7_months": "٧ أشهر",
    "8_months": "٨ أشهر",
    "9_months": "٩ أشهر",
    "12_months": "١٢ شهر",
  };
  return labels[plan];
}

export function getOfferLabel(offer: OfferType): string {
  const labels: Record<OfferType, string> = {
    none:           "بدون عرض",
    married_couple: "متزوجون (خصم ١٥٪ — $29.75/شخص)",
    referral_5:     "إحالة 5 أصدقاء (+شهر مجاني)",
    referral_9:     "إحالة 9 أصدقاء (+شهرين مجانيين)",
    corporate:      "موظف شركة/بنك (خصم ١٥٪)",
  };
  return labels[offer];
}

// ============================================================
// Cash session helpers
// ============================================================

export function calculateDiscrepancy(expected: number, actual: number): number {
  return Number((actual - expected).toFixed(2));
}

// ============================================================
// Inventory
// ============================================================

export function isLowStock(current: number, threshold: number): boolean {
  return current <= threshold;
}

export function isOutOfStock(current: number): boolean {
  return current <= 0;
}

// ============================================================
// Formatting
// ============================================================

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

const SYRIAN_MONTHS: string[] = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

export function formatDate(dateStr: string): string {
  const d     = new Date(dateStr);
  const day   = d.getDate();
  const month = SYRIAN_MONTHS[d.getMonth()];
  const year  = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function getCategoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    salaries: "رواتب", rent: "إيجار", equipment: "معدات",
    maintenance: "صيانة", utilities: "مرافق", supplies: "مستلزمات",
    marketing: "تسويق", miscellaneous: "متنوعة",
  };
  return labels[cat] || cat;
}

export function getProductCategoryLabel(cat: ProductCategory): string {
  const labels: Record<ProductCategory, string> = {
    supplements:  "مكملات",
    wearables:    "ملابس رياضية",
    protein_cups: "أكواب بروتين",
    bca_drinks:   "مشروبات BCAA",
    meals:        "وجبات",
    other:        "أخرى",
  };
  return labels[cat];
}

export function getPaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: "نقدي", card: "بطاقة", transfer: "تحويل", other: "أخرى",
  };
  return labels[method] || method;
}
