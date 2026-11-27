"use client";

// HotspotEditor — drawn-style nav: place the clickable areas (logo, each
// link, the CTA) on the bar drawing. Drag a box to move it, its corner to
// resize. Positions are % of the drawing, so they hold at any screen width.
//
// Layer lock: a box with `locked` can't be moved or resized and is click-through
// (a press goes to the drawing / the box under it). It stays selectable from the
// chips below, which carry the padlock (always visible: the chips aren't
// hover-gated). Ctrl/⌘+Shift+L toggles the selected box.

import { useEffect, useRef, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import type { NavHotspot } from "@/data/landingTypes";
import type { ArcadeArt } from "@/data/arcadeConfig";
import { isHotspotLocked, showLockedHint } from "@/lib/layerLock";
import { announce } from "@/lib/a11yAnnounce";

export interface HotspotItem {
  id: string;
  label: string;
  rect: NavHotspot;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function HotspotEditor({
  bar,
  items,
  onChange,
}: {
  bar: ArcadeArt;
  items: HotspotItem[];
  onChange: (id: string, rect: NavHotspot) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(items[0]?.id ?? null);
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    rect: NavHotspot;
  } | null>(null);
  // A press that starts on the SELECTED locked box (it is click-through, so it
  // lands on the drawing): if it turns into a drag, say it can't move.
  const lockedPress = useRef<{ id: string; x: number; y: number } | null>(null);

  const sel = items.find((i) => i.id === selected) ?? null;

  const toggleLock = (it: HotspotItem) => {
    const next = !isHotspotLocked(it.rect);
    onChange(it.id, { ...it.rect, locked: next });
    announce(`${it.label} ${next ? "locked" : "unlocked"}`);
  };

  // Ctrl/⌘+Shift+L: lock / unlock the selected box.
  const latest = useRef({ sel, toggleLock });
  useEffect(() => {
    latest.current = { sel, toggleLock };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l")) return;
      const { sel: cur, toggleLock: toggle } = latest.current;
      if (!cur) return;
      e.preventDefault();
      e.stopPropagation();
      toggle(cur);
    };
    // Capture: the landing editor's own handler must not also toggle an element.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onPointerDown = (e: React.PointerEvent, item: HotspotItem, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(item.id);
    if (isHotspotLocked(item.rect)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: item.id, mode, startX: e.clientX, startY: e.clientY, rect: item.rect };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const lp = lockedPress.current;
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) {
      lockedPress.current = null;
      const it = items.find((i) => i.id === lp.id);
      if (it) showLockedHint(() => toggleLock(it));
    }
    const d = drag.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = ((e.clientX - d.startX) / box.width) * 100;
    const dy = ((e.clientY - d.startY) / box.height) * 100;
    const r = d.rect;
    if (d.mode === "move") {
      onChange(d.id, {
        ...r,
        x: clamp(r.x + dx, 0, 100 - r.w),
        y: clamp(r.y + dy, 0, 100 - r.h),
      });
    } else {
      onChange(d.id, {
        ...r,
        w: clamp(r.w + dx, 2, 100 - r.x),
        h: clamp(r.h + dy, 10, 100 - r.y),
      });
    }
  };
  const onPointerUp = () => {
    drag.current = null;
    lockedPress.current = null;
  };

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:8px_8px]"
        style={{ aspectRatio: `${bar.naturalW} / ${bar.naturalH}` }}
        onPointerDown={(e) => {
          // Only a press on the drawing itself (a locked box is click-through).
          if (e.target instanceof HTMLElement && e.target.closest("[data-hotspot]")) return;
          const box = boxRef.current?.getBoundingClientRect();
          if (!sel || !box || !isHotspotLocked(sel.rect)) return;
          const px = ((e.clientX - box.left) / box.width) * 100;
          const py = ((e.clientY - box.top) / box.height) * 100;
          const r = sel.rect;
          if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
            lockedPress.current = { id: sel.id, x: e.clientX, y: e.clientY };
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bar.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
        {items.map((it) => {
          const on = it.id === selected;
          const locked = isHotspotLocked(it.rect);
          return (
            <div
              key={it.id}
              data-hotspot={it.id}
              data-locked={locked || undefined}
              role="button"
              tabIndex={0}
              aria-label={locked ? `${it.label}, locked. Control Shift L unlocks it.` : `Move ${it.label}`}
              onPointerDown={(e) => onPointerDown(e, it, "move")}
              onFocus={() => setSelected(it.id)}
              className={`absolute rounded-sm border-2 ${locked ? "cursor-default" : "cursor-move"} ${
                on ? "z-10 border-amber-500 bg-amber-400/25" : "border-sky-500/80 bg-sky-400/15"
              }`}
              style={{
                left: `${it.rect.x}%`,
                top: `${it.rect.y}%`,
                width: `${it.rect.w}%`,
                height: `${it.rect.h}%`,
                // Locked: click-through to the drawing (selectable from the chips).
                pointerEvents: locked ? "none" : undefined,
              }}
            >
              <span className="pointer-events-none absolute -top-0.5 start-0.5 truncate text-[9px] font-semibold leading-none text-black/70">
                {it.label}
              </span>
              {locked && (
                <span className="pointer-events-none absolute end-0.5 top-0.5 grid size-4 place-items-center rounded bg-sky-500 text-white">
                  <Lock className="size-2.5" aria-hidden="true" />
                </span>
              )}
              {!locked && (
                <span
                  onPointerDown={(e) => onPointerDown(e, it, "resize")}
                  className="absolute -bottom-1.5 -end-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-amber-500"
                />
              )}
            </div>
          );
        })}
      </div>
      {sel && isHotspotLocked(sel.rect) && (
        <div role="note" className="flex items-center gap-2 rounded-md bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-700">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong>{sel.label} is locked.</strong> It can&apos;t be moved or resized. Unlock it to change its place.
          </span>
          <button
            type="button"
            onClick={() => toggleLock(sel)}
            className="rounded border border-sky-500/50 px-2 py-0.5 text-[11px] font-medium hover:bg-sky-500/10"
          >
            Unlock
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {items.map((it) => {
          const locked = isHotspotLocked(it.rect);
          const on = it.id === selected;
          return (
            <span
              key={it.id}
              className={`inline-flex items-center overflow-hidden rounded-full border text-[11px] ${
                on ? "border-amber-500 bg-amber-50 text-amber-900" : "border-border text-muted-foreground"
              }`}
            >
              <button type="button" onClick={() => setSelected(it.id)} className="py-0.5 ps-2 pe-1">
                {it.label}
              </button>
              <button
                type="button"
                onClick={() => toggleLock(it)}
                aria-pressed={locked}
                aria-label={locked ? `Unlock ${it.label}` : `Lock ${it.label} in place`}
                title={locked ? "Locked: click to unlock (Ctrl+Shift+L)" : "Lock in place (Ctrl+Shift+L)"}
                className={`grid place-items-center py-0.5 pe-1.5 ps-0.5 touch:min-h-11 touch:min-w-11 ${
                  locked ? "text-sky-600" : "opacity-60 hover:opacity-100"
                }`}
              >
                {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
