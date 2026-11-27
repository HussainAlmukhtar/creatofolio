"use client";

import { useEffect, useCallback, useState } from "react";
import { toast } from "sonner";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { useTabPresence } from "@/lib/useTabPresence";
import { useChoiceDialog } from "./useChoiceDialog";
import { createNamedVersion, loadRoomForEditor } from "@/lib/editorData";
import { revalidatePublicPaths } from "@/lib/revalidateSite";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { useEditorStore } from "@/stores/editorStore";
import { EditorToolbar } from "./EditorToolbar";
import { EditorCanvas } from "./EditorCanvas";
import { EditorSidePanel } from "./EditorSidePanel";
import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { PreviewPanel } from "./PreviewPanel";
import { ContentEditor } from "./ContentEditor";
import { DrawModal, type DrawEditTarget } from "./DrawModal";
import { CommandPalette } from "./CommandPalette";
import { OutlinePanel } from "./OutlinePanel";
import { IssuesPanel } from "./IssuesPanel";
import { DraftRestoreBanner } from "./DraftRestoreBanner";
import { HistoryModal } from "./HistoryModal";
import { ProjectSettingsModal } from "./ProjectSettingsModal";
import { SaveErrorConfirmModal } from "./SaveErrorConfirmModal";
import { JsonInspectorPanel } from "./JsonInspectorPanel";
import { FileConflictBanner } from "./FileConflictBanner";
import { useDraftAutosave } from "@/lib/useDraftAutosave";
import { getSupabaseClient } from "@/lib/supabase/client";
import { runIntegrityCheck, type Issue } from "@/lib/integrityCheck";
import { TooltipProvider } from "@/components/editor/EditorTooltip";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useTouchMode } from "@/lib/touchMode";
import { useSessionState } from "@/lib/useSessionState";
import { useBackSwipeGuard } from "@/lib/useBackSwipeGuard";
import { SelectionActionsBar } from "./SelectionActions";
import { PanelLeft, PanelRight, SlidersHorizontal, X } from "lucide-react";
import { announce, LIVE_REGION_ID } from "@/lib/a11yAnnounce";
import { isRoomObjectLocked, showLockedHint } from "@/lib/layerLock";
import {
  deleteObjectsWithUndo,
  deleteEntryPointWithFeedback,
  toggleObjectsLockWithFeedback,
} from "@/lib/editorActions";

