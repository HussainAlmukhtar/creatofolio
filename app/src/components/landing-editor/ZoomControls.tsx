"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import { useTouchMode } from "@/lib/touchMode";
import { useLandingZoomStore } from "@/stores/landingZoomStore";

/** −  100%  +  Fit for the landing canvas. Touch screens only (a desktop with a
 *  mouse keeps its insert bar exactly as it was). */
export function ZoomControls() {
  const touch = useTouchMode();
  const zoom = useLandingZoomStore((s) => s.zoom);
  const zoomBy = useLandingZoomStore((s) => s.zoomBy);
  const reset = useLandingZoomStore((s) => s.reset);
  const fit = useLandingZoomStore((s) => s.fit);
  if (!touch) return null;
  const btn =
    "grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4";
  return (
    <div className="ms-auto flex items-center gap-0.5" role="group" aria-label="Zoom">
      <button type="button" className={btn} onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out (or pinch)">
        <Minus />
      </button>
      <button
        type="button"
        className={`${btn} min-w-14 px-1 text-xs font-medium tabular-nums`}
        onClick={reset}
        aria-label="Reset zoom to 100%"
        title="Back to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={btn} onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (or pinch)">
        <Plus />
      </button>
      <button type="button" className={btn} onClick={fit} aria-label="Fit the page to the screen" title="Fit the whole page width">
        <Maximize />
      </button>
    </div>
  );
}
