"use client";

// Subscribe to a CSS media query. SSR-safe (false on the server) and
// tear-free via useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { useTouchMode } from "./touchMode";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && !!window.matchMedia?.(query).matches,
    () => false
  );
}

/** Primary input is a finger (phones, tablets). Same signal as the admin
 *  touch mode (honours the dev `?touch=1` override). */
export function useCoarsePointer(): boolean {
  return useTouchMode();
}
