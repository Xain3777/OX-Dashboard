// Hardcoded staff roster — single source of truth for:
//   1. The login dropdown (components/LoginScreen.tsx)
//   2. Display names anywhere a user is rendered (components/ManagerDashboard.tsx)
//   3. The seed script (scripts/seed-users.mjs)
//
// The roster lives in data/staff-accounts.json so both this TypeScript file
// and the .mjs seeder can consume the same list. To rename someone or add an
// account, edit the JSON; the UI re-reads on every render and the seeder is
// idempotent.

import accounts from "@/data/staff-accounts.json";

export type StaffRole = "manager" | "reception";

export interface StaffAccount {
  id: string;          // stable account key (used by the dropdown's <option value>)
  email: string;       // auth.users email (never shown to the user)
  displayName: string; // shown wherever a name is needed
  role: StaffRole;
}

export const STAFF_ACCOUNTS: StaffAccount[] = accounts as StaffAccount[];

export function findStaffById(id: string): StaffAccount | undefined {
  return STAFF_ACCOUNTS.find((s) => s.id === id);
}

export function findStaffByEmail(email: string | null | undefined): StaffAccount | undefined {
  if (!email) return undefined;
  const lower = email.toLowerCase();
  return STAFF_ACCOUNTS.find((s) => s.email.toLowerCase() === lower);
}
