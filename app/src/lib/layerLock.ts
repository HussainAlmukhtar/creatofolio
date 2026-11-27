// Layer lock — the one place that decides whether a positioned element is
// locked, in every editor (landing sections, Arcade, room editor, Nav Studio).
//
// Each element has an optional stored `locked?: boolean`:
//   true / false = the owner chose; it always wins.
//   absent       = the DEFAULT for that element: locked if it is a backdrop,
//                  free otherwise.
// A locked element can't be moved / resized / rotated on the canvas and its
// canvas hit area is click-through; it stays selectable from the layers list.
// It is editor-only metadata: no public component or game scene reads it.
//
// One pure predicate per data shape, written once; never duplicate the
// backdrop test elsewhere.

import { toast } from "sonner";
import type { DrawnAsset, DrawnSection, NavHotspot } from "@/data/landingTypes";
import type { ArcadeConfig, StoredArcadeConfig } from "@/data/arcadeConfig";
import { resolveArcade } from "@/data/arcadeConfig";
import { isBackdropAsset } from "@/lib/arcadeGuides";
import type { RoomObject } from "@/data/roomTypes";
import { ROOM_HEIGHT, ROOM_WIDTH } from "@/data/roomTypes";

/** How much of the box counts as "covers it" (both axes). */
const COVER = 95;

/** Share (0–100) of the 0–100 span that [start, start + size] covers. */
function coverage(start: number, size: number): number {
  return Math.max(0, Math.min(100, start + size) - Math.max(0, start));
}

type SectionLike = Pick<DrawnSection, "assets" | "containsGame" | "arcade">;

/**
 * A backdrop inside a landing section: a drawn / uploaded image at the bottom
 * of the stack that covers (≥ 95 %) the whole section box. In the Arcade it is
 * the arcade's own `isBackdropAsset` (behind the machine, covering the whole
 * drawing area). Judged on the desktop geometry; the stored lock applies to
 * both layouts.
 */
export function isSectionBackdrop(asset: DrawnAsset, section: SectionLike): boolean {
  if (section.containsGame) {
    return isBackdropAsset(asset, resolveArcade(section.arcade).machine.zIndex);
  }
  if (asset.source.kind !== "drawn" && asset.source.kind !== "upload") return false;
  if (coverage(asset.x, asset.w) < COVER || coverage(asset.y, asset.h) < COVER) return false;
  return section.assets.every((o) => o.iid === asset.iid || o.zIndex >= asset.zIndex);
}

/** Is this landing / Arcade element locked? (stored value, else the default) */
export function isAssetLocked(asset: DrawnAsset, section: SectionLike): boolean {
  return asset.locked ?? isSectionBackdrop(asset, section);
}

/** Is the Arcade machine locked? (no default: it stays free until locked) */
export function isMachineLocked(arcade: StoredArcadeConfig | ArcadeConfig | null | undefined): boolean {
  return arcade?.machine?.locked === true;
}

/** A room object that covers (≥ 95 %) the whole room is a backdrop. The room's
 *  own background art layers are fixed at room size and can't be dragged, so
 *  they have nothing to lock. */
export function isRoomBackdropObject(obj: Pick<RoomObject, "x" | "y" | "width" | "height" | "type">): boolean {
  if (obj.type !== "object") return false;
  const cx = (Math.min(ROOM_WIDTH, obj.x + obj.width) - Math.max(0, obj.x)) / ROOM_WIDTH;
  const cy = (Math.min(ROOM_HEIGHT, obj.y + obj.height) - Math.max(0, obj.y)) / ROOM_HEIGHT;
  return cx * 100 >= COVER && cy * 100 >= COVER;
}

/** Is this room object locked? (stored value, else the default) */
export function isRoomObjectLocked(obj: RoomObject): boolean {
  return obj.locked ?? isRoomBackdropObject(obj);
}

/** Is this Nav Studio hotspot locked? (no default: all start free) */
export function isHotspotLocked(rect: Pick<NavHotspot, "locked">): boolean {
  return rect.locked === true;
}

// ─── Feedback when something refuses to move ────────────────────

let hintShown = false;

/**
 * "Locked: unlock it to move", once per session, non-blocking, with an Unlock
 * action. Call it when the owner tries to drag a locked element.
 */
export function showLockedHint(onUnlock: () => void): void {
  try {
    if (hintShown || window.sessionStorage.getItem("layer-lock-hint") === "1") return;
    window.sessionStorage.setItem("layer-lock-hint", "1");
  } catch {
    if (hintShown) return;
  }
  hintShown = true;
  toast("Locked: unlock it to move", {
    duration: 5000,
    action: { label: "Unlock", onClick: onUnlock },
  });
}

/** Test/dev hook: forget that the hint was shown. */
export function resetLockedHint(): void {
  hintShown = false;
  try {
    window.sessionStorage.removeItem("layer-lock-hint");
  } catch {
    /* storage blocked */
  }
}

/** Spoken / toast wording for a toggle result. */
export function lockMessage(name: string, nowLocked: boolean): string {
  return nowLocked ? `${name} locked` : `${name} unlocked`;
}
