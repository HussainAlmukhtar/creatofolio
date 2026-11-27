"use client";

// Full screen for a studio container: the real Fullscreen API where the browser
// has it (iPadOS Safari supports element full screen), and an edge-to-edge
// overlay (100dvw × 100dvh, safe-area padded) either alongside it or when it
// isn't available / is refused. The choice is remembered per browser.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const KEY = "studio:fullscreen";

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

function readPref(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function writePref(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
}

function fsElement(): Element | null {
  return document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
}

export function useStudioFullscreen(containerRef: RefObject<HTMLElement | null>) {
  // `full` = the edge-to-edge layout is on (with or without the real API).
  // (The studio only mounts after a click, never during SSR, so reading the
  // stored preference in the initialiser is safe.)
  const [full, setFull] = useState(() => typeof window !== "undefined" && readPref());
  // Was the real API active last time? Tells "the system gesture / Esc left
  // full screen" apart from "the API never started".
  const hadApi = useRef(false);

  // A remembered preference starts edge-to-edge (the real API needs a user gesture).
  useEffect(() => {
    const onChange = () => {
      const active = !!containerRef.current && fsElement() === containerRef.current;
      if (active) {
        hadApi.current = true;
      } else if (hadApi.current) {
        hadApi.current = false;
        setFull(false);
        writePref(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [containerRef]);

  const enter = useCallback(() => {
    setFull(true);
    writePref(true);
    const el = containerRef.current as FsEl | null;
    if (!el) return;
    try {
      if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch {
      // The overlay layout is already on.
    }
  }, [containerRef]);

  const exit = useCallback(() => {
    setFull(false);
    writePref(false);
    hadApi.current = false;
    const d = document as FsDoc;
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.();
    } catch {}
  }, []);

  const toggle = useCallback(() => (full ? exit() : enter()), [full, enter, exit]);

  // Leaving the studio (unmount) must not strand the page in full screen.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    []
  );

  return { full, enter, exit, toggle };
}
