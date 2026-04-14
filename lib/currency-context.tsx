"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface CurrencyContextType {
  exchangeRate: number; // 1 USD = X SYP
  setExchangeRate: (rate: number) => void;
  showRateModal: boolean;
  openRateModal: () => void;
  closeRateModal: () => void;
}

const CurrencyContext = createContext<CurrencyContextType>({
  exchangeRate: 13200,
  setExchangeRate: () => {},
  showRateModal: false,
  openRateModal: () => {},
  closeRateModal: () => {},
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [exchangeRate, setExchangeRate] = useState(13200);
  const [showRateModal, setShowRateModal] = useState(false);

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
