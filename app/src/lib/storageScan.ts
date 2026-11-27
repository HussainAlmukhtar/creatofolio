// Unused-files scan: which Storage objects does NO row point at any more?
//
// Server-only logic that takes the Supabase client as a parameter (the API
// routes pass the service-role client; the verification script passes its own).
// Never import it from a client component.
//
// Safety rules (the whole point is to never delete something in use):
//  - Every table that can mention a file is read in full; if ANY read fails
//    the scan throws, because "couldn't read" must not look like "unreferenced".
//  - Backups, drafts, versions and the trash count as references, so restoring
//    anything never meets a missing file.
//  - Objects younger than MIN_AGE_MS are never listed (they may belong to an
//    edit that isn't saved yet).
//  - Deleting re-runs the scan and refuses anything referenced or too young.

import type { SupabaseClient } from "@supabase/supabase-js";
import { collectReferencedPaths } from "./storageRefs";
import { resolveStorageUrl } from "./storageUrl";

export const STORAGE_BUCKETS = [
  "sprites",
  "content-images",
  "room-backgrounds",
  "room-bg-originals",
  "avatar-assets",
  "content-videos",
  "content-files",
  "site-fonts",
  "drawing-scenes",
] as const;

/** Buckets whose objects are readable by anyone (the rest need a signed URL). */
const PUBLIC_BUCKETS = new Set<string>([
  "sprites",
  "content-images",
  "room-backgrounds",
  "avatar-assets",
  "content-videos",
  "content-files",
  "site-fonts",
]);

export const REFERENCE_TABLES = [
  // Rooms
  "rooms",
  "room_drafts",
  "room_backups",
  "object_content",
  "drawing_scenes",
  "sprites",
  // Templates and worlds
  "object_templates",
  "worlds",
  // Landing pages
  "website_pages",
  "website_page_versions",
  "website_page_backups",
  "website_page_content",
  // Site, wardrobe, landing templates, trash
  "website_site_config",
  "avatar_assets",
  "website_section_templates",
  "deleted_items",
  // Pop-up theme + frame library (migration 20261008000001_popup_styles): drawn parts, drafts, history
  "popup_styles",
  "popup_style_drafts",
  "popup_style_backups",
  // Saved pop-up presets (migration 20261008000002_popup_presets): copies of pop-up bodies
  "popup_presets",
] as const;

/** Tables added by a migration that may not be applied yet: missing = no rows
 *  (a table that doesn't exist can't point at a file). Any other read error
 *  still aborts the scan. */
const OPTIONAL_TABLES = new Set<string>(["popup_styles", "popup_style_drafts", "popup_style_backups", "popup_presets"]);

export const MIN_AGE_MS = 48 * 60 * 60 * 1000;

export interface StoredObject {
  bucket: string;
  path: string;
  size: number;
  updatedAt: string | null;
}

export interface BucketTotal {
  bucket: string;
  count: number;
  bytes: number;
  unusedCount: number;
  unusedBytes: number;
}

export interface UnusedItem extends StoredObject {
  publicUrl?: string;
}

export interface ScanResult {
  buckets: BucketTotal[];
  unused: UnusedItem[];
  /** Objects skipped from `unused` only because they are < 48 h old. */
  tooNew: number;
  referencedPaths: number;
}

export interface ScanOptions {
  /** Test hook only — the API routes never pass it. */
  minAgeMs?: number;
  now?: number;
  /** Restrict the scan to these buckets (default: all). */
  buckets?: readonly string[];
}

// ─── Reading ────────────────────────────────────────────────

const PAGE = 1000;

async function readAllRows(client: SupabaseClient, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) {
      const missing = error.code === "42P01" || error.code === "PGRST205";
      if (missing && OPTIONAL_TABLES.has(table)) return rows;
      throw new Error(`Couldn't read ${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Every `bucket/path` referenced by any row. Throws if any table can't be read. */
export async function loadReferencedPaths(client: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  for (const table of REFERENCE_TABLES) {
    const rows = await readAllRows(client, table);
    for (const p of collectReferencedPaths(rows)) out.add(p);
  }
  return out;
}

async function listBucket(client: SupabaseClient, bucket: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  const walk = async (prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await client.storage.from(bucket).list(prefix, {
        limit: PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Couldn't list ${bucket}/${prefix}: ${error.message}`);
      for (const e of data ?? []) {
        if (!e.name || e.name === ".emptyFolderPlaceholder") continue;
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) await walk(path); // a folder
        else {
          const meta = (e.metadata ?? {}) as { size?: number };
          out.push({
            bucket,
            path,
            size: Number(meta.size ?? 0),
            updatedAt: e.updated_at ?? e.created_at ?? null,
          });
        }
      }
      if (!data || data.length < PAGE) break;
    }
  };
  await walk("");
  return out;
}

