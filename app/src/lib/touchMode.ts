"use client";

// Touch mode for the admin editors: decided by INPUT, never by width. An iPad
// in landscape is 1180–1366 px wide (desktop-sized), but its primary pointer
// is a finger, so it gets finger-sized targets, visible (not hover-only)
// controls and tap alternatives to right-click / keyboard shortcuts.
//
// - `useTouchMode()` for behaviour (gestures, overflow menus, drawers).
// - `html[data-touch]` for styling: Tailwind's `touch:` variant (globals.css)
//   and the admin touch layer in globals.css key off it. Only admin pages set
//   it (`TouchModeRoot`), so the public site is untouched.
// - Dev only: `?touch=1` forces touch mode on a desktop browser (`?touch=0`
//   forces it off) for the rest of the tab session, so iPad layouts can be
//   checked at 1180×820 / 820×1180 without a device.

import { useSyncExternalStore } from "react";
import { OVERRIDE_KEY, TOUCH_QUERY, devOverrides } from "./touchModeShared";

export { TOUCH_QUERY };
const CHANGE_EVENT = "admin:touch-mode-change";

function readOverride(): boolean | null {
  if (!devOverrides || typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("touch");
    if (q === "1" || q === "0") sessionStorage.setItem(OVERRIDE_KEY, q);
    const v = sessionStorage.getItem(OVERRIDE_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function isTouchMode(): boolean {
  if (typeof window === "undefined") return false;
  const forced = readOverride();
  if (forced !== null) return forced;
  return !!window.matchMedia?.(TOUCH_QUERY).matches;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(TOUCH_QUERY);
  mql.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    mql.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** True when the admin UI should be in touch mode. SSR-safe (false). */
export function useTouchMode(): boolean {
  return useSyncExternalStore(subscribe, isTouchMode, () => false);
}

/** Mirror the current mode onto <html data-touch>. Returns a cleanup that
 *  removes the attribute (leaving admin must not restyle the public site). */
export function syncTouchAttribute(): () => void {
  const root = document.documentElement;
  const apply = () => {
    if (isTouchMode()) root.setAttribute("data-touch", "");
    else root.removeAttribute("data-touch");
  };
  apply();
  const unsubscribe = subscribe(apply);
  return () => {
    unsubscribe();
    root.removeAttribute("data-touch");
  };
}
