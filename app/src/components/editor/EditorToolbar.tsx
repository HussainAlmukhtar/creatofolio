"use client";

import { useEffect, useRef, useState } from "react";
import {
  MousePointer2,
  PlusSquare,
  Move,
  Square,
  MapPin,
  Grab,
  Grid2x2,
  Undo2,
  Redo2,
  Eye,
  FileJson,
  Save,
  LibraryBig,
  Brush,
  Settings,
  Layers,
  LayoutDashboard,
  Rocket,
  ChevronDown,
  Map as MapIcon,
  History,
  ListTree,
  Braces,
  AlertTriangle,
  Command,
  SlidersHorizontal,
  Play,
} from "lucide-react";
import { useTouchMode } from "@/lib/touchMode";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { useEditorStore } from "@/stores/editorStore";
import type { RoomId } from "@/data/roomTypes";
import type { EditorTool } from "@/stores/editorStore";
import { AddMenu } from "./AddMenu";
import { loadWorlds } from "@/lib/editorData";
import type { WorldConfig } from "@/data/roomTypes";
import { Tooltip } from "@/components/editor/EditorTooltip";


const TOOLS: {
  id: EditorTool;
  label: string;
  shortcut: string;
  hint: string;
  Icon: typeof MousePointer2;
}[] = [
  {
    id: "select",
    label: "Select",
    shortcut: "S",
    hint: "Select & move objects, doors, characters",
    Icon: MousePointer2,
  },
  // "add-object" used to live here as a tool mode — replaced by the AddMenu
  // popover below the toolbar (a discoverability fix). The Add button
  // is rendered separately so it can anchor the popover.
  {
    id: "walkable-area",
    label: "Walkable",
    shortcut: "W",
    hint: "Edit the polygon the player is allowed to walk inside",
    Icon: Move,
  },
  {
    id: "edit-hitbox",
    label: "Hitbox",
    shortcut: "H",
    hint: "Edit the click/collision shape of the selected object",
    Icon: Square,
  },
  {
    id: "entry-points",
    label: "Entry",
    shortcut: "E",
    hint: "Place named spawn points doors arrive at",
    Icon: MapPin,
  },
  {
    id: "pan",
    label: "Pan",
    shortcut: "Space",
    hint: "Drag the canvas around (or hold Space)",
    Icon: Grab,
  },
];

interface EditorToolbarProps {
  showPreview: boolean;
  onTogglePreview: () => void;
  onSave: () => void;
  onOpenDrawModal: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  /** Show ghosted target-room thumbnails at doors. */
  showOnionSkin: boolean;
  onToggleOnionSkin: () => void;
  /** Publish the open room's draft (saves first when dirty). */
  onPublish: () => void;
  /** Publish every room that has a draft. */
  onPublishAll: () => void;
  /** Delete the open room's draft and go back to the live room. */
  onDiscardDraft: () => void;
  /** Touch mode: panels that are otherwise keyboard-only (Ctrl+B / Ctrl+J /
   *  Ctrl+K) are reachable from the toolbar's "⋯" menu. */
  showOutline?: boolean;
  onToggleOutline?: () => void;
  /** Landscape touch: hide / show the Properties panel. */
  showProperties?: boolean;
  onToggleProperties?: () => void;
  onToggleJsonInspector?: () => void;
  onToggleIssues?: () => void;
  onOpenCommandPalette?: () => void;
}

