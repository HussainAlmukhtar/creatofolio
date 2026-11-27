"use client";

// Inspector controls for the layer lock (landing editor + Arcade): a padlock
// button for the inspector header and the "Locked" note with an Unlock button.
// The same wording everywhere: "Lock in place" / "Unlock".

import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Inspector-header padlock. Closed + highlighted while locked. */
export function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <Button
      size="icon-sm"
      variant={locked ? "secondary" : "ghost"}
      onClick={onToggle}
      aria-pressed={locked}
      aria-label={locked ? "Unlock" : "Lock in place"}
      title={locked ? "Unlock (Ctrl+Shift+L)" : "Lock in place: can't be moved by accident (Ctrl+Shift+L)"}
      className={locked ? "text-sky-300" : undefined}
    >
      {locked ? <Lock /> : <Unlock />}
    </Button>
  );
}

/** "Locked" note shown above the position fields of a locked element. */
export function LockedNote({
  what = "This element",
  onUnlock,
}: {
  what?: string;
  onUnlock: () => void;
}) {
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-md bg-sky-500/10 px-2.5 py-2 text-[11px] leading-snug text-sky-300"
    >
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong>Locked.</strong> {what} can&apos;t be moved, resized or rotated on the canvas. Unlock it to change its place.
      </span>
      <Button size="xs" variant="secondary" onClick={onUnlock}>
        Unlock
      </Button>
    </div>
  );
}
