"use client";

// LandingHistoryDialog — version history for the current landing page. A port
// of the room editor's HistoryModal (components/editor/HistoryModal.tsx),
// retargeted at `website_page_backups` and rebuilt on the shadcn Dialog the
// rest of the landing editor uses.
//
//   - Named versions (is_pinned) are never auto-pruned; auto-backups are the
//     rolling last-20 saves written by saveLandingPage → recordPageBackup.
//   - Selecting a row previews that version with the REAL DrawnSection
//     renderer (scaled down), so what you see is what Restore brings back.
//   - Restore loads the version into the editor via the store's restorePage
//     (marks dirty; Undo reverts it). Nothing is written until the user Saves —
//     same contract as the room editor and the draft-restore banner.
//
// Every confirm is inline (no window.confirm — Gotcha №29).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bookmark,
  BookmarkX,
  Check,
  Clock,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DrawnSection from "@/components/landing/DrawnSection";
import {
  useLandingEditorStore,
  selectCurrentDrawnPage,
} from "@/stores/landingEditorStore";
import {
  listPageBackups,
  createNamedVersion,
  updateBackupLabel,
  deleteBackup,
  type PageBackupRow,
} from "@/lib/landingEditorData";
import { sectionHiddenReason } from "@/data/sectionVisibility";
import { useMinuteClock } from "@/lib/useMinuteClock";
import type { DrawnPage } from "@/data/landingTypes";

// ─── Diff summary ───────────────────────────────────────────

interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
}

/** Section-level diff between two versions of a page (keyed by section iid). */
function summarize(prev: DrawnPage, next: DrawnPage): DiffSummary {
  const prevById = new Map(prev.sections.map((s) => [s.iid, s]));
  const nextById = new Map(next.sections.map((s) => [s.iid, s]));
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const [iid, n] of nextById) {
    const p = prevById.get(iid);
    if (!p) added++;
    else if (JSON.stringify(p) !== JSON.stringify(n)) modified++;
  }
  for (const iid of prevById.keys()) if (!nextById.has(iid)) removed++;
  return { added, removed, modified };
}

function describeDiff(d: DiffSummary, reordered: boolean): string {
  const parts = [
    d.added && `${d.added} section${d.added === 1 ? "" : "s"} added`,
    d.removed && `${d.removed} removed`,
    d.modified && `${d.modified} edited`,
  ].filter(Boolean);
  if (parts.length === 0) return reordered ? "sections reordered" : "no section changes";
  return parts.join(", ");
}

