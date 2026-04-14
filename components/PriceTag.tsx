"use client";

import { useState } from "react";
import { useCurrency } from "@/lib/currency-context";

interface PriceTagProps {
  amount: number; // always in USD
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export default function PriceTag({ amount, className = "", size = "md" }: PriceTagProps) {
  const { exchangeRate } = useCurrency();
  const [showSYP, setShowSYP] = useState(false);

  const sypAmount = Math.round(amount * exchangeRate);

  const sizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-lg",
    xl: "text-2xl",
  };

  const formatUSD = (n: number) => {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  };

  const formatSYP = (n: number) => {
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setShowSYP(!showSYP);
      }}
      className={`font-mono tabular-nums cursor-pointer transition-colors duration-150 hover:text-gold-bright inline-flex items-center gap-1 ${sizeClasses[size]} ${className}`}
      title={showSYP ? `${formatUSD(amount)}$` : `${formatSYP(sypAmount)} ل.س`}
    >
      {showSYP ? (
        <span className="text-gold-bright">
          {formatSYP(sypAmount)} <span className="text-[0.7em] opacity-70">ل.س</span>
        </span>
      ) : (
        <span>
          {formatUSD(amount)}<span className="text-[0.7em] opacity-70">$</span>
        </span>
      )}
    </button>
  );
}
