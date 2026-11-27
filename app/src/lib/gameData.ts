// Game data loading — used by the game (not the editor).
//
// Loads room configs and content from Supabase with static fallback.
// These functions are called at game load time.

import type { RoomConfig, RoomId, WorldConfig } from "@/data/roomTypes";
import type { ObjectContent } from "@/data/contentTypes";
import { staticWorld } from "@/data/staticRooms";
import { coerceRoomConfig } from "@/data/roomCoerce";
import { getStaticContent, getStaticContentForRoom } from "@/data/staticContent";
import { migrateContentMap, migrateObjectContent } from "@/data/contentMigrations";
import { getSupabaseClient } from "./supabase/client";
import { withTimeout } from "./withTimeout";
import { rewriteStorageUrls } from "./storageUrl";
import {
  loadDefaultWorld,
  mergeFileAndDbRooms,
  readWorldFiles,
} from "./editorData";

/** Load a single room config. Tries Supabase, falls back to staticRooms. */
export async function loadRoomConfig(roomId: RoomId): Promise<RoomConfig> {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data, error } = await supabase
        .from("rooms")
        .select("config")
        .eq("id", roomId)
        .maybeSingle();

      if (!error && data?.config) {
        return coerceRoomConfig(data.config as RoomConfig);
      }
    }
  } catch {
    // Supabase unavailable — use static fallback
  }

  return staticWorld.rooms[roomId];
}

export interface GameBootData {
  roomConfigs: Record<RoomId, RoomConfig>;
  defaultRoomId: string;
  /**
   * Rooms of the LIVE world (for the mini-map). Every room stays loaded so a
   * door can still lead into another world; undefined = no world info.
   */
  worldRoomIds?: string[];
  /** The live world's "show room name tags" default (rooms can override). */
  roomNameTags?: boolean;
}

/**
 * Load all room configs plus the world's configured default start room.
 *
 * When the default world has
 * `externalFilesEnabled`, file rooms overlay DB rows via the same
 * `mergeFileAndDbRooms` helper the editor uses. This closes the silent
 * drift where the `.json` you commit to git wasn't actually what played.
 */
export function loadAllRoomConfigs(): Promise<GameBootData> {
  // GameWrapper (mini-map list) and PhaserGame (the scenes) both ask on mount;
  // each used to download the whole rooms table (~26 KB, twice per visit).
  // Share one load between callers that start within a few seconds of each
  // other. A later call (a new visit to the page, the admin lab) loads afresh.
  const now = Date.now();
  if (bootLoad && now - bootLoad.at < BOOT_SHARE_MS) return bootLoad.promise;
  const promise = loadAllRoomConfigsUncached();
  bootLoad = { at: now, promise };
  return promise;
}

const BOOT_SHARE_MS = 10_000;
let bootLoad: { at: number; promise: Promise<GameBootData> } | null = null;

async function loadAllRoomConfigsUncached(): Promise<GameBootData> {
  // The rooms query and the (optional) world/file overlay each get their own
  // time budget and run in parallel. They used to run back-to-back under ONE
  // outer 4s cap in PhaserGame, so a slow overlay step (a cold
  // /api/editor/world-file compile, a slow tunnel) discarded the rooms that
  // had already loaded and the arcade booted the bare static seed — none of
  // the drawn backgrounds or sprites.
  const [dbRows, overlay] = await Promise.all([
    withTimeout(fetchRoomRows(), ROOMS_TIMEOUT_MS, null),
    withTimeout(fetchWorldOverlay(), OVERLAY_TIMEOUT_MS, null),
  ]);

  // The DB is the source of truth once it has rooms (so a room deleted in
  // the World map stays deleted); the static seed only fills in when the DB
  // is empty or unreachable, so the site always renders something.
  let rooms: Record<string, RoomConfig> =
    dbRows && dbRows.length > 0 ? {} : { ...staticWorld.rooms };
  for (const row of dbRows ?? []) {
    rooms[row.id] = coerceRoomConfig(row.config as RoomConfig);
  }

  // External-files overlay (file wins).
  if (overlay && Object.keys(overlay.fileRooms).length > 0) {
    rooms = mergeFileAndDbRooms(rooms, overlay.fileRooms);
  }

  // Rooms belonging to the live world. Rows with no world_iid predate
  // worlds and belong to the original "main" world.
  let worldRoomIds: string[] | undefined;
  if (overlay && dbRows?.length) {
    const ids = dbRows
      .filter((r) =>
        r.world_iid ? r.world_iid === overlay.worldIid : overlay.worldId === "main"
      )
      .map((r) => r.id)
      .filter((id) => rooms[id]);
    if (ids.length) worldRoomIds = ids;
  }

  // Start room: the world's setting, else home (if it's in this world),
  // else the world's first room. BootScene falls back further if needed.
  const inWorld = (id: string) => !worldRoomIds || worldRoomIds.includes(id);
  const defaultRoomId =
    (overlay?.defaultRoomId && rooms[overlay.defaultRoomId]
      ? overlay.defaultRoomId
      : undefined) ??
    (rooms.home && inWorld("home") ? "home" : undefined) ??
    [...(worldRoomIds ?? [])].sort()[0] ??
    "home";

  return {
    roomConfigs: rooms as Record<RoomId, RoomConfig>,
    defaultRoomId,
    worldRoomIds,
    roomNameTags: overlay?.roomNameTags,
  };
}

