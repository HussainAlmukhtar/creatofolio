// Door-slug rewrite used when a room is renamed.
//
// Doors resolve their target by stable iid, but the legacy `targetRoomId` slug
// is still written alongside it (dual-write window). After a rename every door
// that points at the renamed room gets the new slug, in the LIVE configs of
// the other rooms and in the DRAFT configs (otherwise publishing a draft would
// bring the old slug back). One rule, shared, so both agree.

import type { RoomConfig } from "@/data/roomTypes";

/**
 * Rewrite, IN PLACE, every door in `cfg` that targets the renamed room:
 * matched by `targetRoomIid`, else (pre-iid doors) by the old slug. Returns
 * how many doors changed.
 */
export function rewriteInboundDoors(
  cfg: Pick<RoomConfig, "objects">,
  roomIid: string,
  oldSlug: string,
  newSlug: string
): number {
  let changed = 0;
  for (const obj of cfg?.objects ?? []) {
    if (obj.type !== "door") continue;
    const matches =
      (obj.targetRoomIid && obj.targetRoomIid === roomIid) ||
      (!obj.targetRoomIid && obj.targetRoomId === oldSlug);
    if (matches && obj.targetRoomId !== newSlug) {
      obj.targetRoomId = newSlug;
      changed++;
    }
  }
  return changed;
}
