"use client";

import { useState } from "react";
import Image from "next/image";
import { Shield, LogIn, ArrowRight, UserCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// Pre-seeded accounts (must match scripts/seed-users.mjs)
const ACCOUNTS = [
  { email: "adham@ox.local",      displayName: "أدهم",       roleLabel: "المالك", role: "manager"   as const, accent: "gold"   },
  { email: "haider@ox.local",     displayName: "حيدر",       roleLabel: "مدير",   role: "manager"   as const, accent: "gold"   },
  { email: "reception1@ox.local", displayName: "استقبال 1",  roleLabel: "استقبال", role: "reception" as const, accent: "silver" },
  { email: "reception2@ox.local", displayName: "استقبال 2",  roleLabel: "استقبال", role: "reception" as const, accent: "silver" },
  { email: "reception3@ox.local", displayName: "استقبال 3",  roleLabel: "استقبال", role: "reception" as const, accent: "silver" },
  { email: "reception4@ox.local", displayName: "استقبال 4",  roleLabel: "استقبال", role: "reception" as const, accent: "silver" },
  { email: "reception5@ox.local", displayName: "استقبال 5",  roleLabel: "استقبال", role: "reception" as const, accent: "silver" },
];

type Account = (typeof ACCOUNTS)[number];

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [picked, setPicked] = useState<Account | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    if (!picked) return;
    setError("");
    setBusy(true);
    const { error } = await signIn(picked.email, password);
    setBusy(false);
    if (error) setError("كلمة المرور غير صحيحة.");
  }

  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-4 py-8" dir="rtl">
      <div className="w-full max-w-2xl space-y-6">
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

        {!picked ? (
          // Step 1: pick a name
          <div className="bg-charcoal border border-gunmetal p-6 clip-corner space-y-4">
            <p className="font-mono text-[10px] text-secondary tracking-widest text-center">
              اختر اسمك للمتابعة
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {ACCOUNTS.map((a) => {
                const isManager = a.role === "manager";
                return (
                  <button
                    key={a.email}
                    onClick={() => { setPicked(a); setError(""); setPassword(""); }}
                    className={[
                      "flex flex-col items-center justify-center gap-2 p-4 border transition-colors clip-corner-sm cursor-pointer",
                      isManager
                        ? "border-[#F5C100]/40 bg-[#F5C100]/5 hover:bg-[#F5C100]/10"
                        : "border-gunmetal bg-iron hover:border-[#F5C100]/30 hover:bg-[#F5C100]/5",
                    ].join(" ")}
                  >
                    <UserCircle2
                      size={32}
                      className={isManager ? "text-[#F5C100]" : "text-[#AAAAAA]"}
                    />
                    <span className={[
                      "font-display text-base tracking-wider",
                      isManager ? "text-[#F5C100]" : "text-offwhite",
                    ].join(" ")}>
                      {a.displayName}
                    </span>
                    <span className="font-mono text-[9px] text-slate tracking-widest uppercase">
                      {a.roleLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          // Step 2: password
          <div className="bg-charcoal border border-gunmetal p-6 clip-corner space-y-5 max-w-sm mx-auto">
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setPicked(null); setPassword(""); setError(""); }}
                className="flex items-center gap-1 text-[10px] font-mono text-slate hover:text-offwhite transition-colors cursor-pointer"
              >
                <ArrowRight size={12} />
                تغيير الاسم
              </button>
            </div>

            <div className="flex flex-col items-center gap-2">
              <UserCircle2
                size={48}
                className={picked.role === "manager" ? "text-[#F5C100]" : "text-[#AAAAAA]"}
              />
              <span className="font-display text-lg tracking-wider text-offwhite">
                {picked.displayName}
              </span>
              <span className="font-mono text-[9px] text-slate tracking-widest uppercase">
                {picked.roleLabel}
              </span>
            </div>

            <div className="space-y-1">
              <label className="block font-mono text-[10px] text-secondary tracking-widest">
                كلمة المرور
              </label>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && !busy && handleLogin()}
                placeholder="••••••"
                className="ox-input text-center font-mono text-lg tracking-[0.4em]"
                dir="ltr"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs font-mono text-red-bright">
                <Shield size={12} />
                {error}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={busy || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gold hover:bg-gold-bright active:bg-gold-deep text-void font-display text-lg tracking-widest uppercase transition-colors clip-corner-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <LogIn size={18} />
              {busy ? "..." : "دخول"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
