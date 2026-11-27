// Editor data access layer — CRUD for rooms, content, and sprites.
//
// Two load flavors:
//   - loadRoom / loadAllRooms: game runtime. Silently falls back to static data
//     so public visitors always see *something*.
//   - loadRoomForEditor / loadAllRoomsForEditor: editor. Never silently falls
//     back — returns a `source` tag so the caller can tell the user when the
//     DB wasn't reached, otherwise edits appear to "vanish" on reload.
//
// All write functions return { ok, error? } so the store can surface failures
// via toasts instead of flipping `isDirty` to false and leaving the user
// believing the save succeeded.

import type {
  RoomConfig,
  RoomId,
  BgLayer,
  WorldConfig,
  WorldLayout,
  WorldSettings,
} from "@/data/roomTypes";
import { withLegacyInteractions, type TemplateBehaviour } from "@/lib/objectActions";
import { ROOM_WIDTH, ROOM_HEIGHT } from "@/data/roomTypes";
import { newIid } from "@/lib/iid";
import type { ObjectContent } from "@/data/contentTypes";
import { staticWorld } from "@/data/staticRooms";
import { coerceRoomConfig } from "@/data/roomCoerce";
import { getStaticContent, getStaticContentForRoom } from "@/data/staticContent";
import { getSupabaseClient } from "./supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStorageUrl, rewriteStorageUrls } from "./storageUrl";
import { migrateContentMap, migrateObjectContent } from "@/data/contentMigrations";
import { prepareForUpload, prepareOriginalForUpload, withExt } from "./uploadPrep";
import { rewriteInboundDoors } from "./doorRewrite";
import type { ImageKind } from "./imagePrep";
import {
  writeErrorFor,
  noRowsResult,
  noteForbiddenResponse,
  denialFor,
} from "./writeGuard";

export interface WriteResult {
  ok: boolean;
  error?: string;
  /** Why it failed, when the caller can act on it (see lib/writeGuard.ts). */
  code?: "session" | "forbidden" | "not_found" | "conflict";
}

export type EditorLoadSource = "supabase" | "static" | "missing";

export interface EditorRoomLoad {
  config: RoomConfig | null;
  source: EditorLoadSource;
  error?: string;
  /** rooms.updated_at at load time: the concurrency token for saveRoom. */
  updatedAt?: string | null;
  /** Set when the room has an unpublished draft; `config` is then the DRAFT
   *  (placement still overlaid from the columns). */
  draft?: RoomDraftInfo | null;
  /** false when the room_drafts table doesn't exist (migration 20261005000001_room_drafts not applied). */
  draftsAvailable?: boolean;
}

// ─── Room drafts ───────────────────────────────────────
// Save writes ONE draft per room into room_drafts; Publish copies it live in a
// transaction (publish_room_draft). The public game reads rooms.config only.
// Everything here feature-detects the migration: table missing → drafts are
// "unavailable" and the editor keeps its old save-straight-to-live behaviour.

export interface RoomDraftInfo {
  /** room_drafts.updated_at: the optimistic-concurrency token for saveRoomDraft. */
  updatedAt: string;
  /** { objectId: ObjectContent } — the draft's pop-up content. null = untouched
   *  (the live object_content rows apply). */
  content: Record<string, ObjectContent> | null;
}

/** 42P01 = relation missing; PGRST205 = PostgREST's schema-cache miss for it. */
function draftTableMissing(e: { code?: string; message?: string }): boolean {
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    (/room_drafts/.test(e.message ?? "") && /not find|does not exist/i.test(e.message ?? ""))
  );
}

interface DraftRow {
  room_iid: string;
  config: RoomConfig;
  content: Record<string, ObjectContent> | null;
  updated_at: string;
}

function draftFromRow(row: DraftRow): { config: RoomConfig; info: RoomDraftInfo } {
  return {
    config: coerceRoomConfig(row.config),
    info: {
      updatedAt: row.updated_at,
      content: row.content ? migrateContentMap(rewriteStorageUrls(row.content)) : null,
    },
  };
}

// The world-map placement columns (rooms.world_*) are the source of truth:
// the World map writes only them (updateRoomPlacement), so config.worldX/Y can
// be stale. Overlay the columns onto a loaded config so the editor shows, and
// a later save re-mirrors, the real position.
interface PlacementColumns {
  world_iid?: string | null;
  world_x?: number | null;
  world_y?: number | null;
  world_w?: number | null;
  world_h?: number | null;
}

const ROOM_EDITOR_COLS =
  "id, iid, config, updated_at, world_iid, world_x, world_y, world_w, world_h";

function overlayPlacement(cfg: RoomConfig, row: PlacementColumns): RoomConfig {
  return {
    ...cfg,
    worldIid: row.world_iid ?? cfg.worldIid,
    worldX: row.world_x ?? cfg.worldX,
    worldY: row.world_y ?? cfg.worldY,
    worldW: row.world_w ?? cfg.worldW,
    worldH: row.world_h ?? cfg.worldH,
  };
}

// ─── Rooms (game runtime — silent fallback) ─────────────────

export async function loadRoom(roomId: RoomId): Promise<RoomConfig> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("rooms")
      .select("config")
      .eq("id", roomId)
      .single();

    if (!error && data?.config) {
      return coerceRoomConfig(data.config as RoomConfig);
    }
  }

  return staticWorld.rooms[roomId];
}

export async function loadAllRooms(): Promise<Record<RoomId, RoomConfig>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.from("rooms").select("id, config");

    if (!error && data?.length) {
      const rooms: Record<string, RoomConfig> = {};
      for (const row of data) {
        rooms[row.id] = coerceRoomConfig(row.config as RoomConfig);
      }
      return rooms as Record<RoomId, RoomConfig>;
    }
  }

  return { ...staticWorld.rooms };
}

// ─── Rooms (editor — explicit source, surfaced errors) ──────

export async function loadRoomForEditor(
  roomId: RoomId
): Promise<EditorRoomLoad> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      config: staticWorld.rooms[roomId] ?? null,
      source: "static",
      error: "Supabase not configured — edits will not persist.",
    };
  }

  const { data, error } = await supabase
    .from("rooms")
    .select(ROOM_EDITOR_COLS)
    .eq("id", roomId)
    .maybeSingle();

  if (error) {
    return {
      config: staticWorld.rooms[roomId] ?? null,
      source: "static",
      error: error.message,
    };
  }

  if (!data?.config) {
    // Row doesn't exist yet — seed from static so the user sees something.
    return {
      config: staticWorld.rooms[roomId] ?? null,
      source: "missing",
      updatedAt: null,
    };
  }
  const updatedAt = (data.updated_at as string | null) ?? null;

  // An unpublished draft wins over the live row (and over the file mirror,
  // which only ever holds the live config).
  let draftsAvailable = true;
  let draft: { config: RoomConfig; info: RoomDraftInfo } | null = null;
  if (data.iid) {
    const dr = await supabase
      .from("room_drafts")
      .select("room_iid, config, content, updated_at")
      .eq("room_iid", data.iid as string)
      .maybeSingle();
    if (dr.error) {
      if (draftTableMissing(dr.error)) draftsAvailable = false;
      else console.warn("[editorData] couldn't read room draft:", dr.error.message);
    } else if (dr.data) {
      draft = draftFromRow(dr.data as DraftRow);
    }
  }
  if (draft) {
    return {
      config: overlayPlacement(draft.config, data),
      source: "supabase",
      updatedAt,
      draft: draft.info,
      draftsAvailable,
    };
  }

  // External-files override. When enabled and the file
  // exists, treat it as source of truth — the DB row is just a cache.
  const world = await loadDefaultWorld();
  if (world?.config?.externalFilesEnabled) {
    try {
      const fileRooms = await readWorldFiles(world.id);
      const fileCfg = fileRooms[roomId];
      if (fileCfg) {
        return {
          config: overlayPlacement(coerceRoomConfig(fileCfg), data),
          source: "supabase",
          updatedAt,
          draft: null,
          draftsAvailable,
        };
      }
    } catch {
      /* ignore — fall through to DB row. */
    }
  }

  return {
    config: overlayPlacement(coerceRoomConfig(data.config as RoomConfig), data),
    source: "supabase",
    updatedAt,
    draft: null,
    draftsAvailable,
  };
}

export async function loadAllRoomsForEditor(): Promise<{
  rooms: Record<string, RoomConfig>;
  /** id → rooms.updated_at, for rooms that exist in the DB (the saveRoom token). */
  revisions: Record<string, string>;
  /** id → unpublished draft (the room's entry in `rooms` is then the draft). */
  drafts: Record<string, RoomDraftInfo>;
  /** false when the room_drafts table doesn't exist (migration 20261005000001_room_drafts not applied). */
  draftsAvailable: boolean;
  source: EditorLoadSource;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      rooms: { ...staticWorld.rooms },
      revisions: {},
      drafts: {},
      draftsAvailable: false,
      source: "static",
      error: "Supabase not configured — edits will not persist.",
    };
  }

  const { data, error } = await supabase.from("rooms").select(ROOM_EDITOR_COLS);
  if (error) {
    return {
      rooms: { ...staticWorld.rooms },
      revisions: {},
      drafts: {},
      draftsAvailable: false,
      source: "static",
      error: error.message,
    };
  }

  // Once the DB has rooms it is the source of truth: the static seed is only
  // a fallback for an empty/unreachable DB. (Merging the seed in every time
  // made rooms deleted in the World map come straight back.)
  const merged: Record<string, RoomConfig> =
    data && data.length > 0 ? {} : { ...staticWorld.rooms };
  const revisions: Record<string, string> = {};
  for (const row of data ?? []) {
    merged[row.id] = overlayPlacement(coerceRoomConfig(row.config as RoomConfig), row);
    if (row.updated_at) revisions[row.id as string] = row.updated_at as string;
  }

  // External-files mode: file wins for committed rooms so
  // pulling a teammate's branch with new rooms in git "just works". We only
  // overlay rooms whose file actually loads — DB-only rooms still appear.
  // Best-effort — failures are silently ignored so a missing dir/server-side
  // hiccup doesn't lose the editor.
  const world = await loadDefaultWorld();
  let finalRooms = merged;
  if (world?.config?.externalFilesEnabled) {
    try {
      const fileRooms = await readWorldFiles(world.id);
      finalRooms = mergeFileAndDbRooms(merged, fileRooms);
      // The file wins for content, but placement still comes from the columns.
      for (const row of data ?? []) {
        if (fileRooms[row.id as string]) {
          finalRooms[row.id as string] = overlayPlacement(finalRooms[row.id as string], row);
        }
      }
    } catch {
      /* ignore — DB version still serves. */
    }
  }

  // Unpublished drafts win over live (and over file mirrors of live).
  const drafts: Record<string, RoomDraftInfo> = {};
  let draftsAvailable = true;
  const dr = await supabase
    .from("room_drafts")
    .select("room_iid, config, content, updated_at");
  if (dr.error) {
    if (draftTableMissing(dr.error)) draftsAvailable = false;
    else console.warn("[editorData] couldn't read room drafts:", dr.error.message);
  } else {
    const byIid = new Map<string, (typeof data)[number]>();
    for (const row of data ?? []) if (row.iid) byIid.set(row.iid as string, row);
    for (const d of (dr.data ?? []) as DraftRow[]) {
      const live = byIid.get(d.room_iid);
      if (!live) continue; // orphan draft: its room is gone
      const parsed = draftFromRow(d);
      finalRooms[live.id as string] = overlayPlacement(parsed.config, live);
      drafts[live.id as string] = parsed.info;
    }
  }

  return {
    rooms: finalRooms,
    revisions,
    drafts,
    draftsAvailable,
    source: data && data.length > 0 ? "supabase" : "missing",
  };
}

