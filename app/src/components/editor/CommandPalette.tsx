"use client";

// Ctrl+K command palette for the room editor — Figma/VS Code/Linear style.
// Surfaces:
//   • Room switcher           ("Switch to <room>")
//   • Tool switcher           ("Tool: select / add-object / walkable…")
//   • Top-level toggles       ("Toggle grid", "Toggle preview", etc.)
//   • Cross-room object search — type any text and we filter all
//     objects across all rooms by label / labelAr / id.
//
// It also serves as the cheat sheet. Each command shows
// its keyboard shortcut (right-aligned). "?" opens the palette so the user
// has one discovery surface, not two.

import {
  ArrowRightToLine,
  Braces,
  CirclePlus,
  Copy,
  Crosshair,
  DoorOpen,
  Eye,
  FolderOpen,
  Grid3x3,
  Hand,
  Layers,
  Library,
  Maximize2,
  MoveDiagonal2,
  MoveHorizontal,
  Palette,
  Pencil,
  Plus,
  Redo2,
  Ruler,
  Save,
  SquareDashed,
  Trash2,
  TriangleAlert,
  Undo2,
  Wrench,
  ZoomIn,
  Lock as LockIcon,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Command } from "cmdk";
import { useEditorStore } from "@/stores/editorStore";
import type { RoomId } from "@/data/roomTypes";
import { categoryEmoji, categoryLabel } from "@/lib/templateCategories";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onTogglePreview: () => void;
  onOpenDrawModal: () => void;
  onToggleOutline: () => void;
  onToggleIssues: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onTogglePreview,
  onOpenDrawModal,
  onToggleOutline,
  onToggleIssues,
}: CommandPaletteProps) {
  const allRooms = useEditorStore((s) => s.allRooms);
  const currentRoomId = useEditorStore((s) => s.currentRoomId);
  const loadRoom = useEditorStore((s) => s.loadRoom);
  const selectObject = useEditorStore((s) => s.selectObject);
  const setTool = useEditorStore((s) => s.setTool);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const toggleAssetLibrary = useEditorStore((s) => s.toggleAssetLibrary);

  // Component unmounts when `open` becomes false (see the early return below)
  // and remounts on next open, so useState naturally resets to "" each open —
  // no need for an explicit reset effect.
  const [query, setQuery] = useState("");

  // Build a flat object list across all rooms so cmdk's built-in fuzzy search
  // can rank "book in archive" against "old book", etc. Memo because allRooms
  // can be hundreds of objects and we don't want to recompute per keystroke.
  type ObjectHit = {
    roomId: string;
    roomTitle: string;
    objectId: string;
    label: string;
    labelAr: string;
    category?: string;
  };

  const objectHits: ObjectHit[] = useMemo(() => {
    const hits: ObjectHit[] = [];
    for (const [rid, cfg] of Object.entries(allRooms)) {
      for (const obj of cfg.objects) {
        hits.push({
          roomId: rid,
          roomTitle: cfg.name ?? rid,
          objectId: obj.id,
          label: obj.label || "",
          labelAr: obj.labelAr || "",
          category: obj.category,
        });
      }
    }
    return hits;
  }, [allRooms]);

  if (!open) return null;

  const handleSwitchRoom = (rid: RoomId) => {
    loadRoom(rid);
    onClose();
  };

  const handleJumpToObject = (rid: string, objectId: string) => {
    if (rid !== currentRoomId) {
      loadRoom(rid as RoomId);
      // Defer the selection so loadRoom's clear-selection effect doesn't wipe it.
      setTimeout(() => selectObject(objectId), 0);
    } else {
      selectObject(objectId);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-[10dvh]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[92vw] bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          label="Editor command palette"
          shouldFilter
          className="flex flex-col"
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            autoFocus
            placeholder="Type a command, room, or object name…"
            className="w-full px-4 py-3 bg-neutral-900 text-white text-sm border-b border-neutral-700 outline-none placeholder:text-neutral-500"
          />
          <Command.List className="max-h-[60dvh] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-4 text-xs text-neutral-500 text-center">
              No matches.
            </Command.Empty>

            <Command.Group
              heading="Rooms"
              className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide px-2 pt-2 pb-1"
            >
              {Object.entries(allRooms).map(([rid, cfg]) => (
                <Command.Item
                  key={`room-${rid}`}
                  value={`switch room ${cfg.name ?? rid} ${rid}`}
                  onSelect={() => handleSwitchRoom(rid as RoomId)}
                  className="px-2 py-1.5 rounded text-sm text-neutral-200 cursor-pointer aria-selected:bg-indigo-700/40 aria-selected:text-white flex items-center gap-2"
                >
                  <DoorOpen size={14} aria-hidden="true" className="shrink-0" />
                  <span>Switch to {cfg.name ?? rid}</span>
                  {rid === currentRoomId && (
                    <span className="ml-auto text-[10px] text-neutral-400">
                      current
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Tools"
              className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide px-2 pt-2 pb-1"
            >
              {[
                { value: "select", label: "Select tool", kbd: "S" },
                { value: "add-object", label: "Add menu", kbd: "A" },
                { value: "walkable-area", label: "Walkable Area tool", kbd: "W" },
                { value: "edit-hitbox", label: "Edit Hitbox tool", kbd: "H" },
                { value: "entry-points", label: "Entry Points tool", kbd: "E" },
              ].map((t) => (
                <Command.Item
                  key={`tool-${t.value}`}
                  value={`tool ${t.label}`}
                  onSelect={() => {
                    setTool(t.value as Parameters<typeof setTool>[0]);
                    onClose();
                  }}
                  className="px-2 py-1.5 rounded text-sm text-neutral-200 cursor-pointer aria-selected:bg-indigo-700/40 aria-selected:text-white flex items-center gap-2"
                >
                  <Wrench size={14} aria-hidden="true" className="shrink-0" />
                  <span className="flex-1">{t.label}</span>
                  <Kbd>{t.kbd}</Kbd>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group
              heading="Actions"
              className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide px-2 pt-2 pb-1"
            >
              <ActionItem
                value="toggle grid"
                icon={Grid3x3}
                label="Toggle grid"
                kbd="G"
                onSelect={() => {
                  toggleGrid();
                  onClose();
                }}
              />
              <ActionItem
                value="toggle preview"
                icon={Eye}
                label="Toggle preview panel"
                kbd="P"
                onSelect={() => {
                  onTogglePreview();
                  onClose();
                }}
              />
              <ActionItem
                value="toggle library asset templates"
                icon={Library}
                label="Toggle asset library"
                kbd="L"
                onSelect={() => {
                  toggleAssetLibrary();
                  onClose();
                }}
              />
              <ActionItem
                value="open drawing studio draw modal"
                icon={Palette}
                label="Open Drawing Studio"
                kbd="D"
                onSelect={() => {
                  onOpenDrawModal();
                  onClose();
                }}
              />
              <ActionItem
                value="toggle outline panel hierarchy"
                icon={FolderOpen}
                label="Toggle outline panel"
                kbd="Ctrl+B"
                onSelect={() => {
                  onToggleOutline();
                  onClose();
                }}
              />
              <ActionItem
                value="toggle json inspector debug"
                icon={Braces}
                label="Toggle JSON inspector"
                kbd="Ctrl+J"
                onSelect={onClose}
              />
              <ActionItem
                value="show issues panel integrity check problems errors warnings"
                icon={TriangleAlert}
                label="Show issues panel"
                kbd=""
                onSelect={() => {
                  onToggleIssues();
                  onClose();
                }}
              />
              <ActionItem
                value="save room ctrl+s"
                icon={Save}
                label="Save"
                kbd="Ctrl+S"
                onSelect={onClose}
              />
              <ActionItem
                value="undo"
                icon={Undo2}
                label="Undo"
                kbd="Ctrl+Z"
                onSelect={onClose}
              />
              <ActionItem
                value="redo"
                icon={Redo2}
                label="Redo"
                kbd="Ctrl+Y"
                onSelect={onClose}
              />
            </Command.Group>

            {/* Canvas gestures & keys — the palette doubles as the cheat sheet. */}
            <Command.Group
              heading="Canvas shortcuts"
              className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide px-2 pt-2 pb-1"
            >
              <ActionItem value="multi select shift click" icon={Plus} label="Add / remove from selection" kbd="Shift+click" onSelect={onClose} />
              <ActionItem value="box select marquee drag" icon={SquareDashed} label="Box-select (drag on empty canvas)" kbd="Drag" onSelect={onClose} />
              <ActionItem value="select all" icon={Grid3x3} label="Select all objects" kbd="Ctrl+A" onSelect={onClose} />
              <ActionItem value="cycle objects tab" icon={ArrowRightToLine} label="Cycle through objects (canvas focused)" kbd="Tab" onSelect={onClose} />
              <ActionItem value="nudge move arrow keys" icon={MoveHorizontal} label="Nudge selected (Shift = 10px)" kbd="Arrows" onSelect={onClose} />
              <ActionItem value="delete object" icon={Trash2} label="Delete (with Undo toast)" kbd="Del" onSelect={onClose} />
              <ActionItem value="duplicate object" icon={Copy} label="Duplicate" kbd="Ctrl+D" onSelect={onClose} />
              <ActionItem value="lock unlock layer in place" icon={LockIcon} label="Lock / unlock selected (can't be moved by accident)" kbd="Ctrl+Shift+L" onSelect={onClose} />
              <ActionItem value="edit content enter" icon={Pencil} label="Edit content of selected" kbd="Enter" onSelect={onClose} />
              <ActionItem value="layer forward backward bracket" icon={Layers} label="Layer forward / backward (Shift = front / back)" kbd="] / [" onSelect={onClose} />
              <ActionItem value="zoom in out plus minus" icon={ZoomIn} label="Zoom in / out" kbd="+ / −" onSelect={onClose} />
              <ActionItem value="fit room zero" icon={Maximize2} label="Fit room to view" kbd="0" onSelect={onClose} />
              <ActionItem value="frame selection f" icon={Crosshair} label="Zoom to selected object" kbd="F" onSelect={onClose} />
              <ActionItem value="pan space" icon={Hand} label="Pan (hold)" kbd="Space" onSelect={onClose} />
              <ActionItem value="drag axis lock shift" icon={Ruler} label="Lock drag to one axis" kbd="Shift+drag" onSelect={onClose} />
              <ActionItem value="resize free aspect shift" icon={MoveDiagonal2} label="Resize freely (corners keep aspect)" kbd="Shift+resize" onSelect={onClose} />
              <ActionItem value="resize from centre alt" icon={CirclePlus} label="Resize from centre" kbd="Alt+resize" onSelect={onClose} />
            </Command.Group>

            {query.trim() && (
              <Command.Group
                heading="Objects (cross-room search)"
                className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide px-2 pt-2 pb-1"
              >
                {objectHits.map((hit) => (
                  <Command.Item
                    key={`obj-${hit.roomId}-${hit.objectId}`}
                    value={`object ${hit.label} ${hit.labelAr} ${hit.objectId} ${hit.roomTitle}`}
                    onSelect={() =>
                      handleJumpToObject(hit.roomId, hit.objectId)
                    }
                    className="px-2 py-1.5 rounded text-sm text-neutral-200 cursor-pointer aria-selected:bg-indigo-700/40 aria-selected:text-white flex items-center gap-2"
                  >
                    <span>{categoryEmoji(hit.category)}</span>
                    <span className="truncate">
                      {hit.label || hit.objectId}
                    </span>
                    <span className="ml-auto text-[10px] text-neutral-500 truncate">
                      {hit.roomTitle}
                      {hit.category && ` · ${categoryLabel(hit.category)}`}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

// Small chip rendering a keyboard shortcut.
// Mirrors the Mac-style raised-key look you'd see in a `?` cheat sheet.
function Kbd({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <span className="ml-2 rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-300">
      {children}
    </span>
  );
}

// Wrapper so every Action row has the same kbd-on-the-right layout without
// repeating className/structure noise. Pure presentational — onSelect is
// passed through to cmdk so keyboard navigation still works.
function ActionItem({
  value,
  icon: Icon,
  label,
  kbd,
  onSelect,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  kbd?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="px-2 py-1.5 rounded text-sm text-neutral-200 cursor-pointer aria-selected:bg-indigo-700/40 aria-selected:text-white flex items-center gap-2"
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="flex-1">{label}</span>
      <Kbd>{kbd}</Kbd>
    </Command.Item>
  );
}
