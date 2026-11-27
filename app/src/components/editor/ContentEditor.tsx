"use client";

// ContentEditor — the room editor's pop-up builder for the selected object
// ("Edit pop-up", Enter, the touch selection bar). A thin host around the
// shared PopupComposer: edits write through to the editor store
// (updateContent → dirtyContentKeys → Save writes the room draft, exactly like
// any other edit), and "Revert" restores the object's pop-up AND its dirty
// flag as they were when the composer opened.

import { useState } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { PopupComposer } from "@/components/popup-editor/PopupComposer";

export function ContentEditor() {
  const objectId = useEditorStore((s) => s.editingContentObjectId);
  const roomId = useEditorStore((s) => s.currentRoomId);
  const obj = useEditorStore((s) => s.currentRoomConfig?.objects.find((o) => o.id === s.editingContentObjectId));
  if (!objectId || !roomId || !obj) return null;
  return (
    <RoomPopupComposer
      key={`${roomId}:${objectId}`}
      objectId={objectId}
      roomId={roomId}
      label={{ en: obj.label ?? "", ar: obj.labelAr ?? "" }}
    />
  );
}

function RoomPopupComposer({
  objectId,
  roomId,
  label,
}: {
  objectId: string;
  roomId: string;
  label: { en: string; ar: string };
}) {
  const key = `${roomId}:${objectId}`;
  // What Revert goes back to: the pop-up and its dirty flag at open time.
  const [snapshot] = useState(() => ({
    content: readContent(key),
    dirty: useEditorStore.getState().dirtyContentKeys.includes(key),
  }));
  const updateContent = useEditorStore((s) => s.updateContent);
  const restoreContent = useEditorStore((s) => s.restoreContent);
  const closeContentEditor = useEditorStore((s) => s.closeContentEditor);

  return (
    <PopupComposer
      objectId={objectId}
      roomId={roomId}
      objectLabel={label}
      initial={snapshot.content}
      theme="game"
      pages={null}
      host="room"
      onChange={(c) => updateContent(objectId, c)}
      onRevert={() => restoreContent(objectId, snapshot.content, snapshot.dirty)}
      onClose={closeContentEditor}
    />
  );
}

function readContent(key: string) {
  return useEditorStore.getState().contentMap[key] ?? null;
}
