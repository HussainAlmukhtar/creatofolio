// Room system type definitions
// Modeled after classic click-to-walk virtual worlds (the Yukon room pattern),
// adapted for TypeScript + Phaser 3

import type { Localized } from "./landingTypes";

/**
 * Canonical room canvas size — locked globally as the main canvas of the
 * game. All rooms render and edit at this resolution; the size is NOT
 * adjustable per-room. Loaded rooms are coerced to these dimensions on
 * hydrate, and new drawings/backgrounds are exported at this aspect ratio.
 *
 * Aspect ratio: 19:12 (~1.58, close to 16:10) — wide enough for modern
 * screens but not so extreme it forces awkward letterboxing on 16:9.
 */
export const ROOM_WIDTH = 1520;
export const ROOM_HEIGHT = 960;

/**
 * RoomId is a free-form slug. Was a hard-coded TS union originally; loosened to
 * `string` so adding a room is a data change (insert into `rooms` + WorldView
 * "+ New Room") rather than a code change. The well-known slugs below are kept
 * as a non-enforced convenience list for the static fallback world and any
 * lingering `switch (roomId)` sites.
 */
export type RoomId = string;

/** The original built-in slugs. Use only where the static world is referenced. */
export type StaticRoomId =
  | "home"
  | "professional"
  | "gallery"
  | "archive"
  | "lab"
  | "shop"
  | "content"
  | "memory-lane";

export interface Point {
  x: number;
  y: number;
}

/** Where a player spawns when entering a room from a specific door */
export interface EntryPoint {
  /**
   * Stable opaque UUID — never user-edited, survives slug renames. The
   * canonical reference target for door `targetEntryPointIid`. Optional
   * during the dual-write window so pre-migration rows still type-check;
   * load-time coercion mints one if missing.
   */
  iid?: string;
  /** Human-readable slug (e.g. "from-home"). Edit-friendly but unstable. */
  id: string;
  x: number;
  y: number;
  direction: "left" | "right";
}

/** An interactive object inside a room */
export interface RoomObject {
  /**
   * Stable opaque UUID — never user-edited, survives slug renames. The
   * canonical reference target for cross-room links. Optional during the
   * dual-write window so pre-migration rows still type-check; load-time
   * coercion in roomCoerce.ts / migrations.ts mints one if missing.
   */
  iid?: string;
  /** Human-readable slug (e.g. "door-gallery"). Edit-friendly but unstable. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // 7c: "stairs" was just a door with a stair sprite — there was never a
  // runtime branch for it. Legacy `"stairs"` rows are coerced to `"door"` at
  // read time (gameData/editorData), so saved configs stay valid.
  type: "door" | "object" | "npc";
  label: string;
  labelAr: string;
  showLabel?: boolean;
  /**
   * For doors: stable iid of the target room. Preferred over `targetRoomId`.
   * During the dual-write window we set both; readers prefer the iid.
   */
  targetRoomIid?: string;
  /** For doors: human slug of the target room (deprecated; kept as a fallback). */
  targetRoomId?: RoomId;
  /** For doors: stable iid of the target entry point. Preferred. */
  targetEntryPointIid?: string;
  /** For doors: human slug of the target entry point (deprecated). */
  targetEntryPointId?: string;
  /** Radius for proximity interaction (click detection area) */
  interactionRadius: number;
  /** Is this mounted on the back wall? If true, player walks to X column on floor */
  isWallMounted: boolean;
  /** Where the player walks to before interacting (floor position) */
  moveTo?: Point;
  /**
   * LEGACY (dual-written): what happens on click, as the legacy runtime
   * understood it. `interactions` (below) is the source of truth now; every
   * writer derives this field (and `externalUrl`) from it with
   * `lib/objectActions.ts::withLegacyInteraction`, so a rollback to older
   * code still behaves sensibly with rooms saved by the new editor.
   *
   * Narrowed to the four values the runtime actually branches on:
   *   - "content"       (default) open the InteractionModal; the rendered view
   *                     is decided by the object_content row's own `content.type`.
   *   - "avatar-shop"   open the avatar creator instead of the content modal.
   *   - "external-link" open `externalUrl` in a new tab; no modal.
   *   - "none"          decoration — clicking just walks to the spot.
   *
   * Legacy values ("modal", "cv", "artwork") are coerced to "content"
   * at read time in gameData.ts / editorData.ts so existing rooms keep working.
   */
  interactionType?: "content" | "avatar-shop" | "external-link" | "none";
  /** Target for interactionType === "external-link" (legacy, dual-written). */
  externalUrl?: string;
  /**
   * "When clicked…" / "When the player walks near…" step lists.
   * Absent = derived from the legacy fields at read time (room
   * schema v6 fills it in; templates and the static seed rely on the
   * derivation). See lib/objectActions.ts.
   */
  interactions?: ObjectInteractions;
  /** Hover effect strength, 0.25–2 (default 1). Scales ObjectFx tweens. */
  hoverIntensity?: number;
  /** Starts hidden for this visit until a "Show / hide an object" step shows it. */
  hiddenAtStart?: boolean;
  /** Link to content in the database */
  contentId?: string;
  /**
   * Optional template category (e.g. "door", "plant") carried from the
   * object_templates row that spawned this object. Used for canvas tinting
   * and quick grouping. Pure metadata — the object works fine without it.
   */
  category?: string;
  /** Optional: depth override for rendering */
  zIndex?: number;
  /** URL to custom sprite image (replaces procedural drawing) */
  spriteUrl?: string;
  /** Optional animation config for animated sprites */
  spriteAnimation?: {
    frames: number;
    frameRate: number;
    frameWidth: number;
    frameHeight: number;
  };
  /** Rotation in degrees, clockwise, around the object's center. Default 0. */
  rotation?: number;
  /**
   * Editor-only layer lock: true = can't be moved / resized / rotated on the
   * canvas and clicks pass through it; false = free. Absent = the default
   * (free, unless it covers the whole room: lib/layerLock.ts). The game never
   * reads it. Not the zIndex pin ("Pin depth", `zIndex`).
   */
  locked?: boolean;
  /**
   * Custom hitbox polygon in the object's LOCAL space (0..width, 0..height),
   * pre-rotation. When omitted, the hitbox is the full width×height rectangle.
   */
  hitboxPolygon?: Point[];