function sameOrder(a: DrawnPage, b: DrawnPage): boolean {
  const ai = a.sections.map((s) => s.iid).filter((id) => b.sections.some((s) => s.iid === id));
  const bi = b.sections.map((s) => s.iid).filter((id) => a.sections.some((s) => s.iid === id));
  return ai.join() === bi.join();
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── Dialog ─────────────────────────────────────────────────

export function LandingHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const page = useLandingEditorStore(selectCurrentDrawnPage);
  const versionId = useLandingEditorStore((s) =>
    s.currentPageSlug ? s.allPages[s.currentPageSlug]?.versionId : undefined
  );
  const versionName = useLandingEditorStore((s) =>
    s.currentPageSlug ? s.versions[s.currentPageSlug]?.find((v) => v.id === versionId)?.name : undefined
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4" /> Save history
            {page && <span className="text-muted-foreground">— {page.slug}{versionName ? ` · ${versionName}` : ""}</span>}
          </DialogTitle>
          <DialogDescription>
            Every Save of {versionName ? `“${versionName}”` : "this page"} keeps a backup (the last 20). Name one to keep it
            forever. Restoring loads it into the editor — Save to make it stick,
            or Undo to back out.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by page iid and mounted only while open, so every open starts
            from a fresh "loading" state instead of resetting state in an
            effect (react-hooks/set-state-in-effect — Gotcha №20). */}
        {open && page && (
          <HistoryBody
            key={`${page.iid}:${versionId ?? ""}`}
            page={page}
            versionId={versionId}
            onDone={() => onOpenChange(false)}
          />
        )}
        {open && !page && (
          <p className="text-sm text-muted-foreground">No page loaded.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type RowMode =
  | { kind: "idle" }
  | { kind: "rename"; id: string; value: string }
  | { kind: "delete"; id: string };

function HistoryBody({
  page,
  versionId,
  onDone,
}: {
  page: DrawnPage;
  /** Scope history to this version (undefined before versions existed). */
  versionId?: string;
  onDone: () => void;
}) {
  const restorePage = useLandingEditorStore((s) => s.restorePage);

  const [backups, setBackups] = useState<PageBackupRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rowMode, setRowMode] = useState<RowMode>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  // Save-current-as-named-version form.
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  const reload = async () => {
    const res = await listPageBackups(page.iid, versionId);
    setBackups(res.rows);
    setLoadError(res.error ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listPageBackups(page.iid, versionId);
      if (cancelled) return;
      setBackups(res.rows);
      setLoadError(res.error ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [page.iid, versionId]);

  const { pinned, unpinned } = useMemo(
    () => ({
      pinned: (backups ?? []).filter((b) => b.isPinned),
      unpinned: (backups ?? []).filter((b) => !b.isPinned),
    }),
    [backups]
  );

  // Each auto-backup diffed against the next-newer one (the newest against
  // what's in the editor now), so a row reads as "what that save changed".
  const diffs = useMemo(
    () =>
      unpinned.map((row, i) => {
        const newer = i === 0 ? page : unpinned[i - 1].config;
        return describeDiff(summarize(row.config, newer), !sameOrder(row.config, newer));
      }),
    [unpinned, page]
  );

  const selected = backups?.find((b) => b.id === selectedId) ?? null;

  const restore = (row: PageBackupRow) => {
    // Backups are keyed by page iid, so one taken before a rename still
    // carries the OLD slug — keep the page's current slug/iid.
    restorePage({ ...row.config, slug: page.slug, iid: page.iid });
    toast.success(
      row.label ? `Loaded “${row.label}”.` : "Backup loaded.",
      { description: "Save to make it permanent, or Undo to go back." }
    );
    onDone();
  };

  const saveAsVersion = async () => {
    const label = labelInput.trim();
    if (!label) return;
    setBusy(true);
    const res = await createNamedVersion(page, label, versionId);
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't save version", { description: res.error });
      return;
    }
    toast.success(`Saved “${label}” as a named version.`);
    setLabelInput("");
    setShowSaveForm(false);
    await reload();
  };

  const commitRename = async (id: string, value: string) => {
    const label = value.trim();
    if (!label) return;
    setBusy(true);
    const res = await updateBackupLabel(id, label, true);
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't rename version", { description: res.error });
      return;
    }
    setRowMode({ kind: "idle" });
    await reload();
  };

  // Unpin = back into the rolling window (label cleared, same as the room
  // editor's "clear the label to unpin"). It may get pruned on a later save.
  const unpin = async (row: PageBackupRow) => {
    setBusy(true);
    const res = await updateBackupLabel(row.id, null, false);
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't unpin version", { description: res.error });
      return;
    }
    await reload();
  };

  const confirmDelete = async (id: string) => {
    setBusy(true);
    const res = await deleteBackup(id);
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't delete", { description: res.error });
      return;
    }
    if (selectedId === id) setSelectedId(null);
    setRowMode({ kind: "idle" });
    await reload();
  };

  const rowActions = (row: PageBackupRow) => {
    if (rowMode.kind === "delete" && rowMode.id === row.id) {
      return (
        <div className="flex items-center gap-1 text-[11px] text-red-300">
          Delete?
          <Button size="xs" variant="destructive" disabled={busy} onClick={() => void confirmDelete(row.id)}>
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setRowMode({ kind: "idle" })}>
            Cancel
          </Button>
        </div>
      );
    }
    return (
      <div className="flex shrink-0 items-center gap-1">
        {row.isPinned ? (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              title="Rename"
              onClick={() => setRowMode({ kind: "rename", id: row.id, value: row.label ?? "" })}
            >
              <Pencil />
            </Button>
            <Button size="icon-xs" variant="ghost" title="Unpin (return to auto history)" disabled={busy} onClick={() => void unpin(row)}>
              <BookmarkX />
            </Button>
          </>
        ) : (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Name this version (keeps it forever)"
            onClick={() => setRowMode({ kind: "rename", id: row.id, value: "" })}
          >
            <Bookmark />
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" title="Delete" onClick={() => setRowMode({ kind: "delete", id: row.id })}>
          <Trash2 />
        </Button>
        <Button size="xs" variant="secondary" onClick={() => restore(row)}>
          <RotateCcw /> Restore
        </Button>
      </div>
    );
  };

  const renderRow = (row: PageBackupRow, subtitle: string) => {
    const isSel = row.id === selectedId;
    const renaming = rowMode.kind === "rename" && rowMode.id === row.id;
    return (
      <li
        key={row.id}
        className={`flex items-center gap-2 border-b border-border px-3 py-2 last:border-0 ${
          isSel ? "bg-accent" : "hover:bg-accent/50"
        }`}
      >
        {renaming ? (
          <div className="flex flex-1 gap-1">
            <Input
              autoFocus
              value={rowMode.value}
              placeholder='e.g. "Before redesign"'
              onChange={(e) => setRowMode({ ...rowMode, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename(row.id, rowMode.value);
                if (e.key === "Escape") setRowMode({ kind: "idle" });
              }}
              className="h-7"
            />
            <Button size="icon-xs" variant="secondary" disabled={busy || !rowMode.value.trim()} onClick={() => void commitRename(row.id, rowMode.value)} title="Save name">
              <Check />
            </Button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSelectedId(row.id)}
              className="min-w-0 flex-1 text-left"
              title="Preview this version"
            >
              <div className="truncate text-sm">
                {row.label ?? formatTimestamp(row.savedAt)}
              </div>
              <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
            </button>
            {rowActions(row)}
          </>
        )}
      </li>
    );
  };

  return (
    <div className="grid max-h-[70dvh] grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ── List ── */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Bookmark className="size-3" /> Named versions
          </span>
          {!showSaveForm && (
            <Button size="xs" variant="ghost" onClick={() => setShowSaveForm(true)}>
              + Save current state
            </Button>
          )}
        </div>
        {showSaveForm && (
          <div className="flex gap-1 border-b border-border p-2">
            <Input
              autoFocus
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveAsVersion();
                if (e.key === "Escape") {
                  setShowSaveForm(false);
                  setLabelInput("");
                }
              }}
              placeholder='e.g. "Launch version"'
              className="h-7"
            />
            <Button size="xs" disabled={busy || !labelInput.trim()} onClick={() => void saveAsVersion()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setShowSaveForm(false);
                setLabelInput("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {backups === null && !loadError && (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {loadError && (
            <p className="px-3 py-4 text-sm text-destructive">
              Couldn&apos;t load history: {loadError}
            </p>
          )}
          {backups !== null && !loadError && (
            <>
              {pinned.length === 0 && !showSaveForm && (
                <p className="px-3 py-2 text-xs italic text-muted-foreground">
                  No named versions yet. Save one before a big change so you can
                  always get back to it.
                </p>
              )}
              <ul>{pinned.map((row) => renderRow(row, formatTimestamp(row.savedAt)))}</ul>

              <div className="flex items-center gap-1.5 border-y border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <RotateCcw className="size-3" /> Auto history
              </div>
              {unpinned.length === 0 && (
                <p className="px-3 py-2 text-xs italic text-muted-foreground">
                  No saves yet — the next Save creates the first backup.
                </p>
              )}
              <ul>{unpinned.map((row, i) => renderRow(row, diffs[i] ?? ""))}</ul>
            </>
          )}
        </div>
      </div>

      {/* ── Preview ── */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {selected
            ? `Preview — ${selected.label ?? formatTimestamp(selected.savedAt)}`
            : "Preview"}
        </div>
        {selected ? (
          <VersionPreview page={selected.config} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Select a version to preview it.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Preview ────────────────────────────────────────────────

// Design width the preview lays sections out at before `zoom` shrinks them, so
// the percentage/cqw-based layout matches a real desktop render rather than
// collapsing into the mobile @container rules at the pane's narrow width.
const PREVIEW_DESIGN_WIDTH = 1200;

function VersionPreview({ page }: { page: DrawnPage }) {
  const now = useMinuteClock();
  // Scale the design-width layout to exactly fill the pane (a fixed zoom left
  // a blank gutter whenever the pane was wider than 1200 × zoom). Measured via
  // a ResizeObserver on a callback ref — setState in the observer callback,
  // not in an effect body (react-hooks/set-state-in-effect).
  const [zoom, setZoom] = useState(0.36);
  const paneRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setZoom(el.clientWidth / PREVIEW_DESIGN_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white">
      <div
        className="pointer-events-none select-none"
        style={{ width: PREVIEW_DESIGN_WIDTH, zoom }}
        aria-hidden="true"
        inert
      >
        {page.sections.length === 0 && (
          <div className="p-24 text-center text-5xl text-neutral-400">
            This version has no sections.
          </div>
        )}
        {page.sections.map((section) => {
          const reason = sectionHiddenReason(section, now, "desktop");
          return (
            <div key={section.iid} className="relative">
              {section.containsGame ? (
                <div className="flex h-[480px] items-center justify-center bg-neutral-200 text-5xl text-neutral-500">
                  Arcade (game)
                </div>
              ) : (
                <DrawnSection section={section} />
              )}
              {reason && (
                <div className="absolute inset-0 z-[999] bg-neutral-900/45">
                  <span className="absolute right-6 top-6 rounded bg-amber-500 px-6 py-2 text-4xl font-medium text-black">
                    {reason}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
