"use client";

// Outline panel — Unity Hierarchy / VS Code Sidebar / LDtk Level list.
// One scannable list of every room and the objects inside the current room.
// Clicking a room switches scenes; clicking an object selects + (eventually)
// centers the canvas on it.
//
// Lives on the LEFT of the editor (`Ctrl+B` toggles). The right `EditorSidePanel`
// continues to show details for the *selected* object — this panel answers
// "what's in this world" instead of "what is this object".

import { useState, type CSSProperties } from "react";
import {
  ChevronDown,
  ChevronRight,
  X,
  MapPin,
  Box,
  Flag,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditorStore } from "@/stores/editorStore";
import type { RoomId, RoomObject } from "@/data/roomTypes";
import { categoryEmoji, categoryHex } from "@/lib/templateCategories";
import { Tooltip } from "@/components/editor/EditorTooltip";
import { useTouchMode } from "@/lib/touchMode";
import { ObjectActionsMenu } from "./SelectionActions";
import { isRoomObjectLocked } from "@/lib/layerLock";
import { toggleObjectsLockWithFeedback } from "@/lib/editorActions";

interface OutlinePanelProps {
  onClose: () => void;
}

const effDepth = (o: RoomObject): number => o.zIndex ?? o.y;

interface ObjectRowProps {
  obj: RoomObject;
  isSel: boolean;
  isHidden: boolean;
  isLocked: boolean;
  isCurrent: boolean;
  draggable: boolean;
  onClick: (e: React.MouseEvent) => void;
  onToggleLocked: () => void;
  onToggleHidden: () => void;
}

