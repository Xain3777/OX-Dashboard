"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, X, Undo2, ShoppingCart, Activity, Dumbbell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cancelTransaction, type CancellableTable } from "@/lib/supabase/intake";

type Kind = "sale" | "subscription" | "inbody";

interface Row {
  id: string;
  kind: Kind;
  table: CancellableTable;
  label: string;
  amount: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
}

const KIND_META: Record<Kind, { label: string; icon: React.ReactNode; color: string }> = {
  sale:         { label: "بيع",    icon: <ShoppingCart size={11} />, color: "text-[#5CC45C]" },
  subscription: { label: "اشتراك", icon: <Activity size={11} />,     color: "text-[#AAAAAA]" },
  inbody:       { label: "InBody", icon: <Dumbbell size={11} />,     color: "text-[#F5C100]" },
};

function fmtUSD(n: number) { return `$${n.toFixed(2)}`; }

export default function SessionTransactionsList() {
  const { user, isManager } = useAuth();
  const supabase = supabaseBrowser();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [confirming, setConfirming] = useState<{ row: Row } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolveSession = useCallback(async () => {
    if (!user) return null;
    const q = supabase.from("cash_sessions").select("id").eq("status", "open").order("opened_at", { ascending: false }).limit(1);
    const { data } = isManager ? await q : await q.eq("opened_by", user.id);
    return (data?.[0]?.id as string | undefined) ?? null;
  }, [supabase, user, isManager]);

  const load = useCallback(async () => {
    const sid = await resolveSession();
    setSessionId(sid);
    if (!sid) { setRows([]); return; }

    const fetchTable = async <T,>(table: string, select: string) => {
      const { data } = await supabase
        .from(table)
        .select(select)
        .eq("cash_session_id", sid)
        .order("created_at", { ascending: false });
      return (data ?? []) as T[];
    };

    type SaleRow   = { id: string; product_name: string; quantity: number; total: number; created_at: string; cancelled_at: string|null; cancelled_reason: string|null };
    type SubRow    = { id: string; member_name: string; plan_type: string; paid_amount: number; created_at: string; cancelled_at: string|null; cancelled_reason: string|null };
    type InBodyRow = { id: string; member_name: string; session_type: string; amount: number; created_at: string; cancelled_at: string|null; cancelled_reason: string|null };

    const [sales, subs, inbody] = await Promise.all([
      fetchTable<SaleRow>("sales",            "id, product_name, quantity, total, created_at, cancelled_at, cancelled_reason"),
      fetchTable<SubRow>("subscriptions",     "id, member_name, plan_type, paid_amount, created_at, cancelled_at, cancelled_reason"),
      fetchTable<InBodyRow>("inbody_sessions","id, member_name, session_type, amount, created_at, cancelled_at, cancelled_reason"),
    ]);

    const all: Row[] = [
      ...sales.map((s): Row => ({
        id: s.id, kind: "sale", table: "sales",
        label: `${s.quantity}× ${s.product_name}`,
        amount: Number(s.total),
        createdAt: s.created_at, cancelledAt: s.cancelled_at, cancelledReason: s.cancelled_reason,
      })),
      ...subs.map((s): Row => ({
        id: s.id, kind: "subscription", table: "subscriptions",
        label: `${s.member_name} (${s.plan_type})`,
        amount: Number(s.paid_amount),
        createdAt: s.created_at, cancelledAt: s.cancelled_at, cancelledReason: s.cancelled_reason,
      })),
      ...inbody.map((s): Row => ({
        id: s.id, kind: "inbody", table: "inbody_sessions",
        label: `${s.member_name} — ${s.session_type}`,
        amount: Number(s.amount),
        createdAt: s.created_at, cancelledAt: s.cancelled_at, cancelledReason: s.cancelled_reason,
      })),
    ];
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setRows(all);
  }, [supabase, resolveSession]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-txns-${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales",           filter: `cash_session_id=eq.${sessionId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions",   filter: `cash_session_id=eq.${sessionId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "inbody_sessions", filter: `cash_session_id=eq.${sessionId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, sessionId, load]);

  const totals = useMemo(() => {
    const active = rows.filter(r => !r.cancelledAt);
    const totalUSD = active.reduce((a, r) => a + r.amount, 0);
    return { totalUSD, count: active.length };
  }, [rows]);

  if (!user) return null;
  if (!sessionId) return null;

  async function doCancel() {
    if (!confirming || !user) return;
    setBusy(true);
    setErr(null);
    const r = await cancelTransaction({
      user: { id: user.id, displayName: user.displayName },
      table: confirming.row.table,
      id: confirming.row.id,
      reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setConfirming(null);
    setReason("");
    await load();
  }

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] clip-corner">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
        <div className="flex items-center gap-3">
          <ListChecks size={15} className="text-[#F5C100]" />
          <h2 className="font-display text-xl tracking-widest text-[#F0EDE6] uppercase">
            عمليات الجلسة الحالية
          </h2>
          <span className="font-mono text-[10px] text-[#555555]">{totals.count} عملية فعّالة</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-[#777777]">
          <span>دخل: <span className="text-[#5CC45C]">{fmtUSD(totals.totalUSD)}</span></span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center font-mono text-[10px] text-[#555555] tracking-widest uppercase">
          لا توجد عمليات في هذه الجلسة بعد
        </div>
      ) : (
        <div className="divide-y divide-[#252525]/60 max-h-[420px] overflow-y-auto">
          {rows.map((r) => {
            const meta = KIND_META[r.kind];
            const time = new Date(r.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
            const cancelled = !!r.cancelledAt;
            return (
              <div
                key={`${r.table}-${r.id}`}
                className={[
                  "flex items-center gap-3 px-5 py-2.5 transition-colors",
                  cancelled ? "bg-[#1A0A0A]/40 opacity-60" : "hover:bg-[#252525]/30",
                ].join(" ")}
              >
                <div className={`shrink-0 w-5 h-5 flex items-center justify-center ${meta.color}`}>{meta.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${cancelled ? "line-through text-[#777777]" : "text-[#F0EDE6]"} truncate`}>{r.label}</p>
                  <p className="font-mono text-[10px] text-[#555555]">
                    {meta.label} · {time}
                    {cancelled && r.cancelledReason ? ` · ملغاة: ${r.cancelledReason}` : cancelled ? " · ملغاة" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-left">
                  <p className={`font-mono text-xs tabular-nums ${cancelled ? "text-[#777777] line-through" : "text-[#F5C100]"}`}>
                    {fmtUSD(r.amount)}
                  </p>
                </div>
                {!cancelled && (
                  <button
                    onClick={() => { setConfirming({ row: r }); setReason(""); setErr(null); }}
                    className="shrink-0 p-1.5 text-[#777777] hover:text-[#FF3333] transition-colors cursor-pointer"
                    title="إلغاء العملية"
                  >
                    <Undo2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl" onClick={() => !busy && setConfirming(null)}>
          <div className="bg-[#1A1A1A] border border-[#252525] p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg tracking-wider text-[#F0EDE6]">إلغاء العملية</h3>
              <button onClick={() => !busy && setConfirming(null)} className="text-[#777777] hover:text-[#F0EDE6]"><X size={16} /></button>
            </div>
            <p className="font-body text-sm text-[#AAAAAA] mb-3">
              هل تريد إلغاء «{confirming.row.label}»؟ سيتم استبعادها من الإجماليات وتسجيلها في سجل المراجعة.
            </p>
            <label className="block font-mono text-[10px] text-[#777777] tracking-widest mb-1.5 uppercase">السبب (اختياري)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="خطأ في الإدخال / إرجاع المنتج / …"
              className="ox-input w-full bg-[#111111] border border-[#252525] text-[#F0EDE6] font-body text-sm px-3 py-2 mb-4"
            />
            {err && <div className="mb-3 p-2 bg-[#FF3333]/10 border border-[#FF3333]/30 text-[#FF3333] font-mono text-xs">{err}</div>}
            <div className="flex gap-3">
              <button
                onClick={() => !busy && setConfirming(null)}
                disabled={busy}
                className="flex-1 px-4 py-2.5 border border-[#252525] text-[#777777] hover:text-[#F0EDE6] font-mono text-xs cursor-pointer disabled:opacity-40"
              >
                تراجع
              </button>
              <button
                onClick={doCancel}
                disabled={busy}
                className="flex-1 px-4 py-2.5 bg-[#D42B2B] hover:bg-[#FF3333] text-white font-display text-sm tracking-widest cursor-pointer disabled:opacity-40"
              >
                {busy ? "جاري…" : "تأكيد الإلغاء"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
