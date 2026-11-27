"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  Stage,
  Layer,
  Rect,
  Line,
  Circle,
  Text,
  Group,
  Transformer,
  Image as KonvaImage,
} from "react-konva";
import type Konva from "konva";
import { ZoomIn, ZoomOut, Maximize2, Square, MapPin, Lock as LockIcon } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { announce } from "@/lib/a11yAnnounce";
import { useCoarsePointer } from "@/lib/useMediaQuery";
import {
  defaultArtFor,
  fitArt,
  STARTER_ELEMENTS,
  type StarterElement,
} from "@/data/starterElements";

/** A room object built from a starter element (sprite = its drawing). */
function objectFromElement(el: StarterElement, x: number, y: number): RoomObject {
  return {
    id: `${el.id}-${Date.now().toString(36)}`,
    x: Math.round(x),
    y: Math.round(y),
    width: el.w,
    height: el.h,
    type: el.type,
    label: el.name,
    labelAr: el.nameAr,
    spriteUrl: el.url,
    category: el.category,
    isWallMounted: !!el.wallMounted,
    interactionRadius: Math.round(Math.max(el.w, el.h) * 0.8),
    interactionType:
      el.type === "door" ? undefined : el.decoration ? "none" : "content",
    showLabel: el.type === "door",
  };
}
import type {
  RoomConfig,
  RoomObject,
  Point,
  RoomId,
} from "@/data/roomTypes";
import { ROOM_WIDTH, ROOM_HEIGHT } from "@/data/roomTypes";
import type { TemplateRow } from "@/lib/editorData";
import { categoryHex } from "@/lib/templateCategories";
import { clampPointToPolygon } from "@/lib/geometry";
import { nearTriggerOf, objectFieldsFromBehaviour, walkTargetOf, withLegacyInteraction } from "@/lib/objectActions";
import { newIid } from "@/lib/iid";
import { isRoomObjectLocked, showLockedHint } from "@/lib/layerLock";

// Subset of TemplateRow that the canvas needs at drop time. The library
// panel serializes the full row into the drag payload, so anything in
// TemplateRow is available — but only these fields actually shape the
// spawned object.
type TemplateDropPayload = Pick<
  TemplateRow,
  | "category"
  | "defaultWidth"
  | "defaultHeight"
  | "defaultLabel"
  | "defaultLabelAr"
  | "spriteUrl"
  | "interactionType"
  | "externalUrl"
  | "isWallMounted"
  | "interactionRadius"
  | "hitboxPolygon"
  | "zIndexOffset"
  | "requiredFields"
  | "behaviour"
>;

// ─── Sprite Image Hook ──────────────────────────────────────────

/** Load an image from a URL (including data URLs) for use in Konva <Image>.
 *  Cancels pending loads on URL change so a stale onload can't overwrite the
 *  new image — that was causing the "zoomed in then fixes itself" flash after
 *  Set-as-Background. */
function useSpriteImage(url?: string): HTMLImageElement | null {
  // Keyed by URL: a new url yields null at once — Konva never draws the stale
  // bitmap stretched at the new stage size for one frame.
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!cancelled) setLoaded({ url, img });
    };
    img.onerror = () => {
      if (!cancelled) setLoaded(null);
    };
    img.src = url;

    return () => {
      cancelled = true;
      // Detach handlers so nothing calls setImage after unmount.
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return loaded && loaded.url === url ? loaded.img : null;
}

// ─── Object Colors ────────────────────────────────────────────

// 7d: Comfortable spawn size for raw sprite drops. A 1500×1500 image as a
// 1500×1500 object covers the whole room and the resize handles land off-
// screen — there's no graceful path back. Rescale on drop to ≤40% of the
// narrower room dimension, preserving aspect; the user can always type
// bigger numbers in the side panel afterwards.
function fitDroppedSpriteSize(
  naturalW: number,
  naturalH: number,
  roomW: number,
  roomH: number
): { w: number; h: number; scaled: boolean } {
  const w0 = Math.max(16, naturalW);
  const h0 = Math.max(16, naturalH);
  const maxLong = Math.round(Math.min(roomW, roomH) * 0.4);
  const long = Math.max(w0, h0);
  if (long <= maxLong) return { w: w0, h: h0, scaled: false };
  const scale = maxLong / long;
  return {
    w: Math.max(16, Math.round(w0 * scale)),
    h: Math.max(16, Math.round(h0 * scale)),
    scaled: true,
  };
}

function getObjectFill(type: RoomObject["type"]): string {
  switch (type) {
    case "door":
      return "#6b4226";
    case "npc":
      return "#8b5cf6";
    default:
      return "#5f9ea0";
  }
}

// ─── Sprite-aware object shape ───────────────────────────────

/** Renders either a KonvaImage (if spriteUrl exists) or a colored Rect */
function EditorObjectShape({
  obj,
  isSelected,
  activeTool,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransform,
  onTransformEnd,
  panning = false,
}: {
  obj: RoomObject;
  isSelected: boolean;
  activeTool: string;
  /** Space / middle-mouse pan in progress — let presses reach the stage. */
  panning?: boolean;
  /** additive = Shift/Ctrl/Cmd held → toggle in the multi-selection. */
  onSelect: (additive: boolean) => void;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransform?: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}) {
  // Touch: a finger on an object that is NOT selected pans the canvas (the
  // stage is draggable); only the selected object moves under one finger. A tap
  // selects it (onTap below).
  const coarse = useCoarsePointer();
  const spriteImage = useSpriteImage(obj.spriteUrl);
  // No own sprite → show the default starter drawing (same as the game).
  const defaultImage = useSpriteImage(
    obj.spriteUrl ? undefined : defaultArtFor(obj) ?? undefined
  );
  const hasSprite = spriteImage !== null || defaultImage !== null;
  // Photoshop-style: sprite objects only show their bounding box on hover
  // (not always), so the canvas stays uncluttered until the user mouses over
  // a thing they might want to interact with. Selection still wins.
  const [isHovered, setIsHovered] = useState(false);
  const showHoverBorder = hasSprite && !isSelected && isHovered;

  // Anchor the shape so rotation pivots around its center. With offsetX/Y at
  // half-width/half-height, the node's (x, y) refers to its center, so we add
  // the half-extents to obj.x / obj.y.
  const sharedProps = {
    id: `obj-${obj.id}`,
    x: obj.x + obj.width / 2,
    y: obj.y + obj.height / 2,
    width: obj.width,
    height: obj.height,
    offsetX: obj.width / 2,
    offsetY: obj.height / 2,
    rotation: obj.rotation ?? 0,
    // Secret (reveal-on-hover) objects read as ghosted until you hover or
    // select them, so it's obvious they're hidden in the game.
    opacity: isSelected ? 1 : obj.revealOnHover && !isHovered ? 0.35 : 0.85,
    // Stroke priority:
    //   selected w/ category → solid category color, 2px (LDtk-style scan-by-color)
    //   selected   → solid white, 2px (matches transformer)
    //   hovered+sprite → soft grey 1px (Photoshop-style "you can grab this")
    //   no sprite  → solid black 1px (the fallback rect needs an edge to read)
    //   else       → no stroke (sprites carry their own edges)
    stroke: isSelected
      ? obj.category
        ? categoryHex(obj.category)
        : "#fff"
      : showHoverBorder
      ? "#9ca3af"
      : hasSprite
      ? undefined
      : "#000",
    strokeWidth: isSelected ? 2 : showHoverBorder ? 1 : hasSprite ? 0 : 1,
    draggable: activeTool === "select" && !panning && (!coarse || isSelected),
    // Select on press (not click) so a press-and-drag on an unselected
    // object selects it and shows its handles immediately.
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      // No cancelBubble: the stage still needs this press to start a
      // Space/middle-mouse pan over an object.
      if (e.evt.button !== 0 || activeTool === "pan" || panning) return;
      const additive = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
      // Stop the press reaching the stage so it doesn't start a marquee.
      e.cancelBubble = true;
      if (additive) onSelect(true);
      else if (!isSelected) onSelect(false);
    },
    onTap: (e: Konva.KonvaEventObject<Event>) => {
      e.cancelBubble = true;
      onSelect(false);
    },
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
    },
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
      setIsHovered(true);
      // "You can grab this" — the stage's own container carries the cursor.
      const c = e.target.getStage()?.container();
      if (c && activeTool === "select") c.style.cursor = "move";
    },
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
      setIsHovered(false);
      const c = e.target.getStage()?.container();
      if (c) c.style.cursor = "";
    },
    onDragStart,
    onDragMove,
    onDragEnd,
    onTransform,
    onTransformEnd,
  };

  let shape: React.ReactNode;
  if (spriteImage) {
    shape = <KonvaImage {...sharedProps} image={spriteImage} />;
  } else if (!obj.spriteUrl) {
    // Default drawing / invisible hotspot. A Group is the transformable node
    // (id obj-…): an almost-transparent Rect gives it the full hit area and
    // bounding box, the drawing sits inside fitted on the floor line.
    const { stroke, strokeWidth, ...groupProps } = sharedProps;
    const fit = defaultImage
      ? fitArt(
          { x: 0, y: 0, width: obj.width, height: obj.height },
          { w: defaultImage.naturalWidth || obj.width, h: defaultImage.naturalHeight || obj.height }
        )
      : null;
    shape = (
      <Group {...groupProps}>
        <Rect
          width={obj.width}
          height={obj.height}
          // Invisible in the game → visible (dashed, tinted) while editing so
          // it can still be found and selected.
          fill={obj.invisible ? "rgba(96,165,250,0.14)" : "rgba(0,0,0,0.001)"}
          stroke={
            isSelected
              ? stroke
              : obj.invisible
                ? "#60a5fa"
                : showHoverBorder
                  ? "#9ca3af"
                  : undefined
          }
          strokeWidth={isSelected ? strokeWidth : obj.invisible ? 1.5 : showHoverBorder ? 1 : 0}
          dash={obj.invisible && !isSelected ? [8, 6] : undefined}
          cornerRadius={6}
          // Fill + stroke under the group's partial opacity makes Konva route
          // the draw through the stage's buffer canvas; skip that path.
          perfectDrawEnabled={false}
        />
        {fit && defaultImage && (
          <KonvaImage
            image={defaultImage}
            x={fit.cx - fit.w / 2}
            y={fit.cy - fit.h / 2}
            width={fit.w}
            height={fit.h}
            listening={false}
          />
        )}
      </Group>
    );
  } else {
    // Own sprite still loading (or failed): coloured stand-in.
    shape = (
      <Rect
        {...sharedProps}
        fill={obj.category ? categoryHex(obj.category) : getObjectFill(obj.type)}
        cornerRadius={6}
      />
    );
  }

  // Little badges so Easter eggs / secrets are findable in a busy room.
  const badge = `${obj.easterEgg ? "🥚" : ""}${obj.revealOnHover ? "👻" : ""}`;
  if (!badge) return shape;
  return (
    <>
      {shape}
      <Text
        x={obj.x + obj.width - 4}
        y={obj.y - 4}
        text={badge}
        fontSize={20}
        offsetX={badge.length > 2 ? 40 : 20}
        listening={false}
      />
    </>
  );
}