/** Budget for the `rooms` query — the part the arcade can't look right without. */
const ROOMS_TIMEOUT_MS = 8000;
/** Budget for the world row + external-file overlay (best-effort extras). */
const OVERLAY_TIMEOUT_MS = 4000;
/** Outer safety cap for callers — covers both steps above plus slack. */
export const LOAD_ALL_ROOMS_TIMEOUT_MS = ROOMS_TIMEOUT_MS + 1000;

async function fetchRoomRows(): Promise<
  { id: string; config: unknown; world_iid: string | null }[] | null
> {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("rooms")
      .select("id, config, world_iid");
    if (error) {
      console.warn("[gameData] rooms query failed; using static rooms:", error.message);
      return null;
    }
    return data ?? null;
  } catch {
    // Supabase unavailable — caller keeps the static seed.
    return null;
  }
}

async function fetchWorldOverlay(): Promise<{
  worldIid: string;
  worldId: string;
  defaultRoomId?: string;
  roomNameTags?: boolean;
  fileRooms: Record<string, RoomConfig>;
} | null> {
  // Best-effort — if the API or world lookup fails we keep the DB rooms.
  try {
    const world: WorldConfig | null = await loadDefaultWorld();
    if (!world) return null;
    const fileRooms = world.config?.externalFilesEnabled
      ? await readWorldFiles(world.id)
      : {};
    return {
      worldIid: world.iid,
      worldId: world.id,
      defaultRoomId: world.config?.defaultRoomId || undefined,
      roomNameTags: world.config?.roomNameTags,
      fileRooms,
    };
  } catch {
    return null;
  }
}

/**
 * Load content for a specific object. Tries Supabase (capped at 4s so a
 * hung request can't block the interaction modal), falls back to static
 * content on any error, timeout, or empty result.
 */
export async function loadObjectContent(
  roomId: string,
  objectId: string
): Promise<ObjectContent | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const fetchFromDb = (async () => {
      try {
        const { data, error } = await supabase
          .from("object_content")
          .select("content")
          .eq("room_id", roomId)
          .eq("object_id", objectId)
          .maybeSingle();
        return !error && data?.content
          ? migrateObjectContent(rewriteStorageUrls(data.content as ObjectContent))
          : null;
      } catch {
        return null;
      }
    })();

    const fromDb = await withTimeout(fetchFromDb, 4000, null);
    if (fromDb) return fromDb;
  }

  return migrateObjectContent(getStaticContent(roomId, objectId));
}

/** Load all content for a room. Same Supabase-with-timeout, static-fallback shape as `loadObjectContent`. */
export async function loadRoomContent(
  roomId: string
): Promise<Record<string, ObjectContent>> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const fetchFromDb = (async () => {
      try {
        const { data, error } = await supabase
          .from("object_content")
          .select("object_id, content")
          .eq("room_id", roomId);
        if (error || !data?.length) return null;
        const result: Record<string, ObjectContent> = {};
        for (const row of data) {
          const migrated = migrateObjectContent(rewriteStorageUrls(row.content as ObjectContent));
          if (migrated) result[row.object_id] = migrated;
        }
        return result;
      } catch {
        return null;
      }
    })();

    const fromDb = await withTimeout(fetchFromDb, 4000, null);
    if (fromDb) return fromDb;
  }

  return migrateContentMap(getStaticContentForRoom(roomId));
}
