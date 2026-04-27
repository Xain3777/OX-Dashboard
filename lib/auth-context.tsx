"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { supabaseBrowser, isSupabaseConfigured } from "./supabase/client";

export type AppRole = "manager" | "reception";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  isManager: boolean;
}

// Mirror of LoginScreen.tsx ACCOUNTS — used as fallback when Supabase is
// unreachable so staff can always log in with password 123456.
const LOCAL_ACCOUNTS: AuthUser[] = [
  { id: "adham",      email: "adham@ox.local",      displayName: "كوتش أدهم", role: "manager"   },
  { id: "haider",     email: "haider@ox.local",      displayName: "حيدر",      role: "manager"   },
  { id: "reception1", email: "reception1@ox.local",  displayName: "استقبال 1", role: "reception" },
  { id: "reception2", email: "reception2@ox.local",  displayName: "استقبال 2", role: "reception" },
  { id: "reception3", email: "reception3@ox.local",  displayName: "استقبال 3", role: "reception" },
  { id: "reception4", email: "reception4@ox.local",  displayName: "استقبال 4", role: "reception" },
  { id: "reception5", email: "reception5@ox.local",  displayName: "استقبال 5", role: "reception" },
  { id: "reception6", email: "reception6@ox.local",  displayName: "استقبال 6", role: "reception" },
  { id: "reception7", email: "reception7@ox.local",  displayName: "استقبال 7", role: "reception" },
];
const LOCAL_PASSWORD = "123456";
const LOCAL_SESSION_KEY = "ox-local-user";

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({}),
  signOut: async () => {},
  isManager: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = supabaseBrowser();

  // Always returns an AuthUser — never null — so a failed profile fetch
  // never silently strands the user on the login screen.
  const loadProfile = useCallback(
    async (authUserId: string, email: string): Promise<AuthUser> => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, display_name, role")
          .eq("id", authUserId)
          .maybeSingle();
        if (!error && data) {
          return {
            id: data.id as string,
            email,
            displayName: data.display_name as string,
            role: data.role as AppRole,
          };
        }
        if (error) {
          // eslint-disable-next-line no-console
          console.error("[auth] loadProfile error:", { code: error.code, message: error.message });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[auth] loadProfile network error:", e);
      }
      // Profiles table unavailable — fall back to local account list by email
      const local = LOCAL_ACCOUNTS.find((a) => a.email === email);
      if (local) return local;
      // Last resort: construct minimal user from auth data
      return { id: authUserId, email, displayName: email.split("@")[0], role: "reception" };
    },
    [supabase]
  );

  // Bootstrap — restore session on mount
  useEffect(() => {
    let alive = true;

    // Local mode: no Supabase configured — restore from sessionStorage
    if (!isSupabaseConfigured()) {
      try {
        const saved = sessionStorage.getItem(LOCAL_SESSION_KEY);
        if (saved) setUser(JSON.parse(saved) as AuthUser);
      } catch {}
      setLoading(false);
      return;
    }

    // Supabase mode
    let sub: { subscription: { unsubscribe: () => void } } | null = null;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const sess = data.session;
        if (sess?.user && alive) {
          const profile = await loadProfile(sess.user.id, sess.user.email ?? "");
          if (alive) setUser(profile);
        }
      } catch {
        // network error during bootstrap — stay logged out, no crash
      }
      if (alive) setLoading(false);
    })();

    const { data } = supabase.auth.onAuthStateChange(
      async (_evt: string, session: { user?: { id: string; email?: string } } | null) => {
        if (!alive) return;
        if (!session?.user) { setUser(null); return; }
        const profile = await loadProfile(session.user.id, session.user.email ?? "");
        setUser(profile);
      }
    );
    sub = data;

    return () => {
      alive = false;
      sub?.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      // ── Local mode: no Supabase env vars ────────────────────────────────────
      if (!isSupabaseConfigured()) {
        const account = LOCAL_ACCOUNTS.find((a) => a.email === email);
        if (!account || password !== LOCAL_PASSWORD) {
          return { error: "الموظف أو كلمة المرور غير صحيحة." };
        }
        setUser(account);
        try { sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(account)); } catch {}
        return {};
      }

      // ── Supabase mode ────────────────────────────────────────────────────────
      const timeout = new Promise<{ error: string }>((resolve) =>
        setTimeout(
          () => resolve({ error: "انتهت مهلة الاتصال — تحقق من الإنترنت أو إعدادات Supabase." }),
          15000
        )
      );

      const attempt = supabase.auth
        .signInWithPassword({ email, password })
        .then(({ error }) => {
          if (!error) return {} as { error?: string };
          // eslint-disable-next-line no-console
          console.error("[auth] signIn error:", error.message);
          const msg = error.message;
          if (msg.includes("Invalid login") || msg.includes("credentials") || msg.includes("invalid_credentials")) {
            return { error: "الموظف أو كلمة المرور غير صحيحة." };
          }
          if (msg.includes("Email not confirmed")) {
            return { error: "لم يتم تأكيد البريد الإلكتروني — تحقق من إعدادات Supabase." };
          }
          if (msg.includes("User not found")) {
            return { error: "الموظف غير موجود في قاعدة البيانات." };
          }
          return { error: msg };
        })
        .catch((e: unknown) => {
          const msg = (e as Error)?.message ?? String(e);
          // eslint-disable-next-line no-console
          console.error("[auth] signIn network error:", msg);
          // Network failure — fall back to local auth so the app stays usable
          const account = LOCAL_ACCOUNTS.find((a) => a.email === email);
          if (account && password === LOCAL_PASSWORD) {
            setUser(account);
            try { sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(account)); } catch {}
            return {} as { error?: string };
          }
          return { error: "تعذّر الاتصال بالخادم — تحقق من الإنترنت." };
        });

      return Promise.race([attempt, timeout]);
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    // Clear local session
    try { sessionStorage.removeItem(LOCAL_SESSION_KEY); } catch {}

    if (isSupabaseConfigured()) {
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
