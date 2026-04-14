"use client";

import { useState } from "react";
import {
  TrendingUp, ShoppingBag, Users, Percent, Receipt, Wrench,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import PriceTag from "@/components/PriceTag";

interface CalculationsBlockProps {
  subscriptionRevenue: number;
  storeRevenue: number;
  supplementsRevenue: number;
  wearablesRevenue: number;
  mealsRevenue: number;
  drinksRevenue: number;
  totalExpenses: number;
  salariesExpense: number;
  rentExpense: number;
  productsExpense: number;
  maintenanceExpense: number;
  suppliesExpense: number;
  otherExpense: number;
  totalDiscounts: number;
  cashOnHand: number;
  expectedCash: number;
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

const COLORS_REV = ["#F5C100", "#5CC45C", "#4A9EFF", "#FF8C42", "#9B59B6"];
const COLORS_EXP = ["#8A6D00", "#D42B2B", "#777777", "#C49A00", "#555555", "#AAAAAA"];

export default function CalculationsBlock(props: CalculationsBlockProps) {
  const {
    subscriptionRevenue, storeRevenue, supplementsRevenue, wearablesRevenue,
    mealsRevenue, drinksRevenue, totalExpenses, salariesExpense, rentExpense,
    productsExpense, maintenanceExpense, suppliesExpense, otherExpense,
    totalDiscounts, cashOnHand, expectedCash,
  } = props;

  const totalRevenue = subscriptionRevenue + storeRevenue;
  const shortage = cashOnHand - expectedCash;

  const cards = [
    {
      title: "الدخل والعجز", icon: <TrendingUp size={20} />, mainValue: totalRevenue,
      accent: totalRevenue > 0 ? "text-success" : "text-red",
      details: [
        { label: "إيرادات الاشتراكات", value: subscriptionRevenue },
        { label: "إيرادات المتجر", value: storeRevenue },
        { label: "النقد المتوقع", value: expectedCash },
        { label: "النقد المتوفر", value: cashOnHand },
        { label: shortage >= 0 ? "فائض" : "عجز", value: Math.abs(shortage) },
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
    {
      title: "إجمالي المصروفات", icon: <Receipt size={20} />, mainValue: totalExpenses, accent: "text-red",
      details: [
        { label: "الرواتب", value: salariesExpense },
        { label: "الإيجار", value: rentExpense },
        { label: "تكلفة المنتجات", value: productsExpense },
        { label: "الصيانة", value: maintenanceExpense },
        { label: "المستلزمات والمنظفات", value: suppliesExpense },
        { label: "أخرى", value: otherExpense },
      ],
    },
    {
      title: "الصيانة والمستلزمات", icon: <Wrench size={20} />, mainValue: maintenanceExpense + suppliesExpense, accent: "text-secondary",
      details: [
        { label: "صيانة (إصلاح إضاءة، أجهزة...)", value: maintenanceExpense },
        { label: "مستلزمات ومنظفات", value: suppliesExpense },
      ],
    },
  ];

  const revData = [
    { name: "اشتراكات", value: subscriptionRevenue },
    { name: "مكملات", value: supplementsRevenue },
    { name: "ملابس", value: wearablesRevenue },
    { name: "وجبات", value: mealsRevenue },
    { name: "مشروبات", value: drinksRevenue },
  ].filter((d) => d.value > 0);

  const expData = [
    { name: "رواتب", value: salariesExpense },
    { name: "إيجار", value: rentExpense },
    { name: "منتجات", value: productsExpense },
    { name: "صيانة", value: maintenanceExpense },
    { name: "مستلزمات", value: suppliesExpense },
    { name: "أخرى", value: otherExpense },
  ].filter((d) => d.value > 0);

  const renderLabel = ({ percent }: { percent?: number }) => percent ? `${(percent * 100).toFixed(0)}%` : "";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => <CalcCard key={c.title} {...c} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-iron border border-gunmetal p-4">
          <h4 className="font-display text-base tracking-wider text-offwhite mb-4">توزيع الإيرادات</h4>
          {revData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={revData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={renderLabel} labelLine={false}>
                  {revData.map((_, i) => <Cell key={i} fill={COLORS_REV[i % COLORS_REV.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #252525", color: "#F0EDE6", fontFamily: "IBM Plex Sans Arabic" }} formatter={(v) => [`$${v}`, ""]} />
                <Legend wrapperStyle={{ fontFamily: "IBM Plex Sans Arabic", fontSize: 12, color: "#AAAAAA" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate font-mono text-xs py-8">لا توجد بيانات</p>}
        </div>

        <div className="bg-iron border border-gunmetal p-4">
          <h4 className="font-display text-base tracking-wider text-offwhite mb-4">توزيع المصروفات</h4>
          {expData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={expData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={renderLabel} labelLine={false}>
                  {expData.map((_, i) => <Cell key={i} fill={COLORS_EXP[i % COLORS_EXP.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1A1A1A", border: "1px solid #252525", color: "#F0EDE6", fontFamily: "IBM Plex Sans Arabic" }} formatter={(v) => [`$${v}`, ""]} />
                <Legend wrapperStyle={{ fontFamily: "IBM Plex Sans Arabic", fontSize: 12, color: "#AAAAAA" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-slate font-mono text-xs py-8">لا توجد بيانات</p>}
        </div>
      </div>
    </div>
  );
}