// ─── Local <-> world coordinate helpers for rotated hitbox polygons ───

function localToWorld(
  obj: RoomObject,
  p: Point
): Point {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rad = ((obj.rotation ?? 0) * Math.PI) / 180;
  const lx = p.x - obj.width / 2;
  const ly = p.y - obj.height / 2;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  };
}

function worldToLocal(
  obj: RoomObject,
  p: Point
): Point {
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rad = ((obj.rotation ?? 0) * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  return {
    x: dx * cos - dy * sin + obj.width / 2,
    y: dx * sin + dy * cos + obj.height / 2,
  };
}

// ─── Component ────────────────────────────────────────────────

interface EditorCanvasProps {
  /** When true (spacebar held by user), stage pans regardless of active tool */
  spacePanHeld?: boolean;
  /** Render faded target-room thumbnails at doors. */
  showOnionSkin?: boolean;
}

export function EditorCanvas({
  spacePanHeld = false,
  showOnionSkin = true,
}: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(0.6);

  // Alignment guides rendered during object drag; cleared on drag end.
  const [alignGuides, setAlignGuides] = useState<{
    xs: number[];
    ys: number[];
  }>({ xs: [], ys: [] });

  // Live readout next to the pointer while moving / resizing / rotating
  // (screen px inside the canvas container).
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  // Where the current object drag started (object centre) — for Shift axis lock.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Vertex being dragged: the polygon follows it live from local state and
  // the store is written once on release (one undo step, no per-frame churn).
  const [vertexDrag, setVertexDrag] = useState<{
    kind: "walk" | "hitbox";
    index: number;
    point: Point;
  } | null>(null);
  // Asset-library drag hovering the canvas → show a drop target.
  const [isDropTarget, setIsDropTarget] = useState(false);

  // Touch: finger-sized handles, pinch zoom, long-press menu.
  const coarse = useCoarsePointer();
  const pinchRef = useRef<{
    dist: number;
    center: { x: number; y: number };
    scale: number;
    pos: { x: number; y: number };
  } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The node a finger is dragging (object, handle), so a second finger can
  // turn the drag into a pinch; and when the last pinch ended, so the tap
  // that ends a two-finger gesture doesn't also deselect.
  const dragNodeRef = useRef<Konva.Node | null>(null);
  const lastPinchAtRef = useRef(0);
  // Touch: a still long-press on a polygon handle arms it (turns red) and
  // releasing deletes that point; the mouse uses right-click. Moving the
  // finger far enough to drag disarms it.
  const vertexPressRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    armed: Konva.Circle | null;
    fill: string | null;
  }>({ timer: null, armed: null, fill: null });

  // Middle-mouse pan state: when true, stage is draggable regardless of tool.
  const [middleMouseDown, setMiddleMouseDown] = useState(false);

  // Right-click context menu state. Anchored at the
  // screen-pixel position of the right-click; carries the world-coords
  // pick + the object id we'll attach the moveTo to. HTML overlay (not a
  // Konva node) so click-outside-to-close uses native event flow.
  const [contextMenu, setContextMenu] = useState<
    | {
        screenX: number;
        screenY: number;
        worldPos: Point;
        objectId: string;
      }
    | null
  >(null);

  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const toggleObjectSelection = useEditorStore((s) => s.toggleObjectSelection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const moveObjects = useEditorStore((s) => s.moveObjects);
  const transformObjects = useEditorStore((s) => s.transformObjects);
  // Marquee (box) selection in room coords while dragging on empty canvas.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number; additive: boolean; moved: boolean } | null>(null);
  const marqueeMovedRef = useRef(false);
  const lockedPressRef = useRef<{ id: string; x: number; y: number } | null>(null);
  // Group transforms: Konva fires transformend once per node — batch them
  // into one store write (one undo step).
  const pendingTransformsRef = useRef<
    { id: string; x: number; y: number; width: number; height: number; rotation: number }[]
  >([]);

  const {
    currentRoomConfig,
    selectedObjectId,
    selectObject,
    activeTool,
    moveObject,
    addObject,
    updateObject,
    gridEnabled,
    gridSize,
    // Walkable area
    updateWalkableVertex,
    addWalkableVertex,
    deleteWalkableVertex,
    // Object hitbox
    transformObject,
    updateObjectVertex,
    addObjectVertex,
    deleteObjectVertex,
    // Entry points
    selectedEntryPointId,
    selectEntryPoint,
    updateEntryPoint,
    addEntryPoint,
  } = useEditorStore();

  // Hidden (a session-only workspace flag) = render at 0.15 opacity and skip
  // pointer events. Locked (the stored `RoomObject.locked`, see lib/layerLock)
  // = render normally, skip pointer events (clicks pass through to whatever is
  // behind) and get no Transformer handles; it stays selectable from the outline.
  const hiddenObjectIds = useEditorStore((s) => s.hiddenObjectIds);
  // Onion-skinning needs every other room's bg to render thumbnails at doors.
  const allRooms = useEditorStore((s) => s.allRooms);
  // Walk-to picker — when set, the next stage click on the
  // floor commits a moveTo for that object id (D in the plan). Cleared by
  // the click handler, by Esc, or by clicking the side-panel button again.
  const pendingMoveToPickFor = useEditorStore((s) => s.pendingMoveToPickFor);
  const clearPendingMoveToPickFor = useEditorStore(
    (s) => s.clearPendingMoveToPickFor
  );

  // Three-layer compositing: each background layer is loaded independently
  // and stacked back→middle→front. Procedural wall/floor fallback only shows
  // when ALL three layers are empty, matching BaseRoomScene's behavior so
  // the editor preview reflects what the player sees.
  const bgBackImage = useSpriteImage(currentRoomConfig?.bgBackUrl);
  const bgMiddleImage = useSpriteImage(currentRoomConfig?.bgMiddleUrl);
  const bgFrontImage = useSpriteImage(currentRoomConfig?.bgFrontUrl);
  const hasAnyBgArt = !!(
    currentRoomConfig?.bgBackUrl ||
    currentRoomConfig?.bgMiddleUrl ||
    currentRoomConfig?.bgFrontUrl
  );

  // Fit stage to container
  useEffect(() => {
    const resize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;
      // A collapsed / not-yet-laid-out container measures 0×0. A 0-size Stage
      // has a 0-size buffer canvas, and Konva then throws "drawImage … width
      // or height of 0" from Rect.drawScene — keep the last good size instead.
      if (width <= 0 || height <= 0) return;
      setStageSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 7b: kill HTML5 draggability on the Konva-managed <canvas> elements.
  // Wrapper-level onDragStart suppression catches most cases, but Chrome
  // sometimes initiates a canvas-image drag before the event bubbles, so we
  // also flip the attribute directly. Re-runs on stage size changes because
  // Konva can recreate canvases under some conditions.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const canvases = stage
      .container()
      .querySelectorAll("canvas");
    canvases.forEach((c) => {
      c.setAttribute("draggable", "false");
    });
  }, [stageSize.width, stageSize.height]);

  // Fit the current room inside the viewport, centered. Called whenever the
  // room or viewport size changes (also triggered manually by the Fit button).
  const fitRoomId = currentRoomConfig?.id;
  const fitRoomW = currentRoomConfig?.width;
  const fitRoomH = currentRoomConfig?.height;
  const fitToViewport = useCallback(() => {
    if (!fitRoomW || !fitRoomH || !stageSize.width) return;
    const roomW = fitRoomW;
    const roomH = fitRoomH;
    const scaleX = (stageSize.width - 40) / roomW;
    const scaleY = (stageSize.height - 40) / roomH;
    const scale = Math.min(scaleX, scaleY, 1);
    setStageScale(scale);
    setStagePos({
      x: (stageSize.width - roomW * scale) / 2,
      y: (stageSize.height - roomH * scale) / 2,
    });
  }, [fitRoomW, fitRoomH, stageSize.width, stageSize.height]);

  // Refit on room switch (fitRoomId) and on room/viewport size changes
  // (fitToViewport's identity).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the view transform follows the room/viewport by design
    fitToViewport();
  }, [fitRoomId, fitToViewport]);

  // Zoom by a factor around the viewport center.
  const zoomBy = useCallback(
    (factor: number) => {
      const clamped = Math.max(0.1, Math.min(5, stageScale * factor));
      const centerX = stageSize.width / 2;
      const centerY = stageSize.height / 2;
      const worldX = (centerX - stagePos.x) / stageScale;
      const worldY = (centerY - stagePos.y) / stageScale;
      setStageScale(clamped);
      setStagePos({
        x: centerX - worldX * clamped,
        y: centerY - worldY * clamped,
      });
    },
    [stageScale, stageSize.width, stageSize.height, stagePos.x, stagePos.y]
  );

  const zoomTo100 = useCallback(() => {
    if (!currentRoomConfig) return;
    const centerX = stageSize.width / 2;
    const centerY = stageSize.height / 2;
    setStageScale(1);
    setStagePos({
      x: centerX - currentRoomConfig.width / 2,
      y: centerY - currentRoomConfig.height / 2,
    });
  }, [currentRoomConfig, stageSize.width, stageSize.height]);

  // Attach transformer to selected object
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr || !stageRef.current) return;
    const ids =
      activeTool === "select"
        ? selectedObjectIds
        : activeTool === "edit-hitbox" && selectedObjectId
          ? [selectedObjectId]
          : [];
    const stage = stageRef.current;
    const nodes = ids
      .filter((id) => {
        const o = currentRoomConfig?.objects.find((x) => x.id === id);
        return o ? !isRoomObjectLocked(o) : true;
      })
      .map((id) => stage.findOne(`#obj-${id}`))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedObjectId, selectedObjectIds, activeTool, currentRoomConfig]);

  // ─── Handlers ───

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      // Only zoom when the wheel event actually originated inside the canvas
      // container. React replays synthetic events up the component tree, so a
      // wheel inside a side panel can otherwise reach this handler and zoom
      // the canvas while the panel is scrolling.
      const target = e.evt.target as Node | null;
      if (
        !containerRef.current ||
        !target ||
        !containerRef.current.contains(target)
      ) {
        return;
      }
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const ev = e.evt;
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      const dx = ev.deltaX * unit;
      const dy = ev.deltaY * unit;
      // Trackpad two-finger swipe sideways (or Shift+wheel) pans instead of
      // zooming.
      if (!ev.ctrlKey && (ev.shiftKey || Math.abs(dx) > Math.abs(dy))) {
        const panX = ev.shiftKey && Math.abs(dx) < Math.abs(dy) ? dy : dx;
        setStagePos({ x: stagePos.x - panX, y: stagePos.y });
        return;
      }
      // Zoom proportional to the wheel delta: a mouse notch (~100) is ~14%,
      // a trackpad's stream of tiny deltas is smooth instead of each event
      // being a full step. Pinch arrives as ctrlKey + small deltas.
      const factor = Math.min(
        2,
        Math.max(0.5, Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0015)))
      );
      const oldScale = stageScale;
      const clampedScale = Math.max(0.1, Math.min(5, oldScale * factor));

      const mousePointTo = {
        x: (pointer.x - stagePos.x) / oldScale,
        y: (pointer.y - stagePos.y) / oldScale,
      };

      setStageScale(clampedScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
    },
    [stageScale, stagePos]
  );

  const snapToGrid = useCallback(
    (val: number): number => {
      if (!gridEnabled) return val;
      return Math.round(val / gridSize) * gridSize;
    },
    [gridEnabled, gridSize]
  );

  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage || !currentRoomConfig) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      // Convert to room coordinates (un-grid-snapped first; the walk-to
      // pick wants pixel precision, the legacy add-EP path snaps after).
      const rawX = (pointer.x - stagePos.x) / stageScale;
      const rawY = (pointer.y - stagePos.y) / stageScale;

      // Walk-to picker. When armed, ANY canvas click
      // (including clicks that land on objects) commits the moveTo for
      // the pending object. Clears the pending state when done.
      if (pendingMoveToPickFor) {
        const snapped = clampPointToPolygon(
          { x: rawX, y: rawY },
          currentRoomConfig.walkableArea.polygon
        );
        updateObject(pendingMoveToPickFor, { moveTo: snapped });
        clearPendingMoveToPickFor();
        return;
      }

      // Only handle clicks on the stage background (not on objects)
      if (e.target !== stageRef.current) return;
      // A box-select just ended — its mouseup also produces this click.
      if (marqueeMovedRef.current) {
        marqueeMovedRef.current = false;
        return;
      }

      const roomX = snapToGrid(rawX);
      const roomY = snapToGrid(rawY);

      if (activeTool === "select") {
        selectObject(null);
        selectEntryPoint(null);
      } else if (activeTool === "entry-points") {
        const newEp = {
          id: `ep-${Date.now().toString(36)}`,
          x: Math.round(roomX),
          y: Math.round(roomY),
          direction: "right" as const,
        };
        addEntryPoint(newEp);
      }
    },
    [
      activeTool,
      currentRoomConfig,
      stagePos,
      stageScale,
      snapToGrid,
      selectObject,
      selectEntryPoint,
      addEntryPoint,
      pendingMoveToPickFor,
      updateObject,
      clearPendingMoveToPickFor,
    ]
  );

  // AddMenu (toolbar) → drop a placeholder at the current visible-canvas
  // center. Lives here because the toolbar doesn't know stage position/scale.
  // Mirrors the defaults the old click-to-place handler used so muscle memory
  // (size, label, interactionRadius) carries over.
  useEffect(() => {
    const onAddAtCenter = (e: Event) => {
      const detail = (e as CustomEvent<{ type: RoomObject["type"] }>).detail;
      const type = detail?.type ?? "object";
      if (!currentRoomConfig) return;

      // Visible-center in screen px, then converted to room coords using the
      // same inverse-transform the click handler uses.
      const screenCx = stageSize.width / 2;
      const screenCy = stageSize.height / 2;
      const roomCx = (screenCx - stagePos.x) / stageScale;
      const roomCy = (screenCy - stagePos.y) / stageScale;

      // Clamp to the room rectangle so the spawned object never lands
      // entirely off-canvas (zoomed-out cameras can leave the visible center
      // outside the room).
      const w = 120;
      const h = 100;
      const x = Math.round(
        Math.min(Math.max(roomCx - w / 2, 0), currentRoomConfig.width - w)
      );
      const y = Math.round(
        Math.min(Math.max(roomCy - h / 2, 0), currentRoomConfig.height - h)
      );

      const newObj: RoomObject = {
        id: `${type}-${Date.now().toString(36)}`,
        x: snapToGrid(x),
        y: snapToGrid(y),
        width: w,
        height: h,
        type,
        label: `New ${type}`,
        labelAr: type === "door" ? "باب" : "كائن",
        interactionRadius: 100,
        isWallMounted: false,
        interactionType: type === "door" ? undefined : "content",
        showLabel: type === "door",
      };
      addObject(newObj);
    };
    // Starter element from the Add menu → centred in the visible canvas.
    const onAddElement = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      const el = STARTER_ELEMENTS.find((x) => x.id === id);
      if (!el || !currentRoomConfig) return;
      const roomCx = (stageSize.width / 2 - stagePos.x) / stageScale;
      const roomCy = (stageSize.height / 2 - stagePos.y) / stageScale;
      const x = Math.min(Math.max(roomCx - el.w / 2, 0), currentRoomConfig.width - el.w);
      const y = Math.min(Math.max(roomCy - el.h / 2, 0), currentRoomConfig.height - el.h);
      addObject(objectFromElement(el, snapToGrid(x), snapToGrid(y)));
      announce(`Added ${el.name}`);
    };
    window.addEventListener("editor:add-at-center", onAddAtCenter);
    window.addEventListener("editor:add-element", onAddElement);
    return () => {
      window.removeEventListener("editor:add-at-center", onAddAtCenter);
      window.removeEventListener("editor:add-element", onAddElement);
    };
  }, [
    currentRoomConfig,
    stagePos.x,
    stagePos.y,
    stageScale,
    stageSize.width,
    stageSize.height,
    snapToGrid,
    addObject,
  ]);

  // Announce selection changes for screen-reader users.
  useEffect(() => {
    const st = useEditorStore.getState();
    // Multi-select paths (box-select, Ctrl+A) announce the count themselves.
    if (st.selectedObjectIds.length > 1) return;
    const obj = st.currentRoomConfig?.objects.find((o) => o.id === selectedObjectId);
    if (obj) {
      announce(
        `Selected ${obj.label || obj.id}, ${obj.type}, at ${Math.round(obj.x)}, ${Math.round(obj.y)}, ${Math.round(obj.width)} by ${Math.round(obj.height)}`
      );
    }
  }, [selectedObjectId]);

  // Keyboard navigation: + / - zoom, 0 fit, F frames the selected object.
  // Same focus guards as the editor-wide shortcuts in EditorWrapper.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      const st = useEditorStore.getState();
      if (st.editingContentObjectId) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1.2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(1 / 1.2);
      } else if (e.key === "0") {
        e.preventDefault();
        fitToViewport();
      } else if (e.key === "f" || e.key === "F") {
        const obj = st.currentRoomConfig?.objects.find((o) => o.id === st.selectedObjectId);
        if (!obj) return;
        e.preventDefault();
        const pad = 120;
        const scale = Math.max(
          0.1,
          Math.min(
            3,
            (stageSize.width - 40) / (obj.width + pad * 2),
            (stageSize.height - 40) / (obj.height + pad * 2)
          )
        );
        setStageScale(scale);
        setStagePos({
          x: stageSize.width / 2 - (obj.x + obj.width / 2) * scale,
          y: stageSize.height / 2 - (obj.y + obj.height / 2) * scale,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, fitToViewport, stageSize.width, stageSize.height]);

  // Esc cancels an in-flight walk-to pick.
  // MUST be declared before the `if (!currentRoomConfig) return …` early
  // exit below so hook order stays stable across the null↔non-null
  // transition. Effect body itself is no-op when no pick is pending.
  useEffect(() => {
    if (!pendingMoveToPickFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearPendingMoveToPickFor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingMoveToPickFor, clearPendingMoveToPickFor]);

  // Compute candidate snap positions from other objects' edges/centers and
  // walls. Returns the dragged object's adjusted (centered) top-left in room
  // coords along with the guide lines to render.
  const computeAlignSnap = useCallback(
    (
      draggedId: string,
      centerX: number,
      centerY: number,
      w: number,
      h: number
    ) => {
      if (!currentRoomConfig) return { centerX, centerY, xs: [], ys: [] };
      const threshold = 6 / stageScale; // screen-space ~6px
      const others = currentRoomConfig.objects.filter((o) => o.id !== draggedId);

      const targetXs: number[] = [0, currentRoomConfig.width];
      const targetYs: number[] = [0, currentRoomConfig.height];
      for (const o of others) {
        targetXs.push(o.x, o.x + o.width / 2, o.x + o.width);
        targetYs.push(o.y, o.y + o.height / 2, o.y + o.height);
      }

      const draggedXs = [centerX - w / 2, centerX, centerX + w / 2];
      const draggedYs = [centerY - h / 2, centerY, centerY + h / 2];

      let bestDX = 0;
      let bestDXAbs = threshold;
      const xs: number[] = [];
      for (let i = 0; i < draggedXs.length; i++) {
        for (const t of targetXs) {
          const d = t - draggedXs[i];
          const ad = Math.abs(d);
          if (ad < bestDXAbs) {
            bestDXAbs = ad;
            bestDX = d;
          }
          if (ad < threshold) xs.push(t);
        }
      }

      let bestDY = 0;
      let bestDYAbs = threshold;
      const ys: number[] = [];
      for (let i = 0; i < draggedYs.length; i++) {
        for (const t of targetYs) {
          const d = t - draggedYs[i];
          const ad = Math.abs(d);
          if (ad < bestDYAbs) {
            bestDYAbs = ad;
            bestDY = d;
          }
          if (ad < threshold) ys.push(t);
        }
      }

      return {
        centerX: centerX + bestDX,
        centerY: centerY + bestDY,
        xs: Array.from(new Set(xs)),
        ys: Array.from(new Set(ys)),
      };
    },
    [currentRoomConfig, stageScale]
  );

  // Screen position (inside the container) of a room-space point.
  const toScreen = useCallback(
    (p: Point) => ({
      x: p.x * stageScale + stagePos.x,
      y: p.y * stageScale + stagePos.y,
    }),
    [stageScale, stagePos.x, stagePos.y]
  );

  const handleDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      dragStartRef.current = { x: e.target.x(), y: e.target.y() };
    },
    []
  );

  // The selected objects that can move: a locked one is selected but never
  // dragged, transformed or nudged along with the rest.
  const movableSelectedIds = () => {
    const st = useEditorStore.getState();
    const objs = st.currentRoomConfig?.objects ?? [];
    return st.selectedObjectIds.filter((id) => {
      const o = objs.find((x) => x.id === id);
      return o ? !isRoomObjectLocked(o) : false;
    });
  };
  const isGroupDrag = (objId: string) => {
    const ids = movableSelectedIds();
    return ids.length > 1 && ids.includes(objId);
  };

  const handleDragMove = useCallback(
    (objId: string, obj: RoomObject, e: Konva.KonvaEventObject<DragEvent>) => {
      let centerX = e.target.x();
      let centerY = e.target.y();
      // Group drag: the Transformer moves the other selected nodes with this
      // one, so don't reposition it here (that would desync them). Just show
      // the offset.
      if (isGroupDrag(objId)) {
        const start = dragStartRef.current;
        if (start) {
          const scr = toScreen({ x: centerX, y: centerY - obj.height / 2 });
          setReadout({
            x: scr.x,
            y: scr.y,
            text: `${movableSelectedIds().length} objects · Δ ${Math.round(centerX - start.x)}, ${Math.round(centerY - start.y)}`,
          });
        }
        return;
      }
      // Shift = constrain to the dominant axis of the drag so far.
      const start = dragStartRef.current;
      if (start && e.evt.shiftKey) {
        if (Math.abs(centerX - start.x) >= Math.abs(centerY - start.y)) {
          centerY = start.y;
        } else {
          centerX = start.x;
        }
      }
      let guides: { xs: number[]; ys: number[] } = { xs: [], ys: [] };
      if (gridEnabled) {
        // Snap live (top-left to the grid) so release doesn't jump.
        centerX = snapToGrid(centerX - obj.width / 2) + obj.width / 2;
        centerY = snapToGrid(centerY - obj.height / 2) + obj.height / 2;
      } else {
        const snap = computeAlignSnap(objId, centerX, centerY, obj.width, obj.height);
        centerX = snap.centerX;
        centerY = snap.centerY;
        guides = { xs: snap.xs, ys: snap.ys };
      }
      if (centerX !== e.target.x() || centerY !== e.target.y()) {
        e.target.position({ x: centerX, y: centerY });
      }
      setAlignGuides(guides);
      const tl = { x: centerX - obj.width / 2, y: centerY - obj.height / 2 };
      const scr = toScreen({ x: centerX, y: tl.y });
      setReadout({
        x: scr.x,
        y: scr.y,
        text: `x ${Math.round(tl.x)} · y ${Math.round(tl.y)}`,
      });
    },
    [computeAlignSnap, gridEnabled, snapToGrid, toScreen]
  );

  const handleDragEnd = useCallback(
    (objId: string, obj: RoomObject, e: Konva.KonvaEventObject<DragEvent>) => {
      if (isGroupDrag(objId)) {
        const start = dragStartRef.current;
        const ids = movableSelectedIds();
        let dx = start ? e.target.x() - start.x : 0;
        let dy = start ? e.target.y() - start.y : 0;
        if (gridEnabled) {
          dx = Math.round(dx / gridSize) * gridSize;
          dy = Math.round(dy / gridSize) * gridSize;
        }
        moveObjects(ids, dx, dy);
        // Pin every node to its committed spot (covers a delta that rounded
        // to 0, where React wouldn't re-render the positions).
        const cfg = useEditorStore.getState().currentRoomConfig;
        const stage = stageRef.current;
        for (const id of ids) {
          const o = cfg?.objects.find((x) => x.id === id);
          const node = stage?.findOne(`#obj-${id}`);
          if (o && node) node.position({ x: o.x + o.width / 2, y: o.y + o.height / 2 });
        }
        setReadout(null);
        dragStartRef.current = null;
        announce(`Moved ${ids.length} objects by ${Math.round(dx)}, ${Math.round(dy)}`);
        return;
      }
      // Shape is rendered centered (x = obj.x + width/2), so subtract the
      // half-extents before snapping to get the top-left position.
      const x = snapToGrid(e.target.x() - obj.width / 2);
      const y = snapToGrid(e.target.y() - obj.height / 2);
      moveObject(objId, x, y);
      setAlignGuides({ xs: [], ys: [] });
      setReadout(null);
      dragStartRef.current = null;
      announce(`Moved ${obj.label || obj.id} to ${Math.round(x)}, ${Math.round(y)}`);
    },
    [moveObject, moveObjects, snapToGrid, gridEnabled, gridSize]
  );

  // Live readout while the transformer is being dragged.
  const handleTransform = useCallback(
    (obj: RoomObject, e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const w = Math.max(10, obj.width * Math.abs(node.scaleX()));
      const h = Math.max(10, obj.height * Math.abs(node.scaleY()));
      const rot = Math.round(((node.rotation() % 360) + 360) % 360);
      const scr = toScreen({ x: node.x(), y: node.y() - h / 2 });
      const rotating = Math.round(rot) !== Math.round(((obj.rotation ?? 0) % 360 + 360) % 360);
      setReadout({
        x: scr.x,
        y: scr.y,
        text: rotating ? `${rot}°` : `${Math.round(w)} × ${Math.round(h)}`,
      });
    },
    [toScreen]
  );

  const handleTransformEnd = useCallback(
    (obj: RoomObject, e: Konva.KonvaEventObject<Event>) => {
      const node = e.target as Konva.Rect;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const rotation = node.rotation();
      // Reset scale; the size goes into width/height instead.
      node.scaleX(1);
      node.scaleY(1);
      const newW = snapToGrid(Math.max(10, obj.width * Math.abs(scaleX)));
      const newH = snapToGrid(Math.max(10, obj.height * Math.abs(scaleY)));
      if (movableSelectedIds().length > 1) {
        // Group transform: collect every node's result, commit once.
        pendingTransformsRef.current.push({
          id: obj.id,
          x: node.x() - newW / 2,
          y: node.y() - newH / 2,
          width: newW,
          height: newH,
          rotation,
        });
        if (pendingTransformsRef.current.length === 1) {
          setTimeout(() => {
            const list = pendingTransformsRef.current;
            pendingTransformsRef.current = [];
            transformObjects(list);
            setReadout(null);
            announce(`Transformed ${list.length} objects`);
          }, 0);
        }
        return;
      }
      // One store write → one undo step and no in-between frame where the
      // new position renders with the old size.
      transformObject(obj.id, {
        // Node is centered (see EditorObjectShape), so subtract half-extents.
        x: snapToGrid(node.x() - newW / 2),
        y: snapToGrid(node.y() - newH / 2),
        width: newW,
        height: newH,
        rotation,
      });
      setReadout(null);
      announce(
        `${obj.label || obj.id}: ${Math.round(newW)} by ${Math.round(newH)}, ${Math.round(rotation)} degrees`
      );
    },
    [transformObject, transformObjects, snapToGrid]
  );

  const disarmVertex = useCallback(() => {
    const p = vertexPressRef.current;
    if (p.timer) clearTimeout(p.timer);
    if (p.armed && p.fill) {
      p.armed.fill(p.fill);
      p.armed.getLayer()?.batchDraw();
    }
    vertexPressRef.current = { timer: null, armed: null, fill: null };
  }, []);

  // Two-finger pinch: zoom + pan anchored at the midpoint. Native listeners,
  // not Konva's onTouchMove: Konva stops firing its own touch events while a
  // drag is running, and a one-finger canvas pan / object move is exactly
  // what is running when the second finger lands. Also cancels iOS Safari's
  // own page zoom (its gesture events ignore touch-action).
  const hasRoom = !!currentRoomConfig;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !coarse) return;
    const onMove = (ev: TouchEvent) => {
      const t = ev.touches;
      if (t.length !== 2) return;
      ev.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      disarmVertex();
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
      // The second finger turns a one-finger drag into the pinch: stop a
      // canvas pan, and put an object being moved back where it started so
      // zooming never nudges it.
      if (stage.isDragging()) stage.stopDrag();
      const dragged = dragNodeRef.current;
      if (dragged?.isDragging()) {
        if (dragStartRef.current) dragged.position(dragStartRef.current);
        dragged.stopDrag();
      }
      dragNodeRef.current = null;
      const rect = stage.container().getBoundingClientRect();
      const a = { x: t[0].clientX - rect.left, y: t[0].clientY - rect.top };
      const b = { x: t[1].clientX - rect.left, y: t[1].clientY - rect.top };
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const prev = pinchRef.current;
      if (!prev) {
        // Read the live node, not React state: a pan that just stopped
        // hasn't reached stagePos yet.
        pinchRef.current = { dist, center, scale: stage.scaleX(), pos: stage.position() };
        return;
      }
      const scale = Math.max(0.1, Math.min(5, prev.scale * (dist / prev.dist)));
      const wx = (prev.center.x - prev.pos.x) / prev.scale;
      const wy = (prev.center.y - prev.pos.y) / prev.scale;
      const pos = { x: center.x - wx * scale, y: center.y - wy * scale };
      pinchRef.current = { dist, center, scale, pos };
      stage.scale({ x: scale, y: scale });
      stage.position(pos);
      setStageScale(scale);
      setStagePos(pos);
    };
    const onEnd = (ev: TouchEvent) => {
      if (ev.touches.length < 2 && pinchRef.current) {
        lastPinchAtRef.current = Date.now();
        pinchRef.current = null;
      }
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
  }, [coarse, hasRoom, disarmVertex]);

  if (!currentRoomConfig) {
    return (
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center text-neutral-500"
      >
        Select a room to edit
      </div>
    );
  }

  const { walkableArea, entryPoints, objects } = currentRoomConfig;
  const W = currentRoomConfig.width;
  const H = currentRoomConfig.height;

  // Handles are sized in SCREEN pixels so they stay grabbable at any zoom —
  // and finger-sized on touch screens.
  const hr = (px: number) => (px * (coarse ? 1.7 : 1)) / stageScale;

  const vertexLongPress = (onDelete: () => void) => ({
    onTouchStart: (e: Konva.KonvaEventObject<TouchEvent>) => {
      disarmVertex();
      if (e.evt.touches.length !== 1) return;
      const node = e.target as Konva.Circle;
      vertexPressRef.current.timer = setTimeout(() => {
        vertexPressRef.current = { timer: null, armed: node, fill: String(node.fill()) };
        node.fill("#ef4444");
        node.getLayer()?.batchDraw();
        navigator.vibrate?.(10);
      }, 600);
    },
    onDragStart: disarmVertex,
    onTouchEnd: () => {
      const armed = vertexPressRef.current.armed;
      disarmVertex();
      if (armed) onDelete();
    },
  });

  // Live polygon while a vertex is being dragged (committed on release).
  const walkPoly =
    vertexDrag?.kind === "walk"
      ? walkableArea.polygon.map((p, i) => (i === vertexDrag.index ? vertexDrag.point : p))
      : walkableArea.polygon;

  // Grid-snap a dragged handle live so release doesn't jump.
  const snapHandle = (e: Konva.KonvaEventObject<DragEvent>): Point => {
    const p = { x: snapToGrid(e.target.x()), y: snapToGrid(e.target.y()) };
    if (p.x !== e.target.x() || p.y !== e.target.y()) e.target.position(p);
    return p;
  };

  // ─── Walkable area midpoints (for adding vertices) ───
  const walkMidpoints: { x: number; y: number; insertIndex: number }[] = [];
  if (activeTool === "walkable-area" && !vertexDrag) {
    const poly = walkableArea.polygon;
    for (let i = 0; i < poly.length; i++) {
      const next = poly[(i + 1) % poly.length];
      walkMidpoints.push({
        x: (poly[i].x + next.x) / 2,
        y: (poly[i].y + next.y) / 2,
        insertIndex: i + 1,
      });
    }
  }

  // ─── Edit-hitbox: compute world-space vertices and midpoints ───
  const hitboxEditObj =
    activeTool === "edit-hitbox" && selectedObjectId
      ? objects.find((o) => o.id === selectedObjectId)
      : null;
  const hitboxWorldVerts: Point[] = hitboxEditObj?.hitboxPolygon
    ? hitboxEditObj.hitboxPolygon.map((p, i) =>
        vertexDrag?.kind === "hitbox" && vertexDrag.index === i
          ? vertexDrag.point
          : localToWorld(hitboxEditObj, p)
      )
    : [];
  const hitboxMidpoints: { x: number; y: number; insertIndex: number }[] = [];
  if (hitboxEditObj?.hitboxPolygon && hitboxWorldVerts.length >= 2 && !vertexDrag) {
    for (let i = 0; i < hitboxWorldVerts.length; i++) {
      const next = hitboxWorldVerts[(i + 1) % hitboxWorldVerts.length];
      hitboxMidpoints.push({
        x: (hitboxWorldVerts[i].x + next.x) / 2,
        y: (hitboxWorldVerts[i].y + next.y) / 2,
        insertIndex: i + 1,
      });
    }
  }

  const addHitboxVertexAt = (mp: { x: number; y: number; insertIndex: number }) => {
    if (!hitboxEditObj) return;
    const local = worldToLocal(hitboxEditObj, { x: mp.x, y: mp.y });
    addObjectVertex(hitboxEditObj.id, mp.insertIndex, {
      x: Math.round(local.x),
      y: Math.round(local.y),
    });
  };

  const isPanning = activeTool === "pan" || spacePanHeld || middleMouseDown;
  const containerCursor = isPanning
    ? middleMouseDown
      ? "grabbing"
      : "grab"
    : pendingMoveToPickFor
      ? "crosshair"
      : "default";

  // Drop handler: dispatches by MIME type. Templates spawn a fully-formed
  // RoomObject from a saved preset; raw sprites become a generic object
  // sized to the image's natural dimensions.
  const handleAssetDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (!stageRef.current || !currentRoomConfig) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const roomX = (pointerX - stagePos.x) / stageScale;
    const roomY = (pointerY - stagePos.y) / stageScale;

    // Starter element dragged from the Add menu → centred on the drop point.
    const elRaw = e.dataTransfer.getData("application/x-editor-element");
    if (elRaw) {
      try {
        const { id } = JSON.parse(elRaw) as { id: string };
        const el = STARTER_ELEMENTS.find((x) => x.id === id);
        if (el) {
          addObject(
            objectFromElement(el, snapToGrid(roomX - el.w / 2), snapToGrid(roomY - el.h / 2))
          );
          announce(`Added ${el.name}`);
        }
      } catch {
        /* malformed payload */
      }
      return;
    }

    // Templates take precedence — they're a strict superset of "raw sprite",
    // and a card might carry both payloads in the future.
    const tplRaw = e.dataTransfer.getData("application/x-editor-template");
    if (tplRaw) {
      try {
        const tpl = JSON.parse(tplRaw) as TemplateDropPayload;
        spawnFromTemplate(tpl, roomX, roomY);
      } catch {
        /* malformed payload — silently ignore */
      }
      return;
    }

    const raw = e.dataTransfer.getData("application/x-editor-sprite");
    if (!raw) return;
    let payload: { url: string; name: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    // Load the image to read its natural size so the object matches the sprite.
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // 7d: rescale outsized images so the spawn is grabbable from the start.
      const { w, h, scaled } = fitDroppedSpriteSize(
        img.naturalWidth,
        img.naturalHeight,
        currentRoomConfig.width,
        currentRoomConfig.height
      );
      addObject({
        id: `object-${Date.now().toString(36)}`,
        x: Math.round(snapToGrid(roomX - w / 2)),
        y: Math.round(snapToGrid(roomY - h / 2)),
        width: w,
        height: h,
        type: "object",
        label: payload.name.replace(/\.[^.]+$/, ""),
        labelAr: "كائن",
        interactionRadius: Math.round(Math.max(w, h) * 0.8),
        isWallMounted: false,
        spriteUrl: payload.url,
        interactionType: "content",
        showLabel: false,
      });
      if (scaled) {
        toast.info("Sprite scaled to fit", {
          description: `Original was ${img.naturalWidth}×${img.naturalHeight}px. Use the size fields in the side panel — or "Fit to room" — if you want it bigger.`,
          duration: 6000,
        });
      }
    };
    img.src = payload.url;
  };

  // Spawn a RoomObject pre-filled from a template row. Uses the template's
  // category to derive the door/object type; everything else flows straight
  // through. Required-fields prompting is handled by the side panel after
  // the user selects the new object.
  const spawnFromTemplate = (
    tpl: TemplateDropPayload,
    roomX: number,
    roomY: number
  ) => {
    const w = Math.max(16, tpl.defaultWidth);
    const h = Math.max(16, tpl.defaultHeight);
    const id = `${tpl.category}-${Date.now().toString(36)}`;
    const y = Math.round(snapToGrid(roomY - h / 2));
    // Steps that pointed at the template's original object point at this one.
    const iid = newIid();
    const spawned: RoomObject = {
      id,
      iid,
      x: Math.round(snapToGrid(roomX - w / 2)),
      y,
      width: w,
      height: h,
      type: tpl.category === "door" ? "door" : "object",
      label: tpl.defaultLabel,
      labelAr: tpl.defaultLabelAr ?? "",
      spriteUrl: tpl.spriteUrl,
      interactionType: tpl.interactionType,
      externalUrl: tpl.externalUrl ?? undefined,
      isWallMounted: tpl.isWallMounted,
      interactionRadius:
        tpl.interactionRadius ?? Math.round(Math.max(w, h) * 0.8),
      hitboxPolygon: tpl.hitboxPolygon ?? undefined,
      zIndex: tpl.zIndexOffset != null ? y + tpl.zIndexOffset : undefined,
      category: tpl.category,
      showLabel: tpl.category === "door",
      // Steps, walks-near, hover, kind (templates saved since migration 20261008000002_popup_presets).
      ...objectFieldsFromBehaviour(tpl.behaviour, iid),
    };
    // Dual-write the legacy click fields from the steps (rollback safety).
    addObject(withLegacyInteraction(spawned));

    // Tell the side panel to nag the user about any fields the template
    // declared as required (e.g. doors → targetRoomId).
    if (tpl.requiredFields?.length) {
      useEditorStore
        .getState()
        .setPendingRequiredFields(id, tpl.requiredFields);
    }
  };

  // End a box-select: select everything the rectangle touched.
  const finishMarquee = () => {
    lockedPressRef.current = null;
    if (!marquee) return;
    const m = marquee;
    setMarquee(null);
    if (!marqueeMovedRef.current) return;
    const minX = Math.min(m.x0, m.x1);
    const maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1);
    const maxY = Math.max(m.y0, m.y1);
    // Anything the box touches, skipping hidden/locked objects.
    const hit = objects
      .filter(
        (o) =>
          !hiddenObjectIds.has(o.id) &&
          !isRoomObjectLocked(o) &&
          o.x < maxX &&
          o.x + o.width > minX &&
          o.y < maxY &&
          o.y + o.height > minY
      )
      .map((o) => o.id);
    const ids = m.additive
      ? Array.from(new Set([...useEditorStore.getState().selectedObjectIds, ...hit]))
      : hit;
    setSelection(ids);
    if (ids.length) announce(`Selected ${ids.length} object${ids.length === 1 ? "" : "s"}`);
    // Konva fires its synthetic click synchronously inside pointerup, so the
    // guard has done its job by the next tick — clear it so a box-select
    // that ended by leaving the canvas can't swallow a later real click.
    setTimeout(() => {
      marqueeMovedRef.current = false;
    }, 0);
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
      // touch-action none: the browser must not scroll/zoom the page while
      // fingers are on the canvas — we handle pan & pinch ourselves.
      style={{ cursor: containerCursor, touchAction: "none" }}
      // Keyboard + screen-reader entry point for the canvas. Tab through
      // objects, arrows to nudge; actions are announced via the live region.
      tabIndex={0}
      onKeyDown={(e) => {
        // Tab / Shift+Tab cycle through objects in reading order (top→bottom,
        // left→right). Past either end, focus leaves the canvas normally so
        // keyboard users are never trapped.
        if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
        const order = objects
          .filter((o) => !hiddenObjectIds.has(o.id) && !isRoomObjectLocked(o))
          .sort((a, b) => a.y - b.y || a.x - b.x);
        if (!order.length) return;
        const idx = order.findIndex((o) => o.id === selectedObjectId);
        const next = e.shiftKey ? (idx === -1 ? order.length - 1 : idx - 1) : idx + 1;
        if (next < 0 || next >= order.length) {
          selectObject(null);
          return;
        }
        e.preventDefault();
        selectObject(order[next].id);
      }}
      role="application"
      aria-roledescription="room canvas"
      aria-label={`Room canvas: ${currentRoomConfig.name || currentRoomConfig.id}. ${objects.length} objects. Tab to cycle objects, arrow keys to move, Delete to remove, Enter to edit content, plus and minus to zoom.`}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          setMiddleMouseDown(true);
        }
      }}
      onMouseUp={(e) => {
        if (e.button === 1) setMiddleMouseDown(false);
      }}
      onMouseLeave={() => setMiddleMouseDown(false)}
      onDragOver={(e) => {
        // Both raw sprites and templates are valid drop payloads. Without
        // preventDefault for *either* MIME, the browser refuses the drop and
        // the drop event never fires — that was Bug 7a (templates didn't
        // deploy on drop).
        const types = e.dataTransfer.types;
        if (
          types.includes("application/x-editor-sprite") ||
          types.includes("application/x-editor-template") ||
          types.includes("application/x-editor-element")
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isDropTarget) setIsDropTarget(true);
        }
      }}
      onDragLeave={(e) => {
        // dragleave also fires when crossing into child elements — only
        // clear when the pointer actually leaves the container.
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) setIsDropTarget(false);
      }}
      // 7b: Chrome treats <canvas> as an implicitly-draggable image. When the
      // user mousedowns on a Konva sprite to move it, Chrome can race Konva's
      // drag and start an HTML5 drag of the canvas instead — the page rejects
      // the unknown drag payload and shows the "no-drop" cursor until release.
      // Suppressing dragstart at the wrapper kills that path; the inner
      // <canvas> element also gets `draggable=false` set in a useEffect below.
      onDragStart={(e) => e.preventDefault()}
      onDrop={(e) => {
        setIsDropTarget(false);
        handleAssetDrop(e);
      }}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={stageScale}
        scaleY={stageScale}
        // Touch: one finger on empty canvas pans (objects still drag
        // themselves); mouse keeps box-select on empty canvas.
        draggable={isPanning || coarse}
        onTap={
          isPanning
            ? undefined
            : (e) => {
                if (Date.now() - lastPinchAtRef.current < 350) return;
                handleStageClick(e as unknown as Konva.KonvaEventObject<MouseEvent>);
              }
        }
        onDragStart={(e) => {
          if (e.target !== stageRef.current) dragNodeRef.current = e.target;
        }}
        // Two-finger pinch: native listeners (see the pinch effect above).
        onMouseDown={(e) => {
          if (isPanning || activeTool !== "select" || e.evt.button !== 0) return;
          if (e.target !== stageRef.current) return;
          const p = stageRef.current?.getPointerPosition();
          if (!p) return;
          const x = (p.x - stagePos.x) / stageScale;
          const y = (p.y - stagePos.y) / stageScale;
          // A press on a SELECTED locked object (picked from the outline): if
          // it turns into a drag, say it can't move (once per session).
          lockedPressRef.current = null;
          const st = useEditorStore.getState();
          const lockedHit = (st.currentRoomConfig?.objects ?? []).find(
            (o) =>
              st.selectedObjectIds.includes(o.id) &&
              isRoomObjectLocked(o) &&
              x >= o.x &&
              x <= o.x + o.width &&
              y >= o.y &&
              y <= o.y + o.height
          );
          if (lockedHit) lockedPressRef.current = { id: lockedHit.id, x, y };
          marqueeMovedRef.current = false;
          setMarquee({
            x0: x,
            y0: y,
            x1: x,
            y1: y,
            additive: e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey,
            moved: false,
          });
        }}
        onMouseMove={() => {
          if (!marquee) return;
          const p = stageRef.current?.getPointerPosition();
          if (!p) return;
          const x = (p.x - stagePos.x) / stageScale;
          const y = (p.y - stagePos.y) / stageScale;
          const lp = lockedPressRef.current;
          if (lp && Math.hypot(x - lp.x, y - lp.y) * stageScale > 8) {
            lockedPressRef.current = null;
            showLockedHint(() => {
              useEditorStore.getState().toggleObjectsLock([lp.id]);
              announce("Unlocked");
            });
          }
          const moved =
            marquee.moved ||
            Math.abs(x - marquee.x0) * stageScale > 4 ||
            Math.abs(y - marquee.y0) * stageScale > 4;
          if (moved) marqueeMovedRef.current = true;
          setMarquee({ ...marquee, x1: x, y1: y, moved });
        }}
        onMouseLeave={finishMarquee}
        onMouseUp={finishMarquee}
        onWheel={handleWheel}
        onClick={isPanning ? undefined : handleStageClick}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          } else if (dragNodeRef.current === e.target) {
            dragNodeRef.current = null;
          }
        }}
      >
        {/* Room background layer — not hit-testable, so a press on empty
            room space targets the Stage (box-select, deselect, add entry
            point all check `e.target === stage`). */}
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill={currentRoomConfig.backgroundColor}
            stroke="#444"
            strokeWidth={2}
          />
          {bgBackImage && (
            <KonvaImage x={0} y={0} width={W} height={H} image={bgBackImage} />
          )}
          {bgMiddleImage && (
            <KonvaImage x={0} y={0} width={W} height={H} image={bgMiddleImage} />
          )}
          {bgFrontImage && (
            <KonvaImage x={0} y={0} width={W} height={H} image={bgFrontImage} />
          )}
          {!hasAnyBgArt && (
            <Rect
              x={0}
              y={0}
              width={W}
              height={H}
              fill={currentRoomConfig.backgroundColor}
            />
          )}
        </Layer>

        {/* Grid overlay */}
        {gridEnabled && (
          <Layer listening={false} opacity={0.15}>
            {Array.from({ length: Math.ceil(W / gridSize) + 1 }, (_, i) => (
              <Line
                key={`gv-${i}`}
                points={[i * gridSize, 0, i * gridSize, H]}
                stroke="#888"
                strokeWidth={0.5}
              />
            ))}
            {Array.from({ length: Math.ceil(H / gridSize) + 1 }, (_, i) => (
              <Line
                key={`gh-${i}`}
                points={[0, i * gridSize, W, i * gridSize]}
                stroke="#888"
                strokeWidth={0.5}
              />
            ))}
          </Layer>
        )}

        {/* Walkable area overlay */}
        <Layer>
          {activeTool === "walkable-area" && (
            <>
              {/* Polygon fill */}
              <Line
                points={walkPoly.flatMap((p) => [p.x, p.y])}
                closed
                fill="rgba(0,255,0,0.15)"
                stroke="#0f0"
                strokeWidth={hr(2)}
                listening={false}
              />
              {/* Vertex handles */}
              {walkableArea.polygon.map((p, i) => (
                <Circle
                  key={`wv-${i}`}
                  x={p.x}
                  y={p.y}
                  radius={hr(7)}
                  hitStrokeWidth={hr(10)}
                  fill="#0f0"
                  stroke="#fff"
                  strokeWidth={hr(2)}
                  draggable
                  onMouseEnter={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "grab";
                  }}
                  onMouseLeave={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "";
                  }}
                  onDragMove={(e) =>
                    setVertexDrag({ kind: "walk", index: i, point: snapHandle(e) })
                  }
                  onDragEnd={(e) => {
                    updateWalkableVertex(i, snapHandle(e));
                    setVertexDrag(null);
                  }}
                  onContextMenu={(e) => {
                    e.evt.preventDefault();
                    deleteWalkableVertex(i);
                  }}
                  {...vertexLongPress(() => deleteWalkableVertex(i))}
                />
              ))}
              {/* Midpoint add handles */}
              {walkMidpoints.map((mp, i) => (
                <Circle
                  key={`wm-${i}`}
                  x={mp.x}
                  y={mp.y}
                  radius={hr(5)}
                  hitStrokeWidth={hr(8)}
                  fill="rgba(0,255,0,0.4)"
                  stroke="#0f0"
                  strokeWidth={hr(1)}
                  onClick={() =>
                    addWalkableVertex(mp.insertIndex, {
                      x: Math.round(mp.x),
                      y: Math.round(mp.y),
                    })
                  }
                  // Konva reports a finger tap as "tap", never "click".
                  onTap={() =>
                    addWalkableVertex(mp.insertIndex, {
                      x: Math.round(mp.x),
                      y: Math.round(mp.y),
                    })
                  }
                  onMouseEnter={(e) => {
                    (e.target as Konva.Circle).radius(hr(7));
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "copy";
                  }}
                  onMouseLeave={(e) => {
                    (e.target as Konva.Circle).radius(hr(5));
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = "";
                  }}
                />
              ))}
            </>
          )}

          {/* Walkable area outline (always visible when not editing) */}
          {activeTool !== "walkable-area" && (
            <Line
              points={walkableArea.polygon.flatMap((p) => [p.x, p.y])}
              closed
              stroke="rgba(0,255,0,0.3)"
              strokeWidth={1}
              dash={[6, 4]}
              listening={false}
            />
          )}
        </Layer>

        {/* Onion-skin layer —
            miniature renderings of each door's target room. Mirrors the
            walls/floor math from the main bg layer so a procedural room
            looks like itself, not a flat colour card. Below the objects
            layer so the door itself stays clickable. */}
        {showOnionSkin && currentRoomConfig && (
          <Layer listening={false}>
            {currentRoomConfig.objects
              .filter((o) => o.type === "door")
              .map((door) => {
                const target = resolveDoorTarget(door, allRooms);
                if (!target) return null;
                return (
                  <DoorThumbnail
                    key={`onion-${door.id}`}
                    door={door}
                    targetConfig={target}
                  />
                );
              })}
          </Layer>
        )}

        {/* Objects layer */}
        <Layer>
          {objects.map((obj) => {
            const isSelected = selectedObjectIds.includes(obj.id);
            const isHidden = hiddenObjectIds.has(obj.id);
            const isLocked = isRoomObjectLocked(obj);
            // Hidden = ghosted + non-interactive. Locked = visible but
            // non-interactive (selection passes through). Both still appear
            // in the outline so the user can flip them back.
            const interactive = !isHidden && !isLocked;
            return (
              <Group
                key={obj.id}
                opacity={isHidden ? 0.15 : 1}
                listening={interactive}
                // Touch: long-press opens the same menu as right-click.
                onTouchStart={(e) => {
                  if (e.evt.touches.length !== 1) return;
                  const touch = e.evt.touches[0];
                  const stage = e.target.getStage();
                  if (!stage) return;
                  const rect = stage.container().getBoundingClientRect();
                  const px = touch.clientX - rect.left;
                  const py = touch.clientY - rect.top;
                  if (longPressRef.current) clearTimeout(longPressRef.current);
                  longPressRef.current = setTimeout(() => {
                    longPressRef.current = null;
                    selectObject(obj.id);
                    setContextMenu({
                      screenX: touch.clientX,
                      screenY: touch.clientY,
                      worldPos: {
                        x: (px - stagePos.x) / stageScale,
                        y: (py - stagePos.y) / stageScale,
                      },
                      objectId: obj.id,
                    });
                  }, 550);
                }}
                onTouchMove={() => {
                  if (longPressRef.current) {
                    clearTimeout(longPressRef.current);
                    longPressRef.current = null;
                  }
                }}
                onTouchEnd={() => {
                  if (longPressRef.current) {
                    clearTimeout(longPressRef.current);
                    longPressRef.current = null;
                  }
                }}
                onContextMenu={(e) => {
                  // Right-click an object to set its
                  // walk-to point at the click position. Suppress the
                  // browser menu, capture both screen-px (for menu
                  // anchor) and world-coords (for the moveTo value).
                  e.evt.preventDefault();
                  const stage = e.target.getStage();
                  if (!stage) return;
                  const pointer = stage.getPointerPosition();
                  if (!pointer) return;
                  const rect = stage.container().getBoundingClientRect();
                  setContextMenu({
                    screenX: pointer.x + rect.left,
                    screenY: pointer.y + rect.top,
                    worldPos: {
                      x: (pointer.x - stagePos.x) / stageScale,
                      y: (pointer.y - stagePos.y) / stageScale,
                    },
                    objectId: obj.id,
                  });
                }}
              >
                <EditorObjectShape
                  obj={obj}
                  isSelected={isSelected}
                  activeTool={activeTool}
                  panning={isPanning}
                  onSelect={(additive) =>
                    additive ? toggleObjectSelection(obj.id) : selectObject(obj.id)
                  }
                  onDragStart={handleDragStart}
                  onDragMove={(e) => handleDragMove(obj.id, obj, e)}
                  onDragEnd={(e) => handleDragEnd(obj.id, obj, e)}
                  onTransform={(e) => handleTransform(obj, e)}
                  onTransformEnd={(e) => handleTransformEnd(obj, e)}
                />
                {/* Label */}
                <Text
                  x={obj.x}
                  y={obj.y - 16}
                  width={obj.width}
                  text={obj.label}
                  fontSize={11}
                  fill="#fff"
                  align="center"
                  listening={false}
                />
                {/* Type indicator */}
                <Text
                  x={obj.x + 4}
                  y={obj.y + 4}
                  text={obj.type.toUpperCase()}
                  fontSize={9}
                  fill="rgba(255,255,255,0.6)"
                  listening={false}
                />
                {/* "Walks near" radius (primary selection only), around the
                    walk-to point the game measures from; brighter when the
                    object has a "walks near" trigger. */}
                {selectedObjectId === obj.id && (
                  <Circle
                    x={walkTargetOf(obj, currentRoomConfig).x}
                    y={walkTargetOf(obj, currentRoomConfig).y}
                    radius={obj.interactionRadius}
                    stroke={nearTriggerOf(obj) ? "rgba(255,165,0,0.9)" : "rgba(255,165,0,0.4)"}
                    strokeWidth={nearTriggerOf(obj) ? 2 : 1}
                    dash={[4, 4]}
                    listening={false}
                  />
                )}
                {/* Walk-to marker.
                    Always renders when selected. SOLID dot+line when
                    obj.moveTo is set; GHOST dot+line at the runtime's
                    fallback position when unset. Both are draggable, and
                    drag is snapped to the walkable polygon so the user
                    can never set an unreachable point. */}
                {selectedObjectId === obj.id && selectedObjectIds.length === 1 && (
                  <WalkToMarker
                    obj={obj}
                    walkablePolygon={walkableArea.polygon}
                    onCommit={(pt) => updateObject(obj.id, { moveTo: pt })}
                  />
                )}
              </Group>
            );
          })}
          {/* Locked + selected (picked from the outline): a thin outline and a
              padlock instead of Transformer handles. Not listening, so it
              can't catch a press either. */}
          {objects.map((obj) =>
            selectedObjectIds.includes(obj.id) && isRoomObjectLocked(obj) ? (
              <Group key={`lock-${obj.id}`} listening={false}>
                <Rect
                  x={obj.x + obj.width / 2}
                  y={obj.y + obj.height / 2}
                  width={obj.width}
                  height={obj.height}
                  offsetX={obj.width / 2}
                  offsetY={obj.height / 2}
                  rotation={obj.rotation ?? 0}
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  strokeScaleEnabled={false}
                  listening={false}
                />
                <Text
                  x={obj.x + 4}
                  y={obj.y + 4}
                  text="🔒"
                  fontSize={hr(14)}
                  listening={false}
                />
              </Group>
            ) : null
          )}
          {/* Custom hitbox outlines: only the selected object's outline shows
              in select mode; in edit-hitbox mode all neighbours show too so the
              user can compare shapes while authoring. The selected object in
              edit-hitbox mode is drawn by the vivid overlay layer below. */}
          {objects.map((obj) => {
            if (!obj.hitboxPolygon) return null;
            if (activeTool === "edit-hitbox" && selectedObjectId === obj.id) {
              return null; // drawn by the edit overlay below
            }
            const showThis =
              selectedObjectId === obj.id || activeTool === "edit-hitbox";
            if (!showThis) return null;
            const pts = obj.hitboxPolygon.flatMap((p) => {
              const w = localToWorld(obj, p);
              return [w.x, w.y];
            });
            return (
              <Line
                key={`hb-${obj.id}`}
                points={pts}
                closed
                stroke="rgba(0,200,255,0.35)"
                strokeWidth={1}
                dash={[6, 4]}
                listening={false}
              />
            );
          })}
          {/* Transformer */}
          <Transformer
            ref={transformerRef}
            rotateEnabled={activeTool === "select" || activeTool === "edit-hitbox"}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={5}
            // Corners keep aspect ratio (hold Shift for free resize); Alt
            // scales from the centre — both built into Konva's Transformer.
            keepRatio
            // Dragging an edge past its opposite used to mirror the sprite.
            flipEnabled={false}
            boundBoxFunc={(oldBox, newBox) =>
              Math.abs(newBox.width) < 10 * stageScale ||
              Math.abs(newBox.height) < 10 * stageScale
                ? oldBox
                : newBox
            }
            anchorSize={coarse ? 20 : 11}
            // A fingertip target of 44 px around each handle (Konva's own default
            // hit area is the drawn size).
            anchorStyleFunc={coarse ? (anchor) => void anchor.hitStrokeWidth(24) : undefined}
            anchorCornerRadius={3}
            anchorStroke="#3b82f6"
            anchorStrokeWidth={1.5}
            anchorFill="#fff"
            borderStroke="#3b82f6"
            borderStrokeWidth={1.5}
            rotateAnchorOffset={coarse ? 40 : 28}
            padding={2}
          />
        </Layer>

        {/* Hitbox editing overlay */}
        {hitboxEditObj && hitboxEditObj.hitboxPolygon && (
          <Layer>
            <Line
              points={hitboxWorldVerts.flatMap((p) => [p.x, p.y])}
              closed
              fill="rgba(0,200,255,0.15)"
              stroke="#0cf"
              strokeWidth={hr(2)}
              listening={false}
            />
            {/* Vertex handles */}
            {hitboxWorldVerts.map((wp, i) => (
              <Circle
                key={`hbv-${i}`}
                x={wp.x}
                y={wp.y}
                radius={hr(7)}
                hitStrokeWidth={hr(10)}
                fill="#0cf"
                stroke="#fff"
                strokeWidth={hr(2)}
                draggable
                onDragMove={(e) =>
                  setVertexDrag({
                    kind: "hitbox",
                    index: i,
                    point: { x: e.target.x(), y: e.target.y() },
                  })
                }
                onDragEnd={(e) => {
                  const world = { x: e.target.x(), y: e.target.y() };
                  const local = worldToLocal(hitboxEditObj, world);
                  updateObjectVertex(hitboxEditObj.id, i, {
                    x: snapToGrid(local.x),
                    y: snapToGrid(local.y),
                  });
                  setVertexDrag(null);
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault();
                  deleteObjectVertex(hitboxEditObj.id, i);
                }}
                {...vertexLongPress(() => deleteObjectVertex(hitboxEditObj.id, i))}
              />
            ))}
            {/* Midpoint add handles */}
            {hitboxMidpoints.map((mp, i) => (
              <Circle
                key={`hbm-${i}`}
                x={mp.x}
                y={mp.y}
                radius={hr(5)}
                hitStrokeWidth={hr(8)}
                fill="rgba(0,200,255,0.4)"
                stroke="#0cf"
                strokeWidth={hr(1)}
                onClick={() => addHitboxVertexAt(mp)}
                onTap={() => addHitboxVertexAt(mp)}
                onMouseEnter={(e) => {
                  (e.target as Konva.Circle).radius(hr(7));
                  const c = e.target.getStage()?.container();
                  if (c) c.style.cursor = "copy";
                }}
                onMouseLeave={(e) => {
                  (e.target as Konva.Circle).radius(hr(5));
                  const c = e.target.getStage()?.container();
                  if (c) c.style.cursor = "";
                }}
              />
            ))}
          </Layer>
        )}

        {/* Alignment guides (rendered during drag) */}
        {(alignGuides.xs.length > 0 || alignGuides.ys.length > 0) && (
          <Layer listening={false}>
            {alignGuides.xs.map((x, i) => (
              <Line
                key={`gx-${i}-${x}`}
                points={[x, 0, x, H]}
                stroke="#22d3ee"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
              />
            ))}
            {alignGuides.ys.map((y, i) => (
              <Line
                key={`gy-${i}-${y}`}
                points={[0, y, W, y]}
                stroke="#22d3ee"
                strokeWidth={1 / stageScale}
                dash={[4 / stageScale, 3 / stageScale]}
              />
            ))}
          </Layer>
        )}

        {/* Box-select rectangle */}
        {marquee?.moved && (
          <Layer listening={false}>
            <Rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(59,130,246,0.12)"
              stroke="#3b82f6"
              strokeWidth={1 / stageScale}
              dash={[4 / stageScale, 3 / stageScale]}
            />
          </Layer>
        )}

        {/* Entry points layer */}
        <Layer>
          {entryPoints.map((ep) => {
            const isSelected = selectedEntryPointId === ep.id;
            const showAlways = activeTool === "entry-points";
            if (!showAlways && !isSelected) return null;
            return (
              <Group key={ep.id}>
                <Circle
                  x={ep.x}
                  y={ep.y}
                  radius={hr(isSelected ? 11 : 9)}
                  hitStrokeWidth={hr(8)}
                  fill={isSelected ? "#f59e0b" : "#3b82f6"}
                  stroke="#fff"
                  strokeWidth={hr(2)}
                  draggable={activeTool === "entry-points"}
                  onDragMove={(e) => {
                    snapHandle(e);
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    selectEntryPoint(ep.id);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    selectEntryPoint(ep.id);
                  }}
                  onDragEnd={(e) =>
                    updateEntryPoint(ep.id, {
                      x: Math.round(snapToGrid(e.target.x())),
                      y: Math.round(snapToGrid(e.target.y())),
                    })
                  }
                />
                {/* Direction arrow */}
                <Line
                  points={
                    ep.direction === "right"
                      ? [ep.x + 4, ep.y - 3, ep.x + 8, ep.y, ep.x + 4, ep.y + 3]
                      : [ep.x - 4, ep.y - 3, ep.x - 8, ep.y, ep.x - 4, ep.y + 3]
                  }
                  closed
                  fill="#fff"
                  listening={false}
                />
                {/* Label */}
                <Text
                  x={ep.x - 40}
                  y={ep.y - 24}
                  width={80}
                  text={ep.id}
                  fontSize={10}
                  fill="#fff"
                  align="center"
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>

      {/* Live move/resize/rotate readout, pinned above the object. */}
      {readout && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded bg-neutral-950/90 px-1.5 py-0.5 font-mono text-[11px] text-white shadow ring-1 ring-white/10"
          style={{ left: readout.x, top: readout.y - 8 }}
          aria-hidden="true"
        >
          {readout.text}
        </div>
      )}

      {/* Drop target while dragging from the asset library. */}
      {isDropTarget && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-start justify-center rounded-lg border-2 border-dashed border-blue-400/80 bg-blue-500/5">
          <span className="mt-3 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white shadow">
            Drop to place in this room
          </span>
        </div>
      )}

      {/* Right-click context menu overlay. HTML so
          click-outside / Esc behave like every other native menu. */}
      {contextMenu && (
        <RightClickMenu
          screenX={contextMenu.screenX}
          screenY={contextMenu.screenY}
          onClose={() => setContextMenu(null)}
          onSetWalkTo={() => {
            if (!currentRoomConfig) return;
            const snapped = clampPointToPolygon(
              contextMenu.worldPos,
              currentRoomConfig.walkableArea.polygon
            );
            updateObject(contextMenu.objectId, { moveTo: snapped });
            setContextMenu(null);
          }}
          onToggleLock={() => {
            const now = useEditorStore.getState().toggleObjectsLock([contextMenu.objectId]);
            if (now !== null) announce(now ? "Locked" : "Unlocked");
            setContextMenu(null);
          }}
        />
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-neutral-800/90 border border-neutral-700 rounded shadow-lg p-1">
        <button
          onClick={() => zoomBy(1 / 1.2)}
          className="p-1.5 rounded text-neutral-200 hover:bg-neutral-700"
          title="Zoom out (scroll down)"
          aria-label="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={() => zoomBy(1.2)}
          className="p-1.5 rounded text-neutral-200 hover:bg-neutral-700"
          title="Zoom in (scroll up)"
          aria-label="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <div className="w-px h-5 bg-neutral-600" />
        <button
          onClick={fitToViewport}
          className="p-1.5 rounded text-neutral-200 hover:bg-neutral-700"
          title="Fit to viewport"
          aria-label="Fit to viewport"
        >
          <Maximize2 size={14} />
        </button>
        <button
          onClick={zoomTo100}
          className="p-1.5 rounded text-neutral-200 hover:bg-neutral-700"
          title="Reset to 100%"
          aria-label="Zoom to 100%"
        >
          <Square size={14} />
        </button>
        <div className="w-px h-5 bg-neutral-600" />
        <span className="px-1.5 text-neutral-400 text-xs tabular-nums w-12 text-right">
          {Math.round(stageScale * 100)}%
        </span>
      </div>

      {/* Size indicator (left) */}
      <div className="absolute bottom-2 left-2 text-neutral-500 text-xs bg-neutral-800/80 px-2 py-1 rounded">
        {W}×{H}
      </div>
    </div>
  );
}

// ─── Onion-skin helpers ─────────────
// Resolve a door's target room. Prefers iid (rename-proof) and falls back to
// slug — same priority as the runtime in resolveDoorTargetRoom.
function resolveDoorTarget(
  door: RoomObject,
  rooms: Record<string, RoomConfig>
): RoomConfig | null {
  if (door.targetRoomIid) {
    for (const r of Object.values(rooms)) {
      if (r?.iid === door.targetRoomIid) return r;
    }
  }
  if (door.targetRoomId && rooms[door.targetRoomId as RoomId]) {
    return rooms[door.targetRoomId as RoomId];
  }
  return null;
}

// Renders a faded thumbnail of the target room next to the source door.
// Position: clamp the thumbnail to the canvas bounds so it never trails off
// the edge — easier to read than a partial image hanging into nothing.
// Real onion-skin thumbnail. Renders the target room's walls + floor +
// objects in pure Konva geometry at thumbnail scale — same shapes the
// editor's main bg layer draws (mirrors EditorCanvas:932-1004). No sprite
// image loads (would be N extra requests per scene change); objects show
// as small coloured rects so the user can still see *where* doors and
// furniture sit in the destination room.
function DoorThumbnail({
  door,
  targetConfig,
}: {
  door: RoomObject;
  targetConfig: RoomConfig;
}) {
  // Optional bg image overlay — only when the target room set one. Most
  // procedural rooms don't, in which case the geometric layer below carries
  // the visual on its own.
  const bgImg = useSpriteImage(targetConfig.bgMiddleUrl ?? undefined);

  // Compact card size — driven by the user's screenshot where 160×101 cards
  // overlapped each other on Home Hub's clustered doors.
  const thumbW = 130;
  const thumbH = (thumbW * ROOM_HEIGHT) / ROOM_WIDTH; // ~82
  const sx = thumbW / ROOM_WIDTH;
  const sy = thumbH / ROOM_HEIGHT;

  // Position: centred horizontally over the door, anchored just above it.
  // If the "above" placement would clip the top of the canvas, drop the
  // card below the door instead. Horizontal clamp keeps it on canvas.
  const cx = door.x + door.width / 2;
  const wantTop = door.y - thumbH - 8;
  const top =
    wantTop < 4
      ? Math.min(ROOM_HEIGHT - thumbH - 4, door.y + door.height + 8)
      : wantTop;
  const left = Math.max(
    4,
    Math.min(ROOM_WIDTH - thumbW - 4, cx - thumbW / 2)
  );

  const bgColor = targetConfig.backgroundColor ?? "#222";

  // Helper to scale a value from room space → thumb space.
  const sxv = (v: number) => v * sx;
  const syv = (v: number) => v * sy;

  // Cap object count so a freak 200-decoration room doesn't pile work into
  // every door's thumbnail.
  const objects = targetConfig.objects.slice(0, 50);
  const targetName = targetConfig.name ?? targetConfig.id;

  return (
    <Group opacity={0.55}>
      {/* Card frame: white stroke makes overlapping cards readable. */}
      <Rect
        x={left}
        y={top}
        width={thumbW}
        height={thumbH}
        fill={bgColor}
        stroke="#fff"
        strokeWidth={1}
        cornerRadius={3}
        perfectDrawEnabled={false}
      />
      {/* Background image (when present) sits on top of the flat backdrop. */}
      {bgImg && (
        <KonvaImage
          image={bgImg}
          x={left}
          y={top}
          width={thumbW}
          height={thumbH}
          opacity={0.85}
        />
      )}
      {/* Objects as tiny rects. Doors get an accent so the user can spot
          how this room links back to others at a glance. */}
      {objects.map((obj) => {
        const isDoor = obj.type === "door";
        const fill = isDoor
          ? "#f59e0b"
          : obj.category
            ? categoryHex(obj.category)
            : "#888";
        return (
          <Rect
            key={`thumb-obj-${obj.id}`}
            x={left + sxv(obj.x)}
            y={top + syv(obj.y)}
            width={Math.max(2, sxv(obj.width))}
            height={Math.max(2, syv(obj.height))}
            fill={fill}
            opacity={isDoor ? 0.9 : 0.75}
          />
        );
      })}
      {/* Inside-the-card label. Below-the-card placement got clipped by the
          door's own label in the source room; pinning it inside means it
          travels with the artwork. */}
      <Rect
        x={left + 3}
        y={top + 3}
        width={Math.min(thumbW - 6, targetName.length * 6 + 6)}
        height={12}
        fill="rgba(0,0,0,0.6)"
        cornerRadius={2}
      />
      <Text
        x={left + 6}
        y={top + 5}
        text={`→ ${targetName}`}
        fontSize={9}
        fill="#fff"
      />
    </Group>
  );
}

// ─── Walk-to marker ────────────────────
// Renders the yellow dot + dashed line that visualise an object's
// `moveTo` (where the avatar walks before the object's interaction
// fires). Always shown when the object is selected — solid when set,
// faded "ghost" at the runtime's fallback position when unset. Drag
// snaps to the walkable polygon so the user can't strand the avatar.

function defaultMoveTo(
  obj: RoomObject,
  polygon: Point[]
): Point {
  // Mirror BaseRoomScene.ts:640-645 so the editor's ghost shows exactly
  // where the runtime would walk to without an explicit moveTo.
  const fallbackY = obj.isWallMounted
    ? (polygon[0]?.y ?? obj.y) + 40
    : obj.y + obj.height;
  return { x: obj.x + obj.width / 2, y: fallbackY };
}

function WalkToMarker({
  obj,
  walkablePolygon,
  onCommit,
}: {
  obj: RoomObject;
  walkablePolygon: Point[];
  onCommit: (pt: Point) => void;
}) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isGhost = !obj.moveTo;
  const target = obj.moveTo ?? defaultMoveTo(obj, walkablePolygon);

  // Yellow when set, paler/dashed when unset. Hover/drag both nudge
  // opacity up so the marker pops while the user is interacting.
  const baseOpacity = isGhost ? 0.45 : 0.85;
  const activeOpacity = baseOpacity + (hover || dragging ? 0.15 : 0);
  const fill = isGhost ? "#fde047" : "#fde047"; // tailwind yellow-300
  const strokeColor = isGhost ? "#facc15" : "#eab308";

  const objCx = obj.x + obj.width / 2;
  const objCy = obj.y + obj.height / 2;

  return (
    <>
      {/* Connecting line — dashed in both modes; thinner when ghost. */}
      <Line
        points={[objCx, objCy, target.x, target.y]}
        stroke={strokeColor}
        strokeWidth={1}
        dash={isGhost ? [2, 4] : [3, 3]}
        opacity={activeOpacity * 0.7}
        listening={false}
      />
      {/* Drop-shadow halo so the dot reads against any bg colour. */}
      <Circle
        x={target.x}
        y={target.y}
        radius={11}
        fill="rgba(0,0,0,0.35)"
        listening={false}
        opacity={activeOpacity}
      />
      {/* The grabable dot itself. Slightly bigger than the old 5px so
          it survives the cursor's hit-test reliably. */}
      <Circle
        x={target.x}
        y={target.y}
        radius={8}
        fill={fill}
        stroke={strokeColor}
        strokeWidth={isGhost ? 1.5 : 2}
        dash={isGhost ? [2, 2] : undefined}
        opacity={activeOpacity}
        draggable
        onMouseEnter={(e) => {
          setHover(true);
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "grab";
        }}
        onMouseLeave={(e) => {
          setHover(false);
          const stage = e.target.getStage();
          if (stage && !dragging) stage.container().style.cursor = "default";
        }}
        onDragStart={(e) => {
          setDragging(true);
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "grabbing";
        }}
        onDragMove={(e) => {
          // Snap-to-walkable on every move so the dot can never visually
          // leave the floor — feels much better than letting it drift
          // free and snapping only on release.
          const node = e.target;
          const snapped = clampPointToPolygon(
            { x: node.x(), y: node.y() },
            walkablePolygon
          );
          if (snapped.x !== node.x() || snapped.y !== node.y()) {
            node.position({ x: snapped.x, y: snapped.y });
          }
          onCommit(snapped);
        }}
        onDragEnd={(e) => {
          setDragging(false);
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = hover ? "grab" : "default";
          const snapped = clampPointToPolygon(
            { x: e.target.x(), y: e.target.y() },
            walkablePolygon
          );
          onCommit(snapped);
        }}
      />
    </>
  );
}

// ─── Right-click context menu ─────────────
// Lightweight HTML overlay. Renders absolutely-positioned at the
// screen-pixel anchor passed in by the canvas. Closes on Esc or any
// click outside its own DOM tree.

function RightClickMenu({
  screenX,
  screenY,
  onSetWalkTo,
  onToggleLock,
  onClose,
}: {
  screenX: number;
  screenY: number;
  onSetWalkTo: () => void;
  /** Lock in place (only free objects can be right-clicked on the canvas). */
  onToggleLock: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // pointerdown, not mousedown: a finger outside the menu closes it too.
    const onMouseDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer the listener install so the right-click that opened the menu
    // doesn't immediately trip the click-outside handler.
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", onMouseDown);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: screenX,
        top: screenY,
        zIndex: 1000,
      }}
      className="rounded border border-neutral-700 bg-neutral-900 shadow-xl py-1 min-w-[160px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        onClick={onSetWalkTo}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
      >
        <MapPin size={13} aria-hidden="true" />
        <span>Set walk-to here</span>
      </button>
      <button
        onClick={onToggleLock}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
      >
        <LockIcon size={13} aria-hidden="true" />
        <span>Lock in place</span>
        <span className="ml-auto pl-3 text-[10px] text-neutral-500">Ctrl+Shift+L</span>
      </button>
    </div>
  );
}
