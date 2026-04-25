"use client";

import { useState } from "react";
import { useCurrency } from "@/lib/currency-context";
import { X, DollarSign } from "lucide-react";

export default function ExchangeRateModal() {
  const { exchangeRate, setExchangeRate, showRateModal, closeRateModal } = useCurrency();
  const [inputValue, setInputValue] = useState(exchangeRate.toString());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!showRateModal) return null;

  const handleSave = async () => {
    const val = parseInt(inputValue.replace(/,/g, ""), 10);
    if (!val || val <= 0) { setErr("قيمة غير صالحة"); return; }
    setErr(null);
    setBusy(true);
    const r = await setExchangeRate(val);
    setBusy(false);
    if (r.error) setErr(r.error);
    else closeRateModal();
  };

  return (
    <div
      className="fixed inset-0 bg-void/80 backdrop-blur-sm flex items-center justify-center"
      style={{ zIndex: 200 }}
      onClick={closeRateModal}
    >
      <div
        className="bg-charcoal border border-gunmetal p-6 w-full max-w-md animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ borderTop: "3px solid #F5C100" }}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl text-offwhite">سعر الصرف</h3>
          <button onClick={closeRateModal} className="text-slate hover:text-offwhite transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-iron border border-gunmetal">
            <DollarSign size={24} className="text-gold" />
            <div>
              <p className="font-mono text-xs text-secondary">١ دولار أمريكي =</p>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="ox-input text-2xl font-mono text-center text-gold w-full"
                  placeholder="13200"
                  dir="ltr"
                  autoFocus
                />
                <span className="font-mono text-lg text-secondary whitespace-nowrap">ل.س</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate text-center">
            اضغط على أي سعر في اللوحة لتحويله بين الدولار والليرة السورية
          </p>

          {err && (
            <div className="p-2 bg-[#FF3333]/10 border border-[#FF3333]/30 text-[#FF3333] font-mono text-xs text-center">
              {err}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={closeRateModal}
              disabled={busy}
              className="flex-1 py-3 border border-gunmetal text-secondary hover:text-offwhite transition-colors font-display tracking-wider cursor-pointer disabled:opacity-40"
            >
              إلغاء
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="flex-1 py-3 bg-gold text-void font-display tracking-wider hover:bg-gold-bright transition-colors cursor-pointer disabled:opacity-40"
            >
              {busy ? "جاري الحفظ…" : "حفظ السعر"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
