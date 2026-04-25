"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "./auth-context";
import { supabaseBrowser } from "./supabase/client";
import { fetchExchangeRate, persistExchangeRate } from "./supabase/intake";

interface CurrencyContextType {
  exchangeRate: number; // 1 USD = X SYP — live rate, hydrated from app_settings
  setExchangeRate: (rate: number) => Promise<{ error?: string }>;
  showRateModal: boolean;
  openRateModal: () => void;
  closeRateModal: () => void;
}

const FALLBACK_RATE = 13200;

const CurrencyContext = createContext<CurrencyContextType>({
  exchangeRate: FALLBACK_RATE,
  setExchangeRate: async () => ({}),
  showRateModal: false,
  openRateModal: () => {},
  closeRateModal: () => {},
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [exchangeRate, setRate] = useState(FALLBACK_RATE);
  const [showRateModal, setShowRateModal] = useState(false);
  const channelRef = useRef<ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null>(null);

  // hydrate on mount + when auth changes
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await fetchExchangeRate();
      if (alive) setRate(r);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  // realtime: pick up rate changes made by other clients
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel("app-settings-exchange-rate")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings", filter: "key=eq.exchange_rate_usd_syp" },
        (payload) => {
          const row = (payload.new as Record<string, unknown> | null) ?? null;
          const v = row?.value;
          const n = typeof v === "number" ? v : Number(v);
          if (Number.isFinite(n) && n > 0) setRate(n);
        }
      )
      .subscribe();
    channelRef.current = channel;
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const setExchangeRate = useCallback(
    async (rate: number) => {
      if (!Number.isFinite(rate) || rate <= 0) return { error: "سعر صرف غير صالح" };
      if (!user) return { error: "يجب تسجيل الدخول" };
      // optimistic update
      setRate(rate);
      const r = await persistExchangeRate({ id: user.id, displayName: user.displayName }, rate);
      if (r.error) {
        // rollback on failure
        const fresh = await fetchExchangeRate();
        setRate(fresh);
      }
      return r;
    },
    [user]
  );

  const openRateModal = useCallback(() => setShowRateModal(true), []);
  const closeRateModal = useCallback(() => setShowRateModal(false), []);

  return (
    <CurrencyContext.Provider
      value={{ exchangeRate, setExchangeRate, showRateModal, openRateModal, closeRateModal }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
