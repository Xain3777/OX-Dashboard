"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, RefreshCw, Banknote, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";

type Range = "today" | "week" | "month";

interface UserRow {
  id: string;
  displayName: string;
  role: string;
  shifts: number;
  openShifts: number;
  subscriptionsSYP: number;
  salesSYP: number;
  inbodySYP: number;
  subscriptionsUSD: number;
  salesUSD: number;
  inbodyUSD: number;
  totalDiscrepancySYP: number;
  hadDiscrepancy: boolean;
}

const RANGE_LABELS: Record<Range, string> = {
  today: "اليوم",
  week: "آخر 7 أيام",
  month: "آخر 30 يوم",
};

function rangeStart(r: Range): string {
  const d = new Date();
  if (r === "today") d.setHours(0, 0, 0, 0);
  else if (r === "week") d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d.toISOString();
}

function fmtSYP(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ل.س`;
}

function fmtUSD(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function ManagerReportBlock() {
  const { isManager } = useAuth();
  const supabase = supabaseBrowser();
  const [range, setRange] = useState<Range>("today");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isManager) return;
    setLoading(true);
    const since = rangeStart(range);

    // 1. profiles (only reception + manager that exist)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, role")
      .order("role", { ascending: true })
      .order("display_name", { ascending: true });

    const initRows: Record<string, UserRow> = {};
    (profiles ?? []).forEach((p: Record<string, unknown>) => {
      initRows[p.id as string] = {
        id: p.id as string,
        displayName: p.display_name as string,
        role: p.role as string,
        shifts: 0,
        openShifts: 0,
        subscriptionsSYP: 0,
        salesSYP: 0,
        inbodySYP: 0,
        subscriptionsUSD: 0,
        salesUSD: 0,
        inbodyUSD: 0,
        totalDiscrepancySYP: 0,
        hadDiscrepancy: false,
      };
    });

    // 2. cash sessions in range
    const { data: sessions } = await supabase
      .from("cash_sessions")
      .select("opened_by, status, discrepancy_syp, opened_at")
      .gte("opened_at", since);
    (sessions ?? []).forEach((s: Record<string, unknown>) => {
      const r = initRows[s.opened_by as string];
      if (!r) return;
      r.shifts += 1;
      if (s.status === "open") r.openShifts += 1;
      const disc = Number(s.discrepancy_syp ?? 0);
      if (disc !== 0) r.hadDiscrepancy = true;
      r.totalDiscrepancySYP += disc;
    });

    // 3. intake totals
    const sumByUser = async (table: string, amountCol: string) => {
      const { data } = await supabase
        .from(table)
        .select(`created_by, ${amountCol}, currency`)
        .gte("created_at", since);
      const map: Record<string, { syp: number; usd: number }> = {};
      (data ?? []).forEach((row: Record<string, unknown>) => {
        const uid = row.created_by as string;
        const cur = row.currency as string;
        const amt = Number(row[amountCol] ?? 0);
        if (!map[uid]) map[uid] = { syp: 0, usd: 0 };
        if (cur === "syp") map[uid].syp += amt;
        else map[uid].usd += amt;
      });
      return map;
    };

    const subsMap   = await sumByUser("subscriptions",   "paid_amount");
    const salesMap  = await sumByUser("sales",           "total");
    const inbodyMap = await sumByUser("inbody_sessions", "amount");

    Object.values(initRows).forEach((r) => {
      r.subscriptionsSYP = subsMap[r.id]?.syp   ?? 0;
      r.subscriptionsUSD = subsMap[r.id]?.usd   ?? 0;
      r.salesSYP         = salesMap[r.id]?.syp  ?? 0;
      r.salesUSD         = salesMap[r.id]?.usd  ?? 0;
      r.inbodySYP        = inbodyMap[r.id]?.syp ?? 0;
      r.inbodyUSD        = inbodyMap[r.id]?.usd ?? 0;
    });

    setRows(Object.values(initRows));
    setLoading(false);
  }, [supabase, isManager, range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isManager) return null;

  const hasAny = rows.length > 0;

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <Users size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
            تقرير الاستقبال
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {(["today", "week", "month"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                "px-3 py-1 font-mono text-[11px] tracking-widest uppercase clip-corner-sm border transition-colors",
                range === r
                  ? "bg-[#F5C100]/10 border-[#F5C100]/30 text-[#F5C100]"
                  : "border-transparent text-[#777777] hover:text-[#F0EDE6] hover:border-[#252525]",
              ].join(" ")}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
          <button
            onClick={() => void refresh()}
            className="p-1.5 text-[#777777] hover:text-[#F0EDE6] transition-colors"
            title="تحديث"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {!hasAny ? (
        <div className="p-8 text-center font-mono text-xs text-[#555555]">
          لا توجد بيانات بعد. شغّل الـ migration وأنشئ الحسابات أولاً.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-mono text-[#777777] tracking-widest uppercase border-b border-[#252525]">
                <th className="text-right px-3 py-2">الموظف</th>
                <th className="text-center px-2 py-2">الجلسات</th>
                <th className="text-right px-2 py-2">اشتراكات</th>
                <th className="text-right px-2 py-2">مبيعات</th>
                <th className="text-right px-2 py-2">InBody</th>
                <th className="text-right px-2 py-2">إجمالي</th>
                <th className="text-right px-3 py-2">الفرق التراكمي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const totalSYP = r.subscriptionsSYP + r.salesSYP + r.inbodySYP;
                const totalUSD = r.subscriptionsUSD + r.salesUSD + r.inbodyUSD;
                const isManagerRow = r.role === "manager";
                return (
                  <tr key={r.id} className="border-b border-[#252525] hover:bg-[#111111]/50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`font-display tracking-wider ${isManagerRow ? "text-[#F5C100]" : "text-[#F0EDE6]"}`}>
                          {r.displayName}
                        </span>
                        <span className="font-mono text-[9px] text-[#555555] uppercase">
                          {isManagerRow ? "مدير" : "استقبال"}
                        </span>
                      </div>
                    </td>
                    <td className="text-center px-2 py-2.5 font-mono text-xs tabular-nums">
                      <span className="text-[#F0EDE6]">{r.shifts}</span>
                      {r.openShifts > 0 && (
                        <span className="ml-1 inline-flex items-center text-[#5CC45C]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#5CC45C] animate-pulse mr-1" />
                          {r.openShifts}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Cell syp={r.subscriptionsSYP} usd={r.subscriptionsUSD} />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Cell syp={r.salesSYP} usd={r.salesUSD} />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <Cell syp={r.inbodySYP} usd={r.inbodyUSD} />
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <div className="font-mono text-xs text-[#F5C100] tabular-nums">{fmtSYP(totalSYP)}</div>
                      {totalUSD > 0 && (
                        <div className="font-mono text-[10px] text-[#AAAAAA] tabular-nums">{fmtUSD(totalUSD)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.shifts === 0 ? (
                        <span className="font-mono text-[10px] text-[#555555]">—</span>
                      ) : r.totalDiscrepancySYP === 0 ? (
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-[#5CC45C]">
                          <CheckCircle2 size={12} /> مطابق
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 font-mono text-xs ${r.totalDiscrepancySYP < 0 ? "text-[#FF3333]" : "text-[#F5C100]"}`}>
                          <AlertTriangle size={12} />
                          {fmtSYP(r.totalDiscrepancySYP)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-5 py-2 border-t border-[#252525] flex items-center justify-between">
        <span className="font-mono text-[10px] text-[#555555] tracking-widest uppercase">
          <Banknote size={10} className="inline mr-1" />
          النقد بالليرة فقط — الدولار يظهر منفصلاً
        </span>
        <span className="font-mono text-[10px] text-[#555555] tracking-widest">
          النطاق: {RANGE_LABELS[range]}
        </span>
      </div>
    </div>
  );
}

function Cell({ syp, usd }: { syp: number; usd: number }) {
  if (!syp && !usd) return <span className="font-mono text-[10px] text-[#555555]">—</span>;
  return (
    <>
      {syp > 0 && <div className="font-mono text-xs text-[#F0EDE6] tabular-nums">{fmtSYP(syp)}</div>}
      {usd > 0 && <div className="font-mono text-[10px] text-[#AAAAAA] tabular-nums">{fmtUSD(usd)}</div>}
    </>
  );
}
