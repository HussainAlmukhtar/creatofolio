// Integrity check — pure function over a `Record<roomId, RoomConfig>` that
// returns a flat list of issues. Inspired by Twine's storygraph warnings and
// Unreal's Map Check. Surfaced via the IssuesPanel.
//
// Issues are *findable* (they include roomId + objectId) so the panel can
// jump-to-fix when clicked.

import type { RoomConfig, RoomObject, WorldConfig } from "@/data/roomTypes";
import type { ObjectContent } from "@/data/contentTypes";
import { neighboursOf } from "@/lib/neighbours";
import { isPointInPolygon as isPointInPolygonShared } from "@/lib/geometry";
import { urlProblem } from "@/lib/safeUrl";
import { contentTranslation } from "@/lib/localizedChecks";
import { allBlocks } from "@/data/popupTree";
import { migrateObjectContent } from "@/data/contentMigrations";
import type { TipTapNode } from "@/data/contentTypes";
import {
  allSteps,
  clickTriggerOf,
  describeStep,
  isClickable,
  roomByIid,
  stepProblem,
  stepTranslationGaps,
} from "@/lib/objectActions";

/** Links inside a pop-up that safeUrl would refuse (rich-text links, links
 *  blocks, buttons). Empty strings don't count: those are just unfinished. */
function unsafePopupLinks(raw: ObjectContent): string[] {
  const c = migrateObjectContent(raw);
  const out: string[] = [];
  const check = (v: unknown) => {
    if (typeof v === "string" && v.trim() && urlProblem(v, "link")) out.push(v);
  };
  const walkDoc = (n?: TipTapNode) => {
    if (!n) return;
    for (const m of n.marks ?? []) if (m.type === "link") check(m.attrs?.href);
    n.content?.forEach(walkDoc);
  };
  for (const b of allBlocks(c)) {
    const p = b.props as Record<string, unknown>;
    if (b.type === "rich-text") {
      const doc = p.doc as { en?: TipTapNode; ar?: TipTapNode } | undefined;
      walkDoc(doc?.en);
      walkDoc(doc?.ar);
    } else if (b.type === "links") {
      for (const l of (p.links as { url?: string }[]) ?? []) check(l.url);
    } else if (b.type === "button") {
      if (p.kind === "download") check(p.file);
      else if (p.kind !== "email") check(p.href);
    } else if (b.type === "project-card" || b.type === "contact") {
      for (const l of (p.links as { url?: string }[]) ?? []) check(l.url);
    } else if (b.type === "file-download") {
      check(p.file);
    }
  }
  return out;
}

// Wrapper kept for the existing call sites that pass (x, y, polygon)
// instead of (point, polygon). Backed by the shared geometry helper.
function isPointInPolygon(
  x: number,
  y: number,
  polygon: { x: number; y: number }[]
): boolean {
  return isPointInPolygonShared({ x, y }, polygon);
}

/**
 * Resolve a door's intended target room. Prefers the stable iid (rename-proof);
 * falls back to the legacy slug for rows that haven't been re-saved since iids
 * landed. Returns null only when both lookups fail.
 *
 * Exported so the game runtime, the IssuesPanel, and the WorldView all use
 * the same resolution logic.
 */
export function resolveDoorTargetRoom(
  obj: Pick<RoomObject, "targetRoomIid" | "targetRoomId">,
  rooms: Record<string, RoomConfig>
): RoomConfig | null {
  if (obj.targetRoomIid) {
    for (const r of Object.values(rooms)) {
      if (r?.iid === obj.targetRoomIid) return r;
    }
  }
  if (obj.targetRoomId && rooms[obj.targetRoomId]) {
    return rooms[obj.targetRoomId];
  }
  return null;
}

export type IssueSeverity = "error" | "warning";

export interface Issue {
  id: string;
  severity: IssueSeverity;
  roomId: string;
  objectId?: string;
  entryPointId?: string;
  /** Short human label shown in the issues panel row. */
  message: string;
  /** Optional one-line description with context / how to fix. */
  description?: string;
}

/**
 * Scan all loaded room configs and return every detected issue.
 *
 * Pure — no side effects, no I/O. Safe to call on every save or panel open.
 */
