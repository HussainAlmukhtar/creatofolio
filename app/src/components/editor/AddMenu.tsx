"use client";

// Popover invoked by the toolbar's "Add" button (or the `a` shortcut).
// Replaces the old tool-mode + sibling-<select> + click-canvas dance with a
// single one-click flow: pick what kind of thing → it lands at the visible
// canvas center, already selected.
//
// The "From Library…" row routes through the existing Asset Library panel
// (Templates tab) so the template browser stays the one place templates
// live — this menu just gives it a discoverable entry point.

import { useEffect, useRef, useState } from "react";
import { LibraryBig, Box, DoorOpen, User } from "lucide-react";
import type { AddObjectType } from "@/stores/editorStore";
import { STARTER_ELEMENTS } from "@/data/starterElements";

interface AddMenuProps {
  /** Screen-space anchor (the Add button's rect). Popover floats just below. */
  anchor: DOMRect | null;
  onClose: () => void;
  onPickFromLibrary: () => void;
}

const SUBTYPES: {
  type: AddObjectType;
  label: string;
  Icon: typeof Box;
}[] = [
  // 7c: "Stairs" removed — stairs are just doors with a stair sprite. The
  // user picks "Door" then assigns a stair sprite from the library.
  { type: "object", label: "Object", Icon: Box },
  { type: "door", label: "Door", Icon: DoorOpen },
  { type: "npc", label: "Character", Icon: User },
];

export function AddMenu({ anchor, onClose, onPickFromLibrary }: AddMenuProps) {
  const popRef = useRef<HTMLDivElement>(null);
  // While an element is being dragged out, fade the menu (removing the drag
  // source mid-drag can cancel the drag); close when the drag ends.
  const [dragging, setDragging] = useState(false);

  // Outside-click + Escape close. Skip the click that opened the menu by
  // ignoring the same tick — the toolbar's button click event has already
  // bubbled by the time this listener attaches on the next microtask.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!popRef.current) return;
      if (popRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer one tick so the opening click doesn't immediately re-close us.
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Position: pinned just under the anchor; clamped to the right edge so the
  // popover doesn't overflow the viewport when the toolbar wraps narrowly.
  const left = Math.min(
    anchor?.left ?? 16,
    typeof window !== "undefined" ? window.innerWidth - 340 - 8 : 16
  );
  const top = (anchor?.bottom ?? 0) + 4;

  const handlePickType = (type: AddObjectType) => {
    // EditorCanvas owns the viewport math (stage position + scale) so it
    // computes the visible-center room coords and calls addObject.
    window.dispatchEvent(
      new CustomEvent("editor:add-at-center", { detail: { type } })
    );
    onClose();
  };

  return (
    <div
      ref={popRef}
      role="menu"
      aria-label="Add object menu"
      className="fixed z-50 w-[340px] max-h-[80dvh] overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl"
      style={{
        left,
        top,
        opacity: dragging ? 0 : 1,
        pointerEvents: dragging ? "none" : undefined,
      }}
    >
      <button
        onClick={() => {
          onPickFromLibrary();
          onClose();
        }}
        className="w-full text-left px-3 py-2.5 hover:bg-neutral-800 transition-colors flex items-start gap-2.5 border-b border-neutral-800"
      >
        <LibraryBig size={16} className="mt-0.5 text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">From Library…</div>
          <div className="text-[11px] text-neutral-400 leading-tight mt-0.5">
            Drop a saved template (door, plant, CV panel, …) with its hitbox
            and labels pre-filled.
          </div>
        </div>
      </button>

      <div className="px-3 pt-2.5 pb-1">
        <div className="text-[11px] text-neutral-500 uppercase tracking-wide font-medium mb-1">
          New Object
        </div>
        <div className="text-[11px] text-neutral-400 leading-tight mb-2">
          Drop an untitled placeholder at the canvas center. Edit its label
          and sprite in the side panel afterwards.
        </div>
        <div className="grid grid-cols-3 gap-1.5 pb-2">
          {SUBTYPES.map((s) => {
            const Icon = s.Icon;
            return (
              <button
                key={s.type}
                onClick={() => handlePickType(s.type)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium bg-neutral-800 hover:bg-blue-600 hover:text-white text-neutral-200 transition-colors"
              >
                <Icon size={13} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Hand-drawn starter elements: click = drop at canvas centre, or
          drag onto the canvas to place exactly. */}
      <div className="px-3 pt-2 pb-3 border-t border-neutral-800">
        <div className="text-[11px] text-neutral-500 uppercase tracking-wide font-medium mb-1">
          Starter elements
        </div>
        <div className="text-[11px] text-neutral-400 leading-tight mb-2">
          Click to add, or drag onto the room. Redraw any of them later with
          “Edit Sprite in Studio”.
        </div>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Starter elements">
          {STARTER_ELEMENTS.map((el) => (
            <button
              key={el.id}
              role="menuitem"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-editor-element",
                  JSON.stringify({ id: el.id })
                );
                e.dataTransfer.effectAllowed = "copy";
                setDragging(true);
              }}
              onDragEnd={() => {
                setDragging(false);
                onClose();
              }}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("editor:add-element", { detail: { id: el.id } })
                );
                onClose();
              }}
              title={el.name}
              aria-label={`Add ${el.name}`}
              className="flex flex-col items-center gap-0.5 rounded bg-neutral-800 p-1.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG thumbnails */}
              <img src={el.url} alt="" className="h-10 w-full object-contain" draggable={false} />
              <span className="truncate w-full text-center">{el.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
