"use client";

// LandingEditorWrapper — top-level shell for /admin/landing-editor. Mirrors the
// room editor's EditorWrapper: hydrate-on-mount with source toasts, a toolbar
// with toast-wrapped Save + undo/redo + language preview, keyboard shortcuts,
// a beforeunload dirty guard, and IndexedDB draft autosave + restore banner.
//
// Layout: Pages | Sections | Canvas | Side panel.

import { useCallback, useEffect, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { toast } from "sonner";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { useTabPresence } from "@/lib/useTabPresence";
import { useChoiceDialog } from "@/components/editor/useChoiceDialog";
import { loadLandingVersion, recordPageBackup } from "@/lib/landingEditorData";
import { SiteConflictDialog } from "./SiteConflictDialog";
import { SiteChangesPill } from "./SiteChangesPill";
import { LandingContentEditor } from "./LandingContentEditor";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { LIVE_REGION_ID } from "@/lib/a11yAnnounce";
import { removeAssetWithUndo, toggleSelectionLock } from "@/lib/landingEditorActions";
import { isAssetLocked, isMachineLocked, showLockedHint } from "@/lib/layerLock";
import { useLandingEditorStore, selectCurrentPage, versionState } from "@/stores/landingEditorStore";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { useLandingStore } from "@/stores/landingStore";
import { useLandingDraftAutosave } from "@/lib/useLandingDraftAutosave";
import { Button } from "@/components/ui/button";
import { Monitor, Smartphone, Globe, History, Eye, Undo2, Redo2, Check, Rocket, EyeOff, LayoutDashboard, PanelTop, PanelLeft, PanelRight, ListTree, SlidersHorizontal, X } from "lucide-react";
import { useTouchMode } from "@/lib/touchMode";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useSessionState } from "@/lib/useSessionState";
import { useBackSwipeGuard } from "@/lib/useBackSwipeGuard";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { LandingDraftRestoreBanner } from "./LandingDraftRestoreBanner";
import { PageSwitcher } from "./PageSwitcher";
import { VersionSwitcher } from "./VersionSwitcher";
import { LandingSectionOutline } from "./LandingSectionOutline";
import { LandingEditorCanvas } from "./LandingEditorCanvas";
import { LandingSidePanel } from "./LandingSidePanel";
import { SiteSettingsPanel } from "./SiteSettingsPanel";
import { NavStudio } from "./nav/NavStudio";
import { LandingHistoryDialog } from "./LandingHistoryDialog";
import { ChecksButton } from "./ChecksPanel";
import { runLandingChecks, formatIssuesText } from "./useLandingChecks";
import { writePreviewHandoff } from "@/lib/landingPreviewHandoff";
import { newIid } from "@/lib/iid";
import type { DrawnAsset } from "@/data/landingTypes";
import type { ObjectContent } from "@/data/contentTypes";
import { ARCADE_MACHINE_IID, machinePlacement, resolveArcade } from "@/data/arcadeConfig";

// Ctrl+C / Ctrl+V element clipboard. Module-level so it survives switching
// pages in the editor (paste an element onto another page).
let assetClipboard: DrawnAsset | null = null;

