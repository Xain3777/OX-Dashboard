"use client";

import {
  CalendarClock,
  CreditCard,
  Package,
  PackageX,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Subscription, Product } from "@/lib/types";
import { formatDate, getProductCategoryLabel } from "@/lib/business-logic";

// ─── Alert model ───────────────────────────────────────────────────────────────

type AlertSeverity = "warning" | "critical";

interface Alert {
  id: string;
  severity: AlertSeverity;
  icon: React.ReactNode;
  message: string;
  detail?: string;
}

// ─── Alert row ─────────────────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: Alert }) {
  const isWarning = alert.severity === "warning";

  const barColor = isWarning ? "bg-gold" : "bg-red";
  const iconColor = isWarning ? "text-gold" : "text-red-bright";
  const messageColor = isWarning ? "text-offwhite" : "text-offwhite";
  const detailColor = "text-secondary";

  return (
    <div className="ox-table-row flex items-start gap-3 px-4 py-3 bg-gunmetal/30 hover:bg-gunmetal/50 transition-colors">
      {/* Severity bar */}
      <span
        className={`shrink-0 w-[3px] self-stretch rounded-full mt-0.5 ${barColor}`}
        aria-hidden="true"
      />

      {/* Icon */}
      <span className={`shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true">
        {alert.icon}
      </span>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className={`font-body text-sm leading-snug ${messageColor}`}>
          {alert.message}
        </p>
        {alert.detail && (
          <p className={`font-mono text-xs mt-0.5 ${detailColor}`}>
            {alert.detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface AlertsBlockProps {
  subscriptions: Subscription[];
  products: Product[];
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AlertsBlock({
  subscriptions,
  products,
}: AlertsBlockProps) {
  const alerts: Alert[] = [];

  // ── 1. اشتراكات تنتهي قريباً (المتبقي <= 7 أيام، نشطة) ──────────────────
  const expiringSubs = subscriptions.filter(
    (s) => s.status === "active" && s.remainingDays <= 7 && s.remainingDays > 0
  );

  for (const sub of expiringSubs) {
    const days = sub.remainingDays;
    alerts.push({
      id: `expiring-${sub.id}`,
      severity: days <= 2 ? "critical" : "warning",
      icon: <CalendarClock size={15} />,
      message: `اشتراك ${sub.memberName} ينتهي خلال ${days} ${days === 1 ? "يوم" : "أيام"}`,
      detail: `الباقة: ${sub.planType.replace("_", " ")} · تنتهي ${formatDate(sub.endDate)}`,
    });
  }

  // ── 2. اشتراكات غير مدفوعة أو مدفوعة جزئياً ────────────────────────────
  const unpaidSubs = subscriptions.filter(
    (s) =>
      s.status === "active" &&
      (s.paymentStatus === "unpaid" || s.paymentStatus === "partial")
  );

  for (const sub of unpaidSubs) {
    const outstanding = sub.amount - sub.paidAmount;
    const isUnpaid = sub.paymentStatus === "unpaid";
    alerts.push({
      id: `payment-${sub.id}`,
      severity: isUnpaid ? "critical" : "warning",
      icon: <CreditCard size={15} />,
      message: `${sub.memberName} — اشتراك ${isUnpaid ? "غير مدفوع" : "مدفوع جزئياً"}`,
      detail: `المبلغ المتبقي: ${outstanding.toLocaleString()}$ · المدفوع: ${sub.paidAmount.toLocaleString()} / ${sub.amount.toLocaleString()}$`,
    });
  }

  // ── 3. منتجات منخفضة المخزون (المخزون > 0 وعند الحد الأدنى أو دونه) ───────
  const lowStockProducts = products.filter(
    (p) => p.stock > 0 && p.stock <= p.lowStockThreshold
  );

  for (const product of lowStockProducts) {
    alerts.push({
      id: `lowstock-${product.id}`,
      severity: "warning",
      icon: <Package size={15} />,
      message: `مخزون منخفض: ${product.name}`,
      detail: `الكمية المتبقية: ${product.stock} ${product.stock === 1 ? "وحدة" : "وحدات"} · الحد الأدنى: ${product.lowStockThreshold}`,
    });
  }

  // ── 4. منتجات نفد مخزونها ────────────────────────────────────────────────
  const outOfStockProducts = products.filter((p) => p.stock <= 0);

  for (const product of outOfStockProducts) {
    alerts.push({
      id: `oos-${product.id}`,
      severity: "critical",
      icon: <PackageX size={15} />,
      message: `نفد المخزون: ${product.name}`,
      detail: `الفئة: ${getProductCategoryLabel(product.category)}`,
    });
  }

  // ── ترتيب: الحرجة أولاً ──────────────────────────────────────────────────
  alerts.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "critical" ? -1 : 1;
  });

  const hasCritical = alerts.some((a) => a.severity === "critical");
  const alertCount = alerts.length;

  return (
    <section
      aria-label="التنبيهات والتحذيرات"
      className="w-full bg-iron border border-gunmetal clip-corner"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gunmetal">
        <AlertTriangle
          size={16}
          className={hasCritical ? "text-red" : "text-secondary"}
          aria-hidden="true"
        />

        <h2 className="font-display text-xl tracking-wider text-offwhite leading-none">
          التنبيهات والتحذيرات
        </h2>

        {/* مؤشر الحالة الحرجة */}
        {hasCritical && (
          <span
            className="inline-block w-2 h-2 rounded-full bg-red glow-red animate-pulse"
            aria-label="توجد تنبيهات حرجة"
          />
        )}

        {/* عداد التنبيهات */}
        {alertCount > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-sm bg-gunmetal border border-gunmetal font-mono text-[11px] text-ghost tabular-nums">
            {alertCount} {alertCount === 1 ? "تنبيه" : "تنبيهات"}
          </span>
        )}
      </div>

      {/* قائمة التنبيهات أو حالة عدم وجود تنبيهات */}
      {alertCount === 0 ? (
        <div className="flex items-center gap-3 px-4 py-5">
          <CheckCircle2 size={18} className="text-success shrink-0" aria-hidden="true" />
          <p className="font-body text-sm text-ghost">
            الوضع جيد — لا توجد تنبيهات نشطة
          </p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-gunmetal/40">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </section>
  );
}
