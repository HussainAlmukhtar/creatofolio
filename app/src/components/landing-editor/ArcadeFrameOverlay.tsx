"use client";

// ArcadeFrameOverlay — the camera, drawn as frames on the whole world.
//
// The editor shows the entire arcade world; each camera (the device's REST
// framing and every scroll keyframe) is a rectangle on it: what a visitor's
// screen shows at that moment. With the Frame tool, the selected camera's
// rectangle is directly editable — drag to re-aim, corner-drag to zoom
// (aspect locked to the device frame), rotate to tilt. That's how "one
// drawing, reframed per device" is authored: the phone frame is just a
// different rectangle on the same drawing.

import { useEffect, useRef, useState } from "react";
import Moveable from "react-moveable";
import { useTouchMode } from "@/lib/touchMode";
import { useLandingZoomStore } from "@/stores/landingZoomStore";
import type { ArcadeCamera, ArcadeConfig, ArcadeDeviceKey } from "@/data/arcadeConfig";
import { cameraFromFrame, frameRect } from "@/lib/arcadeCamera";

/** Write inline styles on an element (Moveable leaves px behind; restore %). */
function setStyles(el: HTMLElement, styles: Record<string, string>) {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v);
}

export type CameraTarget = { kind: "rest" } | { kind: "keyframe"; index: number };