export interface SaveRoomOptions {
  /** rooms.updated_at when this tab loaded/last saved the room. `null` = known
   *  not to be in the DB yet (insert). A string = optimistic-concurrency token.
   *  Omitted behaves like `force` (legacy callers). */
  expectedUpdatedAt?: string | null;
  /** Write even if someone else changed the row (the "Overwrite" choice). */
  force?: boolean;
}

export type SaveRoomResult = WriteResult & {
  /** The row's new updated_at after a successful save. */
  updatedAt?: string;
  /** On `code: "conflict"`: the other writer's updated_at. */
  theirsUpdatedAt?: string;
};

export async function saveRoom(
  config: RoomConfig,
  opts: SaveRoomOptions = {}
): Promise<SaveRoomResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  // Dual-write the legacy click fields from the steps (rollback safety).
  config = withLegacyInteractions(config);

  const force = !!opts.force || opts.expectedUpdatedAt === undefined;
  const now = new Date().toISOString();
  // iid lifts to the column so foreign-key joins (room_backups, future tables)
  // work without a JSON path query.
  const body = {
    iid: config.iid,
    config,
    schema_version: config.schemaVersion,
    updated_at: now,
  };
  // Placement columns are written ONLY when the row is first created: after
  // that the World map owns them (a room edit must not snap a room back to a
  // stale config.worldX/Y).
  const insertRow = () =>
    supabase
      .from("rooms")
      .insert({
        id: config.id,
        ...body,
        world_iid: config.worldIid,
        world_x: config.worldX,
        world_y: config.worldY,
        world_w: config.worldW,
        world_h: config.worldH,
      })
      .select("updated_at");

  let updatedAt: string | undefined;

  if (opts.expectedUpdatedAt === null && !opts.force) {
    const { data, error } = await insertRow();
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          code: "conflict",
          error: `Room "${config.id}" was created somewhere else.`,
        };
      }
      return writeErrorFor(supabase, error);
    }
    updatedAt = data?.[0]?.updated_at as string | undefined;
  } else {
    let q = supabase.from("rooms").update(body).eq("id", config.id);
    if (!force) q = q.eq("updated_at", opts.expectedUpdatedAt as string);
    const { data, error } = await q.select("updated_at");
    if (error) return writeErrorFor(supabase, error);

    if (data?.length) {
      updatedAt = data[0].updated_at as string;
    } else if (force) {
      // Overwrite of a row that doesn't exist (yet): create it.
      const ins = await insertRow();
      if (ins.error) return writeErrorFor(supabase, ins.error);
      updatedAt = ins.data?.[0]?.updated_at as string | undefined;
    } else {
      // 0 rows: session lapsed, row deleted, or someone else saved first.
      const denial = await denialFor(supabase);
      if (denial) return denial;
      const { data: cur, error: curErr } = await supabase
        .from("rooms")
        .select("updated_at")
        .eq("id", config.id)
        .maybeSingle();
      if (curErr) return writeErrorFor(supabase, curErr);
      if (!cur) {
        return {
          ok: false,
          code: "not_found",
          error: `Room "${config.id}" was deleted somewhere else.`,
        };
      }
      return {
        ok: false,
        code: "conflict",
        theirsUpdatedAt: cur.updated_at as string,
        error: `Room "${config.id}" was changed somewhere else.`,
      };
    }
  }

  // Best-effort backup — failure here doesn't fail the save.
  await recordRoomBackup(config);

  // External-files mirror. Write a parallel JSON file when
  // the world has the toggle on. Failures are logged but do not fail the
  // save — the DB write succeeded, which is what matters for play.
  const world = await loadDefaultWorld();
  if (world?.config?.externalFilesEnabled) {
    const fileRes = await writeRoomFile(world.id, config.id, config);
    if (!fileRes.ok) {
      console.warn(
        `[editorData] saveRoom: file mirror failed for ${config.id}: ${fileRes.error}`
      );
    }
  }

  return { ok: true, updatedAt };
}

export type SaveRoomDraftResult = WriteResult & {
  /** The draft row's new updated_at after a successful save. */
  updatedAt?: string;
  /** On `code: "conflict"`: the other writer's draft updated_at. */
  theirsUpdatedAt?: string;
};

/**
 * Save the room as its (single) draft. Mirrors saveRoom's optimistic
 * concurrency, with room_drafts.updated_at as the token:
 *   `expectedUpdatedAt: null`   no draft known yet → insert (23505 = conflict)
 *   `expectedUpdatedAt: string` update only if the draft is unchanged
 *   `force`                     upsert over whatever is there (the "Overwrite" choice)
 * `content`: the draft's full pop-up content map; `undefined` leaves the
 * column as it is (null = untouched = live rows apply on Publish).
 */
export async function saveRoomDraft(
  config: RoomConfig,
  opts: {
    expectedUpdatedAt: string | null;
    force?: boolean;
    content?: Record<string, ObjectContent> | null;
  }
): Promise<SaveRoomDraftResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  if (!config.iid) return { ok: false, error: `Room "${config.id}" has no iid yet.` };
  // Dual-write the legacy click fields from the steps (rollback safety).
  config = withLegacyInteractions(config);

  const now = new Date().toISOString();
  const body = {
    config,
    updated_at: now,
    ...(opts.content !== undefined ? { content: opts.content } : {}),
  };

  if (opts.force) {
    const { data, error } = await supabase
      .from("room_drafts")
      .upsert({ room_iid: config.iid, ...body }, { onConflict: "room_iid" })
      .select("updated_at");
    if (error) return writeErrorFor(supabase, error);
    return { ok: true, updatedAt: (data?.[0]?.updated_at as string | undefined) ?? now };
  }

  if (opts.expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from("room_drafts")
      .insert({ room_iid: config.iid, ...body })
      .select("updated_at");
    if (error) {
      if (error.code === "23505") {
        return {
          ok: false,
          code: "conflict",
          error: `Room "${config.id}" got a draft somewhere else.`,
        };
      }
      return writeErrorFor(supabase, error);
    }
    return { ok: true, updatedAt: (data?.[0]?.updated_at as string | undefined) ?? now };
  }

  const { data, error } = await supabase
    .from("room_drafts")
    .update(body)
    .eq("room_iid", config.iid)
    .eq("updated_at", opts.expectedUpdatedAt)
    .select("updated_at");
  if (error) return writeErrorFor(supabase, error);
  if (data?.length) return { ok: true, updatedAt: data[0].updated_at as string };

  // 0 rows: session lapsed, draft published/discarded elsewhere, or edited elsewhere.
  const denial = await denialFor(supabase);
  if (denial) return denial;
  const { data: cur, error: curErr } = await supabase
    .from("room_drafts")
    .select("updated_at")
    .eq("room_iid", config.iid)
    .maybeSingle();
  if (curErr) return writeErrorFor(supabase, curErr);
  return {
    ok: false,
    code: "conflict",
    theirsUpdatedAt: (cur?.updated_at as string | undefined) ?? undefined,
    error: cur
      ? `The draft of "${config.id}" was changed somewhere else.`
      : `The draft of "${config.id}" was published or discarded somewhere else.`,
  };
}

export type PublishRoomResult = WriteResult & {
  /** The live row's new updated_at after a successful publish. */
  updatedAt?: string;
  /** The live room changed since this tab last saw it (rename, restore, other tab). */
  liveChanged?: boolean;
  /** publish_room_draft isn't in the database (migration 20261005000001_room_drafts not applied). */
  unavailable?: boolean;
};

/**
 * Copy a room's draft over its live row, atomically (publish_room_draft).
 * `expectedLiveUpdatedAt`: the live token; a mismatch comes back as
 * `liveChanged`. Pass `null` to publish over whatever is live ("Publish anyway").
 */
export async function publishRoomDraft(
  roomIid: string,
  expectedLiveUpdatedAt: string | null
): Promise<PublishRoomResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const rpc = await supabase.rpc("publish_room_draft", {
    p_room_iid: roomIid,
    p_expected_live_updated_at: expectedLiveUpdatedAt,
  });
  if (!rpc.error) return { ok: true, updatedAt: rpc.data as string };
  if (rpc.error.code === "40001") {
    return {
      ok: false,
      code: "conflict",
      liveChanged: true,
      error: "The live room was changed somewhere else.",
    };
  }
  if (rpc.error.code === "P0002") {
    return {
      ok: false,
      code: "not_found",
      error: "There's no draft to publish (it may already be published or discarded).",
    };
  }
  if (rpc.error.code === "PGRST202") {
    return {
      ok: false,
      unavailable: true,
      error: "Publishing isn't set up on this database yet (migration 20261005000001_room_drafts.sql).",
    };
  }
  return writeErrorFor(supabase, rpc.error);
}

/** Delete a room's draft; the live room is untouched. */
export async function discardRoomDraft(roomIid: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const rpc = await supabase.rpc("discard_room_draft", { p_room_iid: roomIid });
  if (!rpc.error) return { ok: true };
  if (rpc.error.code === "P0002") {
    return { ok: false, code: "not_found", error: "There's no draft to discard." };
  }
  if (rpc.error.code === "PGRST202") {
    return { ok: false, error: "Drafts aren't set up on this database yet (migration 20261005000001_room_drafts.sql)." };
  }
  return writeErrorFor(supabase, rpc.error);
}

