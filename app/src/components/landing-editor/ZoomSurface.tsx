"use client";

// ZoomSurface — the scrolling surface of the landing canvas, with touch zoom.
//
// At zoom 1 this renders exactly what the editor always did (scroller > page),
// so a desktop with a mouse is pixel-identical: the zoom store only changes on
// touch (pinch, or the −/+/Fit/100% buttons).
//
// Zoomed, the page is scaled with a CSS transform (so its container queries and
// react-moveable keep working in the page's own pixels) and a sizer element gives
// the scroller the scaled scroll extent.
//
// Gestures (touch screens only):
// - ONE finger scrolls the page natively (`touch-action: pan-x pan-y`).
// - TWO fingers zoom around their midpoint and pan with it. Native listeners with
//   preventDefault (React's touch handlers are passive) plus Safari's gesture
//   events, which ignore touch-action and would otherwise zoom the whole page or
//   open the tab overview.
// Cribbed from the room editor's pinch in EditorCanvas.tsx.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTouchMode } from "@/lib/touchMode";
import { MAX_ZOOM, MIN_ZOOM, useLandingZoomStore } from "@/stores/landingZoomStore";

const PAGE_MARGIN_Y = 24; // the page's `my-6`
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface ZoomSurfaceProps {
  children: React.ReactNode;
  /** Classes of the page element (width rules, shadow, fonts scope…). */
  pageClassName: string;
  pageStyle?: React.CSSProperties;
  deviceMode: "desktop" | "mobile";
}

/** The width the page has at zoom 1 (min-w 820 / max-w 5xl on desktop, 390 on mobile). */
function baseWidth(avail: number, device: "desktop" | "mobile"): number {
  return device === "mobile" ? Math.min(avail, 390) : Math.min(1024, Math.max(avail, 820));
}

export function ZoomSurface({ children, pageClassName, pageStyle, deviceMode }: ZoomSurfaceProps) {
  const touch = useTouchMode();
  const zoom = useLandingZoomStore((s) => s.zoom);
  const fitTick = useLandingZoomStore((s) => s.fitTick);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [pageH, setPageH] = useState(0);
  // Where the content point under the fingers must end up after a zoom commit.
  const anchorRef = useRef<{ cx: number; cy: number; clientX: number; clientY: number } | null>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Measure the scroller's width and the page's height (layout px: unaffected by the transform).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const page = pageRef.current;
    if (!scroller || !page) return;
    const measure = () => {
      setAvail(scroller.clientWidth);
      setPageH(page.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  const base = baseWidth(avail, deviceMode);
  const zoomed = zoom !== 1;
  const sizerW = Math.max(avail, base * zoom);

  // "Fit": the whole page width inside the scroller.
  useEffect(() => {
    if (fitTick === 0 || avail === 0) return;
    useLandingZoomStore.getState().setZoom(Math.min(1, avail / base));
    scrollerRef.current?.scrollTo({ left: 0 });
    // fitTick is the trigger; avail/base are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTick]);

  // After a zoom commit: put the anchored content point back under the fingers.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    const scroller = scrollerRef.current;
    const page = pageRef.current;
    if (!a || !scroller || !page) return;
    const r = page.getBoundingClientRect();
    scroller.scrollLeft += r.left + a.cx * zoom - a.clientX;
    scroller.scrollTop += r.top + a.cy * zoom - a.clientY;
  }, [zoom]);

  // Pinch zoom + two-finger pan (touch screens).
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const startedInside = useRef(false);
  const onTouchStart = useCallback((e: TouchEvent) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (e.touches.length === 1) {
      const r = scroller.getBoundingClientRect();
      const t = e.touches[0];
      startedInside.current = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
    }
    if (e.touches.length === 2 && startedInside.current) {
      useLandingZoomStore.getState().setPinching(true);
    }
  }, []);
  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 2 || !startedInside.current) return;
    const page = pageRef.current;
    if (!page) return;
    e.preventDefault();
    const a = e.touches[0];
    const b = e.touches[1];
    const clientX = (a.clientX + b.clientX) / 2;
    const clientY = (a.clientY + b.clientY) / 2;
    const dist = Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    const prev = pinchRef.current;
    if (!prev) {
      pinchRef.current = { dist, zoom: zoomRef.current };
      return;
    }
    const next = clampZoom(prev.zoom * (dist / prev.dist));
    const r = page.getBoundingClientRect();
    const z = zoomRef.current;
    anchorRef.current = { cx: (clientX - r.left) / z, cy: (clientY - r.top) / z, clientX, clientY };
    useLandingZoomStore.getState().setZoom(next);
  }, []);
  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (e.touches.length < 2 && pinchRef.current) {
      pinchRef.current = null;
      anchorRef.current = null;
    }
    if (e.touches.length === 0) {
      startedInside.current = false;
      // Let a lifted second finger's pointerup settle before drags listen again.
      window.setTimeout(() => useLandingZoomStore.getState().setPinching(false), 80);
    }
  }, []);

  useEffect(() => {
    if (!touch) return;
    const stopPageZoom = (e: Event) => e.preventDefault();
    // Window + capture: a pinch that starts on a react-moveable handle (rendered
    // under <body>, outside the scroller) must zoom too.
    window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", onTouchEnd, { capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { capture: true });
    const scroller = scrollerRef.current;
    scroller?.addEventListener("gesturestart", stopPageZoom, { passive: false });
    scroller?.addEventListener("gesturechange", stopPageZoom, { passive: false });
    return () => {
      window.removeEventListener("touchstart", onTouchStart, { capture: true });
      window.removeEventListener("touchmove", onTouchMove, { capture: true });
      window.removeEventListener("touchend", onTouchEnd, { capture: true });
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      scroller?.removeEventListener("gesturestart", stopPageZoom);
      scroller?.removeEventListener("gesturechange", stopPageZoom);
    };
  }, [touch, onTouchStart, onTouchMove, onTouchEnd]);

  // Leaving the editor (or Fit/100% buttons) must never strand a zoom.
  useEffect(() => () => useLandingZoomStore.getState().reset(), []);

  return (
    <div
      ref={scrollerRef}
      className="flex-1 overflow-auto"
      data-editor-canvas
      // One finger scrolls; the browser never pinch-zooms this surface (two-finger
      // moves reach the handler above). Touch screens only.
      style={touch ? { touchAction: "pan-x pan-y", overscrollBehavior: "contain" } : undefined}
    >
      <div
        data-zoom-sizer
        style={zoomed ? { position: "relative", width: sizerW, height: PAGE_MARGIN_Y * 2 + pageH * zoom } : undefined}
      >
        <div
          ref={pageRef}
          className={pageClassName}
          style={
            zoomed
              ? {
                  ...pageStyle,
                  position: "absolute",
                  top: 0,
                  left: Math.max(0, (sizerW - base * zoom) / 2),
                  width: base,
                  transformOrigin: "0 0",
                  transform: `scale(${zoom})`,
                }
              : pageStyle
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
