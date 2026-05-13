"use client";

import { useEffect, useState } from "react";
import { History, Plus, Pencil, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatTime, formatDate } from "@/lib/utils/time";

// Pulls catalog inventory edits from the existing activity_feed table. Every
// catalog_item insert / update / delete already writes a row via
// persistCatalogItem* in lib/supabase/intake.ts — this panel just surfaces
// them. No new DB column needed.

type Row = {
  id: string;
  action: string;
  description: string;
  created_at: string;
  created_by_name: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  catalog_item_insert: "إضافة صنف",
  catalog_item_update: "تعديل صنف",
  catalog_item_delete: "حذف صنف",
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  catalog_item_insert: <Plus    size={11} className="text-[#5CC45C]" />,
  catalog_item_update: <Pencil  size={11} className="text-[#F5C100]" />,
  catalog_item_delete: <Trash2  size={11} className="text-[#FF3333]" />,
};

const ACTIONS = Object.keys(ACTION_LABEL);

export default function InventoryActivityPanel() {
  const [rows,    setRows]    = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const supabase = supabaseBrowser();

    async function refetch() {
      const { data, error } = await supabase
        .from("activity_feed")
        .select("id, action, description, created_at, created_by_name")
        .in("action", ACTIONS)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) { setError(error.message); setLoading(false); return; }
      setRows((data ?? []) as Row[]);
      setLoading(false);
    }

    void refetch();

    const channel = supabase
      .channel("inventory-activity")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_feed" },
        (payload) => {
          const r = payload.new as Row;
          if (!ACTIONS.includes(r.action)) return;
          setRows((prev) => [r, ...prev].slice(0, 50));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#252525] bg-[#111111]">
        <History size={13} className="text-[#F5C100]" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#555555]">
          سجل تعديلات المخزون — من غيّر، ومتى، وماذا
        </p>
        {loading && <span className="font-mono text-[10px] text-[#555555]">جاري التحميل…</span>}
      </div>
      {error ? (
        <div className="px-5 py-4 font-mono text-[11px] text-[#FF3333]">{error}</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-8 text-center font-mono text-[10px] text-[#555555] uppercase tracking-widest">
          لا توجد تعديلات مسجلة بعد
        </div>
      ) : (
        <div className="divide-y divide-[#252525]/60 max-h-72 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-2 hover:bg-[#252525]/30 transition-colors">
              <div className="shrink-0">{ACTION_ICON[r.action] ?? null}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#F0EDE6] truncate">{r.description}</p>
                <p className="font-mono text-[10px] text-[#555555]">
                  {r.created_by_name ?? "—"}
                </p>
              </div>
              <div className="shrink-0 text-left">
                <p className="font-mono text-[10px] text-[#AAAAAA]">{formatDate(r.created_at)}</p>
                <p className="font-mono text-[9px] text-[#555555]">{formatTime(r.created_at)}</p>
              </div>
              <span className="shrink-0 inline-block px-1.5 py-0.5 bg-[#252525] border border-[#555555]/30 rounded text-[9px] font-mono text-[#777777] uppercase tracking-wide">
                {ACTION_LABEL[r.action] ?? r.action}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