// ─── Worlds ───────────────────────────────
// A world wraps a set of rooms with a spatial layout + metadata. The schema
// supports multiple worlds; the current UI exposes only one — `id="main"`,
// created by `migrations/003_worlds.ts`.

interface WorldRow {
  iid: string;
  id: string;
  name: string;
  layout: WorldLayout;
  grid_width: number | null;
  grid_height: number | null;
  schema_version: number;
  config: WorldSettings | null;
}

const WORLD_SELECT =
  "iid, id, name, layout, grid_width, grid_height, schema_version, config";

function rowToWorld(row: WorldRow): WorldConfig {
  return {
    iid: row.iid,
    id: row.id,
    name: row.name,
    layout: row.layout,
    gridWidth: row.grid_width ?? undefined,
    gridHeight: row.grid_height ?? undefined,
    schemaVersion: row.schema_version,
    config: row.config ?? {},
  };
}

/**
 * Load every world. The UI currently shows only the first/default world;
 * returning the list keeps the API ready for the future world-picker.
 */
export async function loadWorlds(): Promise<WorldConfig[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("worlds")
    .select(WORLD_SELECT)
    .order("id", { ascending: true });

  if (error || !data) return [];
  return (data as WorldRow[]).map(rowToWorld);
}

/**
 * The LIVE world — the one the public game plays. A world is live when its
 * `config.live` is true (set by `setLiveWorld`); with none flagged, the
 * original `main` world is live, then the first world by slug.
 */
export async function loadDefaultWorld(): Promise<WorldConfig | null> {
  const worlds = await loadWorlds();
  return pickLiveWorld(worlds);
}

export function pickLiveWorld(worlds: WorldConfig[]): WorldConfig | null {
  return (
    worlds.find((w) => w.config?.live) ??
    worlds.find((w) => w.id === "main") ??
    worlds[0] ??
    null
  );
}

/** A world by slug, or null. */
export async function loadWorldById(id: string): Promise<WorldConfig | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("worlds")
    .select(WORLD_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToWorld(data as WorldRow);
}

/** Make one world the live one (what visitors play). */
export async function setLiveWorld(worldIid: string): Promise<WriteResult> {
  const worlds = await loadWorlds();
  if (!worlds.some((w) => w.iid === worldIid)) {
    return { ok: false, error: "World not found." };
  }
  // Flag the new one first so there's never a moment with no live world.
  const on = await saveWorld(worldIid, { config: { live: true } });
  if (!on.ok) return on;
  for (const w of worlds) {
    if (w.iid !== worldIid && w.config?.live) {
      const off = await saveWorld(w.iid, { config: { live: false } });
      if (!off.ok) return off;
    }
  }
  return { ok: true };
}

/**
 * Delete a world and every room in it (with their content, drawings and
 * sprites). Refuses the original `main` world and whichever world is live —
 * make another world live first.
 */
export type TrashResult = WriteResult & {
  /** deleted_items.id — pass to restoreDeletedItem() (the toast's Undo). */
  trashId?: string;
};

/**
 * Move a world and all its rooms to "Recently deleted" (trash_world, one
 * transaction). Falls back to the old permanent client-side delete when the
 * function isn't in the database yet (migration 20261005000002_trash_and_atomic_ops not applied).
 */
export async function deleteWorld(worldIid: string): Promise<TrashResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const worlds = await loadWorlds();
  const world = worlds.find((w) => w.iid === worldIid);
  if (!world) return { ok: false, error: "World not found." };
  if (world.id === "main") return { ok: false, error: "The main world can't be deleted." };
  if (pickLiveWorld(worlds)?.iid === worldIid) {
    return { ok: false, error: "This world is live — make another world live first." };
  }

  const rpc = await supabase.rpc("trash_world", { p_world_iid: worldIid });
  if (!rpc.error) return { ok: true, trashId: rpc.data as string };
  if (rpc.error.code === "P0001") {
    return {
      ok: false,
      error:
        rpc.error.message === "main_world"
          ? "The main world can't be deleted."
          : "This world is live — make another world live first.",
    };
  }
  if (rpc.error.code === "P0002") return noRowsResult(supabase, `World "${world.id}"`);
  if (rpc.error.code !== "PGRST202") return writeErrorFor(supabase, rpc.error);

  // PGRST202: no trash functions yet — the old steps (permanent).
  const { data: rows, error: listErr } = await supabase
    .from("rooms")
    .select("id")
    .eq("world_iid", worldIid);
  if (listErr) return { ok: false, error: listErr.message };
  for (const r of rows ?? []) {
    const res = await deleteRoomPermanently(r.id as RoomId);
    if (!res.ok) return { ok: false, error: `Room "${r.id}": ${res.error ?? "delete failed"}` };
  }
  const { data: gone, error } = await supabase
    .from("worlds")
    .delete()
    .eq("iid", worldIid)
    .select("iid");
  if (error) return writeErrorFor(supabase, error);
  if (!gone?.length) return noRowsResult(supabase, `World "${world.id}"`);
  return { ok: true };
}

export interface CreateWorldInput {
  id: string;
  name: string;
  layout?: WorldLayout;
  /** Also create one blank room and make it the start room. */
  starterRoom?: { id: string; name: string };
}

/** Create a world (optionally with a first room to shape). */
export async function createWorld(
  input: CreateWorldInput
): Promise<WriteResult & { world?: WorldConfig }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  if (!ROOM_SLUG_RE.test(input.id)) {
    return { ok: false, error: "Invalid slug. Use a-z, 0-9, _ or -." };
  }
  const iid = newIid();
  const { data, error } = await supabase
    .from("worlds")
    .insert({
      iid,
      id: input.id,
      name: input.name,
      layout: input.layout ?? "free",
      schema_version: 1,
      config: input.starterRoom ? { defaultRoomId: input.starterRoom.id } : {},
    })
    .select(WORLD_SELECT)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Create failed" };
  const world = rowToWorld(data as WorldRow);
  if (input.starterRoom) {
    const res = await createRoom({
      id: input.starterRoom.id,
      name: input.starterRoom.name,
      worldIid: world.iid,
    });
    if (!res.ok) {
      return { ok: false, error: `World created, but its first room failed: ${res.error}` };
    }
  }
  return { ok: true, world };
}

/**
 * Persist a partial patch onto a world row. Only the fields present in
 * `patch` are touched; existing values for the rest are preserved by reading
 * the row first when `config` (JSONB) is being merged.
 *
 * Matches the WriteResult convention used elsewhere in this file.
 */
export interface WorldPatch {
  name?: string;
  layout?: WorldLayout;
  gridWidth?: number | null;
  gridHeight?: number | null;
  /** Shallow-merged into the existing `worlds.config` JSONB. */
  config?: Partial<WorldSettings>;
}

export async function saveWorld(
  worldIid: string,
  patch: WorldPatch
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.layout !== undefined) row.layout = patch.layout;
  if (patch.gridWidth !== undefined) row.grid_width = patch.gridWidth;
  if (patch.gridHeight !== undefined) row.grid_height = patch.gridHeight;

  // For `config` we shallow-merge so callers don't need to round-trip the
  // whole settings object just to flip one toggle. Read the current value
  // first; if the row vanished mid-flight (extremely unlikely) bail.
  if (patch.config !== undefined) {
    const { data, error } = await supabase
      .from("worlds")
      .select("config")
      .eq("iid", worldIid)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    const current = ((data?.config ?? {}) as WorldSettings) || {};
    row.config = { ...current, ...patch.config };
  }

  const { data: updated, error } = await supabase
    .from("worlds")
    .update(row)
    .eq("iid", worldIid)
    .select("iid");
  if (error) return writeErrorFor(supabase, error);
  if (!updated?.length) return noRowsResult(supabase, "This world");
  return { ok: true };
}

/**
 * Per-room positioning row, projected from the `rooms` table columns
 * (NOT from `rooms.config`). The WorldView reads these to lay out room cards.
 */
export interface RoomWorldPlacement {
  id: RoomId;
  iid: string | null;
  worldIid: string | null;
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
  name: string | null;
  bgMiddleUrl: string | null;
}

export async function listRoomsInWorld(
  worldIid: string
): Promise<RoomWorldPlacement[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("rooms")
    .select("id, iid, world_iid, world_x, world_y, world_w, world_h, config")
    .eq("world_iid", worldIid)
    .order("id", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => {
    const cfg = (row.config ?? {}) as Partial<RoomConfig>;
    return {
      id: row.id as RoomId,
      iid: (row.iid as string | null) ?? null,
      worldIid: (row.world_iid as string | null) ?? null,
      worldX: (row.world_x as number | null) ?? 0,
      worldY: (row.world_y as number | null) ?? 0,
      worldW: (row.world_w as number | null) ?? ROOM_WIDTH,
      worldH: (row.world_h as number | null) ?? ROOM_HEIGHT,
      name: cfg.name ?? null,
      bgMiddleUrl: cfg.bgMiddleUrl ?? null,
    };
  });
}

/**
 * Persist a room's world position. Updates only the four positioning
 * columns — leaves `config` untouched so an in-flight room edit isn't
 * overwritten. Used by the WorldView drag-end handler.
 */
export async function updateRoomPlacement(
  roomId: RoomId,
  patch: Partial<Pick<RoomWorldPlacement, "worldX" | "worldY" | "worldW" | "worldH">>
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const row: Record<string, unknown> = {};
  if (patch.worldX !== undefined) row.world_x = Math.round(patch.worldX);
  if (patch.worldY !== undefined) row.world_y = Math.round(patch.worldY);
  if (patch.worldW !== undefined) row.world_w = Math.round(patch.worldW);
  if (patch.worldH !== undefined) row.world_h = Math.round(patch.worldH);

  if (Object.keys(row).length === 0) return { ok: true };

  const { data: updated, error } = await supabase
    .from("rooms")
    .update(row)
    .eq("id", roomId)
    .select("id");
  if (error) return writeErrorFor(supabase, error);
  if (!updated?.length) return noRowsResult(supabase, `Room "${roomId}"`);
  return { ok: true };
}

export interface CreateRoomInput {
  /** Required slug — unique. */
  id: RoomId;
  name: string;
  /** Default position in the world; WorldView lets you drag afterwards. */
  worldX?: number;
  worldY?: number;
  /**
   * Optional source room to copy `config` from (template duplication).
   * When omitted, a minimal blank room is used.
   */
  copyFromRoomId?: RoomId;
  /** World to create the room in. Defaults to the live world. */
  worldIid?: string;
}

