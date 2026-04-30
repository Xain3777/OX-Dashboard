"use client";

// Wraps AlertsBlock with live data from Supabase + realtime updates.
// Translates DB rows into the legacy Subscription/Product/CashSession shapes
// AlertsBlock already knows how to render.

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Subscription, Product, CashSession } from "@/lib/types";
import AlertsBlock from "./AlertsBlock";

function diffDays(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export default function LiveAlertsBlock() {
  const supabase = supabaseBrowser();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [openSession, setOpenSession] = useState<CashSession | null>(null);
  const [unresolved, setUnresolved] = useState(0);

  const refresh = useCallback(async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [subsRes, prodsRes, sessRes, discRes] = await Promise.all([
      supabase.from("gym_subscriptions")
        .select("id, member_id, member_name, plan_type, offer, start_date, end_date, amount, paid_amount, payment_status, payment_method, currency, status")
        .is("cancelled_at", null)
        .not("member_name", "ilike", "%test%"),
      supabase.from("products")
        .select("id, name, category, cost, price, stock, low_stock_threshold, created_at"),
      supabase.from("cash_sessions")
        .select("id, opening_cash, opened_at, opened_by")
        .eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("discrepancy_logs").select("id", { count: "exact", head: true }).eq("resolved", false),
    ]);

    setSubs(((subsRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
      const end = new Date(String(r.end_date));
      const days = diffDays(today, end);
      return {
        id: String(r.id),
        memberId: String(r.member_id ?? ""),
        memberName: String(r.member_name),
        planType: String(r.plan_type) as Subscription["planType"],
        offer: String(r.offer ?? "none") as Subscription["offer"],
        startDate: String(r.start_date),
        endDate: String(r.end_date),
        remainingDays: days,
        amount: Number(r.amount ?? 0),
        paidAmount: Number(r.paid_amount ?? 0),
        paymentStatus: String(r.payment_status ?? "paid") as Subscription["paymentStatus"],
        paymentMethod: String(r.payment_method ?? "cash") as Subscription["paymentMethod"],
        currency: String(r.currency ?? "syp") as Subscription["currency"],
        status: String(r.status ?? "active") as Subscription["status"],
        createdAt: "",
        createdBy: "",
      } satisfies Subscription;
    }));

    setProducts(((prodsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      category: String(r.category) as Product["category"],
      cost: Number(r.cost ?? 0),
      price: Number(r.price ?? 0),
      stock: Number(r.stock ?? 0),
      lowStockThreshold: Number(r.low_stock_threshold ?? 5),
      createdAt: String(r.created_at ?? ""),
    } satisfies Product)));

    if (sessRes.data) {
      setOpenSession({
        id: String(sessRes.data.id),
        date: new Date(String(sessRes.data.opened_at)).toISOString().slice(0, 10),
        openingCash: Number(sessRes.data.opening_cash ?? 0),
        lockedOpening: true,
        totalCashSales: 0,
        totalCashExpenses: 0,
        expectedCash: 0,
        status: "open",
        openedBy: String(sessRes.data.opened_by ?? ""),
        openedAt: String(sessRes.data.opened_at),
      });
    } else {
      setOpenSession(null);
    }

    setUnresolved(discRes.count ?? 0);
  }, [supabase]);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel("live-alerts");
    for (const t of ["gym_subscriptions", "products", "cash_sessions", "discrepancy_logs"] as const) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => void refresh());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, refresh]);

  return (
    <AlertsBlock
      subscriptions={subs}
      products={products}
      cashSession={openSession}
      unresolvedDiscrepancies={unresolved}
    />
  );
}
