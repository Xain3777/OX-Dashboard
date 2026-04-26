"use client";

import { useState } from "react";
import {
  TrendingUp, ShoppingBag, Users, Percent,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import PriceTag from "@/components/PriceTag";

interface CalculationsBlockProps {
  subscriptionRevenue: number;
  storeRevenue: number;
  supplementsRevenue: number;
  wearablesRevenue: number;
  mealsRevenue: number;
  drinksRevenue: number;
  totalDiscounts: number;
}

function CalcCard({ title, icon, mainValue, details, accent = "text-gold" }: {
  title: string; icon: React.ReactNode; mainValue: number;
  details: { label: string; value: number }[]; accent?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`bg-charcoal border border-gunmetal p-4 cursor-pointer transition-all duration-200 hover:border-gold/20 ${open ? "border-r-2 border-r-gold" : ""}`}
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-gold-dim">{icon}</div>
          <div>
            <h4 className="font-display text-sm tracking-wider text-offwhite">{title}</h4>
            <PriceTag amount={mainValue} size="lg" className={accent} />
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-slate" /> : <ChevronDown size={16} className="text-slate" />}
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-gunmetal space-y-2 animate-fade-in">
          {details.map((d) => (
            <div key={d.label} className="flex items-center justify-between">
              <span className="font-body text-xs text-ghost">{d.label}</span>
              <PriceTag amount={d.value} size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const COLORS_REV = ["#F5C100", "#5CC45C", "#4A9EFF", "#FF8C42", "#B07CFF"];

export default function CalculationsBlock(props: CalculationsBlockProps) {
  const {
    subscriptionRevenue, storeRevenue, supplementsRevenue, wearablesRevenue,
    mealsRevenue, drinksRevenue, totalDiscounts,
  } = props;

  const totalRevenue = subscriptionRevenue + storeRevenue;

  const cards = [
    {
      title: "إجمالي الإيرادات", icon: <TrendingUp size={20} />, mainValue: totalRevenue,
      accent: totalRevenue > 0 ? "text-success" : "text-red",
      details: [
        { label: "إيرادات الاشتراكات", value: subscriptionRevenue },
        { label: "إيرادات المتجر", value: storeRevenue },
      ],
    },
    {
      title: "أرباح المتجر", icon: <ShoppingBag size={20} />, mainValue: storeRevenue, accent: "text-success",
      details: [
        { label: "المكملات", value: supplementsRevenue },
        { label: "الملابس الرياضية", value: wearablesRevenue },
        { label: "الوجبات", value: mealsRevenue },
        { label: "المشروبات", value: drinksRevenue },
      ],
    },
    {
      title: "أرباح الاشتراكات", icon: <Users size={20} />, mainValue: subscriptionRevenue, accent: "text-gold",
      details: [{ label: "إجمالي الاشتراكات", value: subscriptionRevenue }],
    },
    {
      title: "الخصومات المقدمة", icon: <Percent size={20} />, mainValue: totalDiscounts, accent: "text-gold-bright",
      details: [{ label: "إجمالي الخصومات هذا الشهر", value: totalDiscounts }],
    },
  ];

  const revData = [
    { name: "اشتراكات", value: subscriptionRevenue },
    { name: "مكملات", value: supplementsRevenue },
    { name: "ملابس", value: wearablesRevenue },
    { name: "وجبات", value: mealsRevenue },
    { name: "مشروبات", value: drinksRevenue },
  ].filter((d) => d.value > 0);

  const totalRev = revData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => <CalcCard key={c.title} {...c} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-iron border border-gunmetal p-5">
          <h4 className="font-display text-base tracking-wider text-offwhite mb-2">توزيع الإيرادات</h4>
          {revData.length > 0 ? (
            <div className="flex flex-col items-center">
              <div className="relative">
                <ResponsiveContainer width={240} height={240}>
                  <PieChart>
                    <Pie data={revData} cx="50%" cy="50%" innerRadius={72} outerRadius={108} paddingAngle={3} dataKey="value" stroke="none" cornerRadius={4}>
                      {revData.map((_, i) => <Cell key={i} fill={COLORS_REV[i % COLORS_REV.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #252525", color: "#F0EDE6", fontFamily: "Cairo", borderRadius: 8 }} formatter={(v) => [`$${v}`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-mono text-2xl font-bold text-offwhite">${totalRev.toLocaleString()}</span>
                  <span className="text-[10px] text-secondary">إجمالي الإيرادات</span>
                </div>
              </div>
              {/* Custom legend */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 w-full max-w-[280px]">
                {revData.map((d, i) => {
                  const pct = totalRev > 0 ? ((d.value / totalRev) * 100).toFixed(0) : "0";
                  return (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS_REV[i % COLORS_REV.length] }} />
                      <span className="text-xs text-ghost flex-1 truncate">{d.name}</span>
                      <span className="font-mono text-xs text-secondary">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : <p className="text-center text-slate font-mono text-xs py-8">لا توجد بيانات</p>}
        </div>

      </div>
    </div>
  );
}