export default function EditorWrapper() {
  useOwnerSessionWatch();
  const {
    currentRoomId,
    loadRoom,
    editingContentObjectId,
    hydrateFromSupabase,
    showAssetLibrary,
  } = useEditorStore();
  const otherTabOpen = useTabPresence("room", currentRoomId);
  const [showPreview, setShowPreview] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drawModalState, setDrawModalState] = useState<
    { editTarget?: DrawEditTarget } | null
  >(null);
  const showDrawModal = drawModalState !== null;
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // Outline panel: VS Code Ctrl+B convention. Default visible — discoverability
  // wins over screen real-estate for a tool used minutes-at-a-time.
  // null = automatic (shown on wide screens, hidden on narrow ones); an
  // explicit toggle (Ctrl+B, palette, close button) pins the choice.
  // Compact = properties in a slide-over drawer: narrow windows, and any
  // portrait touch screen (an iPad Pro 12.9" is 1024 px wide in portrait,
  // too narrow for outline + canvas + properties side by side).
  const touch = useTouchMode();
  const portrait = useMediaQuery("(orientation: portrait)");
  const narrow = useMediaQuery("(max-width: 1023px)") || (touch && portrait);
  const [outlinePref, setOutlinePref] = useState<boolean | null>(null);
  const showOutline = outlinePref ?? !narrow;
  const setShowOutline = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      setOutlinePref((prev) => {
        const cur = prev ?? !narrow;
        return typeof v === "function" ? v(cur) : v;
      }),
    [narrow]
  );
  // Narrow screens: the properties panel is a slide-over drawer.
  const [panelOpen, setPanelOpen] = useState(false);
  // Landscape touch: the Properties panel can be hidden too (the canvas takes
  // the width). Remembered per browser tab; a desktop mouse always shows it.
  const [propsHidden, setPropsHidden] = useSessionState("room-editor:properties-hidden", false);
  const showProps = !narrow && !(touch && propsHidden);
  const selectionCount = useEditorStore((s) => s.selectedObjectIds.length);
  const [showIssues, setShowIssues] = useState(false);
  // JSON inspector. Toggled with Ctrl+J. Mounts on
  // the right side of the editor frame, before the side panel.
  const [showJsonInspector, setShowJsonInspector] = useState(false);
  // Onion-skinning. Default ON (the discoverability
  // is the whole point of this feature). Per-room dense scenes can flip it
  // off via the toolbar.
  const [showOnionSkin, setShowOnionSkin] = useState(true);
  const { undo, redo } = useEditorStore.temporal.getState();

  // Show the signed-in email so accidental
  // wrong-account edits are visible. The middleware already gates the
  // route; this is the user-facing confirmation.
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setSignedInEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedInEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load home room by default (shows the static seed instantly).
  useEffect(() => {
    if (!currentRoomId) {
      loadRoom("home");
    }
  }, [currentRoomId, loadRoom]);

  // One-shot purge of the legacy shared scratchpad IndexedDB store. Old
  // versions of the studio piled all "free draw" sessions into a single
  // `room-editor-studio` key, which leaked accumulated drawings into every
  // new draw target. The new per-target keys (studio:obj:*, studio:bg:*,
  // studio:scratch) sidestep the issue, but the legacy store would still
  // sit around taking space — delete it once and remember we did.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("studio:legacy-cleared:v2")) return;
    try {
      // Best-effort cleanup of legacy tldraw IndexedDB stores. Klecks
      // doesn't use IndexedDB at all (PSDs are persisted to Supabase
      // Storage), but old tldraw databases would otherwise sit around
      // forever taking space. Match both v2 names we used historically.
      indexedDB.deleteDatabase("TLDRAW_DOCUMENT_v2_room-editor-studio");
      indexedDB.deleteDatabase("TLDRAW_DOCUMENT_v2_studio:scratch");
    } catch {
      /* best-effort */
    }
    localStorage.setItem("studio:legacy-cleared:v2", "1");
  }, []);

  // Hydrate from Supabase once on mount — pulls saved rooms over the static
  // seed so the user actually edits their persisted data. Guard against
  // duplicate fires by checking the store's own `isHydrated` flag (only
  // flips true after a successful load). A ref guard here was previously
  // racing with React 19 strict-mode double-invoke + HMR — the ref flipped
  // true on the first invoke, the second invoke skipped, and the first
  // invoke's promise never landed, leaving the editor stuck on the static
  // seed. Hydration is idempotent so a duplicate concurrent fire is fine.
  useEffect(() => {
    if (useEditorStore.getState().isHydrated) return;
    hydrateFromSupabase()
      .then((result) => {
        // Deep link (?room=<id>) from the admin dashboard / world map. Applied
        // after hydration because loadRoom() ignores ids not yet in allRooms.
        const wanted = new URLSearchParams(window.location.search).get("room");
        const state = useEditorStore.getState();
        if (wanted && wanted !== state.currentRoomId && state.allRooms[wanted]) {
          state.loadRoom(wanted);
        }
        if (result.source === "static") {
          toast.error("Couldn't load rooms from Supabase", {
            description:
              result.error ??
              "Saves will not be kept. Check that you are signed in as the owner and that the database is set up (README, Quick start).",
            duration: 8000,
          });
        } else if (result.source === "missing") {
          toast.info("No saved rooms yet", {
            description:
              "Editing a fresh copy of the default data. First Save will create the row.",
            duration: 6000,
          });
        }
      })
      .catch((err) => {
        toast.error("Hydration failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      });
  }, [hydrateFromSupabase]);

  // Save-time integrity guard. When the current
  // room has hard errors, intercept Save and surface a confirm modal naming
  // each one. The actual upsert is deferred until the user confirms.
  const [pendingSaveErrors, setPendingSaveErrors] = useState<Issue[] | null>(
    null
  );

  // The raw save — toast-wrapped, no integrity gate. Called from `handleSave`
  // (when the room is clean) and from the confirm modal's "Save anyway".
  const { choose, dialog: choiceDialog } = useChoiceDialog();

  // `forceRoomIds`: rooms the user chose to overwrite in the conflict dialog.
  const performSave = useCallback(
    function save(forceRoomIds?: string[]) {
      const state = useEditorStore.getState();
      if (!state.currentRoomConfig) return;

      const promise = state.saveToSupabase({ forceRoomIds });
      const toastId = toast.loading("Saving…");
      promise
        .then((result) => {
          if (result.nothingToSave) return void toast.info("Nothing to save", { id: toastId });
          if (result.ok) return void toast.success("Saved", { id: toastId });
          const details = [result.roomError, ...result.contentErrors].filter(Boolean).join("; ");
          if (result.conflicts?.length && !details) {
            return void toast.warning("Some rooms were changed somewhere else and weren't saved.", {
              id: toastId,
            });
          }
          toast.error(details || "Save failed", { id: toastId });
        })
        .catch((err) =>
          toast.error(err instanceof Error ? err.message : "Save failed", { id: toastId })
        );

      // A conflict is never resolved silently: one dialog per room.
      void promise
        .then(async (result) => {
          if (!result.conflicts?.length) return;
          const force: string[] = [];
          for (const c of result.conflicts) {
            const s = useEditorStore.getState();
            const mine =
              c.roomId === s.currentRoomId ? s.currentRoomConfig : s.allRooms[c.roomId];
            if (!mine) continue;
            const when = c.theirsUpdatedAt
              ? new Date(c.theirsUpdatedAt).toLocaleString()
              : "a moment ago";
            const heldEdits = s.dirtyContentKeys.filter((k) => k.startsWith(`${c.roomId}:`)).length +
              s.pendingContentDeletes.filter((d) => d.roomId === c.roomId).length;
            const heldNote = heldEdits
              ? `\n\nKeep both discards your ${heldEdits} unsaved pop-up edit${heldEdits === 1 ? "" : "s"} for this room: pop-up content isn't kept in History. Overwrite saves them.`
              : "";
            const pick = await choose({
              title: `“${mine.name || c.roomId}” was changed somewhere else`,
              body: `Another tab or device saved this room (${when}) after you opened it.\n\nKeep both keeps your version in History as a named copy and loads the newer one. Overwrite replaces the newer one with yours (it's kept in History).${heldNote}`,
              options: [
                { id: "keep", label: "Keep both (recommended)", primary: true },
                { id: "overwrite", label: "Overwrite with mine", danger: true },
                { id: "cancel", label: "Cancel" },
              ],
            });
            const stamp = new Date().toLocaleString();
            if (pick === "keep") {
              const saved = await createNamedVersion(mine, `My copy — ${stamp}`);
              if (!saved.ok) {
                toast.error(`Couldn't keep your copy, so nothing was changed: ${saved.error}`);
                continue;
              }
              const loaded = await s.reloadRoomFromDb(c.roomId);
              if (loaded) {
                toast.success("Loaded the newer version. Yours is in History as 'My copy'.");
              } else {
                toast.error("Your copy is in History, but the newer version couldn't be loaded. Reload the page.");
              }
            } else if (pick === "overwrite") {
              const theirs = await loadRoomForEditor(c.roomId);
              if (theirs.source !== "supabase" || !theirs.config) {
                toast.error("Couldn't read the newer version to back it up, so nothing was overwritten.");
                continue;
              }
              const backup = await createNamedVersion(theirs.config, `Overwritten — ${stamp}`);
              if (!backup.ok) {
                toast.error(`Couldn't back up the newer version, so nothing was overwritten: ${backup.error}`);
                continue;
              }
              force.push(c.roomId);
            }
          }
          if (force.length) save(force);
        })
        .catch(() => undefined);
    },
    [choose]
  );

  // ─── Save with toast feedback + integrity gate ───
  const handleSave = useCallback(() => {
    const state = useEditorStore.getState();
    if (!state.currentRoomConfig || !state.currentRoomId) return;

    // Run the integrity check against the live merged map (allRooms +
    // unsaved current room) so the user is judged on what they're actually
    // about to persist, not what's last on disk. Mirrors IssuesPanel's merge.
    const merged = {
      ...state.allRooms,
      [state.currentRoomId]: state.currentRoomConfig,
    };
    const allIssues = runIntegrityCheck(merged);
    const errorsHere = allIssues.filter(
      (i) => i.severity === "error" && i.roomId === state.currentRoomId
    );

    if (errorsHere.length > 0) {
      setPendingSaveErrors(errorsHere);
      return;
    }
    performSave();
  }, [performSave]);

  // ─── Publish: draft → live ───
  // Rooms whose Publish is waiting on the integrity "Publish anyway" gate.
  const [pendingPublish, setPendingPublish] = useState<{
    roomIds: string[];
    errors: Issue[];
  } | null>(null);

  const roomLabel = (id: string) => {
    const s = useEditorStore.getState();
    const cfg = id === s.currentRoomId ? s.currentRoomConfig : s.allRooms[id];
    return cfg?.name || id;
  };

  /** Publish one room; returns true when it went live. Never throws. */
  const publishOne = useCallback(
    async (roomId: string, quiet = false): Promise<boolean> => {
      const name = roomLabel(roomId);
      const toastId = toast.loading(`Publishing “${name}”…`);
      try {
        let res = await useEditorStore.getState().publishRoom(roomId);
        if (!res.ok && res.liveChanged) {
          toast.dismiss(toastId);
          const pick = await choose({
            title: `The live “${name}” was changed somewhere else`,
            body: "The live room changed after you opened it (for example a rename or a restore in another tab). Publishing now replaces that change with your draft. The current live version is kept in History.",
            options: [
              { id: "anyway", label: "Publish anyway", danger: true },
              { id: "cancel", label: "Cancel", primary: true },
            ],
          });
          if (pick !== "anyway") return false;
          toast.loading(`Publishing “${name}”…`, { id: toastId });
          res = await useEditorStore.getState().publishRoom(roomId, { force: true });
        }
        if (res.ok) {
          if (!quiet) toast.success(`“${name}” is live.`, { id: toastId });
          else toast.dismiss(toastId);
          // The game loads client-side, so this is a no-op today; it's cheap.
          void revalidatePublicPaths(["/"]);
          return true;
        }
        if (res.nothingToPublish) toast.info("Nothing to publish.", { id: toastId });
        else toast.error(res.error ?? "Publish failed", { id: toastId });
        return false;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Publish failed", { id: toastId });
        return false;
      }
    },
    [choose]
  );

  const publishRooms = useCallback(
    async (roomIds: string[]) => {
      let done = 0;
      for (const id of roomIds) {
        if (await publishOne(id, roomIds.length > 1)) done++;
      }
      if (roomIds.length > 1) {
        if (done === roomIds.length) toast.success(`${done} rooms are live.`);
        else toast.warning(`${done} of ${roomIds.length} rooms went live.`);
      }
    },
    [publishOne]
  );

  /** Run the integrity gate over the rooms about to go live, then publish. */
  const requestPublish = useCallback(
    (roomIds: string[]) => {
      const state = useEditorStore.getState();
      if (!state.currentRoomId || roomIds.length === 0) return;
      const merged = state.currentRoomConfig
        ? { ...state.allRooms, [state.currentRoomId]: state.currentRoomConfig }
        : state.allRooms;
      const errors = runIntegrityCheck(merged).filter(
        (i) => i.severity === "error" && roomIds.includes(i.roomId)
      );
      if (errors.length > 0) {
        setPendingPublish({ roomIds, errors });
        return;
      }
      void publishRooms(roomIds);
    },
    [publishRooms]
  );

  const handlePublish = useCallback(() => {
    const id = useEditorStore.getState().currentRoomId;
    if (id) requestPublish([id]);
  }, [requestPublish]);

  const handlePublishAll = useCallback(() => {
    const s = useEditorStore.getState();
    const ids = new Set(Object.keys(s.roomDrafts));
    for (const id of s.dirtyRoomIds) ids.add(id);
    if (s.isDirty && s.currentRoomId) ids.add(s.currentRoomId);
    // A dirty room with no live row yet has no draft to publish.
    requestPublish([...ids].filter((id) => s.roomRevisions[id] != null));
  }, [requestPublish]);

  const handleDiscardDraft = useCallback(async () => {
    const s = useEditorStore.getState();
    const id = s.currentRoomId;
    if (!id || !s.roomDrafts[id]) return;
    const name = roomLabel(id);
    const pick = await choose({
      title: `Discard the draft of “${name}”?`,
      body: "Your unpublished changes to this room (including unsaved ones) are deleted for good. Visitors keep seeing the live room, and the editor goes back to it.",
      options: [
        { id: "discard", label: "Discard draft", danger: true },
        { id: "cancel", label: "Cancel", primary: true },
      ],
    });
    if (pick !== "discard") return;
    const res = await useEditorStore.getState().discardDraft(id);
    if (res.ok) toast.success(`Draft discarded. “${name}” is back to the live version.`);
    else toast.error(res.error ?? "Couldn't discard the draft");
  }, [choose]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      // Space / Enter on a focused button, link or checkbox must activate it,
      // not pan the canvas or open content.
      if (
        (e.key === " " || e.key === "Enter") &&
        (e.target as HTMLElement)?.closest?.(
          "button, a, [role=button], [role=menuitem], input[type=checkbox]"
        )
      ) {
        return;
      }
      const state = useEditorStore.getState();
      if (state.editingContentObjectId) return;
      // Let the drawing studio own all keys while it's open (Klecks
      // takes the whole iframe, including keyboard).
      if (showDrawModal) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Space = temporary pan (while held)
      if (e.code === "Space" && !ctrl && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      // Ctrl+K = command palette (Figma/VS Code/Linear convention).
      if (ctrl && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }

      // Ctrl+B = toggle outline panel (VS Code sidebar convention).
      if (ctrl && e.key === "b") {
        e.preventDefault();
        setShowOutline((v) => !v);
        return;
      }

      // Ctrl+J = toggle JSON inspector.
      if (ctrl && e.key === "j") {
        e.preventDefault();
        setShowJsonInspector((v) => !v);
        return;
      }

      // ? = open the command palette in cheat-sheet mode.
      // Same surface as Ctrl+K — every command now shows its keybinding so
      // the palette doubles as the help screen.
      if (!ctrl && e.key === "?") {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // Ctrl/Cmd+Shift+L = lock / unlock the selection (Figma's shortcut).
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const ids = useEditorStore.getState().selectedObjectIds;
        if (ids.length) toggleObjectsLockWithFeedback(ids);
        return;
      }

      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedObjectIds, selectedEntryPointId } =
          useEditorStore.getState();
        if (selectedObjectIds.length) {
          e.preventDefault();
          deleteObjectsWithUndo(selectedObjectIds);
        } else if (selectedEntryPointId) {
          e.preventDefault();
          deleteEntryPointWithFeedback(selectedEntryPointId);
        }
      } else if (e.key === "Enter" && !ctrl) {
        // Open the selected object's content (doors teleport — no content).
        const s = useEditorStore.getState();
        const obj = s.currentRoomConfig?.objects.find(
          (o) => o.id === s.selectedObjectId
        );
        if (obj && obj.type !== "door") {
          e.preventDefault();
          s.openContentEditor(obj.id);
        }
      } else if ((e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}") && !ctrl) {
        // Layer order: ] forward, [ backward; Shift = all the way.
        const s = useEditorStore.getState();
        const id = s.selectedObjectId;
        if (!id) return;
        e.preventDefault();
        if (e.key === "]") s.bringForward(id);
        else if (e.key === "[") s.sendBackward(id);
        else if (e.key === "}") s.bringToFront(id);
        else s.sendToBack(id);
        announce(
          e.key === "]" ? "Brought forward" : e.key === "[" ? "Sent backward" : e.key === "}" ? "Brought to front" : "Sent to back"
        );
      } else if (ctrl && e.key === "d") {
        e.preventDefault();
        const { selectedObjectIds, duplicateObjects } = useEditorStore.getState();
        if (selectedObjectIds.length) duplicateObjects(selectedObjectIds);
      } else if (ctrl && e.key === "a") {
        // Select every visible, unlocked object in the room.
        e.preventDefault();
        const s = useEditorStore.getState();
        const ids = (s.currentRoomConfig?.objects ?? [])
          .filter((o) => !s.hiddenObjectIds.has(o.id) && !isRoomObjectLocked(o))
          .map((o) => o.id);
        if (s.activeTool !== "select") s.setTool("select");
        s.setSelection(ids);
        announce(`Selected all ${ids.length} objects`);
      } else if (ctrl && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "g" && !ctrl) {
        useEditorStore.getState().toggleGrid();
      } else if (e.key === "s" && !ctrl) {
        useEditorStore.getState().setTool("select");
      } else if (e.key === "a" && !ctrl) {
        // Open the AddMenu popover instead of entering a tool mode.
        // EditorToolbar listens for this event and anchors the popover
        // beneath its Add button.
        e.preventDefault();
        window.dispatchEvent(new Event("editor:open-add-menu"));
      } else if (e.key === "w" && !ctrl) {
        useEditorStore.getState().setTool("walkable-area");
      } else if (e.key === "h" && !ctrl) {
        useEditorStore.getState().setTool("edit-hitbox");
      } else if (e.key === "e" && !ctrl) {
        useEditorStore.getState().setTool("entry-points");
      } else if (e.key === "l" && !ctrl) {
        useEditorStore.getState().toggleAssetLibrary();
      } else if (e.key === "d" && !ctrl) {
        setDrawModalState({});
      } else if (e.key === "p" && !ctrl) {
        setShowPreview((v) => !v);
      } else if (e.key === "Escape") {
        const s = useEditorStore.getState();
        if (s.pendingMoveToPickFor) return; // the canvas cancels the pick
        if (s.selectedObjectId) {
          s.selectObject(null);
        } else if (s.selectedEntryPointId) {
          s.selectEntryPoint(null);
        } else {
          s.setTool("select");
        }
      } else if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        const { selectedObjectIds, moveObjects, currentRoomConfig } =
          useEditorStore.getState();
        if (!selectedObjectIds.length || !currentRoomConfig) return;
        e.preventDefault();
        // Locked objects don't nudge (moveObjects skips them): say so once.
        const movable = currentRoomConfig.objects.filter(
          (o) => selectedObjectIds.includes(o.id) && !isRoomObjectLocked(o)
        );
        if (!movable.length) {
          showLockedHint(() => toggleObjectsLockWithFeedback(selectedObjectIds));
          return;
        }
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy =
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        moveObjects(selectedObjectIds, dx, dy);
      }
    },
    [undo, redo, handleSave, showDrawModal, setShowOutline]
  );

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === "Space") setSpaceHeld(false);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // iPad edge-swipe "back" skips beforeunload: guard it while anything is dirty.
  const anyDirty = useEditorStore((st) => st.isDirty || st.dirtyRoomIds.length > 0);
  useBackSwipeGuard(anyDirty);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      const st = useEditorStore.getState();
      if (st.isDirty || st.dirtyRoomIds.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  // Let any component request the drawing studio (optionally in edit mode).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ editTarget?: DrawEditTarget }>)
        .detail;
      setDrawModalState({ editTarget: detail?.editTarget });
    };
    window.addEventListener("editor:open-draw-modal", onOpen);
    return () =>
      window.removeEventListener("editor:open-draw-modal", onOpen);
  }, []);

  // Write debounced drafts to IndexedDB whenever the
  // editor is dirty; surface a banner if a stale draft is found on load.
  useDraftAutosave();

  // Simple history modal.
  const [showHistory, setShowHistory] = useState(false);
  // Project settings modal.
  const [showSettings, setShowSettings] = useState(false);

  return (
    <TooltipProvider>
    <div className="editor-root flex flex-col h-dvh bg-neutral-900 text-white overflow-hidden">
      {/* Screen-reader announcements for canvas actions (see a11yAnnounce). */}
      <div
        id={LIVE_REGION_ID}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <SessionLostBanner />
      {otherTabOpen && (
        <div
          role="status"
          className="border-b border-amber-700 bg-amber-900/30 px-3 py-1 text-center text-xs text-amber-100"
        >
          This is also open in another tab. Saving in both will conflict.
        </div>
      )}
      {choiceDialog}
      <EditorToolbar
        showPreview={showPreview}
        onTogglePreview={() => setShowPreview((v) => !v)}
        onSave={handleSave}
        onPublish={handlePublish}
        onPublishAll={handlePublishAll}
        onDiscardDraft={() => void handleDiscardDraft()}
        onOpenDrawModal={() => setDrawModalState({})}
        onOpenHistory={() => setShowHistory(true)}
        onOpenSettings={() => setShowSettings(true)}
        showOnionSkin={showOnionSkin}
        onToggleOnionSkin={() => setShowOnionSkin((v) => !v)}
        showOutline={showOutline}
        onToggleOutline={() => setShowOutline((v) => !v)}
        showProperties={showProps}
        onToggleProperties={!narrow && touch ? () => setPropsHidden((v) => !v) : undefined}
        onToggleJsonInspector={() => setShowJsonInspector((v) => !v)}
        onToggleIssues={() => setShowIssues((v) => !v)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
      />
      <DraftRestoreBanner />
      <FileConflictBanner />
      {signedInEmail && (
        <div className="pointer-events-none fixed bottom-2 left-2 z-50 rounded bg-black/40 px-2 py-0.5 text-[10px] font-mono text-white/60 backdrop-blur-sm">
          signed in as {signedInEmail}
        </div>
      )}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {showSettings && (
        <ProjectSettingsModal onClose={() => setShowSettings(false)} />
      )}
      <div className="flex flex-1 overflow-hidden">
        {showOutline && (
          <OutlinePanel onClose={() => setShowOutline(false)} />
        )}
        {showAssetLibrary && <AssetLibraryPanel />}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          {/* min-h-0: the stage must follow the editor shrinking (a banner
              appearing, Safari's toolbar changing 100dvh), not hold its height. */}
          <div className="flex-1 relative min-h-0">
            <EditorCanvas
              spacePanHeld={spaceHeld}
              showOnionSkin={showOnionSkin}
            />
            {/* Touch: right-click / shortcut actions for the selection. */}
            {touch && !(narrow && panelOpen) && <SelectionActionsBar />}
          </div>
          {/* Landscape touch: corner buttons hide / show the two side panels
              (the toolbar has no room left at iPad widths). Left = Outline,
              right = Properties; the label shows while a panel is hidden. */}
          {!narrow && touch && (
            <>
              <button
                onClick={() => setShowOutline((v) => !v)}
                className="absolute left-2 top-2 z-30 flex items-center gap-1.5 rounded-full bg-neutral-800/95 px-3 py-2 text-xs font-medium text-neutral-100 shadow-lg ring-1 ring-neutral-600 hover:bg-neutral-700"
                aria-label={showOutline ? "Hide the outline panel" : "Show the outline panel"}
                aria-pressed={showOutline}
              >
                <PanelLeft size={14} className={showOutline ? "text-sky-400" : undefined} />
                {!showOutline && "Outline"}
              </button>
              <button
                onClick={() => setPropsHidden((v) => !v)}
                className="absolute right-2 top-2 z-30 flex items-center gap-1.5 rounded-full bg-neutral-800/95 px-3 py-2 text-xs font-medium text-neutral-100 shadow-lg ring-1 ring-neutral-600 hover:bg-neutral-700"
                aria-label={propsHidden ? "Show the properties panel" : "Hide the properties panel"}
                aria-pressed={!propsHidden}
              >
                {propsHidden && "Properties"}
                {propsHidden && selectionCount > 0 && (
                  <span className="rounded-full bg-blue-600 px-1.5 text-[10px]">{selectionCount}</span>
                )}
                <PanelRight size={14} className={propsHidden ? undefined : "text-sky-400"} />
              </button>
            </>
          )}
          {narrow && !panelOpen && (
            <button
              onClick={() => setPanelOpen(true)}
              className="absolute right-2 top-2 z-30 flex items-center gap-1.5 rounded-full bg-neutral-800/95 px-3 py-2 text-xs font-medium text-neutral-100 shadow-lg ring-1 ring-neutral-600 hover:bg-neutral-700"
              aria-label="Open properties panel"
            >
              <SlidersHorizontal size={14} />
              Properties
              {selectionCount > 0 && (
                <span className="rounded-full bg-blue-600 px-1.5 text-[10px]">
                  {selectionCount}
                </span>
              )}
            </button>
          )}
          {showPreview && (
            <PreviewPanel onClose={() => setShowPreview(false)} />
          )}
          {showIssues && (
            <IssuesPanel onClose={() => setShowIssues(false)} />
          )}
        </div>
        {showJsonInspector && (
          <JsonInspectorPanel onClose={() => setShowJsonInspector(false)} />
        )}
        {showProps && <EditorSidePanel />}
      </div>

      {narrow && panelOpen && (
        <div
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label="Properties"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPanelOpen(false);
            }
          }}
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setPanelOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-0 flex h-full max-w-[92vw] flex-col bg-neutral-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-2">
              <span className="text-sm font-medium">Properties</span>
              <button
                autoFocus
                onClick={() => setPanelOpen(false)}
                className="rounded p-2 text-neutral-300 hover:bg-neutral-700"
                aria-label="Close properties panel"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex min-h-0 flex-1">
              <EditorSidePanel />
            </div>
          </div>
        </div>
      )}

      {drawModalState !== null && (
        <DrawModal
          editTarget={drawModalState.editTarget}
          onClose={() => setDrawModalState(null)}
          onLibraryUpdated={() =>
            window.dispatchEvent(new Event("editor:assets-changed"))
          }
        />
      )}

      <CommandPalette
        open={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onTogglePreview={() => setShowPreview((v) => !v)}
        onOpenDrawModal={() => setDrawModalState({})}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleIssues={() => setShowIssues((v) => !v)}
      />

      {editingContentObjectId && <ContentEditor />}

      {pendingPublish && (
        <SaveErrorConfirmModal
          verb="Publish"
          errors={pendingPublish.errors}
          onCancel={() => setPendingPublish(null)}
          onConfirm={() => {
            const ids = pendingPublish.roomIds;
            setPendingPublish(null);
            void publishRooms(ids);
          }}
        />
      )}

      {pendingSaveErrors && (
        <SaveErrorConfirmModal
          errors={pendingSaveErrors}
          onCancel={() => setPendingSaveErrors(null)}
          onConfirm={() => {
            setPendingSaveErrors(null);
            performSave();
          }}
        />
      )}
    </div>
    </TooltipProvider>
  );
}
