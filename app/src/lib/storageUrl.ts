// Storage URL resolution — keeps saved image URLs pointing at wherever the
// files live NOW.
//
// Every uploaded image (room backgrounds, sprites, drawings, content images,
// avatar parts) is stored in page/room JSON as an ABSOLUTE public URL:
//   <supabase origin>/storage/v1/object/public/<bucket>/<path>
// When storage moves (hosted Supabase → self-hosted Supabase on our domain,
// files served from a Cloudflare R2 bucket), every URL saved before the move
// still points at the old origin and renders blank. Instead of trusting the
// saved origin, we re-root every public-storage URL at read time:
//
//   NEXT_PUBLIC_STORAGE_PUBLIC_URL set  →  <that base>/<bucket>/<path>
//     (a public bucket domain, e.g. an R2 custom domain whose object keys
//      are laid out as <bucket>/<path>)
//   otherwise                           →  <NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/<bucket>/<path>
//     (the current Supabase — self-hosted storage serves the files even when
//      its backend is R2)
//
// Signed/private URLs (/storage/v1/object/sign/…), same-origin paths and
// third-party URLs are left untouched.

const PUBLIC_MARKER = "/storage/v1/object/public/";

function trimSlash(s: string | undefined): string | null {
  const v = s?.trim();
  return v ? v.replace(/\/+$/, "") : null;
}

// Referenced literally so Next inlines them into the client bundle.
const SUPABASE_BASE = trimSlash(process.env.NEXT_PUBLIC_SUPABASE_URL);
const STORAGE_PUBLIC_BASE = trimSlash(process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URL);

/** Re-root a public Storage URL at the current storage origin. */
export function resolveStorageUrl(url: string): string {
  if (!url || !url.includes(PUBLIC_MARKER)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const idx = parsed.pathname.indexOf(PUBLIC_MARKER);
  if (idx < 0) return url;
  const objectPath = parsed.pathname.slice(idx + PUBLIC_MARKER.length);
  if (!objectPath) return url;
  if (STORAGE_PUBLIC_BASE) return `${STORAGE_PUBLIC_BASE}/${objectPath}${parsed.search}`;
  if (SUPABASE_BASE) return `${SUPABASE_BASE}${PUBLIC_MARKER}${objectPath}${parsed.search}`;
  return url;
}

/**
 * Deep-copy `value` with every public Storage URL string re-rooted (see
 * resolveStorageUrl). Returns the SAME reference when nothing changed, so
 * callers' identity/JSON-equality checks stay cheap.
 */
export function rewriteStorageUrls<T>(value: T): T {
  if (!SUPABASE_BASE && !STORAGE_PUBLIC_BASE) return value;
  return walk(value) as T;
}

function walk(v: unknown): unknown {
  if (typeof v === "string") return resolveStorageUrl(v);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((item) => {
      const next = walk(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : v;
  }
  if (v && typeof v === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, item] of Object.entries(v)) {
      const next = walk(item);
      if (next !== item) changed = true;
      out[k] = next;
    }
    return changed ? out : v;
  }
  return v;
}

/**
 * Hosts next/image may optimize from (must match next.config.ts
 * remotePatterns). Shared so the render path and the config agree.
 */
export function storageImageHosts(): { protocol: "http" | "https"; hostname: string; pathPrefix: string }[] {
  const out: { protocol: "http" | "https"; hostname: string; pathPrefix: string }[] = [];
  const add = (base: string | null, pathPrefix: (u: URL) => string) => {
    if (!base) return;
    try {
      const u = new URL(base);
      const protocol = u.protocol === "http:" ? "http" : "https";
      out.push({ protocol, hostname: u.hostname, pathPrefix: pathPrefix(u) });
    } catch {
      /* ignore malformed env */
    }
  };
  add(SUPABASE_BASE, () => PUBLIC_MARKER);
  add(STORAGE_PUBLIC_BASE, (u) => `${u.pathname.replace(/\/+$/, "")}/`);
  return out;
}