/**
 * Create a new room row. Mints a fresh iid for the room, places it in the
 * default ("main") world. Returns the new row's iid so the caller can
 * navigate or refresh.
 */
export async function createRoom(
  input: CreateRoomInput
): Promise<WriteResult & { roomIid?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const world = input.worldIid
    ? (await loadWorlds()).find((w) => w.iid === input.worldIid) ?? null
    : await loadDefaultWorld();
  if (!world) {
    return {
      ok: false,
      error: "World not found — run migrations/003_worlds.ts or create a world.",
    };
  }

  // Source config: clone an existing room's JSONB if asked, else a blank.
  let baseConfig: RoomConfig | null = null;
  if (input.copyFromRoomId) {
    const src = await loadRoomForEditor(input.copyFromRoomId);
    baseConfig = src.config;
  }

  // Read world-level defaults so a project that prefers larger rooms gets
  // them on creation. Fall back to the constants for backwards compatibility.
  const defaultW = world.config?.defaultRoomWidth ?? ROOM_WIDTH;
  const defaultH = world.config?.defaultRoomHeight ?? ROOM_HEIGHT;
  const defaultFx = world.config?.defaultForegroundEffect ?? null;

  const roomIid = newIid();
  const config: RoomConfig = baseConfig
    ? {
        ...baseConfig,
        id: input.id,
        name: input.name,
        iid: roomIid,
        worldIid: world.iid,
        worldX: input.worldX ?? 0,
        worldY: input.worldY ?? 0,
        worldW: baseConfig.worldW ?? defaultW,
        worldH: baseConfig.worldH ?? defaultH,
        // Fresh iids on every cloned object/entry-point so links don't
        // collide with the source room.
        objects: baseConfig.objects?.map((o) => ({ ...o, iid: newIid() })) ?? [],
        entryPoints:
          baseConfig.entryPoints?.map((e) => ({ ...e, iid: newIid() })) ?? [],
      }
    : {
        iid: roomIid,
        id: input.id,
        name: input.name,
        nameAr: "",
        description: "",
        descriptionAr: "",
        backgroundColor: "#1a1a2e",
        width: defaultW,
        height: defaultH,
        walkableArea: {
          polygon: [
            { x: 0, y: Math.round(defaultH * 0.625) },
            { x: defaultW, y: Math.round(defaultH * 0.625) },
            { x: defaultW, y: defaultH },
            { x: 0, y: defaultH },
          ],
        },
        entryPoints: [
          {
            iid: newIid(),
            id: "default",
            x: defaultW / 2,
            y: Math.round(defaultH * 0.83),
            direction: "right",
          },
        ],
        objects: [],
        foregroundEffect: defaultFx,
        worldIid: world.iid,
        worldX: input.worldX ?? 0,
        worldY: input.worldY ?? 0,
        worldW: defaultW,
        worldH: defaultH,
      };

  const { error } = await supabase.from("rooms").insert({
    id: input.id,
    iid: roomIid,
    config,
    world_iid: world.iid,
    world_x: input.worldX ?? 0,
    world_y: input.worldY ?? 0,
    world_w: config.worldW ?? defaultW,
    world_h: config.worldH ?? defaultH,
    updated_at: new Date().toISOString(),
  });

  if (error) return writeErrorFor(supabase, error);

  // "Copy from" also copies each object's popup content, so the copy is a
  // working room rather than a set of empty shells. Best-effort.
  if (input.copyFromRoomId) {
    const { data: rows } = await supabase
      .from("object_content")
      .select("object_id, content")
      .eq("room_id", input.copyFromRoomId);
    if (rows?.length) {
      const now = new Date().toISOString();
      const { error: copyErr } = await supabase.from("object_content").upsert(
        rows.map((r) => ({
          object_id: r.object_id,
          room_id: input.id,
          content: { ...(r.content as ObjectContent), roomId: input.id },
          updated_at: now,
        })),
        { onConflict: "object_id,room_id" }
      );
      if (copyErr) console.warn("[createRoom] copying content failed", copyErr.message);
    }
  }

  return { ok: true, roomIid };
}

/**
 * Delete a room row and its associated content/sprite/scene rows. Does NOT
 * cascade-delete templates. Caller is responsible for confirming with the
 * user (the WorldView shows an inbound-door count first).
 */
/**
 * Move a room (with its content, drawings, sprites, history and draft) to
 * "Recently deleted" (trash_room, one transaction). Falls back to the old
 * permanent client-side delete when the function isn't in the database yet
 * (migration 20261005000002_trash_and_atomic_ops not applied).
 */
export async function deleteRoom(roomId: RoomId): Promise<TrashResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const rpc = await supabase.rpc("trash_room", { p_room_id: roomId });
  if (!rpc.error) return { ok: true, trashId: rpc.data as string };
  if (rpc.error.code === "P0001") {
    return {
      ok: false,
      error: `"${roomId}" is the start room of the live world. Pick another start room first.`,
    };
  }
  if (rpc.error.code === "P0002") return noRowsResult(supabase, `Room "${roomId}"`);
  if (rpc.error.code !== "PGRST202") return writeErrorFor(supabase, rpc.error);
  return deleteRoomPermanently(roomId);
}

/** The pre-trash delete: several requests, no undo. Only used until migration 20261005000002_trash_and_atomic_ops is applied. */
async function deleteRoomPermanently(roomId: RoomId): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Best-effort cleanup of dependent rows; ignore individual failures so the
  // room row itself still gets removed (the orphaned rows are harmless).
  for (const table of ["object_content", "drawing_scenes", "sprites"] as const) {
    const { error: depErr } = await supabase.from(table).delete().eq("room_id", roomId);
    if (depErr) console.warn(`[deleteRoom] cleaning ${table} failed`, depErr.message);
  }

  const { data: gone, error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", roomId)
    .select("id");
  if (error) return writeErrorFor(supabase, error);
  if (!gone?.length) return noRowsResult(supabase, `Room "${roomId}"`);
  return { ok: true };
}

// ─── Slug rename ─────────────────
// Renaming a room used to leave stale `targetRoomId` slug strings on every
// inbound door. The iid resolved fine; the slug rotted. `renameRoom` walks
// every room in the world, rewrites those slugs, then updates the room row
// itself last (so concurrent reads always see matching slug+iid). When
// external files are on, the room file is moved on disk too and every
// touched neighbour file is re-written.

const ROOM_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export interface RenameRoomResult extends WriteResult {
  /** Number of inbound doors whose `targetRoomId` was rewritten. */
  doorsUpdated?: number;
}

