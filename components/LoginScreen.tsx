"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Shield, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabaseBrowser } from "@/lib/supabase/client";

const ACCOUNTS = [
  { displayName: "كوتش أدهم",    email: "adham@ox.local"       },
  { displayName: "حيدر",          email: "haider@ox.local"      },
  { displayName: "نوار",          email: "reception1@ox.local"  },
  { displayName: "موظف 2",        email: "reception2@ox.local"  },
  { displayName: "موظف 3",        email: "reception3@ox.local"  },
  { displayName: "موظف 4",        email: "reception4@ox.local"  },
  { displayName: "موظف 5",        email: "reception5@ox.local"  },
  { displayName: "موظف 6",        email: "reception6@ox.local"  },
  { displayName: "موظف 7",        email: "reception7@ox.local"  },
];

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Clear any stale session when the login screen appears.
  useEffect(() => {
    void supabaseBrowser().auth.signOut();
  }, []);

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email || !password) return;
    setError("");
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error)
      setError(
        error.includes("Invalid login") || error.includes("credentials")
          ? "البريد الإلكتروني أو كلمة المرور غير صحيحة."
          : error
      );
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
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-left">
              الموظف
            </label>
            <select
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              className="ox-input w-full font-body text-base text-offwhite"
              dir="rtl"
            >
              <option value="">— اختر الموظف —</option>
              {ACCOUNTS.map((a) => (
                <option key={a.email} value={a.email}>{a.displayName}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-left">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="example@ox.local"
              className="ox-input w-full font-body text-base text-offwhite"
              dir="ltr"
              autoComplete="username"
            />
          </div>

          <div className="space-y-1">
            <label className="block font-mono text-[10px] text-secondary tracking-widest text-left">
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