// ─── Scan ───────────────────────────────────────────────────

export async function scanStorage(
  client: SupabaseClient,
  opts: ScanOptions = {}
): Promise<ScanResult> {
  const minAge = opts.minAgeMs ?? MIN_AGE_MS;
  const now = opts.now ?? Date.now();
  const buckets = opts.buckets ?? STORAGE_BUCKETS;

  // References FIRST: an object uploaded + saved while we list can then only
  // look "referenced", never wrongly "unused".
  const referenced = await loadReferencedPaths(client);

  const totals: BucketTotal[] = [];
  const unused: UnusedItem[] = [];
  let tooNew = 0;
  for (const bucket of buckets) {
    const objects = await listBucket(client, bucket);
    const t: BucketTotal = {
      bucket,
      count: objects.length,
      bytes: objects.reduce((n, o) => n + o.size, 0),
      unusedCount: 0,
      unusedBytes: 0,
    };
    for (const o of objects) {
      if (referenced.has(`${o.bucket}/${o.path}`)) continue;
      const age = o.updatedAt ? now - Date.parse(o.updatedAt) : Infinity;
      if (age < minAge) {
        tooNew++;
        continue;
      }
      t.unusedCount++;
      t.unusedBytes += o.size;
      unused.push({
        ...o,
        publicUrl: PUBLIC_BUCKETS.has(bucket)
          ? resolveStorageUrl(client.storage.from(bucket).getPublicUrl(o.path).data.publicUrl)
          : undefined,
      });
    }
    totals.push(t);
  }
  unused.sort((a, b) => b.size - a.size);
  return { buckets: totals, unused, tooNew, referencedPaths: referenced.size };
}

// ─── Delete ─────────────────────────────────────────────────

export interface DeleteRequestItem {
  bucket: string;
  path: string;
}
export interface DeleteResult {
  deleted: DeleteRequestItem[];
  refused: (DeleteRequestItem & { reason: string })[];
}

export const MAX_DELETE_ITEMS = 200;

/**
 * Delete the requested objects that are STILL unreferenced and old enough.
 * The reference scan is re-run here, so a stale browser list can't delete
 * something that became used in the meantime.
 */
export async function deleteUnusedObjects(
  client: SupabaseClient,
  items: DeleteRequestItem[],
  opts: ScanOptions = {}
): Promise<DeleteResult> {
  const result: DeleteResult = { deleted: [], refused: [] };
  const minAge = opts.minAgeMs ?? MIN_AGE_MS;
  const now = opts.now ?? Date.now();

  const wanted = new Map<string, DeleteRequestItem>();
  for (const it of items.slice(0, MAX_DELETE_ITEMS)) {
    if (!(STORAGE_BUCKETS as readonly string[]).includes(it.bucket)) {
      result.refused.push({ ...it, reason: "unknown bucket" });
      continue;
    }
    if (!it.path || it.path.includes("..") || it.path.startsWith("/")) {
      result.refused.push({ ...it, reason: "invalid path" });
      continue;
    }
    wanted.set(`${it.bucket}/${it.path}`, it);
  }
  if (wanted.size === 0) return result;

  const referenced = await loadReferencedPaths(client);

  // Look each candidate up to confirm it exists and read its age.
  const byBucket = new Map<string, DeleteRequestItem[]>();
  for (const it of wanted.values()) {
    if (referenced.has(`${it.bucket}/${it.path}`)) {
      result.refused.push({ ...it, reason: "still in use" });
      continue;
    }
    const list = byBucket.get(it.bucket) ?? [];
    list.push(it);
    byBucket.set(it.bucket, list);
  }

  for (const [bucket, list] of byBucket) {
    const existing = new Map((await listBucket(client, bucket)).map((o) => [o.path, o]));
    const ok: DeleteRequestItem[] = [];
    for (const it of list) {
      const obj = existing.get(it.path);
      if (!obj) {
        result.refused.push({ ...it, reason: "not found" });
        continue;
      }
      const age = obj.updatedAt ? now - Date.parse(obj.updatedAt) : Infinity;
      if (age < minAge) {
        result.refused.push({ ...it, reason: "newer than 48 hours" });
        continue;
      }
      ok.push(it);
    }
    if (ok.length === 0) continue;
    const { error } = await client.storage.from(bucket).remove(ok.map((o) => o.path));
    if (error) {
      for (const it of ok) result.refused.push({ ...it, reason: `delete failed: ${error.message}` });
    } else {
      result.deleted.push(...ok);
    }
  }
  return result;
}
