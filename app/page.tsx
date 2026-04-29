"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import * as XLSX from "xlsx";
import { CurrencyProvider, useCurrency } from "@/lib/currency-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { StoreProvider, useStore } from "@/lib/store-context";
import type { ActivityEntry, ActivityType } from "@/lib/store-context";
import type { AuditEntry, AuditAction } from "@/lib/types";
import ExchangeRateModal from "@/components/ExchangeRateModal";
import KPIStrip from "@/components/KPIStrip";
import LiveAlertsBlock from "@/components/LiveAlertsBlock";
import SubscriptionsBlock from "@/components/SubscriptionsBlock";
import StoreBlock from "@/components/StoreBlock";
import CashSessionBlock from "@/components/CashSessionBlock";
import SessionTransactionsList from "@/components/SessionTransactionsList";
import ManagerReportBlock from "@/components/ManagerReportBlock";
import WeeklyReview from "@/components/WeeklyReview";
import MonthlyReview from "@/components/MonthlyReview";
import AuditLog from "@/components/AuditLog";
import CalculationsBlock from "@/components/CalculationsBlock";
import InBodyBlock from "@/components/InBodyBlock";
import KitchenBlock from "@/components/KitchenBlock";
import LoginScreen from "@/components/LoginScreen";
import ManagerDashboard from "@/components/ManagerDashboard";
import {
  Shield,
  ChevronDown,
  ChevronUp,
  DollarSign,
  LogOut,
  FileSpreadsheet,
  AlertTriangle,
  X,
  Activity,
  ShoppingCart,
  Dumbbell,
  Tag,
} from "lucide-react";
import { formatTime, formatDate } from "@/lib/utils/time";

type Section =
  | "alerts"
  | "subscriptions"
  | "store"
  | "inbody"
  | "kitchen"
  | "calculations"
  | "weekly"
  | "monthly"
  | "audit"
  | "livefeed";

// ── Root ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <StoreProvider>
          <AppRouter />
        </StoreProvider>
      </CurrencyProvider>
    </AuthProvider>
  );
}

