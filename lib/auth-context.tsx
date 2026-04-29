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

    // Load initial session without a timeout — middleware keeps cookies fresh.
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && alive) {
        const profile = await loadProfile(session.user.id, session.user.email ?? "");
        if (alive) setUser(profile);
      }
      if (alive) setLoading(false);
    })();

    // Only react to explicit sign-in/sign-out events.
    // INITIAL_SESSION and TOKEN_REFRESHED are intentionally ignored to prevent
    // stale-cookie auto-login races.
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!alive) return;
      if (event === "SIGNED_OUT") {
        setUser(null);
        return;
      }
      if (event === "SIGNED_IN") {
        if (!session?.user) { setUser(null); return; }
        const profile = await loadProfile(session.user.id, session.user.email ?? "");
        if (alive) setUser(profile);
      }
      // TOKEN_REFRESHED / INITIAL_SESSION / USER_UPDATED: no state change.
    });

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
      await supabase.auth.signOut();
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
