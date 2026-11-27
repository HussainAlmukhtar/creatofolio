"use client";

// AssetOverlay — the editor's direct-manipulation layer. Rendered as the last
// child of a section's real asset canvas box (via DrawnSection's editorOverlay
// prop), so it shares the exact percentage coordinate frame as the assets — no
// measurement/alignment needed.
//
// Each asset gets a transparent hit box (click to select). The selected asset
// is driven by react-moveable for drag / resize / rotate; on each gesture end
// the final geometry is converted from px back to percentages and committed to
// the store, which re-renders the real asset to match.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Moveable from "react-moveable";
import { useTouchMode } from "@/lib/touchMode";
import { useLandingZoomStore } from "@/stores/landingZoomStore";
import { BringToFront, Copy, ImagePlus, Lock, SendToBack, Trash2, Type, Unlock } from "lucide-react";
import type { DrawnSection } from "@/data/landingTypes";
import { announce } from "@/lib/a11yAnnounce";
import { showLockedHint } from "@/lib/layerLock";
import { ARCADE_MACHINE_IID } from "@/data/arcadeConfig";

/** Short human name for an element (screen readers, announcements). */
function assetName(a: DrawnSection["assets"][number], language: "en" | "ar"): string {
  const src = a.source;
  if (src.kind === "text") {
    const t = (src.text[language] || src.text.en || "").trim();
    return t ? `Text “${t.slice(0, 40)}”` : "Text";
  }
  if (src.kind === "component") return `${src.block.type} block`;
  if (src.kind === "drawn") return "Drawing";
  return "Image";
}

interface AssetOverlayProps {
  section: DrawnSection;
  selectedAssetIid: string | null;
  /** Which layout is being edited — mobile reads/writes the `mobile` override. */
  deviceMode: "desktop" | "mobile";
  onSelectAsset: (iid: string) => void;
  /** Click on empty canvas (not an asset, not a Moveable handle). */
  onBackgroundClick: () => void;
  onTransform: (
    iid: string,
    t: { x?: number; y?: number; w?: number; h?: number; rotation?: number }
  ) => void;
  /** Active preview language — which text variant inline-editing writes. */
  language: "en" | "ar";
  /** Commit inline-edited text content. */
  onEditText: (iid: string, value: string) => void;
  /** Set the section canvas's design height (bottom-edge handle). Omitted
   *  for sections whose height isn't canvas-driven (hero, h-scroll). */
  onResizeCanvas?: (newH: number) => void;
  /** Floating element toolbar actions. */
  /** Only the listed assets get hit boxes and the box itself lets clicks
   *  through to the real elements beneath (auto-stacked phone view, where
   *  only "free on phones" elements are hand-placed). */
  passThrough?: boolean;
  /** Layer lock: a locked element has no drag / resize / rotate handles and its
   *  hit box is click-through (the page scrolls / pans under a finger on it).
   *  It is still selectable from the layers list and shows an outline. */
  isLocked?: (iid: string) => boolean;
  /** The Arcade machine is locked and selected: where it sits (% of the world)
   *  and how to unlock it, for the "Locked: unlock it to move" hint. */
  machineLock?: { rect: { x: number; y: number; w: number; h: number }; onUnlock: () => void } | null;
  actions?: {
    /** Lock / Unlock (one undo step). */
    toggleLock?: (iid: string) => void;
    duplicate: (iid: string) => void;
    remove: (iid: string) => void;
    forward: (iid: string) => void;
    backward: (iid: string) => void;
    /** Open the media library to swap an image element's picture. */
    replace: (iid: string) => void;
  };
  /** Extra hit targets in the same box + stacking (the arcade machine and
   *  camera frames). Rendered before the element hit boxes. */
  children?: React.ReactNode;
}

