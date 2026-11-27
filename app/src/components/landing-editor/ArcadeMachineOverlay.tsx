"use client";

// ArcadeMachineOverlay — direct manipulation of the arcade machine in the
// editor. Rendered INSIDE AssetOverlay's box (same world % frame, same z
// stacking as the real scene), so its hit box sits exactly where the machine
// renders and overlapping elements win/lose clicks the way they paint.
//
// Machine selected (tool "select"): move, scale (aspect always locked — the
//   drawing never stretches) and rotate the whole group.
// Tool "screen": a 19:12-locked rectangle inside the machine marks where the
//   live game renders; move/scale it over the drawing.
//
// The machine can't be deleted or duplicated — one game per page.

import { useEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import { useTouchMode } from "@/lib/touchMode";
import { touchHitStyle, useTapSelect } from "@/lib/useTapSelect";
import { useLandingZoomStore } from "@/stores/landingZoomStore";
import {
  GAME_SCREEN_ASPECT,
  machineAspect,
  machineGeometry,
  machineVariant,
  screenHeightPct,
  type ArcadeConfig,
  type ArcadeDeviceKey,
} from "@/data/arcadeConfig";
import { announce } from "@/lib/a11yAnnounce";
import { Lock } from "lucide-react";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Write inline styles on an element (Moveable leaves px behind; restore %). */
function setStyles(el: HTMLElement, styles: Record<string, string>) {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v);
}

