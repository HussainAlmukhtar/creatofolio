"use client";

// Hook: subscribe to the editor store and write the current room config (and
// the room's unsaved pop-up edits) to IndexedDB after a debounce. Cleans up the draft once `isDirty` flips back
// to false (i.e. a successful save) — for every room the save wrote, not
// just the open one.

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { setDraft, clearDraft } from "@/lib/draftStore";
import type { ObjectContent } from "@/data/contentTypes";

const DEBOUNCE_MS = 2000;

type EditorState = ReturnType<typeof useEditorStore.getState>;

/** Slugs of every room with unsaved edits: the open one plus earlier ones. */
function dirtyRoomIds(s: EditorState): Set<string> {
  const ids = new Set(s.dirtyRoomIds);
  if (s.isDirty && s.currentRoomId) ids.add(s.currentRoomId);
  return ids;
}

/** This room's unsaved pop-up edits, keyed by object id. */
function dirtyContentOf(s: EditorState, roomId: string): Record<string, ObjectContent> {
  const prefix = `${roomId}:`;
  const out: Record<string, ObjectContent> = {};
  for (const key of s.dirtyContentKeys) {
    if (key.startsWith(prefix) && s.contentMap[key]) out[key.slice(prefix.length)] = s.contentMap[key];
  }
  return out;
}

export function useDraftAutosave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      // A room that leaves the dirty set was saved (Save writes the open room
      // AND every room edited earlier this session): drop its draft. Moving
      // the open room into `dirtyRoomIds` on a room switch keeps it dirty.
      const before = dirtyRoomIds(prev);
      const after = dirtyRoomIds(state);
      for (const id of before) {
        if (after.has(id)) continue;
        const cleanIid = state.allRooms[id]?.iid ?? prev.allRooms[id]?.iid;
        if (!cleanIid) continue;
        if (id === prev.currentRoomId && timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        void clearDraft(cleanIid);
      }

      // Only react to dirty edits while a room is loaded with a stable iid.
      // No iid → can't key the draft uniquely; skip until first save mints one.
      const iid = state.currentRoomConfig?.iid;
      if (!iid) return;

      // Dirty: schedule a debounced write of the latest config + pop-up edits.
      if (
        state.isDirty &&
        state.currentRoomConfig &&
        (state.currentRoomConfig !== prev.currentRoomConfig ||
          state.contentMap !== prev.contentMap ||
          state.dirtyContentKeys !== prev.dirtyContentKeys)
      ) {
        if (timerRef.current) clearTimeout(timerRef.current);
        const snapshot = state.currentRoomConfig;
        const content = dirtyContentOf(state, snapshot.id);
        timerRef.current = setTimeout(() => {
          void setDraft(iid, snapshot, content);
          timerRef.current = null;
        }, DEBOUNCE_MS);
      }
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsub();
    };
  }, []);
}
