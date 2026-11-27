"use client";

// Project Settings — central home for world-level knobs
// that used to live only in the DB. Same modal shape as HistoryModal.
//
// First version: name, layout, grid size, default new-room size, default
// foreground effect, external-files toggle. Future world-level settings
// land here without spawning a new dialog.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Settings, Loader2 } from "lucide-react";
import {
  loadDefaultWorld,
  loadWorldById,
  saveWorld,
  exportAllRoomsToFiles,
  resetWorldToSeed,
  listRoomsInWorld,
} from "@/lib/editorData";
import { useEditorStore } from "@/stores/editorStore";
import { Tooltip, InfoTip } from "@/components/editor/EditorTooltip";
import type {
  WorldConfig,
  WorldLayout,
  WorldSettings,
  ForegroundEffect,
} from "@/data/roomTypes";
import { ROOM_WIDTH, ROOM_HEIGHT } from "@/data/roomTypes";

interface ProjectSettingsModalProps {
  /** World slug to edit. Defaults to the live world. */
  worldId?: string;
  onClose: () => void;
  /** Called after a save succeeds so the host can reload world-derived state. */
  onSaved?: (world: WorldConfig) => void;
}

const FX_OPTIONS: { value: NonNullable<ForegroundEffect> | "none"; label: string }[] = [
  { value: "none", label: "None" },
  { value: "rain", label: "Rain" },
  { value: "snow", label: "Snow" },
  { value: "cctv", label: "CCTV" },
];