  /**
   * What the object does while the pointer is over it. Omitted = "auto":
   * clickable things (doors, content, links) lift gently; decorations stay
   * still. See components/game/systems/ObjectFx.ts.
   */
  hoverEffect?: HoverEffect;
  /** Show the object's label as a little tag while hovered. */
  hoverLabel?: boolean;
  /**
   * Secret object: invisible until the pointer finds it, then fades in.
   * Pairs well with an Easter egg.
   */
  revealOnHover?: boolean;
  /** Optional Easter egg — a playful reaction on click(s) or hover. */
  easterEgg?: EasterEgg;
  /**
   * Hotspot only: no default drawing in the game (for doors/objects already
   * painted into the background). Ignored when the object has its own sprite.
   */
  invisible?: boolean;
}

export type HoverEffect = "auto" | "none" | "lift" | "grow" | "glow" | "wiggle" | "pulse";

export type EasterEggReaction =
  | "sparkle"
  | "confetti"
  | "spin"
  | "jump"
  | "wiggle"
  | "shake";

export interface EasterEgg {
  /** click = every click · clicks = after `count` clicks · hover = on hover. */
  trigger: "click" | "clicks" | "hover";
  /** For trigger "clicks": how many clicks it takes (default 5). */
  count?: number;
  reaction: EasterEggReaction;
  /** Optional speech bubble shown with the reaction. */
  message?: string;
  messageAr?: string;
  /** Only fire the first time per visit. */
  once?: boolean;
}

// ─── Actions ("When clicked…") ─────────────
//
// One model for everything an object does: an ordered list of steps run by
// components/game/systems/ActionRunner.ts. Pop-up, dialogue and link-confirm
// steps wait until the visitor closes them. References are iids only, so
// renames can't break them. Every URL goes through lib/safeUrl.ts (editor
// error + runtime refusal).

export type ObjectAction =
  /** This object's own pop-up. */
  | { kind: "popup" }
  /** Another object's pop-up (this room when `roomIid` is absent). */
  | { kind: "open-popup"; roomIid?: string; objectIid: string }
  /** Doors only: go through this door (its own targetRoomIid/EntryPointIid,
   *  so the rename rewrite + integrity checks keep working unchanged). */
  | { kind: "door" }
  | { kind: "go-to-room"; roomIid: string; entryPointIid?: string }
  /** New tab; `confirm` asks "leave the site?" first. */
  | { kind: "link"; url: string; confirm: boolean }
  | { kind: "email"; address: string; subject?: Localized }
  | { kind: "download"; url: string; fileName?: string }
  | { kind: "dialogue"; dialogue: Dialogue }
  | { kind: "effect"; reaction: EasterEggReaction; message?: Localized }
  | { kind: "sound"; url: string; volume?: number }
  | { kind: "toggle-object"; objectIid: string; mode: "show" | "hide" | "toggle" }
  /** Opens the visitor's character creator. */
  | { kind: "shop" }
  | { kind: "wait"; ms: number };

