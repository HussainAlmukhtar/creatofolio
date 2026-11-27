// URL safety for everything a visitor can trigger from a pop-up (and from the
// game/landing blocks that share its renderers).
//
// Owner-authored content is still untrusted at render time: a pasted
// `javascript:` link, a `data:text/html` frame or a protocol-relative
// `//evil.example` would run on visitors. Two entry points:
//
//   safeHref(raw)      links and actions: http(s), mailto:, tel:, #anchors and
//                      same-site relative paths. Anything else → null.
//   safeMediaSrc(raw)  <img>/<video>/<audio>/poster sources: http(s), same-site
//                      paths, blob: (editor previews) and data:image/* for
//                      images only. Anything else → null.
//
// Runtime callers render nothing / an inert element on null ("refuse
// quietly"); editors call urlProblem() to show an inline error instead.
// Pure, no DOM — safe on the server.

export type UrlKind = "link" | "image" | "media";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Strip the whitespace browsers ignore so "  java\tscript:" can't sneak by. */
function normalize(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || CONTROL_CHARS.test(v) || v.includes("\\")) return null;
  return v;
}

/** A same-site relative reference: "/path", "#anchor", "?q", "./x", "x/y". */
function isSameSiteRelative(v: string): boolean {
  if (v.startsWith("//")) return false; // protocol-relative → another origin
  if (v.startsWith("/") || v.startsWith("#") || v.startsWith("?")) return true;
  // No scheme at all ("about", "./a"): a scheme is "letters:" before any / ? #.
  return !/^[a-z][a-z0-9+.-]*:/i.test(v);
}

function scheme(v: string): string | null {
  const m = v.match(/^([a-z][a-z0-9+.-]*):/i);
  return m ? m[1].toLowerCase() : null;
}

/** A link a visitor may follow (anchor href, link/email/download steps). */
export function safeHref(raw: unknown): string | null {
  const v = normalize(raw);
  if (!v) return null;
  if (isSameSiteRelative(v)) return v;
  const s = scheme(v);
  if (s === "http" || s === "https") {
    try {
      new URL(v);
      return v;
    } catch {
      return null;
    }
  }
  if (s === "mailto" || s === "tel") return v.length > s.length + 1 ? v : null;
  return null;
}

/** A media source for <img> (kind "image") or <video>/<audio>/poster ("media"). */
export function safeMediaSrc(raw: unknown, kind: "image" | "media" = "image"): string | null {
  const v = normalize(raw);
  if (!v) return null;
  if (isSameSiteRelative(v)) return v.startsWith("#") || v.startsWith("?") ? null : v;
  const s = scheme(v);
  if (s === "http" || s === "https") {
    try {
      new URL(v);
      return v;
    } catch {
      return null;
    }
  }
  if (s === "blob") return v;
  // Raster/SVG data URIs are inert inside <img> (no script runs there); never
  // for <video>/<audio>, and never data:text/html anywhere.
  if (s === "data" && kind === "image" && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(v)) {
    return v;
  }
  return null;
}

/** True when the link leaves this site (used for target=_blank + rel). */
export function isExternalHref(href: string): boolean {
  const s = scheme(href);
  return s === "http" || s === "https";
}

/**
 * Editor-side validation: a short, human message for an unsafe/invalid URL,
 * or null when it's fine (or empty — "required" is the caller's call).
 */
export function urlProblem(raw: unknown, kind: UrlKind = "link"): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ok = kind === "link" ? safeHref(raw) : safeMediaSrc(raw, kind === "image" ? "image" : "media");
  if (ok) return null;
  const v = raw.trim();
  if (v.startsWith("//")) return "Add https: at the start (links starting with // aren't allowed).";
  const s = scheme(v);
  if (s === "javascript" || s === "vbscript" || s === "data" || s === "file") {
    return `"${s}:" links aren't allowed — they could run code on visitors.`;
  }
  return kind === "link"
    ? "Use a full https:// link, mailto:, tel:, #section or a /page path."
    : "Use an https:// file link (or upload the file).";
}
