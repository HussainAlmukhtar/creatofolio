"use client";

// WorldView — the "building" overview.
//
// Renders every room in the default world as a draggable rectangle on a
// pannable Konva stage, with door connection lines between them. Click a
// room to open it in the regular editor; drag to reposition (saves on
// drag-end); "+ New Room" to create one.
//
// Deliberately a minimal v1 — drag-to-reposition + click-to-open + new/delete
// + connection lines + broken-link surfacing. Onion-skinning, snap-to-neighbor,
// gridvania snapping, multi-world picker were left for later.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Stage,
  Layer,
  Rect,
  Text,
  Group,
  Line,
  Image as KonvaImage,
} from "react-konva";
import type Konva from "konva";
import { toast } from "sonner";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { useTouchMode } from "@/lib/touchMode";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { Plus, Trash2, ArrowLeft, LayoutDashboard, ZoomIn, ZoomOut, Maximize2, Settings, Pencil, ExternalLink, Flag, Globe, Radio, RotateCcw } from "lucide-react";
import { RecentlyDeletedPanel } from "@/components/admin/RecentlyDeletedPanel";
import { restoreDeletedItem } from "@/lib/trashData";
import { useTrashAvailable } from "@/lib/useTrashAvailable";
import { ProjectSettingsModal } from "./ProjectSettingsModal";
import { useDialog } from "./useDialog";
import {
  loadWorlds,
  pickLiveWorld,
  setLiveWorld,
  createWorld,
  listRoomsInWorld,
  loadAllRoomsForEditor,
  updateRoomPlacement,
  createRoom,
  deleteRoom,
  renameRoom,
  saveWorld,
  deleteWorld,
  type RoomWorldPlacement,
} from "@/lib/editorData";
import type { RoomConfig, WorldConfig } from "@/data/roomTypes";
import { ROOM_WIDTH, ROOM_HEIGHT } from "@/data/roomTypes";
import { resolveDoorTargetRoom } from "@/lib/integrityCheck";
import { neighboursOf } from "@/lib/neighbours";

// ── Background image hook (mirrors EditorCanvas pattern) ──
function useBgImage(url?: string | null): HTMLImageElement | null {
  // Keyed by URL so a changed url shows nothing until its image loads.
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.onload = () => !cancelled && setLoaded({ url, img: el });
    el.onerror = () => !cancelled && setLoaded(null);
    el.src = url;
    return () => {
      cancelled = true;
      el.onload = null;
      el.onerror = null;
    };
  }, [url]);
  return loaded && loaded.url === url ? loaded.img : null;
}

interface RoomCardProps {
  placement: RoomWorldPlacement;
  selected: boolean;
  /** Players land in this room when the game starts. */
  isStart?: boolean;
  /** Room background colour — the card fill when it has no background art. */
  bgColor?: string;
  onSelect: () => void;
  onDoubleClick: () => void;
  onDragEnd: (x: number, y: number) => void;
  /** When set, snap the visible drag preview to this grid (gridvania mode). */
  snap?: { w: number; h: number } | null;
  /** Stage pan/zoom, to snap in world space during the drag. */
  view: { x: number; y: number; scale: number };
  /** Touch: positions save to the live world instantly, so a card only
   *  drags once it's selected — a pan that starts on a card can't move it. */
  touch?: boolean;
}