export type ObjectActionKind = ObjectAction["kind"];

/** "First visit only" = forever (localStorage); "session" = this visit. */
export type TriggerOnce = "never" | "session" | "forever";

export interface Trigger {
  actions: ObjectAction[];
  once?: TriggerOnce;
}

export interface NearTrigger extends Trigger {
  /** Off by default; the radius is the object's `interactionRadius`. */
  enabled?: boolean;
}

export interface ObjectInteractions {
  click?: Trigger;
  near?: NearTrigger;
}

/** A character's conversation in the bottom dialogue box. */
export interface Dialogue {
  speaker?: Localized;
  lines: DialogueLine[];
}

export interface DialogueLine {
  id: string;
  text: Localized;
  /** Answers shown after this line; picking one ends the conversation and
   *  runs its steps. */
  choices?: DialogueChoice[];
}

export interface DialogueChoice {
  id: string;
  label: Localized;
  actions: ObjectAction[];
}

/** Crop metadata recorded when a raw upload is fitted to ROOM_WIDTH × ROOM_HEIGHT. */
export interface BgCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/** Which art layer a background asset belongs to. Drives editor UI + storage path prefix. */
export type BgLayer = "back" | "middle" | "front";

/** Animated overlay effect rendered above the foreground image. */
export type ForegroundEffect = "rain" | "snow" | "cctv" | null;

/** Walkable area as a polygon (for collision body) */
export interface WalkableArea {
  /** Polygon vertices defining the walkable floor */
  polygon: Point[];
}

/** Full room configuration */
export interface RoomConfig {
  /**
   * Stable opaque UUID for the room itself. Distinct from `id` (the
   * human-typed slug). Optional during the dual-write window; load-time
   * coercion mints one if missing. Doors target this iid.
   */
  iid?: string;
  /**
   * Schema version of this row's persisted shape. Stamped on every save by
   * the migration registry (see data/migrations.ts). Optional on read so
   * legacy rows still parse; the registry treats absence as version 1.
   */
  schemaVersion?: number;
  id: RoomId;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;

  // Visual
  backgroundColor: string;

  // Three art layers, composed back-to-front around the gameplay layer:
  //   bgBackUrl    — "Behind everything"  (sky / sea / scenery)        depth -30
  //   bgMiddleUrl  — "The room"           (walls / floor / fixtures)   depth -20
  //   [player + objects render here, depth = y, between middle & front]
  //   bgFrontUrl   — "Above player"       (CCTV frame / overlays)      depth 8000
  //   foregroundEffect — animated FX (rain/snow/cctv)                  depth 8500 or 10500
  bgBackUrl?: string;
  bgBackOriginalPath?: string;
  bgBackCrop?: BgCrop;
  bgMiddleUrl?: string;
  bgMiddleOriginalPath?: string;
  bgMiddleCrop?: BgCrop;
  bgFrontUrl?: string;
  bgFrontOriginalPath?: string;
  bgFrontCrop?: BgCrop;
  foregroundEffect?: ForegroundEffect;
  /** When true, foregroundEffect renders above HUD/UI for fully-immersive scenes. */
  foregroundEffectAboveUI?: boolean;

  // Dimensions (canvas design size)
  width: number;
  height: number;

  // Collision
  walkableArea: WalkableArea;

  // Spawn points
  entryPoints: EntryPoint[];

  // Interactive objects (doors, furniture, wall items)
  objects: RoomObject[];

  /**
   * Worlds: every room belongs to a world and has a
   * position+size in it. Optional during the dual-write window so legacy
   * rows still parse; load-time coercion fills sensible defaults
   * (worldIid="" → "main" world; worldX/Y=0; worldW/H = ROOM_WIDTH/HEIGHT).
   * The DB-side migration `003_worlds.ts` backfills real values.
   */
  worldIid?: string;
  worldX?: number;
  worldY?: number;
  worldW?: number;
  worldH?: number;

