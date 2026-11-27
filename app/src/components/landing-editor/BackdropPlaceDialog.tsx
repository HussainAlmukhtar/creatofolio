"use client";

// BackdropPlaceDialog — pan / zoom an uploaded (or existing) backdrop image
// against the arcade's state guides before it lands in the scene. The box is
// the arcade's MAXIMUM zoom-out (every view any visitor can get); the guide
// overlay (toggleable) marks what each state shows. Nothing is cropped from
// the file — the image is positioned, and whatever falls outside the views is
// simply never seen. The result is an asset rect in world %.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { WorldRect } from "@/lib/arcadeGuides";
import { InfoTip } from "./InfoTip";

export function BackdropPlaceDialog({
  imageUrl,
  imageSize,
  bounds,
  worldAspect,
  guideUrl,
  initial,
  onCancel,
  onPlace,
}: {
  imageUrl: string;
  imageSize: { w: number; h: number };
  /** The max zoom-out box (world %). */
  bounds: WorldRect;
  worldAspect: number;
  guideUrl?: string;
  /** Existing placement (world %) when re-placing. */
  initial?: { x: number; y: number; w: number };
  onCancel: () => void;
  onPlace: (rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  // Box aspect (px): bounds width in world-width units vs height units.
  const boxAspect = (bounds.w * worldAspect) / bounds.h;
  const imgAspect = imageSize.w / imageSize.h;
  // Placement inside the box, in % of the box (left/top/width).
  const toBox = (r: { x: number; y: number; w: number }) => ({
    left: ((r.x - bounds.x) / bounds.w) * 100,
    top: ((r.y - bounds.y) / bounds.h) * 100,
    width: (r.w / bounds.w) * 100,
  });
  // Default: cover the whole box (fill width, or height if the image is taller-shaped).
  const coverWidth = imgAspect >= boxAspect ? (imgAspect / boxAspect) * 100 : 100;
  const [p, setP] = useState(() =>
    initial
      ? toBox(initial)
      : {
          width: coverWidth,
          left: (100 - coverWidth) / 2,
          top: (100 - ((coverWidth / 100) * boxAspect * 100) / imgAspect) / 2,
        }
  );
  const [showGuides, setShowGuides] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const heightPct = (p.width * boxAspect) / imgAspect; // % of box height

  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // Fingers on the picture: one pans it, two pinch-zoom it around their midpoint.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; width: number; cx: number; cy: number; left: number; top: number } | null>(null);
  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = null;
      pinch.current = { dist: pinchDist(), width: p.width, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, left: p.left, top: p.top };
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, left: p.left, top: p.top };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const box = boxRef.current?.getBoundingClientRect();
    const pi = pinch.current;
    if (pi && pointers.current.size === 2 && box) {
      const width = Math.max(20, Math.min(600, pi.width * (pinchDist() / pi.dist)));
      const f = width / pi.width;
      // The picture point under the starting midpoint stays under the midpoint.
      const mx = ((pi.cx - box.left) / box.width) * 100;
      const my = ((pi.cy - box.top) / box.height) * 100;
      setP({ width, left: mx - (mx - pi.left) * f, top: my - (my - pi.top) * f });
      return;
    }
    const d = drag.current;
    if (!d || !box) return;
    setP((cur) => ({
      ...cur,
      left: d.left + ((e.clientX - d.x) / box.width) * 100,
      top: d.top + ((e.clientY - d.y) / box.height) * 100,
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    drag.current = null;
  };
  // Zoom around the box centre so the framing doesn't jump.
  const setWidth = (w: number) =>
    setP((cur) => {
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + ((cur.width * boxAspect) / imgAspect) / 2;
      const h = (w * boxAspect) / imgAspect;
      return { width: w, left: cx - w / 2, top: cy - h / 2 };
    });

  // Wheel to zoom.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setWidth(Math.max(20, Math.min(600, p.width * (e.deltaY > 0 ? 0.95 : 1.05))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // Safari's own pinch ignores touch-action: stop it zooming the whole page.
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", stopGesture, { passive: false });
    el.addEventListener("gesturechange", stopGesture, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
    };
  });

  // Uncovered parts of the box = views that would show the letterbox.
  const covers =
    p.left <= 0.5 && p.top <= 0.5 && p.left + p.width >= 99.5 && p.top + heightPct >= 99.5;

  const commit = () => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    onPlace({
      x: r2(bounds.x + (p.left / 100) * bounds.w),
      y: r2(bounds.y + (p.top / 100) * bounds.h),
      w: r2((p.width / 100) * bounds.w),
      h: r2((heightPct / 100) * bounds.h),
    });
  };

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[94dvh] w-[min(1200px,95vw)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border bg-accent px-3 py-2 text-sm">
          <span className="font-medium">Place the backdrop</span>
          <InfoTip
            side="bottom"
            text="The box is the furthest the camera ever zooms out. Drag the picture to pan, scroll or use the slider to zoom. The coloured frames show what each screen state sees (orange = desktop, blue = phone, solid = at rest, dashed = scrolled / playing). Nothing is cut from your file; parts outside every frame are simply never seen."
          />
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-xs">
            Show guides
            <Switch size="sm" checked={showGuides} onCheckedChange={setShowGuides} />
          </label>
        </div>
        <div className="flex-1 overflow-auto bg-neutral-800 p-4">
          <div
            ref={boxRef}
            className="relative mx-auto overflow-hidden bg-neutral-600 select-none"
            style={{ aspectRatio: String(boxAspect), width: `min(100%, calc(72dvh * ${boxAspect}))`, touchAction: "none" }}
            data-backdrop-box=""
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="absolute max-w-none cursor-grab active:cursor-grabbing"
              style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${heightPct}%` }}
              data-backdrop-img=""
            />
            {showGuides && guideUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={guideUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full opacity-80" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <Slider
            className="w-56"
            min={20}
            max={600}
            step={1}
            value={[Math.round(p.width)]}
            onValueChange={([v]) => setWidth(v)}
          />
          <Button size="xs" variant="ghost" onClick={() => setP({ width: coverWidth, left: (100 - coverWidth) / 2, top: (100 - (coverWidth * boxAspect) / imgAspect) / 2 })}>
            Fill
          </Button>
          <span className={`text-xs ${covers ? "text-muted-foreground" : "text-amber-400"}`}>
            {covers ? "Covers every view." : "Some zoomed-out views will show past the picture's edge."}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={commit}>
            Place backdrop
          </Button>
        </div>
      </div>
    </div>
  );
}
