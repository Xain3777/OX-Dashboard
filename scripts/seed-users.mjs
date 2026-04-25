// Seed 1 manager + 5 reception users.
// Run once after applying supabase/migrations/0001_init.sql:
//   node scripts/seed-users.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// ── default password (CHANGE BEFORE PROD!) ──────────────────
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "123456";

// ── users to create ─────────────────────────────────────────
const USERS = [
  { email: "adham@ox.local",      display_name: "أدهم",       role: "manager"   },
  { email: "haider@ox.local",     display_name: "حيدر",       role: "manager"   },
  { email: "reception1@ox.local", display_name: "استقبال 1",  role: "reception" },
  { email: "reception2@ox.local", display_name: "استقبال 2",  role: "reception" },
  { email: "reception3@ox.local", display_name: "استقبال 3",  role: "reception" },
  { email: "reception4@ox.local", display_name: "استقبال 4",  role: "reception" },
  { email: "reception5@ox.local", display_name: "استقبال 5",  role: "reception" },
];

async function main() {
  for (const u of USERS) {
    // Try to create — if exists, fetch and update profile.
    let userId;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: u.email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: u.display_name, role: u.role },
    });

    if (createErr && !/already/i.test(createErr.message)) {
      console.error(`✗ ${u.email}:`, createErr.message);
      continue;
    }

    if (created?.user) {
      userId = created.user.id;
      console.log(`✓ created ${u.email}`);
    } else {
      // already exists — find by listing
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
      const existing = list?.users.find((x) => x.email === u.email);
      if (!existing) {
        console.error(`✗ ${u.email}: created==null and not found in listUsers`);
        continue;
      }
      userId = existing.id;
      console.log(`• exists  ${u.email}`);
    }

    // Upsert profile
    const { error: profErr } = await admin
      .from("profiles")
      .upsert(
        { id: userId, display_name: u.display_name, role: u.role, active: true },
        { onConflict: "id" }
      );

    if (profErr) {
      console.error(`✗ profile ${u.email}:`, profErr.message);
    } else {
      console.log(`  → profile ok (${u.role}, ${u.display_name})`);
    }
  }

  console.log(`\nDone. Default password for all users: ${DEFAULT_PASSWORD}`);
  console.log("Tell each reception person to change their password after first login.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
