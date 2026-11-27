// Auto-derived room neighbours.
//
// Pure helper: given a room and the full room map, return the rooms whose
// world-space rectangles share an edge with this room's rectangle. No
// persistence — neighbours are recomputed from `worldX/Y/W/H` on demand.
//
// Used today by:
//   - Integrity check #5 (gridvania-only "no neighbours and no inbound").
// Will be used later by:
//   - Onion-skinning previews in EditorCanvas.
//   - "Go to next room" hotkeys.

import type { RoomConfig } from "@/data/roomTypes";
import { ROOM_WIDTH, ROOM_HEIGHT } from "@/data/roomTypes";

export interface Neighbours {
  n: RoomConfig | null;
  s: RoomConfig | null;
  e: RoomConfig | null;
  w: RoomConfig | null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOf(r: RoomConfig): Rect {
  return {
    x: r.worldX ?? 0,
    y: r.worldY ?? 0,
    w: r.worldW ?? ROOM_WIDTH,
    h: r.worldH ?? ROOM_HEIGHT,
  };
}

/**
 * Two coordinates count as "the same edge" if they're within EPSILON. Lets
 * us tolerate the rare half-pixel rounding from a freeform drag without
 * forcing perfect grid alignment.
 */
const EPSILON = 1;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

/** True iff [a1,a2] and [b1,b2] overlap (touching counts as overlap). */
function rangesOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && b1 < a2;
}

export function neighboursOf(
  room: RoomConfig,
  rooms: Record<string, RoomConfig>
): Neighbours {
  const a = rectOf(room);
  let n: RoomConfig | null = null;
  let s: RoomConfig | null = null;
  let e: RoomConfig | null = null;
  let w: RoomConfig | null = null;

  for (const other of Object.values(rooms)) {
    if (!other || other.id === room.id) continue;
    // Skip rooms in a different world; neighbours only makes sense per-world.
    if (room.worldIid && other.worldIid && room.worldIid !== other.worldIid) {
      continue;
    }
    const b = rectOf(other);

    // North: other's bottom edge touches this room's top edge.
    if (near(b.y + b.h, a.y) && rangesOverlap(a.x, a.x + a.w, b.x, b.x + b.w)) {
      if (!n) n = other;
    }
    // South: other's top edge touches this room's bottom edge.
    if (near(b.y, a.y + a.h) && rangesOverlap(a.x, a.x + a.w, b.x, b.x + b.w)) {
      if (!s) s = other;
    }
    // West: other's right edge touches this room's left edge.
    if (near(b.x + b.w, a.x) && rangesOverlap(a.y, a.y + a.h, b.y, b.y + b.h)) {
      if (!w) w = other;
    }
    // East: other's left edge touches this room's right edge.
    if (near(b.x, a.x + a.w) && rangesOverlap(a.y, a.y + a.h, b.y, b.y + b.h)) {
      if (!e) e = other;
    }
  }

  return { n, s, e, w };
}
