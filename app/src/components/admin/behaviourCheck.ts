// Behaviour check for the pop-up lab: does every object
// do exactly what it did before the "When clicked…" steps?
//
// `oldBehaviour` re-implements the legacy runtime decision tree
// (BaseRoomScene zone click + triggerInteraction, GameWrapper's
// OBJECT_INTERACT handler) on an object's LEGACY fields. `newBehaviour`
// describes what the new runtime does with the steps the room schema v6
// migration derives. Same sentence = same behaviour. Pure, read-only.

import type { RoomConfig, RoomObject } from "@/data/roomTypes";
import { migrateRoom } from "@/data/migrations";
import { clickTriggerOf } from "@/lib/objectActions";
import { safeHref } from "@/lib/safeUrl";

const WALK = "walks to the clicked spot (no action)";
const NOTHING_SHOP = "walks to it, opens the character creator";
const NOTHING_DOOR = "walks to it, nothing happens (door has no target)";

function doorTarget(obj: RoomObject, rooms: Record<string, RoomConfig>): string | null {
  let slug: string | undefined;
  let ep: string | undefined;
  if (obj.targetRoomIid) {
    const r = Object.values(rooms).find((x) => x?.iid === obj.targetRoomIid);
    if (r) {
      slug = r.id;
      if (obj.targetEntryPointIid) ep = r.entryPoints.find((e) => e.iid === obj.targetEntryPointIid)?.id;
    }
  }
  if (!slug) slug = obj.targetRoomId;
  if (!ep) ep = obj.targetEntryPointId;
  return slug ? `${slug}${ep ? `#${ep}` : ""}` : null;
}

/** What the legacy code did on click (legacy fields only). */
export function oldBehaviour(obj: RoomObject, room: RoomConfig, rooms: Record<string, RoomConfig>): string {
  if (obj.interactionType === "none") return WALK;
  if (obj.type === "door") {
    const t = doorTarget(obj, rooms);
    return t ? `walks to it, goes to ${t}` : NOTHING_DOOR;
  }
  const it = obj.interactionType || "content";
  if (it === "avatar-shop") return NOTHING_SHOP;
  if (it === "external-link" && obj.externalUrl) {
    const href = safeHref(obj.externalUrl);
    return href ? `walks to it, opens ${href} in a new tab` : "walks to it, link refused";
  }
  return `walks to it, opens pop-up ${room.id}:${obj.id}`;
}

/** What the new runtime does with the object's (derived) steps. */
export function newBehaviour(obj: RoomObject, room: RoomConfig, rooms: Record<string, RoomConfig>): string {
  const steps = clickTriggerOf(obj).actions;
  if (!steps.length) return WALK;
  return steps
    .map((s) => {
      switch (s.kind) {
        case "door": {
          const t = doorTarget(obj, rooms);
          return t ? `walks to it, goes to ${t}` : NOTHING_DOOR;
        }
        case "shop":
          return NOTHING_SHOP;
        case "link": {
          if (s.confirm) return `walks to it, asks, then opens ${s.url}`;
          const href = safeHref(s.url);
          return href ? `walks to it, opens ${href} in a new tab` : "walks to it, link refused";
        }
        case "popup":
          return `walks to it, opens pop-up ${room.id}:${obj.id}`;
        default:
          return `walks to it, runs “${s.kind}”`;
      }
    })
    .join(" → ");
}

/** Hover "auto": old rule vs new rule (doors always lift). */
export function hoverClickable(obj: RoomObject, version: "old" | "new"): boolean {
  if (obj.type === "door") return true;
  if (version === "old") return (obj.interactionType ?? "content") !== "none";
  return clickTriggerOf(obj).actions.length > 0;
}

export interface CheckRow {
  room: string;
  object: string;
  kind: string;
  legacy: string;
  before: string;
  after: string;
  hoverSame: boolean;
  same: boolean;
}

/** Compare every object of raw (unmigrated) room configs. */
export function checkRooms(raw: Record<string, unknown>): CheckRow[] {
  const migrated: Record<string, RoomConfig> = {};
  for (const [id, cfg] of Object.entries(raw)) migrated[id] = migrateRoom(structuredClone(cfg));
  const rows: CheckRow[] = [];
  for (const [id, cfg] of Object.entries(raw) as [string, RoomConfig][]) {
    const after = migrated[id];
    for (const o of cfg.objects ?? []) {
      const n = after.objects.find((x) => x.id === o.id)!;
      const before = oldBehaviour(o, cfg, raw as Record<string, RoomConfig>);
      const now = newBehaviour(n, after, migrated);
      const hoverSame = hoverClickable(o, "old") === hoverClickable(n, "new");
      rows.push({
        room: id,
        object: o.id,
        kind: o.type,
        legacy: `${o.interactionType ?? "(unset)"}${o.externalUrl ? ` ${o.externalUrl}` : ""}`,
        before,
        after: now,
        hoverSame,
        same: before === now && hoverSame,
      });
    }
  }
  return rows;
}

/** Every legacy shape (kind × interaction type × URL), incl. ones no live room has. */
export function legacyMatrixRoom(): Record<string, unknown> {
  const kinds: RoomObject["type"][] = ["object", "npc", "door"];
  const variants: Pick<RoomObject, "interactionType" | "externalUrl">[] = [
    {},
    { interactionType: "content" },
    { interactionType: "none" },
    { interactionType: "avatar-shop" },
    { interactionType: "external-link", externalUrl: "https://example.com/zz" },
    { interactionType: "external-link", externalUrl: "" },
    { interactionType: "external-link" },
    { interactionType: "external-link", externalUrl: "javascript:alert(1)" },
  ];
  const objects: Partial<RoomObject>[] = [];
  let i = 0;
  for (const type of kinds) {
    for (const v of variants) {
      objects.push({
        id: `zz-${type}-${i++}`,
        type,
        label: "zz",
        labelAr: "zz",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        interactionRadius: 50,
        isWallMounted: false,
        ...(type === "door" && i % 2 ? { targetRoomId: "zz-legacy-shapes" } : {}),
        ...v,
      });
    }
  }
  return {
    "zz-legacy-shapes": {
      id: "zz-legacy-shapes",
      name: "zz legacy shapes",
      nameAr: "zz",
      schemaVersion: 5,
      width: 1520,
      height: 960,
      backgroundColor: "#000",
      walkableArea: { polygon: [] },
      entryPoints: [],
      objects,
    },
  };
}