function RoomCard({
  placement,
  selected,
  onSelect,
  onDoubleClick,
  onDragEnd,
  snap,
  isStart,
  bgColor,
  view,
  touch,
}: RoomCardProps) {
  const bg = useBgImage(placement.bgMiddleUrl);
  const stroke = selected ? "#60a5fa" : "#334155";
  return (
    <Group
      x={placement.worldX}
      y={placement.worldY}
      draggable={!touch || selected}
      // Gridvania: snap live while dragging (drop-only snapping made the card
      // jump on release). Konva hands us absolute (screen) coordinates.
      dragBoundFunc={
        snap
          ? (pos) => {
              const wx = (pos.x - view.x) / view.scale;
              const wy = (pos.y - view.y) / view.scale;
              return {
                x: Math.round(wx / snap.w) * snap.w * view.scale + view.x,
                y: Math.round(wy / snap.h) * snap.h * view.scale + view.y,
              };
            }
          : undefined
      }
      onMouseEnter={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = "move";
      }}
      onMouseLeave={(e) => {
        const c = e.target.getStage()?.container();
        if (c) c.style.cursor = "";
      }}
      onDragEnd={(e) => {
        // Snap to the nearest grid cell on drop. The Stage transform makes
        // live (during-drag) snapping awkward, but drop-snap is enough — the
        // user sees the room jump into place and either accept (no-op) or
        // pick it up again to reposition.
        let x = e.target.x();
        let y = e.target.y();
        if (snap) {
          x = Math.round(x / snap.w) * snap.w;
          y = Math.round(y / snap.h) * snap.h;
        }
        // A drag cancelled by a pinch lands back where it started: no write.
        if (x === placement.worldX && y === placement.worldY) return;
        onDragEnd(x, y);
      }}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
    >
      <Rect
        width={placement.worldW}
        height={placement.worldH}
        fill={bgColor || "#1e293b"}
        stroke={stroke}
        strokeWidth={selected ? 8 : 4}
        cornerRadius={12}
        perfectDrawEnabled={false}
      />
      {bg && (
        <KonvaImage
          image={bg}
          width={placement.worldW}
          height={placement.worldH}
          opacity={0.85}
          cornerRadius={12}
        />
      )}
      <Rect
        x={0}
        y={placement.worldH - 90}
        width={placement.worldW}
        height={90}
        fill="rgba(0,0,0,0.6)"
        cornerRadius={[0, 0, 12, 12]}
      />
      <Text
        x={24}
        y={placement.worldH - 78}
        text={placement.name ?? placement.id}
        fontSize={48}
        fontStyle="bold"
        fill="#f8fafc"
      />
      <Text
        x={24}
        y={placement.worldH - 28}
        text={placement.id}
        fontSize={24}
        fill="#94a3b8"
      />
      {isStart && (
        <>
          <Rect
            x={16}
            y={16}
            width={300}
            height={56}
            fill="#16a34a"
            cornerRadius={28}
          />
          <Text x={36} y={29} text="▶ START ROOM" fontSize={30} fontStyle="bold" fill="#f0fdf4" />
        </>
      )}
    </Group>
  );
}

interface DoorLine {
  fromRoomId: string;
  toRoomId: string | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  status: "ok" | "broken" | "self";
}

function buildDoorLines(
  placements: RoomWorldPlacement[],
  rooms: Record<string, RoomConfig>
): DoorLine[] {
  const placementById = new Map(placements.map((p) => [p.id, p]));
  const lines: DoorLine[] = [];
  for (const p of placements) {
    const cfg = rooms[p.id];
    if (!cfg?.objects?.length) continue;
    for (const obj of cfg.objects) {
      if (obj.type !== "door") continue;
      const target = resolveDoorTargetRoom(obj, rooms);
      const targetPlacement = target ? placementById.get(target.id) : null;
      const status: DoorLine["status"] = !target
        ? "broken"
        : target.id === p.id
          ? "self"
          : "ok";
      const toX = targetPlacement
        ? targetPlacement.worldX + targetPlacement.worldW / 2
        : p.worldX + p.worldW / 2 + 200;
      const toY = targetPlacement
        ? targetPlacement.worldY + targetPlacement.worldH / 2
        : p.worldY + p.worldH / 2;
      lines.push({
        fromRoomId: p.id,
        toRoomId: target?.id ?? null,
        fromX: p.worldX + p.worldW / 2,
        fromY: p.worldY + p.worldH / 2,
        toX,
        toY,
        status,
      });
    }
  }
  return lines;
}

const VIEWPORT_PADDING = 200;

