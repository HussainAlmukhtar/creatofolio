// Screen-reader announcements for the editors. The canvas is a <canvas>, so
// nothing a user does on it is visible to assistive tech; editors call
// `announce()` after meaningful actions (select, move, resize, delete) and the
// polite live region rendered by <LiveRegion /> reads it out.

const REGION_ID = "editor-live-region";

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export function announce(message: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(REGION_ID);
  if (!el) return;
  // Clear then set on the next frame so repeating the same message is read
  // again (live regions ignore unchanged text).
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = message;
  });
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    el.textContent = "";
  }, 4000);
}

export const LIVE_REGION_ID = REGION_ID;
