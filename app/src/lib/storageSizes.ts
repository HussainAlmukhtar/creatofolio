// Server-only: byte sizes for public Storage URLs, read from Storage metadata
// (service-role client passed in). Anything that isn't a public URL of one of
// OUR buckets is answered null with no outbound request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePublicUrl } from "./storageRefs";
import { STORAGE_BUCKETS } from "./storageScan";

export async function lookupSizes(
  client: SupabaseClient,
  urls: string[]
): Promise<Record<string, number | null>> {
  const sizes: Record<string, number | null> = {};
  // One list() per folder answers every file in it.
  const byFolder = new Map<string, Map<string, string[]>>();
  for (const url of urls) {
    sizes[url] = null;
    const key = normalizePublicUrl(url);
    if (!key) continue;
    const slash = key.indexOf("/");
    const bucket = key.slice(0, slash);
    const path = key.slice(slash + 1);
    if (!(STORAGE_BUCKETS as readonly string[]).includes(bucket) || !path) continue;
    const cut = path.lastIndexOf("/");
    const folder = `${bucket}/${cut < 0 ? "" : path.slice(0, cut)}`;
    const files = byFolder.get(folder) ?? new Map<string, string[]>();
    const name = path.slice(cut + 1);
    files.set(name, [...(files.get(name) ?? []), url]);
    byFolder.set(folder, files);
  }

  for (const [folder, wanted] of byFolder) {
    const s = folder.indexOf("/");
    const bucket = folder.slice(0, s);
    const prefix = folder.slice(s + 1);
    for (let offset = 0; wanted.size > 0; offset += 1000) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(prefix, { limit: 1000, offset });
      if (error || !data) break;
      for (const e of data) {
        const urlsFor = wanted.get(e.name);
        if (!urlsFor) continue;
        const size = Number((e.metadata as { size?: number } | null)?.size);
        for (const u of urlsFor) sizes[u] = Number.isFinite(size) && size > 0 ? size : null;
        wanted.delete(e.name);
      }
      if (data.length < 1000) break;
    }
  }
  return sizes;
}