export function EditorToolbar({
  showPreview,
  onTogglePreview,
  onSave,
  onOpenDrawModal,
  onOpenHistory,
  onOpenSettings,
  showOnionSkin,
  onToggleOnionSkin,
  onPublish,
  onPublishAll,
  onDiscardDraft,
  showOutline,
  onToggleOutline,
  showProperties,
  onToggleProperties,
  onToggleJsonInspector,
  onToggleIssues,
  onOpenCommandPalette,
}: EditorToolbarProps) {
  // Touch (iPad): Save / Undo / Redo / Publish and the tools stay visible;
  // less-used tools move into one "⋯" menu so the bar doesn't wrap into
  // three rows of 44 px buttons. Desktop keeps every button inline.
  const touch = useTouchMode();
  const {
    currentRoomId,
    loadRoom,
    activeTool,
    setTool,
    gridEnabled,
    toggleGrid,
    gridSize,
    setGridSize,
    isDirty,
    currentRoomConfig,
    showAssetLibrary,
    toggleAssetLibrary,
    allRooms,
    dirtyRoomIds,
    draftsAvailable,
    roomDrafts,
  } = useEditorStore();

  // Drafts: Save keeps changes private; Publish makes them live.
  const hasDraft = !!currentRoomId && !!roomDrafts[currentRoomId];
  const draftRoomCount = Object.keys(roomDrafts).length;
  const canPublish = hasDraft || isDirty;
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  // Play the real game with the saved drafts, in a new tab, starting here.
  // Unsaved edits aren't in the draft yet: Save first.
  const playDraft = () => {
    const q = currentRoomId ? `?room=${encodeURIComponent(currentRoomId)}` : "";
    window.open(`/admin/play${q}`, "_blank", "noopener");
  };

  // Live room list (was a hard-coded list of the 8 seed rooms, so rooms
  // created in the World map never showed up here). Sorted by name.
  const roomOptions = Object.values(allRooms)
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  const unsavedCount = (isDirty ? 1 : 0) + dirtyRoomIds.length;

  // Group the picker by world once there's more than one.
  const [worlds, setWorlds] = useState<WorldConfig[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadWorlds().then((w) => {
      if (!cancelled) setWorlds(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const mainIid = worlds.find((w) => w.id === "main")?.iid;
  const roomGroups =
    worlds.length > 1
      ? worlds
          .map((w) => ({
            label: w.name,
            rooms: roomOptions.filter((r) =>
              r.worldIid ? r.worldIid === w.iid : w.iid === mainIid
            ),
          }))
          .filter((g) => g.rooms.length > 0)
      : null;

  // AddMenu anchor + open state — popover is positioned just below this button.
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);

  const openAddMenu = () => {
    if (!addBtnRef.current) return;
    setAddAnchor(addBtnRef.current.getBoundingClientRect());
    setAddMenuOpen(true);
  };

  // Allow EditorWrapper's `a` shortcut to open the menu without threading
  // state through props. The same listener also handles a programmatic open
  // from the command palette in the future.
  useEffect(() => {
    const onOpen = () => openAddMenu();
    window.addEventListener("editor:open-add-menu", onOpen);
    return () => window.removeEventListener("editor:open-add-menu", onOpen);
  }, []);

  const handlePickFromLibrary = () => {
    if (!showAssetLibrary) {
      // Default tab is "templates" — opening the panel lands the user there.
      toggleAssetLibrary();
    } else {
      // Already open: nudge the panel to focus its Templates tab.
      window.dispatchEvent(new Event("editor:focus-templates-tab"));
    }
  };

  const { undo, redo, pastStates, futureStates } =
    useEditorStore.temporal.getState();
  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  const handleExportJSON = () => {
    if (!currentRoomConfig) return;
    const json = JSON.stringify(currentRoomConfig, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentRoomConfig.id}-room.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-neutral-800 border-b border-neutral-700 text-sm flex-shrink-0 flex-wrap">
      {/* Back to the admin dashboard. A plain <a> (full navigation) so the
          unsaved-changes beforeunload guard still fires. */}
      <Tooltip label="Admin dashboard">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
        <a
          href="/admin"
          className="p-1.5 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          aria-label="Back to admin dashboard"
        >
          <LayoutDashboard size={16} />
        </a>
      </Tooltip>

      {!touch && (<>
      <div className="w-px h-6 bg-neutral-600" />

      {/* Asset Library toggle */}
      <Tooltip label="Asset Library — sprites & templates" shortcut="L">
        <button
          onClick={toggleAssetLibrary}
          className={`p-1.5 rounded transition-colors ${
            showAssetLibrary
              ? "bg-blue-600 text-white"
              : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          }`}
          aria-label="Toggle asset library"
        >
          <LibraryBig size={16} />
        </button>
      </Tooltip>

      {/* Drawing Studio */}
      <Tooltip label="Drawing Studio — Klecks editor for sprites & backgrounds" shortcut="D">
        <button
          onClick={onOpenDrawModal}
          className="p-1.5 rounded transition-colors bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          aria-label="Open drawing studio"
        >
          <Brush size={16} />
        </button>
      </Tooltip>

      <div className="w-px h-6 bg-neutral-600" />

      {/* World view */}
      <Tooltip label="World map — arrange rooms in space">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
        <a
          href="/admin/editor/world"
          className="p-1.5 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          aria-label="Open world view"
        >
          <MapIcon size={14} aria-hidden="true" />
        </a>
      </Tooltip>

      {/* History */}
      <Tooltip label="Backup history — restore a previous save (rolling 20)">
        <button
          onClick={onOpenHistory}
          className="p-1.5 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600 text-xs"
          aria-label="Open backup history"
        >
          <History size={14} aria-hidden="true" />
        </button>
      </Tooltip>

      {/* Project Settings */}
      <Tooltip label="Project settings — world layout, file sync, defaults">
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          aria-label="Open project settings"
        >
          <Settings size={16} />
        </button>
      </Tooltip>
      </>)}

      <div className="w-px h-6 bg-neutral-600" />

      {/* Room selector */}
      <Tooltip label="Switch the room being edited">
        <select
          value={currentRoomId ?? ""}
          onChange={(e) => loadRoom(e.target.value as RoomId)}
          className="bg-neutral-700 text-white rounded px-2 py-1 text-sm border border-neutral-600"
        >
          {roomGroups
            ? roomGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {dirtyRoomIds.includes(r.id) ? "● " : roomDrafts[r.id] ? "◆ " : ""}
                      {r.name || r.id}
                    </option>
                  ))}
                </optgroup>
              ))
            : roomOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {dirtyRoomIds.includes(r.id) ? "● " : roomDrafts[r.id] ? "◆ " : ""}
                  {r.name || r.id}
                </option>
              ))}
        </select>
      </Tooltip>

      <div className="w-px h-6 bg-neutral-600" />

      {/* Add button — opens AddMenu popover. Not a tool mode; one
          click from here drops a placeholder at the canvas center. */}
      <Tooltip label="Add — drop an object, door, character or template" shortcut="A">
        <button
          ref={addBtnRef}
          onClick={openAddMenu}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
            addMenuOpen
              ? "bg-blue-600 text-white"
              : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          }`}
        >
          <PlusSquare size={14} />
          <span>Add</span>
        </button>
      </Tooltip>

      {/* Tools */}
      {TOOLS.map((tool) => {
        const Icon = tool.Icon;
        return (
          <Tooltip key={tool.id} label={tool.hint} shortcut={tool.shortcut}>
            <button
              onClick={() => setTool(tool.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                activeTool === tool.id
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
              }`}
            >
              <Icon size={14} />
              <span>{tool.label}</span>
            </button>
          </Tooltip>
        );
      })}

      {!touch && <div className="w-px h-6 bg-neutral-600" />}

      {/* Grid */}
      {!touch && (
      <Tooltip label="Snap-to-grid — useful for tiled backgrounds" shortcut="G">
        <button
          onClick={toggleGrid}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
            gridEnabled
              ? "bg-green-700 text-white"
              : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          }`}
        >
          <Grid2x2 size={14} />
          <span>Grid</span>
        </button>
      </Tooltip>
      )}
      {gridEnabled && (
        <Tooltip label="Grid cell size, in pixels (8–128)">
          <input
            type="number"
            value={gridSize}
            onChange={(e) => setGridSize(parseInt(e.target.value) || 32)}
            className="w-12 bg-neutral-700 text-white rounded px-1 py-1 text-xs border border-neutral-600"
            min={8}
            max={128}
            step={8}
          />
        </Tooltip>
      )}

      <div className="flex-1" />

      {/* Undo / Redo */}
      <Tooltip label="Undo" shortcut="Ctrl+Z">
        <button
          onClick={() => undo()}
          disabled={!canUndo}
          className="p-1.5 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Undo"
        >
          <Undo2 size={14} />
        </button>
      </Tooltip>
      <Tooltip label="Redo" shortcut="Ctrl+Shift+Z">
        <button
          onClick={() => redo()}
          disabled={!canRedo}
          className="p-1.5 rounded bg-neutral-700 text-neutral-300 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Redo"
        >
          <Redo2 size={14} />
        </button>
      </Tooltip>

      {!touch && (<>
      <div className="w-px h-6 bg-neutral-600" />

      <Tooltip label="Onion-skin — show ghosted previews of where each door leads">
        <button
          onClick={onToggleOnionSkin}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
            showOnionSkin
              ? "bg-purple-600 text-white"
              : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          }`}
          aria-label="Toggle onion-skin door previews"
        >
          <Layers size={14} />
        </button>
      </Tooltip>

      <Tooltip label="Live Phaser preview of this room" shortcut="P">
        <button
          onClick={onTogglePreview}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
            showPreview
              ? "bg-indigo-600 text-white"
              : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
          }`}
        >
          <Eye size={14} />
          <span>Preview</span>
        </button>
      </Tooltip>

      <Tooltip label="Download this room's full config as a JSON file">
        <button
          onClick={handleExportJSON}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
        >
          <FileJson size={14} />
          <span>Export</span>
        </button>
      </Tooltip>
      </>)}

      <Tooltip
        label={
          dirtyRoomIds.length
            ? `Save this room + ${dirtyRoomIds.length} other edited room${dirtyRoomIds.length === 1 ? "" : "s"}`
            : draftsAvailable
              ? "Save a draft — visitors keep seeing the live room until you Publish"
              : "Save to Supabase"
        }
        shortcut="Ctrl+S"
      >
        <button
          onClick={onSave}
          disabled={unsavedCount === 0}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-700 text-white hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={14} />
          <span>{draftsAvailable ? "Save draft" : "Save"}</span>
        </button>
      </Tooltip>

      {draftsAvailable && (
        <>
          <span
            className={`text-xs ${hasDraft ? "text-sky-300" : "text-neutral-400"}`}
            data-testid="room-draft-status"
          >
            {hasDraft ? "Draft — visitors still see the live room" : "Live"}
          </span>
          <div className="relative flex items-stretch">
            <Tooltip label="Make this room's saved draft live for visitors">
              <button
                onClick={onPublish}
                disabled={!canPublish}
                className="flex items-center gap-1 rounded-l px-2 py-1 text-xs font-medium bg-sky-700 text-white hover:bg-sky-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Rocket size={14} />
                <span>{canPublish ? "Publish" : "Live"}</span>
              </button>
            </Tooltip>
            <button
              onClick={() => setPublishMenuOpen((v) => !v)}
              className="rounded-r border-l border-sky-900 bg-sky-700 px-1 text-white hover:bg-sky-600"
              aria-label="More publish options"
              aria-haspopup="menu"
              aria-expanded={publishMenuOpen}
            >
              <ChevronDown size={14} />
            </button>
            {publishMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPublishMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[230px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-xl"
                >
                  <button
                    role="menuitem"
                    disabled={draftRoomCount === 0}
                    onClick={() => {
                      setPublishMenuOpen(false);
                      onPublishAll();
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Publish all rooms with drafts{draftRoomCount ? ` (${draftRoomCount})` : ""}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setPublishMenuOpen(false);
                      playDraft();
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
                    data-testid="play-draft-menu"
                  >
                    Play the draft (new tab)
                  </button>
                  <button
                    role="menuitem"
                    disabled={!hasDraft}
                    onClick={() => {
                      setPublishMenuOpen(false);
                      onDiscardDraft();
                    }}
                    className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Discard draft of this room…
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {unsavedCount > 0 && (
        <span className="text-yellow-400 text-xs font-medium">
          Unsaved{unsavedCount > 1 ? ` (${unsavedCount} rooms)` : ""}
        </span>
      )}

      {touch && (
        <OverflowMenu
          label="More tools"
          triggerClassName="grid place-items-center rounded bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
          items={[
            { kind: "label", label: "Panels" },
            { label: "Asset library", icon: LibraryBig, checked: showAssetLibrary, shortcut: "L", onSelect: toggleAssetLibrary },
            onToggleOutline && { label: "Outline", icon: ListTree, checked: showOutline, shortcut: "Ctrl+B", onSelect: onToggleOutline },
            onToggleProperties && { label: "Properties", icon: SlidersHorizontal, checked: showProperties, onSelect: onToggleProperties },
            { label: "Live preview", icon: Eye, checked: showPreview, shortcut: "P", onSelect: onTogglePreview },
            onToggleIssues && { label: "Issues", icon: AlertTriangle, onSelect: onToggleIssues },
            onToggleJsonInspector && { label: "JSON inspector", icon: Braces, shortcut: "Ctrl+J", onSelect: onToggleJsonInspector },
            { kind: "separator" },
            { kind: "label", label: "Canvas" },
            { label: "Snap to grid", icon: Grid2x2, checked: gridEnabled, shortcut: "G", onSelect: toggleGrid },
            { label: "Door previews (onion-skin)", icon: Layers, checked: showOnionSkin, onSelect: onToggleOnionSkin },
            { kind: "separator" },
            { label: "Drawing Studio", icon: Brush, shortcut: "D", onSelect: onOpenDrawModal },
            {
              label: "World map",
              icon: MapIcon,
              // Full navigation keeps the unsaved-changes guard.
              onSelect: () => window.location.assign("/admin/editor/world"),
            },
            { label: "Play draft (new tab)", icon: Play, onSelect: playDraft },
            { label: "Backup history", icon: History, onSelect: onOpenHistory },
            { label: "Project settings", icon: Settings, onSelect: onOpenSettings },
            { label: "Export room JSON", icon: FileJson, onSelect: handleExportJSON },
            onOpenCommandPalette && { kind: "separator" },
            onOpenCommandPalette && { label: "All commands…", icon: Command, shortcut: "Ctrl+K", onSelect: onOpenCommandPalette },
          ]}
        />
      )}

      {addMenuOpen && (
        <AddMenu
          anchor={addAnchor}
          onClose={() => setAddMenuOpen(false)}
          onPickFromLibrary={handlePickFromLibrary}
        />
      )}
    </div>
  );
}
