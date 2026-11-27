// Server-side owner-auth helper for `/api/editor/*` and `/api/admin/*` routes.
//
// proxy.ts only gates `/admin/*` paths — API routes under `/api/editor/*`
// are reachable anonymously by default. Routes that touch the service-role
// client (and therefore bypass RLS) must call `getOwnerUser()` before doing
// any work, otherwise an unauthenticated visitor could read/write private
// buckets like `drawing-scenes` or `room-bg-originals`.
//
// Two-factor: an owner who has enrolled a verified TOTP factor only counts as
// the owner on an aal2 session (see lib/mfa.ts). A password-only session of
// that account is `mfaRequired` — signed in, the right email, but not yet
// allowed to act.

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { isOwnerEmail } from "@/lib/owner";
import { mfaSatisfied } from "@/lib/mfa";

export interface OwnerState {
  user: User | null;
  signedIn: boolean;
  /** The session belongs to the owner's address (regardless of 2FA). */
  ownerEmail: boolean;
  /** Owner address, a verified factor exists, and the session is only aal1. */
  mfaRequired: boolean;
}

export async function getOwnerState(): Promise<OwnerState> {
  const none: OwnerState = { user: null, signedIn: false, ownerEmail: false, mfaRequired: false };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return none;

  const cookieStore = await cookies();
  const userClient = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        /* no-op — read-only check */
      },
    },
  });

  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return none;

  const ownerEmail = isOwnerEmail(user.email);
  let mfaRequired = false;
  if (ownerEmail) {
    // getUser() just validated this session with GoTrue, so reading the aal
    // claim from its (cookie) token is safe.
    const {
      data: { session },
    } = await userClient.auth.getSession();
    mfaRequired = !mfaSatisfied(user, session?.access_token);
  }
  return { user, signedIn: true, ownerEmail, mfaRequired };
}

/**
 * Returns the authenticated user when they are the owner (lib/owner.ts) and,
 * if they have 2FA enrolled, signed in at aal2; null otherwise. Routes should
 * reject the request with 403 when null.
 */
export async function getOwnerUser() {
  const state = await getOwnerState();
  if (!state.user || !state.ownerEmail || state.mfaRequired) return null;
  return state.user;
}
