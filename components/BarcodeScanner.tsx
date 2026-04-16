"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ScanBarcode, X, Search, CheckCircle } from "lucide-react";

// All catalog items merged for barcode lookup
import supplementsData from "@/data/catalog/supplements.json";
import wearablesData from "@/data/catalog/wearables.json";
import mealsData from "@/data/catalog/meals.json";

export interface CatalogItem {
  id: string;
  barcode: string;
  name: string;
  nameEn: string;
  brand: string;
  category: string;
  cost: number;
  price: number;
  unit: string;
  stock: number;
  lowStockThreshold: number;
}

const ALL_CATALOG: CatalogItem[] = [
  ...(supplementsData as CatalogItem[]),
  ...(wearablesData as CatalogItem[]),
  ...(mealsData as CatalogItem[]),
];

interface BarcodeScannerProps {
  onItemFound: (item: CatalogItem) => void;
}

export default function BarcodeScanner({ onItemFound }: BarcodeScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [found, setFound] = useState<CatalogItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Buffer for hardware barcode scanner input (rapid keystrokes)
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookupBarcode = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      const item = ALL_CATALOG.find((i) => i.barcode === trimmed);
      if (item) {
        setFound(item);
        setNotFound(false);
        onItemFound(item);
        // Auto-close after short delay
        setTimeout(() => {
          setIsOpen(false);
          setBarcode("");
          setFound(null);
        }, 1500);
      } else {
        setNotFound(true);
        setFound(null);
      }
    },
    [onItemFound]
  );

  // Listen for hardware barcode scanner (rapid key input when modal is open)
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Hardware scanners typically end with Enter
      if (e.key === "Enter" && bufferRef.current.length >= 4) {
        e.preventDefault();
        setBarcode(bufferRef.current);
        lookupBarcode(bufferRef.current);
        bufferRef.current = "";
        return;
      }

      // Only collect numeric and alphanumeric chars
      if (e.key.length === 1 && /[\w\d]/.test(e.key)) {
        bufferRef.current += e.key;

        // Reset buffer after 100ms of no input (human typing is slower)
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          bufferRef.current = "";
        }, 100);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, lookupBarcode]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  function handleManualSearch() {
    lookupBarcode(barcode);
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => {
          setIsOpen(true);
          setBarcode("");
          setFound(null);
          setNotFound(false);
        }}
        className="flex items-center gap-1.5 px-3 py-2 bg-[#252525] border border-[#555555]/40 hover:border-[#F5C100]/30 text-[#AAAAAA] hover:text-[#F5C100] font-mono text-[10px] uppercase tracking-widest rounded-sm transition-colors cursor-pointer"
        title="مسح باركود"
      >
        <ScanBarcode size={14} />
        باركود
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" dir="rtl">
          <div className="bg-[#1A1A1A] border border-[#252525] rounded-sm w-full max-w-md mx-4 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#252525]">
              <div className="flex items-center gap-2">
                <ScanBarcode size={16} className="text-[#F5C100]" />
                <h3 className="font-display text-[#F0EDE6] tracking-widest text-sm uppercase">
                  مسح باركود
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#555555] hover:text-[#AAAAAA] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <p className="font-body text-xs text-[#777777]">
                امسح الباركود باستخدام القارئ أو أدخل الرقم يدوياً
              </p>

              {/* Manual input */}
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={barcode}
                  onChange={(e) => {
                    setBarcode(e.target.value);
                    setNotFound(false);
                    setFound(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleManualSearch()}
                  placeholder="أدخل رقم الباركود..."
                  className="ox-input flex-1"
                  dir="ltr"
                />
                <button
                  onClick={handleManualSearch}
                  className="px-4 py-2 bg-[#F5C100] hover:bg-[#FFD740] text-[#0A0A0A] font-display tracking-widest text-xs uppercase rounded-sm transition-colors cursor-pointer"
                >
                  <Search size={14} />
                </button>
              </div>

              {/* Scanning indicator */}
              <div className="flex items-center justify-center py-6 border border-dashed border-[#252525] rounded-sm">
                <div className="text-center space-y-2">
                  <ScanBarcode size={40} className="text-[#555555] mx-auto animate-pulse" />
                  <p className="font-mono text-[10px] text-[#555555] uppercase tracking-widest">
                    بانتظار مسح الباركود...
                  </p>
                </div>
              </div>

              {/* Found result */}
              {found && (
                <div className="bg-[#5CC45C]/10 border border-[#5CC45C]/30 p-4 rounded-sm animate-fade-in">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={14} className="text-[#5CC45C]" />
                    <span className="font-mono text-[10px] text-[#5CC45C] uppercase tracking-widest">
                      تم العثور على المنتج
                    </span>
                  </div>
                  <p className="font-body text-sm text-[#F0EDE6]">{found.name}</p>
                  <p className="font-mono text-[10px] text-[#777777]">{found.nameEn}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="font-mono text-xs text-[#F5C100]">
                      {found.price}$
                    </span>
                    <span className="font-mono text-[10px] text-[#555555]">
                      {found.brand}
                    </span>
                    <span className="font-mono text-[10px] text-[#555555]">
                      مخزون: {found.stock}
                    </span>
                  </div>
                </div>
              )}

              {/* Not found */}
              {notFound && (
                <div className="bg-[#D42B2B]/10 border border-[#D42B2B]/30 p-4 rounded-sm animate-fade-in">
                  <p className="font-mono text-xs text-[#FF3333]">
                    لم يتم العثور على منتج بهذا الباركود: {barcode}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { ALL_CATALOG };
