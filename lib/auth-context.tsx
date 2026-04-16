"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { StaffRole } from "./types";

interface AuthUser {
  id: string;
  name: string;
  role: StaffRole;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
  isManager: boolean; // owner or manager
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => {},
  logout: () => {},
  isManager: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback((u: AuthUser) => setUser(u), []);
  const logout = useCallback(() => setUser(null), []);

  const isManager = user?.role === "owner" || user?.role === "manager";

  return (
    <AuthContext.Provider value={{ user, login, logout, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