function ObjectRow({
  obj,
  isSel,
  isHidden,
  isLocked,
  isCurrent,
  draggable,
  onClick,
  onToggleLocked,
  onToggleHidden,
}: ObjectRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: obj.id, disabled: !draggable });
  // Touch: no hover, so the lock/hide icons only show when active and the
  // selected row gets a "⋯" menu with every object action instead.
  const touch = useTouchMode();

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`group/row flex items-center gap-1 px-1 py-0.5 rounded ${
        isHidden
          ? "cursor-default text-neutral-600 line-through"
          : isSel
            ? "bg-indigo-700/40 text-white cursor-pointer"
            : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
      }`}
      title={obj.id}
      {...attributes}
    >
      {draggable && (
        <button
          type="button"
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="p-0.5 -ml-0.5 text-neutral-600 opacity-0 group-hover/row:opacity-100 touch:opacity-100 touch:touch-none hover:text-neutral-300 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder layer"
        >
          <GripVertical size={10} />
        </button>
      )}
      {obj.category ? (
        <span className="text-[10px]">{categoryEmoji(obj.category)}</span>
      ) : (
        <Box size={10} />
      )}
      <span className="truncate flex-1">{obj.label || obj.id}</span>
      {obj.zIndex != null && (
        <span
          className="text-[8px] text-amber-400/70"
          title={`Depth pinned at ${obj.zIndex}`}
        >
          ●
        </span>
      )}
      {obj.category && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            backgroundColor: categoryHex(obj.category),
          }}
        />
      )}
      {isCurrent && (
        <>
          <Tooltip
            label={
              isLocked
                ? "Unlock — it can be moved on the canvas again"
                : "Lock in place — can't be moved by accident"
            }
            shortcut="Ctrl+Shift+L"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleLocked();
              }}
              aria-pressed={isLocked}
              className={`p-0.5 rounded hover:bg-neutral-700 touch:grid touch:place-items-center ${
                isLocked
                  ? "text-sky-400 opacity-100"
                  : "text-neutral-500 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 touch:opacity-100"
              }`}
              aria-label={
                isLocked
                  ? `Unlock ${obj.label || obj.id}`
                  : `Lock ${obj.label || obj.id}`
              }
            >
              {isLocked ? <Lock size={10} /> : <Unlock size={10} />}
            </button>
          </Tooltip>
          <Tooltip
            label={
              isHidden
                ? "Show on canvas"
                : "Hide on canvas (still saved in the room)"
            }
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleHidden();
              }}
              className={`p-0.5 rounded hover:bg-neutral-700 ${
                isHidden
                  ? "text-neutral-300 opacity-100"
                  : "text-neutral-500 opacity-0 group-hover/row:opacity-100 touch:hidden"
              }`}
              aria-label={
                isHidden
                  ? `Show ${obj.label || obj.id}`
                  : `Hide ${obj.label || obj.id}`
              }
            >
              {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
            </button>
          </Tooltip>
          {touch && isSel && (
            <span onClick={(e) => e.stopPropagation()}>
              <ObjectActionsMenu
                objectId={obj.id}
                triggerClassName="grid place-items-center rounded text-neutral-200 hover:bg-neutral-700"
              />
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function OutlinePanel({ onClose }: OutlinePanelProps) {
  const allRooms = useEditorStore((s) => s.allRooms);
  const roomDrafts = useEditorStore((s) => s.roomDrafts);
  const currentRoomId = useEditorStore((s) => s.currentRoomId);
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  const toggleObjectSelection = useEditorStore((s) => s.toggleObjectSelection);
  const selectedEntryPointId = useEditorStore((s) => s.selectedEntryPointId);
  const loadRoom = useEditorStore((s) => s.loadRoom);
  const selectObject = useEditorStore((s) => s.selectObject);
  const selectEntryPoint = useEditorStore((s) => s.selectEntryPoint);
  const hiddenObjectIds = useEditorStore((s) => s.hiddenObjectIds);
  const toggleObjectHidden = useEditorStore((s) => s.toggleObjectHidden);
  const reorderObjects = useEditorStore((s) => s.reorderObjects);

  // Pointer activation distance avoids hijacking single-click selection — drag
  // only kicks in once the cursor moves a few px past mousedown.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Track per-room expansion so the user can keep multiple rooms open and
  // scan adjacent ones without losing state. Default: only current room open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const isExpanded = (rid: string) =>
    expanded[rid] ?? rid === currentRoomId;

  const toggle = (rid: string) =>
    setExpanded((prev) => ({ ...prev, [rid]: !isExpanded(rid) }));

  const handleRoomClick = (rid: string) => {
    if (rid !== currentRoomId) {
      loadRoom(rid as RoomId);
    }
    setExpanded((prev) => ({ ...prev, [rid]: true }));
  };

  const handleObjectClick = (objectId: string, rid: string) => {
    if (rid !== currentRoomId) {
      loadRoom(rid as RoomId);
      // Defer so loadRoom's clear-selection effect runs first.
      setTimeout(() => selectObject(objectId), 0);
    } else {
      selectObject(objectId);
    }
  };

  const handleEntryPointClick = (epId: string, rid: string) => {
    if (rid !== currentRoomId) {
      loadRoom(rid as RoomId);
      setTimeout(() => selectEntryPoint(epId), 0);
    } else {
      selectEntryPoint(epId);
    }
  };

  return (
    <aside className="w-56 touch:w-72 bg-neutral-900 border-r border-neutral-700 flex flex-col overflow-hidden flex-shrink-0">
      <header className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <h2 className="text-sm font-medium">Outline</h2>
        <Tooltip label="Hide outline" shortcut="Ctrl+B">
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-neutral-700 text-neutral-300"
            aria-label="Close outline panel"
          >
            <X size={14} />
          </button>
        </Tooltip>
      </header>

      <div className="flex-1 overflow-y-auto p-1.5 text-xs">
        {Object.entries(allRooms).map(([rid, cfg]) => {
          // For non-current rooms we read the static-or-cached config.
          // Current room reads currentRoomConfig so it reflects unsaved edits.
          const liveCfg =
            rid === currentRoomId && currentRoomConfig
              ? currentRoomConfig
              : cfg;
          const isCurrent = rid === currentRoomId;
          const open = isExpanded(rid);

          // Sort by effective depth descending — top of list = highest depth
          // = renders on top, matching the Photoshop layers convention.
          const sortedObjects = [...liveCfg.objects].sort(
            (a, b) => effDepth(b) - effDepth(a)
          );
          const ids = sortedObjects.map((o) => o.id);

          const handleDragEnd = (e: DragEndEvent) => {
            if (!e.over || e.active.id === e.over.id) return;
            const oldIndex = ids.indexOf(e.active.id as string);
            const newIndex = ids.indexOf(e.over.id as string);
            if (oldIndex < 0 || newIndex < 0) return;
            const next = arrayMove(ids, oldIndex, newIndex);
            reorderObjects(next);
          };

          return (
            <div key={rid} className="mb-0.5">
              <div
                className={`flex items-center gap-1 px-1 py-1 rounded cursor-pointer ${
                  isCurrent
                    ? "bg-indigo-700/30 text-white"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
                onClick={() => handleRoomClick(rid)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(rid);
                  }}
                  className="p-0.5 hover:bg-neutral-700 rounded"
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                </button>
                <MapPin size={11} />
                <span className="truncate flex-1">{liveCfg.name ?? rid}</span>
                {roomDrafts[rid] && (
                  <span
                    className="text-[10px] text-sky-400"
                    title="Unpublished draft: visitors still see the live room"
                    aria-label="Unpublished draft"
                  >
                    ◆
                  </span>
                )}
                <span className="text-[9px] text-neutral-500">
                  {liveCfg.objects.length}
                </span>
              </div>

              {open && (
                <div className="ml-4 border-l border-neutral-800 pl-1.5 mt-0.5">
                  {sortedObjects.length === 0 ? (
                    <div className="text-[10px] text-neutral-600 italic px-1 py-1">
                      No objects
                    </div>
                  ) : isCurrent ? (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={ids}
                        strategy={verticalListSortingStrategy}
                      >
                        {sortedObjects.map((obj) => {
                          const isSel = selectedObjectIds.includes(obj.id);
                          const isHidden = hiddenObjectIds.has(obj.id);
                          const isLocked = isRoomObjectLocked(obj);
                          return (
                            <ObjectRow
                              key={obj.id}
                              obj={obj}
                              isSel={isSel}
                              isHidden={isHidden}
                              isLocked={isLocked}
                              isCurrent={true}
                              // Re-ordering the stack is allowed while locked.
                              draggable={!isHidden}
                              onClick={(e) => {
                                if (isHidden) return;
                                // Shift/Ctrl/Cmd adds to the selection.
                                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                  toggleObjectSelection(obj.id);
                                  return;
                                }
                                handleObjectClick(obj.id, rid);
                              }}
                              onToggleLocked={() => toggleObjectsLockWithFeedback([obj.id])}
                              onToggleHidden={() => toggleObjectHidden(obj.id)}
                            />
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  ) : (
                    sortedObjects.map((obj) => (
                      <ObjectRow
                        key={obj.id}
                        obj={obj}
                        isSel={false}
                        isHidden={false}
                        isLocked={false}
                        isCurrent={false}
                        draggable={false}
                        onClick={() => handleObjectClick(obj.id, rid)}
                        onToggleLocked={() => {}}
                        onToggleHidden={() => {}}
                      />
                    ))
                  )}

                  {liveCfg.entryPoints.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-neutral-800">
                      {liveCfg.entryPoints.map((ep) => {
                        const isSel =
                          selectedEntryPointId === ep.id && isCurrent;
                        return (
                          <div
                            key={ep.id}
                            onClick={() => handleEntryPointClick(ep.id, rid)}
                            className={`flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer ${
                              isSel
                                ? "bg-amber-700/40 text-white"
                                : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
                            }`}
                            title={`Entry point ${ep.id}`}
                          >
                            <Flag size={10} />
                            <span className="truncate text-[10px]">
                              {ep.id}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
