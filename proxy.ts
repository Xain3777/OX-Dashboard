import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Skip the Supabase round-trip entirely for assets and route handlers.
// Including `/api/` here is critical — auth callbacks set their own cookies
// and racing with the proxy here causes the "stale auth-token" / "must use
// incognito" symptom the sister app fixed in commit ef12a94.
const SKIP_PREFIXES = ["/_next", "/favicon.ico", "/api/"];
const IS_PROD = process.env.NODE_ENV === "production";

const AUTH_TIMEOUT_MS = 1500;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (IS_PROD && request.headers.get("x-forwarded-proto") === "http") {
    const httpsUrl = request.nextUrl.clone();
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, { status: 301 });
  }

  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return response;

  // The double-write below is load-bearing. The SSR client refreshes the
  // access token mid-request; if the new cookie isn't piped onto BOTH the
  // request (so subsequent reads in this same request see it) AND the
  // response (so the browser stores it), the next request keeps presenting
  // the expired token and getUser() returns the stale identity.
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh the session. Bound by a timeout so a hung auth call doesn't
  // take down every page load.
  try {
    const refresh = supabase.auth.getUser();
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, AUTH_TIMEOUT_MS)
    );
    await Promise.race([refresh, timeout]);
  } catch (err) {
    console.error("[proxy] auth.getUser failed:", err);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
