// Maintenance / password-page gate, shared by src/proxy.ts (enforcement) and
// /api/site-access (unlock). Server-only: never import from client code.
//
// - The on/off flag lives in the public site config (website_site_config),
//   read with the anon key and cached briefly in memory so the proxy doesn't
//   hit the database on every request.
// - The password is the SITE_PASSWORD env var. A visitor who enters it gets
//   an httpOnly cookie holding a hash derived from it (never the password
//   itself). Changing SITE_PASSWORD invalidates every issued cookie.

export const SITE_ACCESS_COOKIE = "site_access";
const FLAG_TTL_MS = 15_000;

let cached: { enabled: boolean; at: number } | null = null;

/**
 * Is the maintenance page on? Cached for 15s per server instance. If the
 * database can't be reached, the last known value is kept; with none, the
 * site stays OPEN (an outage shouldn't lock visitors out of a live site).
 */
export async function maintenanceEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < FLAG_TTL_MS) return cached.enabled;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/website_site_config?select=config&id=eq.default`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as { config?: { maintenance?: { enabled?: boolean } } }[];
    const enabled = Boolean(rows[0]?.config?.maintenance?.enabled);
    cached = { enabled, at: now };
    return enabled;
  } catch {
    if (cached) {
      cached = { ...cached, at: now };
      return cached.enabled;
    }
    return false;
  }
}

export function sitePasswordConfigured(): boolean {
  return Boolean(process.env.SITE_PASSWORD);
}

/** The cookie value that proves the visitor knew the current password. */
export async function accessToken(): Promise<string | null> {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return null;
  const data = new TextEncoder().encode(`site-access:v1:${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare (no early exit on the first mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Paths the gate never blocks: the holding page itself, the admin area,
 *  APIs, crawler files and Next internals. */
export function bypassesGate(pathname: string): boolean {
  return (
    pathname === "/maintenance" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/__") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/favicon.ico"
  );
}