export default function WorldView() {
  useOwnerSessionWatch();
  const { confirm, prompt, dialog } = useDialog();
  const [world, setWorld] = useState<WorldConfig | null>(null);
  const [worlds, setWorlds] = useState<WorldConfig[]>([]);
  const [showNewWorld, setShowNewWorld] = useState(false);
  const [placements, setPlacements] = useState<RoomWorldPlacement[]>([]);
  const [rooms, setRooms] = useState<Record<string, RoomConfig>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  // Deletes move to Recently deleted once migration 20261005000002_trash_and_atomic_ops is applied.
  const trashAvailable = useTrashAvailable();

  // Stage transform (zoom/pan)
  const [scale, setScale] = useState(0.25);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 1200, height: 800 });
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  // Two-finger pinch state (touch screens).
  const pinchRef = useRef<{
    dist: number;
    center: { x: number; y: number };
    scale: number;
    pos: { x: number; y: number };
  } | null>(null);
  const touch = useTouchMode();
  // A card a finger is dragging, and where it started, so a second finger can
  // cancel the move (back to its spot) and pinch instead.
  const dragCardRef = useRef<{ node: Konva.Node; x: number; y: number } | null>(null);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setStageSize({ width: r.width, height: r.height });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    // ?world=<slug> picks which world to show; default is the live one.
    const all = await loadWorlds();
    setWorlds(all);
    const wanted = new URLSearchParams(window.location.search).get("world");
    const w = (wanted && all.find((x) => x.id === wanted)) || pickLiveWorld(all);
    setWorld(w);
    if (!w) {
      setPlacements([]);
      setRooms({});
      setLoading(false);
      return;
    }
    const [pls, allRooms] = await Promise.all([
      listRoomsInWorld(w.iid),
      loadAllRoomsForEditor(),
    ]);
    setPlacements(pls);
    setRooms(allRooms.rooms);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const lines = useMemo(
    () => buildDoorLines(placements, rooms),
    [placements, rooms]
  );

  // GridVania snap config — derived from the world's grid* fields, with a
  // fallback to the canonical room size so a freshly-switched-to-gridvania
  // world still snaps sensibly.
  const snap = useMemo(() => {
    if (world?.layout !== "gridvania") return null;
    return {
      w: world.gridWidth ?? ROOM_WIDTH,
      h: world.gridHeight ?? ROOM_HEIGHT,
    };
  }, [world]);

  const handleDragEnd = useCallback(
    async (id: string, x: number, y: number) => {
      // GridVania collision check: refuse to drop on top of another room.
      // Predictable beats clever — no swap, no auto-bump.
      if (snap) {
        const movingRoom = placements.find((p) => p.id === id);
        if (movingRoom) {
          const collides = placements.some((p) => {
            if (p.id === id) return false;
            return (
              x < p.worldX + p.worldW &&
              x + movingRoom.worldW > p.worldX &&
              y < p.worldY + p.worldH &&
              y + movingRoom.worldH > p.worldY
            );
          });
          if (collides) {
            toast.error("Cell occupied — pick an empty grid cell.");
            // Force a re-render so the visual revert sticks. We mutate to a
            // new object so React sees the change even though the values are
            // identical.
            setPlacements((prev) => prev.map((p) => ({ ...p })));
            return;
          }
        }
      }

      // Optimistic update — patch both the lightweight placement list and
      // the full room map so the neighbour badge recomputes immediately.
      setPlacements((prev) =>
        prev.map((p) => (p.id === id ? { ...p, worldX: x, worldY: y } : p))
      );
      setRooms((prev) => {
        const cfg = prev[id];
        if (!cfg) return prev;
        return { ...prev, [id]: { ...cfg, worldX: x, worldY: y } };
      });
      const res = await updateRoomPlacement(id, { worldX: x, worldY: y });
      if (!res.ok) toast.error(`Failed to save position: ${res.error ?? "?"}`);
    },
    [snap, placements]
  );

  // Selected-room neighbours, computed off the live `rooms` map so the badge
  // updates as the user drags. Only meaningful in gridvania.
  const neighbours = useMemo(() => {
    if (!snap || !selectedId) return null;
    const room = rooms[selectedId];
    if (!room) return null;
    return neighboursOf(room, rooms);
  }, [snap, selectedId, rooms]);

  // Grid overlay extent: a generous box around the current placements so the
  // user always sees grid lines under wherever they're about to drop.
  const gridExtent = useMemo(() => {
    if (!snap) return null;
    if (!placements.length) {
      return { x: 0, y: 0, w: snap.w * 6, h: snap.h * 4 };
    }
    const minX = Math.min(...placements.map((p) => p.worldX)) - snap.w * 2;
    const minY = Math.min(...placements.map((p) => p.worldY)) - snap.h * 2;
    const maxX =
      Math.max(...placements.map((p) => p.worldX + p.worldW)) + snap.w * 2;
    const maxY =
      Math.max(...placements.map((p) => p.worldY + p.worldH)) + snap.h * 2;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [snap, placements]);

  const handleOpen = useCallback((id: string) => {
    window.location.href = `/admin/editor?room=${encodeURIComponent(id)}`;
  }, []);

  const liveWorld = pickLiveWorld(worlds);
  const isLive = !!world && liveWorld?.iid === world.iid;

  const switchWorld = useCallback(
    (slug: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set("world", slug);
      window.history.replaceState(null, "", url);
      setSelectedId(null);
      void reload();
    },
    [reload]
  );

  const handleMakeLive = useCallback(async () => {
    if (!world) return;
    if (!placements.length) {
      toast.error("Add at least one room before making this world live.");
      return;
    }
    if (
      !(await confirm(
        `Make "${world.name}" the live world? Visitors will play it from now on.`,
        { confirmLabel: "Make live" }
      ))
    )
      return;
    const res = await setLiveWorld(world.iid);
    if (!res.ok) {
      toast.error(`Couldn't switch: ${res.error ?? "?"}`);
      return;
    }
    toast.success(`"${world.name}" is now live.`);
    void reload();
  }, [world, placements.length, reload, confirm]);

  const handleDeleteWorld = useCallback(async () => {
    if (!world) return;
    const n = placements.length;
    if (
      !(await confirm(
        trashAvailable
          ? `Delete world "${world.name}" and its ${n} room${n === 1 ? "" : "s"}? They move to Recently deleted, with their content and drawings, so you can undo this.`
          : `Delete world "${world.name}" and its ${n} room${n === 1 ? "" : "s"} (with their content and drawings)? This cannot be undone.`,
        { confirmLabel: "Delete world", danger: true }
      ))
    )
      return;
    const res = await deleteWorld(world.iid);
    if (!res.ok) {
      toast.error(`Couldn't delete: ${res.error ?? "?"}`);
      return;
    }
    if (res.trashId) {
      const trashId = res.trashId;
      const slug = world.id;
      toast.success(`Moved world "${world.name}" to Recently deleted.`, {
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => {
            void restoreDeletedItem(trashId, "world").then((r) => {
              if (r.ok) {
                toast.success(`Restored world "${world.name}".`);
                switchWorld(r.slug ?? slug);
              } else toast.error(r.error ?? "Couldn't restore it");
            });
          },
        },
      });
    } else {
      toast.success(`Deleted world "${world.name}".`);
    }
    switchWorld("main");
  }, [world, placements.length, confirm, switchWorld, trashAvailable]);

  const handleDelete = useCallback(
    async (id: string) => {
      // Count inbound doors so the confirm dialog tells the truth.
      let inbound = 0;
      for (const cfg of Object.values(rooms)) {
        for (const obj of cfg.objects ?? []) {
          if (obj.type !== "door") continue;
          const target = resolveDoorTargetRoom(obj, rooms);
          if (target?.id === id) inbound++;
        }
      }
      const msg =
        inbound > 0
          ? `"${id}" is the target of ${inbound} door${inbound === 1 ? "" : "s"}. Delete anyway?`
          : trashAvailable
            ? `Delete room "${id}"? It moves to Recently deleted, so you can undo this.`
            : `Delete room "${id}"? This cannot be undone.`;
      if (!(await confirm(msg, { confirmLabel: "Delete", danger: true }))) return;

      const res = await deleteRoom(id);
      if (!res.ok) {
        toast.error(`Delete failed: ${res.error ?? "?"}`);
        return;
      }
      let startToastId: string | number | undefined;
      if (world && world.config?.defaultRoomId === id) {
        await saveWorld(world.iid, { config: { defaultRoomId: undefined } });
        startToastId = toast.info("That was the start room — pick a new one with “Set as start”.");
      }
      if (res.trashId) {
        const trashId = res.trashId;
        toast.success(`Moved "${id}" to Recently deleted.`, {
          duration: 10000,
          action: {
            label: "Undo",
            onClick: () => {
              void restoreDeletedItem(trashId, "room").then((r) => {
                if (r.ok) {
                  // The restore puts the start-room pointer back (migration
                  // 20261006000001_history_kind_trash_pointers_draft_renames).
                  if (startToastId !== undefined) toast.dismiss(startToastId);
                  toast.success(`Restored "${id}".`);
                  void reload();
                } else toast.error(r.error ?? "Couldn't restore it");
              });
            },
          },
        });
      } else {
        toast.success(`Deleted "${id}".`);
      }
      setSelectedId(null);
      void reload();
    },
    [rooms, reload, world, confirm, trashAvailable]
  );

  const startRoomId = world?.config?.defaultRoomId || "home";

  const handleSetStart = useCallback(
    async (id: string) => {
      if (!world) return;
      const res = await saveWorld(world.iid, { config: { defaultRoomId: id } });
      if (!res.ok) {
        toast.error(`Couldn't set start room: ${res.error ?? "?"}`);
        return;
      }
      setWorld({ ...world, config: { ...world.config, defaultRoomId: id } });
      toast.success(`Players now start in "${id}".`);
    },
    [world]
  );

  // Slug rename safety. Walks every door's
  // `targetRoomId` so no inbound link rots; mirrors to the file system
  // when external files are on.
  const handleRename = useCallback(
    async (id: string) => {
      const room = rooms[id];
      if (!room) return;
      const newSlug = await prompt(
        `Rename "${id}" to:\n\n(lowercase letters, digits, _ and - only; must start with a letter or digit)`,
        id,
        { confirmLabel: "Rename" }
      );
      if (newSlug == null) return;
      const trimmed = newSlug.trim();
      if (!trimmed || trimmed === id) return;
      if (!room.iid) {
        toast.error(`Cannot rename: room "${id}" has no stable iid.`);
        return;
      }
      const res = await renameRoom(room.iid, id, trimmed);
      if (!res.ok) {
        if (res.code === "conflict") {
          // A room changed while renaming: nothing was renamed (one transaction).
          toast.error(res.error ?? "A room changed elsewhere.", {
            duration: 10000,
            action: { label: "Reload", onClick: () => void reload() },
          });
        } else {
          toast.error(`Rename failed: ${res.error ?? "?"}`);
        }
        return;
      }
      toast.success(
        `Renamed "${id}" → "${trimmed}"` +
          (res.doorsUpdated
            ? ` (updated ${res.doorsUpdated} inbound door${res.doorsUpdated === 1 ? "" : "s"})`
            : "")
      );
      setSelectedId(trimmed);
      void reload();
    },
    [rooms, reload, prompt]
  );

  // Keyboard: Enter opens the selected room, Esc deselects, arrows nudge it
  // (a grid cell in gridvania, else 20px; Shift ×10).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (showNewModal || showNewWorld || showSettings) return;
      if (!selectedId) return;
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (e.key === "Enter" && !t?.closest?.("button, a")) {
        e.preventDefault();
        handleOpen(selectedId);
        return;
      }
      const dirs: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const d = dirs[e.key];
      if (!d) return;
      const p = placements.find((pl) => pl.id === selectedId);
      if (!p) return;
      e.preventDefault();
      const mult = e.shiftKey ? 10 : 1;
      const stepX = snap ? snap.w : 20 * mult;
      const stepY = snap ? snap.h : 20 * mult;
      void handleDragEnd(selectedId, p.worldX + d[0] * stepX, p.worldY + d[1] * stepY);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, placements, snap, handleDragEnd, handleOpen, showNewModal, showNewWorld, showSettings]);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.1;
    const newScale = direction > 0 ? oldScale * factor : oldScale / factor;
    const clamped = Math.max(0.05, Math.min(2, newScale));
    setScale(clamped);
    setStagePos({
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
  };

  const fitToContent = useCallback(() => {
    if (!placements.length) return;
    const minX = Math.min(...placements.map((p) => p.worldX));
    const minY = Math.min(...placements.map((p) => p.worldY));
    const maxX = Math.max(...placements.map((p) => p.worldX + p.worldW));
    const maxY = Math.max(...placements.map((p) => p.worldY + p.worldH));
    const contentW = maxX - minX + VIEWPORT_PADDING * 2;
    const contentH = maxY - minY + VIEWPORT_PADDING * 2;
    const fit = Math.min(stageSize.width / contentW, stageSize.height / contentH);
    const newScale = Math.max(0.05, Math.min(1, fit));
    setScale(newScale);
    setStagePos({
      x: -minX * newScale + VIEWPORT_PADDING * newScale,
      y: -minY * newScale + VIEWPORT_PADDING * newScale,
    });
  }, [placements, stageSize]);

  useEffect(() => {
    if (!loading && placements.length) fitToContent();
    // Run only when the placement set first arrives. Subsequent re-fits
    // happen via the toolbar button so the user keeps their pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Pinch zoom on native touch events: Konva stops firing its own touchmove
  // while a drag runs (a one-finger pan or card move is exactly what's running
  // when the second finger lands), and iOS Safari would zoom the page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !touch) return;
    const onMove = (ev: TouchEvent) => {
      const t = ev.touches;
      if (t.length !== 2) return;
      ev.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      if (stage.isDragging()) stage.stopDrag();
      const card = dragCardRef.current;
      if (card?.node.isDragging()) {
        card.node.position({ x: card.x, y: card.y });
        card.node.stopDrag();
      }
      dragCardRef.current = null;
      const rect = stage.container().getBoundingClientRect();
      const a = { x: t[0].clientX - rect.left, y: t[0].clientY - rect.top };
      const b = { x: t[1].clientX - rect.left, y: t[1].clientY - rect.top };
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const prev = pinchRef.current;
      if (!prev) {
        pinchRef.current = { dist, center, scale: stage.scaleX(), pos: stage.position() };
        return;
      }
      const next = Math.max(0.05, Math.min(2, prev.scale * (dist / prev.dist)));
      const wx = (prev.center.x - prev.pos.x) / prev.scale;
      const wy = (prev.center.y - prev.pos.y) / prev.scale;
      const pos = { x: center.x - wx * next, y: center.y - wy * next };
      pinchRef.current = { dist, center, scale: next, pos };
      stage.scale({ x: next, y: next });
      stage.position(pos);
      setScale(next);
      setStagePos(pos);
    };
    const onEnd = (ev: TouchEvent) => {
      if (ev.touches.length < 2) pinchRef.current = null;
    };
    const stopPageZoom = (e: Event) => e.preventDefault();
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("gesturestart", stopPageZoom, { passive: false });
    el.addEventListener("gesturechange", stopPageZoom, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", stopPageZoom);
      el.removeEventListener("gesturechange", stopPageZoom);
    };
  }, [touch, loading, world]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-900 text-slate-200">
        Loading world…
      </div>
    );
  }

  if (!world) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-900 text-slate-200">
        <p>No world found.</p>
        <p className="text-sm text-slate-400">
          Create the main world by running <code>npm run db:seed</code> in the <code>app</code> folder.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
        <a
          href="/admin/editor"
          className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
        >
          Back to editor
        </a>
      </div>
    );
  }

  return (
    <div className="editor-root flex h-dvh flex-col bg-slate-900 text-slate-100">
      {dialog}
      {showTrash && (
        <RecentlyDeletedPanel
          onClose={() => setShowTrash(false)}
          onRestored={(item, slug) => {
            void reload();
            if (item.kind === "world" && slug) switchWorld(slug);
          }}
        />
      )}
      <SessionLostBanner />
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800 px-4 py-2 touch:flex-wrap">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
        <a
          href="/admin"
          title="Admin dashboard"
          aria-label="Admin dashboard"
          className="flex items-center rounded p-1.5 hover:bg-slate-700"
        >
          <LayoutDashboard className="h-4 w-4" />
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
        <a
          href="/admin/editor"
          className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Editor
        </a>
        <Globe className="ml-2 h-4 w-4 text-slate-400" />
        <select
          value={world.id}
          onChange={(e) => {
            if (e.target.value === "__new__") setShowNewWorld(true);
            else switchWorld(e.target.value);
          }}
          className="rounded bg-slate-700 px-2 py-1 text-sm font-semibold"
          title="Switch world"
        >
          {worlds.map((w) => (
            <option key={w.iid} value={w.id}>
              {w.name}
              {liveWorld?.iid === w.iid ? " (live)" : ""}
            </option>
          ))}
          <option value="__new__">＋ New world…</option>
        </select>
        {isLive ? (
          <span className="flex items-center gap-1 rounded-full bg-green-700/80 px-2 py-0.5 text-xs font-semibold">
            <Radio className="h-3 w-3" /> LIVE
          </span>
        ) : (
          <button
            onClick={handleMakeLive}
            className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs hover:bg-green-700"
            title="Visitors will play this world"
          >
            <Radio className="h-3 w-3" /> Make live
          </button>
        )}
        {!isLive && world.id !== "main" && (
          <button
            onClick={handleDeleteWorld}
            className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs hover:bg-red-700"
            title="Delete this world and all its rooms"
          >
            <Trash2 className="h-3 w-3" /> Delete world
          </button>
        )}
        <div className="ml-2 text-xs text-slate-400">
          {placements.length} room{placements.length === 1 ? "" : "s"}
          {placements.length === 1 ? " · plays as a single room" : ""}
        </div>
        <button
          onClick={() => setShowTrash(true)}
          className="ml-2 flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
          title="Restore rooms and worlds you deleted"
        >
          <RotateCcw className="h-3 w-3" /> Recently deleted
        </button>
        <div
          className="ml-2 rounded bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-300"
          title="Room positions aren't part of room drafts: dragging a room changes the live map at once."
        >
          Positions save instantly
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setScale((s) => Math.min(2, s * 1.2))}
            className="rounded p-1 hover:bg-slate-700"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.05, s / 1.2))}
            className="rounded p-1 hover:bg-slate-700"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={fitToContent}
            className="rounded p-1 hover:bg-slate-700"
            title="Fit to content"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          {selectedId && (
            <>
              <button
                onClick={() => handleOpen(selectedId)}
                className="ml-2 flex items-center gap-1 rounded bg-blue-700 px-3 py-1 text-sm hover:bg-blue-600"
                title="Open this room in the editor"
              >
                <ExternalLink className="h-4 w-4" /> Open
              </button>
              {selectedId !== startRoomId && (
                <button
                  onClick={() => handleSetStart(selectedId)}
                  className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600"
                  title="Players land in this room when the game starts"
                >
                  <Flag className="h-4 w-4" /> Set as start
                </button>
              )}
              <button
                onClick={() => handleRename(selectedId)}
                className="ml-2 flex items-center gap-1 rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
                title="Rename room slug (rewrites inbound doors)"
              >
                <Pencil className="h-4 w-4" /> Rename
              </button>
              <button
                onClick={() => handleDelete(selectedId)}
                className="flex items-center gap-1 rounded bg-red-700 px-3 py-1 text-sm hover:bg-red-600"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded p-1 hover:bg-slate-700"
            title="Project settings"
            aria-label="Open project settings"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="ml-2 flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" /> New room
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        style={{ touchAction: "none" }}
      >
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          x={stagePos.x}
          y={stagePos.y}
          scaleX={scale}
          scaleY={scale}
          draggable
          onWheel={handleWheel}
          // Two-finger pinch: native listeners (effect above the early returns).
          onDragStart={(e) => {
            if (e.target !== e.target.getStage()) {
              dragCardRef.current = { node: e.target, x: e.target.x(), y: e.target.y() };
            }
          }}
          onDragEnd={(e) => {
            // Stage drag bubbles up from RoomCard drag — only apply if the
            // drag target IS the stage itself.
            if (e.target === e.target.getStage()) {
              setStagePos({ x: e.target.x(), y: e.target.y() });
            }
          }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
          onTap={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
        >
          {/* GridVania overlay (bottom layer) — drawn under everything so
              cards sit on top of grid lines. */}
          {snap && gridExtent && (
            <Layer listening={false}>
              <Rect
                x={gridExtent.x}
                y={gridExtent.y}
                width={gridExtent.w}
                height={gridExtent.h}
                fill="#0f172a"
                opacity={0.4}
              />
              {Array.from({
                length: Math.floor(gridExtent.w / snap.w) + 1,
              }).map((_, i) => (
                <Line
                  key={`gv-${i}`}
                  points={[
                    gridExtent.x + i * snap.w,
                    gridExtent.y,
                    gridExtent.x + i * snap.w,
                    gridExtent.y + gridExtent.h,
                  ]}
                  stroke="#334155"
                  strokeWidth={2}
                />
              ))}
              {Array.from({
                length: Math.floor(gridExtent.h / snap.h) + 1,
              }).map((_, i) => (
                <Line
                  key={`gh-${i}`}
                  points={[
                    gridExtent.x,
                    gridExtent.y + i * snap.h,
                    gridExtent.x + gridExtent.w,
                    gridExtent.y + i * snap.h,
                  ]}
                  stroke="#334155"
                  strokeWidth={2}
                />
              ))}
            </Layer>
          )}

          <Layer listening={false}>
            {/* Door connection lines (under cards). */}
            {lines.map((l, i) => {
              const color =
                l.status === "broken"
                  ? "#ef4444"
                  : l.status === "self"
                    ? "#64748b"
                    : "#22c55e";
              return (
                <Line
                  key={`line-${i}`}
                  points={[l.fromX, l.fromY, l.toX, l.toY]}
                  stroke={color}
                  strokeWidth={6}
                  opacity={0.7}
                  dash={l.status === "broken" ? [20, 12] : undefined}
                />
              );
            })}
          </Layer>
          <Layer>
            {placements.map((p) => (
              <RoomCard
                key={p.id}
                placement={p}
                selected={selectedId === p.id}
                isStart={p.id === startRoomId}
                bgColor={rooms[p.id]?.backgroundColor}
                snap={snap}
                view={{ x: stagePos.x, y: stagePos.y, scale }}
                touch={touch}
                onSelect={() => setSelectedId(p.id)}
                onDoubleClick={() => handleOpen(p.id)}
                onDragEnd={(x, y) => handleDragEnd(p.id, x, y)}
              />
            ))}
          </Layer>
        </Stage>

        {/* Neighbour badge (gridvania only). Shows the slugs of the
            four adjacent rooms for the currently-selected card. Hidden in
            free layout so the WorldView doesn't get noisier than it has
            to be. */}
        {snap && neighbours && selectedId && (
          <div className="pointer-events-none absolute right-4 top-4 rounded bg-slate-800/90 p-3 font-mono text-xs text-slate-200">
            <div className="mb-1 text-slate-400">Neighbours of &ldquo;{selectedId}&rdquo;</div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-center">
              <span />
              <span className="text-slate-400">N</span>
              <span />
              <span className="text-slate-400">W</span>
              <span className="text-blue-300">·</span>
              <span className="text-slate-400">E</span>
              <span />
              <span className="text-slate-400">S</span>
              <span />
              <span />
              <span>{neighbours.n?.id ?? "—"}</span>
              <span />
              <span>{neighbours.w?.id ?? "—"}</span>
              <span />
              <span>{neighbours.e?.id ?? "—"}</span>
              <span />
              <span>{neighbours.s?.id ?? "—"}</span>
              <span />
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-4 left-4 rounded bg-slate-800/90 p-3 text-xs">
          <div className="mb-1 font-semibold text-slate-200">Door links</div>
          <div className="flex items-center gap-2">
            <span className="h-1 w-6 bg-green-500" /> valid
          </div>
          <div className="flex items-center gap-2">
            <span
              className="h-1 w-6 bg-red-500"
              style={{ borderTop: "2px dashed #ef4444" }}
            />{" "}
            broken
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1 w-6 bg-slate-500" /> same room
          </div>
          <div className="mt-2 text-slate-400">
            {touch
              ? "Tap a room, then Open (top bar) or double-tap it. Drag a selected room to move it. Pinch to zoom."
              : "Double-click a room to edit. Drag to reposition."}
          </div>
        </div>
      </div>

      {showSettings && (
        <ProjectSettingsModal
          worldId={world.id}
          onClose={() => setShowSettings(false)}
          onSaved={(w) => setWorld(w)}
        />
      )}

      {showNewWorld && (
        <NewWorldModal
          existingWorldIds={new Set(worlds.map((w) => w.id))}
          existingRoomIds={new Set(Object.keys(rooms))}
          onClose={() => setShowNewWorld(false)}
          onCreated={(slug) => {
            setShowNewWorld(false);
            switchWorld(slug);
          }}
        />
      )}

      {showNewModal && (
        <NewRoomModal
          worldIid={world.iid}
          // Slugs are unique across ALL rooms (rooms.id is the primary key),
          // not just the ones placed in this world.
          existingIds={new Set([...placements.map((p) => p.id), ...Object.keys(rooms)])}
          rooms={rooms}
          // Drop new rooms to the right of everything (they used to all land
          // on 0,0 on top of each other). Snapped to the grid in gridvania.
          nextPosition={(() => {
            if (!placements.length) return { x: 0, y: 0 };
            const right = Math.max(...placements.map((p) => p.worldX + p.worldW));
            const top = Math.min(...placements.map((p) => p.worldY));
            const gap = snap ? 0 : 200;
            const x = snap ? Math.ceil(right / snap.w) * snap.w : right + gap;
            const y = snap ? Math.round(top / snap.h) * snap.h : top;
            return { x, y };
          })()}
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            setShowNewModal(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ─── New Room Modal ─────────────────────────────────────────

interface NewRoomModalProps {
  worldIid: string;
  existingIds: Set<string>;
  rooms: Record<string, RoomConfig>;
  nextPosition: { x: number; y: number };
  onClose: () => void;
  onCreated: () => void;
}

function NewRoomModal({
  worldIid,
  existingIds,
  rooms,
  nextPosition,
  onClose,
  onCreated,
}: NewRoomModalProps) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const slugError = !slug
    ? null
    : !/^[a-z0-9][a-z0-9_-]*$/.test(slug)
      ? "Lowercase letters, digits, - and _ only; must start with a letter or digit."
      : existingIds.has(slug)
        ? `A room with slug "${slug}" already exists.`
        : null;

  const canSubmit = slug && name && !slugError && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const res = await createRoom({
      id: slug,
      name,
      copyFromRoomId: copyFrom || undefined,
      worldX: nextPosition.x,
      worldY: nextPosition.y,
      worldIid,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(`Create failed: ${res.error ?? "?"}`);
      return;
    }
    toast.success(`Created "${slug}".`);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded-lg bg-slate-800 p-5 text-slate-100 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">New room</h2>
        <label className="mb-3 block">
          <div className="mb-1 text-xs text-slate-400">Slug (URL-safe, unique)</div>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="e.g. workshop"
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          {slugError && (
            <div className="mt-1 text-xs text-red-400">{slugError}</div>
          )}
        </label>
        <label className="mb-3 block">
          <div className="mb-1 text-xs text-slate-400">Display name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workshop"
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="mb-4 block">
          <div className="mb-1 text-xs text-slate-400">Copy from (optional)</div>
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— blank room —</option>
            {Object.values(rooms).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? r.id} ({r.id})
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-2 text-sm hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New World Modal ────────────────────────────────────────

function NewWorldModal({
  existingWorldIds,
  existingRoomIds,
  onClose,
  onCreated,
}: {
  existingWorldIds: Set<string>;
  existingRoomIds: Set<string>;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [shape, setShape] = useState<"room" | "world">("room");
  const [busy, setBusy] = useState(false);

  // The starter room needs a globally unique slug too.
  const roomSlug = slug ? `${slug}-start` : "";
  const slugError = !slug
    ? null
    : !/^[a-z0-9][a-z0-9_-]*$/.test(slug)
      ? "Lowercase letters, digits, - and _ only; must start with a letter or digit."
      : existingWorldIds.has(slug)
        ? `A world called "${slug}" already exists.`
        : existingRoomIds.has(roomSlug)
          ? `A room called "${roomSlug}" already exists — pick another slug.`
          : null;
  const canSubmit = slug && name && !slugError && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const res = await createWorld({
      id: slug,
      name,
      layout: "free",
      starterRoom: { id: roomSlug, name: shape === "room" ? name : `${name} — start` },
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(`Create failed: ${res.error ?? "?"}`);
      return;
    }
    toast.success(`Created world "${name}". Double-click its room to start shaping it.`);
    onCreated(slug);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[440px] rounded-lg bg-slate-800 p-5 text-slate-100 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">New world</h2>
        <label className="mb-3 block">
          <div className="mb-1 text-xs text-slate-400">Slug (URL-safe, unique)</div>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="e.g. winter"
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          {slugError && <div className="mt-1 text-xs text-red-400">{slugError}</div>}
        </label>
        <label className="mb-3 block">
          <div className="mb-1 text-xs text-slate-400">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Winter Garden"
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <div className="mb-4">
          <div className="mb-1 text-xs text-slate-400">Shape</div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["room", "One room", "A single scene — no map, no doors."],
                ["world", "A world", "Starts with one room; add more and link them with doors."],
              ] as const
            ).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setShape(value)}
                className={`rounded border p-2 text-left text-xs ${
                  shape === value
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-slate-600 hover:border-slate-500"
                }`}
              >
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-slate-400">{hint}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            You can always grow a one-room world later — it becomes a world as soon
            as you add a second room.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-2 text-sm hover:bg-slate-700">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
