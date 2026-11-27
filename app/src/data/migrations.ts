/* eslint-disable @typescript-eslint/no-explicit-any */
// Schema-version registry for RoomConfig + WorldConfig.
//
// `any` is used deliberately throughout: migration steps receive pre-migration
// rows that by definition don't match the current RoomConfig shape, so asserting
// a static type on them would defeat the purpose. Same rationale as
// landingMigrations.ts (the landing-page sibling).
//
// Every persisted room is stamped with `schemaVersion`. Loaders run
// `migrateRoom()` on read, which walks each registered step from the row's
// stored version up to CURRENT_ROOM_SCHEMA_VERSION and stamps the final
// version on the result. Writers bump the version on save.
//
// Why a registry instead of ad-hoc coercions:
//   - Each step is local + testable in isolation.
//   - The version number is the single source of truth for "is this row up
//     to date" — no guessing from field shapes.
//   - Adding a future migration is one entry in ROOM_MIGRATIONS plus a
//     bumped CURRENT_ROOM_SCHEMA_VERSION.

import type { RoomConfig } from "./roomTypes";
import { newIid } from "@/lib/iid";
import { rewriteStorageUrls } from "@/lib/storageUrl";
import { migrateObjectInteractions } from "@/lib/objectActions";

/**
 * Bump this when you add a new entry to ROOM_MIGRATIONS. Stamped on every
 * write; loaders walk from `raw.schemaVersion ?? 1` up to this value.
 */
export const CURRENT_ROOM_SCHEMA_VERSION = 6;

/** World versioning is currently a placeholder — bumped when WorldConfig grows. */
export const CURRENT_WORLD_SCHEMA_VERSION = 1;

// Each migration takes the raw row at version N and returns it at version N+1.
// Intentionally typed loose — pre-migration rows do NOT match the current
// RoomConfig shape, and asserting that statically would defeat the purpose.
type RoomMigration = (room: any) => any;

const LEGACY_INTERACTION_TYPES = new Set(["modal", "cv", "artwork"]);

// v1 → v2: collapse legacy `interactionType` strings to "content".
// (Originally implemented inline in roomCoerce.ts; moved here as the first
// formal migration step.)
function migrateInteractionTypes(room: any): any {
  if (!room?.objects?.length) return room;
  let changed = false;
  const objects = room.objects.map((o: any) => {
    if (LEGACY_INTERACTION_TYPES.has(o.interactionType)) {
      changed = true;
      return { ...o, interactionType: "content" };
    }
    // Unknown values that aren't in the new union also collapse to "content"
    // so a click never silently does nothing.
    if (
      o.interactionType != null &&
      o.interactionType !== "content" &&
      o.interactionType !== "avatar-shop" &&
      o.interactionType !== "external-link" &&
      o.interactionType !== "none"
    ) {
      changed = true;
      return { ...o, interactionType: "content" };
    }
    return o;
  });
  return changed ? { ...room, objects } : room;
}

// v2 → v3: collapse `type: "stairs"` into `type: "door"`. Stairs were never a
// distinct runtime concept — just a door with a stair sprite.
function migrateStairsToDoor(room: any): any {
  if (!room?.objects?.length) return room;
  let changed = false;
  const objects = room.objects.map((o: any) => {
    if (o.type === "stairs") {
      changed = true;
      return { ...o, type: "door" };
    }
    return o;
  });
  return changed ? { ...room, objects } : room;
}

// v3 → v4: mint iids on the room itself, every object, and every entry point
// if missing. Idempotent — existing iids are preserved. This is the load-time
// safety net so any DB row that hasn't run the one-shot script (002_mint_iids)
// becomes self-healing on the next save.
function mintIidsIfMissing(room: any): any {
  let changed = false;
  let nextRoom = room;

  if (!nextRoom.iid) {
    nextRoom = { ...nextRoom, iid: newIid() };
    changed = true;
  }

  if (Array.isArray(nextRoom.objects)) {
    let objectsChanged = false;
    const objects = nextRoom.objects.map((o: any) => {
      if (!o.iid) {
        objectsChanged = true;
        return { ...o, iid: newIid() };
      }
      return o;
    });
    if (objectsChanged) {
      nextRoom = { ...nextRoom, objects };
      changed = true;
    }
  }

  if (Array.isArray(nextRoom.entryPoints)) {
    let epChanged = false;
    const entryPoints = nextRoom.entryPoints.map((ep: any) => {
      if (!ep.iid) {
        epChanged = true;
        return { ...ep, iid: newIid() };
      }
      return ep;
    });
    if (epChanged) {
      nextRoom = { ...nextRoom, entryPoints };
      changed = true;
    }
  }

  return changed ? nextRoom : room;
}

// v4 → v5: backfill showLabel. Doors default true (they always rendered
// a label); objects/NPCs default false (no visible change for existing rooms).
function addShowLabelField(room: any): any {
  if (!room?.objects?.length) return room;
  let changed = false;
  const objects = room.objects.map((o: any) => {
    if (o.showLabel !== undefined) return o;
    changed = true;
    return { ...o, showLabel: o.type === "door" };
  });
  return changed ? { ...room, objects } : room;
}

// v5 → v6: write each object's "When clicked…" steps,
// derived from the legacy interactionType/externalUrl so every existing
// object behaves exactly as before (see lib/objectActions.ts for the table).
// The legacy fields stay and are dual-written from then on.
function addInteractions(room: any): any {
  if (!room?.objects?.length) return room;
  let changed = false;
  const objects = room.objects.map((o: any) => {
    const n = migrateObjectInteractions(o);
    if (n !== o) changed = true;
    return n;
  });
  return changed ? { ...room, objects } : room;
}

const ROOM_MIGRATIONS: Record<number, RoomMigration> = {
  1: migrateInteractionTypes,
  2: migrateStairsToDoor,
  3: mintIidsIfMissing,
  4: addShowLabelField,
  5: addInteractions,
};

/**
 * Bring a raw `rooms.config` JSONB blob up to the current schema version.
 * Idempotent — running on an already-current row is a no-op (returns the
 * input unchanged in shape).
 */
export function migrateRoom(raw: any): RoomConfig {
  const from = typeof raw?.schemaVersion === "number" ? raw.schemaVersion : 1;
  let cur = raw;
  for (let v = from; v < CURRENT_ROOM_SCHEMA_VERSION; v++) {
    const step = ROOM_MIGRATIONS[v];
    if (step) cur = step(cur);
  }
  // Stamp on every read so writes downstream don't need to remember.
  if (cur.schemaVersion !== CURRENT_ROOM_SCHEMA_VERSION) {
    cur = { ...cur, schemaVersion: CURRENT_ROOM_SCHEMA_VERSION };
  }
  // Re-root saved Storage URLs at the current storage origin (see
  // lib/storageUrl.ts) — backgrounds/sprites saved before a storage move.
  return rewriteStorageUrls(cur) as RoomConfig;
}