export async function renameRoom(
  roomIid: string,
  oldSlug: string,
  newSlug: string
): Promise<RenameRoomResult> {
  if (!ROOM_SLUG_RE.test(newSlug)) {
    return {
      ok: false,
      error: `Invalid slug. Use a-z, 0-9, _ or - and start with a letter or digit.`,
    };
  }
  if (oldSlug === newSlug) return { ok: true, doorsUpdated: 0 };

  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Refuse to clobber an existing room.
  const { data: collision } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", newSlug)
    .maybeSingle();
  if (collision) {
    return { ok: false, error: `A room with slug "${newSlug}" already exists.` };
  }

  // Pull every room so we can rewrite stale `targetRoomId` slugs on inbound
  // doors. The iid resolution was already correct — this just keeps the
  // legacy fallback path honest and stops `door-stale-slug` warnings from
  // firing the moment you rename.
  const { data: allRows, error: loadErr } = await supabase
    .from("rooms")
    .select("id, iid, config, updated_at");
  if (loadErr) return { ok: false, error: loadErr.message };

  const touchedNeighbours: { id: string; config: RoomConfig; updatedAt: string | null }[] = [];
  let doorsUpdated = 0;

  for (const row of allRows ?? []) {
    const cfg = row.config as RoomConfig;
    if (!cfg?.objects?.length) continue;
    const n = rewriteInboundDoors(cfg, roomIid, oldSlug, newSlug);
    doorsUpdated += n;
    const mutated = n > 0;
    if (mutated && row.id !== oldSlug) {
      // Don't queue the renamed room itself — it gets a separate write below.
      touchedNeighbours.push({
        id: row.id as string,
        config: cfg,
        updatedAt: (row.updated_at as string | null) ?? null,
      });
    }
  }

  const selfRow = (allRows ?? []).find((r) => r.id === oldSlug);
  if (!selfRow) {
    return { ok: false, error: `Room "${oldSlug}" not found.` };
  }
  // The copy whose self-targeting doors were rewritten above (if any); the
  // JSONB `id` must match the new row id.
  const selfCfg = { ...(selfRow.config as RoomConfig), id: newSlug } as RoomConfig;

  const world = await loadDefaultWorld();

  // Drafts hold their own copies of the doors: without this, publishing a
  // neighbour's draft would bring the old slug back. Sent as extra
  // `kind: "draft"` entries (migration 20261006000001_history_kind_trash_pointers_draft_renames). Only when that migration is in:
  // the older function would read them as ROOM entries and overwrite the live
  // config with the draft.
  const draftEntries: { kind: "draft"; id: string; expected_updated_at: string | null; config: RoomConfig }[] = [];
  if (await backupKindSupported(supabase)) {
    const slugByIid = new Map<string, string>();
    for (const row of allRows ?? []) {
      if (row.iid) slugByIid.set(row.iid as string, row.id as string);
    }
    const { data: draftRows, error: draftErr } = await supabase
      .from("room_drafts")
      .select("room_iid, config, updated_at");
    // Table missing (migration 20261005000001_room_drafts not applied) = no drafts to carry.
    if (draftErr && draftErr.code !== "42P01" && draftErr.code !== "PGRST205") {
      return { ok: false, error: `Couldn't read drafts: ${draftErr.message}` };
    }
    for (const d of draftRows ?? []) {
      const slug = slugByIid.get(d.room_iid as string);
      if (!slug) continue;
      const cfg = d.config as RoomConfig;
      if (rewriteInboundDoors(cfg, roomIid, oldSlug, newSlug) === 0) continue;
      if (slug === oldSlug) cfg.id = newSlug;
      draftEntries.push({
        kind: "draft",
        id: slug,
        expected_updated_at: (d.updated_at as string | null) ?? null,
        config: cfg,
      });
    }
  }

  // One transaction: every token is checked first (nothing changes if a room
  // moved on since the read above), then the neighbour doors, the id change,
  // the content/drawing/sprite re-key and the world's start room all apply
  // together. Migration 20261005000002_trash_and_atomic_ops (rename_room_atomic).
  const rpc = await supabase.rpc("rename_room_atomic", {
    p_room_iid: roomIid,
    p_new_slug: newSlug,
    p_updates: [
      ...touchedNeighbours.map((n) => ({
        id: n.id,
        expected_updated_at: n.updatedAt,
        config: n.config,
      })),
      {
        id: oldSlug,
        expected_updated_at: (selfRow.updated_at as string | null) ?? null,
        config: selfCfg,
      },
      ...draftEntries,
    ],
  });
  if (rpc.error) {
    if (rpc.error.code === "40001") {
      return {
        ok: false,
        code: "conflict",
        error: "A room changed while you were renaming (another tab?). Nothing was renamed. Reload and try again.",
      };
    }
    if (rpc.error.code === "23505") {
      return { ok: false, error: `A room with slug "${newSlug}" already exists.` };
    }
    if (rpc.error.code === "P0002") return noRowsResult(supabase, `Room "${oldSlug}"`);
    if (rpc.error.code === "P0001") {
      return { ok: false, error: `Invalid slug "${newSlug}".` };
    }
    if (rpc.error.code !== "PGRST202") return writeErrorFor(supabase, rpc.error);

    // PGRST202: the function isn't there yet (migration 20261005000002_trash_and_atomic_ops not applied) — the
    // old client-side steps, with their row checks.

    // Write neighbours first; if any of these fail we abort BEFORE the rename
    // so doors don't end up pointing at a slug that doesn't exist yet.
    for (const n of touchedNeighbours) {
      const { data: upd, error } = await supabase
        .from("rooms")
        .update({ config: n.config, updated_at: new Date().toISOString() })
        .eq("id", n.id)
        .select("id");
      if (error) {
        const r = await writeErrorFor(supabase, error);
        return { ...r, error: `Updating ${n.id}: ${r.error}` };
      }
      if (!upd?.length) return noRowsResult(supabase, `Room "${n.id}"`);
    }

    // Update the room's own row: change `id` AND rewrite `config.id` so the
    // JSONB shape matches.
    const { data: renamed, error: renameErr } = await supabase
      .from("rooms")
      .update({ id: newSlug, config: selfCfg, updated_at: new Date().toISOString() })
      .eq("id", oldSlug)
      .select("id");
    if (renameErr) return writeErrorFor(supabase, renameErr);
    if (!renamed?.length) return noRowsResult(supabase, `Room "${oldSlug}"`);

    // Rows keyed by the room SLUG follow the rename — otherwise every popup's
    // content and every saved drawing silently disappeared from the room.
    // Best-effort per table: the room itself is already renamed.
    for (const table of ["object_content", "drawing_scenes", "sprites"] as const) {
      const { error } = await supabase
        .from(table)
        .update({ room_id: newSlug })
        .eq("room_id", oldSlug);
      if (error) console.warn(`[renameRoom] moving ${table} rows failed`, error.message);
    }

    // Keep the world's start room pointing at it.
    if (world?.config?.defaultRoomId === oldSlug) {
      await saveWorld(world.iid, { config: { defaultRoomId: newSlug } });
    }
  }

  // Mirror to filesystem when external files are on. Best-effort: a file
  // failure logs but doesn't undo the DB rename — the file can be
  // re-exported via Project Settings if it goes out of sync.
  if (world?.config?.externalFilesEnabled) {
    try {
      await fetch("/api/editor/world-file", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldSlug: world.id,
          oldRoomSlug: oldSlug,
          newRoomSlug: newSlug,
        }),
      });
      // Re-write the renamed room's file so the inner `id` matches the new
      // filename, and re-write any neighbour whose doors changed.
      await writeRoomFile(world.id, newSlug, selfCfg);
      for (const n of touchedNeighbours) {
        await writeRoomFile(world.id, n.id, n.config);
      }
    } catch (e) {
      console.warn("[renameRoom] file mirror failed", e);
    }
  }

  return { ok: true, doorsUpdated };
}

// ─── Reset world to seed ─────────
// Destructive escape hatch for safe experimentation. Wipes every room in the
// world and re-inserts the static seed so the user can blow up their copy
// without fear of losing the canonical layout. When external files are on,
// the JSON files are overwritten too (and any room file not in the seed is
// orphaned in place — we don't delete files we didn't create here).

export interface ResetWorldResult extends WriteResult {
  /** How many rooms were re-seeded. */
  seeded?: number;
  /** How many existing rows were deleted. */
  deleted?: number;
}

export async function resetWorldToSeed(
  worldIid: string
): Promise<ResetWorldResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Resolve the world so we can mirror to files (if enabled) and stamp the
  // re-seeded rows with the right world_iid.
  const { data: worldRow, error: wErr } = await supabase
    .from("worlds")
    .select("iid, id, config")
    .eq("iid", worldIid)
    .maybeSingle();
  if (wErr) return { ok: false, error: wErr.message };
  if (!worldRow) return { ok: false, error: "World not found." };
  const worldSlug = worldRow.id as string;
  // The seed rooms have fixed slugs ("home", "gallery", …) and room slugs are
  // globally unique — re-seeding any other world would overwrite the main
  // world's rooms of the same name.
  if (worldSlug !== "main") {
    return {
      ok: false,
      error: "Reset to seed only applies to the original \"main\" world.",
    };
  }
  const externalFilesEnabled = Boolean(
    (worldRow.config as { externalFilesEnabled?: boolean } | null)
      ?.externalFilesEnabled
  );

  // Wipe every room (and its dependents) in this world. Same cleanup pattern
  // as `deleteRoom` but batched. We snapshot the IDs first so the dependent
  // table deletes use exact slugs (cheaper than relying on FK cascade).
  const { data: existingRows, error: eErr } = await supabase
    .from("rooms")
    .select("id")
    .eq("world_iid", worldIid);
  if (eErr) return { ok: false, error: eErr.message };

  const existingIds = (existingRows ?? []).map((r) => r.id as string);
  if (existingIds.length > 0) {
    for (const table of ["object_content", "drawing_scenes", "sprites"] as const) {
      const { error: depErr } = await supabase
        .from(table)
        .delete()
        .in("room_id", existingIds);
      if (depErr) console.warn(`[resetWorldToSeed] cleaning ${table} failed`, depErr.message);
    }
    const { data: wiped, error: delErr } = await supabase
      .from("rooms")
      .delete()
      .eq("world_iid", worldIid)
      .select("id");
    if (delErr) return writeErrorFor(supabase, delErr);
    if (!wiped?.length) return noRowsResult(supabase, "The world's rooms");
  }

  // Re-insert each seed room. Stamp with the live worldIid so they belong to
  // this world rather than the seed's expected one (which may be a different
  // UUID after a fresh setup).
  const seedRooms = Object.values(staticWorld.rooms);
  let seeded = 0;
  for (const seed of seedRooms) {
    const config: RoomConfig = {
      ...seed,
      worldIid,
    };
    const res = await saveRoom(config, { force: true });
    if (res.ok) seeded++;
    else {
      return {
        ok: false,
        error: `Reseed failed at "${seed.id}": ${res.error}`,
        seeded,
        deleted: existingIds.length,
      };
    }
  }

  // saveRoom() already mirrors to files when the toggle is on, so we're done
  // — no extra file pass needed. Stale files for rooms not in the seed are
  // intentionally left alone (the user can `git clean` if they want them
  // gone).
  void externalFilesEnabled; // documented for grep; behaviour is implicit
  return { ok: true, seeded, deleted: existingIds.length };
}

// ─── DB ↔ file drift detection ───
// Returns one entry per room currently in the DB so the FileConflictBanner
// can compare timestamps. Cheap (one round-trip, two columns).

export interface RoomTimestamp {
  id: string;
  updatedAt: string | null;
  lastFileWriteAt: string | null;
}

/** id → rooms.updated_at for every DB room (refreshing saveRoom tokens). */
export async function loadRoomRevisions(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data, error } = await supabase.from("rooms").select("id, updated_at");
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.updated_at) out[row.id as string] = row.updated_at as string;
  }
  return out;
}

export async function loadRoomTimestamps(): Promise<RoomTimestamp[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rooms")
    .select("id, updated_at, last_file_write_at");
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    updatedAt: (row.updated_at as string | null) ?? null,
    lastFileWriteAt: (row.last_file_write_at as string | null) ?? null,
  }));
}

// ─── External world files ───────────────
// Mirror each room's JSONB to app/world/{worldSlug}/rooms/{roomSlug}.json so
// level state lives in git alongside code. Two-way: file wins on load when
// the toggle is on; saves write to both.

export interface ExportAllResult extends WriteResult {
  written: number;
}

/**
 * Walk every room currently in the DB and POST each to the world-file API.
 * Bootstrap helper run once after enabling external files; subsequent saves
 * keep the files in sync automatically.
 */
export async function exportAllRoomsToFiles(
  worldSlug: string
): Promise<ExportAllResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, written: 0, error: "Supabase not configured." };
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("id, config");
  if (error) return { ok: false, written: 0, error: error.message };
  if (!data?.length) return { ok: true, written: 0 };

  let written = 0;
  const failures: string[] = [];
  for (const row of data) {
    const cfg = row.config as RoomConfig;
    const res = await writeRoomFile(worldSlug, row.id as string, cfg);
    if (res.ok) written++;
    else failures.push(`${row.id}: ${res.error}`);
  }

  if (failures.length) {
    return {
      ok: false,
      written,
      error: failures.slice(0, 3).join("; ") + (failures.length > 3 ? "…" : ""),
    };
  }
  return { ok: true, written };
}

