"use client";

// ScreenEditor — mark a frame's "screen": the window the pop-up content sits
// in. Drag the box to move it, drag a corner to resize it (mouse, pen or
// finger: plain DOM pointer events, no canvas library). Stored in % of the
// drawing (PopupFrameConfig.screen). Arrow keys move the focused box
// (Shift = 5%).

import { useRef } from "react";
import type { DrawnArt, ScreenRect } from "@/data/popupStyleTypes";

type Grab = "move" | "nw" | "ne" | "sw" | "se";
const MIN = 5;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function ScreenEditor({
  art,
  screen,
  onChange,
}: {
  art: DrawnArt;
  screen: ScreenRect;
  onChange: (s: ScreenRect) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  const start = (grab: Grab) => (e: React.PointerEvent<HTMLElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* fine without capture */
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    const s0 = { ...screen };
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / box.width) * 100;
      const dy = ((ev.clientY - y0) / box.height) * 100;
      let { x, y, w, h } = s0;
      if (grab === "move") {
        x = Math.min(100 - w, Math.max(0, s0.x + dx));
        y = Math.min(100 - h, Math.max(0, s0.y + dy));
      } else {
        if (grab.includes("w")) {
          x = Math.min(s0.x + s0.w - MIN, Math.max(0, s0.x + dx));
          w = s0.w + (s0.x - x);
        }
        if (grab.includes("e")) w = Math.min(100 - s0.x, Math.max(MIN, s0.w + dx));
        if (grab.includes("n")) {
          y = Math.min(s0.y + s0.h - MIN, Math.max(0, s0.y + dy));
          h = s0.h + (s0.y - y);
        }
        if (grab.includes("s")) h = Math.min(100 - s0.y, Math.max(MIN, s0.h + dy));
      }
      onChange({ x: r1(x), y: r1(y), w: r1(w), h: r1(h) });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 0.5;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onChange({
      ...screen,
      x: r1(Math.min(100 - screen.w, Math.max(0, screen.x + d[0]))),
      y: r1(Math.min(100 - screen.h, Math.max(0, screen.y + d[1]))),
    });
  };

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="media-tile relative mx-auto w-full max-w-md select-none"
        style={{ aspectRatio: `${art.w || 4} / ${art.h || 3}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
        <div
          role="button"
          tabIndex={0}
          aria-roledescription="movable box"
          aria-label={`Screen window at ${screen.x}%, ${screen.y}%, ${screen.w}% × ${screen.h}%: drag to move, corners to resize, arrow keys to nudge`}
          onPointerDown={start("move")}
          onKeyDown={onKey}
          className="screen-rect"
          style={{ left: `${screen.x}%`, top: `${screen.y}%`, width: `${screen.w}%`, height: `${screen.h}%` }}
        >
          <span className="screen-rect__label">SCREEN</span>
          {(["nw", "ne", "sw", "se"] as Grab[]).map((g) => (
            <span key={g} className={`screen-rect__handle screen-rect__handle--${g}`} onPointerDown={start(g)} />
          ))}
        </div>
      </div>
      <p className="text-center text-[11px] tabular-nums text-neutral-400">
        Screen: {screen.x}% from the left, {screen.y}% from the top · {screen.w}% × {screen.h}%
      </p>
    </div>
  );
}
