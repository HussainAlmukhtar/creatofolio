"use client";

// useMinuteClock — a hydration-safe "now", rounded down to the minute and
// re-ticking every 30s. Used by section scheduling (sectionVisibility.ts).
//
// Why not just Date.now() during render: the server renders at one instant
// and the client hydrates at another, so a schedule boundary falling between
// the two would render different sections on each side — a hydration
// mismatch (the same class of bug AnnouncementBar.tsx avoids for its dismiss
// state). useSyncExternalStore is React's sanctioned escape hatch: it uses
// `getServerSnapshot` for BOTH the server render and the hydration pass, then
// re-renders with the real client clock once hydrated.
//
// `serverNow` is the instant the server rendered at (the [slug] route passes
// its own Date.now()), so SSR HTML already reflects the schedule for SEO and
// no-JS visitors. Pages with no server instant pass null — scheduled sections
// then stay hidden until the client clock takes over (see scheduleState).

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;

function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, MINUTE / 2);
  return () => window.clearInterval(id);
}

// Rounded so consecutive calls within the same minute return the SAME value —
// useSyncExternalStore requires a stable snapshot or it re-renders forever.
function getSnapshot(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

export function useMinuteClock(serverNow: number | null = null): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverNow);
}
