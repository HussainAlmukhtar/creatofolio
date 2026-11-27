"use client";

// History modal — lists named versions (pinned, never pruned) and auto-backups
// (rolling 20 per room). Named versions can be activated in one click;
// auto-backups can be restored (loads into editor, user must save).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, RotateCcw, Clock, Bookmark, Play, Check, Pencil } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { useDialog } from "./useDialog";
import {
  listRoomBackups,
  restoreRoomBackup,
  createNamedVersion,
  updateBackupLabel,
  activateNamedVersion,
  type RoomBackupRow,
  type RoomBackupKind,
} from "@/lib/editorData";
import type { RoomConfig } from "@/data/roomTypes";
import { Tooltip, InfoTip } from "@/components/editor/EditorTooltip";

interface HistoryModalProps {
  onClose: () => void;
}

interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
}

function summarize(prev: RoomConfig, next: RoomConfig): DiffSummary {
  const prevById = new Map((prev.objects ?? []).map((o) => [o.iid ?? o.id, o]));
  const nextById = new Map((next.objects ?? []).map((o) => [o.iid ?? o.id, o]));
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const [k, n] of nextById) {
    const p = prevById.get(k);
    if (!p) {
      added++;
    } else if (JSON.stringify(p) !== JSON.stringify(n)) {
      modified++;
    }
  }
  for (const k of prevById.keys()) {
    if (!nextById.has(k)) removed++;
  }
  return { added, removed, modified };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function HistoryModal({ onClose }: HistoryModalProps) {
  const { confirm, dialog } = useDialog();
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);
  // With drafts, "restore" / "activate" load the version into the DRAFT (marked
  // unsaved); nothing goes live until Publish.
  const draftsAvailable = useEditorStore((s) => s.draftsAvailable);
  // Keyed by room so a different room shows "loading" until its rows arrive.
  const [loadedBackups, setLoadedBackups] = useState<{
    roomIid: string;
    rows: RoomBackupRow[];
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Save-as-version form
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);

  // Inline label editing
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelValue, setEditingLabelValue] = useState("");

  // Activation busy state
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const roomIid = currentRoomConfig?.iid ?? null;
  const backups: RoomBackupRow[] | null = !roomIid
    ? []
    : loadedBackups?.roomIid === roomIid
      ? loadedBackups.rows
      : null;

  const reloadBackups = async () => {
    if (!roomIid) return;
    const rows = await listRoomBackups(roomIid, 80);
    setLoadedBackups({ roomIid, rows });
  };

  useEffect(() => {
    if (!roomIid) return;
    let cancelled = false;
    void (async () => {
      const rows = await listRoomBackups(roomIid, 80);
      if (!cancelled) setLoadedBackups({ roomIid, rows });
    })();
    return () => {
      cancelled = true;
    };
  }, [roomIid]);

  const { pinned, unpinned } = useMemo(() => {
    if (!backups) return { pinned: [], unpinned: [] };
    return {
      pinned: backups.filter((b) => b.isPinned),
      unpinned: backups.filter((b) => !b.isPinned),
    };
  }, [backups]);

  // Diff for unpinned rows only (compare against next newer in the list)
  const unpinnedDiffs = useMemo<DiffSummary[]>(() => {
    if (!currentRoomConfig) return [];
    return unpinned.map((row, i) => {
      const next = i === 0 ? currentRoomConfig : unpinned[i - 1].config;
      return summarize(row.config, next);
    });
  }, [unpinned, currentRoomConfig]);

  const restore = async (id: string) => {
    setBusyId(id);
    const cfg = await restoreRoomBackup(id);
    setBusyId(null);
    if (!cfg) {
      toast.error("Could not load backup.");
      return;
    }
    useEditorStore.getState().replaceCurrentRoom(cfg, true);
    toast.success(
      draftsAvailable
        ? "Loaded into the draft — Save it, then Publish to make it live."
        : "Backup loaded — remember to save."
    );
    onClose();
  };

  const saveAsVersion = async () => {
    if (!labelInput.trim() || !currentRoomConfig) return;
    setSavingVersion(true);
    const res = await createNamedVersion(currentRoomConfig, labelInput.trim());
    setSavingVersion(false);
    if (!res.ok) {
      toast.error(`Could not save version: ${res.error}`);
      return;
    }
    toast.success(`Saved "${labelInput.trim()}" as a named version.`);
    setLabelInput("");
    setShowSaveForm(false);
    await reloadBackups();
  };

  const activateVersion = async (row: RoomBackupRow) => {
    if (!currentRoomConfig) return;
    if (draftsAvailable) {
      // Into the draft, not live: no backup or confirm needed — Publish does both.
      setActivatingId(row.id);
      const cfg = await restoreRoomBackup(row.id);
      setActivatingId(null);
      if (!cfg) {
        toast.error("Could not load that version.");
        return;
      }
      useEditorStore.getState().replaceCurrentRoom(cfg, true);
      toast.success(`"${row.label}" loaded into the draft. Save it, then Publish to make it live.`);
      onClose();
      return;
    }
    const confirmed = await confirm(
      `Activate "${row.label}"?\n\nThe current live state will be auto-saved as a backup first so you can revert.`,
      { confirmLabel: "Activate" }
    );
    if (!confirmed) return;
    setActivatingId(row.id);
    const res = await activateNamedVersion(row.id, currentRoomConfig);
    setActivatingId(null);
    if (!res.ok) {
      toast.error(`Activation failed: ${res.error}`);
      return;
    }
    useEditorStore.getState().replaceCurrentRoom(res.config!, false);
    // The activation wrote the row: take its new updated_at or the next Save
    // would report a conflict with ourselves.
    await useEditorStore.getState().refreshRoomRevisions();
    toast.success(`"${row.label}" is now live.`);
    onClose();
  };

  const startEditLabel = (row: RoomBackupRow) => {
    setEditingLabelId(row.id);
    setEditingLabelValue(row.label ?? "");
  };

  const commitLabelEdit = async (id: string) => {
    const newLabel = editingLabelValue.trim() || null;
    const isPinned = newLabel !== null;
    const res = await updateBackupLabel(id, newLabel, isPinned);
    if (!res.ok) {
      toast.error("Label update failed.");
      return;
    }
    setEditingLabelId(null);
    await reloadBackups();
  };

  return (
    <>
    {dialog}
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-h-[85dvh] overflow-hidden rounded-lg bg-slate-800 text-slate-100 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2 font-semibold">
            <Clock className="h-4 w-4" />
            History — {currentRoomConfig?.name ?? currentRoomConfig?.id ?? "?"}
          </div>
          <Tooltip label="Close" shortcut="Esc">
            <button onClick={onClose} className="rounded p-1 hover:bg-slate-700">
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <div className="overflow-y-auto flex-1">
          {!roomIid && (
            <div className="px-4 py-6 text-sm text-slate-400">
              This room has not been saved yet. Save it once to start collecting backups.
            </div>
          )}

          {backups === null && roomIid && (
            <div className="px-4 py-6 text-sm text-slate-400">Loading…</div>
          )}

          {backups !== null && roomIid && (
            <>
              {/* ── Named Versions ── */}
              <div className="border-b border-slate-700 px-4 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Bookmark className="h-3 w-3" /> Named Versions
                    <InfoTip label="Pinned snapshots that are never auto-pruned. Use them for seasonal swaps (e.g. Christmas) — load one into the draft, then Publish to switch the live room." />
                  </div>
                  {!showSaveForm && (
                    <button
                      onClick={() => setShowSaveForm(true)}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      + Save current state as version
                    </button>
                  )}
                </div>

                {showSaveForm && (
                  <div className="mt-2 flex gap-2">
                    <input
                      autoFocus
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveAsVersion();
                        if (e.key === "Escape") { setShowSaveForm(false); setLabelInput(""); }
                      }}
                      placeholder='e.g. "Christmas 2026" or "Normal"'
                      className="flex-1 rounded bg-slate-900 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => void saveAsVersion()}
                      disabled={!labelInput.trim() || savingVersion}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs hover:bg-blue-500 disabled:opacity-50"
                    >
                      {savingVersion ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => { setShowSaveForm(false); setLabelInput(""); }}
                      className="rounded bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {pinned.length === 0 && !showSaveForm && (
                <div className="px-4 py-3 text-xs text-slate-500 italic">
                  No named versions yet — use the button above to save one.
                </div>
              )}

              {pinned.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 last:border-0 bg-blue-950/20"
                >
                  <div className="min-w-0 flex-1">
                    {editingLabelId === row.id ? (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={editingLabelValue}
                          onChange={(e) => setEditingLabelValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitLabelEdit(row.id);
                            if (e.key === "Escape") setEditingLabelId(null);
                          }}
                          className="flex-1 rounded bg-slate-900 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => void commitLabelEdit(row.id)}
                          className="rounded bg-slate-700 p-1 hover:bg-slate-600"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{row.label}</span>
                        <button
                          onClick={() => startEditLabel(row)}
                          className="rounded p-0.5 text-slate-500 hover:text-slate-300"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <div className="text-xs text-slate-400">{formatTimestamp(row.savedAt)}</div>
                  </div>
                  <button
                    disabled={activatingId === row.id}
                    onClick={() => void activateVersion(row)}
                    className="flex items-center gap-1 rounded bg-blue-700 px-3 py-1 text-xs hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" />
                    {activatingId === row.id
                      ? draftsAvailable
                        ? "Loading…"
                        : "Activating…"
                      : draftsAvailable
                        ? "Load into draft"
                        : "Activate"}
                  </button>
                </div>
              ))}

              {/* ── Auto History ── */}
              <div className="border-b border-slate-700 px-4 py-2 mt-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <RotateCcw className="h-3 w-3" /> Auto History
                  <InfoTip label="Rolling window of the last 20 saves per room. Restoring loads the snapshot into the editor; save the draft, then Publish, to make it live." />
                </div>
              </div>

              {unpinned.length === 0 && (
                <div className="px-4 py-3 text-xs text-slate-500 italic">
                  No auto-backups yet. The next save will create one.
                </div>
              )}

              {unpinned.map((row, i) => {
                const d = unpinnedDiffs[i] ?? { added: 0, removed: 0, modified: 0 };
                const summary = [
                  d.added > 0 && `+${d.added}`,
                  d.removed > 0 && `-${d.removed}`,
                  d.modified > 0 && `~${d.modified}`,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        {formatTimestamp(row.savedAt)}
                        <KindBadge kind={row.kind} />
                      </div>
                      <div className="text-xs text-slate-400">{summary || "no object changes"}</div>
                    </div>
                    <button
                      disabled={busyId === row.id}
                      onClick={() => void restore(row.id)}
                      className="flex items-center gap-1 rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {busyId === row.id
                        ? "Loading…"
                        : draftsAvailable
                          ? "Load into draft"
                          : "Restore"}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-4 py-2 text-xs text-slate-400 shrink-0">
          Named versions are never pruned. Auto-backups are kept for the most recent 20 saves per room.
        </div>
      </div>
    </div>
    </>
  );
}

/** Why a snapshot exists: a direct save (also old rows with no kind), the live
 *  room a Publish replaced, or a named version. */
const KIND_BADGE: Record<RoomBackupKind, { text: string; cls: string; title: string }> = {
  saved: { text: "Saved", cls: "bg-slate-700 text-slate-300", title: "Saved directly to the live room" },
  before_publish: {
    text: "Before publish",
    cls: "bg-amber-900/50 text-amber-300",
    title: "The live room as it was just before a Publish replaced it",
  },
  named: { text: "Named", cls: "bg-blue-900/50 text-blue-300", title: "A named version" },
};

function KindBadge({ kind }: { kind: RoomBackupKind }) {
  const b = KIND_BADGE[kind] ?? KIND_BADGE.saved;
  return (
    <span title={b.title} className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>
      {b.text}
    </span>
  );
}
