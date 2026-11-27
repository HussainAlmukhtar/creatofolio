"use client";

// SliceEditor — where the drawn panel's edges end. Four guide lines over the
// panel drawing: drag each one (mouse, pen or finger) to where the corner /
// edge art stops; everything between them is the stretchy middle. Stored in
// the drawing's own pixels (PopupThemeConfig.panelSlice), so the same numbers
// work at any size on screen. Arrow keys nudge a focused line (Shift = 10 px).

import { useRef } from "react";
import type { DrawnArt, SliceInsets } from "@/data/popupStyleTypes";

type Side = keyof SliceInsets;

export function SliceEditor({
  art,
  slice,
  onChange,
}: {
  art: DrawnArt;
  slice: SliceInsets;
  onChange: (slice: SliceInsets) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const W = art.w || 1;
  const H = art.h || 1;
  const pct = { top: (slice.top / H) * 100, bottom: (slice.bottom / H) * 100, left: (slice.left / W) * 100, right: (slice.right / W) * 100 };

  const clamp = (side: Side, v: number): number => {
    const max = side === "top" || side === "bottom" ? H : W;
    const other = side === "top" ? slice.bottom : side === "bottom" ? slice.top : side === "left" ? slice.right : slice.left;
    return Math.round(Math.max(0, Math.min(max - other - 4, v)));
  };
  const set = (side: Side, v: number) => onChange({ ...slice, [side]: clamp(side, v) });

  const startDrag = (side: Side) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* fine without capture */
    }
    const move = (ev: PointerEvent) => {
      const x = ((ev.clientX - box.left) / box.width) * W;
      const y = ((ev.clientY - box.top) / box.height) * H;
      const v = side === "left" ? x : side === "right" ? W - x : side === "top" ? y : H - y;
      set(side, v);
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

  const nudge = (side: Side) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const horiz = side === "left" || side === "right";
    const inward = horiz ? (side === "left" ? "ArrowRight" : "ArrowLeft") : side === "top" ? "ArrowDown" : "ArrowUp";
    const outward = horiz ? (side === "left" ? "ArrowLeft" : "ArrowRight") : side === "top" ? "ArrowUp" : "ArrowDown";
    if (e.key === inward) set(side, slice[side] + step);
    else if (e.key === outward) set(side, slice[side] - step);
    else return;
    e.preventDefault();
  };

  const line = (side: Side) => {
    const horiz = side === "top" || side === "bottom";
    const style: React.CSSProperties = horiz
      ? { left: 0, right: 0, height: 0, [side]: `${pct[side]}%` }
      : { top: 0, bottom: 0, width: 0, [side]: `${pct[side]}%` };
    return (
      <button
        key={side}
        type="button"
        aria-label={`${side} edge: ${slice[side]} px (drag, or use the arrow keys)`}
        title={`${side} edge: ${slice[side]} px`}
        onPointerDown={startDrag(side)}
        onKeyDown={nudge(side)}
        className={`slice-line slice-line--${horiz ? "h" : "v"}`}
        style={style}
      >
        <span className="slice-line__grip" />
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="slice-box media-tile relative mx-auto w-full max-w-sm select-none"
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
        {(["top", "bottom", "left", "right"] as Side[]).map(line)}
      </div>
      <p className="text-center text-[11px] tabular-nums text-neutral-400">
        Edges: top {slice.top} · right {slice.right} · bottom {slice.bottom} · left {slice.left} px
      </p>
    </div>
  );
}
