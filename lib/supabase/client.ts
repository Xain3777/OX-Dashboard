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

// All Supabase requests go through this fetch wrapper so they self-cancel
// after 10 s instead of hanging forever on network blips or server hiccups.
function fetchWithTimeout(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const signal = init?.signal
    ? anySignal([init.signal, controller.signal])
    : controller.signal;
  return fetch(url, { ...init, signal }).finally(() => clearTimeout(timer));
}

// Combines multiple AbortSignals — aborts when the first one fires.
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) { controller.abort(); break; }
    s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

let _client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key && !url.includes("placeholder") && key !== "placeholder-anon-key");
}

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
      global: {
        fetch: fetchWithTimeout,
      },
    },
  );
  return _client;
}
