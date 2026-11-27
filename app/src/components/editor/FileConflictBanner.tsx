"use client";

// DB↔file conflict banner.
//
// When external files are on, the editor mirrors saves to disk. If somebody
// also edits the DB (Supabase dashboard, raw SQL, another tab), the file goes
// stale — and since the runtime now reads the file in preference to the DB,
// that means stale data plays. This banner makes
// drift visible and offers a one-click resolution per room.
//
// Detection: rooms.updated_at > rooms.last_file_write_at AND both are set.
// Visual template: DraftRestoreBanner.tsx.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editorStore";
import { AlertTriangle, X } from "lucide-react";
import {
  loadRoom,
  loadRoomTimestamps,
  saveRoom,
  saveRoomDraft,
  writeRoomFile,
  readWorldFiles,
  loadDefaultWorld,
} from "@/lib/editorData";
import type { RoomId } from "@/data/roomTypes";

interface DriftedRoom {
  id: string;
  updatedAt: string;
  lastFileWriteAt: string;
}

export function FileConflictBanner() {
  const [drifted, setDrifted] = useState<DriftedRoom[] | null>(null);
  const [worldSlug, setWorldSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // room id mid-action
  const [dismissed, setDismissed] = useState(false);

  // One-shot scan on mount. Only meaningful when the world has external
  // files turned on — otherwise nothing writes the timestamp and every row
  // looks "drifted" (false positives).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const world = await loadDefaultWorld();
      if (cancelled || !world) return;
      const externalOn = Boolean(
        (world.config as { externalFilesEnabled?: boolean } | null)
          ?.externalFilesEnabled
      );
      if (!externalOn) return;
      setWorldSlug(world.id);

      const stamps = await loadRoomTimestamps();
      const out: DriftedRoom[] = [];
      for (const r of stamps) {
        if (!r.updatedAt || !r.lastFileWriteAt) continue;
        if (new Date(r.updatedAt) > new Date(r.lastFileWriteAt)) {
          out.push({
            id: r.id,
            updatedAt: r.updatedAt,
            lastFileWriteAt: r.lastFileWriteAt,
          });
        }
      }
      if (!cancelled) setDrifted(out);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Use DB version: rewrite the file from the current row. Stamps the
  // `last_file_write_at` column itself, so this room drops out of the list
  // automatically on the next scan.
  const handleOverwriteFile = useCallback(
    async (roomId: string) => {
      if (!worldSlug) return;
      setBusy(roomId);
      const cfg = await loadRoom(roomId as RoomId);
      const res = await writeRoomFile(worldSlug, roomId, cfg);
      setBusy(null);
      if (res.ok) {
        toast.success(`File rewritten from DB: ${roomId}`);
        setDrifted((prev) => prev?.filter((r) => r.id !== roomId) ?? null);
      } else {
        toast.error(`Overwrite failed: ${res.error ?? "?"}`);
      }
    },
    [worldSlug]
  );

  // Use file version: load the file and stage it as the room's DRAFT (the live
  // room never changes without a Publish). Without drafts (migration
  // 20261005000001_room_drafts not applied) it falls back to the old direct
  // live save, which re-mirrors to disk and stamps the column, clearing the
  // drift.
  const handleReloadFromFile = useCallback(
    async (roomId: string) => {
      if (!worldSlug) return;
      setBusy(roomId);
      const files = await readWorldFiles(worldSlug);
      const fileCfg = files[roomId];
      if (!fileCfg) {
        setBusy(null);
        toast.error(`No file for "${roomId}" — nothing to reload.`);
        return;
      }
      const store = useEditorStore.getState();
      const iid = fileCfg.iid ?? store.allRooms[roomId]?.iid;
      // An explicit "the file wins" choice, so force past the concurrency check.
      if (store.draftsAvailable && iid) {
        const res = await saveRoomDraft({ ...fileCfg, iid }, { expectedUpdatedAt: null, force: true });
        if (res.ok) await store.reloadRoomFromDb(roomId);
        setBusy(null);
        if (res.ok) {
          toast.success(`File version loaded into the draft of ${roomId}`, {
            description: "Review it in the editor, then Publish to make it live.",
          });
          setDrifted((prev) => prev?.filter((r) => r.id !== roomId) ?? null);
        } else {
          toast.error(`Reload failed: ${res.error ?? "?"}`);
        }
        return;
      }
      const res = await saveRoom(fileCfg, { force: true });
      if (res.ok) await store.refreshRoomRevisions();
      setBusy(null);
      if (res.ok) {
        toast.success(`DB row replaced with file: ${roomId}`);
        setDrifted((prev) => prev?.filter((r) => r.id !== roomId) ?? null);
      } else {
        toast.error(`Reload failed: ${res.error ?? "?"}`);
      }
    },
    [worldSlug]
  );

  if (dismissed) return null;
  if (!drifted || drifted.length === 0) return null;

  return (
    <div className="border-b border-amber-700 bg-amber-900/30 px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 flex-shrink-0 text-amber-300"
          size={14}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-amber-100">
            {drifted.length === 1
              ? "1 room drifted between DB and file"
              : `${drifted.length} rooms drifted between DB and file`}
          </div>
          <div className="mt-0.5 text-[10px] text-amber-300/80">
            DB was edited after the last file mirror — pick which copy wins
            per room.
          </div>
          <ul className="mt-1.5 space-y-1">
            {drifted.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 text-[11px] text-amber-100"
              >
                <code className="rounded bg-black/30 px-1 py-0.5">{r.id}</code>
                <button
                  onClick={() => handleOverwriteFile(r.id)}
                  disabled={busy === r.id}
                  className="rounded bg-amber-700 px-2 py-0.5 text-[10px] text-white hover:bg-amber-600 disabled:opacity-40"
                  title="Write the current DB config to the file"
                >
                  Use DB → file
                </button>
                <button
                  onClick={() => handleReloadFromFile(r.id)}
                  disabled={busy === r.id}
                  className="rounded bg-neutral-700 px-2 py-0.5 text-[10px] text-white hover:bg-neutral-600 disabled:opacity-40"
                  title="Load the file into this room's draft (Publish to make it live)"
                >
                  Use file → DB
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-amber-300 hover:bg-amber-800/50"
          title="Dismiss for this session"
          aria-label="Dismiss conflict banner"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
