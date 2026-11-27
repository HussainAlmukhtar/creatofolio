// Next.js 16 proxy (formerly the "middleware" convention). Runs on every
// request matched by the `config.matcher` below. Two responsibilities:
//
//   1. Refresh Supabase auth cookies so server-rendered pages see a fresh
//      session (otherwise long-running tabs go stale).
//   2. Gate `/admin/*`: anyone but the owner gets
//      redirected to `/admin/login` (a signed-in non-owner lands on
//      `?error=not_owner`). The owner hitting the login page is bounced to
//      the dashboard. An owner with a verified authenticator (2FA) who is
//      only signed in with the password (aal1) is sent to the code step
//      (`/admin/login?step=mfa`) first; see lib/mfa.ts.
//   3. Maintenance / password page (Site settings → Maintenance): while it's
//      on, public pages are rewritten to /maintenance (HTTP 503, noindex)
//      unless the visitor is the owner or holds the site-access cookie. It
//      runs here, not in the pages, so statically cached pages can't slip
//      past it.
//
// Build output confirms it loads as `Proxy (Middleware)`. The function
// MUST be named `proxy` — Next.js doesn't pick up other names.

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isOwnerEmail } from "@/lib/owner";
import {
  SITE_ACCESS_COOKIE,
  accessToken,
  bypassesGate,
  maintenanceEnabled,
  safeEqual,
} from "@/lib/siteAccess";

export async function proxy(request: NextRequest) {
  const { response, user, mfaOk } = await updateSession(request);

  const ownerEmail = isOwnerEmail(user?.email);
  // The owner, fully signed in. A password-only session of the owner's account
  // that still owes the 2FA code counts as neither owner nor stranger.
  const mfaPending = ownerEmail && !mfaOk;
  const isOwner = ownerEmail && mfaOk;

  const { pathname } = request.nextUrl;
  const isAdminRoute =
    pathname.startsWith("/admin") && !pathname.startsWith("/admin/login");

  if (isAdminRoute && !isOwner) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.search = "";
    if (mfaPending) {
      // Password step done, code step still owed.
      loginUrl.searchParams.set("step", "mfa");
      loginUrl.searchParams.set("redirect", pathname);
    } else if (!user) {
      loginUrl.searchParams.set("redirect", pathname);
    } else {
      // Signed in but not the owner: no redirect param, so it can't loop.
      loginUrl.searchParams.set("error", "not_owner");
    }
    return NextResponse.redirect(loginUrl);
  }

  // If the owner hits /admin/login, bounce them to the dashboard. A signed-in
  // non-owner stays so they can see the message and sign out.
  if (pathname === "/admin/login" && isOwner) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/admin";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  if (!isOwner && !bypassesGate(pathname) && (await maintenanceEnabled())) {
    const token = await accessToken();
    const cookie = request.cookies.get(SITE_ACCESS_COOKIE)?.value;
    if (!token || !cookie || !safeEqual(cookie, token)) {
      const url = request.nextUrl.clone();
      url.pathname = "/maintenance";
      url.search = "";
      const gated = NextResponse.rewrite(url, { status: 503 });
      gated.headers.set("Retry-After", "3600");
      gated.headers.set("X-Robots-Tag", "noindex");
      gated.headers.set("Cache-Control", "no-store");
      // Keep any refreshed auth cookies from updateSession.
      for (const c of response.cookies.getAll()) gated.cookies.set(c);
      return gated;
    }
  }

  return response;
}

export const config = {
  matcher: [
    // All app routes except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|css|js|woff2?)$).*)",
  ],
};
