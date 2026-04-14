"use client";

import { useState } from "react";
import Image from "next/image";
import {
  KPI,
  SUBSCRIPTIONS,
  PRODUCTS,
  SALES,
  EXPENSES,
  CASH_SESSION,
  AUDIT_LOG,
  WEEKLY_REVIEW,
  MONTHLY_REVIEW,
} from "@/lib/mock-data";
import { CurrencyProvider, useCurrency } from "@/lib/currency-context";
import ExchangeRateModal from "@/components/ExchangeRateModal";
import KPIStrip from "@/components/KPIStrip";
import AlertsBlock from "@/components/AlertsBlock";
import SubscriptionsBlock from "@/components/SubscriptionsBlock";
import StoreBlock from "@/components/StoreBlock";
import ExpensesBlock from "@/components/ExpensesBlock";
import ReconciliationBlock from "@/components/ReconciliationBlock";
import WeeklyReview from "@/components/WeeklyReview";
import MonthlyReview from "@/components/MonthlyReview";
import AuditLog from "@/components/AuditLog";
import CalculationsBlock from "@/components/CalculationsBlock";
import ExpenseRates from "@/components/ExpenseRates";
import {
  Shield,
  ChevronDown,
  ChevronUp,
  DollarSign,
} from "lucide-react";

type Section =
  | "alerts"
  | "reconciliation"
  | "subscriptions"
  | "store"
  | "expenses"
  | "rates"
  | "calculations"
  | "weekly"
  | "monthly"
  | "audit";

export default function DashboardPage() {
  return (
    <CurrencyProvider>
      <DashboardContent />
      <ExchangeRateModal />
    </CurrencyProvider>
  );
}