  /**
   * Per-room free-form bag stored alongside `config` in the rooms.config
   * JSONB column (the room's whole config IS that JSONB, so this is just a
   * nested object). Add fields freely; readers MUST treat each as optional.
   *
   * Added so the dynamic minimap can show a
   * per-room emoji and a future `customSceneId` switch can opt a room out
   * of the default `DynamicRoomScene` behaviour.
   */
  config?: RoomSettings;

  /**
   * "Step through pop-ups": while one of this room's
   * pop-ups is open, arrows (and ←/→, mirrored in Arabic) go to the
   * previous / next one. Off by default. `order` = object iids in the
   * author's order; objects not listed follow, left to right.
   */
  popupNav?: PopupNav;

  /**
   * The room's name tag in the game's top-left corner (a small paper tag in
   * the site's display font). Absent = follow the world's setting, no icon.
   */
  nameTag?: RoomNameTag;
}

export interface RoomNameTag {
  /** "world" (default) follows `WorldSettings.roomNameTags`. */
  show?: "world" | "show" | "hide";
  /** Icon before the name (after it in Arabic). Default none. */
  icon?: "none" | "pin" | "art";
  /** The owner's drawing or upload, used when `icon` is "art". */
  art?: { url: string; sceneId?: string; w: number; h: number } | null;
}

export interface PopupNav {
  enabled: boolean;
  order?: string[];
}

/** Per-room settings nested under `RoomConfig.config`. All fields optional. */
export interface RoomSettings {
  /** Emoji shown in the runtime minimap. Falls back to a generic door icon. */
  minimapEmoji?: string;
  /**
   * If set, `DynamicRoomScene` may switch on this id to layer custom
   * per-room behaviour on top of `BaseRoomScene`. Reserved for future use;
   * `DynamicRoomScene` ignores unknown ids today.
   */
  customSceneId?: string;
}

/** Layout strategy for a World — drives WorldView snapping/affordances. */
export type WorldLayout = "free" | "gridvania" | "linear";

/**
 * A World wraps a set of rooms with a spatial layout + metadata. A site can
 * have several worlds (the World view creates, switches and deletes them);
 * the default is `id="main"`, created by `scripts/migrations/003_worlds.ts`.
 */
export interface WorldConfig {
  iid: string;
  id: string;
  name: string;
  layout: WorldLayout;
  gridWidth?: number;
  gridHeight?: number;
  schemaVersion: number;
  /**
   * Free-form world-level settings persisted in the `worlds.config` JSONB
   * column. New knobs land here without a schema migration. Optional so
   * pre-existing rows still type-check.
   */
  config?: WorldSettings;
}

/**
 * Settings stored inside `worlds.config` JSONB. Add fields freely — readers
 * MUST treat every field as optional so older rows don't break.
 */
export interface WorldSettings {
  /** Default width for newly-created rooms. Falls back to ROOM_WIDTH. */
  defaultRoomWidth?: number;
  /** Default height for newly-created rooms. Falls back to ROOM_HEIGHT. */
  defaultRoomHeight?: number;
  /** Default foreground effect for newly-created rooms. */
  defaultForegroundEffect?: ForegroundEffect;
  /** When true, saveRoom mirrors to app/world/{slug}/rooms/{slug}.json. */
  externalFilesEnabled?: boolean;
  /** Slug of the room players land in when entering the world. Falls back to "home". */
  defaultRoomId?: string;
  /** The live world is the one the public game plays (see setLiveWorld). */
  live?: boolean;
  /** Show each room's name tag in the game (default true); rooms can override. */
  roomNameTags?: boolean;
}

/**
 * Legacy in-memory wrapper around the static fallback rooms. Kept so the
 * `staticWorld.rooms` accessor used across runtime + tests doesn't have to
 * be touched in the same change as the World rollout. New code should
 * prefer `WorldConfig` (the row-shape) and a separate `Record<RoomId,
 * RoomConfig>` rooms map.
 */
export interface StaticWorldBundle {
  /**
   * Indexed by `string` (not `StaticRoomId`) so callers passing a
   * dynamically-loaded `RoomId` can do `staticWorld.rooms[roomId]` without
   * a type assertion. The named slugs are still present at runtime — this
   * is purely a typing convenience for the index signature.
   */
  rooms: Record<string, RoomConfig> & Record<StaticRoomId, RoomConfig>;
}
