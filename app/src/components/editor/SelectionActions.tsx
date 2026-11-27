"use client";

// Touch (iPad) access to everything a mouse user does with a right-click or
// a shortcut on the selected object(s): Delete, Ctrl+D, [ ] { }, Enter,
// lock/hide, Ctrl+A, Esc. Rendered only in touch mode:
// - SelectionActionsBar floats over the canvas while something is selected
//   (the common actions as labelled buttons + a "⋯" menu for the rest);
// - ObjectActionsMenu is the same "⋯" menu, used on the selected Outline row.
// Every action goes through the same store calls / editorActions helpers as
// the keyboard shortcuts, so undo and toasts behave identically.

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Lock,
  PenLine,
  SquareDashedMousePointer,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { announce } from "@/lib/a11yAnnounce";
import {
  deleteEntryPointWithFeedback,
  deleteObjectsWithUndo,
  toggleObjectsLockWithFeedback,
} from "@/lib/editorActions";
import { isRoomObjectLocked } from "@/lib/layerLock";
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/overflow-menu";
import { useDialog } from "./useDialog";

/** The "⋯" items for one object (or the current multi-selection). */
function useObjectMenuItems(objectId: string | null) {
  const { prompt, dialog } = useDialog();
  const s = useEditorStore();
  const obj = s.currentRoomConfig?.objects.find((o) => o.id === objectId);
  if (!obj) return { items: [] as OverflowMenuItem[], dialog };
  const ids = s.selectedObjectIds.includes(obj.id) ? s.selectedObjectIds : [obj.id];
  const multi = ids.length > 1;
  // Lock state of the selection: "unlock" only when every one is locked.
  const locked = s.currentRoomConfig
    ? ids.every((id) => {
        const o = s.currentRoomConfig?.objects.find((x) => x.id === id);
        return o ? isRoomObjectLocked(o) : false;
      })
    : false;
  const hidden = s.hiddenObjectIds.has(obj.id);
  const layer = (fn: (id: string) => void, msg: string) => () => {
    fn(obj.id);
    announce(msg);
  };
  const items: OverflowMenuItem[] = [
    ...(!multi && obj.type !== "door"
      ? [{ label: "Edit pop-up content", icon: FileText, shortcut: "Enter", onSelect: () => s.openContentEditor(obj.id) }]
      : []),
    {
      label: "Rename…",
      icon: PenLine,
      disabled: multi,
      onSelect: () => {
        void prompt("Name shown in the editor and on hover:", obj.label || obj.id, {
          confirmLabel: "Rename",
        }).then((name) => {
          const next = name?.trim();
          if (next && next !== obj.label) s.updateObject(obj.id, { label: next });
        });
      },
    },
    { label: multi ? `Duplicate ${ids.length} objects` : "Duplicate", icon: Copy, shortcut: "Ctrl+D", onSelect: () => s.duplicateObjects(ids) },
    { kind: "separator" },
    { label: "Bring forward", icon: ChevronUp, shortcut: "]", disabled: multi, onSelect: layer(s.bringForward, "Brought forward") },
    { label: "Send backward", icon: ChevronDown, shortcut: "[", disabled: multi, onSelect: layer(s.sendBackward, "Sent backward") },
    { label: "Bring to front", icon: ArrowUpToLine, shortcut: "}", disabled: multi, onSelect: layer(s.bringToFront, "Brought to front") },
    { label: "Send to back", icon: ArrowDownToLine, shortcut: "{", disabled: multi, onSelect: layer(s.sendToBack, "Sent to back") },
    { kind: "separator" },
    {
      label: locked ? "Unlock" : "Lock in place",
      icon: locked ? Unlock : Lock,
      shortcut: "Ctrl+Shift+L",
      onSelect: () => toggleObjectsLockWithFeedback(ids),
    },
    {
      label: hidden ? "Show on canvas" : "Hide on canvas",
      icon: hidden ? Eye : EyeOff,
      onSelect: () => ids.forEach((id) => s.toggleObjectHidden(id)),
    },
    { kind: "separator" },
    {
      label: multi ? `Delete ${ids.length} objects` : "Delete",
      icon: Trash2,
      danger: true,
      shortcut: "Del",
      onSelect: () => deleteObjectsWithUndo(ids),
    },
  ];
  return { items, dialog };
}

