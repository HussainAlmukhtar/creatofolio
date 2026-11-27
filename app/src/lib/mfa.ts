// Two-factor (TOTP) rules for the owner account — pure, server-safe, no React.
//
// GoTrue puts the session's assurance level in the access token (`aal`:
// "aal1" = password only, "aal2" = password + a verified second factor) and
// lists the user's factors on the user object. App-level rule used by the proxy
// and the API routes: an owner who has at least one VERIFIED factor must be at
// aal2. (The database-level twin is public.owner_mfa_satisfied(), in
// supabase/migrations/20261005000004_owner_mfa.sql: a no-op until a factor is
// verified.)

export type Aal = "aal1" | "aal2";

interface FactorLike {
  status?: string | null;
}

/** Does the user have at least one verified factor (enrolled AND confirmed)? */
export function hasVerifiedFactor(
  user: { factors?: FactorLike[] | null } | null | undefined
): boolean {
  return !!user?.factors?.some((f) => f.status === "verified");
}

/**
 * The `aal` claim of an access token. Decoded, NOT verified: only call this
 * with a token whose user was just validated by `auth.getUser()` (which asks
 * GoTrue), as proxy.ts and owner-auth.ts do. Unreadable → null.
 */
export function aalOfToken(accessToken: string | null | undefined): Aal | null {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      aal?: string;
    };
    return json.aal === "aal2" ? "aal2" : json.aal === "aal1" ? "aal1" : null;
  } catch {
    return null;
  }
}

/**
 * True when the session may act as the owner as far as 2FA goes: no verified
 * factor yet (not enrolled → password only, as before), or the token is aal2.
 * Fails CLOSED: a verified factor plus an unreadable token is "not satisfied".
 */
export function mfaSatisfied(
  user: { factors?: FactorLike[] | null } | null | undefined,
  accessToken: string | null | undefined
): boolean {
  return !hasVerifiedFactor(user) || aalOfToken(accessToken) === "aal2";
}
