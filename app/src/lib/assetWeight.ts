// "How heavy is this room / page?" — the sum of the Storage files it loads.
//
// URLs are collected from the config (and its pop-up content) with
// storageRefs, sizes come from the owner-only /api/admin/storage/sizes route,
// cached for the session.

import { extractPublicUrls } from "./storageRefs";
import { resolveStorageUrl } from "./storageUrl";

export const WEIGHT_GREEN_MAX = 3 * 1024 * 1024;
export const WEIGHT_AMBER_MAX = 6 * 1024 * 1024;

export type WeightTone = "green" | "amber" | "red";

export function weightTone(bytes: number): WeightTone {
  if (bytes < WEIGHT_GREEN_MAX) return "green";
  if (bytes <= WEIGHT_AMBER_MAX) return "amber";
  return "red";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Every distinct public-Storage asset URL inside `values`, re-rooted. */
export function collectAssetUrls(...values: unknown[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    for (const u of extractPublicUrls(v)) set.add(resolveStorageUrl(u));
  }
  return [...set];
}

const sizeCache = new Map<string, Promise<number | null>>();

// The storage origin doesn't expose Content-Length / Content-Range over CORS,
// so sizes come from the owner-only /api/admin/storage/sizes route (Storage
// metadata). Uncached URLs are fetched in ONE batched request per call.
async function fetchSizes(urls: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (let i = 0; i < urls.length; i += 200) {
    const chunk = urls.slice(i, i + 200);
    try {
      const res = await fetch("/api/admin/storage/sizes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: chunk }),
      });
      const body = res.ok ? ((await res.json()) as { sizes: Record<string, number | null> }) : null;
      for (const u of chunk) out.set(u, body?.sizes?.[u] ?? null);
    } catch {
      for (const u of chunk) out.set(u, null);
    }
  }
  return out;
}

export interface WeightReport {
  total: number;
  files: { url: string; bytes: number }[]; // largest first
  /** Files whose size couldn't be read (not counted in `total`). */
  unknown: number;
}

export async function measureAssets(
  urls: string[],
  concurrency = 6
): Promise<WeightReport> {
  void concurrency; // kept for callers; one batched request replaces the pool
  const missing = urls.filter((u) => !sizeCache.has(u));
  if (missing.length > 0) {
    const batch = fetchSizes(missing);
    for (const u of missing) {
      sizeCache.set(u, batch.then((m) => m.get(u) ?? null));
    }
  }
  const sizes = new Map<string, number | null>();
  await Promise.all(urls.map(async (u) => sizes.set(u, await sizeCache.get(u)!)));
  const files: { url: string; bytes: number }[] = [];
  let unknown = 0;
  for (const [url, bytes] of sizes) {
    if (bytes == null) unknown++;
    else files.push({ url, bytes });
  }
  files.sort((a, b) => b.bytes - a.bytes);
  return { total: files.reduce((n, f) => n + f.bytes, 0), files, unknown };
}
