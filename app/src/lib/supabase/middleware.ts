// Supabase middleware helper — keeps the auth session fresh on every request
// and exposes the current user so pages/middleware can gate on it.
//
// Required because the browser client (client.ts) stores its session in cookies
// via @supabase/ssr; without this helper the cookies would never be refreshed
// server-side and protected pages would see stale/missing sessions.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { mfaSatisfied } from "@/lib/mfa";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { response, user: null, mfaOk: true };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() refreshes the session cookies if they're near expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Two-factor: with a verified authenticator the session must be aal2.
  // getUser() just validated the token with GoTrue, so reading its `aal` claim
  // from the (possibly refreshed) cookie session is safe. No user → nothing to
  // satisfy.
  let mfaOk = true;
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    mfaOk = mfaSatisfied(user, session?.access_token);
  }

  return { response, user, mfaOk };
}
