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
import { findStaffByEmail } from "./staff-accounts";

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
      // STAFF_ACCOUNTS is canonical for displayName + role. Editing
      // lib/staff-accounts.ts updates the UI without touching the DB.
      const staff = findStaffByEmail(email);
      if (staff) {
        return {
          id: authUserId,
          email,
          displayName: staff.displayName,
          role: staff.role,
        };
      }

      // Fallback: someone authenticated against auth.users but isn't in the
      // hardcoded roster. Read profiles so we don't hard-block them; treat
      // any profile that's not 'manager' as 'reception'.
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, role")
        .eq("id", authUserId)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        email,
        displayName: (data.display_name as string) ?? email,
        role: ((data.role as string) === "manager" ? "manager" : "reception"),
      };
    },
    [supabase]
  );

  useEffect(() => {
    let alive = true;

    // getUser() validates against the auth server (the proxy keeps the cookie
    // fresh, so this hits the local cache after refresh). Don't use
    // getSession() here — it returns the cached session even if the JWT is
    // already revoked, which is how stale-cookie auto-login slips in.
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser && alive) {
        const profile = await loadProfile(authUser.id, authUser.email ?? "");
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
