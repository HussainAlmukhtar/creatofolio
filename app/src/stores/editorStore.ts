import { create } from "zustand";
import { temporal } from "zundo";
import type {
  RoomConfig,
  RoomId,
  RoomObject,
  Point,
  EntryPoint,
} from "@/data/roomTypes";
import { ROOM_WIDTH, ROOM_HEIGHT } from "@/data/roomTypes";
import { remapInteractions, templateBehaviourOf } from "@/lib/objectActions";
import { newIid } from "@/lib/iid";
import { isRoomObjectLocked } from "@/lib/layerLock";
import { staticWorld } from "@/data/staticRooms";
import type { ObjectContent } from "@/data/contentTypes";
import { migrateContentMap } from "@/data/contentMigrations";
import { staticContent } from "@/data/staticContent";
import { clearDraft } from "@/lib/draftStore";
import {
  saveRoom,
  loadRoomForEditor,
  loadRoomRevisions,
  saveContent,
  deleteContent,
  deleteDrawingScene,
  loadAllRoomsForEditor,
  loadAllContent,
  loadLiveContentRows,
  saveRoomDraft,
  publishRoomDraft,
  discardRoomDraft,
  loadDefaultWorld,
  writeRoomFile,
  copyDrawingScene,
  saveTemplate,
  type NewTemplate,
  type TemplateCategory,
  type TemplateRequiredField,
} from "@/lib/editorData";

// ─── Types ───────────────────────────────────────────────────

export type EditorTool =
  | "select"
  | "add-object"
  | "walkable-area"
  | "edit-hitbox"
  | "entry-points"
  | "pan";

// 7c: dropped "stairs" — fold into "door" (visual variant only).
export type AddObjectType = "door" | "object" | "npc";

export interface EditorState {
  // Current room being edited
  currentRoomId: RoomId | null;
  currentRoomConfig: RoomConfig | null;

  // Selection
  selectedObjectId: string | null;
  /**
   * Every selected object (multi-select). Always contains `selectedObjectId`
   * when that's set; `selectedObjectId` is the "primary" (last clicked) one
   * that single-object UI (side panel, hitbox tool) works on.
   */
  selectedObjectIds: string[];
  selectedEntryPointId: string | null;

  // Tools
  activeTool: EditorTool;
  addObjectType: AddObjectType;
  gridEnabled: boolean;
  gridSize: number;

  // Editor mode
  mode: "edit" | "preview";

  // All rooms (for room switching, door target dropdowns)
  allRooms: Record<string, RoomConfig>;

  // Content
  contentMap: Record<string, ObjectContent>; // keyed by "roomId:objectId"
  editingContentObjectId: string | null;

  // Dirty tracking. `isDirty` is the CURRENT room; `dirtyRoomIds` holds
  // other rooms edited earlier this session and not saved yet (switching
  // rooms used to reset isDirty and silently strand those edits).
  isDirty: boolean;
  dirtyRoomIds: string[];
  // Content edited this session ("roomId:objectId") — saved on next Save.
  dirtyContentKeys: string[];
  // Content rows to delete on next Save (object deleted/renamed).
  // `renamedTo`: the id an object was renamed to (its drawing layers were
  // copied there) — removed on Save if the rename was undone.
  pendingContentDeletes: { roomId: string; objectId: string; renamedTo?: string }[];
  // Rooms whose object_content rows have been pulled from the DB.
  contentLoadedRoomIds: string[];

  // Hydration (true once rooms/content have been pulled from Supabase at least once)
  isHydrated: boolean;

  // rooms.updated_at per room as this tab last saw it (the optimistic-
  // concurrency token for saveRoom). null = known not to be in the DB yet.
  // Deliberately outside zundo's partialize (see the temporal options below).
  roomRevisions: Record<string, string | null>;

  // Room drafts: Save writes ONE draft per room, Publish makes it live.
  // false = room_drafts / publish_room_draft aren't in the database yet
  // (migration 20261005000001_room_drafts) → Save writes live exactly as before.
  draftsAvailable: boolean;
  // roomId → room_drafts.updated_at (the saveRoomDraft concurrency token).
  // Presence = the room has an unpublished draft. Outside zundo's partialize.
  roomDrafts: Record<string, string>;
  // roomId → the draft's pop-up content map (null = untouched: live rows apply).
  draftContent: Record<string, Record<string, ObjectContent> | null>;

  // Panel toggles
  showAssetLibrary: boolean;

  // Map: object id → list of field names the user must fill before save.
  // Set when a template is dropped that declared required_fields. The side
  // panel reads this to render an inline prompt.
  pendingRequiredFields: Record<string, TemplateRequiredField[]>;

  // Walk-to picker — id of the object currently
  // awaiting a "click on the canvas to set walk-to" pick. Set when the
  // side-panel crosshair button fires; cleared by the canvas after the
  // next click commits, or by Esc / clicking the button again.
  pendingMoveToPickFor: string | null;

  // Workspace-only object visibility state.
  // NOT persisted (an author tool, not data). Keyed by object slug since the
  // panel works in the current room and slugs are unique within a room. Reset
  // whenever you reload a room. (The LOCK is data now: `RoomObject.locked`.)
  hiddenObjectIds: Set<string>;
}

export interface SaveResult {
  ok: boolean;
  roomError?: string;
  contentErrors: string[];
  /** Nothing was dirty, so nothing was written. */
  nothingToSave?: boolean;
  /** Rooms someone else changed since this tab loaded them. They stay dirty;
   *  the other rooms in the same Save went through. */
  conflicts?: { roomId: string; theirsUpdatedAt?: string }[];
}

export interface HydrationResult {
  source: "supabase" | "static" | "missing";
  error?: string;
}

export interface EditorActions {
  // Room operations
  loadRoom: (roomId: RoomId) => void;
  updateRoom: (partial: Partial<RoomConfig>) => void;

  // Object operations
  selectObject: (id: string | null) => void;
  /** Shift/Ctrl-click: add or remove one object from the selection. */
  toggleObjectSelection: (id: string) => void;
  /** Replace the selection (marquee, select-all). */
  setSelection: (ids: string[]) => void;
  /** Move several objects by a delta — one undo step. */
  moveObjects: (ids: string[], dx: number, dy: number) => void;
  /** Group transform (resize/rotate several) — one undo step. */
  transformObjects: (
    list: { id: string; x: number; y: number; width: number; height: number; rotation: number }[]
  ) => void;
  deleteObjects: (ids: string[]) => void;
  duplicateObjects: (ids: string[]) => void;
  alignObjects: (
    ids: string[],
    mode: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"
  ) => void;
  distributeObjects: (ids: string[], axis: "x" | "y") => void;
  addObject: (obj: RoomObject) => void;
  updateObject: (id: string, partial: Partial<RoomObject>) => void;
  deleteObject: (id: string) => void;
  /** Rename an object's slug — keeps selection, content and drawing attached. */
  renameObject: (oldId: string, newId: string) => { ok: boolean; error?: string };
  duplicateObject: (id: string) => void;
  moveObject: (id: string, x: number, y: number) => void;
  resizeObject: (id: string, width: number, height: number) => void;
  /**
   * Apply a whole canvas transform (move + resize + rotate) as ONE update, so
   * a resize gesture is one undo step with no intermediate render.
   */
  transformObject: (
    id: string,
    t: { x: number; y: number; width: number; height: number; rotation: number }
  ) => void;

  // Layer ordering — Photoshop-style. Auto Y-sort is the default; these
  // assign a `zIndex` that pins the object relative to its current siblings.
  bringToFront: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  sendToBack: (id: string) => void;
  lockLayer: (id: string) => void;
  resetLayer: (id: string) => void;
  reorderObjects: (orderedIds: string[]) => void;

  // Object hitbox (custom polygon + rotation)
  setObjectRotation: (id: string, degrees: number) => void;
  seedObjectHitboxFromRect: (id: string) => void;
  resetObjectHitbox: (id: string) => void;
  updateObjectVertex: (id: string, index: number, point: Point) => void;
  addObjectVertex: (id: string, index: number, point: Point) => void;
  deleteObjectVertex: (id: string, index: number) => void;