/** POST a single room's config to the world-file API. */
export async function writeRoomFile(
  worldSlug: string,
  roomSlug: string,
  config: RoomConfig
): Promise<WriteResult> {
  try {
    const res = await fetch("/api/editor/world-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worldSlug, roomSlug, config }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    // Stamp the row so the conflict banner can tell
    // "DB updated_at > last_file_write_at = drift." Best-effort: a stamp
    // failure doesn't fail the file write (the file is on disk; the worst
    // case is the next conflict scan flags a false positive).
    const supabase = getSupabaseClient();
    if (supabase) {
      const stampErr = await supabase
        .from("rooms")
        .update({ last_file_write_at: new Date().toISOString() })
        .eq("id", roomSlug);
      if (stampErr.error) {
        console.warn(
          `[editorData] writeRoomFile: stamp failed for ${roomSlug}: ${stampErr.error.message}`
        );
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** GET every room's JSON file for a world, returning a slug → config map. */
export async function readWorldFiles(
  worldSlug: string
): Promise<Record<string, RoomConfig>> {
  try {
    const res = await fetch(
      `/api/editor/world-file?worldSlug=${encodeURIComponent(worldSlug)}`
    );
    if (!res.ok) return {};
    const body = (await res.json()) as { rooms?: Record<string, RoomConfig> };
    return body.rooms ?? {};
  } catch {
    return {};
  }
}

/**
 * Overlay file rooms over DB rooms with file-wins semantics, applying
 * `coerceRoomConfig` to every overlaid value. Pure (no I/O) so both editor
 * and runtime can call it after they've fetched their two sources.
 *
 * Extracted from `loadAllRoomsForEditor` so
 * `gameData.loadAllRoomConfigs` can share the same merge — keeping editor
 * and runtime in lockstep on what "what plays" means when external files
 * are on.
 */
export function mergeFileAndDbRooms(
  dbRooms: Record<string, RoomConfig>,
  fileRooms: Record<string, RoomConfig>
): Record<string, RoomConfig> {
  const merged: Record<string, RoomConfig> = { ...dbRooms };
  for (const [slug, cfg] of Object.entries(fileRooms)) {
    merged[slug] = coerceRoomConfig(cfg);
  }
  return merged;
}

// ─── Backups ────────────────────────────

/** Why a History snapshot exists. Rows from before migration 20261006000001_history_kind_trash_pointers_draft_renames have none ("saved"). */
export type RoomBackupKind = "saved" | "named" | "before_publish";

export interface RoomBackupRow {
  id: string;
  roomIid: string;
  config: RoomConfig;
  savedAt: string;
  label: string | null;
  isPinned: boolean;
  kind: RoomBackupKind;
}

// room_backups.kind arrived with migration 20261006000001_history_kind_trash_pointers_draft_renames. Detected once per session:
// a missing column (42703 / PGRST204) means "write and read the old shape".
let backupKindSupport: boolean | null = null;

async function backupKindSupported(supabase: SupabaseClient): Promise<boolean> {
  if (backupKindSupport !== null) return backupKindSupport;
  const { error } = await supabase.from("room_backups").select("kind").limit(1);
  if (!error) return (backupKindSupport = true);
  if (isMissingColumn(error)) return (backupKindSupport = false);
  return false; // unknown (offline, RLS…): don't cache, behave as the old shape
}

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" ||
    error.code === "PGRST204" ||
    (/kind/.test(error.message ?? "") && /column/.test(error.message ?? ""));
}

/** List backups for a room, newest first. Pinned versions are never pruned. */
export async function listRoomBackups(
  roomIid: string,
  limit = 80
): Promise<RoomBackupRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const withKind = await backupKindSupported(supabase);
  const { data, error } = await supabase
    .from("room_backups")
    .select(
      withKind
        ? "id, room_iid, config, saved_at, label, is_pinned, kind"
        : "id, room_iid, config, saved_at, label, is_pinned"
    )
    .eq("room_iid", roomIid)
    .order("saved_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    roomIid: r.room_iid as string,
    config: r.config as RoomConfig,
    savedAt: r.saved_at as string,
    label: (r.label as string | null) ?? null,
    isPinned: (r.is_pinned as boolean) ?? false,
    kind: (r.kind as RoomBackupKind | null | undefined) ?? "saved",
  }));
}

/**
 * Load a single backup config to load into the editor. Does NOT auto-save
 * — the caller flips `isDirty=true` so the user must commit.
 */
export async function restoreRoomBackup(
  backupId: string
): Promise<RoomConfig | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("room_backups")
    .select("config")
    .eq("id", backupId)
    .maybeSingle();

  if (error || !data) return null;
  return coerceRoomConfig(data.config as RoomConfig);
}

const BACKUP_KEEP_PER_ROOM = 20;

/** Insert a backup row for a room and prune to the most recent N. */
export async function recordRoomBackup(
  config: RoomConfig
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  if (!config.iid) return { ok: true }; // No iid yet — first save mints one.

  // A direct live save: tagged "saved" (Publish tags its own in the database).
  const { error: insertErr } = await supabase
    .from("room_backups")
    .insert(
      (await backupKindSupported(supabase))
        ? { room_iid: config.iid, config, kind: "saved" }
        : { room_iid: config.iid, config }
    );
  if (insertErr) return writeErrorFor(supabase, insertErr);

  // Prune: keep the most recent N unpinned rows. Pinned (named) versions are
  // exempt from the rolling window — only auto-backups are pruned.
  const { data: all } = await supabase
    .from("room_backups")
    .select("id, saved_at, is_pinned")
    .eq("room_iid", config.iid)
    .order("saved_at", { ascending: false });

  if (all && all.length > BACKUP_KEEP_PER_ROOM) {
    const unpinned = all.filter((r) => !r.is_pinned);
    const toDrop = unpinned
      .slice(BACKUP_KEEP_PER_ROOM)
      .map((r) => r.id as string);
    if (toDrop.length) {
      const { error: pruneErr } = await supabase
        .from("room_backups")
        .delete()
        .in("id", toDrop);
      if (pruneErr) console.warn("[recordRoomBackup] prune failed", pruneErr.message);
    }
  }

  return { ok: true };
}

/** Create a pinned (named) version — never subject to the auto-prune window. */
export async function createNamedVersion(
  config: RoomConfig,
  label: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  if (!config.iid) return { ok: false, error: "Room has no iid yet — save once first." };

  const { error } = await supabase
    .from("room_backups")
    .insert(
      (await backupKindSupported(supabase))
        ? { room_iid: config.iid, config, label, is_pinned: true, kind: "named" }
        : { room_iid: config.iid, config, label, is_pinned: true }
    );

  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

/** Rename a backup or change its pinned status. Pass label=null to clear. */
export async function updateBackupLabel(
  backupId: string,
  label: string | null,
  isPinned: boolean
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data: updated, error } = await supabase
    .from("room_backups")
    .update({ label, is_pinned: isPinned })
    .eq("id", backupId)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!updated?.length) return noRowsResult(supabase, "This version");
  return { ok: true };
}

/**
 * Activate a named version as the live room:
 * 1. Auto-backup current live state (revertible, unpinned).
 * 2. Fetch the named version's config.
 * 3. Save it as the live room via the existing saveRoom path.
 * Returns the activated config so the caller can update editor store.
 */
export async function activateNamedVersion(
  backupId: string,
  currentLiveConfig: RoomConfig
): Promise<WriteResult & { config?: RoomConfig; updatedAt?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Step 1: snapshot current state before overwriting
  const snapResult = await recordRoomBackup(currentLiveConfig);
  if (!snapResult.ok) {
    return { ok: false, error: `Pre-activation backup failed: ${snapResult.error}` };
  }

  // Step 2: fetch the named version's config
  const { data, error } = await supabase
    .from("room_backups")
    .select("config")
    .eq("id", backupId)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Could not load named version." };
  const namedConfig = coerceRoomConfig(data.config as RoomConfig);

  // Step 3: save as the live room (same path as a normal editor save)
  // force: activating an old version is an explicit overwrite, and the live
  // state was snapshotted in step 1. The new token comes back in `updatedAt`.
  const saveResult = await saveRoom(namedConfig, { force: true });
  if (!saveResult.ok) {
    return { ok: false, error: `Live save failed: ${saveResult.error}` };
  }

  return { ok: true, config: namedConfig, updatedAt: saveResult.updatedAt };
}

// ─── Drawing Scenes ─────────────────────────────────────────
// Persisted Klecks PSDs — one per editable target. The PNG remains the
// canonical render shipped to players; the PSD is the editing source so
// the user can reopen the studio with layers + history intact.
//
// target_kind = 'object'     → target_id is the RoomObject.id
// target_kind = 'background' → target_id is one of:
//   'background_back' | 'background_middle' | 'background_front'
//
// Storage layout: PSDs live in the private `drawing-scenes` bucket at
//   {roomId}/{targetKind}/{targetId}.psd
//
// Legacy: rows written by the old tldraw editor have `snapshot` (JSONB)
// populated and `psd_path` NULL — they're abandoned in place; the next
// save in Klecks writes a PSD and leaves snapshot NULL.

const DRAWING_SCENES_BUCKET = "drawing-scenes";

export type DrawingSceneTargetKind = "object" | "background";

export interface DrawingSceneRow {
  /** Storage path inside the `drawing-scenes` bucket. Null on legacy rows. */
  psdPath: string | null;
  updatedAt: string;
}

function psdStoragePath(
  roomId: string,
  targetKind: DrawingSceneTargetKind,
  targetId: string
): string {
  return `${roomId}/${targetKind}/${targetId}.psd`;
}

export async function loadDrawingScene(
  roomId: string,
  targetKind: DrawingSceneTargetKind,
  targetId: string
): Promise<DrawingSceneRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("drawing_scenes")
    .select("psd_path, updated_at")
    .eq("room_id", roomId)
    .eq("target_kind", targetKind)
    .eq("target_id", targetId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    psdPath: (data.psd_path as string | null) ?? null,
    updatedAt: data.updated_at as string,
  };
}

/**
 * Fetch the saved PSD for a target (if any). Returns the raw bytes ready to
 * hand to Klecks's `readPSD()`. Null when no PSD has been saved (legacy row
 * or fresh target).
 */
export async function loadDrawingScenePsd(
  roomId: string,
  targetKind: DrawingSceneTargetKind,
  targetId: string
): Promise<ArrayBuffer | null> {
  const row = await loadDrawingScene(roomId, targetKind, targetId);
  if (!row?.psdPath) return null;

  const res = await fetch("/api/editor/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket: DRAWING_SCENES_BUCKET, path: row.psdPath }),
  });
  if (!res.ok) return null;

  const { signedUrl } = (await res.json()) as { signedUrl?: string };
  if (!signedUrl) return null;

  const psdRes = await fetch(signedUrl);
  if (!psdRes.ok) return null;
  return await psdRes.arrayBuffer();
}

/**
 * Upload a PSD blob for a target. Routes through /api/editor/upload (which
 * uses the service-role client) because the `drawing-scenes` bucket is
 * private and owner-gated.
 */
