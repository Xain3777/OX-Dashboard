// Seed dashboard staff (managers + reception) into auth.users + public.profiles.
// The roster is sourced from data/staff-accounts.json — the SAME file that
// drives the login dropdown — so this script and the UI never drift.
//
// Run after applying supabase/migrations/0001_init.sql (and the rest):
//   node scripts/seed-users.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── load .env.local manually (no dotenv dep) ────────────────
const envPath = resolve(process.cwd(), ".env.local");
const envText = readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "123456";

// ── load shared roster ──────────────────────────────────────
const __dirname  = dirname(fileURLToPath(import.meta.url));
const rosterPath = resolve(__dirname, "..", "data", "staff-accounts.json");
const STAFF      = JSON.parse(readFileSync(rosterPath, "utf8"));

async function findUserByEmail(email) {
  // listUsers paginates; one page of 200 covers the seed list comfortably.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === email);
}

async function ensureAuthUser(email, displayName, role) {
  const existing = await findUserByEmail(email);
  if (existing) {
    // Reset the password every run — the seed is the canonical authority.
    // Without this, an account that drifted out of sync (manual change,
    // sister-app reseed, etc.) stays broken even after the dashboard seed.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: displayName, role },
    });
    if (error) throw new Error(`update ${email}: ${error.message}`);
    console.log(`• reset    ${email}`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName, role },
  });
  if (error) throw new Error(`create ${email}: ${error.message}`);
  console.log(`+ created  ${email}`);
  return data.user.id;
}

async function upsertProfile(id, displayName, role) {
  const { error } = await admin
    .from("profiles")
    .upsert(
      { id, display_name: displayName, role, active: true },
      { onConflict: "id" }
    );
  if (error) throw new Error(`profile ${displayName}: ${error.message}`);
}

async function main() {
  console.log(`Seeding ${STAFF.length} staff accounts (default password: ${DEFAULT_PASSWORD})\n`);
  for (const s of STAFF) {
    const id = await ensureAuthUser(s.email, s.displayName, s.role);
    await upsertProfile(id, s.displayName, s.role);
    console.log(`  → profile ${s.role.padEnd(10)} ${s.displayName}`);
  }
  console.log("\nDone. Tell each user to change their password after first login.");
}

main().catch((e) => {
  console.error("\n✗", e.message);
  process.exit(1);
});
