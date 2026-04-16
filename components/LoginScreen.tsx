"use client";

import { useState } from "react";
import Image from "next/image";
import { Shield, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { STAFF } from "@/lib/mock-data";

export default function LoginScreen() {
  const { login } = useAuth();
  const [selectedId, setSelectedId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  // Simple PIN-based login (mock — all PINs are "1234" for demo)
  function handleLogin() {
    setError("");
    const staff = STAFF.find((s) => s.id === selectedId && s.active);
    if (!staff) {
      setError("اختر موظفاً.");
      return;
    }
    if (pin !== "1234") {
      setError("رمز الدخول غير صحيح.");
      return;
    }
    login({ id: staff.id, name: staff.name, role: staff.role });
  }

  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-sm bg-charcoal border border-gunmetal p-8 clip-corner space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/logo-full.png"
            alt="OX GYM"
            width={80}
            height={80}
            className="h-16 w-auto"
          />
          <h1 className="font-display text-2xl tracking-wider text-offwhite">
            تسجيل الدخول
          </h1>
          <p className="font-mono text-[10px] text-slate tracking-widest">
            نظام إدارة عمليات النادي
          </p>
        </div>

        {/* Staff select */}
        <div className="space-y-1">
          <label className="block font-mono text-[10px] text-secondary tracking-widest">
            الموظف
          </label>
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setError(""); }}
            className="ox-select"
          >
            <option value="">— اختر —</option>
            {STAFF.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.role === "owner" ? "المالك" : s.role === "manager" ? "مدير" : "موظف استقبال"}
              </option>
            ))}
          </select>
        </div>

        {/* PIN */}
        <div className="space-y-1">
          <label className="block font-mono text-[10px] text-secondary tracking-widest">
            رمز الدخول
          </label>
          <input
            type="password"
            maxLength={4}
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="****"
            className="ox-input text-center font-mono text-xl tracking-[0.5em]"
            dir="ltr"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-xs font-mono text-red-bright">
            <Shield size={12} />
            {error}
          </div>
        )}

        {/* Login button */}
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gold hover:bg-gold-bright active:bg-gold-deep text-void font-display text-lg tracking-widest uppercase transition-colors clip-corner-sm cursor-pointer"
        >
          <LogIn size={18} />
          دخول
        </button>

        <p className="text-center font-mono text-[9px] text-slate">
          رمز الدخول التجريبي: 1234
        </p>
      </div>
    </div>
  );
}