export async function uploadDrawingScenePsd(
  roomId: string,
  targetKind: DrawingSceneTargetKind,
  targetId: string,
  blob: Blob
): Promise<{ path: string } | null> {
  const path = psdStoragePath(roomId, targetKind, targetId);
  const formData = new FormData();
  formData.append("file", blob, `${targetId}.psd`);
  formData.append("bucket", DRAWING_SCENES_BUCKET);
  formData.append("path", path);

  const res = await fetch("/api/editor/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    noteForbiddenResponse(res);
    return null;
  }
  const { path: storedPath } = (await res.json()) as { path?: string };
  return storedPath ? { path: storedPath } : null;
}

export async function saveDrawingScene(
  roomId: string,
  targetKind: DrawingSceneTargetKind,
  targetId: string,
  psdPath: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { error } = await supabase.from("drawing_scenes").upsert(
    {
      room_id: roomId,
      target_kind: targetKind,
      target_id: targetId,
      psd_path: psdPath,
      // Null out the legacy snapshot so a future migration could drop the
      // column without losing meaningful data.
      snapshot: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "room_id,target_kind,target_id" }
  );

  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

export async function deleteDrawingScene(
  roomId: string,
  targetKind: DrawingSceneTargetKind,
  targetId: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Best-effort: remove the PSD object first so we don't orphan it. The
  // browser client doesn't have access to the private bucket — ignore the
  // result; the PSD will be overwritten on next save anyway.
  await supabase.storage
    .from(DRAWING_SCENES_BUCKET)
    .remove([psdStoragePath(roomId, targetKind, targetId)])
    .catch(() => undefined);

  const { error } = await supabase
    .from("drawing_scenes")
    .delete()
    .eq("room_id", roomId)
    .eq("target_kind", targetKind)
    .eq("target_id", targetId);

  // 0 rows is fine here (nothing was saved yet); only a real error counts.
  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

/**
 * Copy a scene from one object id to another within the same room. Used by
 * `duplicateObject` so the duplicate inherits the same editable canvas as
 * the source. No-op (success) if the source has no saved scene.
 */
export async function copyDrawingScene(
  roomId: string,
  fromObjectId: string,
  toObjectId: string
): Promise<WriteResult> {
  const source = await loadDrawingScene(roomId, "object", fromObjectId);
  if (!source?.psdPath) return { ok: true }; // Nothing to copy — not an error.

  // Pull the source PSD via the signed-url route, then re-upload under the
  // destination key. Cheaper than a Storage `copy` op because we already
  // have an authenticated path through /api/editor/upload.
  const buffer = await loadDrawingScenePsd(roomId, "object", fromObjectId);
  if (!buffer) return { ok: true };
  const blob = new Blob([buffer], { type: "image/vnd.adobe.photoshop" });

  const uploaded = await uploadDrawingScenePsd(
    roomId,
    "object",
    toObjectId,
    blob
  );
  if (!uploaded) return { ok: false, error: "Failed to copy PSD" };

  return saveDrawingScene(roomId, "object", toObjectId, uploaded.path);
}

// ─── Content ────────────────────────────────────────────────

/** Delete one object's content row (object deleted or renamed). */
export async function deleteContent(
  roomId: string,
  objectId: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const { error } = await supabase
    .from("object_content")
    .delete()
    .eq("room_id", roomId)
    .eq("object_id", objectId);
  // Orphan cleanup: 0 rows is legitimate, a real error is not.
  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

export async function loadContent(
  roomId: string,
  objectId: string
): Promise<ObjectContent | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("object_content")
      .select("content")
      .eq("room_id", roomId)
      .eq("object_id", objectId)
      .single();

    if (!error && data?.content) {
      return migrateObjectContent(rewriteStorageUrls(data.content as ObjectContent));
    }
  }

  return migrateObjectContent(getStaticContent(roomId, objectId));
}

export async function loadAllContent(
  roomId: string
): Promise<Record<string, ObjectContent>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("object_content")
      .select("object_id, content")
      .eq("room_id", roomId);

    if (!error && data?.length) {
      const result: Record<string, ObjectContent> = {};
      for (const row of data) {
        const migrated = migrateObjectContent(rewriteStorageUrls(row.content as ObjectContent));
        if (migrated) result[row.object_id] = migrated;
      }
      return result;
    }
  }

  return migrateContentMap(getStaticContentForRoom(roomId));
}

/**
 * The room's object_content rows as they are in the DATABASE: no static-seed
 * fallback (unlike loadAllContent), so a draft's content map never smuggles
 * seed copy into the live site on Publish. `ok: false` = couldn't read.
 */
export async function loadLiveContentRows(
  roomId: string
): Promise<{ ok: boolean; map: Record<string, ObjectContent>; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, map: {}, error: "Supabase not configured." };
  const { data, error } = await supabase
    .from("object_content")
    .select("object_id, content")
    .eq("room_id", roomId);
  if (error) return { ok: false, map: {}, error: error.message };
  const map: Record<string, ObjectContent> = {};
  for (const row of data ?? []) {
    const migrated = migrateObjectContent(rewriteStorageUrls(row.content as ObjectContent));
    if (migrated) map[row.object_id as string] = migrated;
  }
  return { ok: true, map };
}

export async function saveContent(content: ObjectContent): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { error } = await supabase.from("object_content").upsert(
    {
      object_id: content.objectId,
      room_id: content.roomId,
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "object_id,room_id" }
  );

  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

// ─── Object Templates ──────────────────────────────────────
//
// Reusable presets for placing objects: sprite + dimensions + hitbox +
// interaction config. Dropping a template creates a fully-formed
// RoomObject so users don't have to re-tune every "wooden door" they
// place into a new room.

import type { Point, RoomObject } from "@/data/roomTypes";

export const TEMPLATE_CATEGORIES = [
  "door",
  "furniture",
  "plant",
  "decoration",
  "wall-art",
  "other",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// Typed template field definitions. Each required
// field carries enough type info that the post-drop nag (and a future
// validator) knows whether to render a text input, room picker, or URL
// validator. Loose at the data layer so the legacy `string[]` shape still
// parses; coerceRequiredFields() handles both forms.
export type TemplateFieldType = "string" | "roomRef" | "url";
export interface TemplateRequiredField {
  name: string;
  type: TemplateFieldType;
  validation?: {
    required?: boolean;
    /** Regex source (no flags) — applied with `new RegExp(regex)`. */
    regex?: string;
  };
}

/**
 * Coerce a template's `required_fields` cell to the typed shape. Accepts
 * three inputs: the new typed array, the legacy string[] (where each entry
 * was just a field name), and null. Type for legacy entries is inferred from
 * the field name — `targetRoomId` → roomRef, `externalUrl` → url, anything
 * else → string. Old rows just keep working until they're re-saved.
 */
export function coerceRequiredFields(
  raw: unknown
): TemplateRequiredField[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === "string") {
      const type: TemplateFieldType =
        entry === "targetRoomId" || entry === "targetRoomIid"
          ? "roomRef"
          : entry === "externalUrl"
            ? "url"
            : "string";
      return { name: entry, type, validation: { required: true } };
    }
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name : "";
      const type: TemplateFieldType =
        o.type === "roomRef" || o.type === "url" ? o.type : "string";
      const validation =
        o.validation && typeof o.validation === "object"
          ? (o.validation as TemplateRequiredField["validation"])
          : undefined;
      return { name, type, validation };
    }
    return { name: "", type: "string" as TemplateFieldType };
  }).filter((f) => f.name);
}

