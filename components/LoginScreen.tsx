"use client";

import { useState } from "react";
import Image from "next/image";
import { Shield, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ACCOUNTS, findStaffById } from "@/lib/staff-accounts";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    if (!accountId || !password) return;
    const account = findStaffById(accountId);
    if (!account) {
      setError("الحساب غير معروف");
      return;
    }

    setError("");
    setBusy(true);
    const { error } = await signIn(account.email, password);
    if (error) {
      setBusy(false);
      setError(
        error.includes("Invalid login") || error.includes("credentials")
          ? "كلمة المرور غير صحيحة."
          : error
      );
      return;
    }

    // Hard nav so the proxy re-runs with the freshly-set cookie. Don't fall
    // through to React state — that races the cookie write and the next
    // page load may still see the anonymous session.
    window.location.href = "/";
  }

  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-4 py-8" dir="rtl">
      <div className="w-full max-w-md space-y-6">
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
          <div className="space-y-1">
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-right">
              الموظف
            </label>
            <select
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setError(""); }}
              className="ox-input w-full font-body text-base text-offwhite"
              dir="rtl"
              autoFocus
            >
              <option value="">— اختر الموظف —</option>
              {STAFF_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-right">
              كلمة المرور
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
            disabled={busy || !accountId || !password}
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