  // Walkable area
  updateWalkablePolygon: (polygon: Point[]) => void;
  updateWalkableVertex: (index: number, point: Point) => void;
  addWalkableVertex: (index: number, point: Point) => void;
  deleteWalkableVertex: (index: number) => void;

  // Entry points
  selectEntryPoint: (id: string | null) => void;
  addEntryPoint: (ep: EntryPoint) => void;
  updateEntryPoint: (id: string, partial: Partial<EntryPoint>) => void;
  deleteEntryPoint: (id: string) => void;
  renameEntryPoint: (oldId: string, newId: string) => { ok: boolean; error?: string };

  // Tools & mode
  setTool: (tool: EditorTool) => void;
  setAddObjectType: (type: AddObjectType) => void;
  toggleGrid: () => void;
  setGridSize: (size: number) => void;
  setMode: (mode: "edit" | "preview") => void;

  // Content
  updateContent: (objectId: string, content: ObjectContent) => void;
  /** Put an object's pop-up back exactly as it was (composer "Revert"):
   *  the content (null = none) AND whether it counted as an unsaved edit. */
  restoreContent: (objectId: string, content: ObjectContent | null, wasDirty: boolean) => void;
  openContentEditor: (objectId: string) => void;
  closeContentEditor: () => void;

  // Panel toggles
  toggleAssetLibrary: () => void;

  // Templates
  saveObjectAsTemplate: (
    objectId: string,
    meta: {
      name: string;
      nameAr?: string;
      category: TemplateCategory;
      tags: string[];
      requiredFields?: TemplateRequiredField[];
    }
  ) => Promise<{ ok: boolean; error?: string; id?: string; behaviourDropped?: boolean }>;
  setPendingRequiredFields: (
    objectId: string,
    fields: TemplateRequiredField[]
  ) => void;
  clearPendingRequiredFields: (objectId: string) => void;

  // Workspace toggle for outline/canvas.
  toggleObjectHidden: (objectId: string) => void;
  /**
   * Layer lock (stored `RoomObject.locked`; absent = free, unless the object
   * covers the whole room). One undo step, marks the room dirty, saved with
   * the draft. Several ids: if any is free they all lock, else they all unlock.
   * Returns the new state (null = nothing found).
   */
  toggleObjectsLock: (ids: string[]) => boolean | null;
  clearWorkspaceFlags: () => void;

  // Walk-to picker.
  setPendingMoveToPickFor: (objectId: string | null) => void;
  clearPendingMoveToPickFor: () => void;

  /** Swap in a whole room config (backup restore, draft restore). */
  replaceCurrentRoom: (config: RoomConfig, dirty: boolean) => void;