export function runIntegrityCheck(
  rooms: Record<string, RoomConfig>,
  /**
   * Optional world context. When provided AND `world.layout === "gridvania"`,
   * orphan detection is upgraded — a room counts as reachable if it has any
   * adjacent neighbour in the world grid (check #5).
   */
  world?: WorldConfig | null,
  /**
   * Optional pop-up content keyed "roomId:objectId" (the editor store's
   * contentMap). When given, pop-ups are checked too: an Arabic title,
   * half-translated text in their blocks, and links that would be refused.
   */
  contentMap?: Record<string, ObjectContent>
): Issue[] {
  const issues: Issue[] = [];
  const knownRoomIds = new Set(Object.keys(rooms));

  // Track which rooms have an inbound door so we can flag orphans.
  const reachable = new Set<string>();

  /**
   * Group all doors by their target (roomIid + entryPointIid|slug). Used by
   * check #1 (two doors share entry point) and check #2 (entry point unused).
   * Built once below.
   */
  type DoorRef = { roomId: string; obj: RoomObject };
  const doorsByTarget = new Map<string, DoorRef[]>();

  for (const [roomId, cfg] of Object.entries(rooms)) {
    for (const obj of cfg.objects) {
      // Door: target room must exist; entry point (if set) must exist in
      // the target room. (7c collapsed "stairs" into "door".) Resolution
      // prefers iid (rename-proof) and falls back to slug.
      if (obj.type === "door") {
        // Index this door under its target for the post-loop shared-entry
        // and unused-entry-point checks.
        const target0 = resolveDoorTargetRoom(obj, rooms);
        if (target0) {
          const epRef0 =
            obj.targetEntryPointIid ?? obj.targetEntryPointId ?? "_default";
          const key = `${target0.iid ?? target0.id}::${epRef0}`;
          const list = doorsByTarget.get(key) ?? [];
          list.push({ roomId, obj });
          doorsByTarget.set(key, list);
        }

        const target = target0;
        const hasAnyTarget = obj.targetRoomIid || obj.targetRoomId;

        if (!hasAnyTarget) {
          issues.push({
            id: `${roomId}:${obj.id}:no-target-room`,
            severity: "error",
            roomId,
            objectId: obj.id,
            message: `${labelOf(obj)} → no target room`,
            description: "Pick a target room from the dropdown.",
          });
        } else if (!target) {
          // Both lookups failed — bad iid AND bad slug, or only one set and
          // it doesn't resolve.
          const shown = obj.targetRoomId ?? obj.targetRoomIid ?? "?";
          issues.push({
            id: `${roomId}:${obj.id}:unknown-target-room`,
            severity: "error",
            roomId,
            objectId: obj.id,
            message: `${labelOf(obj)} → unknown room "${shown}"`,
            description:
              "The target doesn't match any loaded room. Re-pick from the dropdown to refresh the link.",
          });
        } else {
          reachable.add(target.id);

          // Stale-slug warning: iid resolved fine but the stored slug points
          // somewhere else (e.g. the room was renamed). Not fatal — the iid
          // wins — but the user should re-pick to clean up the stale slug.
          if (
            obj.targetRoomIid &&
            obj.targetRoomId &&
            obj.targetRoomId !== target.id
          ) {
            issues.push({
              id: `${roomId}:${obj.id}:stale-slug`,
              severity: "warning",
              roomId,
              objectId: obj.id,
              message: `${labelOf(obj)} → stale slug "${obj.targetRoomId}" (iid resolves to "${target.id}")`,
              description:
                "The target room was likely renamed. Re-pick the target to refresh the saved slug.",
            });
          }

          // Validate the entry point if one was specified. Resolution again
          // prefers iid; falls back to slug within the resolved room.
          const epRef = obj.targetEntryPointIid ?? obj.targetEntryPointId;
          if (epRef) {
            const epByIid = obj.targetEntryPointIid
              ? target.entryPoints.find(
                  (ep) => ep.iid === obj.targetEntryPointIid
                )
              : undefined;
            const epBySlug = obj.targetEntryPointId
              ? target.entryPoints.find(
                  (ep) => ep.id === obj.targetEntryPointId
                )
              : undefined;
            if (!epByIid && !epBySlug) {
              issues.push({
                id: `${roomId}:${obj.id}:bad-entry-point`,
                severity: "error",
                roomId,
                objectId: obj.id,
                message: `${labelOf(obj)} → entry point "${epRef}" missing`,
                description: `The target room has no entry point with that id.`,
              });
            }
          }
        }

        // ── Door has no `moveTo` (check #3) ──
        // Without one, the player walks to the door's center, which often
        // sits inside the door's hitbox.
        if (!obj.moveTo) {
          issues.push({
            id: `${roomId}:${obj.id}:door-no-moveto`,
            severity: "warning",
            roomId,
            objectId: obj.id,
            message: `${labelOf(obj)} → no move-to point`,
            description:
              "Set a moveTo so the player stops in front of the door, not on top of it.",
          });
        }

        // ── Door not inside walkable area (check #4) ──
        // The moveTo (or door center if missing) must be inside the room's
        // walkable polygon, otherwise the player can never reach the door.
        const checkPoint = obj.moveTo ?? {
          x: obj.x + obj.width / 2,
          y: obj.y + obj.height / 2,
        };
        const poly = cfg.walkableArea?.polygon ?? [];
        if (
          poly.length >= 3 &&
          !isPointInPolygon(checkPoint.x, checkPoint.y, poly)
        ) {
          issues.push({
            id: `${roomId}:${obj.id}:door-not-walkable`,
            severity: "error",
            roomId,
            objectId: obj.id,
            message: `${labelOf(obj)} → outside walkable area`,
            description:
              "Player can't reach this door. Either move it inside the walkable polygon or extend the polygon to include its move-to point.",
          });
        }
      }

      // "When clicked…" / "walks near" steps: empty or
      // unsafe links, missing rooms/objects (dangling iids), empty
      // conversations. Objects without stored steps are checked on the steps
      // derived from their legacy fields, so an unsafe external link still
      // shows up.
      const steps = obj.interactions
        ? allSteps(obj.interactions)
        : clickTriggerOf(obj).actions;
      const ctx = { rooms, room: cfg };
      steps.forEach((step, i) => {
        if (step.kind === "go-to-room") {
          const t = roomByIid(rooms, step.roomIid);
          if (t) reachable.add(t.id);
        }
        if (step.kind === "door") return; // the door rules above cover it
        const p = stepProblem(step, ctx);
        if (!p) return;
        issues.push({
          id: `${roomId}:${obj.id}:step-${i}-${step.kind}`,
          severity: p.severity,
          roomId,
          objectId: obj.id,
          message: `${labelOf(obj)} → step “${describeStep(step, ctx, obj)}” needs fixing`,
          description: p.message,
        });
      });

      // Sprite without a label — minor, but surfaces silent UI issues.
      if (!obj.label || obj.label.trim() === "") {
        issues.push({
          id: `${roomId}:${obj.id}:no-label`,
          severity: "warning",
          roomId,
          objectId: obj.id,
          message: `Object "${obj.id}" → no label`,
          description: "Add a human-readable label so it shows up in tooltips.",
        });
      }
    }
  }

  // ── Shared entry point (check #1) ──
  // Two doors targeting the same (room, entry-point) make the player teleport
  // to the same spot — usually a bug. Flag every member of the colliding group.
  for (const [, group] of doorsByTarget) {
    if (group.length < 2) continue;
    const others = group
      .map((d) => `${d.roomId}/${d.obj.id}`)
      .join(", ");
    for (const d of group) {
      issues.push({
        id: `${d.roomId}:${d.obj.id}:shared-entry-point`,
        severity: "warning",
        roomId: d.roomId,
        objectId: d.obj.id,
        message: `${labelOf(d.obj)} → shares entry point with another door`,
        description: `Doors targeting the same entry point: ${others}.`,
      });
    }
  }

  // ── Unused entry point (check #2) ──
  // For each room's entry points, check whether ANY door in ANY room points
  // at it (by iid OR slug). Skip "default" since that's the initial-load entry.
  for (const [roomId, cfg] of Object.entries(rooms)) {
    for (const ep of cfg.entryPoints ?? []) {
      if (ep.id === "default") continue;
      let used = false;
      for (const cfg2 of Object.values(rooms)) {
        for (const obj of cfg2.objects ?? []) {
          if (obj.type !== "door") continue;
          const target = resolveDoorTargetRoom(obj, rooms);
          if (target?.id !== roomId) continue;
          if (
            (obj.targetEntryPointIid && ep.iid && obj.targetEntryPointIid === ep.iid) ||
            (obj.targetEntryPointId && obj.targetEntryPointId === ep.id)
          ) {
            used = true;
            break;
          }
        }
        if (used) break;
      }
      if (!used) {
        issues.push({
          id: `${roomId}:${ep.id}:entry-point-unused`,
          severity: "warning",
          roomId,
          entryPointId: ep.id,
          message: `Entry point "${ep.id}" → unused`,
          description:
            "No door references this entry point. Either delete it or wire a door to it.",
        });
      }
    }
  }

  // ── Missing Arabic (warnings only: never blocks a save or Publish) ──
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  const missingAr = (en: unknown, ar: unknown) => !blank(en) && blank(ar);
  for (const [roomId, cfg] of Object.entries(rooms)) {
    if (missingAr(cfg.name, cfg.nameAr)) {
      issues.push({
        id: `${roomId}:no-name-ar`,
        severity: "warning",
        roomId,
        message: `Room "${cfg.name}" → no Arabic name`,
        description: "Fill the Name (AR) field in Room Properties.",
      });
    }
    if (missingAr(cfg.description, cfg.descriptionAr)) {
      issues.push({
        id: `${roomId}:no-description-ar`,
        severity: "warning",
        roomId,
        message: `Room "${cfg.name || roomId}" → no Arabic description`,
        description: "Fill the Description (AR) field in Room Properties.",
      });
    }
    for (const obj of cfg.objects ?? []) {
      const clickable = obj.type === "door" || obj.type === "npc" || isClickable(obj);
      if (clickable && missingAr(obj.label, obj.labelAr)) {
        issues.push({
          id: `${roomId}:${obj.id}:no-label-ar`,
          severity: "warning",
          roomId,
          objectId: obj.id,
          message: `${labelOf(obj)} → no Arabic label`,
          description: "Fill the Label (AR) field so Arabic visitors see a tooltip.",
        });
      }
      const stepGaps = allSteps(obj.interactions).reduce((n, st) => n + stepTranslationGaps(st), 0);
      if (stepGaps) {
        issues.push({
          id: `${roomId}:${obj.id}:steps-half-translated`,
          severity: "warning",
          roomId,
          objectId: obj.id,
          message: `${labelOf(obj)} → step text is half-translated (${stepGaps})`,
          description: "A speech bubble, email subject or conversation line has only one language. Open the object's steps and fill the other.",
        });
      }
      const c = contentMap?.[`${roomId}:${obj.id}`];
      if (c && missingAr(c.title, c.titleAr)) {
        issues.push({
          id: `${roomId}:${obj.id}:content-title-ar`,
          severity: "warning",
          roomId,
          objectId: obj.id,
          message: `${labelOf(obj)} → pop-up has no Arabic title`,
          description: "Open the object's content and fill the Arabic title.",
        });
      }
      if (c) {
        // Blocks only: the title has its own rule just above.
        const gaps = contentTranslation(c).gaps.filter((g) => g.path[0] !== "title");
        if (gaps.length) {
          issues.push({
            id: `${roomId}:${obj.id}:popup-half-translated`,
            severity: "warning",
            roomId,
            objectId: obj.id,
            message: `${labelOf(obj)} → pop-up text is half-translated (${gaps.length})`,
            description: `${gaps[0].filled === "en" ? "Arabic" : "English"} is missing for “${gaps[0].preview}”. Open the pop-up: the Arabic badge lists every spot.`,
          });
        }
        const bad = unsafePopupLinks(c);
        if (bad.length) {
          issues.push({
            id: `${roomId}:${obj.id}:popup-unsafe-link`,
            severity: "warning",
            roomId,
            objectId: obj.id,
            message: `${labelOf(obj)} → pop-up has a link visitors can't open`,
            description: `“${bad[0]}”: ${urlProblem(bad[0], "link")}`,
          });
        }
      }
    }
  }

  // Orphan rooms: no inbound door from any other room. Skip "home" since it's
  // the conventional entry point. In gridvania mode, having any neighbour
  // softens this to a stricter "no inbound AND no neighbours" check.
  const isGridvania = world?.layout === "gridvania";
  for (const roomId of knownRoomIds) {
    if (roomId === "home") continue;
    if (reachable.has(roomId)) continue;

    if (isGridvania) {
      const cfg = rooms[roomId];
      const nb = cfg ? neighboursOf(cfg, rooms) : null;
      const hasNeighbour = !!(nb && (nb.n || nb.s || nb.e || nb.w));
      if (hasNeighbour) {
        // In gridvania, a room with a neighbour is "reachable enough" for
        // the soft warning — but we still want to flag the doubly-suspicious
        // case (no inbound AND no neighbours) below.
        continue;
      }
      issues.push({
        id: `${roomId}:gridvania-isolated`,
        severity: "warning",
        roomId,
        message: `Room "${rooms[roomId].name ?? roomId}" is isolated`,
        description:
          "No inbound doors and no adjacent rooms in the world grid. Players can't reach it.",
      });
      continue;
    }

    issues.push({
      id: `${roomId}:no-inbound`,
      severity: "warning",
      roomId,
      message: `Room "${rooms[roomId].name ?? roomId}" has no inbound door`,
      description:
        "No other room links to this one — players can only reach it via direct URL.",
    });
  }

  return issues;
}

function labelOf(obj: RoomObject): string {
  return obj.label?.trim() || obj.id;
}
