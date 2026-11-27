// Backwards-compatible coercion shim. The actual upgrade logic now lives in
// `migrations.ts` as a versioned registry — this file just preserves the
// historical export surface so existing call sites (gameData, editorData,
// integrityCheck, etc.) keep working without churn.
//
// New code should call `migrateRoom` from `./migrations` directly.

import type { RoomConfig, RoomObject } from "./roomTypes";
import { migrateRoom } from "./migrations";

const VALID_INTERACTION = new Set([
  "content",
  "avatar-shop",
  "external-link",
  "none",
]);

const LEGACY_INTERACTION = new Set(["modal", "cv", "artwork"]);

/**
 * @deprecated kept for any direct callers; new code should rely on
 * `migrateRoom` running at load time.
 */
export function coerceInteractionType(
  raw: string | undefined | null
): RoomObject["interactionType"] | undefined {
  if (raw == null) return undefined;
  if (LEGACY_INTERACTION.has(raw)) return "content";
  if (VALID_INTERACTION.has(raw)) return raw as RoomObject["interactionType"];
  return "content";
}

/**
 * @deprecated kept for any direct callers; new code should rely on
 * `migrateRoom` running at load time.
 */
export function coerceObjectKind(
  raw: string | undefined
): RoomObject["type"] {
  if (raw === "stairs") return "door";
  if (raw === "door" || raw === "object" || raw === "npc") return raw;
  return "object";
}

export function coerceRoomObject(obj: RoomObject): RoomObject {
  const nextInteraction = coerceInteractionType(obj.interactionType);
  const nextType = coerceObjectKind(obj.type as unknown as string);
  if (nextInteraction === obj.interactionType && nextType === obj.type) {
    return obj;
  }
  return { ...obj, interactionType: nextInteraction, type: nextType };
}

/**
 * Bring a `rooms.config` JSONB blob up to the current schema version.
 * Delegates to the versioned migration registry; safe to call on every load.
 */
export function coerceRoomConfig(config: RoomConfig): RoomConfig {
  return migrateRoom(config);
}
