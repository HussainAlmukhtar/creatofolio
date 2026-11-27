"use client";

// StyleEditor — edit ONE theme or frame (/admin/popup-styles?item=<iid>).
//
//   header   back · name (EN/AR) · status · undo/redo · History · Save draft · Publish · ⋯
//   left     the drawable parts (theme) or the frame drawing + its screen
//   centre   live preview (StylePreview) wearing the edited config
//
// Saving writes the item's DRAFT (with its updated_at token: someone else
// saving meanwhile → "keep mine / load theirs"). Publish = the
// publish_popup_style RPC (draft → live; the previous live version goes to
// History). Visitors see a theme only once it is published AND made active;
// a frame once it is published and a pop-up picks it. Items are archive-only.

import { useBackSwipeGuard } from "@/lib/useBackSwipeGuard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  History,
  Redo2,
  Save,
  Send,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  FRAME_CANVAS,
  THEME_PARTS,
  type PopupFrameConfig,
  type PopupLook,
  type PopupThemeConfig,
} from "@/data/popupStyleTypes";
import {
  discardPopupStyleDraft,
  duplicatePopupStyle,
  listPopupStyleBackups,
  loadPopupStyleForEditor,
  publishPopupStyle,
  renamePopupStyle,
  savePopupStyleDraft,
  setActivePopupTheme,
  setPopupStyleArchived,
  type StyleBackup,
} from "@/lib/popupStyles";
import { frameGuide, partGuide } from "@/lib/popupStyleGuides";
import { findScreenHole } from "@/lib/frameHole";
import { usePopupStyleEditorStore } from "@/stores/popupStyleEditorStore";
import { usePopupStyles } from "@/components/popup/PopupLook";
import { useDialog } from "@/components/editor/useDialog";
import { useChoiceDialog } from "@/components/editor/useChoiceDialog";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { Slider } from "@/components/ui/slider";
import { ArtPicker } from "./ArtPicker";
import { SliceEditor } from "./SliceEditor";
import { ScreenEditor } from "./ScreenEditor";
import { StylePreview } from "./StylePreview";
import "./popupStyles.css";

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export function StyleEditor({ iid, onBack, onOpen }: { iid: string; onBack: () => void; onOpen: (iid: string) => void }) {
  const row = usePopupStyleEditorStore((s) => s.row);
  const config = usePopupStyleEditorStore((s) => s.config);
  const savedConfig = usePopupStyleEditorStore((s) => s.savedConfig);
  const draftUpdatedAt = usePopupStyleEditorStore((s) => s.draftUpdatedAt);
  const { undo, redo, pastStates, futureStates } = useStore(usePopupStyleEditorStore.temporal);
  const { styles } = usePopupStyles();
  const { confirm, dialog } = useDialog();
  const { choose, dialog: choiceDialog } = useChoiceDialog();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<StyleBackup[] | null>(null);
  const dirty = !!config && config !== savedConfig;

  const reload = useCallback(async () => {
    const res = await loadPopupStyleForEditor(iid);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    usePopupStyleEditorStore.getState().load(res.data.row, res.data.config, res.data.draftUpdatedAt);
    requestAnimationFrame(() => usePopupStyleEditorStore.getState().settle());
  }, [iid]);

  useEffect(() => {
    void reload();
    return () => usePopupStyleEditorStore.setState({ row: null, config: null, savedConfig: null, draftUpdatedAt: null });
  }, [reload]);

  // Unsaved work survives an accidental close/reload prompt.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  // iPad edge-swipe "back" skips beforeunload.
  useBackSwipeGuard(dirty);

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      const st = usePopupStyleEditorStore.getState();
      if (!st.config || !st.row) return false;
      setBusy(true);
      try {
        const res = await savePopupStyleDraft(st.row.iid, st.config, { expected: st.draftUpdatedAt, force });
        if (res.ok) {
          usePopupStyleEditorStore.getState().markSaved(res.updatedAt ?? null, st.config);
          return true;
        }
        if (res.code === "conflict") {
          const pick = await choose({
            title: "This draft changed somewhere else",
            body: "Another tab (or device) saved this item's draft after you opened it. Keep your version, or load theirs?",
            options: [
              { id: "mine", label: "Overwrite with mine", primary: true },
              { id: "theirs", label: "Load theirs" },
              { id: "cancel", label: "Cancel" },
            ],
          });
          if (pick === "mine") return save(true);
          if (pick === "theirs") await reload();
          return false;
        }
        toast.error("Couldn't save the draft", { description: res.error });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [choose, reload]
  );

  const publish = async (force = false) => {
    const st = usePopupStyleEditorStore.getState();
    if (!st.row || !st.config) return;
    // Publish needs a saved draft: save what's on screen first.
    if (st.config !== st.savedConfig || !st.draftUpdatedAt) {
      if (!(await save())) return;
    }
    setBusy(true);
    try {
      const res = await publishPopupStyle(st.row.iid, force ? null : st.row.updatedAt);
      if (res.ok) {
        toast.success(
          st.row.kind === "theme"
            ? st.row.isActive
              ? "Published. Visitors now see this theme."
              : "Published. Make it active to use it on the site."
            : "Published. Pop-ups can now pick this frame."
        );
        await reload();
        return;
      }
      if (res.code === "conflict") {
        const pick = await choose({
          title: "The live version changed",
          body: "This item was published somewhere else since you opened it. Publish your draft over it anyway? (The version it replaces goes to History.)",
          options: [
            { id: "go", label: "Publish anyway", primary: true },
            { id: "cancel", label: "Cancel" },
          ],
        });
        if (pick === "go") await publish(true);
        return;
      }
      toast.error("Couldn't publish", { description: res.error });
    } finally {
      setBusy(false);
    }
  };

  // Ctrl+S saves; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo]);

  const look = useMemo<PopupLook>(() => {
    if (!row || !config) return { theme: null, frame: null };
    return row.kind === "theme"
      ? { theme: config as PopupThemeConfig, frame: null }
      : { theme: styles.theme, frame: config as PopupFrameConfig };
  }, [row, config, styles.theme]);

  if (error) {
    return (
      <div className="p-6">
        <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white">
          <ArrowLeft className="size-4" /> Back to the library
        </button>
        <p className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>
      </div>
    );
  }
  if (!row || !config) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;

  const back = async () => {
    if (dirty && !(await confirm("Leave without saving? Your unsaved changes to this item will be lost.", { confirmLabel: "Leave", danger: true }))) return;
    onBack();
  };

  const status = row.archivedAt
    ? "Archived"
    : !row.publishedAt
      ? "Never published"
      : row.kind === "theme" && row.isActive
        ? "Live · active theme"
        : "Published";

  return (
    <div className="flex h-dvh flex-col">
      {/* ── Header ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
        <button
          type="button"
          onClick={back}
          aria-label="Back to the library"
          className="grid size-8 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 touch:size-11"
        >
          <ArrowLeft className="size-4" />
        </button>
        <NameFields key={row.iid + row.name + row.nameAr} iid={row.iid} name={row.name} nameAr={row.nameAr} />
        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300">
          {row.kind === "theme" ? "Theme" : "Frame"} · {status}
        </span>
        {draftUpdatedAt && !dirty && <span className="text-[11px] text-amber-300">Unpublished draft</span>}
        {dirty && <span className="text-[11px] text-amber-300">Unsaved changes</span>}

        <span className="ms-auto" />
        <IconBtn label="Undo (Ctrl+Z)" disabled={!pastStates.length} onClick={() => undo()}>
          <Undo2 className="size-4" />
        </IconBtn>
        <IconBtn label="Redo (Ctrl+Shift+Z)" disabled={!futureStates.length} onClick={() => redo()}>
          <Redo2 className="size-4" />
        </IconBtn>
        <IconBtn
          label="History"
          onClick={async () => setHistory(await listPopupStyleBackups(row.iid, row.kind))}
        >
          <History className="size-4" />
        </IconBtn>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40"
        >
          <Save className="size-4" /> Save draft
        </button>
        <button
          type="button"
          disabled={busy || (!dirty && !draftUpdatedAt)}
          onClick={() => void publish()}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          <Send className="size-4" /> Publish
        </button>
        <OverflowMenu
          label="More"
          align="end"
          triggerClassName="grid size-8 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 touch:size-11"
          items={[
            {
              label: "Duplicate",
              icon: Copy,
              onSelect: async () => {
                const res = await duplicatePopupStyle(row, config);
                if (res.ok && res.iid) {
                  toast.success("Copied. You're now editing the copy.");
                  onOpen(res.iid);
                } else toast.error("Couldn't duplicate", { description: res.error });
              },
            },
            ...(row.kind === "theme"
              ? [
                  row.isActive
                    ? {
                        label: "Stop using this theme",
                        icon: Sparkles,
                        onSelect: async () => {
                          if (!(await confirm("Every pop-up goes back to the built-in look. Continue?", { confirmLabel: "Stop using it" }))) return;
                          const res = await setActivePopupTheme(null);
                          if (res.ok) await reload();
                          else toast.error("Couldn't change the active theme", { description: res.error });
                        },
                      }
                    : {
                        label: "Make this the active theme",
                        icon: Sparkles,
                        disabled: !row.publishedAt || !!row.archivedAt,
                        onSelect: async () => {
                          if (
                            !(await confirm(
                              "Every visitor's pop-ups (game and landing pages) will wear this theme's published version. Continue?",
                              { confirmLabel: "Make it active" }
                            ))
                          )
                            return;
                          const res = await setActivePopupTheme(row.iid);
                          if (res.ok) {
                            toast.success("This is now the active theme.");
                            await reload();
                          } else toast.error("Couldn't make it active", { description: res.error });
                        },
                      },
                ]
              : []),
            row.archivedAt
              ? {
                  label: "Unarchive",
                  icon: ArchiveRestore,
                  onSelect: async () => {
                    const res = await setPopupStyleArchived(row.iid, false);
                    if (res.ok) await reload();
                    else toast.error("Couldn't unarchive", { description: res.error });
                  },
                }
              : {
                  label: "Archive",
                  icon: Archive,
                  onSelect: async () => {
                    if (
                      !(await confirm(
                        row.kind === "frame"
                          ? "Archive this frame? Pop-ups already using it keep it; it just leaves the frame picker. You can unarchive it any time."
                          : "Archive this theme? It leaves the library list; you can unarchive it any time.",
                        { confirmLabel: "Archive" }
                      ))
                    )
                      return;
                    const res = await setPopupStyleArchived(row.iid, true);
                    if (res.ok) await reload();
                    else toast.error("Couldn't archive", { description: res.error });
                  },
                },
            { kind: "separator" as const },
            {
              label: "Discard the draft",
              icon: Trash2,
              danger: true,
              disabled: !draftUpdatedAt,
              onSelect: async () => {
                if (!(await confirm("Throw away the unpublished draft and go back to the live version?", { confirmLabel: "Discard draft", danger: true }))) return;
                const res = await discardPopupStyleDraft(row.iid);
                if (res.ok) await reload();
                else toast.error("Couldn't discard", { description: res.error });
              },
            },
          ]}
        />
      </header>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="max-h-[45dvh] shrink-0 overflow-y-auto border-neutral-800 bg-neutral-900/40 p-3 lg:max-h-none lg:w-[26rem] lg:border-e">
          {row.kind === "theme" ? <ThemeParts /> : <FrameParts />}
        </aside>
        <main className="relative min-h-[24rem] min-w-0 flex-1">
          <StylePreview look={look} />
        </main>
      </div>

      {history && (
        <HistoryDialog
          backups={history}
          onClose={() => setHistory(null)}
          onLoad={(b) => {
            usePopupStyleEditorStore.getState().replaceConfig(b.config);
            setHistory(null);
            toast.success("Loaded into the draft. Save draft, then Publish to put it live.");
          }}
        />
      )}
      {dialog}
      {choiceDialog}
    </div>
  );
}

// ─── Theme parts ────────────────────────────────────────────────

function ThemeParts() {
  const config = usePopupStyleEditorStore((s) => s.config) as PopupThemeConfig;
  const { setPart, setSlice, setDialogueSlice, setThemeField } = usePopupStyleEditorStore.getState();
  const groups: { id: string; title: string }[] = [
    { id: "sheet", title: "The pop-up" },
    { id: "pages", title: "Pages (magazines)" },
    { id: "dialogue", title: "Dialogue box (characters)" },
  ];
  const panel = config.parts.panel;
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.id} className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{g.title}</h3>
          {THEME_PARTS.filter((p) => p.group === g.id).map((p) => (
            <div key={p.key} className="space-y-2">
              <ArtPicker
                label={p.label}
                hint={p.hint}
                art={config.parts[p.key]}
                canvas={p.canvas}
                guide={() =>
                  partGuide(
                    p.key,
                    p.canvas,
                    p.key === "panel" ? config.panelSlice : p.key === "dialogueBox" ? config.dialogueSlice : undefined
                  )
                }
                onChange={(art) => setPart(p.key, art)}
              />
              {p.key === "dialogueBox" && config.parts.dialogueBox && (
                <div className="space-y-2 rounded-lg border border-neutral-800 p-3">
                  <p className="text-xs text-neutral-300">
                    Drag the red lines to where the box&apos;s corners end: corners stay as drawn, the middle stretches
                    across the screen. Shown at the panel&apos;s edge size.
                  </p>
                  <SliceEditor art={config.parts.dialogueBox} slice={config.dialogueSlice} onChange={setDialogueSlice} />
                </div>
              )}
              {p.key === "panel" && panel && (
                <div className="space-y-3 rounded-lg border border-neutral-800 p-3">
                  <p className="text-xs text-neutral-300">
                    Drag the red lines to where the panel&apos;s corners end. Corners stay as drawn; the parts between
                    stretch to fit any pop-up.
                  </p>
                  <SliceEditor art={panel} slice={config.panelSlice} onChange={setSlice} />
                  <label className="block space-y-1.5">
                    <span className="text-xs text-neutral-400">
                      Edge size on screen: {Math.round(config.panelScale * 100)}% of the drawing
                    </span>
                    <Slider
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={[config.panelScale]}
                      onValueChange={(v) => setThemeField({ panelScale: v[0] })}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">Edges between the corners</span>
                    <select
                      value={config.panelRepeat}
                      onChange={(e) => setThemeField({ panelRepeat: e.target.value as PopupThemeConfig["panelRepeat"] })}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
                    >
                      <option value="stretch">Stretch (smooth, simple edges)</option>
                      <option value="round">Repeat (keeps a hand-drawn edge&apos;s texture)</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <ColorField label="Text colour" value={config.ink} onChange={(ink) => setThemeField({ ink })} />
                    <ColorField label="Softer text" value={config.inkSoft} onChange={(inkSoft) => setThemeField({ inkSoft })} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ─── Frame ──────────────────────────────────────────────────────

function FrameParts() {
  const config = usePopupStyleEditorStore((s) => s.config) as PopupFrameConfig;
  const { setFrameArt, setScreen, setFrameField } = usePopupStyleEditorStore.getState();
  const [finding, setFinding] = useState(false);

  // Read the drawing's see-through screen hole and fit the screen to it.
  const findHole = async (url: string, quiet = false) => {
    setFinding(true);
    try {
      const hole = await findScreenHole(url);
      if (hole) {
        setFrameField({ screen: hole, artOver: true });
        if (!quiet) toast.success("Found the screen in your drawing and fitted the content to it.");
      } else if (!quiet) {
        toast("No see-through screen found", {
          description: "Erase the screen area to transparent in the drawing for the neatest fit, or place the box by hand.",
        });
      } else {
        setFrameField({ artOver: false });
      }
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="space-y-4">
      <ArtPicker
        label="Frame drawing"
        hint="A TV, a book, a window… Leave the screen see-through (erase it to transparent): the pop-up shows through it, and your drawn edges frame it."
        art={config.art}
        canvas={FRAME_CANVAS}
        guide={() => frameGuide(FRAME_CANVAS, config.screen)}
        onChange={(art) => {
          setFrameArt(art);
          if (art) void findHole(art.url, true);
        }}
        defaultLabel="Not drawn yet"
        thumbClass="size-20"
      />
      {config.art ? (
        <section className="space-y-3 rounded-lg border border-neutral-800 p-3">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">The screen</h3>
            <button
              type="button"
              disabled={finding}
              onClick={() => config.art && void findHole(config.art.url)}
              className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
            >
              {finding ? "Looking…" : "Find the screen in my drawing"}
            </button>
          </div>
          <p className="text-xs text-neutral-300">
            {config.artOver
              ? "Your drawing sits on top: its see-through screen shows the pop-up and its edges frame it. Fine-tune the box if you like (it tucks just under the edges)."
              : "Drag the box over the screen in your drawing; drag a corner to resize it."}
          </p>
          <ScreenEditor art={config.art} screen={config.screen} onChange={setScreen} />
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={config.artOver}
              onChange={(e) => setFrameField({ artOver: e.target.checked })}
            />
            Drawing on top of the content (needs a see-through screen)
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-neutral-400">Screen corners: {Math.round(config.radius)} px</span>
            <Slider
              min={0}
              max={160}
              step={2}
              value={[config.radius]}
              onValueChange={(v) => setFrameField({ radius: v[0] })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={config.glass} onChange={(e) => setFrameField({ glass: e.target.checked })} />
            Glass (a soft shadow and sheen on the screen)
          </label>
        </section>
      ) : (
        <p className="text-xs text-neutral-400">Draw or upload the frame first, then mark its screen.</p>
      )}
      <section className="space-y-3 rounded-lg border border-neutral-800 p-3">
        <label className="block space-y-1">
          <span className="text-xs text-neutral-400">On phones</span>
          <select
            value={config.phone}
            onChange={(e) => setFrameField({ phone: e.target.value as PopupFrameConfig["phone"] })}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            <option value="sheet">Plain card from the bottom (easier to read)</option>
            <option value="keep">Keep the frame (scaled to fit)</option>
          </select>
          {config.phone === "keep" && Math.round(350 * (config.screen.w / 100)) < 280 && (
            <p className="text-[11px] text-amber-300 touch:text-[13px]">
              On a phone this screen is only about {Math.round(350 * (config.screen.w / 100))} px wide, so text gets
              cramped. The plain card reads better unless the screen is most of the drawing.
            </p>
          )}
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-neutral-400">Text on the screen</span>
          <select
            value={config.ink}
            onChange={(e) => setFrameField({ ink: e.target.value as PopupFrameConfig["ink"] })}
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            <option value="dark">Dark ink (light screen)</option>
            <option value="light">Light ink (dark screen)</option>
          </select>
        </label>
        <ColorField
          label="Screen colour (blank = paper)"
          value={config.background === "transparent" ? "" : config.background}
          onChange={(background) => setFrameField({ background })}
        />
      </section>
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────

function NameFields({ iid, name, nameAr }: { iid: string; name: string; nameAr: string }) {
  const [en, setEn] = useState(name);
  const [ar, setAr] = useState(nameAr);
  const commit = async () => {
    if (en === name && ar === nameAr) return;
    const res = await renamePopupStyle(iid, en.trim(), ar.trim());
    if (res.ok) {
      const st = usePopupStyleEditorStore.getState();
      if (st.row) st.setRow({ ...st.row, name: en.trim(), nameAr: ar.trim() });
    } else toast.error("Couldn't rename", { description: res.error });
  };
  return (
    <div className="flex min-w-0 gap-1.5">
      <input
        value={en}
        onChange={(e) => setEn(e.target.value)}
        onBlur={commit}
        placeholder="Name"
        aria-label="Name (English)"
        className="w-40 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm font-semibold"
      />
      <input
        value={ar}
        onChange={(e) => setAr(e.target.value)}
        onBlur={commit}
        dir="rtl"
        placeholder="الاسم"
        aria-label="Name (Arabic)"
        className="w-32 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="flex gap-1.5">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#2b2420"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 shrink-0 rounded border border-neutral-700 bg-transparent"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="default"
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-xs"
        />
      </span>
    </label>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 disabled:opacity-35 touch:size-11"
    >
      {children}
    </button>
  );
}

function HistoryDialog({
  backups,
  onClose,
  onLoad,
}: {
  backups: StyleBackup[];
  onClose: () => void;
  onLoad: (b: StyleBackup) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="History"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl"
      >
        <h2 className="text-sm font-semibold">History</h2>
        <p className="text-xs text-neutral-400">
          Each Publish keeps the version it replaced (the last 20). Loading one puts it into your draft; nothing goes
          live until you Publish.
        </p>
        {backups.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-400">Nothing yet: history starts with the second Publish.</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {backups.map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-800">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{b.label || "Saved version"}</span>
                  <span className="block text-[11px] text-neutral-500">{when(b.savedAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onLoad(b)}
                  className="rounded-md bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
                >
                  Load into draft
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