export function AssetOverlay({
  section,
  selectedAssetIid,
  deviceMode,
  onSelectAsset,
  onBackgroundClick,
  onTransform,
  language,
  onEditText,
  onResizeCanvas,
  actions,
  passThrough,
  isLocked,
  machineLock,
  children,
}: AssetOverlayProps) {
  const lockedOf = (iid: string) => isLocked?.(iid) ?? false;
  // Effective geometry for the active device — mobile overrides fall back to
  // desktop values. Hit boxes + gesture math use this so the overlay matches
  // what the @container rules render.
  const eff = (a: DrawnSection["assets"][number]) =>
    deviceMode === "mobile"
      ? {
          x: a.mobile?.x ?? a.x,
          y: a.mobile?.y ?? a.y,
          w: a.mobile?.w ?? a.w,
          h: a.mobile?.h ?? a.h,
          rotation: a.mobile?.rotation ?? a.rotation ?? 0,
        }
      : { x: a.x, y: a.y, w: a.w, h: a.h, rotation: a.rotation ?? 0 };
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable>(null);
  const touch = useTouchMode();
  // Which text asset is being inline-edited (double-click a text element).
  const [editingIid, setEditingIid] = useState<string | null>(null);

  // ── Touch selection model ───────────────────────────────────────────
  // A finger TAP selects; a finger DRAG on an element that is not selected
  // scrolls the page (the browser takes the gesture: pointercancel); only an
  // element that is already selected moves under one finger. A long press
  // (still, ≥ 450 ms) selects it and opens its ⋯ menu at the finger. Mouse and
  // Pencil keep the old behaviour (select on press, drag at once).
  const pressRef = useRef<{ id: number; x: number; y: number; iid: string; moved: boolean; timer: number | null; long: boolean } | null>(null);
  const [menu, setMenu] = useState<{ iid: string; x: number; y: number } | null>(null);
  const clearPress = () => {
    const p = pressRef.current;
    if (p?.timer) window.clearTimeout(p.timer);
    pressRef.current = null;
  };
  useEffect(() => () => clearPress(), []);
  // A gesture that turned into a pinch must not leave the element displaced.
  const pinchedRef = useRef(false);
  const startCss = useRef("");
  const pinching = () => {
    if (useLandingZoomStore.getState().pinching) {
      pinchedRef.current = true;
      return true;
    }
    return false;
  };

  // Hold Shift to lock aspect ratio while resizing (both edges + corners).
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // True while dragging/resizing/rotating — the floating toolbar hides.
  const [gesturing, setGesturing] = useState(false);

  // Live px geometry during a gesture; committed as % on gesture end.
  const live = useRef({ left: 0, top: 0, width: 0, height: 0, rotation: 0 });

  // Keep Moveable's handles aligned after store-driven re-renders.
  useEffect(() => {
    moveableRef.current?.updateRect();
  });

  // LAYOUT size of the box (untransformed). Moveable reports left/top/width
  // in the box's own CSS px, so % conversions must use layout px too — the
  // arcade's editor Overview scales the whole world with a camera transform,
  // where getBoundingClientRect would be off by that scale.
  const boxRect = () =>
    boxEl ? { width: boxEl.offsetWidth, height: boxEl.offsetHeight } : null;

  const initLive = () => {
    setGesturing(true);
    const asset = section.assets.find((a) => a.iid === selectedAssetIid);
    const r = boxRect();
    if (!asset || !r) return;
    const g = eff(asset);
    live.current = {
      left: (g.x / 100) * r.width,
      top: (g.y / 100) * r.height,
      width: (g.w / 100) * r.width,
      height: (g.h / 100) * r.height,
      rotation: g.rotation,
    };
  };

  // The real rendered element for an asset. It's mirrored live during a
  // gesture so the owner sees the actual thing move/resize/rotate (not just
  // an outline), as in any page builder.
  const realEl = (iid: string) =>
    boxEl?.parentElement?.querySelector<HTMLElement>(
      `.drawn-asset-pos[data-asset-iid="${iid}"]`
    ) ?? null;
  const MIRRORED = ["left", "top", "width", "height", "transform"] as const;
  const mirror = () => {
    if (!selectedAssetIid) return;
    const el = realEl(selectedAssetIid);
    if (!el) return;
    const l = live.current;
    el.style.left = `${l.left}px`;
    el.style.top = `${l.top}px`;
    el.style.width = `${l.width}px`;
    // Auto-height components size to their content; leave height alone.
    if (!el.classList.contains("drawn-asset-pos--auto-h")) el.style.height = `${l.height}px`;
    el.style.transform = `rotate(${l.rotation}deg)`;
  };
  const unmirror = (iid: string) => {
    // Next frame: by then the store commit has re-rendered the element with
    // its new CSS variables, so dropping the inline px can't flash the old spot.
    requestAnimationFrame(() => {
      const el = realEl(iid);
      if (el) for (const k of MIRRORED) el.style.removeProperty(k);
    });
  };

  // Live readout next to the selection while dragging/resizing/rotating.
  const readoutRef = useRef<HTMLDivElement>(null);
  const showReadout = (kind: "move" | "size" | "rotate") => {
    const el = readoutRef.current;
    const r = boxRect();
    if (!el || !r || r.width === 0) return;
    const l = live.current;
    const pct = (n: number, of: number) => `${Math.round((n / of) * 1000) / 10}%`;
    el.textContent =
      kind === "move"
        ? `x ${pct(l.left, r.width)} · y ${pct(l.top, r.height)}`
        : kind === "size"
          ? `${pct(l.width, r.width)} × ${pct(l.height, r.height)}`
          : `${Math.round(l.rotation)}°`;
    el.style.left = `${l.left + l.width / 2}px`;
    el.style.top = `${l.top + l.height + 10}px`;
    el.style.display = "block";
  };
  const hideReadout = () => {
    if (readoutRef.current) readoutRef.current.style.display = "none";
  };

  // Commits are rounded to 0.01% — sub-pixel on any screen, and it keeps the
  // inspector from showing 66.666666666.
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const commit = (moved: boolean, target?: HTMLElement) => {
    setGesturing(false);
    hideReadout();
    if (!selectedAssetIid) return;
    unmirror(selectedAssetIid);
    // The gesture became a pinch-zoom: put the element back, commit nothing.
    if (pinchedRef.current) {
      pinchedRef.current = false;
      if (target) target.style.cssText = startCss.current;
      return;
    }
    // A plain click on the selection fires a gesture end too — don't turn
    // that into an undo step.
    if (!moved) return;
    const r = boxRect();
    if (!r || r.width === 0 || r.height === 0) return;
    const next = {
      x: r2((live.current.left / r.width) * 100),
      y: r2((live.current.top / r.height) * 100),
      w: r2((live.current.width / r.width) * 100),
      h: r2((live.current.height / r.height) * 100),
      rotation: Math.round(live.current.rotation * 10) / 10,
    };
    onTransform(selectedAssetIid, next);
    announce(
      `Element at ${Math.round(next.x)}%, ${Math.round(next.y)}%, ${Math.round(next.w)} by ${Math.round(next.h)}%`
    );
  };

  const selectedAsset = section.assets.find((a) => a.iid === selectedAssetIid) ?? null;
  const selectedLocked = selectedAsset ? lockedOf(selectedAsset.iid) : false;

  // A mouse / pen drag that starts on the SELECTED locked element (picked from
  // the layers list) can't move it: say so once per session, with Unlock.
  const lockedPressRef = useRef<{ x: number; y: number } | null>(null);
  const onBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== boxEl || e.pointerType === "touch" || !boxEl) return;
    const target =
      selectedAsset && selectedLocked
        ? { g: eff(selectedAsset), unlock: () => actions?.toggleLock?.(selectedAsset.iid) }
        : selectedAssetIid === ARCADE_MACHINE_IID && machineLock
          ? { g: machineLock.rect, unlock: machineLock.onUnlock }
          : null;
    if (!target) return;
    const g = target.g;
    const r = boxEl.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100;
    const py = ((e.clientY - r.top) / r.height) * 100;
    if (px < g.x || px > g.x + g.w || py < g.y || py > g.y + g.h) return;
    lockedPressRef.current = { x: e.clientX, y: e.clientY };
    const done = () => {
      lockedPressRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    const move = (ev: PointerEvent) => {
      const p = lockedPressRef.current;
      if (!p) return;
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 8) {
        done();
        showLockedHint(target.unlock);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };

  // Bottom-edge handle: drag to make the element area taller/shorter. A guide
  // line + readout preview the new edge; the store rescales on release so
  // every element keeps its on-screen place.
  const [canvasDrag, setCanvasDrag] = useState<{ px: number; label: string } | null>(null);
  const startCanvasResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onResizeCanvas || !boxEl) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rect = boxEl.getBoundingClientRect();
    const startY = e.clientY;
    const H = section.aspectRatio.h;
    // Can't shrink past the lowest element.
    const minPx = Math.max(
      80,
      ...Array.from(boxEl.parentElement?.querySelectorAll<HTMLElement>(".drawn-asset-pos") ?? []).map(
        (el) => el.getBoundingClientRect().bottom - rect.top + 8
      )
    );
    let px = rect.height;
    const toH = (p: number) => Math.round((H * p) / rect.height);
    const move = (ev: PointerEvent) => {
      px = Math.max(minPx, rect.height + ev.clientY - startY);
      setCanvasDrag({ px, label: `${toH(px)} px` });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setCanvasDrag(null);
      if (Math.abs(px - rect.height) > 2) onResizeCanvas(toH(px));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    setCanvasDrag({ px, label: `${H} px` });
  };

  // Snap targets: every other element's hit box, plus the section's edges
  // and centre lines (what builders snap to).
  const others = section.assets
    .filter((a) => a.iid !== selectedAssetIid)
    .map((a) => ({
      element: `#ah-${a.iid}`,
      className: "asset-snap-guide",
    }));

  return (
    <div
      ref={setBoxEl}
      className="absolute inset-0"
      // Real assets paint with their own positive z-index (asset.zIndex), which
      // (per CSS stacking rules) beats a positioned sibling left at the default
      // z-index:auto REGARDLESS of DOM order — so without this, assets with
      // zIndex >= 1 rendered on top of this overlay and swallowed clicks meant
      // for the hit boxes below. 1000 clears any realistic asset zIndex; this
      // div's own stacking context (container-type:inline-size on an ancestor
      // implies contain:layout, which creates one) keeps it from leaking above
      // unrelated UI like modals.
      style={{ pointerEvents: passThrough ? "none" : "auto", zIndex: 1000 }}
      onPointerDown={onBoxPointerDown}
      onMouseDown={(e) => {
        // Only a click on the empty box itself — never on an asset hit box or a
        // Moveable control (those aren't the box element) — changes selection.
        if (e.target === boxEl) onBackgroundClick();
      }}
    >
      {children}
      {section.assets.map((asset) => {
        const selected = asset.iid === selectedAssetIid;
        const isText = asset.source.kind === "text";
        const editing = editingIid === asset.iid && isText;
        const g = eff(asset);
        const locked = lockedOf(asset.iid);
        return (
          <div
            key={asset.iid}
            id={`ah-${asset.iid}`}
            className="asset-hitbox"
            data-selected={selected || undefined}
            data-locked={locked || undefined}
            // Pointer (not mouse) down: on touch this selects on the first
            // press, so press-and-drag works without a separate tap.
            onPointerDown={(e) => {
              if (editing) return;
              if (touch && e.pointerType === "touch") {
                clearPress();
                const press = { id: e.pointerId, x: e.clientX, y: e.clientY, iid: asset.iid, moved: false, timer: null as number | null, long: false };
                press.timer = window.setTimeout(() => {
                  if (pressRef.current !== press || press.moved) return;
                  press.long = true;
                  onSelectAsset(press.iid);
                  setMenu({ iid: press.iid, x: press.x, y: press.y });
                  navigator.vibrate?.(10);
                }, 450);
                pressRef.current = press;
                return;
              }
              onSelectAsset(asset.iid);
            }}
            onPointerMove={(e) => {
              const p = pressRef.current;
              if (!p || p.id !== e.pointerId) return;
              if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
                p.moved = true;
                if (p.timer) window.clearTimeout(p.timer);
              }
            }}
            onPointerUp={(e) => {
              const p = pressRef.current;
              if (!p || p.id !== e.pointerId) return;
              pressRef.current = null;
              if (p.timer) window.clearTimeout(p.timer);
              if (!p.moved && !p.long) onSelectAsset(p.iid);
            }}
            onPointerCancel={clearPress}
            onContextMenu={(e) => {
              // The iOS long-press callout / right-click: our own menu replaces it.
              if (touch) e.preventDefault();
            }}
            // Keyboard: Tab reaches every element; focusing selects it, then
            // arrows nudge, Delete removes, Enter edits text.
            tabIndex={passThrough ? -1 : 0}
            role="button"
            aria-label={`${assetName(asset, language)}${locked ? ", locked" : ""}${selected ? ", selected" : ""}. ${
              locked ? "Control Shift L unlocks it" : "Arrow keys move"
            }, Delete removes${isText ? ", Enter edits text" : ""}.`}
            aria-pressed={selected}
            onFocus={() => {
              if (!selected && !editing) {
                onSelectAsset(asset.iid);
                announce(`Selected ${assetName(asset, language)}`);
              }
            }}
            onKeyDown={(e) => {
              if (editing) return;
              if (e.key === "Enter" && isText) {
                e.preventDefault();
                setEditingIid(asset.iid);
              }
            }}
            onDoubleClick={() => {
              if (isText) {
                onSelectAsset(asset.iid);
                setEditingIid(asset.iid);
              }
            }}
            style={{
              position: "absolute",
              left: `${g.x}%`,
              top: `${g.y}%`,
              width: `${g.w}%`,
              height: `${g.h}%`,
              transform: g.rotation ? `rotate(${g.rotation}deg)` : undefined,
              // Match relative stacking to the real asset so overlapping hit
              // boxes pick the visually topmost element, same as what's seen.
              zIndex: asset.zIndex,
              cursor: isText ? "text" : "move",
              // Locked: click-through (the press lands on the box, or on the
              // unlocked element under it; a finger scrolls the page).
              pointerEvents: locked ? "none" : "auto",
              boxSizing: "border-box",
              // Touch: the page scrolls under a finger on an unselected element;
              // the selected one is dragged (Moveable's area claims the gesture).
              touchAction: touch ? (selected ? "none" : "pan-x pan-y") : undefined,
              WebkitTouchCallout: touch ? "none" : undefined,
              userSelect: touch && !editing ? "none" : undefined,
            }}
          >
            {locked && selected && (
              <span className="asset-lock-badge" aria-hidden="true">
                <Lock className="size-3" />
              </span>
            )}
            {editing && asset.source.kind === "text" && (
              <textarea
                autoFocus
                defaultValue={asset.source.text[language]}
                onChange={(e) => onEditText(asset.iid, e.target.value)}
                onBlur={() => setEditingIid(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingIid(null);
                  e.stopPropagation();
                }}
                dir={language === "ar" ? "rtl" : "ltr"}
                className="h-full w-full resize-none border-0 bg-white/70 p-0 text-center outline-none"
                style={{
                  fontFamily: "inherit",
                  fontSize: `${asset.source.style.fontSize}cqw`,
                  fontWeight: asset.source.style.fontWeight,
                  color: asset.source.style.color,
                  textAlign: asset.source.style.align,
                  lineHeight: asset.source.style.lineHeight ?? 1.15,
                }}
              />
            )}
          </div>
        );
      })}

      {selectedAssetIid && !editingIid && boxEl && !selectedLocked && (
        <Moveable
          ref={moveableRef}
          target={`#ah-${selectedAssetIid}`}
          // Touch: an invisible 10px ring around each handle (CSS enlarges them).
          displayAroundControls={touch}
          controlPadding={touch ? 10 : 0}
          container={boxEl}
          // .drawn-section__container sets container-type:inline-size for the
          // mobile @container queries, which implies `contain: layout` — that
          // makes it a containing block for the control box Moveable renders
          // under it, so past a point (near section edges, or once the page
          // scrolls) the handles compute wrong on-screen coordinates and stop
          // responding. rootContainer escapes to an ancestor with no
          // contain/transform of its own so handle math is always correct.
          rootContainer={document.body}
          draggable
          dragArea
          resizable
          rotatable
          // Rotate handle under the element (as in Canva): the floating
          // toolbar sits above it and would otherwise cover the handle.
          rotationPosition="bottom"
          keepRatio={shiftHeld}
          origin={false}
          throttleDrag={0}
          throttleResize={0}
          // Shift while rotating steps in 15° like every design tool.
          throttleRotate={shiftHeld ? 15 : 0}
          snappable
          snapContainer={boxEl}
          elementGuidelines={others}
          verticalGuidelines={["0", "50%", "100%"]}
          horizontalGuidelines={["0", "50%", "100%"]}
          snapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
          elementSnapDirections={{ left: true, right: true, top: true, bottom: true, center: true, middle: true }}
          snapThreshold={6}
          snapGap
          isDisplaySnapDigit
          maxSnapElementGuidelineDistance={400}
          snapRotationDegrees={[0, 90, 180, 270]}
          snapRotationThreshold={4}
          onClick={(e) => {
            // The selection's drag surface covers the whole selected element,
            // so a big selected element (a full-size backdrop) would swallow
            // every click meant for things painted above it — the machine, a
            // prop. A plain click (not a drag) passes through to whatever hit
            // box is visually on top at that point.
            if (!e.isDouble) {
              const ev = e.inputEvent as MouseEvent | undefined;
              if (ev && typeof ev.clientX === "number") {
                const top = document
                  .elementsFromPoint(ev.clientX, ev.clientY)
                  .find((el) => el.classList.contains("asset-hitbox")) as HTMLElement | undefined;
                if (top && top.id !== `ah-${selectedAssetIid}`) {
                  top.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
                }
              }
              return;
            }
            // Double-click a selected text element to edit it inline (the drag
            // surface sits over the hit box, so its own onDoubleClick can't fire).
            if (!selectedAssetIid) return;
            const asset = section.assets.find((a) => a.iid === selectedAssetIid);
            if (asset?.source.kind === "text") setEditingIid(selectedAssetIid);
          }}
          onDragStart={(e) => {
            pinchedRef.current = false;
            startCss.current = (e.target as HTMLElement).style.cssText;
            initLive();
          }}
          onDrag={(e) => {
            if (pinching()) return;
            live.current.left = e.left;
            live.current.top = e.top;
            e.target.style.left = `${e.left}px`;
            e.target.style.top = `${e.top}px`;
            mirror();
            showReadout("move");
          }}
          onDragEnd={(e) => commit(e.isDrag, e.target as HTMLElement)}
          onResizeStart={(e) => {
            pinchedRef.current = false;
            startCss.current = (e.target as HTMLElement).style.cssText;
            initLive();
          }}
          onResize={(e) => {
            if (pinching()) return;
            live.current.width = e.width;
            live.current.height = e.height;
            live.current.left = e.drag.left;
            live.current.top = e.drag.top;
            e.target.style.width = `${e.width}px`;
            e.target.style.height = `${e.height}px`;
            e.target.style.left = `${e.drag.left}px`;
            e.target.style.top = `${e.drag.top}px`;
            mirror();
            showReadout("size");
          }}
          onResizeEnd={(e) => commit(e.isDrag, e.target as HTMLElement)}
          onRotateStart={(e) => {
            pinchedRef.current = false;
            startCss.current = (e.target as HTMLElement).style.cssText;
            initLive();
          }}
          onRotate={(e) => {
            if (pinching()) return;
            live.current.rotation = e.rotation;
            e.target.style.transform = `rotate(${e.rotation}deg)`;
            mirror();
            showReadout("rotate");
          }}
          onRotateEnd={(e) => commit(e.isDrag, e.target as HTMLElement)}
        />
      )}
      {selectedAsset && actions && !editingIid && !gesturing && (
        <ElementToolbar
          asset={selectedAsset}
          geometry={eff(selectedAsset)}
          locked={selectedLocked}
          actions={actions}
          onEditText={() => setEditingIid(selectedAsset.iid)}
        />
      )}
      {menu && actions && (
        <ElementContextMenu
          asset={section.assets.find((a) => a.iid === menu.iid)}
          locked={lockedOf(menu.iid)}
          at={menu}
          actions={actions}
          onClose={() => setMenu(null)}
          onEditText={() => {
            setEditingIid(menu.iid);
            setMenu(null);
          }}
        />
      )}
      <div ref={readoutRef} className="asset-readout" style={{ display: "none" }} aria-hidden="true" />
      {onResizeCanvas && (
        <div
          className="canvas-resize-handle"
          onPointerDown={startCanvasResize}
          title="Drag (or focus and use ↑/↓) to make this section's element area taller or shorter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize section height"
          aria-valuenow={section.aspectRatio.h}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            e.stopPropagation();
            const step = (e.shiftKey ? 100 : 20) * (e.key === "ArrowDown" ? 1 : -1);
            const next = Math.max(200, section.aspectRatio.h + step);
            onResizeCanvas(next);
            announce(`Section height ${next} pixels`);
          }}
        />
      )}
      {canvasDrag && (
        <>
          <div className="canvas-resize-guide" style={{ top: canvasDrag.px }} />
          <div className="asset-readout" style={{ display: "block", left: "50%", top: canvasDrag.px + 10 }}>
            {canvasDrag.label}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Floating element toolbar ─────────────────────────────────
//
// Sits just above the selected element, like the contextual bar in Canva /
// Shopify's editor.

function ElementToolbar({
  asset,
  geometry,
  locked,
  actions,
  onEditText,
}: {
  asset: DrawnSection["assets"][number];
  geometry: { x: number; y: number; w: number; h: number };
  locked: boolean;
  actions: NonNullable<AssetOverlayProps["actions"]>;
  onEditText: () => void;
}) {
  const isImage =
    asset.source.kind === "upload" ||
    asset.source.kind === "drawn" ||
    (asset.source.kind === "component" && asset.source.block.type === "image");
  const isText = asset.source.kind === "text";
  // Above the element (the section's heading band / padding leaves room
  // even for top-row elements); below only for a full-height element.
  const below = geometry.y < 1;
  const btn = (label: string, title: string, onClick: () => void, Icon: typeof Copy, danger = false) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`element-toolbar__btn${danger ? " element-toolbar__btn--danger" : ""}`}
    >
      <Icon className="size-3.5" />
      {label && <span>{label}</span>}
    </button>
  );
  return (
    <div
      className="element-toolbar"
      style={{
        left: `${Math.min(Math.max(geometry.x + geometry.w / 2, 12), 88)}%`,
        top: below ? `calc(${geometry.y + geometry.h}% + 10px)` : `calc(${geometry.y}% - 10px)`,
        translate: below ? "-50% 0" : "-50% -100%",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isImage && btn("Replace", "Replace image", () => actions.replace(asset.iid), ImagePlus)}
      {isText && btn("Edit", "Edit text (or double-click)", onEditText, Type)}
      {actions.toggleLock &&
        btn(
          "",
          locked ? "Unlock (Ctrl+Shift+L)" : "Lock in place (Ctrl+Shift+L)",
          () => actions.toggleLock?.(asset.iid),
          // The icon shows the STATE (closed = locked), like the layers rows.
          locked ? Lock : Unlock
        )}
      {btn("", "Duplicate (Ctrl+D)", () => actions.duplicate(asset.iid), Copy)}
      {btn("", "Bring forward ( ] )", () => actions.forward(asset.iid), BringToFront)}
      {btn("", "Send backward ( [ )", () => actions.backward(asset.iid), SendToBack)}
      <span className="element-toolbar__sep" />
      {btn("", "Delete (Del)", () => actions.remove(asset.iid), Trash2, true)}
    </div>
  );
}

// ─── Long-press menu (touch) ───────────────────────────────────
//
// The same actions as the floating toolbar, as a list at the finger. Portalled to
// <body> and positioned in screen px, so the canvas zoom can't distort or clip it.

function ElementContextMenu({
  asset,
  locked,
  at,
  actions,
  onClose,
  onEditText,
}: {
  asset: DrawnSection["assets"][number] | undefined;
  locked: boolean;
  at: { x: number; y: number };
  actions: NonNullable<AssetOverlayProps["actions"]>;
  onClose: () => void;
  onEditText: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Any press outside, a scroll, or Escape closes it.
    const away = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  if (!asset) return null;
  const isImage =
    asset.source.kind === "upload" ||
    asset.source.kind === "drawn" ||
    (asset.source.kind === "component" && asset.source.block.type === "image");
  const isText = asset.source.kind === "text";
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const item = (label: string, Icon: typeof Copy, fn: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={run(fn)}
      className={`flex w-full items-center gap-2 rounded-md px-3 text-left text-sm ${
        danger ? "text-red-300 hover:bg-red-500/20" : "text-neutral-100 hover:bg-white/10"
      }`}
      style={{ minHeight: 44 }}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
  const w = 220;
  const left = Math.max(8, Math.min(at.x - w / 2, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(at.y + 12, window.innerHeight - 8 - 7 * 44));
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Element actions"
      data-touch-exempt
      className="fixed z-[100001] rounded-xl border border-white/10 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur"
      style={{ left, top, width: w, touchAction: "none" }}
    >
      {isImage && item("Replace image", ImagePlus, () => actions.replace(asset.iid))}
      {isText && item("Edit text", Type, onEditText)}
      {actions.toggleLock &&
        item(locked ? "Unlock" : "Lock in place", locked ? Unlock : Lock, () => actions.toggleLock?.(asset.iid))}
      {item("Duplicate", Copy, () => actions.duplicate(asset.iid))}
      {item("Bring forward", BringToFront, () => actions.forward(asset.iid))}
      {item("Send backward", SendToBack, () => actions.backward(asset.iid))}
      {item("Delete", Trash2, () => actions.remove(asset.iid), true)}
    </div>,
    document.body
  );
}