  // Persistence
  markClean: () => void;
  /** `forceRoomIds`: rooms to write even though another writer changed them
   *  (the conflict dialog's "Overwrite"). */
  saveToSupabase: (opts?: { forceRoomIds?: string[] }) => Promise<SaveResult>;
  hydrateFromSupabase: () => Promise<HydrationResult>;
  /** Re-read every room's updated_at (after a write this tab made elsewhere). */
  refreshRoomRevisions: () => Promise<void>;
  /** Replace one room with the DB copy (conflict "load theirs"). */
  reloadRoomFromDb: (roomId: string) => Promise<boolean>;
  /** Save (if dirty), then copy the room's draft live. `force` publishes over a
   *  live room that changed elsewhere (the "Publish anyway" choice). */
  publishRoom: (roomId: string, opts?: { force?: boolean }) => Promise<PublishOutcome>;
  /** Delete the room's draft and reload the live room into the editor. */
  discardDraft: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface PublishOutcome {
  ok: boolean;
  error?: string;
  /** The live room changed since this tab last saw it. */
  liveChanged?: boolean;
  /** The save that came first failed (error is its message) or hit a conflict. */
  saveFailed?: boolean;
  /** There was nothing to publish (no draft). */
  nothingToPublish?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function updateObjectInList(
  objects: RoomObject[],
  id: string,
  partial: Partial<RoomObject>
): RoomObject[] {
  return objects.map((obj) =>
    obj.id === id ? { ...obj, ...partial } : obj
  );
}

// ─── Layer ordering ───
// Pinned zIndex sits between the back-most art layer (-30/-20) and the
// front overlay (+8000). Integer spacing keeps repeated clicks drift-free —
// Bring to Front eventually saturates at Z_MAX, never accumulates fractions.
const Z_MIN = -15;
const Z_MAX = 7000;
const Z_STEP = 10;
const effDepth = (o: RoomObject): number => o.zIndex ?? o.y;
const clampZ = (n: number): number =>
  Math.max(Z_MIN, Math.min(Z_MAX, Math.round(n)));

/**
 * Force a room config to the canonical canvas size. The room canvas is
 * the main game viewport — locking it globally means we don't need to
 * worry about per-room aspect ratios in the renderer, the editor, or the
 * drawing studio's export bounds.
 */
function coerceRoomSize(config: RoomConfig): RoomConfig {
  if (config.width === ROOM_WIDTH && config.height === ROOM_HEIGHT) {
    return config;
  }
  return { ...config, width: ROOM_WIDTH, height: ROOM_HEIGHT };
}

function coerceAllRoomSizes(
  rooms: Record<string, RoomConfig>
): Record<string, RoomConfig> {
  const out: Record<string, RoomConfig> = {};
  for (const [id, config] of Object.entries(rooms)) {
    out[id] = coerceRoomSize(config);
  }
  return out;
}

// Object / entry-point slugs: free-form but URL/key-safe.
const OBJECT_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Pull a room's object_content rows into the store once per session. Entries
 * already edited locally (dirty) win over what's in the DB.
 */
async function ensureContentLoaded(roomId: string): Promise<void> {
  const state = useEditorStore.getState();
  if (state.contentLoadedRoomIds.includes(roomId)) return;
  useEditorStore.setState({
    contentLoadedRoomIds: [...state.contentLoadedRoomIds, roomId],
  });
  try {
    // A room with a draft shows the DRAFT's pop-up content when it has any.
    const contentForRoom =
      useEditorStore.getState().draftContent[roomId] ?? (await loadAllContent(roomId));
    const { contentMap, dirtyContentKeys } = useEditorStore.getState();
    const next = { ...contentMap };
    for (const [objectId, content] of Object.entries(contentForRoom)) {
      const key = `${roomId}:${objectId}`;
      // Re-stamp the ids: rows moved by a room rename still carry the old
      // roomId inside the JSON, and saveContent writes to content.roomId.
      if (!dirtyContentKeys.includes(key)) {
        next[key] = { ...content, roomId, objectId } as ObjectContent;
      }
    }
    useEditorStore.setState({ contentMap: next });
  } catch {
    // Allow a retry on the next visit.
    useEditorStore.setState({
      contentLoadedRoomIds: useEditorStore
        .getState()
        .contentLoadedRoomIds.filter((id) => id !== roomId),
    });
  }
}

/**
 * The draft's pop-up content map for a room about to be saved as a draft:
 *   undefined → leave room_drafts.content as it is (nothing content-wise changed)
 *   map       → the FULL map to store. Base = the draft's existing map, else the
 *               live rows read straight from the DB (never the static seed);
 *               deleted/renamed objects dropped, this session's edits laid over.
 */
async function draftContentFor(
  cfg: RoomConfig
): Promise<Record<string, ObjectContent> | null | undefined> {
  const s = useEditorStore.getState();
  const rid = cfg.id;
  const prefix = `${rid}:`;
  const alive = new Set(cfg.objects.map((o) => o.id));
  const dirty = s.dirtyContentKeys.filter((k) => k.startsWith(prefix));
  const dels = s.pendingContentDeletes.filter((d) => d.roomId === rid && !alive.has(d.objectId));
  const orphanIds = Object.keys(s.contentMap)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((oid) => !alive.has(oid));
  const existing = s.draftContent[rid];

  let base = existing ?? null;
  if (!base && (dirty.length || dels.length || orphanIds.length)) {
    const live = await loadLiveContentRows(rid);
    if (!live.ok) throw new Error(live.error ?? "Couldn't read the room's pop-up content.");
    base = live.map;
  }
  if (!base) return undefined;

  if (!existing) {
    const touchesBase =
      dirty.length > 0 ||
      dels.some((d) => d.objectId in base) ||
      orphanIds.some((oid) => oid in base);
    if (!touchesBase) return undefined;
  }

  const gone = new Set(dels.map((d) => d.objectId));
  const out: Record<string, ObjectContent> = {};
  for (const [oid, c] of Object.entries(base)) {
    if (alive.has(oid) && !gone.has(oid)) out[oid] = c;
  }
  for (const key of dirty) {
    const oid = key.slice(prefix.length);
    const c = s.contentMap[key];
    if (c && alive.has(oid)) out[oid] = { ...c, roomId: rid, objectId: oid } as ObjectContent;
  }
  return out;
}

/** A room draft was written: remember its token and content, and drop the
 *  edits that are now stored in it. */
function commitDraftSave(
  cfg: RoomConfig,
  updatedAt: string | undefined,
  content: Record<string, ObjectContent> | null | undefined
): void {
  const s = useEditorStore.getState();
  const prefix = `${cfg.id}:`;
  const alive = new Set(cfg.objects.map((o) => o.id));
  const contentMap = { ...s.contentMap };
  for (const k of Object.keys(contentMap)) {
    if (k.startsWith(prefix) && !alive.has(k.slice(prefix.length))) delete contentMap[k];
  }
  useEditorStore.setState({
    roomDrafts: updatedAt ? { ...s.roomDrafts, [cfg.id]: updatedAt } : s.roomDrafts,
    draftContent:
      content !== undefined ? { ...s.draftContent, [cfg.id]: content } : s.draftContent,
    contentMap,
    dirtyContentKeys: s.dirtyContentKeys.filter((k) => !k.startsWith(prefix)),
    pendingContentDeletes: s.pendingContentDeletes.filter((d) => d.roomId !== cfg.id),
  });
}

// ─── Store ───────────────────────────────────────────────────

const initialAllRooms = coerceAllRoomSizes(
  { ...staticWorld.rooms } as Record<string, RoomConfig>
);

export const useEditorStore = create<EditorState & EditorActions>()(
  temporal(
    (set, get) => ({
      // ─── Initial State ───
      currentRoomId: null,
      currentRoomConfig: null,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedEntryPointId: null,
      activeTool: "select",
      addObjectType: "object",
      gridEnabled: false,
      gridSize: 32,
      mode: "edit",
      allRooms: initialAllRooms,
      contentMap: migrateContentMap(staticContent),
      editingContentObjectId: null,
      isDirty: false,
      dirtyRoomIds: [],
      dirtyContentKeys: [],
      pendingContentDeletes: [],
      contentLoadedRoomIds: [],
      isHydrated: false,
      roomRevisions: {},
      draftsAvailable: false,
      roomDrafts: {},
      draftContent: {},
      showAssetLibrary: false,
      pendingRequiredFields: {},
      hiddenObjectIds: new Set<string>(),
      pendingMoveToPickFor: null,

      // ─── Room Operations ───

      loadRoom: (roomId) => {
        const { allRooms: rooms, currentRoomId: prevId, isDirty: prevDirty } = get();
        const config = rooms[roomId];
        if (!config) return;
        // Carry unsaved edits across the switch: remember the room we're
        // leaving if it's dirty, and restore the flag for the one we open.
        let dirtyRoomIds = get().dirtyRoomIds;
        if (prevId && prevDirty && !dirtyRoomIds.includes(prevId)) {
          dirtyRoomIds = [...dirtyRoomIds, prevId];
        }
        const reopeningDirty = dirtyRoomIds.includes(roomId);
        dirtyRoomIds = dirtyRoomIds.filter((id) => id !== roomId);
        set({
          currentRoomId: roomId,
          currentRoomConfig: coerceRoomSize(structuredClone(config)),
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedEntryPointId: null,
          isDirty: reopeningDirty,
          dirtyRoomIds,
          // Workspace flags are room-scoped — wipe on room change so a hide
          // from the previous room doesn't ghost into the new one.
          hiddenObjectIds: new Set(),
          pendingMoveToPickFor: null,
        });
        // Undo history is per-room: undoing right after a switch used to
        // swap the previous room's layout into this one.
        useEditorStore.temporal.getState().clear();
        // Pull this room's content rows if we haven't yet (only the first
        // room opened used to get its content loaded).
        void ensureContentLoaded(roomId);
      },

      updateRoom: (partial) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = { ...config, ...partial };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      // ─── Object Operations ───

      selectObject: (id) =>
        set({
          selectedObjectId: id,
          selectedObjectIds: id ? [id] : [],
          selectedEntryPointId: null,
        }),

      toggleObjectSelection: (id) => {
        const ids = get().selectedObjectIds;
        if (ids.includes(id)) {
          const next = ids.filter((x) => x !== id);
          set({
            selectedObjectIds: next,
            selectedObjectId: next.length ? next[next.length - 1] : null,
          });
        } else {
          set({
            selectedObjectIds: [...ids, id],
            selectedObjectId: id,
            selectedEntryPointId: null,
          });
        }
      },

      setSelection: (ids) => {
        const config = get().currentRoomConfig;
        const valid = config
          ? ids.filter((id) => config.objects.some((o) => o.id === id))
          : [];
        set({
          selectedObjectIds: valid,
          selectedObjectId: valid.length ? valid[valid.length - 1] : null,
          selectedEntryPointId: valid.length ? null : get().selectedEntryPointId,
        });
      },

      moveObjects: (ids, dx, dy) => {
        const config = get().currentRoomConfig;
        if (!config || ids.length === 0 || (dx === 0 && dy === 0)) return;
        // A locked object never moves (arrow keys, group drags).
        const set_ = new Set(ids);
        if (!config.objects.some((o) => set_.has(o.id) && !isRoomObjectLocked(o))) return;
        const updated = {
          ...config,
          objects: config.objects.map((o) =>
            set_.has(o.id) && !isRoomObjectLocked(o)
              ? {
                  ...o,
                  x: Math.round(o.x + dx),
                  y: Math.round(o.y + dy),
                }
              : o
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      transformObjects: (list) => {
        const config = get().currentRoomConfig;
        if (!config || list.length === 0) return;
        const byId = new Map(list.map((t) => [t.id, t]));
        const updated = {
          ...config,
          objects: config.objects.map((o) => {
            const t = byId.get(o.id);
            if (!t || isRoomObjectLocked(o)) return o;
            const width = Math.round(Math.max(10, t.width));
            const height = Math.round(Math.max(10, t.height));
            const sx = width / o.width;
            const sy = height / o.height;
            return {
              ...o,
              x: Math.round(t.x),
              y: Math.round(t.y),
              width,
              height,
              rotation: ((t.rotation % 360) + 360) % 360,
              hitboxPolygon:
                o.hitboxPolygon && (sx !== 1 || sy !== 1)
                  ? o.hitboxPolygon.map((p) => ({ x: p.x * sx, y: p.y * sy }))
                  : o.hitboxPolygon,
            };
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      deleteObjects: (ids) => {
        const config = get().currentRoomConfig;
        if (!config || ids.length === 0) return;
        const drop = new Set(ids);
        const updated = {
          ...config,
          objects: config.objects.filter((o) => !drop.has(o.id)),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedObjectId: null,
          selectedObjectIds: [],
          isDirty: true,
        });
      },

      duplicateObjects: (ids) => {
        const config = get().currentRoomConfig;
        if (!config || ids.length === 0) return;
        const taken = new Set(config.objects.map((o) => o.id));
        const clones: RoomObject[] = [];
        let n = 0;
        for (const id of ids) {
          const source = config.objects.find((o) => o.id === id);
          if (!source) continue;
          let cloneId = `${source.type}-${Date.now().toString(36)}${n++}`;
          while (taken.has(cloneId)) cloneId += "x";
          taken.add(cloneId);
          const cloneIid = newIid();
          clones.push({
            ...structuredClone(source),
            iid: cloneIid,
            // The copy keeps the lock state, even a default one.
            ...(isRoomObjectLocked(source) ? { locked: true } : {}),
            // Steps that pointed at the source now point at the copy.
            interactions: remapInteractions(source.interactions, source.iid, cloneIid),
            id: cloneId,
            x: source.x + 20,
            y: source.y + 20,
          });
        }
        if (!clones.length) return;
        const updated = { ...config, objects: [...config.objects, ...clones] };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedObjectIds: clones.map((c) => c.id),
          selectedObjectId: clones[clones.length - 1].id,
          isDirty: true,
        });
        const roomId = get().currentRoomId;
        if (roomId) {
          clones.forEach((c, i) => {
            copyDrawingScene(roomId, ids[i], c.id).catch(() => {
              /* non-fatal */
            });
          });
        }
      },

      alignObjects: (rawIds, mode) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        // Locked objects neither move nor count as the alignment reference.
        const ids = rawIds.filter((id) => {
          const o = config.objects.find((x) => x.id === id);
          return o ? !isRoomObjectLocked(o) : false;
        });
        if (ids.length < 2) return;
        const objs = config.objects.filter((o) => ids.includes(o.id));
        const minX = Math.min(...objs.map((o) => o.x));
        const maxX = Math.max(...objs.map((o) => o.x + o.width));
        const minY = Math.min(...objs.map((o) => o.y));
        const maxY = Math.max(...objs.map((o) => o.y + o.height));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const place = (o: RoomObject): Partial<RoomObject> => {
          switch (mode) {
            case "left": return { x: minX };
            case "right": return { x: maxX - o.width };
            case "hcenter": return { x: Math.round(cx - o.width / 2) };
            case "top": return { y: minY };
            case "bottom": return { y: maxY - o.height };
            case "vcenter": return { y: Math.round(cy - o.height / 2) };
          }
        };
        const set_ = new Set(ids);
        const updated = {
          ...config,
          objects: config.objects.map((o) => (set_.has(o.id) ? { ...o, ...place(o) } : o)),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      distributeObjects: (rawIds, axis) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const ids = rawIds.filter((id) => {
          const o = config.objects.find((x) => x.id === id);
          return o ? !isRoomObjectLocked(o) : false;
        });
        if (ids.length < 3) return;
        const objs = config.objects
          .filter((o) => ids.includes(o.id))
          .sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
        // Equal GAPS between neighbours (Figma-style), ends stay put.
        const size = (o: RoomObject) => (axis === "x" ? o.width : o.height);
        const pos = (o: RoomObject) => (axis === "x" ? o.x : o.y);
        const first = objs[0];
        const last = objs[objs.length - 1];
        const span = pos(last) + size(last) - pos(first);
        const total = objs.reduce((sum, o) => sum + size(o), 0);
        const gap = (span - total) / (objs.length - 1);
        const next = new Map<string, number>();
        let cursor = pos(first);
        for (const o of objs) {
          next.set(o.id, Math.round(cursor));
          cursor += size(o) + gap;
        }
        const updated = {
          ...config,
          objects: config.objects.map((o) =>
            next.has(o.id) ? { ...o, [axis]: next.get(o.id)! } : o
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      addObject: (obj) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        // Mint a stable iid if the caller didn't supply one. Templates,
        // AddMenu, and dropped sprites all funnel through here, so this is
        // the choke point for "every persisted object has an iid from the
        // moment it's created".
        const withIid: RoomObject = obj.iid ? obj : { ...obj, iid: newIid() };
        const updated = {
          ...config,
          objects: [...config.objects, withIid],
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedObjectId: withIid.id,
          selectedObjectIds: [withIid.id],
          isDirty: true,
        });
      },

      updateObject: (id, partial) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, partial),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      bringToFront: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target) return;
        const others = config.objects.filter((o) => o.id !== id);
        if (others.length === 0) return;
        const max = Math.max(...others.map(effDepth));
        const z = clampZ(max + Z_STEP);
        if (target.zIndex === z) return; // already saturated → no undo step
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, { zIndex: z }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      sendToBack: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target) return;
        const others = config.objects.filter((o) => o.id !== id);
        if (others.length === 0) return;
        const min = Math.min(...others.map(effDepth));
        const z = clampZ(min - Z_STEP);
        if (target.zIndex === z) return;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, { zIndex: z }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      bringForward: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target) return;
        const cur = effDepth(target);
        const above = config.objects
          .filter((o) => o.id !== id && effDepth(o) > cur)
          .map(effDepth);
        if (above.length === 0) return; // already top
        const next = Math.min(...above);
        const z = clampZ(next + Z_STEP);
        if (target.zIndex === z) return;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, { zIndex: z }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      sendBackward: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target) return;
        const cur = effDepth(target);
        const below = config.objects
          .filter((o) => o.id !== id && effDepth(o) < cur)
          .map(effDepth);
        if (below.length === 0) return; // already bottom
        const prev = Math.max(...below);
        const z = clampZ(prev - Z_STEP);
        if (target.zIndex === z) return;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, { zIndex: z }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      resetLayer: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target || target.zIndex == null) return;
        const updated = {
          ...config,
          objects: config.objects.map((o) =>
            o.id === id ? { ...o, zIndex: undefined } : o
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      // Pin the layer at the current visual depth without changing its
      // stack position — useful when an object's auto Y-sort happens to be
      // exactly where you want it but you don't want a future Y change to
      // shift it. zIndex = current effective depth.
      lockLayer: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target || target.zIndex != null) return;
        const z = clampZ(target.y);
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, { zIndex: z }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      reorderObjects: (orderedIds) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        // orderedIds is front→back top-to-bottom (Photoshop convention).
        // Top row gets the highest zIndex; each subsequent row drops by Z_STEP.
        // Anchored above max y so dropping below an existing un-pinned object
        // still wins the depth race.
        const maxY = Math.max(0, ...config.objects.map((o) => o.y));
        const top = clampZ(maxY + Z_STEP);
        const newZByid = new Map<string, number>();
        for (let i = 0; i < orderedIds.length; i++) {
          newZByid.set(orderedIds[i], clampZ(top - i * Z_STEP));
        }
        const updated = {
          ...config,
          objects: config.objects.map((o) =>
            newZByid.has(o.id) ? { ...o, zIndex: newZByid.get(o.id)! } : o
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      deleteObject: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = {
          ...config,
          objects: config.objects.filter((obj) => obj.id !== id),
        };
        // The object's content stays in memory so Undo brings it back
        // intact; Save deletes content rows whose object no longer exists.
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedObjectId:
            get().selectedObjectId === id ? null : get().selectedObjectId,
          selectedObjectIds: get().selectedObjectIds.filter((x) => x !== id),
          isDirty: true,
        });
      },

      renameObject: (oldId, newId) => {
        const config = get().currentRoomConfig;
        if (!config) return { ok: false, error: "No room loaded." };
        const next = newId.trim();
        if (next === oldId) return { ok: true };
        if (!OBJECT_SLUG_RE.test(next)) {
          return {
            ok: false,
            error: "Use letters, digits, - or _ (no spaces).",
          };
        }
        if (config.objects.some((o) => o.id === next)) {
          return { ok: false, error: `"${next}" is already used in this room.` };
        }
        const roomId = config.id;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, oldId, { id: next }),
        };
        // Move the content entry to the new key; the old DB row is deleted
        // (and the new one written) on the next Save.
        const oldKey = `${roomId}:${oldId}`;
        const newKey = `${roomId}:${next}`;
        const contentMap = { ...get().contentMap };
        let dirtyContentKeys = get().dirtyContentKeys.filter((k) => k !== oldKey);
        let pendingContentDeletes = get().pendingContentDeletes;
        if (contentMap[oldKey]) {
          contentMap[newKey] = { ...contentMap[oldKey], objectId: next };
          delete contentMap[oldKey];
          dirtyContentKeys = [...dirtyContentKeys, newKey];
        }
        // The old id's content row AND drawing layers are removed on Save —
        // skipped if the rename was undone by then.
        pendingContentDeletes = [
          ...pendingContentDeletes.filter((d) => !(d.roomId === roomId && d.objectId === oldId)),
          { roomId, objectId: oldId, renamedTo: next },
        ];
        const swap = (set_: Set<string>) => {
          if (!set_.has(oldId)) return set_;
          const n = new Set(set_);
          n.delete(oldId);
          n.add(next);
          return n;
        };
        const pending = { ...get().pendingRequiredFields };
        if (pending[oldId]) {
          pending[next] = pending[oldId];
          delete pending[oldId];
        }
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [roomId]: updated },
          selectedObjectId:
            get().selectedObjectId === oldId ? next : get().selectedObjectId,
          selectedObjectIds: get().selectedObjectIds.map((x) => (x === oldId ? next : x)),
          contentMap,
          dirtyContentKeys,
          pendingContentDeletes,
          hiddenObjectIds: swap(get().hiddenObjectIds),
          pendingRequiredFields: pending,
          pendingMoveToPickFor:
            get().pendingMoveToPickFor === oldId ? next : get().pendingMoveToPickFor,
          editingContentObjectId:
            get().editingContentObjectId === oldId ? next : get().editingContentObjectId,
          isDirty: true,
        });
        // Keep the Drawing Studio layers with the object (best-effort). Copy,
        // don't move: the rename is undoable and only persists on Save.
        void copyDrawingScene(roomId, oldId, next).catch(() => undefined);
        return { ok: true };
      },

      duplicateObject: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((obj) => obj.id === id);
        if (!source) return;
        const cloneIid = newIid();
        const clone: RoomObject = {
          ...structuredClone(source),
          // Fresh slug AND fresh iid — duplicates are independent identities,
          // not aliases of the source. (Forgetting the iid here would mean
          // every door pointing at the source would also resolve to the
          // duplicate.)
          iid: cloneIid,
          // The copy keeps the lock state, even a default one.
          ...(isRoomObjectLocked(source) ? { locked: true } : {}),
          // Steps that pointed at the source now point at the copy.
          interactions: remapInteractions(source.interactions, source.iid, cloneIid),
          id: generateId(source.type),
          x: source.x + 20,
          y: source.y + 20,
        };
        const updated = {
          ...config,
          objects: [...config.objects, clone],
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedObjectId: clone.id,
          selectedObjectIds: [clone.id],
          isDirty: true,
        });

        // Copy the source's Drawing Studio scene to the clone (fire-and-
        // forget — the duplicate is usable without it; the scene is
        // editing convenience). Both objects can then be re-edited
        // independently from the same starting point.
        const roomId = get().currentRoomId;
        if (roomId) {
          copyDrawingScene(roomId, source.id, clone.id).catch(() => {
            /* non-fatal */
          });
        }
      },

      moveObject: (id, x, y) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, {
            x: Math.round(x),
            y: Math.round(y),
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      resizeObject: (id, width, height) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((o) => o.id === id);
        if (!source || isRoomObjectLocked(source)) return;
        const newW = Math.round(Math.max(10, width));
        const newH = Math.round(Math.max(10, height));
        const scaleX = newW / source.width;
        const scaleY = newH / source.height;
        const scaledPolygon = source.hitboxPolygon
          ? source.hitboxPolygon.map((p) => ({
              x: p.x * scaleX,
              y: p.y * scaleY,
            }))
          : undefined;
        const partial: Partial<RoomObject> = {
          width: newW,
          height: newH,
        };
        if (scaledPolygon) partial.hitboxPolygon = scaledPolygon;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, partial),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      transformObject: (id, t) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((o) => o.id === id);
        if (!source || isRoomObjectLocked(source)) return;
        const width = Math.round(Math.max(10, t.width));
        const height = Math.round(Math.max(10, t.height));
        const sx = width / source.width;
        const sy = height / source.height;
        const partial: Partial<RoomObject> = {
          x: Math.round(t.x),
          y: Math.round(t.y),
          width,
          height,
          rotation: ((t.rotation % 360) + 360) % 360,
        };
        if (source.hitboxPolygon && (sx !== 1 || sy !== 1)) {
          partial.hitboxPolygon = source.hitboxPolygon.map((p) => ({
            x: p.x * sx,
            y: p.y * sy,
          }));
        }
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, partial),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      // ─── Object Hitbox ───

      setObjectRotation: (id, degrees) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const target = config.objects.find((o) => o.id === id);
        if (!target || isRoomObjectLocked(target)) return;
        const normalized = ((degrees % 360) + 360) % 360;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, {
            rotation: normalized,
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      seedObjectHitboxFromRect: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((o) => o.id === id);
        if (!source || source.hitboxPolygon) return;
        const polygon: Point[] = [
          { x: 0, y: 0 },
          { x: source.width, y: 0 },
          { x: source.width, y: source.height },
          { x: 0, y: source.height },
        ];
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, {
            hitboxPolygon: polygon,
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      resetObjectHitbox: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = {
          ...config,
          objects: config.objects.map((o) =>
            o.id === id ? { ...o, hitboxPolygon: undefined } : o
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      updateObjectVertex: (id, index, point) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((o) => o.id === id);
        if (!source?.hitboxPolygon) return;
        const polygon = [...source.hitboxPolygon];
        polygon[index] = { x: Math.round(point.x), y: Math.round(point.y) };
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, {
            hitboxPolygon: polygon,
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      addObjectVertex: (id, index, point) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((o) => o.id === id);
        if (!source?.hitboxPolygon) return;
        const polygon = [...source.hitboxPolygon];
        polygon.splice(index, 0, {
          x: Math.round(point.x),
          y: Math.round(point.y),
        });
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, {
            hitboxPolygon: polygon,
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      deleteObjectVertex: (id, index) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const source = config.objects.find((o) => o.id === id);
        if (!source?.hitboxPolygon) return;
        const polygon = source.hitboxPolygon.filter((_, i) => i !== index);
        if (polygon.length < 3) return;
        const updated = {
          ...config,
          objects: updateObjectInList(config.objects, id, {
            hitboxPolygon: polygon,
          }),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      // ─── Walkable Area ───

      updateWalkablePolygon: (polygon) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = {
          ...config,
          walkableArea: { polygon },
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      updateWalkableVertex: (index, point) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const polygon = [...config.walkableArea.polygon];
        polygon[index] = { x: Math.round(point.x), y: Math.round(point.y) };
        const updated = {
          ...config,
          walkableArea: { polygon },
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      addWalkableVertex: (index, point) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const polygon = [...config.walkableArea.polygon];
        polygon.splice(index, 0, {
          x: Math.round(point.x),
          y: Math.round(point.y),
        });
        const updated = {
          ...config,
          walkableArea: { polygon },
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      deleteWalkableVertex: (index) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const polygon = config.walkableArea.polygon.filter(
          (_, i) => i !== index
        );
        if (polygon.length < 3) return; // need at least 3 vertices
        const updated = {
          ...config,
          walkableArea: { polygon },
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      // ─── Entry Points ───

      selectEntryPoint: (id) =>
        set({
          selectedEntryPointId: id,
          selectedObjectId: id ? null : get().selectedObjectId,
          selectedObjectIds: id ? [] : get().selectedObjectIds,
        }),

      addEntryPoint: (ep) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        // Same iid-stamping discipline as addObject — entry points are
        // referenced by `targetEntryPointIid` on doors.
        const withIid: EntryPoint = ep.iid ? ep : { ...ep, iid: newIid() };
        const updated = {
          ...config,
          entryPoints: [...config.entryPoints, withIid],
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedEntryPointId: withIid.id,
          isDirty: true,
        });
      },

      updateEntryPoint: (id, partial) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        const updated = {
          ...config,
          entryPoints: config.entryPoints.map((ep) =>
            ep.id === id ? { ...ep, ...partial } : ep
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
      },

      deleteEntryPoint: (id) => {
        const config = get().currentRoomConfig;
        if (!config) return;
        if (config.entryPoints.length <= 1) return; // need at least 1
        const updated = {
          ...config,
          entryPoints: config.entryPoints.filter((ep) => ep.id !== id),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedEntryPointId:
            get().selectedEntryPointId === id
              ? null
              : get().selectedEntryPointId,
          isDirty: true,
        });
      },

      renameEntryPoint: (oldId, newId) => {
        const config = get().currentRoomConfig;
        if (!config) return { ok: false, error: "No room loaded." };
        const next = newId.trim();
        if (next === oldId) return { ok: true };
        if (!OBJECT_SLUG_RE.test(next)) {
          return { ok: false, error: "Use letters, digits, - or _ (no spaces)." };
        }
        if (config.entryPoints.some((ep) => ep.id === next)) {
          return { ok: false, error: `"${next}" already exists in this room.` };
        }
        const updated = {
          ...config,
          entryPoints: config.entryPoints.map((ep) =>
            ep.id === oldId ? { ...ep, id: next } : ep
          ),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          selectedEntryPointId:
            get().selectedEntryPointId === oldId ? next : get().selectedEntryPointId,
          isDirty: true,
        });
        return { ok: true };
      },

      // ─── Tools & Mode ───

      setTool: (tool) => {
        // Edit-hitbox operates on the currently-selected object, so preserve
        // selection. Seed the polygon if the object doesn't have one yet.
        if (tool === "edit-hitbox") {
          const { selectedObjectId } = get();
          // Hitbox editing works on one object — keep just the primary.
          set({
            activeTool: tool,
            selectedObjectIds: selectedObjectId ? [selectedObjectId] : [],
          });
          if (selectedObjectId) {
            get().seedObjectHitboxFromRect(selectedObjectId);
          }
          return;
        }
        // Switching back to Select keeps the selection; other tools clear it.
        if (tool === "select") {
          set({ activeTool: tool });
          return;
        }
        set({
          activeTool: tool,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedEntryPointId: null,
        });
      },

      setAddObjectType: (type) => set({ addObjectType: type }),

      toggleGrid: () => set({ gridEnabled: !get().gridEnabled }),

      setGridSize: (size) => set({ gridSize: Math.max(8, Math.min(128, size)) }),

      setMode: (mode) => set({ mode }),

      // ─── Content ───

      updateContent: (objectId, content) => {
        const roomId = get().currentRoomId;
        if (!roomId) return;
        const key = `${roomId}:${objectId}`;
        set({
          contentMap: { ...get().contentMap, [key]: content },
          dirtyContentKeys: get().dirtyContentKeys.includes(key)
            ? get().dirtyContentKeys
            : [...get().dirtyContentKeys, key],
          // Content edits used to leave Save disabled (nothing flagged dirty).
          isDirty: true,
        });
      },

      restoreContent: (objectId, content, wasDirty) => {
        const roomId = get().currentRoomId;
        if (!roomId) return;
        const key = `${roomId}:${objectId}`;
        const contentMap = { ...get().contentMap };
        if (content) contentMap[key] = content;
        else delete contentMap[key];
        const others = get().dirtyContentKeys.filter((k) => k !== key);
        set({ contentMap, dirtyContentKeys: wasDirty ? [...others, key] : others });
      },

      openContentEditor: (objectId) =>
        set({ editingContentObjectId: objectId }),

      closeContentEditor: () => set({ editingContentObjectId: null }),

      // ─── Panel Toggles ───

      toggleAssetLibrary: () =>
        set({ showAssetLibrary: !get().showAssetLibrary }),

      // ─── Templates ───

      setPendingRequiredFields: (objectId, fields) => {
        if (fields.length === 0) {
          // Same as a clear — keep the map small.
          const next = { ...get().pendingRequiredFields };
          delete next[objectId];
          set({ pendingRequiredFields: next });
          return;
        }
        set({
          pendingRequiredFields: {
            ...get().pendingRequiredFields,
            [objectId]: fields,
          },
        });
      },

      clearPendingRequiredFields: (objectId) => {
        const next = { ...get().pendingRequiredFields };
        delete next[objectId];
        set({ pendingRequiredFields: next });
      },

      // Workspace flags — copy the Set so React notices the identity change.
      // Not undoable (these aren't data) so we deliberately bypass zundo via
      // direct set() rather than going through any history-tracked path.
      toggleObjectHidden: (objectId) => {
        const next = new Set(get().hiddenObjectIds);
        if (next.has(objectId)) next.delete(objectId);
        else next.add(objectId);
        set({ hiddenObjectIds: next });
      },
      toggleObjectsLock: (ids) => {
        const config = get().currentRoomConfig;
        if (!config) return null;
        const targets = config.objects.filter((o) => ids.includes(o.id));
        if (targets.length === 0) return null;
        // Any free → lock them all; all locked → unlock them all.
        const lockAll = targets.some((o) => !isRoomObjectLocked(o));
        const hit = new Set(targets.map((o) => o.id));
        const updated = {
          ...config,
          objects: config.objects.map((o) => (hit.has(o.id) ? { ...o, locked: lockAll } : o)),
        };
        set({
          currentRoomConfig: updated,
          allRooms: { ...get().allRooms, [updated.id]: updated },
          isDirty: true,
        });
        return lockAll;
      },
      clearWorkspaceFlags: () =>
        set({
          hiddenObjectIds: new Set(),
        }),

      setPendingMoveToPickFor: (objectId) =>
        set({ pendingMoveToPickFor: objectId }),
      clearPendingMoveToPickFor: () =>
        set({ pendingMoveToPickFor: null }),

      saveObjectAsTemplate: async (objectId, meta) => {
        const config = get().currentRoomConfig;
        if (!config) return { ok: false, error: "No room loaded." };
        const obj = config.objects.find((o) => o.id === objectId);
        if (!obj) return { ok: false, error: "Object not found." };

        // Door templates always need a navigation target on each instance.
        // External-link templates always need a URL. Build a default
        // requiredFields list when the caller didn't provide one, so the
        // post-drop required-fields prompt actually fires.
        let requiredFields: TemplateRequiredField[] | undefined =
          meta.requiredFields;
        if (!requiredFields) {
          if (meta.category === "door") {
            requiredFields = [
              {
                name: "targetRoomId",
                type: "roomRef",
                validation: { required: true },
              },
              {
                name: "targetEntryPointId",
                type: "string",
                validation: { required: true },
              },
            ];
          } else if (obj.interactionType === "external-link") {
            requiredFields = [
              {
                name: "externalUrl",
                type: "url",
                validation: { required: true },
              },
            ];
          } else {
            requiredFields = [];
          }
        }

        const tpl: NewTemplate = {
          name: meta.name,
          nameAr: meta.nameAr ?? null,
          category: meta.category,
          tags: meta.tags,
          spriteUrl: obj.spriteUrl ?? "",
          storagePath: null,
          defaultLabel: obj.label,
          defaultLabelAr: obj.labelAr ?? null,
          defaultWidth: obj.width,
          defaultHeight: obj.height,
          hitboxPolygon: obj.hitboxPolygon ?? null,
          interactionType: obj.interactionType ?? "content",
          externalUrl: obj.externalUrl ?? null,
          isWallMounted: obj.isWallMounted,
          interactionRadius: obj.interactionRadius,
          // Persist a *relative* z-offset (zIndex - y) so the template
          // doesn't drag the original room's absolute Y around with it.
          zIndexOffset:
            obj.zIndex != null ? Math.round(obj.zIndex - obj.y) : null,
          requiredFields,
          // Steps, walks-near, hover, kind: kept on the template.
          behaviour: templateBehaviourOf(obj),
        };

        return saveTemplate(tpl);
      },

      // ─── Persistence ───

      replaceCurrentRoom: (config, dirty) => {
        const sized = coerceRoomSize(config);
        set({
          currentRoomConfig: sized,
          allRooms: { ...get().allRooms, [sized.id]: sized },
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedEntryPointId: null,
          isDirty: dirty,
        });
      },

      markClean: () => set({ isDirty: false }),

      saveToSupabase: async (opts) => {
        const { currentRoomConfig, currentRoomId, allRooms } = get();
        if (!currentRoomConfig) {
          return { ok: false, contentErrors: [] };
        }
        const pre = get();
        if (
          !pre.isDirty &&
          pre.dirtyRoomIds.length === 0 &&
          pre.dirtyContentKeys.length === 0 &&
          pre.pendingContentDeletes.length === 0 &&
          !(opts?.forceRoomIds?.length)
        ) {
          return { ok: true, contentErrors: [], nothingToSave: true };
        }
        const forceIds = new Set(opts?.forceRoomIds ?? []);
        const tokenFor = (id: string) => get().roomRevisions[id] ?? null;
        const conflicts: { roomId: string; theirsUpdatedAt?: string }[] = [];

        // Rooms written as DRAFTS this save (drafts available, the live row
        // exists, the room has an iid). Everything else — including a brand-new
        // room that isn't in the DB yet — goes straight to rooms.config as before.
        const draftIds = new Set<string>();
        const viaDraft = (cfg: RoomConfig) =>
          get().draftsAvailable && tokenFor(cfg.id) !== null && !!cfg.iid;

        // Content of a draftable room NEVER goes straight to object_content: it
        // rides in the draft (and an unsaved/held-back edit just stays dirty).
        const isDraftRoom = (rid: string) => {
          if (draftIds.has(rid)) return true;
          const c = rid === currentRoomId ? currentRoomConfig : allRooms[rid];
          return !!c && viaDraft(c);
        };

        const saveOne = async (cfg: RoomConfig) => {
          if (!viaDraft(cfg)) {
            const r = await saveRoom(cfg, {
              expectedUpdatedAt: tokenFor(cfg.id),
              force: forceIds.has(cfg.id),
            });
            if (r.ok && r.updatedAt) {
              set({ roomRevisions: { ...get().roomRevisions, [cfg.id]: r.updatedAt } });
            }
            return r;
          }
          draftIds.add(cfg.id);
          let content: Record<string, ObjectContent> | null | undefined;
          try {
            content = await draftContentFor(cfg);
          } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          const r = await saveRoomDraft(cfg, {
            expectedUpdatedAt: get().roomDrafts[cfg.id] ?? null,
            force: forceIds.has(cfg.id),
            content,
          });
          if (r.ok) commitDraftSave(cfg, r.updatedAt, content);
          return r;
        };

        // Save the open room plus any other room edited earlier this session.
        // A conflict on one room doesn't stop the others.
        const roomErrors: string[] = [];
        // The open room is only written when it has edits: re-saving an
        // untouched room could raise a false conflict with another tab.
        const writeOpen = get().isDirty || forceIds.has(currentRoomConfig.id);
        const roomResult: Awaited<ReturnType<typeof saveRoom>> = writeOpen
          ? await saveOne(currentRoomConfig)
          : { ok: true };
        if (roomResult.code === "conflict") {
          conflicts.push({
            roomId: currentRoomConfig.id,
            theirsUpdatedAt: roomResult.theirsUpdatedAt,
          });
        } else if (roomResult.error) roomErrors.push(roomResult.error);
        const savedOthers: string[] = [];
        for (const id of get().dirtyRoomIds) {
          const cfg = allRooms[id];
          if (!cfg || id === currentRoomId) continue;
          const r = await saveOne(cfg);
          if (r.ok) {
            savedOthers.push(id);
          } else if (r.code === "conflict") {
            conflicts.push({ roomId: id, theirsUpdatedAt: r.theirsUpdatedAt });
          } else roomErrors.push(`${id}: ${r.error ?? "save failed"}`);
        }
        // Content of a conflicted room is held back too: writing it now would
        // be the same silent overwrite the conflict is protecting against.
        const conflictedIds = new Set(conflicts.map((c) => c.roomId));
        const heldBack = (roomId: string) => conflictedIds.has(roomId);

        // Content: delete rows for deleted/renamed objects, then write only
        // the entries edited this session (not every seed entry each time).
        const contentErrors: string[] = [];
        const deletesDone: string[] = [];
        // Orphans: content for objects no longer in a room we just saved
        // (deleted objects — kept in memory until now so Undo restores them).
        const savedRooms = [
          ...(roomResult.ok ? [currentRoomConfig] : []),
          ...savedOthers.map((id) => allRooms[id]),
        ];
        const orphanKeys: string[] = [];
        for (const cfg of savedRooms) {
          if (isDraftRoom(cfg.id)) continue; // handled inside the draft
          const alive = new Set(cfg.objects.map((o) => o.id));
          for (const key of Object.keys(get().contentMap)) {
            const [rid, ...rest] = key.split(":");
            const oid = rest.join(":");
            if (rid === cfg.id && !alive.has(oid) && !heldBack(rid)) {
              const r = await deleteContent(rid, oid);
              if (r.ok) orphanKeys.push(key);
            }
          }
        }
        if (orphanKeys.length) {
          const cm = { ...get().contentMap };
          for (const k of orphanKeys) delete cm[k];
          set({
            contentMap: cm,
            dirtyContentKeys: get().dirtyContentKeys.filter((k) => !orphanKeys.includes(k)),
          });
        }
        for (const d of get().pendingContentDeletes) {
          if (heldBack(d.roomId) || isDraftRoom(d.roomId)) continue;
          // A rename that was undone: the object has its old id again.
          const cfg = allRooms[d.roomId];
          if (cfg?.objects.some((o) => o.id === d.objectId)) {
            // Drop the layers copied to the abandoned new id.
            if (d.renamedTo && !cfg.objects.some((o) => o.id === d.renamedTo)) {
              await deleteDrawingScene(d.roomId, "object", d.renamedTo).catch(() => undefined);
            }
            deletesDone.push(`${d.roomId}:${d.objectId}`);
            continue;
          }
          const r = await deleteContent(d.roomId, d.objectId);
          if (r.ok) deletesDone.push(`${d.roomId}:${d.objectId}`);
          else if (r.error) contentErrors.push(r.error);
          // Renamed object: its layers were copied to the new id already.
          await deleteDrawingScene(d.roomId, "object", d.objectId).catch(() => undefined);
        }
        const savedKeys: string[] = [];
        for (const key of get().dirtyContentKeys) {
          const content = get().contentMap[key];
          if (!content) {
            savedKeys.push(key);
            continue;
          }
          if (heldBack(key.split(":")[0]) || isDraftRoom(key.split(":")[0])) continue;
          const result = await saveContent(content);
          if (result.ok) savedKeys.push(key);
          else if (result.error) contentErrors.push(result.error);
        }

        const ok =
          roomResult.ok &&
          roomErrors.length === 0 &&
          conflicts.length === 0 &&
          contentErrors.length === 0;
        set({
          isDirty: roomResult.ok && contentErrors.length === 0 ? false : get().isDirty,
          dirtyRoomIds: get().dirtyRoomIds.filter((id) => !savedOthers.includes(id)),
          dirtyContentKeys: get().dirtyContentKeys.filter((k) => !savedKeys.includes(k)),
          pendingContentDeletes: get().pendingContentDeletes.filter(
            (d) => !deletesDone.includes(`${d.roomId}:${d.objectId}`)
          ),
        });

        return {
          ok,
          roomError: roomErrors.length ? roomErrors.join("; ") : undefined,
          contentErrors,
          conflicts: conflicts.length ? conflicts : undefined,
        };
      },

      refreshRoomRevisions: async () => {
        const fresh = await loadRoomRevisions();
        set({ roomRevisions: { ...get().roomRevisions, ...fresh } });
      },

      reloadRoomFromDb: async (roomId) => {
        const res = await loadRoomForEditor(roomId);
        if (res.source !== "supabase" || !res.config) return false;
        const config = coerceRoomSize(res.config);
        const { currentRoomId } = get();
        // Held-back pop-up edits for this room would otherwise be written over
        // the other tab's content on the next Save: drop them and re-pull.
        const inRoom = (key: string) => key.startsWith(`${roomId}:`);
        const keptContent: Record<string, ObjectContent> = {};
        for (const [k, v] of Object.entries(get().contentMap)) {
          if (!inRoom(k)) keptContent[k] = v;
        }
        set({
          contentMap: keptContent,
          dirtyContentKeys: get().dirtyContentKeys.filter((k) => !inRoom(k)),
          pendingContentDeletes: get().pendingContentDeletes.filter((d) => d.roomId !== roomId),
          contentLoadedRoomIds: get().contentLoadedRoomIds.filter((id) => id !== roomId),
        });
        const { [roomId]: _oldDraft, ...otherDrafts } = get().roomDrafts;
        const { [roomId]: _oldDraftContent, ...otherDraftContent } = get().draftContent;
        void _oldDraft;
        void _oldDraftContent;
        set({
          allRooms: { ...get().allRooms, [roomId]: config },
          roomRevisions: { ...get().roomRevisions, [roomId]: res.updatedAt ?? null },
          roomDrafts: res.draft ? { ...otherDrafts, [roomId]: res.draft.updatedAt } : otherDrafts,
          draftContent: res.draft
            ? { ...otherDraftContent, [roomId]: res.draft.content }
            : otherDraftContent,
          ...(res.draftsAvailable === false ? { draftsAvailable: false } : {}),
          dirtyRoomIds: get().dirtyRoomIds.filter((id) => id !== roomId),
          ...(currentRoomId === roomId
            ? {
                currentRoomConfig: structuredClone(config),
                selectedObjectId: null,
                selectedObjectIds: [],
                selectedEntryPointId: null,
                isDirty: false,
              }
            : {}),
        });
        // After the draft state is in the store: content comes from the draft's
        // map when it has one, else the live rows.
        void ensureContentLoaded(roomId);
        // Undo history is per-room: it would swap the old layout back in.
        if (currentRoomId === roomId) useEditorStore.temporal.getState().clear();
        if (config.iid) await clearDraft(config.iid).catch(() => undefined);
        return true;
      },

      publishRoom: async (roomId, opts) => {
        const pre = get();
        const cfgNow = () =>
          get().currentRoomId === roomId ? get().currentRoomConfig : get().allRooms[roomId];
        const roomIsDirty =
          (pre.currentRoomId === roomId && pre.isDirty) ||
          pre.dirtyRoomIds.includes(roomId) ||
          pre.dirtyContentKeys.some((k) => k.startsWith(`${roomId}:`)) ||
          pre.pendingContentDeletes.some((d) => d.roomId === roomId);
        // Publish what's on screen: save first, like the landing editor.
        if (roomIsDirty) {
          const saved = await get().saveToSupabase();
          if (!saved.ok) {
            return {
              ok: false,
              saveFailed: true,
              error:
                [saved.roomError, ...saved.contentErrors].filter(Boolean).join("; ") ||
                (saved.conflicts?.length
                  ? "Some rooms were changed somewhere else, so nothing was published."
                  : "Save failed, so nothing was published."),
            };
          }
        }
        const cfg = cfgNow();
        if (!get().roomDrafts[roomId] || !cfg?.iid) {
          return { ok: false, nothingToPublish: true, error: "Nothing to publish." };
        }
        const res = await publishRoomDraft(
          cfg.iid,
          opts?.force ? null : (get().roomRevisions[roomId] ?? null)
        );
        if (!res.ok) return { ok: false, liveChanged: res.liveChanged, error: res.error };

        const { [roomId]: _d, ...otherDrafts } = get().roomDrafts;
        const { [roomId]: _c, ...otherContent } = get().draftContent;
        void _d;
        void _c;
        set({
          roomDrafts: otherDrafts,
          draftContent: otherContent,
          roomRevisions: { ...get().roomRevisions, [roomId]: res.updatedAt ?? null },
        });
        // Dev-only external-files mirror, as saveRoom does for live writes.
        try {
          const world = await loadDefaultWorld();
          if (world?.config?.externalFilesEnabled) await writeRoomFile(world.id, roomId, cfg);
        } catch {
          /* best-effort */
        }
        return { ok: true };
      },

      discardDraft: async (roomId) => {
        const cfg = get().currentRoomId === roomId ? get().currentRoomConfig : get().allRooms[roomId];
        if (!cfg?.iid) return { ok: false, error: "This room has no draft." };
        const res = await discardRoomDraft(cfg.iid);
        if (!res.ok && res.code !== "not_found") return { ok: false, error: res.error };
        const loaded = await get().reloadRoomFromDb(roomId);
        return loaded
          ? { ok: true }
          : { ok: false, error: "The draft was discarded, but the live room couldn't be reloaded. Reload the page." };
      },

      hydrateFromSupabase: async () => {
        const roomsResult = await loadAllRoomsForEditor();
        // Coerce in case any saved row drifted from the canonical canvas
        // size (e.g. legacy rows or hand-edited DB).
        const coercedRooms = coerceAllRoomSizes(roomsResult.rooms);

        // Replace allRooms with merged result (static seeds + DB overrides).
        const roomRevisions: Record<string, string | null> = {};
        for (const id of Object.keys(coercedRooms)) {
          roomRevisions[id] = roomsResult.revisions[id] ?? null;
        }
        const roomDrafts: Record<string, string> = {};
        const draftContent: Record<string, Record<string, ObjectContent> | null> = {};
        for (const [id, d] of Object.entries(roomsResult.drafts)) {
          roomDrafts[id] = d.updatedAt;
          draftContent[id] = d.content;
        }
        set({
          allRooms: coercedRooms,
          roomRevisions,
          draftsAvailable: roomsResult.draftsAvailable,
          roomDrafts,
          draftContent,
          // Content loaded before this hydrate may predate the drafts.
          contentLoadedRoomIds: get().contentLoadedRoomIds.filter(
            (id) => !(id in roomDrafts)
          ),
          isHydrated: true,
        });

        // Refresh the currently-loaded room from the hydrated map so the user
        // sees their persisted edits instead of the initial static seed.
        const { currentRoomId } = get();
        // The room open from the seed may not exist in the DB (renamed or
        // deleted) — fall back to home, then to the first saved room.
        if (currentRoomId && !coercedRooms[currentRoomId]) {
          const fallback = coercedRooms.home
            ? "home"
            : Object.keys(coercedRooms).sort()[0];
          if (fallback) get().loadRoom(fallback);
        }
        if (currentRoomId && coercedRooms[currentRoomId]) {
          set({
            currentRoomConfig: coerceRoomSize(
              structuredClone(coercedRooms[currentRoomId])
            ),
            isDirty: false,
          });

          useEditorStore.temporal.getState().clear();
          await ensureContentLoaded(currentRoomId);
        }

        return {
          source: roomsResult.source,
          error: roomsResult.error,
        };
      },
    }),
    {
      limit: 100,
      // Only track room config changes for undo/redo, not UI state
      partialize: (state) => ({
        currentRoomConfig: state.currentRoomConfig,
        allRooms: state.allRooms,
      }),
      // Without this, zundo records a step on EVERY set() — selecting an
      // object or opening a panel became a no-op Undo step. Room edits always
      // produce new references, so reference equality is enough.
      equality: (past, current) =>
        past.currentRoomConfig === current.currentRoomConfig &&
        past.allRooms === current.allRooms,
    }
  )
);
