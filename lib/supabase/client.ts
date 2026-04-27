"use client";

// Plain @supabase/supabase-js browser client — uses localStorage for session
// persistence. We previously used @supabase/ssr's createBrowserClient, but in
// dev with Turbopack/HMR + React Strict Mode it would silently fail to write
// the auth cookie on signin (page stayed on login screen with no error). It
// also acquired a Navigator-wide Web Lock named "lock:sb-…-auth-token", which
// caused "lock was released because another request stole it" errors when more
// than one browser context was logged into the same project (e.g. dev preview
// + real browser). Plain createClient avoids both: localStorage is sync, and
// the in-process auth refresh queue doesn't escape the tab.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key && !url.includes("placeholder") && key !== "placeholder-anon-key");
}

let _client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "ox-auth",
      },
    },
  );
  return _client;
}