export function ArcadeMachineOverlay({
  arcade,
  world,
  device,
  selected,
  locked,
  tool,
  onSelect,
  onPlacement,
  onScreen,
}: {
  arcade: ArcadeConfig;
  world: { w: number; h: number };
  device: ArcadeDeviceKey;
  selected: boolean;
  /** Layer lock: in the Select tool the machine is click-through and has no
   *  handles. (The Screen and Frames tools are explicit placement tools.) */
  locked: boolean;
  tool: "select" | "screen" | "frame";
  onSelect: () => void;
  onPlacement: (t: { x: number; y: number; w: number; rotation: number }) => void;
  onScreen: (s: { x: number; y: number; w: number }) => void;
}) {
  const g = machineGeometry(arcade, device, world);
  // The drawing this device shows (phones may have their own) — its screen
  // rect is what the Screen tool edits.
  const scr = machineVariant(arcade, device).screen;
  // Callback refs as state: Moveable needs the elements on the render
  // AFTER they mount (the screen rect only exists in screen mode).
  const [hitEl, setHitEl] = useState<HTMLDivElement | null>(null);
  const [screenEl, setScreenEl] = useState<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable>(null);
  const touch = useTouchMode();
  // Touch: a tap selects the machine, a drag scrolls (see useTapSelect).
  const tapSelect = useTapSelect(() => {
    if (!selected) onSelect();
  }, touch);
  // Two fingers down = a pinch-zoom of the canvas: the machine ignores it.
  const pinching = () => useLandingZoomStore.getState().pinching;
  const live = useRef({ left: 0, top: 0, width: 0, rotation: 0 });
  const [gesturing, setGesturing] = useState(false);

  useEffect(() => {
    moveableRef.current?.updateRect();
  });

  const box = () => hitEl?.parentElement ?? null;

  // ── Machine gestures (px in the world box, committed as %) ──
  const initMachine = () => {
    const b = box();
    if (!b) return;
    setGesturing(true);
    live.current = {
      left: (g.box.x / 100) * b.clientWidth,
      top: (g.box.y / 100) * b.clientHeight,
      width: (g.box.w / 100) * b.clientWidth,
      rotation: g.rotation,
    };
  };
  const commitMachine = (moved: boolean) => {
    setGesturing(false);
    const b = box();
    // Moveable wrote px onto the hit box; put the authored % back (React
    // owns these props and won't re-set unchanged values). A real move
    // re-renders with the new % on top.
    if (hitEl) {
      setStyles(hitEl, {
        left: `${g.box.x}%`,
        top: `${g.box.y}%`,
        width: `${g.box.w}%`,
        height: `${g.box.h}%`,
        transform: g.rotation ? `rotate(${g.rotation}deg)` : "none",
      });
    }
    if (!moved || !b || b.clientWidth === 0) return;
    const next = {
      x: r2((live.current.left / b.clientWidth) * 100),
      y: r2((live.current.top / b.clientHeight) * 100),
      w: r2((live.current.width / b.clientWidth) * 100),
      rotation: Math.round(live.current.rotation * 10) / 10,
    };
    onPlacement(next);
    announce(`Machine at ${Math.round(next.x)}%, ${Math.round(next.y)}%, ${Math.round(next.w)}% wide`);
  };
  // Mirror the real machine while dragging so the author sees the art move.
  const mirrorMachine = () => {
    const real = box()?.parentElement?.querySelector<HTMLElement>("[data-arcade-machine]");
    const l = live.current;
    if (!real) return;
    real.style.left = `${l.left}px`;
    real.style.top = `${l.top}px`;
    real.style.width = `${l.width}px`;
    real.style.rotate = `${l.rotation}deg`;
  };
  const unmirrorMachine = () =>
    requestAnimationFrame(() => {
      const real = box()?.parentElement?.querySelector<HTMLElement>("[data-arcade-machine]");
      if (real) for (const k of ["left", "top", "width", "rotate"]) real.style.removeProperty(k);
    });

  // ── Screen gestures (px inside the machine box, committed as %) ──
  const liveScreen = useRef({ left: 0, top: 0, width: 0 });
  const initScreen = () => {
    const m = hitEl;
    if (!m) return;
    setGesturing(true);
    liveScreen.current = {
      left: (scr.x / 100) * m.clientWidth,
      top: (scr.y / 100) * m.clientHeight,
      width: (scr.w / 100) * m.clientWidth,
    };
  };
  const mirrorScreen = () => {
    const real = box()?.parentElement?.querySelector<HTMLElement>(
      "[data-arcade-machine] .cabinet-stage__screen"
    );
    const l = liveScreen.current;
    if (!real) return;
    real.style.left = `${l.left}px`;
    real.style.top = `${l.top}px`;
    real.style.width = `${l.width}px`;
    real.style.height = `${l.width / GAME_SCREEN_ASPECT}px`;
  };
  const commitScreen = (moved: boolean) => {
    setGesturing(false);
    const m = hitEl;
    // The real screen is positioned by CSS vars → drop the mirrored px.
    // The editing rect's own % props are React-owned → restore them.
    requestAnimationFrame(() => {
      const real = box()?.parentElement?.querySelector<HTMLElement>(
        "[data-arcade-machine] .cabinet-stage__screen"
      );
      if (real) for (const k of ["left", "top", "width", "height"]) real.style.removeProperty(k);
    });
    if (screenEl) {
      setStyles(screenEl, {
        left: `${scr.x}%`,
        top: `${scr.y}%`,
        width: `${scr.w}%`,
        height: `${screenHeightPct(arcade, device)}%`,
      });
    }
    if (!moved || !m || m.clientWidth === 0) return;
    const next = {
      x: r2((liveScreen.current.left / m.clientWidth) * 100),
      y: r2((liveScreen.current.top / m.clientHeight) * 100),
      w: r2((liveScreen.current.width / m.clientWidth) * 100),
    };
    onScreen(next);
    announce(`Screen at ${Math.round(next.x)}%, ${Math.round(next.y)}% of the machine`);
  };

  const editingScreen = selected && tool === "screen";
  const clickThrough = locked && tool === "select";

  return (
    <>
      <div
        ref={setHitEl}
        className="asset-hitbox arcade-machine-hitbox"
        data-selected={selected || undefined}
        data-locked={locked || undefined}
        role="button"
        tabIndex={0}
        aria-label={`Arcade machine${locked ? ", locked" : ""}${selected ? ", selected" : ""}. ${
          locked ? "Control Shift L unlocks it." : "Arrow keys move it."
        }`}
        aria-pressed={selected}
        {...tapSelect}
        onFocus={() => {
          if (!selected) onSelect();
        }}
        style={{
          ...touchHitStyle(touch, selected),
          position: "absolute",
          left: `${g.box.x}%`,
          top: `${g.box.y}%`,
          width: `${g.box.w}%`,
          height: `${g.box.h}%`,
          transform: g.rotation ? `rotate(${g.rotation}deg)` : undefined,
          zIndex: arcade.machine.zIndex,
          cursor: "move",
          pointerEvents: clickThrough ? "none" : "auto",
          boxSizing: "border-box",
          // Aspect hint for Moveable's keepRatio.
          aspectRatio: String(machineAspect(arcade, device)),
        }}
      >
        {editingScreen && (
          <div
            ref={setScreenEl}
            className="arcade-screen-rect"
            style={{
              position: "absolute",
              left: `${scr.x}%`,
              top: `${scr.y}%`,
              width: `${scr.w}%`,
              height: `${screenHeightPct(arcade, device)}%`,
            }}
          >
            <span className="arcade-screen-rect__label">Game screen · 19:12</span>
          </div>
        )}
        {locked && selected && (
          <span className="asset-lock-badge" style={{ left: "auto", right: 4 }} aria-hidden="true">
            <Lock className="size-3" />
          </span>
        )}
        {selected && !gesturing && (
          <span className="arcade-machine-hitbox__tag">
            {editingScreen ? "Drag the dashed box to place the game" : "Machine"}
          </span>
        )}
      </div>

      {selected && tool === "select" && !locked && hitEl && (
        <Moveable
          ref={moveableRef}
          target={hitEl}
          // Touch: an invisible 10px ring around each handle (CSS enlarges them).
          displayAroundControls={touch}
          controlPadding={touch ? 10 : 0}
          container={box()}
          rootContainer={document.body}
          draggable
          resizable
          rotatable
          keepRatio
          rotationPosition="bottom"
          origin={false}
          throttleDrag={0}
          throttleResize={0}
          renderDirections={["nw", "ne", "sw", "se"]}
          onDragStart={initMachine}
          onDrag={(e) => {
            if (pinching()) return;
            live.current.left = e.left;
            live.current.top = e.top;
            e.target.style.left = `${e.left}px`;
            e.target.style.top = `${e.top}px`;
            mirrorMachine();
          }}
          onDragEnd={(e) => {
            unmirrorMachine();
            commitMachine(e.isDrag);
          }}
          onResizeStart={initMachine}
          onResize={(e) => {
            live.current.width = e.width;
            live.current.left = e.drag.left;
            live.current.top = e.drag.top;
            e.target.style.width = `${e.width}px`;
            e.target.style.height = `${e.height}px`;
            e.target.style.left = `${e.drag.left}px`;
            e.target.style.top = `${e.drag.top}px`;
            mirrorMachine();
          }}
          onResizeEnd={(e) => {
            unmirrorMachine();
            commitMachine(e.isDrag);
          }}
          onRotateStart={initMachine}
          onRotate={(e) => {
            live.current.rotation = e.rotation;
            e.target.style.transform = `rotate(${e.rotation}deg)`;
            mirrorMachine();
          }}
          onRotateEnd={(e) => {
            unmirrorMachine();
            commitMachine(e.isDrag);
          }}
        />
      )}

      {editingScreen && screenEl && (
        <Moveable
          ref={moveableRef}
          target={screenEl}
          container={box()}
          rootContainer={document.body}
          draggable
          resizable
          keepRatio
          origin={false}
          throttleDrag={0}
          throttleResize={0}
          renderDirections={["nw", "ne", "sw", "se"]}
          onDragStart={initScreen}
          onDrag={(e) => {
            liveScreen.current.left = e.left;
            liveScreen.current.top = e.top;
            e.target.style.left = `${e.left}px`;
            e.target.style.top = `${e.top}px`;
            mirrorScreen();
          }}
          onDragEnd={(e) => commitScreen(e.isDrag)}
          onResizeStart={initScreen}
          onResize={(e) => {
            liveScreen.current.width = e.width;
            liveScreen.current.left = e.drag.left;
            liveScreen.current.top = e.drag.top;
            e.target.style.width = `${e.width}px`;
            e.target.style.height = `${e.width / GAME_SCREEN_ASPECT}px`;
            e.target.style.left = `${e.drag.left}px`;
            e.target.style.top = `${e.drag.top}px`;
            mirrorScreen();
          }}
          onResizeEnd={(e) => commitScreen(e.isDrag)}
        />
      )}
    </>
  );
}
