"use client";

import { useEffect } from "react";

/**
 * iPad Safari's edge-swipe "back" does not reliably fire `beforeunload`, so a
 * stray swipe from the screen edge used to leave an editor with unsaved work.
 * While `isDirty`, put one sentinel entry on the history stack: the first "back"
 * lands on it (same page, nothing lost), and we ask before going further.
 *
 * The sentinel is a COPY of the current history state plus a marker: Next's own
 * popstate handler reloads the page for entries whose state it doesn't
 * recognise, so a bare `{}` state would turn the guard into a reload.
 */
export function useBackSwipeGuard(isDirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!isDirty) return;
    const mark = () => {
      if (window.history.state?.backSwipeGuard) return;
      try {
        window.history.pushState({ ...(window.history.state ?? {}), backSwipeGuard: true }, "");
      } catch {
        /* no history access: beforeunload remains the guard */
      }
    };
    mark();
    const onPop = () => {
      // Landed one entry back (the sentinel was the entry we left).
      if (window.history.state?.backSwipeGuard) return; // forward onto it again: fine
      if (window.confirm(message)) {
        window.history.back(); // really leave
      } else {
        mark(); // stay: put the sentinel back
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [isDirty, message]);
}
