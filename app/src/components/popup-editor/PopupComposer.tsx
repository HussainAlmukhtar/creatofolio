"use client";

// PopupComposer — the pop-up builder shared by the room editor (an object's
// pop-up) and the landing editor (a button's pop-up). Preview-first:
//
//   ┌ header: title · device · preview language · Arabic n/m · undo/redo · Revert · Done
//   ├ outline (blocks: add / reorder / duplicate / delete)
//   ├ live preview (the visitor's PopupSheet; click a block to select it)
//   └ inspector (the generated landing inspector, pop-up flavoured)
//
// On narrow or touch screens the outline and inspector become drawers.
//
// Data flow: the composer edits a working copy (popupComposerStore, with its
// own undo) and writes it through to the HOST store (debounced) via
// `onChange`, so the host's Save/draft/autosave see every edit exactly like any
// other change. "Revert" puts the pop-up back the way it was when the composer
// opened (host's `onRevert`). Nothing is written to the database here.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { toast } from "sonner";
import {
  Check,
  Languages,
  ListTree,
  Monitor,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Undo2,
  X,
} from "lucide-react";
import type { ObjectContent } from "@/data/contentTypes";
import { CURRENT_CONTENT_VERSION } from "@/data/contentTypes";
import { migrateObjectContent } from "@/data/contentMigrations";
import { contentTranslation } from "@/lib/localizedChecks";
import { useTouchMode } from "@/lib/touchMode";
import { usePopupComposerStore } from "@/stores/popupComposerStore";
import { InspectorContext, type InspectorEnv } from "@/components/landing-editor/FormFields";
import type { PopupTheme } from "@/components/popup/popupTheme";
import { PopupProviders } from "@/components/popup/PopupProviders";
import type { FormsConfig } from "@/data/landingTypes";
import { ComposerOutline } from "./ComposerOutline";
import { ComposerPreview } from "./ComposerPreview";
import { ComposerInspector } from "./ComposerInspector";
import "./composer.css";

export interface PopupComposerProps {
  objectId: string;
  /** Room slug (room editor) or page slug (landing editor). */
  roomId: string;
  objectLabel: { en: string; ar: string };
  initial: ObjectContent | null;
  theme: PopupTheme;
  /** Internal-link suggestions for URL fields (null = don't check pages). */
  pages: InspectorEnv["pages"];
  /** Where edits end up, for the footer hint. */
  host: "room" | "page";
  /** The site's forms destination as the host knows it (landing editor:
   *  possibly unsaved); absent = read the live site config. */
  forms?: FormsConfig;
  onChange: (content: ObjectContent) => void;
  onRevert: () => void;
  onClose: () => void;
}

const WRITE_DEBOUNCE_MS = 300;
const NARROW_QUERY = "(max-width: 1099px)";

function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
}

