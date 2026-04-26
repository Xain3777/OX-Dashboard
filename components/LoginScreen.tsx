"use client";

import { useState } from "react";
import Image from "next/image";
import { Shield, LogIn, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// Pre-seeded accounts (must match scripts/seed-users.mjs)
// All passwords = 123456 for now.
const ACCOUNTS = [
  { email: "adham@ox.local",      displayName: "كوتش أدهم",  roleLabel: "المالك",          role: "manager"   as const },
  { email: "haider@ox.local",     displayName: "حيدر",       roleLabel: "مدير",            role: "manager"   as const },
  { email: "reception1@ox.local", displayName: "استقبال 1",  roleLabel: "موظف استقبال",   role: "reception" as const },
  { email: "reception2@ox.local", displayName: "استقبال 2",  roleLabel: "موظف استقبال",   role: "reception" as const },
  { email: "reception3@ox.local", displayName: "استقبال 3",  roleLabel: "موظف استقبال",   role: "reception" as const },
  { email: "reception4@ox.local", displayName: "استقبال 4",  roleLabel: "موظف استقبال",   role: "reception" as const },
  { email: "reception5@ox.local", displayName: "استقبال 5",  roleLabel: "موظف استقبال",   role: "reception" as const },
  { email: "reception6@ox.local", displayName: "استقبال 6",  roleLabel: "موظف استقبال",   role: "reception" as const },
  { email: "reception7@ox.local", displayName: "استقبال 7",  roleLabel: "موظف استقبال",   role: "reception" as const },
];

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) return;
    setError("");
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) setError(error.includes("Invalid login") || error.includes("credentials") ? "الموظف أو كلمة المرور غير صحيحة." : error);
  }

  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-4 py-8" dir="rtl">
      <div className="w-full max-w-md space-y-6">
        {/* Logo + title */}
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

        <form
          onSubmit={handleLogin}
          className="bg-charcoal border border-gunmetal p-6 clip-corner space-y-5"
        >
          {/* Staff dropdown */}
          <div className="space-y-1">
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-left">
              الموظف
            </label>
            <div className="relative">
              <select
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className="ox-input w-full appearance-none pr-3 pl-10 text-center font-body text-base text-offwhite cursor-pointer"
                dir="rtl"
              >
                <option value="">— اختر —</option>
                {ACCOUNTS.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.displayName} — {a.roleLabel}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate pointer-events-none"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1">
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-left">
              رمز الدخول التجريبي: 123456
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••"
              className="ox-input text-center font-mono text-lg tracking-[0.4em]"
              dir="ltr"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs font-mono text-red-bright">
              <Shield size={12} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gold hover:bg-gold-bright active:bg-gold-deep text-void font-display text-lg tracking-widest uppercase transition-colors clip-corner-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <LogIn size={18} />
            {busy ? "..." : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
