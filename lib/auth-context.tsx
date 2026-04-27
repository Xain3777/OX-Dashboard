"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { supabaseBrowser } from "./supabase/client";

export type AppRole = "manager" | "reception";

export interface AuthUser {
  id: string;          // auth.users.id (uuid) — or email in local mode
  email: string;       // synthetic e.g. reception1@ox.local
  displayName: string; // Arabic name shown in UI
  role: AppRole;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  isManager: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({}),
  signOut: async () => {},
  isManager: false,
});

// ── Local-mode credentials (no Supabase needed) ───────────────────────────────
// Toggle via NEXT_PUBLIC_LOCAL_AUTH=true in .env.local.
// To go live: remove that env var and ensure Supabase users + profiles exist.

const IS_LOCAL = process.env.NEXT_PUBLIC_LOCAL_AUTH === "true";
const LOCAL_KEY = "ox-auth-local-user";
const LOCAL_PASSWORD = "123456";

const LOCAL_ACCOUNTS: Array<{ email: string; displayName: string; role: AppRole }> = [
  { email: "adham@ox.local",      displayName: "كوتش أدهم",   role: "manager"   },
  { email: "haider@ox.local",     displayName: "حيدر",        role: "manager"   },
  { email: "reception1@ox.local", displayName: "نوار",        role: "reception" },
  { email: "reception2@ox.local", displayName: "ساميلا راعي", role: "reception" },
  { email: "reception3@ox.local", displayName: "آيه ابراهيم", role: "reception" },
  { email: "reception4@ox.local", displayName: "سالي رجب",    role: "reception" },
  { email: "reception5@ox.local", displayName: "رند اسماعيل", role: "reception" },
  { email: "reception6@ox.local", displayName: "ناديا ابراهيم", role: "reception" },
  { email: "reception7@ox.local", displayName: "استقبال ٧",   role: "reception" },
];

// ─────────────────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = supabaseBrowser();

  const loadProfile = useCallback(
    async (authUserId: string, email: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, role")
        .eq("id", authUserId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id as string,
        email,
        displayName: data.display_name as string,
        role: data.role as AppRole,
      };
    },
    [supabase]
  );

  useEffect(() => {
    // ── local mode: restore session from localStorage only ──
    if (IS_LOCAL) {
      try {
        const stored = localStorage.getItem(LOCAL_KEY);
        if (stored) setUser(JSON.parse(stored) as AuthUser);
      } catch {}
      setLoading(false);
      return;
    }

    // ── Supabase mode: bootstrap from existing session ──
    // Wipe stale/partial Supabase tokens before attempting session restore.
    // A lagged or timed-out login can leave corrupted sb-* keys that cause
    // the auth state to hang indefinitely on subsequent page loads.
    let alive = true;
    (async () => {
      let sess: { user?: { id: string; email?: string } } | null = null;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        sess = data.session;
      } catch {
        // Stale or invalid session — purge all Supabase localStorage keys so
        // the next load starts clean instead of hanging again.
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("sb-") || k.includes("supabase"))
            .forEach((k) => localStorage.removeItem(k));
        } catch {}
        sess = null;
      }
      if (sess?.user && alive) {
        const profile = await loadProfile(sess.user.id, sess.user.email ?? "");
        if (alive) setUser(profile);
      }
      if (alive) setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt: string, session: { user?: { id: string; email?: string } } | null) => {
      if (!alive) return;
      if (!session?.user) {
        setUser(null);
        return;
      }
      const profile = await loadProfile(session.user.id, session.user.email ?? "");
      setUser(profile);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      // ── local mode ──
      if (IS_LOCAL) {
        if (password !== LOCAL_PASSWORD) return { error: "كلمة المرور غير صحيحة." };
        const account = LOCAL_ACCOUNTS.find((a) => a.email === email);
        if (!account) return { error: "الحساب غير موجود." };
        const profile: AuthUser = {
          id: email,
          email,
          displayName: account.displayName,
          role: account.role,
        };
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(profile)); } catch {}
        setUser(profile);
        return {};
      }

      // ── Supabase mode ──
      const timeoutPromise = new Promise<{ error: string }>((resolve) =>
        setTimeout(() => resolve({ error: "انتهت مهلة الاتصال بالخادم — تحقق من الاتصال بالإنترنت أو إعدادات Supabase." }), 30000)
      );
      const signInPromise = supabase.auth
        .signInWithPassword({ email, password })
        .then(({ error }) => (error ? { error: error.message } : {}))
        .catch((e) => ({ error: String(e?.message ?? e) }));
      return Promise.race([signInPromise, timeoutPromise]);
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    // ── local mode ──
    if (IS_LOCAL) {
      try { localStorage.removeItem(LOCAL_KEY); } catch {}
      setUser(null);
      return;
    }

    // ── Supabase mode ──
    // scope:'local' clears only this browser's session (no server round-trip).
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore — we still purge state below
    }
    if (typeof document !== "undefined") {
      document.cookie.split(";").forEach((c) => {
        const k = c.split("=")[0].trim();
        if (k.startsWith("sb-")) {
          document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/`;
        }
      });
    }
    if (typeof localStorage !== "undefined") {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("sb-") || k === "ox-auth" || k.includes("supabase"))
        .forEach((k) => localStorage.removeItem(k));
    }
    setUser(null);
  }, [supabase]);

  const isManager = user?.role === "manager";

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
