"use client";

import { useSessionStore } from "@/stores/sessionStore";

/** Fixed amber strip shown while the owner's session has lapsed. */
export function SessionLostBanner() {
  const lost = useSessionStore((s) => s.lost);
  if (!lost) return null;
  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[10000] flex items-center justify-center gap-3 px-3 py-2 text-xs bg-amber-500 text-black shadow"
    >
      <span>
        You&apos;re signed out, so nothing can be saved right now. Your unsaved
        edits are still in this tab.
      </span>
      <button
        type="button"
        onClick={() => window.open("/admin/login", "_blank")}
        className="px-2 py-1 rounded bg-black/80 text-white hover:bg-black font-medium"
      >
        Sign in (opens a new tab)
      </button>
    </div>
  );
}