/** A fresh, empty v2 pop-up for an object that has none yet. */
function emptyContent(objectId: string, roomId: string, label: { en: string; ar: string }): ObjectContent {
  return {
    objectId,
    roomId,
    title: label.en,
    titleAr: label.ar,
    type: "blocks",
    contentVersion: CURRENT_CONTENT_VERSION,
    layout: "sheet",
    blocks: [],
  };
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function PopupComposer(props: PopupComposerProps) {
  const { objectId, roomId, objectLabel, initial, theme, pages, host, forms, onChange, onRevert, onClose } = props;

  // The pop-up as it was on open (v2 shape): Revert's target and the baseline
  // for "anything changed?".
  const start = useMemo(
    () => ({ ...(migrateObjectContent(initial) ?? emptyContent(objectId, roomId, objectLabel)), objectId, roomId }),
    // Only on open: later host updates are our own write-throughs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const content = usePopupComposerStore((s) => s.content);
  const device = usePopupComposerStore((s) => s.device);
  const previewLang = usePopupComposerStore((s) => s.previewLang);
  const setDevice = usePopupComposerStore((s) => s.setDevice);
  const setPreviewLang = usePopupComposerStore((s) => s.setPreviewLang);
  const select = usePopupComposerStore((s) => s.select);
  const selected = usePopupComposerStore((s) => s.selected);
  const { undo, redo, pastStates, futureStates } = useStore(usePopupComposerStore.temporal);

  const touch = useTouchMode();
  const narrow = useNarrow();
  const drawers = touch || narrow;
  const [drawer, setDrawer] = useState<"outline" | "inspector" | null>(null);
  const [wide, setWide] = useState(false);

  // iPad / narrow: an EMPTY pop-up opens with the Blocks drawer showing its
  // starters, so there is something to tap (once per opening, never again
  // after the author closes it).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !drawers || !content) return;
    autoOpened.current = true;
    const hasBlocks =
      (content.blocks?.length ?? 0) > 0 || (content.pages ?? []).some((pg) => (pg.blocks?.length ?? 0) > 0);
    if (!hasBlocks) setDrawer("outline");
  }, [drawers, content]);

  // Write-through to the host store, debounced; flushed on close. Driven by a
  // store subscription (not render effects) so only real edits are written:
  // the composer's own loads (open, Revert) run with `loading` set.
  const loading = useRef(false);
  const pending = useRef<ObjectContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) onChangeRef.current(pending.current);
    pending.current = null;
  }, []);
  const load = useCallback((c: ObjectContent) => {
    loading.current = true;
    usePopupComposerStore.getState().init(c);
    loading.current = false;
  }, []);

  useEffect(() => {
    load(start);
    // Forget the load in the undo history once it has rendered.
    const raf = requestAnimationFrame(() => usePopupComposerStore.getState().settle());
    const unsub = usePopupComposerStore.subscribe((s, prev) => {
      if (loading.current || !s.content || s.content === prev.content) return;
      pending.current = { ...s.content, objectId, roomId, updatedAt: new Date().toISOString() };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      flush();
      // Don't leave this pop-up in the shared store for the next open.
      loading.current = true;
      usePopupComposerStore.setState({ content: null, selected: null });
      usePopupComposerStore.temporal.getState().clear();
      loading.current = false;
    };
  }, [start, load, flush, objectId, roomId]);

  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  const revert = () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    load(start);
    onRevert();
    toast.success("Pop-up put back the way it was when you opened it.");
  };

  // Dark chrome for Radix portals (selects, dialogs) while open.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  // Keyboard: Esc closes (unless a dialog/menu above us has it), undo/redo
  // outside text fields (text fields keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const overlayOpen = document.querySelector(
        '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper], [data-nested-overlay]'
      );
      if (e.key === "Escape") {
        if (overlayOpen) return;
        if (drawer) {
          setDrawer(null);
          return;
        }
        e.preventDefault();
        close();
        return;
      }
      if (overlayOpen || isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, drawer, undo, redo]);

  const tr = contentTranslation(content);
  const label = previewLang === "ar" ? objectLabel.ar || objectLabel.en : objectLabel.en || objectLabel.ar;
  const env = useMemo<InspectorEnv>(() => ({ surface: "popup", pages }), [pages]);

  if (!content || typeof document === "undefined") return null;

  const outline = (
    <ComposerOutline
      onPicked={() => drawers && setDrawer("inspector")}
      onSelectedRow={() => drawers && setDrawer("inspector")}
    />
  );
  const inspector = <ComposerInspector wide={wide} onToggleWide={() => setWide((w) => !w)} />;

  return createPortal(
    <InspectorContext.Provider value={env}>
      <div
        className="composer fixed inset-0 z-50 flex flex-col bg-neutral-950 text-foreground"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit pop-up: ${label || objectId}`}
        data-touch-exempt=""
      >
        {/* ── Header ── */}
        <header className="flex shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Pop-up · {label || objectId}</p>
            <p className="truncate text-[11px] text-muted-foreground touch:text-[13px]">
              {host === "room"
                ? "Edits go into the room: Save keeps them as a draft, Publish shows them to visitors."
                : "Edits go into this page: Save keeps them with the page draft."}
            </p>
          </div>

          {drawers && (
            <>
              <HeaderBtn label="Blocks" active={drawer === "outline"} onClick={() => setDrawer(drawer === "outline" ? null : "outline")}>
                <ListTree className="size-4" />
              </HeaderBtn>
              <HeaderBtn
                label="Settings"
                active={drawer === "inspector"}
                onClick={() => setDrawer(drawer === "inspector" ? null : "inspector")}
              >
                <SlidersHorizontal className="size-4" />
              </HeaderBtn>
            </>
          )}

          <div className="flex overflow-hidden rounded-md border border-neutral-700" role="group" aria-label="Preview size">
            <SegBtn on={device === "desktop"} label="Desktop preview" onClick={() => setDevice("desktop")}>
              <Monitor className="size-4" />
            </SegBtn>
            <SegBtn on={device === "phone"} label="Phone preview" onClick={() => setDevice("phone")}>
              <Smartphone className="size-4" />
            </SegBtn>
          </div>
          <div className="flex overflow-hidden rounded-md border border-neutral-700" role="group" aria-label="Preview language">
            <SegBtn on={previewLang === "en"} label="Preview in English" onClick={() => setPreviewLang("en")}>
              EN
            </SegBtn>
            <SegBtn on={previewLang === "ar"} label="Preview in Arabic" onClick={() => setPreviewLang("ar")}>
              ع
            </SegBtn>
          </div>
          <button
            type="button"
            onClick={() => select("settings")}
            title={tr.gaps.length ? `${tr.gaps.length} half-translated` : "Everything with text has both languages"}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
              tr.gaps.length ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
            } ${selected === "settings" ? "ring-1 ring-current" : ""}`}
          >
            <Languages className="size-3.5" />
            Arabic {tr.complete}/{tr.total}
          </button>

          <span className="mx-1 h-6 w-px bg-neutral-800" />
          <HeaderBtn label="Undo (Ctrl+Z)" disabled={!pastStates.length} onClick={() => undo()}>
            <Undo2 className="size-4" />
          </HeaderBtn>
          <HeaderBtn label="Redo (Ctrl+Shift+Z)" disabled={!futureStates.length} onClick={() => redo()}>
            <Redo2 className="size-4" />
          </HeaderBtn>
          <HeaderBtn label="Revert to how it was when you opened it" onClick={revert} disabled={content === start}>
            <RotateCcw className="size-4" />
          </HeaderBtn>
          <button
            type="button"
            onClick={close}
            className="ms-1 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            <Check className="size-4" /> Done
          </button>
        </header>

        {/* ── Body ── */}
        <div className="relative flex min-h-0 flex-1">
          {!drawers && <aside className="w-64 shrink-0 overflow-y-auto border-e border-neutral-800 bg-neutral-900/60">{outline}</aside>}
          <main className="relative min-w-0 flex-1">
            <PopupProviders forms={forms}>
              <ComposerPreview
                theme={theme}
                onSelect={(id) => {
                  select(id);
                  if (drawers) setDrawer("inspector");
                }}
              />
            </PopupProviders>
          </main>
          {!drawers && (
            <aside
              className={`shrink-0 overflow-y-auto border-s border-neutral-800 bg-neutral-900/60 transition-[width] ${
                wide ? "w-[min(60rem,62vw)]" : "w-[22rem]"
              }`}
            >
              {inspector}
            </aside>
          )}

          {drawers && drawer && (
            <>
              <button
                type="button"
                aria-label="Close panel"
                className="absolute inset-0 z-10 bg-black/40"
                onClick={() => setDrawer(null)}
              />
              <aside
                className={`absolute inset-y-0 z-20 flex w-[min(26rem,92vw)] flex-col overflow-y-auto border-neutral-800 bg-neutral-900 shadow-2xl ${
                  drawer === "outline" ? "start-0 border-e" : "end-0 border-s"
                }`}
              >
                <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {drawer === "outline" ? "Blocks" : "Settings"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDrawer(null)}
                    aria-label="Close panel"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-neutral-800 hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {drawer === "outline" ? outline : inspector}
              </aside>
            </>
          )}
        </div>
      </div>
    </InspectorContext.Provider>,
    document.body
  );
}

function HeaderBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-8 place-items-center rounded-md ${
        active ? "bg-neutral-700 text-foreground" : "text-neutral-300 hover:bg-neutral-800 hover:text-foreground"
      } disabled:opacity-35`}
    >
      {children}
    </button>
  );
}

function SegBtn({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`grid h-8 min-w-8 place-items-center px-2 text-xs font-semibold ${
        on ? "bg-neutral-200 text-neutral-900" : "text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}
