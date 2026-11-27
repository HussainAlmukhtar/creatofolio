// Which Storage objects does the data still point at?
//
// Pure and server-safe (no React, no Supabase client): the unused-files scan
// (`/api/admin/storage/*`) and the weight indicator both build on it.
//
// Saved configs store absolute public Storage URLs
// (`<origin>/storage/v1/object/public/<bucket>/<path>`) whose origin changed
// when storage moved, so we match on the path part only and ignore the origin.
// A few references are bare paths instead, keyed by column / property name:
//   drawing_scenes.psd_path        → drawing-scenes/<path>
//   sprites.storage_path           → sprites/<path>
//   rooms.config.bg*OriginalPath   → room-bg-originals/<path>
//   { kind: "drawn", sceneId }     → drawing-scenes/landing/<sceneId>.psd

const PUBLIC_RE = /\/storage\/v1\/object\/public\/([A-Za-z0-9_-]+)\/([^"'\s\)<>]+)/g;

/** `bucket/path` for a public Storage URL, else null. Decoded, query/hash stripped. */
export function normalizePublicUrl(url: string): string | null {
  PUBLIC_RE.lastIndex = 0;
  const m = PUBLIC_RE.exec(url);
  if (!m) return null;
  return normalizeKey(m[1], m[2]);
}

function normalizeKey(bucket: string, rawPath: string): string {
  let path = rawPath.replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  return `${bucket}/${path}`;
}

/** Every `bucket/path` a string mentions as a public URL. */
export function extractPublicPaths(text: string): string[] {
  const out: string[] = [];
  PUBLIC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PUBLIC_RE.exec(text))) out.push(normalizeKey(m[1], m[2]));
  return out;
}

/** The public URLs inside any JSON-ish value (full URLs, as stored). */
export function extractPublicUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^"'\s\)<>]+\/storage\/v1\/object\/public\/[A-Za-z0-9_-]+\/[^"'\s\)<>]+/g;
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) urls.add(m[0]);
  return [...urls];
}

function walk(value: unknown, out: Set<string>, key?: string): void {
  if (typeof value === "string") {
    for (const p of extractPublicPaths(value)) out.add(p);
    if (key && value) {
      if (key === "psd_path") out.add(normalizeKey("drawing-scenes", value));
      else if (key === "storage_path") out.add(normalizeKey("sprites", value));
      else if (/OriginalPath$/.test(key)) out.add(normalizeKey("room-bg-originals", value));
      // `sceneId` (drawn landing assets) and `<field>SceneId` (an image field
      // drawn in a block inspector): the kept layered PSD.
      else if (key === "sceneId" || /SceneId$/.test(key)) out.add(`drawing-scenes/landing/${value}.psd`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, out, k);
  }
}

/** Every `bucket/path` referenced anywhere in `rows` (rows of any table). */
export function collectReferencedPaths(rows: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) walk(r, out);
  return out;
}