export default function LandingEditorWrapper() {
  useOwnerSessionWatch();
  const hydrateFromSupabase = useLandingEditorStore((s) => s.hydrateFromSupabase);
  const isDirty = useLandingEditorStore((s) => s.isDirty);
  const setNavStudioOpen = useSiteConfigEditorStore((s) => s.setNavStudioOpen);
  const previewLanguage = useLandingEditorStore((s) => s.previewLanguage);
  const setPreviewLanguage = useLandingEditorStore((s) => s.setPreviewLanguage);
  const deviceMode = useLandingEditorStore((s) => s.deviceMode);
  const setDeviceMode = useLandingEditorStore((s) => s.setDeviceMode);
  const [siteSettingsOpen, setSiteSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasPage = useLandingEditorStore((s) => s.currentPageSlug !== null);
  const presenceId = useLandingEditorStore((s) => {
    const slug = s.currentPageSlug;
    return slug ? `${slug}:${s.allPages[slug]?.versionId ?? ""}` : null;
  });
  const otherTabOpen = useTabPresence("landing", presenceId);

  // Touch (iPad): less-used header tools go into a "⋯" menu, and on a
  // portrait (or narrow) touch screen the Sections list and the inspector
  // become slide-over drawers so the canvas gets the full width.
  const touch = useTouchMode();
  const portrait = useMediaQuery("(orientation: portrait)");
  const narrow = useMediaQuery("(max-width: 1023px)");
  const compact = touch && (portrait || narrow);
  const [drawer, setDrawer] = useState<"sections" | "inspector" | null>(null);
  // Landscape touch: both side panels can be hidden (the canvas takes the freed
  // width). Remembered per browser tab. A desktop with a mouse always shows both.
  const [panelsHidden, setPanelsHidden] = useSessionState("landing-editor:panels-hidden", { sections: false, inspector: false });
  const hideable = touch && !compact;
  const showSections = !compact && !(hideable && panelsHidden.sections);
  const showInspector = !compact && !(hideable && panelsHidden.inspector);
  const selectedSectionIid = useLandingEditorStore((s) => s.selectedSectionIid);
  const selectedAssetIid = useLandingEditorStore((s) => s.selectedAssetIid);
  const hasSelection = selectedSectionIid !== null || selectedAssetIid !== null;
  // Picking a section/element in the Sections drawer closes it, so you see
  // what you picked on the canvas.
  const [prevSelection, setPrevSelection] = useState(`${selectedSectionIid}:${selectedAssetIid}`);
  if (prevSelection !== `${selectedSectionIid}:${selectedAssetIid}`) {
    setPrevSelection(`${selectedSectionIid}:${selectedAssetIid}`);
    if (drawer === "sections") setDrawer(null);
  }

  useLandingDraftAutosave();
  // iPad edge-swipe "back" skips beforeunload: guard it while the page is dirty.
  useBackSwipeGuard(isDirty);

  // Hydrate once on mount (idempotent; guarded by the store's isHydrated).
  // React 19 strict-mode double-invokes this effect in dev; the guard above
  // can't catch the second fire because `isHydrated` only flips true after the
  // first fire's fetch resolves (see the room editor's EditorWrapper.tsx for
  // the same race, accepted there because hydration is idempotent). Here it
  // isn't harmless: each fire calls `set({ allPages, ... })` with a fresh
  // object, and since `allPages` is what the undo/redo history tracks, a
  // double-fire pushes two near-duplicate baseline entries — the user's first
  // Undo after loading the page would silently do nothing (pop the spurious
  // second entry) instead of undoing their first real edit. Clearing history
  // once hydration settles discards whatever it pushed, however many times it
  // ran, so undo always starts clean at "the page as loaded."
  useEffect(() => {
    // Deep link (?open=site|nav) from the dashboard's quick links: open that
    // panel once (after hydration on a fresh load, on the next tick when the
    // store is already hydrated from an earlier visit), then drop the param.
    const open = new URLSearchParams(window.location.search).get("open");
    const applyOpen = () => {
      if (open !== "site" && open !== "nav") return;
      if (open === "site") setSiteSettingsOpen(true);
      else setNavStudioOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      window.history.replaceState(null, "", url.toString());
    };
    if (useLandingEditorStore.getState().isHydrated) {
      void Promise.resolve().then(applyOpen);
      return;
    }
    // Deep link (?page=<slug>) from the admin dashboard. hydrateFromSupabase
    // keeps currentPageSlug when that page exists, else falls back to home.
    const wanted = new URLSearchParams(window.location.search).get("page");
    if (wanted) useLandingEditorStore.setState({ currentPageSlug: wanted });
    hydrateFromSupabase()
      .then((result) => {
        if (result.source === "static") {
          toast.error("Couldn't load pages from Supabase", {
            description:
              result.error ??
              "Saves will not persist. Check auth / RLS / env vars.",
            duration: 8000,
          });
        } else if (result.source === "missing") {
          toast.info("No saved pages yet", {
            description:
              "Editing a fresh copy of the default home page. First Save creates the row.",
            duration: 6000,
          });
        }
      })
      .catch((err) => {
        toast.error("Hydration failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        useLandingEditorStore.temporal.getState().clear();
        applyOpen();
      });
  }, [hydrateFromSupabase, setNavStudioOpen]);

  // Keep the runtime language store (what DrawnSection reads) in sync with the
  // editor's preview toggle. setState directly — NOT setLanguage() — so we don't
  // clobber the visitor-facing localStorage preference (Gotcha №3).
  useEffect(() => {
    useLandingStore.setState({ language: previewLanguage });
  }, [previewLanguage]);

  const { choose, dialog: choiceDialog } = useChoiceDialog();

  // Publish gate: show the checklist when there is anything to report. Errors
  // need an explicit "Publish anyway"; warnings alone just list (one click).
  // Resolves true when publishing should go on. It runs AFTER the save, so
  // the checks see exactly what is about to go live.
  const confirmPublishChecks = useCallback(async (): Promise<boolean> => {
    const issues = runLandingChecks().filter((i) => i.severity !== "info");
    if (issues.length === 0) return true;
    const hasErrors = issues.some((i) => i.severity === "error");
    const pick = await choose({
      title: hasErrors ? "Fix these before publishing?" : "A few things to double-check",
      body:
        formatIssuesText(issues) +
        (hasErrors
          ? "\n\nErrors mean visitors may hit broken links or unlabeled buttons."
          : "\n\nThese are warnings; they don't block publishing."),
      options: hasErrors
        ? [
            { id: "cancel", label: "Go back and fix", primary: true },
            { id: "go", label: "Publish anyway", danger: true },
          ]
        : [
            { id: "cancel", label: "Cancel" },
            { id: "go", label: "Publish", primary: true },
          ],
    });
    return pick === "go";
  }, [choose]);

  // The open draft was changed somewhere else. Resolves true only when the
  // draft ended up saved (so Publish may go on); never silent.
  const resolveConflict = useCallback(
    async (theirsUpdatedAt?: string): Promise<boolean> => {
      const state = useLandingEditorStore.getState();
      const slug = state.currentPageSlug;
      const record = slug ? state.allPages[slug] : null;
      if (!slug || !record?.versionId) return false;
      const versionId = record.versionId;
      const name = state.versions[slug]?.find((v) => v.id === versionId)?.name ?? "Draft";
      const when = theirsUpdatedAt ? new Date(theirsUpdatedAt).toLocaleString() : "a moment ago";
      const pick = await choose({
        title: "This draft was changed somewhere else",
        body: `Another tab or device saved this draft (${when}) after you opened it.\n\nSaving yours as a new draft loses nothing. Load theirs discards your unsaved edits here. Overwrite replaces the newer save with yours (it's kept in History).`,
        options: [
          { id: "copy", label: "Save mine as a new draft (recommended)", primary: true },
          { id: "theirs", label: "Load theirs" },
          { id: "overwrite", label: "Overwrite", danger: true },
          { id: "cancel", label: "Cancel" },
        ],
      });
      if (pick === "copy") {
        const r = await state.saveAsNewVersion(`${name} (my copy)`);
        if (!r.ok) {
          toast.error("Couldn't save your copy", { description: r.error });
          return false;
        }
        toast.success(`Saved your edits as “${name} (my copy)”.`);
        return true;
      }
      if (pick === "theirs") {
        const r = await state.reloadVersion();
        if (r.ok) toast.success("Loaded the newer version.");
        else toast.error("Couldn't load the newer version", { description: r.error });
        return false;
      }
      if (pick === "overwrite") {
        const theirs = await loadLandingVersion(versionId, slug);
        if (!theirs.page) {
          toast.error("Couldn't read the newer version to back it up, so nothing was overwritten.");
          return false;
        }
        const backup = await recordPageBackup(theirs.page, versionId);
        if (!backup.ok) {
          toast.error("Couldn't back up the newer version, so nothing was overwritten.", {
            description: backup.error,
          });
          return false;
        }
        const r = await state.saveToSupabase({ force: true });
        if (r.ok) toast.success("Saved over the newer version (it's in History).");
        else toast.error("Save failed", { description: [r.pageError, ...r.contentErrors].filter(Boolean).join("; ") });
        return r.ok;
      }
      return false;
    },
    [choose]
  );

  const performSave = useCallback(() => {
    const state = useLandingEditorStore.getState();
    if (!state.currentPageSlug) return;
    // Page Save only touches the page. Site-wide settings (nav, fonts, the
    // language switcher's skin…) go live on every page, so they have their own
    // explicit "Save & go live" (SiteChangesPill, Site settings, Nav Studio).
    const promise = state.saveToSupabase();
    toast.promise(promise, {
      loading: "Saving…",
      success: (result) => {
        if (result.conflict) return "Not saved: this draft was changed somewhere else.";
        if (result.ok) {
          const s = useLandingEditorStore.getState();
          if (!s.versioning || !s.currentPageSlug) return "Saved";
          const rec = s.allPages[s.currentPageSlug];
          const v = s.versions[s.currentPageSlug]?.find((x) => x.id === rec?.versionId);
          // Without the versions.content migration, button pop-up content is
          // shared with the live page and written on every Save.
          const sharedContent =
            !s.versionContent &&
            Object.keys(s.contentMap).some((k) => k.startsWith(`${s.currentPageSlug}:`))
              ? " Button pop-up content is still shared with the live page until the latest database update is applied."
              : "";
          return versionState(rec, v).live
            ? `Saved “${v?.name}”. Visitors see it after Update live.${sharedContent}`
            : `Saved draft “${v?.name ?? "Draft"}”. The live site is unchanged.${sharedContent}`;
        }
        const details = [result.pageError, ...result.contentErrors]
          .filter(Boolean)
          .join("; ");
        throw new Error(details || "Save failed");
      },
      error: (err) => (err instanceof Error ? err.message : "Save failed"),
    });
    void promise
      .then((r) => {
        if (r.conflict) void resolveConflict(r.conflict.theirsUpdatedAt);
        else if (r.ok && useSiteConfigEditorStore.getState().isDirty) {
          toast.info("Site-wide changes aren't saved by Ctrl+S. Use Save & go live.");
        }
      })
      .catch(() => undefined);
  }, [resolveConflict]);

  // Save and wait (Publish saves first so what goes live is what's on screen).
  // A conflict aborts the publish: the dialog opens and this returns false.
  const performSaveAsync = useCallback(async () => {
    const state = useLandingEditorStore.getState();
    if (!state.currentPageSlug) return false;
    const result = await state.saveToSupabase();
    if (result.conflict) {
      void resolveConflict(result.conflict.theirsUpdatedAt);
      return false;
    }
    if (!result.ok) {
      toast.error("Save failed", {
        description: [result.pageError, ...result.contentErrors].filter(Boolean).join("; "),
      });
      return false;
    }
    return true;
  }, [resolveConflict]);

  // Open the current editor state in the real public renderer, in a new tab
  // (one tab per page, reused on repeat clicks). The page is handed over via
  // localStorage so unsaved edits show too — see landingPreviewHandoff.ts.
  const openPreview = useCallback(() => {
    const state = useLandingEditorStore.getState();
    const slug = state.currentPageSlug;
    const record = slug ? state.allPages[slug] : null;
    if (!slug || !record) return;
    // A draft version previews as unpublished even when the page is online.
    const meta = state.versions[slug]?.find((v) => v.id === record.versionId);
    const live = state.versioning ? versionState(record, meta).live : record.status === "published";
    // Draft button pop-up content goes along, so the preview doesn't show
    // what's live in its place.
    const content: Record<string, ObjectContent> = {};
    for (const [key, value] of Object.entries(state.contentMap)) {
      if (key.startsWith(`${slug}:`)) content[key.slice(slug.length + 1)] = value;
    }
    const handedOff = writePreviewHandoff(slug, {
      page: record.page,
      status: live ? "published" : "draft",
      handedOffAt: Date.now(),
      content,
    });
    if (!handedOff) {
      toast.warning("Couldn't hand unsaved changes to the preview", {
        description: "Showing the last saved version instead.",
      });
    }
    const params = new URLSearchParams();
    if (handedOff) params.set("source", "editor");
    if (record.versionId) params.set("version", record.versionId);
    const qs = params.toString();
    const url = `/admin/landing-editor/preview/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`;
    window.open(url, `landing-preview-${slug}`);
  }, []);

  // Keyboard shortcuts.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      // Space / Enter on a focused button or link must activate it.
      if (
        (e.key === " " || e.key === "Enter") &&
        (e.target as HTMLElement)?.closest?.("button, a, [role=menuitem]")
      ) {
        return;
      }
      const state = useLandingEditorStore.getState();
      if (state.editingContentAssetIid) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        performSave();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        useLandingEditorStore.temporal.getState().undo();
        return;
      }
      if (
        (ctrl && e.key.toLowerCase() === "z" && e.shiftKey) ||
        (ctrl && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        useLandingEditorStore.temporal.getState().redo();
        return;
      }
      // Layer lock (Figma's shortcut): toggles the selected element / machine.
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "l") {
        // The Nav Studio (open on top) handles its own boxes.
        if (useSiteConfigEditorStore.getState().navStudioOpen) return;
        e.preventDefault();
        toggleSelectionLock();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // The arcade machine can't be deleted (one game per page).
        if (state.selectedAssetIid && state.selectedAssetIid !== ARCADE_MACHINE_IID) {
          e.preventDefault();
          removeAssetWithUndo(state.selectedAssetIid);
        }
        return;
      }
      if (e.key === "Escape") {
        state.selectAsset(null);
        state.setArcadePreview(null);
        state.setArcadeTool("select");
        return;
      }
      const page =
        state.currentPageSlug ? state.allPages[state.currentPageSlug]?.page : undefined;
      const findSelected = () => {
        if (!page || !state.selectedAssetIid) return null;
        for (const section of page.sections) {
          const asset = section.assets.find((x) => x.iid === state.selectedAssetIid);
          if (asset) return { section, asset };
        }
        return null;
      };

      // Duplicate / copy / paste the selected element.
      if (ctrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (state.selectedAssetIid) state.duplicateAsset(state.selectedAssetIid);
        return;
      }
      if (ctrl && e.key.toLowerCase() === "c") {
        // Leave real text selections (e.g. in the side panel) to the browser.
        if (window.getSelection()?.toString()) return;
        const hit = findSelected();
        if (!hit) return;
        e.preventDefault();
        assetClipboard = structuredClone(hit.asset);
        // The copy keeps the lock state, even a default one (it may land off the edge).
        if (isAssetLocked(hit.asset, hit.section)) assetClipboard.locked = true;
        toast("Copied element", { duration: 1200 });
        return;
      }
      if (ctrl && e.key.toLowerCase() === "v") {
        if (!assetClipboard || !page) return;
        // Into the selected element's section, else the selected section,
        // else the first one — works across sections and pages.
        const target =
          findSelected()?.section ??
          page.sections.find((x) => x.iid === state.selectedSectionIid) ??
          page.sections[0];
        if (!target) return;
        e.preventDefault();
        const src = assetClipboard;
        // Same spot if it's free there; otherwise step down-right until it
        // doesn't sit exactly on top of an existing copy.
        let { x, y } = src;
        while (target.assets.some((a) => Math.abs(a.x - x) < 0.5 && Math.abs(a.y - y) < 0.5)) {
          x = Math.min(x + 3, 100 - src.w);
          y = Math.min(y + 3, 100 - src.h);
          if (x >= 100 - src.w && y >= 100 - src.h) break;
        }
        state.addAsset(target.iid, {
          ...structuredClone(src),
          iid: newIid(),
          x,
          y,
          zIndex: target.assets.reduce((m, a) => Math.max(m, a.zIndex), 0) + 1,
        });
        return;
      }

      // The arcade machine (not an element): layer keys + arrow nudge move it
      // in the arcade's own config — the desktop spot, or the phone override.
      if (state.selectedAssetIid === ARCADE_MACHINE_IID) {
        const arcadeSec = page?.sections.find((x) => x.containsGame);
        if (!arcadeSec) return;
        if (!ctrl && (e.key === "]" || e.key === "[")) {
          e.preventDefault();
          state.moveArcadeLayer(arcadeSec.iid, ARCADE_MACHINE_IID, e.key === "]" ? "up" : "down");
          return;
        }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          // Locked: no nudge (say so once).
          if (isMachineLocked(arcadeSec.arcade)) {
            showLockedHint(() => toggleSelectionLock());
            return;
          }
          const step = e.shiftKey ? 1 : 0.25;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          const r2 = (n: number) => Math.round(n * 100) / 100;
          const a = resolveArcade(arcadeSec.arcade);
          const dev = state.deviceMode === "mobile" ? "mobile" : "desktop";
          const p = machinePlacement(a, dev);
          state.updateArcade(arcadeSec.iid, (st) =>
            dev === "desktop"
              ? { ...st, machine: { ...st.machine, x: r2(p.x + dx), y: r2(p.y + dy) } }
              : { ...st, mobile: { ...st.mobile, machine: { ...a.mobile.machine, x: r2(p.x + dx), y: r2(p.y + dy) } } }
          );
          return;
        }
        return;
      }

      // Layer order: ] forward, [ backward (Photoshop / Figma muscle memory).
      if (!ctrl && (e.key === "]" || e.key === "[") && state.selectedAssetIid) {
        e.preventDefault();
        if (e.key === "]") state.bringAssetForward(state.selectedAssetIid);
        else state.sendAssetBackward(state.selectedAssetIid);
        return;
      }

      // Arrow-nudge the selected asset (0.25% / Shift 1%). In Mobile mode it
      // moves the phone layout (the `mobile` override), never the desktop one.
      if (
        state.selectedAssetIid &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.25;
        const hit = findSelected();
        if (!hit) return;
        const a = hit.asset;
        // Locked: no nudge (say so once).
        if (isAssetLocked(a, hit.section)) {
          showLockedHint(() => toggleSelectionLock());
          return;
        }
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const r2 = (n: number) => Math.round(n * 100) / 100;
        if (state.deviceMode === "mobile") {
          state.updateAssetMobile(a.iid, {
            x: r2((a.mobile?.x ?? a.x) + dx),
            y: r2((a.mobile?.y ?? a.y) + dy),
          });
        } else {
          state.updateAssetTransform(a.iid, { x: a.x + dx, y: a.y + dy });
        }
      }
    },
    [performSave]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Mark the document root dark while the editor is open so Radix portals
  // (Select/Dialog content rendered on document.body, outside this subtree)
  // pick up the dark theme too. Removed on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  // Warn on unload with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useLandingEditorStore.getState().isDirty || useSiteConfigEditorStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <div className="editor-root dark flex h-dvh flex-col bg-background text-foreground">
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
      <SiteConflictDialog />
      <LandingContentEditor />
      {/* Top bar: page · device + language · history + save/publish. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5 touch:h-auto touch:min-h-14 touch:flex-wrap touch:py-1">
        {/* Plain <a> (full navigation) so the beforeunload unsaved-changes guard fires. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
        <a
          href="/admin"
          title="Admin dashboard"
          aria-label="Admin dashboard"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4"
        >
          <LayoutDashboard />
        </a>
        <span className="me-1 hidden select-none text-sm font-semibold tracking-tight lg:inline touch:lg:hidden">Editor</span>
        <PageSwitcher />
        <VersionSwitcher onSave={performSaveAsync} />
        <div className="mx-1 h-5 w-px bg-border" />
        <IconButton title="Undo (Ctrl+Z)" onClick={() => useLandingEditorStore.temporal.getState().undo()}>
          <Undo2 />
        </IconButton>
        <IconButton title="Redo (Ctrl+Shift+Z)" onClick={() => useLandingEditorStore.temporal.getState().redo()}>
          <Redo2 />
        </IconButton>
        {hideable && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <IconButton
              title={panelsHidden.sections ? "Show the Sections panel" : "Hide the Sections panel"}
              onClick={() => setPanelsHidden((p) => ({ ...p, sections: !p.sections }))}
            >
              <PanelLeft className={panelsHidden.sections ? "opacity-50" : "text-sky-400"} />
            </IconButton>
            <IconButton
              title={panelsHidden.inspector ? "Show the Inspector panel" : "Hide the Inspector panel"}
              onClick={() => setPanelsHidden((p) => ({ ...p, inspector: !p.inspector }))}
            >
              <PanelRight className={panelsHidden.inspector ? "opacity-50" : "text-sky-400"} />
            </IconButton>
          </>
        )}

        <div className="mx-auto flex items-center gap-2">
          <Segmented
            label="Device"
            value={deviceMode}
            onChange={(v) => setDeviceMode(v as "desktop" | "mobile")}
            options={[
              { value: "desktop", label: "Desktop", icon: <Monitor />, title: "Desktop layout" },
              { value: "mobile", label: "Mobile", icon: <Smartphone />, title: "Mobile layout: edits here only affect phones" },
            ]}
          />
          <Segmented
            label="Language"
            value={previewLanguage}
            onChange={(v) => setPreviewLanguage(v as "en" | "ar")}
            options={[
              { value: "en", label: "EN", title: "Preview in English" },
              { value: "ar", label: "عربي", title: "Preview in Arabic (right-to-left)" },
            ]}
          />
        </div>

        {!touch && (
          <>
            <IconButton title="Nav Studio: the site's navigation bar" onClick={() => setNavStudioOpen(true)} label="Nav">
              <PanelTop />
            </IconButton>
            <IconButton title="Site settings: announcement bar, footer, forms, hover" onClick={() => setSiteSettingsOpen(true)} label="Site">
              <Globe />
            </IconButton>
          </>
        )}
        <SiteChangesPill />
        <ChecksButton disabled={!hasPage} />
        {touch ? (
          <OverflowMenu
            label="More tools"
            triggerClassName="grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            items={[
              { label: "Nav Studio (navigation bar)", icon: PanelTop, onSelect: () => setNavStudioOpen(true) },
              { label: "Site settings", icon: Globe, onSelect: () => setSiteSettingsOpen(true) },
              { kind: "separator" },
              { label: "Save history", icon: History, disabled: !hasPage, onSelect: () => setHistoryOpen(true) },
              { label: "Preview as visitors see it", icon: Eye, disabled: !hasPage, onSelect: openPreview },
            ]}
          />
        ) : (
          <>
            <IconButton title="Save history of the open version: named snapshots and the last 20 saves" onClick={() => setHistoryOpen(true)} disabled={!hasPage}>
              <History />
            </IconButton>
            <IconButton title="Preview this page as visitors see it (includes unsaved changes)" onClick={openPreview} disabled={!hasPage}>
              <Eye />
            </IconButton>
          </>
        )}
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="secondary" onClick={performSave} disabled={!hasPage} title="Save (Ctrl+S)">
          {isDirty ? (
            <>
              <span className="size-1.5 rounded-full bg-amber-400" aria-hidden="true" /> Save
            </>
          ) : (
            <>
              <Check /> Saved
            </>
          )}
        </Button>
        <PublishButton onBeforePublish={performSaveAsync} onGate={confirmPublishChecks} />
      </header>

      <LandingDraftRestoreBanner />

      {/* Body */}
      <div className="relative flex flex-1 overflow-hidden">
        {showSections && <LandingSectionOutline />}
        <LandingEditorCanvas />
        {showInspector && <LandingSidePanel />}
        {compact && (
          <>
            <button
              onClick={() => setDrawer("sections")}
              className="absolute bottom-6 start-3 z-30 flex items-center gap-1.5 rounded-full bg-card/95 px-3.5 text-sm font-medium shadow-lg ring-1 ring-border"
            >
              <ListTree className="size-4" /> Sections
            </button>
            <button
              onClick={() => setDrawer("inspector")}
              className={`absolute bottom-6 end-6 z-30 flex items-center gap-1.5 rounded-full px-3.5 text-sm font-medium shadow-lg ring-1 ${
                hasSelection ? "bg-sky-600 text-white ring-sky-400" : "bg-card/95 ring-border"
              }`}
            >
              <SlidersHorizontal className="size-4" /> {selectedAssetIid ? "Edit element" : hasSelection ? "Edit section" : "Page settings"}
            </button>
          </>
        )}
      </div>

      {compact && drawer && (
        <div
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-label={drawer === "sections" ? "Sections" : "Inspector"}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setDrawer(null);
            }
          }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(null)} aria-hidden="true" />
          <div
            className={`absolute top-0 flex h-full max-w-[92vw] flex-col bg-card shadow-2xl ${
              drawer === "sections" ? "start-0" : "end-0"
            }`}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-1">
              <span className="text-sm font-medium">{drawer === "sections" ? "Sections" : "Inspector"}</span>
              <button
                autoFocus
                onClick={() => setDrawer(null)}
                className="grid place-items-center rounded-md text-muted-foreground hover:bg-accent"
                aria-label="Close panel"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1">
              {drawer === "sections" ? <LandingSectionOutline /> : <LandingSidePanel />}
            </div>
          </div>
        </div>
      )}

      <SiteSettingsPanel open={siteSettingsOpen} onOpenChange={setSiteSettingsOpen} />
      <NavStudio />
      <LandingHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

