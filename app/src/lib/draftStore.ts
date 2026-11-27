// Draft autosave — IndexedDB-backed per-room drafts.
//
// After every mutation, the editor debounces 2 s and writes the in-flight
// `RoomConfig` here. On room load, the store checks for a draft newer than
// the DB row and offers Restore / Discard. On successful save, the draft is
// cleared.
//
// We use the native IndexedDB API rather than pulling in `idb-keyval` so we
// avoid the dependency for ~40 lines of glue. SSR-safe: every public fn
// short-circuits when `indexedDB` isn't available.

import type { RoomConfig } from "@/data/roomTypes";
import type { ObjectContent } from "@/data/contentTypes";
import type { DrawnPage } from "@/data/landingTypes";

const DB_NAME = "portfolio-editor";
// v2 added the "landing-drafts" store for the landing-page CMS editor. Fresh
// browsers run onupgradeneeded once at the final version, so the handler must
// create BOTH stores if missing (not just the newly-added one).
const DB_VERSION = 2;
const STORE = "drafts";
const LANDING_STORE = "landing-drafts";

export interface DraftRow {
  /** RoomConfig at the time of the last debounced write. */
  config: RoomConfig;
  /** Unsaved pop-up edits of this room ({ objectId: content }), if any. */
  content?: Record<string, ObjectContent>;
  /** Wall-clock ms when written. Compared to DB `updated_at` on load. */
  savedAt: number;
}

export interface LandingDraftRow {
  /** DrawnPage at the time of the last debounced write. */
  page: DrawnPage;
  /** Wall-clock ms when written. */
  savedAt: number;
}

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(LANDING_STORE)) {
        db.createObjectStore(LANDING_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getDraft(roomIid: string): Promise<DraftRow | null> {
  const result = await withStore(STORE, "readonly", (s) => s.get(roomIid));
  return (result as DraftRow | null) ?? null;
}

export async function setDraft(
  roomIid: string,
  config: RoomConfig,
  content?: Record<string, ObjectContent>
): Promise<void> {
  const row: DraftRow = { config, savedAt: Date.now(), ...(content && Object.keys(content).length ? { content } : {}) };
  await withStore(STORE, "readwrite", (s) => s.put(row, roomIid));
}

export async function clearDraft(roomIid: string): Promise<void> {
  await withStore(STORE, "readwrite", (s) => s.delete(roomIid));
}

// ─── Landing-page drafts (landing-cms editor) ───────────────

export async function getLandingDraft(
  pageIid: string
): Promise<LandingDraftRow | null> {
  const result = await withStore(LANDING_STORE, "readonly", (s) =>
    s.get(pageIid)
  );
  return (result as LandingDraftRow | null) ?? null;
}

export async function setLandingDraft(
  pageIid: string,
  page: DrawnPage
): Promise<void> {
  await withStore(LANDING_STORE, "readwrite", (s) =>
    s.put({ page, savedAt: Date.now() } as LandingDraftRow, pageIid)
  );
}

export async function clearLandingDraft(pageIid: string): Promise<void> {
  await withStore(LANDING_STORE, "readwrite", (s) => s.delete(pageIid));
}

/** Best-effort enumeration of every saved draft (debug / "have I lost work?"). */
export async function listDrafts(): Promise<{ roomIid: string; savedAt: number }[]> {
  if (!isAvailable()) return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const out: { roomIid: string; savedAt: number }[] = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(out);
        const value = cursor.value as DraftRow | undefined;
        out.push({
          roomIid: String(cursor.key),
          savedAt: value?.savedAt ?? 0,
        });
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
