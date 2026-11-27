// Editor actions that combine a store change with user feedback (toast +
// screen-reader announcement). Shared by keyboard shortcuts, the side panel
// and the outline so every entry point behaves the same.

import { toast } from "sonner";
import { useEditorStore } from "@/stores/editorStore";
import { announce } from "@/lib/a11yAnnounce";
import { lockMessage } from "@/lib/layerLock";

/** Delete an object and offer a one-click Undo in the toast. */
export function deleteObjectWithUndo(id: string): void {
  const st = useEditorStore.getState();
  const roomId = st.currentRoomId;
  const obj = st.currentRoomConfig?.objects.find((o) => o.id === id);
  if (!obj || !roomId) return;
  const name = obj.label || obj.id;
  st.deleteObject(id);
  announce(`Deleted ${name}. Press Control Z to undo.`);
  toast(`Deleted “${name}”`, {
    duration: 6000,
    action: {
      label: "Undo",
      onClick: () => {
        const now = useEditorStore.getState();
        if (now.currentRoomId !== roomId) {
          toast.error("You've switched rooms — open that room and press Ctrl+Z.");
          return;
        }
        // Re-add the exact object (same id + iid) rather than replaying
        // undo history, so it works even after other edits.
        if (now.currentRoomConfig?.objects.some((o) => o.id === obj.id)) return;
        now.addObject(obj);
        now.selectObject(obj.id);
        announce(`Restored ${name}`);
      },
    },
  });
}

/** Delete several objects at once, with one Undo that restores them all. */
export function deleteObjectsWithUndo(ids: string[]): void {
  if (ids.length <= 1) {
    if (ids[0]) deleteObjectWithUndo(ids[0]);
    return;
  }
  const st = useEditorStore.getState();
  const roomId = st.currentRoomId;
  const objs = (st.currentRoomConfig?.objects ?? []).filter((o) => ids.includes(o.id));
  if (!objs.length || !roomId) return;
  st.deleteObjects(objs.map((o) => o.id));
  announce(`Deleted ${objs.length} objects. Press Control Z to undo.`);
  toast(`Deleted ${objs.length} objects`, {
    duration: 6000,
    action: {
      label: "Undo",
      onClick: () => {
        const now = useEditorStore.getState();
        if (now.currentRoomId !== roomId) {
          toast.error("You've switched rooms — open that room and press Ctrl+Z.");
          return;
        }
        const existing = new Set(now.currentRoomConfig?.objects.map((o) => o.id));
        const back = objs.filter((o) => !existing.has(o.id));
        for (const o of back) now.addObject(o);
        now.setSelection(back.map((o) => o.id));
        announce(`Restored ${back.length} objects`);
      },
    },
  });
}

/** Delete an entry point (rooms must keep at least one). */
export function deleteEntryPointWithFeedback(id: string): void {
  const st = useEditorStore.getState();
  const count = st.currentRoomConfig?.entryPoints.length ?? 0;
  if (count <= 1) {
    toast.error("A room needs at least one entry point.");
    return;
  }
  st.deleteEntryPoint(id);
  announce(`Deleted entry point ${id}`);
}

/**
 * Lock / Unlock objects (the stored `RoomObject.locked`): one undo step, marks
 * the room dirty, announced. Several ids: any free → lock all, else unlock all.
 */
export function toggleObjectsLockWithFeedback(ids: string[]): boolean | null {
  const st = useEditorStore.getState();
  const now = st.toggleObjectsLock(ids);
  if (now === null) return null;
  const objs = st.currentRoomConfig?.objects ?? [];
  const name =
    ids.length === 1 ? objs.find((o) => o.id === ids[0])?.label || ids[0] : `${ids.length} objects`;
  announce(lockMessage(name, now));
  return now;
}