// ─── Top-bar pieces ───────────────────────────────────────────

function IconButton({
  title,
  onClick,
  disabled,
  label,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      size={label ? "sm" : "icon-sm"}
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="text-muted-foreground hover:text-foreground"
    >
      {children}
      {label && <span>{label}</span>}
    </Button>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: React.ReactNode; title?: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-background/70 p-0.5 ring-1 ring-border">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5 touch:h-10 touch:px-3.5 ${
              on ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Publish the open version (saving first, so what goes live is what's on
 *  screen). Versioned: replacing a different live version asks first; the live
 *  version itself shows "Update live" only when it has edits. Taking a page
 *  offline lives in the version switcher. */
type PublishProps = { onBeforePublish: () => Promise<boolean>; onGate: () => Promise<boolean> };

function PublishButton({ onBeforePublish, onGate }: PublishProps) {
  const versioning = useLandingEditorStore((s) => s.versioning);
  return versioning ? (
    <VersionPublishButton onBeforePublish={onBeforePublish} onGate={onGate} />
  ) : (
    <LegacyPublishButton onBeforePublish={onBeforePublish} onGate={onGate} />
  );
}

function VersionPublishButton({ onBeforePublish, onGate }: PublishProps) {
  const record = useLandingEditorStore(selectCurrentPage);
  const versions = useLandingEditorStore((s) => (s.currentPageSlug ? s.versions[s.currentPageSlug] : undefined));
  const isDirty = useLandingEditorStore((s) => s.isDirty);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!record) return null;

  const current = versions?.find((v) => v.id === record.versionId);
  const liveRow = record.status === "published" ? versions?.find((v) => v.id === record.liveVersionId) : undefined;
  const { live, edited } = versionState(record, current);

  const publish = async () => {
    setBusy(true);
    setConfirming(false);
    try {
      if ((isDirty || !record.versionId) && !(await onBeforePublish())) return;
      if (!(await onGate())) return;
      const s = useLandingEditorStore.getState();
      const id = s.currentPageSlug ? s.allPages[s.currentPageSlug]?.versionId : undefined;
      if (!id) return void toast.error("Save once before publishing.");
      const res = await s.publishVersion(id);
      if (!res.ok) return void toast.error(res.error ?? "Publish failed.");
      const name = s.versions[s.currentPageSlug!]?.find((v) => v.id === id)?.name ?? "This version";
      toast.success(`“${name}” is live.`);
      if (useSiteConfigEditorStore.getState().isDirty) {
        toast.info("Site-wide changes aren't part of this publish. Use Save & go live.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (live && !edited && !isDirty) {
    return (
      <Button size="sm" variant="ghost" disabled title="This version is what visitors see. Open a draft from the version menu to stage changes." className="text-emerald-400 disabled:opacity-100">
        <Check /> Live
      </Button>
    );
  }
  if (live) {
    return (
      <Button size="sm" disabled={busy} onClick={publish} title="Save and push this version's edits to visitors">
        <Rocket /> Update live
      </Button>
    );
  }
  // A draft. Replacing another live version is worth one extra click.
  if (!liveRow) {
    return (
      <Button size="sm" disabled={busy} onClick={publish} title="Save and make this version live">
        <Rocket /> Publish
      </Button>
    );
  }
  return (
    <PopoverPrimitive.Root open={confirming} onOpenChange={setConfirming}>
      <PopoverPrimitive.Trigger asChild>
        <Button size="sm" disabled={busy} title={`Save and make this version live, replacing “${liveRow.name}”`}>
          <Rocket /> Publish
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="dark z-50 w-72 space-y-2 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-2xl"
        >
          <p className="leading-snug">
            Make <b>“{current?.name ?? "this version"}”</b> live? It replaces <b>“{liveRow.name}”</b> for visitors. That one stays in your versions as a draft.
          </p>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={publish}>
              <Rocket /> Publish
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** Pre-versions behaviour (the versions migration isn't applied): Publish =
 *  save + go live; once live, the secondary action is "Unpublish". */
function LegacyPublishButton({ onBeforePublish, onGate }: PublishProps) {
  const slug = useLandingEditorStore((s) => s.currentPageSlug);
  const status = useLandingEditorStore((s) => (s.currentPageSlug ? s.allPages[s.currentPageSlug]?.status : undefined));
  const isDirty = useLandingEditorStore((s) => s.isDirty);
  const setStatus = useLandingEditorStore((s) => s.setStatus);
  const [busy, setBusy] = useState(false);
  if (!slug) return null;
  const live = status === "published";
  const run = async (next: "published" | "draft") => {
    setBusy(true);
    try {
      if (next === "published" && (isDirty || !status) && !(await onBeforePublish())) return;
      if (next === "published" && !(await onGate())) return;
      const res = await setStatus(slug, next);
      if (!res.ok) return void toast.error(res.error ?? "Status change failed.");
      toast.success(next === "published" ? `“${slug}” is live.` : `“${slug}” is back to draft.`);
      if (next === "published" && useSiteConfigEditorStore.getState().isDirty) {
        toast.info("Site-wide changes aren't part of this publish. Use Save & go live.");
      }
    } finally {
      setBusy(false);
    }
  };
  if (live && !isDirty) {
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("draft")} title="Take this page offline (back to draft)">
        <EyeOff /> Unpublish
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={busy} onClick={() => run("published")} title={live ? "Save and update the live page" : "Save and make this page live"}>
      <Rocket /> {live ? "Update live" : "Publish"}
    </Button>
  );
}
