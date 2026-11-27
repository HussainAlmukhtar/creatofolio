"use client";

// Storage: per-bucket totals and the files no room, page, backup, draft or
// trashed item points at any more. Deleting is always the owner's explicit,
// confirmed click; the server re-checks every file before removing it
// (/api/admin/storage/delete). Files younger than 48 h are never listed.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, HardDrive, Trash2, FileIcon } from "lucide-react";
import { useDialog } from "@/components/editor/useDialog";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { formatBytes } from "@/lib/assetWeight";
import type { ScanResult, UnusedItem } from "@/lib/storageScan";

const keyOf = (o: { bucket: string; path: string }) => `${o.bucket}/${o.path}`;
const isImage = (p: string) => /\.(png|webp|jpe?g|gif|avif|svg)$/i.test(p);

export default function StoragePanel() {
  useOwnerSessionWatch();
  const { confirm, dialog } = useDialog();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/storage/unused", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setScan(body as ScanResult);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount; state is set after the await.
    void load();
  }, [load]);

  const unused = useMemo(() => scan?.unused ?? [], [scan]);
  const selectedItems = useMemo(
    () => unused.filter((o) => selected.has(keyOf(o))),
    [unused, selected]
  );
  const selectedBytes = selectedItems.reduce((n, o) => n + o.size, 0);
  const totalBytes = scan?.buckets.reduce((n, b) => n + b.bytes, 0) ?? 0;
  const totalFiles = scan?.buckets.reduce((n, b) => n + b.count, 0) ?? 0;

  const toggle = (o: UnusedItem) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(keyOf(o))) next.add(keyOf(o));
      return next;
    });

  const deleteSelected = async () => {
    if (selectedItems.length === 0) return;
    const n = selectedItems.length;
    const ok = await confirm(
      `Permanently delete ${n} file${n === 1 ? "" : "s"} (${formatBytes(selectedBytes)})? ` +
        "Nothing uses them, but this cannot be undone.",
      { danger: true, confirmLabel: "Delete files" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      let deleted = 0;
      let refused = 0;
      // The route takes at most 200 per request.
      for (let i = 0; i < selectedItems.length; i += 200) {
        const chunk = selectedItems
          .slice(i, i + 200)
          .map(({ bucket, path }) => ({ bucket, path }));
        const res = await fetch("/api/admin/storage/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: chunk }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        deleted += body.deleted.length;
        refused += body.refused.length;
      }
      if (refused > 0) {
        toast.warning(`${deleted} deleted, ${refused} kept (in use now, or too new).`);
      } else {
        toast.success(`Deleted ${deleted} file${deleted === 1 ? "" : "s"}.`);
      }
      await load();
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <SessionLostBanner />
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link href="/admin" className="text-neutral-400 hover:text-white touch:-m-3 touch:grid touch:size-11 touch:place-items-center" aria-label="Back to dashboard">
            <ArrowLeft className="size-4" />
          </Link>
          <HardDrive className="size-4 text-neutral-400" />
          <h1 className="text-lg font-semibold">Storage</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        {error && (
          <p className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
            Couldn&apos;t scan storage: {error}
          </p>
        )}
        {!scan && !error && (
          <p className="text-sm text-neutral-400">
            Scanning every file and every saved page, room, backup and draft…
          </p>
        )}

        {scan && (
          <>
            <section>
              <h2 className="mb-2 text-sm font-medium text-neutral-300">
                {totalFiles} files, {formatBytes(totalBytes)} in total
              </h2>
              <div className="overflow-hidden rounded-lg border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-900 text-left text-xs text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Bucket</th>
                      <th className="px-3 py-2 text-right font-medium">Files</th>
                      <th className="px-3 py-2 text-right font-medium">Size</th>
                      <th className="px-3 py-2 text-right font-medium">Unused</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.buckets.map((b) => (
                      <tr key={b.bucket} className="border-t border-neutral-800">
                        <td className="px-3 py-2 font-mono text-xs">{b.bucket}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{b.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBytes(b.bytes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-400">
                          {b.unusedCount > 0 ? `${b.unusedCount} · ${formatBytes(b.unusedBytes)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-medium text-neutral-300">
                  Unused files: {unused.length} · {formatBytes(unused.reduce((n, o) => n + o.size, 0))}
                </h2>
                <div className="ms-auto flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
                    disabled={unused.length === 0 || busy}
                    onClick={() =>
                      setSelected(
                        selected.size === unused.length ? new Set() : new Set(unused.map(keyOf))
                      )
                    }
                  >
                    {selected.size === unused.length && unused.length > 0 ? "Select none" : "Select all"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40"
                    disabled={selected.size === 0 || busy}
                    onClick={deleteSelected}
                  >
                    <Trash2 className="size-3.5" />
                    Delete selected
                    {selected.size > 0 ? ` (${selected.size} · ${formatBytes(selectedBytes)})` : ""}
                  </button>
                </div>
              </div>
              <p className="mb-3 text-xs text-neutral-500">
                “Unused” means no room, page, version, backup, draft, template or deleted item mentions
                the file. Files from the last 48 hours are never listed
                {scan.tooNew > 0 ? ` (${scan.tooNew} held back)` : ""}.
              </p>

              {unused.length === 0 ? (
                <p className="rounded-lg border border-neutral-800 p-6 text-center text-sm text-neutral-400">
                  Nothing to clean up.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-800 overflow-hidden rounded-lg border border-neutral-800">
                  {unused.map((o) => {
                    const k = keyOf(o);
                    return (
                      <li key={k}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-neutral-900">
                          <input
                            type="checkbox"
                            checked={selected.has(k)}
                            onChange={() => toggle(o)}
                            disabled={busy}
                            aria-label={`Select ${k}`}
                          />
                          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded bg-neutral-900 ring-1 ring-neutral-800">
                            {o.publicUrl && isImage(o.path) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={o.publicUrl}
                                alt=""
                                loading="lazy"
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <FileIcon className="size-5 text-neutral-500" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs">{k}</span>
                            <span className="block text-[11px] text-neutral-500">
                              {o.updatedAt ? new Date(o.updatedAt).toLocaleDateString() : "unknown date"}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-neutral-300">
                            {formatBytes(o.size)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      {dialog}
    </div>
  );
}