export function ObjectActionsMenu({ objectId, triggerClassName }: { objectId: string; triggerClassName?: string }) {
  const { items, dialog } = useObjectMenuItems(objectId);
  if (!items.length) return null;
  return (
    <>
      <OverflowMenu label="Object actions" items={items} triggerClassName={triggerClassName} />
      {dialog}
    </>
  );
}

const BAR_BTN =
  "flex items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-neutral-100 hover:bg-neutral-700";

/** Floating action bar for the canvas selection (touch mode only). */
export function SelectionActionsBar() {
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const selectedEntryPointId = useEditorStore((s) => s.selectedEntryPointId);
  const primary = selectedObjectIds[selectedObjectIds.length - 1] ?? null;
  const { items, dialog } = useObjectMenuItems(primary);
  const obj = useEditorStore((s) => s.currentRoomConfig?.objects.find((o) => o.id === primary));

  if (!obj && !selectedEntryPointId) return null;
  const s = useEditorStore.getState();
  const count = selectedObjectIds.length;

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="absolute bottom-16 left-1/2 z-30 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-xl bg-neutral-800/95 p-1 shadow-xl ring-1 ring-neutral-600 backdrop-blur-sm"
    >
      {obj ? (
        <>
          <span className="max-w-[10rem] truncate px-2 text-sm text-neutral-300">
            {count > 1 ? `${count} selected` : obj.label || obj.id}
          </span>
          {count === 1 && obj.type !== "door" && (
            <button onClick={() => s.openContentEditor(obj.id)} className={BAR_BTN}>
              <FileText size={16} /> Content
            </button>
          )}
          <button onClick={() => s.duplicateObjects(selectedObjectIds)} className={BAR_BTN}>
            <Copy size={16} /> Duplicate
          </button>
          <button
            onClick={() => deleteObjectsWithUndo(selectedObjectIds)}
            className={`${BAR_BTN} text-red-300 hover:bg-red-950/60`}
          >
            <Trash2 size={16} /> Delete
          </button>
          <OverflowMenu
            label="More actions for the selection"
            triggerClassName="grid place-items-center rounded-lg text-neutral-100 hover:bg-neutral-700"
            items={[
              ...items,
              { kind: "separator" },
              {
                label: "Select all",
                icon: SquareDashedMousePointer,
                shortcut: "Ctrl+A",
                onSelect: () => {
                  const st = useEditorStore.getState();
                  const ids = (st.currentRoomConfig?.objects ?? [])
                    .filter((o) => !st.hiddenObjectIds.has(o.id) && !isRoomObjectLocked(o))
                    .map((o) => o.id);
                  st.setSelection(ids);
                  announce(`Selected all ${ids.length} objects`);
                },
              },
            ]}
          />
        </>
      ) : (
        <>
          <span className="px-2 text-sm text-neutral-300">Entry point “{selectedEntryPointId}”</span>
          <button
            onClick={() => selectedEntryPointId && deleteEntryPointWithFeedback(selectedEntryPointId)}
            className={`${BAR_BTN} text-red-300 hover:bg-red-950/60`}
          >
            <Trash2 size={16} /> Delete
          </button>
        </>
      )}
      <button
        onClick={() => {
          s.selectObject(null);
          s.selectEntryPoint(null);
        }}
        className="grid place-items-center rounded-lg text-neutral-300 hover:bg-neutral-700"
        aria-label="Deselect"
      >
        <X size={18} />
      </button>
      {dialog}
    </div>
  );
}
