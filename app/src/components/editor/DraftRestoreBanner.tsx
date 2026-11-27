"use client";

// Banner that appears when an IndexedDB draft for the currently-loaded room
// is newer than the persisted DB row. Offers Restore (replace
// currentRoomConfig + flip isDirty) or Discard (delete the draft key).
//
// Mounted once near the top of EditorWrapper. Re-evaluates whenever the
// loaded room changes.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editorStore";
import { getDraft, clearDraft } from "@/lib/draftStore";
import { migrateObjectContent } from "@/data/contentMigrations";

interface PendingDraft {
  roomIid: string;
  savedAt: number;
}

function formatRelative(savedAt: number): string {
  const diff = Date.now() - savedAt;
  const m = Math.round(diff / 60000);
  if (m < 1) return "moments";
  if (m === 1) return "1 minute";
  if (m < 60) return `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function DraftRestoreBanner() {
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);
  const [pending, setPending] = useState<PendingDraft | null>(null);

  // Re-check whenever the loaded room iid changes.
  const roomIid = currentRoomConfig?.iid ?? null;

  useEffect(() => {
    if (!roomIid) return;
    let cancelled = false;
    void (async () => {
      const draft = await getDraft(roomIid);
      if (cancelled) return;
      // Reopening a room with unsaved edits from THIS session: the draft is
      // just those edits (already on screen), not something to recover.
      if (useEditorStore.getState().isDirty) {
        setPending(null);
        return;
      }
      // Only show the banner if the draft has actual content. We don't have
      // the DB updated_at handy here — the editor just loaded, so any draft
      // is newer than what the user is currently looking at OR they already
      // saved past it. We err toward visibility: show whenever a draft
      // exists, let the user choose.
      if (draft) {
        setPending({ roomIid, savedAt: draft.savedAt });
      } else {
        setPending(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomIid]);

  // Only for the room on screen (a room switch hides the old room's banner).
  if (!pending || pending.roomIid !== roomIid) return null;

  const restore = async () => {
    const draft = await getDraft(pending.roomIid);
    if (!draft) {
      setPending(null);
      return;
    }
    useEditorStore.getState().replaceCurrentRoom(draft.config, true);
    // Unsaved pop-up edits come back too (as edits, so Save writes them).
    for (const [objectId, content] of Object.entries(draft.content ?? {})) {
      useEditorStore.getState().updateContent(objectId, migrateObjectContent(content) ?? content);
    }
    await clearDraft(pending.roomIid);
    setPending(null);
    toast.success("Draft restored — remember to save.");
  };

  const discard = async () => {
    await clearDraft(pending.roomIid);
    setPending(null);
    toast("Draft discarded.");
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-700 bg-amber-900/40 px-4 py-2 text-sm text-amber-100">
      <div>
        Unsaved changes from {formatRelative(pending.savedAt)} ago.
      </div>
      <div className="flex gap-2">
        <button
          onClick={restore}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500"
        >
          Restore
        </button>
        <button
          onClick={discard}
          className="rounded px-3 py-1 text-xs hover:bg-amber-800"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
