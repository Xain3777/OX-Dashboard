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

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => ({}),
  signOut: async () => {},
  isManager: false,
});

// If the Supabase session check takes longer than this, treat tokens as stale.
const SESSION_TIMEOUT_MS = 4000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = supabaseBrowser();

  const loadProfile = useCallback(
    async (authUserId: string, email: string): Promise<AuthUser | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, role")
        .eq("id", authUserId)
        .maybeSingle();
      if (error || !data) {
        console.error("loadProfile failed:", error);
        return null;
      }
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
    let alive = true;

    (async () => {
      let sess: { user?: { id: string; email?: string } } | null = null;
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("session-timeout")), SESSION_TIMEOUT_MS)
        );
        const { data, error } = await Promise.race([
          supabase.auth.getSession(),
          timeout,
        ]);
        if (error) throw error;
        sess = data.session;
      } catch {
        sess = null;
      }
      if (sess?.user && alive) {
        const profile = await loadProfile(sess.user.id, sess.user.email ?? "");
        if (alive) setUser(profile);
      }
      if (alive) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_evt: string, session: { user?: { id: string; email?: string } } | null) => {
        if (!alive) return;
        if (!session?.user) { setUser(null); return; }
        const profile = await loadProfile(session.user.id, session.user.email ?? "");
        setUser(profile);
      }
    );

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error?: string }> => {
      const timeoutPromise = new Promise<{ error: string }>((resolve) =>
        setTimeout(
          () => resolve({ error: "انتهت مهلة الاتصال بالخادم — تحقق من الاتصال بالإنترنت." }),
          30000
        )
      );
      const signInPromise = supabase.auth
        .signInWithPassword({ email, password })
        .then(({ error }) => (error ? { error: error.message } : {}))
        .catch((e: unknown) => ({ error: String((e as Error)?.message ?? e) }));
      return Promise.race([signInPromise, timeoutPromise]);
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // ignore — clear state below regardless
    }
    setUser(null);
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signOut, isManager: user?.role === "manager" }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