export function ArcadeFrameOverlay({
  arcade,
  world,
  device,
  active,
  target,
  onTarget,
  onCamera,
}: {
  arcade: ArcadeConfig;
  world: { w: number; h: number };
  device: ArcadeDeviceKey;
  /** Frame tool on: the target frame is editable. */
  active: boolean;
  target: CameraTarget;
  onTarget: (t: CameraTarget) => void;
  onCamera: (t: CameraTarget, cam: ArcadeCamera) => void;
}) {
  const dev = arcade[device];
  const fa = dev.frame.aspect.w / dev.frame.aspect.h;
  const wa = world.w / world.h;
  const frames: { t: CameraTarget; cam: ArcadeCamera; label: string }[] = [
    { t: { kind: "rest" }, cam: dev.rest, label: "Rest (before scrolling)" },
    ...(dev.scroll.enabled
      ? dev.scroll.keyframes.map((k, i) => ({
          t: { kind: "keyframe", index: i } as CameraTarget,
          cam: k.camera,
          label: `Scroll ${Math.round(k.at * 100)}%`,
        }))
      : []),
  ];
  const same = (a: CameraTarget, b: CameraTarget) =>
    a.kind === b.kind && (a.kind === "rest" || a.index === (b as { index: number }).index);

  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const moveableRef = useRef<Moveable>(null);
  const touch = useTouchMode();
  useEffect(() => {
    moveableRef.current?.updateRect();
  });
  const live = useRef({ left: 0, top: 0, width: 0, height: 0, rotation: 0 });
  const box = () => el?.parentElement ?? null;

  // A stale target (e.g. keyframe 2 after switching to a device with one
  // keyframe) falls back to the rest frame so something is always editable.
  const current = frames.find((f) => same(f.t, target)) ?? frames[0];
  const effTarget = current.t;
  const init = () => {
    const b = box();
    if (!b) return;
    const r = frameRect(current.cam, fa, wa);
    live.current = {
      left: ((r.cx - r.w / 2) / 100) * b.clientWidth,
      top: ((r.cy - r.h / 2) / 100) * b.clientHeight,
      width: (r.w / 100) * b.clientWidth,
      height: (r.h / 100) * b.clientHeight,
      rotation: r.rotation,
    };
  };
  const commit = (moved: boolean) => {
    const b = box();
    // Restore the React-owned % geometry Moveable overwrote with px.
    if (el) {
      const r = frameRect(current.cam, fa, wa);
      setStyles(el, {
        left: `${r.cx - r.w / 2}%`,
        top: `${r.cy - r.h / 2}%`,
        width: `${r.w}%`,
        height: `${r.h}%`,
        transform: r.rotation ? `rotate(${r.rotation}deg)` : "none",
      });
    }
    if (!moved || !b || b.clientWidth === 0) return;
    const l = live.current;
    const cx = ((l.left + l.width / 2) / b.clientWidth) * 100;
    const cy = ((l.top + l.height / 2) / b.clientHeight) * 100;
    const w = (l.width / b.clientWidth) * 100;
    const cam = cameraFromFrame({ cx, cy, w, rotation: l.rotation }, fa, wa);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    onCamera(effTarget, {
      scale: Math.round(cam.scale * 1000) / 1000,
      focusX: r2(cam.focusX),
      focusY: r2(cam.focusY),
      rotation: Math.round(cam.rotation * 10) / 10,
    });
  };

  return (
    <div
      className="arcade-frames"
      // Above every element hit box while editing frames; click-through
      // otherwise (frames are then just a visual guide).
      style={{ position: "absolute", inset: 0, zIndex: active ? 100000 : 99999, pointerEvents: "none" }}
    >
      {frames.map((f) => {
        const r = frameRect(f.cam, fa, wa);
        const isTarget = same(f.t, effTarget);
        return (
          <div
            key={f.t.kind === "rest" ? "rest" : `k${f.t.index}`}
            ref={isTarget ? setEl : undefined}
            className="arcade-frame"
            data-kind={f.t.kind}
            data-target={isTarget && active ? "true" : undefined}
            style={{
              position: "absolute",
              left: `${r.cx - r.w / 2}%`,
              top: `${r.cy - r.h / 2}%`,
              width: `${r.w}%`,
              height: `${r.h}%`,
              transform: r.rotation ? `rotate(${r.rotation}deg)` : undefined,
              // Only the frame being edited takes the pointer — zoomed-out
              // keyframes are huge and would swallow every click. Other
              // frames are picked by their label.
              pointerEvents: active && isTarget ? "auto" : "none",
              cursor: active && isTarget ? "move" : undefined,
              // The frame being edited is "selected": a finger drags it.
              touchAction: touch && active && isTarget ? "none" : undefined,
            }}
          >
            <span
              className="arcade-frame__label"
              style={active && !isTarget ? { pointerEvents: "auto", cursor: "pointer" } : undefined}
              onPointerDown={(e) => {
                if (!active || isTarget) return;
                e.stopPropagation();
                onTarget(f.t);
              }}
            >
              {f.label}
            </span>
          </div>
        );
      })}
      {active && el && (
        <Moveable
          ref={moveableRef}
          target={el}
          // Touch: an invisible 10px ring around each handle (CSS enlarges them).
          displayAroundControls={touch}
          controlPadding={touch ? 10 : 0}
          container={box()}
          rootContainer={document.body}
          draggable
          resizable
          rotatable
          keepRatio
          rotationPosition="top"
          origin={false}
          throttleDrag={0}
          throttleResize={0}
          renderDirections={["nw", "ne", "sw", "se"]}
          onDragStart={init}
          onDrag={(e) => {
            // Two fingers down = a pinch-zoom of the canvas, not a move.
            if (useLandingZoomStore.getState().pinching) return;
            live.current.left = e.left;
            live.current.top = e.top;
            e.target.style.left = `${e.left}px`;
            e.target.style.top = `${e.top}px`;
          }}
          onDragEnd={(e) => commit(e.isDrag)}
          onResizeStart={init}
          onResize={(e) => {
            live.current.width = e.width;
            live.current.height = e.height;
            live.current.left = e.drag.left;
            live.current.top = e.drag.top;
            e.target.style.width = `${e.width}px`;
            e.target.style.height = `${e.height}px`;
            e.target.style.left = `${e.drag.left}px`;
            e.target.style.top = `${e.drag.top}px`;
          }}
          onResizeEnd={(e) => commit(e.isDrag)}
          onRotateStart={init}
          onRotate={(e) => {
            live.current.rotation = e.rotation;
            e.target.style.transform = `rotate(${e.rotation}deg)`;
          }}
          onRotateEnd={(e) => commit(e.isDrag)}
        />
      )}
    </div>
  );
}