export function ProjectSettingsModal({ worldId, onClose, onSaved }: ProjectSettingsModalProps) {
  const [world, setWorld] = useState<WorldConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state (uncontrolled-on-load; controlled afterwards).
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<WorldLayout>("free");
  const [gridWidth, setGridWidth] = useState(ROOM_WIDTH);
  const [gridHeight, setGridHeight] = useState(ROOM_HEIGHT);
  const [defaultRoomWidth, setDefaultRoomWidth] = useState(ROOM_WIDTH);
  const [defaultRoomHeight, setDefaultRoomHeight] = useState(ROOM_HEIGHT);
  const [defaultFx, setDefaultFx] = useState<"none" | NonNullable<ForegroundEffect>>("none");
  const [externalFiles, setExternalFiles] = useState(false);
  const [roomNameTags, setRoomNameTags] = useState(true);
  // Next inlines NODE_ENV at build time; the API route refuses writes too.
  const filesLocked = process.env.NODE_ENV === "production";
  const [defaultRoomId, setDefaultRoomId] = useState("home");
  const [availableRooms, setAvailableRooms] = useState<{ id: string; name: string | null }[]>([]);
  const [exporting, setExporting] = useState(false);
  // Destructive reset escape hatch. Two-step gate:
  // user must type the world slug into a confirm input before the button
  // becomes enabled. Mirrors the GitHub/Vercel "type the repo name" pattern.
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const hydrateFromSupabase = useEditorStore((s) => s.hydrateFromSupabase);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const w = worldId ? await loadWorldById(worldId) : await loadDefaultWorld();
      if (cancelled) return;
      if (!w) {
        setLoading(false);
        return;
      }
      setWorld(w);
      setName(w.name);
      setLayout(w.layout);
      setGridWidth(w.gridWidth ?? ROOM_WIDTH);
      setGridHeight(w.gridHeight ?? ROOM_HEIGHT);
      const cfg = w.config ?? {};
      setDefaultRoomWidth(cfg.defaultRoomWidth ?? ROOM_WIDTH);
      setDefaultRoomHeight(cfg.defaultRoomHeight ?? ROOM_HEIGHT);
      setDefaultFx(cfg.defaultForegroundEffect ?? "none");
      setExternalFiles(cfg.externalFilesEnabled ?? false);
      setRoomNameTags(cfg.roomNameTags !== false);
      setDefaultRoomId(cfg.defaultRoomId ?? "home");
      const placements = await listRoomsInWorld(w.iid);
      if (!cancelled) setAvailableRooms(placements.map((p) => ({ id: p.id, name: p.name })));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const submit = async () => {
    if (!world) return;
    setSaving(true);
    const nextConfig: Partial<WorldSettings> = {
      defaultRoomWidth,
      defaultRoomHeight,
      defaultForegroundEffect: defaultFx === "none" ? null : defaultFx,
      externalFilesEnabled: externalFiles,
      defaultRoomId,
      roomNameTags,
    };
    const res = await saveWorld(world.iid, {
      name,
      layout,
      gridWidth: layout === "gridvania" ? gridWidth : null,
      gridHeight: layout === "gridvania" ? gridHeight : null,
      config: nextConfig,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`Save failed: ${res.error ?? "?"}`);
      return;
    }
    toast.success("Project settings saved.");
    onSaved?.({
      ...world,
      name,
      layout,
      gridWidth: layout === "gridvania" ? gridWidth : undefined,
      gridHeight: layout === "gridvania" ? gridHeight : undefined,
      config: { ...(world.config ?? {}), ...nextConfig },
    });
    onClose();
  };

  const handleReset = async () => {
    if (!world) return;
    if (resetConfirm !== world.id) return;
    setResetting(true);
    const res = await resetWorldToSeed(world.iid);
    setResetting(false);
    setResetConfirm("");
    if (!res.ok) {
      toast.error(`Reset failed: ${res.error ?? "?"}`);
      return;
    }
    toast.success(
      `Reset complete: deleted ${res.deleted ?? 0}, re-seeded ${res.seeded ?? 0}.`
    );
    // Re-hydrate the editor so the user sees the seed rooms immediately
    // instead of stale state from the deleted rows.
    await hydrateFromSupabase();
    onClose();
  };

  const handleExportAll = async () => {
    if (!world) return;
    setExporting(true);
    const res = await exportAllRoomsToFiles(world.id);
    setExporting(false);
    if (!res.ok) {
      toast.error(`Export failed: ${res.error ?? "?"}`);
      return;
    }
    toast.success(
      `Exported ${res.written} room${res.written === 1 ? "" : "s"} to app/world/${world.id}/rooms/`
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[85dvh] overflow-y-auto rounded-lg bg-slate-800 text-slate-100 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <Settings className="h-4 w-4" /> Project Settings
          </div>
          <Tooltip label="Close" shortcut="Esc">
            <button
              onClick={onClose}
              className="rounded p-1 hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {loading && (
          <div className="px-4 py-6 text-sm text-slate-400">Loading…</div>
        )}

        {!loading && !world && (
          <div className="px-4 py-6 text-sm text-slate-400">
            No world found. Run `npm run db:seed` in the app folder to create the main world.
          </div>
        )}

        {!loading && world && (
          <div className="space-y-5 px-4 py-4">
            {/* World identity */}
            <Section title="World">
              <Field label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>
              <Field label="Slug">
                <div className="rounded bg-slate-900/60 px-3 py-2 text-sm text-slate-400">
                  {world.id} <span className="text-xs">(immutable)</span>
                </div>
              </Field>
              <Field label="Default start room">
                <select
                  value={defaultRoomId}
                  onChange={(e) => setDefaultRoomId(e.target.value)}
                  className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableRooms.length === 0 && (
                    <option value={defaultRoomId}>{defaultRoomId}</option>
                  )}
                  {availableRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name ? `${r.name} (${r.id})` : r.id}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  The room players land in when they first enter the world.
                </p>
              </Field>
            </Section>

            {/* Layout */}
            <Section
              title="Layout"
              hint="How rooms are arranged in world space. Free = drag anywhere; Gridvania = snap to a global grid (Metroidvania-style)."
            >
              <div className="flex flex-wrap gap-3">
                {(["free", "gridvania", "linear"] as WorldLayout[]).map((l) => (
                  <label
                    key={l}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm capitalize ${
                      layout === l
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="layout"
                      value={l}
                      checked={layout === l}
                      onChange={() => setLayout(l)}
                      className="sr-only"
                    />
                    {l}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {layout === "free" && "Drag rooms anywhere."}
                {layout === "gridvania" &&
                  "Rooms snap to a global grid. Adjacent rooms become implicit neighbours."}
                {layout === "linear" && "Reserved for future use; behaves like free."}
              </p>

              {layout === "gridvania" && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Grid width (px)">
                    <input
                      type="number"
                      value={gridWidth}
                      min={32}
                      step={32}
                      onChange={(e) =>
                        setGridWidth(Math.max(32, parseInt(e.target.value) || ROOM_WIDTH))
                      }
                      className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </Field>
                  <Field label="Grid height (px)">
                    <input
                      type="number"
                      value={gridHeight}
                      min={32}
                      step={32}
                      onChange={(e) =>
                        setGridHeight(Math.max(32, parseInt(e.target.value) || ROOM_HEIGHT))
                      }
                      className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </Field>
                </div>
              )}
            </Section>

            {/* New room defaults */}
            <Section title="New room defaults">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default width (px)">
                  <input
                    type="number"
                    value={defaultRoomWidth}
                    min={320}
                    step={32}
                    onChange={(e) =>
                      setDefaultRoomWidth(
                        Math.max(320, parseInt(e.target.value) || ROOM_WIDTH)
                      )
                    }
                    className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </Field>
                <Field label="Default height (px)">
                  <input
                    type="number"
                    value={defaultRoomHeight}
                    min={240}
                    step={32}
                    onChange={(e) =>
                      setDefaultRoomHeight(
                        Math.max(240, parseInt(e.target.value) || ROOM_HEIGHT)
                      )
                    }
                    className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </Field>
              </div>
              <Field label="Default foreground effect">
                <select
                  value={defaultFx}
                  onChange={(e) =>
                    setDefaultFx(e.target.value as typeof defaultFx)
                  }
                  className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {FX_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  Applied to newly-created rooms only. Existing rooms keep theirs.
                </p>
              </Field>
            </Section>

            {/* Room name tags (game's top corner); rooms can override. */}
            <Section
              title="Room name tags"
              hint="The small paper tag with the room's name in the game's top corner. Each room can override this in Room Properties."
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={roomNameTags}
                  onChange={(e) => setRoomNameTags(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm">Show room names in the game</div>
                  <div className="text-xs text-slate-400">
                    Goes live when you save these settings (not part of a room&apos;s draft).
                  </div>
                </div>
              </label>
            </Section>

            {/* External files */}
            <Section
              title="External files (git-tracked)"
              hint="Save room JSON to disk so PRs and git checkouts work for level data. Files override the database when present."
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={externalFiles}
                  disabled={filesLocked}
                  onChange={(e) => setExternalFiles(e.target.checked)}
                  className="mt-1"
                />
                <div className={filesLocked ? "opacity-60" : undefined}>
                  <div className="text-sm">Mirror saves to disk</div>
                  <div className="text-xs text-slate-400">
                    Each save also writes <code>app/world/{world.id}/rooms/&lt;slug&gt;.json</code>.
                    Loading prefers the file when present so PRs and{" "}
                    <code>git checkout</code> work for level data.
                  </div>
                </div>
              </label>
              {filesLocked && (
                <p className="mt-2 text-xs text-amber-400">
                  External room files only work in local development: files
                  written on the server are wiped on every deploy.
                </p>
              )}
              {externalFiles && !filesLocked && (
                <button
                  onClick={handleExportAll}
                  disabled={exporting}
                  className="mt-3 inline-flex items-center gap-2 rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600 disabled:opacity-50"
                >
                  {exporting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Export all rooms to files now
                </button>
              )}
            </Section>

            {/* Danger Zone — destructive reset to
                the static seed. Two-step gate: type the world slug to enable
                the button. Re-hydrates the editor on success. Only the
                original "main" world has a seed to reset to. */}
            {world.id === "main" && (
            <Section
              title="Danger zone"
              hint="Irreversible operations. Read each label twice before pressing."
            >
              <div className="rounded border border-red-900/60 bg-red-950/30 p-3">
                <div className="text-sm font-medium text-red-200">
                  Reset world to seed
                </div>
                <div className="mt-1 text-xs text-red-300/80">
                  Deletes every room in <code>{world.id}</code> and re-inserts
                  the static seed (8 rooms). Object content, drawing scenes,
                  and uploaded sprites are dropped too. Cannot be undone.
                </div>
                <div className="mt-3 space-y-2">
                  <Field
                    label={`Type "${world.id}" to confirm`}
                  >
                    <input
                      value={resetConfirm}
                      onChange={(e) => setResetConfirm(e.target.value)}
                      placeholder={world.id}
                      className="w-full rounded bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </Field>
                  <button
                    onClick={handleReset}
                    disabled={resetConfirm !== world.id || resetting}
                    className="inline-flex items-center gap-2 rounded bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {resetting && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Reset world
                  </button>
                </div>
              </div>
            </Section>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-2 text-sm hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!world || saving}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1">
        {title}
        {hint ? <InfoTip label={hint} /> : null}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      {children}
    </label>
  );
}