function AppRouter() {
  const { user, isManager, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-void" />;
  if (!user) return <LoginScreen />;
  if (isManager) return <ManagerDashboard />;
  return (
    <>
      <DashboardContent />
      <ExchangeRateModal />
    </>
  );
}

// ── Logout confirmation modal ─────────────────────────────────────────────────

function LogoutModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="bg-[#1A1A1A] border border-[#252525] p-6 rounded-sm max-w-sm w-full mx-4 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={18} className="text-[#F5C100] shrink-0" />
          <h3 className="font-display text-lg tracking-wider text-[#F0EDE6]">تسجيل الخروج</h3>
        </div>
        <p className="font-body text-sm text-[#AAAAAA] mb-6 leading-relaxed">
          هل أنت متأكد من تسجيل الخروج؟ سيتم إنهاء الجلسة الحالية.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 bg-[#D42B2B] hover:bg-[#FF3333] text-white font-display text-sm tracking-widest transition-colors rounded-sm cursor-pointer"
          >
            خروج
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 border border-[#252525] text-[#777777] hover:text-[#F0EDE6] font-mono text-xs transition-colors rounded-sm cursor-pointer"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Excel export ──────────────────────────────────────────────────────────────

function exportMonthlyExcel(ctx: {
  sales: ReturnType<typeof useStore>["sales"];
  subscriptions: ReturnType<typeof useStore>["subscriptions"];
  inBodySessions: ReturnType<typeof useStore>["inBodySessions"];
  products: ReturnType<typeof useStore>["products"];
  exchangeRate: number;
}) {
  const { sales, subscriptions, inBodySessions, products, exchangeRate } = ctx;
  const curLabel = (c?: string) => c === "syp" ? "ل.س" : "$";

  const wb = XLSX.utils.book_new();

  // ── 1. ملخص شهري ──────────────────────────────────────────────────────────
  const totalSaleUSD   = sales.filter(s => !s.isReversal).reduce((s, r) => s + r.total, 0);
  const totalInBodySYP = inBodySessions.reduce((s, r) => s + r.priceSYP, 0);
  const totalInBodyUSD = Math.round((totalInBodySYP / exchangeRate) * 100) / 100;

  const summaryData = [
    ["البند", "المبلغ ($)"],
    ["إجمالي مبيعات المتجر", totalSaleUSD],
    ["إجمالي جلسات InBody", totalInBodyUSD],
    ["إجمالي الإيرادات", totalSaleUSD + totalInBodyUSD],
    ["سعر الصرف (ل.س/$)", exchangeRate],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, "الملخص الشهري");

  // ── 2. جلسات InBody ────────────────────────────────────────────────────────
  const inBodyRows = [
    ["التاريخ", "الوقت", "الاسم", "النوع", "نوع الجلسة", "السعر (ل.س)", "السعر ($)", "العملة", "الموظف"],
    ...inBodySessions.map(s => {
      return [
        formatDate(s.createdAt),
        formatTime(s.createdAt),
        s.memberName,
        s.memberType === "gym_member" ? "عضو النادي" : "زيارة خارجية",
        s.sessionType ?? "single",
        s.priceSYP,
        Math.round((s.priceSYP / exchangeRate) * 100) / 100,
        curLabel(s.currency),
        s.createdByName,
      ];
    }),
  ];
  const wsInBody = XLSX.utils.aoa_to_sheet(inBodyRows);
  XLSX.utils.book_append_sheet(wb, wsInBody, "جلسات InBody");

  // ── 3. مبيعات المتجر ───────────────────────────────────────────────────────
  const storeRows = [
    ["التاريخ", "الوقت", "المنتج", "الكمية", "سعر الوحدة", "الإجمالي", "العملة", "ملاحظات"],
    ...sales.map(s => {
      return [
        formatDate(s.createdAt),
        formatTime(s.createdAt),
        s.productName,
        s.quantity,
        s.unitPrice,
        s.isReversal ? -s.total : s.total,
        curLabel(s.currency),
        s.isReversal ? "مُسترجع" : "",
      ];
    }),
  ];
  const wsStore = XLSX.utils.aoa_to_sheet(storeRows);
  XLSX.utils.book_append_sheet(wb, wsStore, "مبيعات المتجر");

  // ── 4. الاشتراكات ──────────────────────────────────────────────────────────
  const subRows = [
    ["تاريخ الإنشاء", "العضو", "الخطة", "المبلغ", "العملة", "حالة الدفع", "الحالة"],
    ...subscriptions.map(s => {
      return [
        formatDate(s.createdAt),
        s.memberName,
        s.planType,
        s.amount,
        curLabel(s.currency),
        s.paymentStatus,
        s.status,
      ];
    }),
  ];
  const wsSubs = XLSX.utils.aoa_to_sheet(subRows);
  XLSX.utils.book_append_sheet(wb, wsSubs, "الاشتراكات");

  // ── 5. المخزون ─────────────────────────────────────────────────────────────
  const stockRows = [
    ["المنتج", "التصنيف", "التكلفة ($)", "سعر البيع ($)", "هامش الربح %", "المخزون"],
    ...products.map(p => {
      const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
      return [p.name, p.category, p.cost, p.price, `${margin}%`, p.stock];
    }),
  ];
  const wsStock = XLSX.utils.aoa_to_sheet(stockRows);
  XLSX.utils.book_append_sheet(wb, wsStock, "المخزون");

  // ── Save ───────────────────────────────────────────────────────────────────
  const month = new Date().toLocaleDateString("ar-SY", { timeZone: "Asia/Damascus", month: "long", year: "numeric" });
  XLSX.writeFile(wb, `ملخص_OX_GYM_${month}.xlsx`);
}

// ── Activity → Audit converter ────────────────────────────────────────────────

const ACTIVITY_TO_AUDIT_ACTION: Partial<Record<ActivityType, AuditAction>> = {
  sale: "sale_created",
  inbody: "inbody_session",
  subscription: "subscription_created",
  price_edit: "price_edit",
};

function activityFeedToAuditEntries(feed: ActivityEntry[]): AuditEntry[] {
  return feed.map((e) => ({
    id: e.id,
    action: ACTIVITY_TO_AUDIT_ACTION[e.type] ?? "sale_created",
    description: e.description,
    entityType: e.type,
    entityId: e.id,
    userId: e.userId,
    userName: e.userName,
    timestamp: e.timestamp,
  }));
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardContent() {
  const { exchangeRate, openRateModal } = useCurrency();
  const { user, signOut, isManager } = useAuth();
  const store = useStore();

  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const roleLabel = user?.role === "manager" ? "مدير" : "موظف استقبال";

  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    alerts: false,
    subscriptions: false,
    store: false,
    inbody: false,
    kitchen: false,
    calculations: false,
    weekly: true,
    monthly: true,
    audit: false,
    livefeed: false,
  });

  const toggle = (section: Section) =>
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));

  const handleLogoutConfirm = useCallback(() => {
    setShowLogoutModal(false);
    void signOut();
  }, [signOut]);

  return (
    <div className="min-h-screen bg-void" dir="rtl">

      {/* Logout confirmation */}
      {showLogoutModal && (
        <LogoutModal
          onConfirm={handleLogoutConfirm}
          onCancel={() => setShowLogoutModal(false)}
        />
      )}

      {/* === شريط التنقل === */}
      <nav
        className="sticky top-0 bg-charcoal border-b border-gunmetal px-6 py-3 flex items-center justify-between"
        style={{ zIndex: 100, overflow: "visible" }}
      >
        <div className="flex items-center gap-3">
          <Image src="/logo-full.png" alt="OX GYM" width={48} height={48} className="h-10 w-auto" />
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
          {/* Exchange Rate */}
          <div className="relative group">
            <button
              onClick={openRateModal}
              className="flex items-center gap-2 px-3 py-1.5 bg-iron border border-gunmetal hover:border-gold/30 transition-colors cursor-pointer"
            >
              <DollarSign size={14} className="text-gold" />
              <span className="font-mono text-xs text-gold">1$ = {exchangeRate.toLocaleString()} ل.س</span>
            </button>
            {/* Custom tooltip */}
            <div className="absolute top-full mt-2 right-0 px-2 py-1 bg-[#0A0A0A] border border-[#F5C100]/30 rounded text-[10px] font-mono text-[#F0EDE6] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" style={{ zIndex: 99999, boxShadow: "0 4px 16px rgba(0,0,0,0.8)" }}>
              اضغط لتعديل سعر الصرف
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-secondary font-mono">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            الجلسة مفتوحة
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-iron border border-gunmetal">
            <Shield size={14} className="text-gold-dim" />
            <span className="font-mono text-xs text-ghost">{user?.displayName}</span>
            <span className="font-mono text-[10px] text-slate">{roleLabel}</span>
          </div>

          {/* Logout button with custom tooltip */}
          <div className="relative group">
            <button
              onClick={() => setShowLogoutModal(true)}
              className="flex items-center gap-1 px-2 py-1.5 text-[#777777] hover:text-[#FF3333] transition-colors cursor-pointer"
            >
              <LogOut size={14} />
            </button>
            <div className="absolute top-full mt-2 right-0 px-2 py-1 bg-[#0A0A0A] border border-[#F5C100]/30 rounded text-[10px] font-mono text-[#F0EDE6] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" style={{ zIndex: 99999, boxShadow: "0 4px 16px rgba(0,0,0,0.8)" }}>
              تسجيل الخروج
            </div>
          </div>
        </div>
      </nav>

      {/* === المحتوى الرئيسي === */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        <KPIStrip hideProfit={!isManager} />

        {/* Cash session — top of page for the active user */}
        <CashSessionBlock />

        {/* Live transactions for the open session — with cancel/refund */}
        <SessionTransactionsList />

        {/* Manager-only: per-reception report */}
        {isManager && <ManagerReportBlock />}

        {/* نشاط مباشر — manager only */}
        {isManager && (
          <CollapsibleSection title="النشاط المباشر — ما يفعله الفريق الآن" collapsed={collapsed.livefeed} onToggle={() => toggle("livefeed")}>
            <LiveFeedPanel feed={store.activityFeed} />
          </CollapsibleSection>
        )}

        {/* التنبيهات */}
        <CollapsibleSection title="التنبيهات والتحذيرات" collapsed={collapsed.alerts} onToggle={() => toggle("alerts")}>
          <LiveAlertsBlock />
        </CollapsibleSection>

        {/* الحسابات السريعة — manager only */}
        {isManager && (
          <CollapsibleSection title="الحسابات السريعة" collapsed={collapsed.calculations} onToggle={() => toggle("calculations")}>
            <CalculationsBlock
              subscriptionRevenue={420}
              storeRevenue={store.sales.filter(s => !s.isReversal).reduce((a, b) => a + b.total, 0)}
              supplementsRevenue={420}
              wearablesRevenue={280}
              mealsRevenue={300}
              drinksRevenue={180}
              totalExpenses={0}
              salariesExpense={0}
              rentExpense={0}
              productsExpense={0}
              maintenanceExpense={0}
              suppliesExpense={0}
              otherExpense={0}
              totalDiscounts={85}
              cashOnHand={0}
              expectedCash={0}
            />
          </CollapsibleSection>
        )}

        {/* الاشتراكات */}
        <CollapsibleSection title="الاشتراكات" collapsed={collapsed.subscriptions} onToggle={() => toggle("subscriptions")}>
          <SubscriptionsBlock />
        </CollapsibleSection>

        {/* جهاز InBody */}
        <CollapsibleSection title="جهاز InBody" collapsed={collapsed.inbody} onToggle={() => toggle("inbody")}>
          <InBodyBlock />
        </CollapsibleSection>

        {/* المتجر */}
        <CollapsibleSection title="المتجر والمخزون" collapsed={collapsed.store} onToggle={() => toggle("store")}>
          <StoreBlock />
        </CollapsibleSection>

        {/* المطبخ — طلبات الاستقبال */}
        <CollapsibleSection title="المطبخ" collapsed={collapsed.kitchen} onToggle={() => toggle("kitchen")}>
          <KitchenBlock />
        </CollapsibleSection>

        {/* مراجعة أسبوعية + شهرية — manager only */}
        {isManager && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <CollapsibleSection title="المراجعة الأسبوعية" collapsed={collapsed.weekly} onToggle={() => toggle("weekly")}>
              <WeeklyReview data={{ weekStart: "2026-04-07", weekEnd: "2026-04-13", totalRevenue: 2850, totalExpenses: 780, subscriptionRevenue: 1630, storeRevenue: 1220, newSubscriptions: 2, expiredSubscriptions: 1, expiringThisWeek: 2, pendingPayments: 1, stockMovements: 34, unresolvedDiscrepancies: 0 }} />
            </CollapsibleSection>
            <CollapsibleSection title="المراجعة الشهرية" collapsed={collapsed.monthly} onToggle={() => toggle("monthly")}>
              <MonthlyReview
                data={{ month: "أبريل", year: 2026, totalRevenue: 8620, totalExpenses: 12350, netProfit: -3730, subscriptionRevenue: 5790, storeRevenue: store.sales.filter(s => !s.isReversal).reduce((a, b) => a + b.total, 0), expenseBreakdown: { salaries: 6700, rent: 5000, equipment: 0, maintenance: 320, utilities: 150, supplies: 120, marketing: 0, miscellaneous: 60 }, topProducts: [{ name: "كوب بروتين (طازج)", quantity: 48, revenue: 720 }, { name: "مشروب BCAA (بارد)", quantity: 38, revenue: 380 }, { name: "واي بروتين ٢ كجم", quantity: 6, revenue: 1080 }], activeSubscriptions: 7, expiredSubscriptions: 1, locked: false }}
                onLock={() => console.log("تم قفل الشهر")}
              />
            </CollapsibleSection>
          </div>
        )}

        {/* سجل المراجعة */}
        <CollapsibleSection title="سجل المراجعة" collapsed={collapsed.audit} onToggle={() => toggle("audit")}>
          <AuditLog entries={activityFeedToAuditEntries(store.activityFeed)} />
        </CollapsibleSection>

        {/* ════════════════════════════════════════════════════════════
            التذييل — Monthly Excel Export
        ════════════════════════════════════════════════════════════ */}
        <footer className="border-t border-gunmetal pt-6 pb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Image src="/logo-icon.png" alt="OX" width={20} height={20} className="h-5 w-auto" />
              <span className="font-mono text-[10px] text-slate">
                نظام OX GYM المالي — الإصدار 1.0
              </span>
            </div>

            {/* Monthly summary export button */}
            <button
              onClick={() =>
                exportMonthlyExcel({
                  sales:          store.sales,
                  subscriptions:  store.subscriptions,
                  inBodySessions: store.inBodySessions,
                  products:       store.products,
                  exchangeRate,
                })
              }
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] border border-[#252525] hover:border-[#F5C100]/40 hover:bg-[#F5C100]/5 text-[#AAAAAA] hover:text-[#F5C100] font-mono text-xs tracking-wider transition-colors rounded-sm cursor-pointer clip-corner-sm"
            >
              <FileSpreadsheet size={14} />
              تصدير الملخص الشهري — Excel
            </button>

            <span className="font-mono text-[10px] text-slate">
              جميع السجلات غير قابلة للتعديل ومُراجَعة
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ── Live feed panel (manager view of all staff actions) ───────────────────────

const FEED_ICON: Partial<Record<ActivityType, React.ReactNode>> = {
  sale:         <ShoppingCart size={12} className="text-[#5CC45C]" />,
  inbody:       <Dumbbell size={12} className="text-[#F5C100]" />,
  subscription: <Activity size={12} className="text-[#AAAAAA]" />,
  price_edit:   <Tag size={12} className="text-[#F5C100]" />,
};

const FEED_TYPE_LABEL: Partial<Record<ActivityType, string>> = {
  sale: "بيع", inbody: "InBody", subscription: "اشتراك", price_edit: "تعديل سعر",
};

function LiveFeedPanel({ feed }: { feed: ActivityEntry[] }) {
  if (feed.length === 0) {
    return (
      <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm px-5 py-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          لا يوجد نشاط حتى الآن — سيظهر هنا كل ما يسجله الفريق فوراً
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111]">
        <Activity size={13} className="text-[#F5C100]" />
        <span className="font-display tracking-widest text-sm text-[#F0EDE6] uppercase">سجل النشاط المباشر</span>
        <span className="w-2 h-2 rounded-full bg-[#5CC45C] animate-pulse" />
        <span className="font-mono text-[10px] text-[#555555]">{feed.length} إدخال</span>
      </div>
      <div className="divide-y divide-[#252525]/60">
        {feed.slice(0, 30).map((entry) => {
          const time = formatTime(entry.timestamp);
          const date = new Date(entry.timestamp).toLocaleDateString("ar-SY", { timeZone: "Asia/Damascus", month: "short", day: "numeric" });
          return (
            <div key={entry.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#252525]/30 transition-colors">
              <div className="shrink-0 w-5 h-5 flex items-center justify-center">
                {FEED_ICON[entry.type]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#F0EDE6] truncate">{entry.description}</p>
                <p className="font-mono text-[10px] text-[#555555]">{entry.userName}</p>
              </div>
              <div className="shrink-0 text-left">
                {(entry.amountUSD != null || entry.amountSYP != null) && (
                  <p className="font-mono text-xs text-[#F5C100] tabular-nums">
                    {entry.amountSYP
                      ? `${entry.amountSYP.toLocaleString("ar-SY")} ل.س`
                      : `${entry.amountUSD?.toFixed(2)}$`}
                  </p>
                )}
                <p className="font-mono text-[10px] text-[#555555]">{date} {time}</p>
              </div>
              <span className="shrink-0 inline-block px-1.5 py-0.5 bg-[#252525] border border-[#555555]/30 rounded text-[9px] font-mono text-[#777777] uppercase tracking-wide">
                {FEED_TYPE_LABEL[entry.type]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────────────────────────

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
