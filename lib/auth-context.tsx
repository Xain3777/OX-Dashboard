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
  id: string;          // auth.users.id (uuid)
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
      if (error) {
        // eslint-disable-next-line no-console
        console.error("[auth] loadProfile error:", { code: error.code, message: error.message, details: error.details, hint: error.hint });
      }
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

  // bootstrap from existing session
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const sess = data.session;
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
      // 30s hard timeout so a hung network call surfaces an error instead
      // of leaving the login button stuck on the busy state forever.
      const timeoutPromise = new Promise<{ error: string }>((resolve) =>
        setTimeout(() => resolve({ error: "انتهت مهلة الاتصال بالخادم — تحقق من الاتصال بالإنترنت أو إعدادات Supabase." }), 30000)
      );
      const signInPromise = supabase.auth
        .signInWithPassword({ email, password })
        .then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("[auth] signIn error:", { status: error.status, code: (error as { code?: string }).code, message: error.message });
            return { error: error.message };
          }
          return {};
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.error("[auth] signIn fetch error:", e);
          return { error: String(e?.message ?? e) };
        });
      return Promise.race([signInPromise, timeoutPromise]);
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    // scope:'local' clears only this browser's session (no server round-trip).
    // Faster, and avoids hangs when the auth-token Web Lock is contended by
    // another tab. We then nuke any leftover sb-* cookies/localStorage so the
    // user can never get stuck "logged in but unable to use the app".
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