export interface TemplateRow {
  id: string;
  name: string;
  nameAr: string | null;
  category: TemplateCategory;
  tags: string[];
  spriteUrl: string;
  storagePath: string | null;
  defaultLabel: string;
  defaultLabelAr: string | null;
  defaultWidth: number;
  defaultHeight: number;
  hitboxPolygon: Point[] | null;
  interactionType: NonNullable<RoomObject["interactionType"]>;
  externalUrl: string | null;
  isWallMounted: boolean;
  interactionRadius: number | null;
  zIndexOffset: number | null;
  /** Typed list of fields that must be filled after a drop. Legacy rows
   *  stored a flat string[]; coerceRequiredFields() upgrades both shapes. */
  requiredFields: TemplateRequiredField[];
  /** Steps, hover and kind (migration 20261008000002_popup_presets; null on older rows/databases). */
  behaviour: TemplateBehaviour | null;
  /** Live count of rooms whose objects use this template's sprite. */
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type NewTemplate = Omit<
  TemplateRow,
  "id" | "usageCount" | "createdAt" | "updatedAt"
>;

interface RawTemplateRow {
  id: string;
  name: string;
  name_ar: string | null;
  category: string;
  tags: string[] | null;
  sprite_url: string;
  storage_path: string | null;
  default_label: string;
  default_label_ar: string | null;
  default_width: number;
  default_height: number;
  hitbox_polygon: Point[] | null;
  interaction_type: string;
  external_url: string | null;
  is_wall_mounted: boolean;
  interaction_radius: number | null;
  z_index_offset: number | null;
  required_fields: unknown; // jsonb — typed array OR legacy string[]
  /** jsonb (migration 20261008000002_popup_presets); absent before it. */
  behaviour?: unknown;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(
  raw: RawTemplateRow,
  usageCount: number
): TemplateRow {
  // Defensive: coerce to a known category so the UI never gets a value it
  // can't render. Unknown values fall into "other".
  const category = (TEMPLATE_CATEGORIES as readonly string[]).includes(
    raw.category
  )
    ? (raw.category as TemplateCategory)
    : "other";
  // Same defensive coercion for interaction type (mirrors roomCoerce).
  const ix = raw.interaction_type;
  const interactionType: NonNullable<RoomObject["interactionType"]> =
    ix === "avatar-shop" || ix === "external-link" || ix === "none"
      ? ix
      : "content";
  return {
    id: raw.id,
    name: raw.name,
    nameAr: raw.name_ar,
    category,
    tags: raw.tags ?? [],
    spriteUrl: raw.sprite_url,
    storagePath: raw.storage_path,
    defaultLabel: raw.default_label,
    defaultLabelAr: raw.default_label_ar,
    defaultWidth: raw.default_width,
    defaultHeight: raw.default_height,
    hitboxPolygon: raw.hitbox_polygon,
    interactionType,
    externalUrl: raw.external_url,
    isWallMounted: raw.is_wall_mounted,
    interactionRadius: raw.interaction_radius,
    zIndexOffset: raw.z_index_offset,
    requiredFields: coerceRequiredFields(raw.required_fields),
    behaviour:
      raw.behaviour && typeof raw.behaviour === "object" ? (rewriteStorageUrls(raw.behaviour) as TemplateBehaviour) : null,
    usageCount,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function templateToRow(
  t: NewTemplate
): Omit<RawTemplateRow, "id" | "created_at" | "updated_at"> {
  return {
    name: t.name,
    name_ar: t.nameAr,
    category: t.category,
    tags: t.tags ?? [],
    sprite_url: t.spriteUrl,
    storage_path: t.storagePath,
    default_label: t.defaultLabel,
    default_label_ar: t.defaultLabelAr,
    default_width: t.defaultWidth,
    default_height: t.defaultHeight,
    hitbox_polygon: t.hitboxPolygon,
    interaction_type: t.interactionType,
    external_url: t.externalUrl,
    is_wall_mounted: t.isWallMounted,
    interaction_radius: t.interactionRadius,
    z_index_offset: t.zIndexOffset,
    required_fields: (t.requiredFields ?? []) as unknown,
    ...(t.behaviour ? { behaviour: t.behaviour as unknown } : {}),
  };
}

/**
 * Build a sprite-url → usage count map by scanning every room's objects.
 * Counts are *rooms* (not objects), matching what the badge says.
 */
async function computeTemplateUsage(
  spriteUrls: Set<string>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (spriteUrls.size === 0) return counts;

  const supabase = getSupabaseClient();
  if (!supabase) return counts;

  const { data, error } = await supabase.from("rooms").select("config");
  if (error || !data) return counts;

  for (const row of data) {
    const config = row.config as RoomConfig | null;
    if (!config?.objects?.length) continue;
    const seen = new Set<string>();
    for (const obj of config.objects) {
      if (obj.spriteUrl && spriteUrls.has(obj.spriteUrl)) {
        seen.add(obj.spriteUrl);
      }
    }
    for (const url of seen) {
      counts.set(url, (counts.get(url) ?? 0) + 1);
    }
  }
  return counts;
}

export interface ListTemplatesOptions {
  category?: TemplateCategory;
  /** Free-text search — matches name, name_ar, tags. */
  q?: string;
  /** Tag intersection — all tags must be present. */
  tags?: string[];
}

export async function listTemplates(
  opts: ListTemplatesOptions = {}
): Promise<TemplateRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  let query = supabase
    .from("object_templates")
    .select("*")
    .order("updated_at", { ascending: false });

  if (opts.category) query = query.eq("category", opts.category);
  if (opts.tags?.length) query = query.contains("tags", opts.tags);
  if (opts.q?.trim()) {
    const needle = `%${opts.q.trim()}%`;
    // ilike on name OR name_ar — Postgres array column needs a different
    // operator, so tag matching is handled client-side below for the q case.
    query = query.or(`name.ilike.${needle},name_ar.ilike.${needle}`);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const raws = data as RawTemplateRow[];
  const spriteUrls = new Set(raws.map((r) => r.sprite_url));
  const usage = await computeTemplateUsage(spriteUrls);

  return raws.map((r) => rowToTemplate(r, usage.get(r.sprite_url) ?? 0));
}

export async function saveTemplate(
  t: NewTemplate
): Promise<WriteResult & { id?: string; behaviourDropped?: boolean }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const row = templateToRow(t);
  let { data, error } = await supabase
    .from("object_templates")
    .insert(row)
    .select("id")
    .single();
  // Migration 20261008000002_popup_presets not applied (no `behaviour` column): save the rest, say so.
  let behaviourDropped = false;
  if (error && "behaviour" in row && (error.code === "42703" || error.code === "PGRST204")) {
    const rest: Record<string, unknown> = { ...row };
    delete rest.behaviour;
    ({ data, error } = await supabase.from("object_templates").insert(rest).select("id").single());
    behaviourDropped = !error;
  }

  if (error) return writeErrorFor(supabase, error);
  return { ok: true, id: (data as { id: string }).id, behaviourDropped };
}

export async function updateTemplate(
  id: string,
  patch: Partial<NewTemplate>
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Translate camelCase → snake_case only for fields that are present.
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.nameAr !== undefined) row.name_ar = patch.nameAr;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.spriteUrl !== undefined) row.sprite_url = patch.spriteUrl;
  if (patch.storagePath !== undefined) row.storage_path = patch.storagePath;
  if (patch.defaultLabel !== undefined) row.default_label = patch.defaultLabel;
  if (patch.defaultLabelAr !== undefined)
    row.default_label_ar = patch.defaultLabelAr;
  if (patch.defaultWidth !== undefined) row.default_width = patch.defaultWidth;
  if (patch.defaultHeight !== undefined)
    row.default_height = patch.defaultHeight;
  if (patch.hitboxPolygon !== undefined)
    row.hitbox_polygon = patch.hitboxPolygon;
  if (patch.interactionType !== undefined)
    row.interaction_type = patch.interactionType;
  if (patch.externalUrl !== undefined) row.external_url = patch.externalUrl;
  if (patch.isWallMounted !== undefined)
    row.is_wall_mounted = patch.isWallMounted;
  if (patch.interactionRadius !== undefined)
    row.interaction_radius = patch.interactionRadius;
  if (patch.zIndexOffset !== undefined) row.z_index_offset = patch.zIndexOffset;
  if (patch.requiredFields !== undefined)
    row.required_fields = patch.requiredFields;

  const { data: updated, error } = await supabase
    .from("object_templates")
    .update(row)
    .eq("id", id)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!updated?.length) return noRowsResult(supabase, "This template");
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data: gone, error } = await supabase
    .from("object_templates")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!gone?.length) return noRowsResult(supabase, "This template");
  return { ok: true };
}

// ─── Sprites / Images ──────────────────────────────────────

export async function uploadSprite(
  file: Blob,
  objectId: string,
  roomId: string
): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const prep = await prepareForUpload(file, "sprite");
  const path = `${roomId}/${objectId}-${Date.now()}.${prep.ext}`;
  const { error: uploadError } = await supabase.storage
    .from("sprites")
    .upload(path, prep.blob, { contentType: prep.type, upsert: true });

  if (uploadError) {
    // These helpers return null, so surface a lapsed session via the banner.
    await writeErrorFor(supabase, uploadError);
    return null;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("sprites").getPublicUrl(path);

  return resolveStorageUrl(publicUrl);
}

export interface SpriteAsset {
  path: string;
  url: string;
  name: string;
}

/** List every sprite currently in the `sprites` bucket (flattened across folders). */
export async function listSprites(): Promise<SpriteAsset[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const bucket = supabase.storage.from("sprites");
  const assets: SpriteAsset[] = [];

  // Shallow list at root first.
  const { data: root, error: rootErr } = await bucket.list("", { limit: 200 });
  if (rootErr || !root) return [];

  for (const entry of root) {
    // Folders have no `id` (Supabase convention); recurse one level.
    const isFolder = entry.id === null;
    if (isFolder) {
      const { data: nested } = await bucket.list(entry.name, { limit: 200 });
      for (const file of nested ?? []) {
        if (!file.name) continue;
        const path = `${entry.name}/${file.name}`;
        const { data } = bucket.getPublicUrl(path);
        assets.push({ path, url: resolveStorageUrl(data.publicUrl), name: file.name });
      }
    } else if (entry.name) {
      const { data } = bucket.getPublicUrl(entry.name);
      assets.push({ path: entry.name, url: resolveStorageUrl(data.publicUrl), name: entry.name });
    }
  }

  // Filter out non-image artifacts (e.g. `.emptyFolderPlaceholder`).
  return assets.filter((a) => /\.(png|webp|jpe?g|gif)$/i.test(a.name));
}

/** Upload a sprite to the shared library (no specific object/room). */
export async function uploadLibrarySprite(
  file: Blob,
  filename: string
): Promise<WriteResult & { url?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const prep = await prepareForUpload(file, "sprite");
  const safeName = withExt(filename.replace(/[^a-z0-9._-]+/gi, "_"), prep.ext);
  const path = `_library/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from("sprites")
    .upload(path, prep.blob, {
      contentType: prep.type,
      upsert: false,
    });

  if (error) return writeErrorFor(supabase, error);

  const { data } = supabase.storage.from("sprites").getPublicUrl(path);
  return { ok: true, url: resolveStorageUrl(data.publicUrl) };
}

export async function uploadContentImage(
  file: Blob,
  kind: ImageKind = "content"
): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  // Optimised (scaled + WebP) first; the extension then follows the real type
  // of what is uploaded (a JPEG saved as .png confused downloads and the
  // media library's labels).
  const prep = await prepareForUpload(file, kind);
  const path = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.${prep.ext}`;
  const { error } = await supabase.storage
    .from("content-images")
    .upload(path, prep.blob, { contentType: prep.type, upsert: true });

  if (error) {
    await writeErrorFor(supabase, error);
    return null;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("content-images").getPublicUrl(path);

  return resolveStorageUrl(publicUrl);
}

// ─── Room Background ───────────────────────────────────────

export async function uploadRoomBackgroundOriginal(
  file: Blob,
  roomId: string,
  layer: BgLayer = "middle"
): Promise<string | null> {
  const prep = await prepareOriginalForUpload(file);
  const ext = prep.ext;
  file = prep.blob;
  const path = `${roomId}/${layer}/bg-${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", "room-bg-originals");
  formData.append("path", path);

  const res = await fetch("/api/editor/upload", { method: "POST", body: formData });
  if (!res.ok) {
    noteForbiddenResponse(res);
    return null;
  }

  const { path: storedPath } = await res.json();
  return storedPath as string;
}

export async function uploadRoomBackgroundCrop(
  blob: Blob,
  roomId: string,
  layer: BgLayer = "middle"
): Promise<string | null> {
  const prep = await prepareForUpload(blob, "room-layer");
  const path = `${roomId}/${layer}/crop-${Date.now()}.${prep.ext}`;

  const formData = new FormData();
  formData.append("file", new File([prep.blob], `crop.${prep.ext}`, { type: prep.type }));
  formData.append("bucket", "room-backgrounds");
  formData.append("path", path);

  const res = await fetch("/api/editor/upload", { method: "POST", body: formData });
  if (!res.ok) {
    noteForbiddenResponse(res);
    return null;
  }

  const { url } = await res.json();
  return url as string;
}

export async function getOriginalSignedUrl(
  storagePath: string
): Promise<string | null> {
  const res = await fetch("/api/editor/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket: "room-bg-originals", path: storagePath }),
  });
  if (!res.ok) return null;

  const { signedUrl } = await res.json();
  return signedUrl as string;
}