function DashboardContent() {
  const { exchangeRate, openRateModal } = useCurrency();

  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    alerts: false,
    reconciliation: false,
    subscriptions: false,
    store: false,
    expenses: false,
    rates: true,
    calculations: false,
    weekly: true,
    monthly: true,
    audit: false,
  });

  const toggle = (section: Section) =>
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));

  return (
    <div className="min-h-screen bg-void" dir="rtl">
      {/* === شريط التنقل === */}
      <nav
        className="sticky top-0 bg-charcoal/95 backdrop-blur-sm border-b border-gunmetal px-6 py-3 flex items-center justify-between"
        style={{ zIndex: 100 }}
      >
        <div className="flex items-center gap-3">
          <Image
            src="/logo-full.png"
            alt="OX GYM"
            width={48}
            height={48}
            className="h-10 w-auto"
          />
          <div>
            <h1 className="font-display text-xl tracking-wider text-offwhite leading-none">
              لوحة التحكم المالية
            </h1>
            <p className="font-mono text-[10px] text-slate tracking-widest">
              نظام إدارة عمليات النادي
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Exchange Rate Display */}
          <button
            onClick={openRateModal}
            className="flex items-center gap-2 px-3 py-1.5 bg-iron border border-gunmetal hover:border-gold/30 transition-colors cursor-pointer"
            title="اضغط لتعديل سعر الصرف"
          >
            <DollarSign size={14} className="text-gold" />
            <span className="font-mono text-xs text-gold">1$ = {exchangeRate.toLocaleString()} ل.س</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-secondary font-mono">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            الجلسة مفتوحة
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-iron border border-gunmetal">
            <Shield size={14} className="text-gold-dim" />
            <span className="font-mono text-xs text-ghost">لينا</span>
            <span className="font-mono text-[10px] text-slate">
              موظفة استقبال
            </span>
          </div>
        </div>
      </nav>

      {/* === المحتوى الرئيسي === */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* شريط المؤشرات */}
        <KPIStrip kpi={KPI} />

        {/* التنبيهات */}
        <CollapsibleSection
          title="التنبيهات والتحذيرات"
          collapsed={collapsed.alerts}
          onToggle={() => toggle("alerts")}
        >
          <AlertsBlock
            subscriptions={SUBSCRIPTIONS}
            products={PRODUCTS}
            cashSession={CASH_SESSION}
            unresolvedDiscrepancies={KPI.unresolvedDiscrepancies}
          />
        </CollapsibleSection>

        {/* الحسابات السريعة — 6 buttons + pie charts */}
        <CollapsibleSection
          title="الحسابات السريعة"
          collapsed={collapsed.calculations}
          onToggle={() => toggle("calculations")}
        >
          <CalculationsBlock
            subscriptionRevenue={MONTHLY_REVIEW.subscriptionRevenue}
            storeRevenue={MONTHLY_REVIEW.storeRevenue}
            supplementsRevenue={420}
            wearablesRevenue={280}
            mealsRevenue={300}
            drinksRevenue={180}
            totalExpenses={MONTHLY_REVIEW.totalExpenses}
            salariesExpense={MONTHLY_REVIEW.expenseBreakdown.salaries}
            rentExpense={MONTHLY_REVIEW.expenseBreakdown.rent}
            productsExpense={350}
            maintenanceExpense={MONTHLY_REVIEW.expenseBreakdown.maintenance}
            suppliesExpense={MONTHLY_REVIEW.expenseBreakdown.supplies}
            otherExpense={MONTHLY_REVIEW.expenseBreakdown.miscellaneous}
            totalDiscounts={85}
            cashOnHand={KPI.cashOnHand}
            expectedCash={CASH_SESSION.expectedCash}
          />
        </CollapsibleSection>

        {/* تسوية الصندوق */}
        <CollapsibleSection
          title="تسوية الصندوق اليومية"
          collapsed={collapsed.reconciliation}
          onToggle={() => toggle("reconciliation")}
          accent
        >
          <ReconciliationBlock
            session={CASH_SESSION}
            onCloseDay={(data) => console.log("تم إغلاق اليوم:", data)}
            totalTransactions={SALES.length + EXPENSES.length}
            cardTransferSales={
              SALES.filter((s) => s.paymentMethod === "card" || s.paymentMethod === "transfer")
                .reduce((sum, s) => sum + s.total, 0)
            }
          />
        </CollapsibleSection>

        {/* الاشتراكات — FULL WIDTH */}
        <CollapsibleSection
          title="الاشتراكات"
          collapsed={collapsed.subscriptions}
          onToggle={() => toggle("subscriptions")}
        >
          <SubscriptionsBlock />
        </CollapsibleSection>

        {/* المتجر — FULL WIDTH */}
        <CollapsibleSection
          title="المتجر والمخزون"
          collapsed={collapsed.store}
          onToggle={() => toggle("store")}
        >
          <StoreBlock />
        </CollapsibleSection>

        {/* المصروفات */}
        <CollapsibleSection
          title="المصروفات"
          collapsed={collapsed.expenses}
          onToggle={() => toggle("expenses")}
        >
          <ExpensesBlock />
        </CollapsibleSection>

        {/* جدول الأسعار والرواتب */}
        <CollapsibleSection
          title="جدول الأسعار والرواتب"
          collapsed={collapsed.rates}
          onToggle={() => toggle("rates")}
        >
          <ExpenseRates />
        </CollapsibleSection>

        {/* مراجعة أسبوعية + شهرية */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <CollapsibleSection
            title="المراجعة الأسبوعية"
            collapsed={collapsed.weekly}
            onToggle={() => toggle("weekly")}
          >
            <WeeklyReview data={WEEKLY_REVIEW} />
          </CollapsibleSection>

          <CollapsibleSection
            title="المراجعة الشهرية"
            collapsed={collapsed.monthly}
            onToggle={() => toggle("monthly")}
          >
            <MonthlyReview
              data={MONTHLY_REVIEW}
              onLock={() => console.log("تم قفل الشهر")}
            />
          </CollapsibleSection>
        </div>

        {/* سجل المراجعة */}
        <CollapsibleSection
          title="سجل المراجعة"
          collapsed={collapsed.audit}
          onToggle={() => toggle("audit")}
        >
          <AuditLog entries={AUDIT_LOG} />
        </CollapsibleSection>

        {/* التذييل */}
        <footer className="border-t border-gunmetal pt-4 pb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-icon.png"
              alt="OX"
              width={20}
              height={20}
              className="h-5 w-auto"
            />
            <span className="font-mono text-[10px] text-slate">
              نظام OX GYM المالي - الإصدار 1.0
            </span>
          </div>
          <span className="font-mono text-[10px] text-slate">
            جميع السجلات غير قابلة للتعديل ومُراجَعة
          </span>
        </footer>
      </main>
    </div>
  );
}

function CollapsibleSection({
  title,
  collapsed,
  onToggle,
  accent,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={accent ? "border-t-[3px] border-t-gold" : ""}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-2 group cursor-pointer"
      >
        <h2 className="font-display text-lg tracking-wider text-offwhite group-hover:text-gold transition-colors duration-200">
          {title}
        </h2>
        <div className="flex items-center gap-2 text-secondary group-hover:text-gold transition-colors duration-200">
          <span className="font-mono text-[10px] tracking-wider">
            {collapsed ? "توسيع" : "طي"}
          </span>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </button>
      {!collapsed && <div className="animate-fade-in">{children}</div>}
    </div>
  );
}
