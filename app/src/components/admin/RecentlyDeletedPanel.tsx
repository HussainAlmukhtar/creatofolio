"use client";

// "Recently deleted" — rooms, worlds and landing pages that were deleted move
// here (deleted_items) instead of vanishing. Restore puts everything back
// (restored pages come back OFFLINE); "Delete forever" and "Empty" are the
// only permanent deletes. There's no automatic purge in v1, so each item shows
// its age. Opened from the dashboard, the World map and the landing editor's
// page switcher.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Trash2, X } from "lucide-react";
import { useDialog } from "@/components/editor/useDialog";
import {
  listDeletedItems,
  purgeDeletedItems,
  restoreDeletedItem,
  type DeletedItem,
} from "@/lib/trashData";

interface Props {
  onClose: () => void;
  /** Called after an item was restored (refresh the host's room / page list). */
  onRestored?: (item: DeletedItem, slug: string) => void;
}

const KIND_LABEL: Record<DeletedItem["kind"], string> = {
  room: "Room",
  world: "World",
  page: "Page",
};

export function formatAge(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function RecentlyDeletedPanel({ onClose, onRestored }: Props) {
  const { confirm, dialog } = useDialog();
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await listDeletedItems();
    setItems(r.items);
    setAvailable(r.available);
    setError(r.error ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listDeletedItems().then((r) => {
      if (cancelled) return;
      setItems(r.items);
      setAvailable(r.available);
      setError(r.error ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const restore = async (item: DeletedItem) => {
    setBusy(item.id);
    const res = await restoreDeletedItem(item.id, item.kind);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't restore it");
      void reload();
      return;
    }
    toast.success(
      item.kind === "page"
        ? `Restored “${item.label}”. It's back offline: publish it when you're ready.`
        : `Restored “${item.label}”.`
    );
    onRestored?.(item, res.slug ?? "");
    void reload();
  };

  const purge = async (ids: string[], what: string) => {
    const ok = await confirm(
      `${what} for good? This can't be undone: the content, drawings and history in ${ids.length === 1 ? "it" : "them"} are removed.`,
      { confirmLabel: "Delete forever", danger: true }
    );
    if (!ok) return;
    setBusy("purge");
    const res = await purgeDeletedItems(ids);
    setBusy(null);
    if (!res.ok) toast.error(res.error ?? "Couldn't delete");
    else toast.success(`Deleted ${res.purged ?? ids.length} for good.`);
    void reload();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
        onClick={() => !busy && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Recently deleted"
          className="flex max-h-[85dvh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Trash2 className="h-4 w-4 text-neutral-400" /> Recently deleted
            </h2>
            <button
              onClick={onClose}
              disabled={!!busy}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto px-4 py-3">
            {!available && (
              <p className="text-sm text-neutral-400">
                Recently deleted isn&apos;t set up on this database yet (migration 20261005000002_trash_and_atomic_ops.sql), so deletes are permanent.
              </p>
            )}
            {error && (
              <p className="mb-2 rounded border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-300">
                {error}
              </p>
            )}
            {available && items === null && <p className="text-sm italic text-neutral-500">Loading…</p>}
            {available && items?.length === 0 && (
              <p className="text-sm italic text-neutral-500">
                Nothing here. Deleted rooms, worlds and pages show up here and can be restored.
              </p>
            )}
            {items && items.length > 0 && (
              <ul className="divide-y divide-neutral-800" aria-label="Deleted items">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={item.label}>
                      {item.label}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">{formatAge(item.deletedAt)}</span>
                    <button
                      onClick={() => void restore(item)}
                      disabled={!!busy}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" /> {busy === item.id ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      onClick={() => void purge([item.id], `Delete “${item.label}”`)}
                      disabled={!!busy}
                      className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-red-300 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      Delete forever
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-2.5 text-xs text-neutral-400">
            <span>Nothing is removed automatically. Restored pages come back offline.</span>
            <button
              onClick={() =>
                void purge(
                  (items ?? []).map((i) => i.id),
                  `Delete all ${items?.length ?? 0} items`
                )
              }
              disabled={!items?.length || !!busy}
              className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1 text-red-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              Empty
            </button>
          </div>
        </div>
      </div>
      {/* After the panel: same z-index, so DOM order puts the confirm on top. */}
      {dialog}
    </>
  );
}
