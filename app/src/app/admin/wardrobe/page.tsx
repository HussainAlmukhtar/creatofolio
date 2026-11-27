"use client";

// Admin Wardrobe — owner-only page for managing the `avatar_assets`
// catalog. Gated by proxy.ts redirecting unauthenticated visitors away
// from /admin/* before the request reaches this page.
//
// Two flows for adding a wardrobe item:
//   (a) Upload an existing PNG (file picker → /api/editor/upload → row insert)
//   (b) Draw a new one in Klecks (rig pre-loaded as guide layer → save PNG +
//       scene metadata → row insert with scene snapshot for later re-edit)
//
// Re-edit reopens Klecks with the rig + the saved PNG layered on top so the
// owner can tweak previous work. (We don't round-trip the full Klecks PSD
// for v1 — the saved PNG is the editing source, which round-trips fine for
// the kind of casual touch-ups this UI targets.)

import { prepareForUpload, withExt } from "@/lib/uploadPrep";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/writeGuard";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { useDialog } from "@/components/editor/useDialog";
import { Pencil, Trash2 } from "lucide-react";

const SLOTS = [
  "body",
  "eyes",
  "hair",
  "shirt",
  "pants",
  "shoes",
  "accessory",
] as const;
type Slot = (typeof SLOTS)[number];

const SLOT_LABELS: Record<Slot, string> = {
  body: "Body",
  eyes: "Face",
  hair: "Hair",
  shirt: "Outfit",
  pants: "Pants",
  shoes: "Shoes",
  accessory: "Extras",
};

// The starter body in its standing pose, shown faintly under the drawing.
const RIG_REFERENCE_URL = "/avatar/_rig_reference.png";
const FRAME_W = 240;
const FRAME_H = 280;

interface AvatarAssetRow {
  id: string;
  slot: Slot;
  name: string;
  name_ar: string | null;
  sprite_url: string;
  sprite_left_url: string | null;
  tintable: boolean;
  z_offset: number;
  enabled: boolean;
  scene: { drawnInKlecks?: boolean } | null;
  created_at: string;
}

export default function WardrobeAdminPage() {
  useOwnerSessionWatch();
  const [assets, setAssets] = useState<AvatarAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawState, setDrawState] = useState<{
    slot: Slot;
    editingId: string | null;
    initialPngUrl: string | null;
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/avatar-assets");
      const body = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(res, body, `HTTP ${res.status}`));
      setAssets(body.assets as AvatarAssetRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grouped = useMemo(() => {
    const map = new Map<Slot, AvatarAssetRow[]>();
    for (const slot of SLOTS) map.set(slot, []);
    for (const a of assets) {
      const arr = map.get(a.slot);
      if (arr) arr.push(a);
    }
    return map;
  }, [assets]);

  return (
    <div className="min-h-dvh bg-neutral-900 text-neutral-100">
      <SessionLostBanner />
      <header className="border-b border-neutral-800 bg-neutral-900/80 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wardrobe</h1>
          <p className="text-sm text-neutral-400">
            Manage the avatar catalog. Players pick from enabled rows.
          </p>
        </div>
        <div className="flex gap-2">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full nav keeps the beforeunload guard */}
          <a
            href="/admin"
            className="px-4 py-2 text-sm rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800"
          >
            ← Dashboard
          </a>
          <button
            onClick={reload}
            className="px-4 py-2 text-sm rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="px-6 py-6 max-w-6xl mx-auto">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
            {error}
          </div>
        )}
        {loading && (
          <div className="text-neutral-500 italic">Loading the wardrobe…</div>
        )}
        {!loading &&
          SLOTS.map((slot) => (
            <SlotSection
              key={slot}
              slot={slot}
              assets={grouped.get(slot) ?? []}
              onChanged={reload}
              onOpenDraw={(args) => setDrawState(args)}
            />
          ))}
      </main>

      {drawState && (
        <KlecksDrawModal
          slot={drawState.slot}
          editingId={drawState.editingId}
          initialPngUrl={drawState.initialPngUrl}
          onClose={() => setDrawState(null)}
          onSaved={() => {
            setDrawState(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Slot section ────────────────────────────────────────────────────

function SlotSection({
  slot,
  assets,
  onChanged,
  onOpenDraw,
}: {
  slot: Slot;
  assets: AvatarAssetRow[];
  onChanged: () => void;
  onOpenDraw: (args: {
    slot: Slot;
    editingId: string | null;
    initialPngUrl: string | null;
  }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const prep = await prepareForUpload(file, "avatar", { keepSize: true });
      const form = new FormData();
      form.append(
        "file",
        new File([prep.blob], withExt(file.name, prep.ext), { type: prep.type })
      );
      form.append("bucket", "avatar-assets");
      const upRes = await fetch("/api/editor/upload", {
        method: "POST",
        body: form,
      });
      const upBody = await upRes.json();
      if (!upRes.ok) throw new Error(apiErrorMessage(upRes, upBody, `upload failed: ${upRes.status}`));

      const name = file.name.replace(/\.[^.]+$/, "");
      const createRes = await fetch("/api/admin/avatar-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot,
          name,
          sprite_url: upBody.url,
          tintable: false,
          enabled: true,
        }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok)
        throw new Error(apiErrorMessage(createRes, createBody, `create failed: ${createRes.status}`));

      onChanged();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="mb-8">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{SLOT_LABELS[slot]}</h2>
        <div className="flex gap-2">
          <label className="px-3 py-1.5 text-sm rounded-lg border border-neutral-700 text-neutral-200 hover:bg-neutral-800 cursor-pointer">
            {uploading ? "Uploading…" : "Upload PNG"}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
              disabled={uploading}
            />
          </label>
          <button
            onClick={() =>
              onOpenDraw({ slot, editingId: null, initialPngUrl: null })
            }
            className="px-3 py-1.5 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700"
          >
            Draw a new one
          </button>
        </div>
      </header>

      {uploadError && (
        <div className="mb-3 p-2 rounded bg-red-900/30 border border-red-800 text-red-300 text-xs">
          {uploadError}
        </div>
      )}

      {assets.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No items yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {assets.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              onChanged={onChanged}
              onEdit={() =>
                onOpenDraw({
                  slot: a.slot,
                  editingId: a.id,
                  initialPngUrl: a.sprite_url,
                })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Asset card ──────────────────────────────────────────────────────

function AssetCard({
  asset,
  onChanged,
  onEdit,
}: {
  asset: AvatarAssetRow;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [nameAr, setNameAr] = useState(asset.name_ar ?? "");
  const [tintable, setTintable] = useState(asset.tintable);
  const [enabled, setEnabled] = useState(asset.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useDialog();

  const dirty =
    name !== asset.name ||
    (nameAr || null) !== (asset.name_ar ?? null) ||
    tintable !== asset.tintable ||
    enabled !== asset.enabled;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/avatar-assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: asset.id,
          name,
          name_ar: nameAr || null,
          tintable,
          enabled,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(res, body, `HTTP ${res.status}`));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !(await confirm(`Delete "${asset.name}"? This cannot be undone.`, {
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/avatar-assets?id=${encodeURIComponent(asset.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(res, body, `HTTP ${res.status}`));
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className={`rounded-xl border p-3 bg-neutral-800/40 flex flex-col gap-2 ${
        enabled ? "border-neutral-800" : "border-neutral-800 opacity-60"
      }`}
    >
      {dialog}
      <div className="aspect-[6/7] bg-neutral-800 rounded-lg flex items-end justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.sprite_url}
          alt={asset.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (English)"
        className="px-2 py-1 text-sm border border-neutral-700 bg-neutral-900 text-neutral-100 rounded"
      />
      <input
        value={nameAr}
        onChange={(e) => setNameAr(e.target.value)}
        placeholder="Name (Arabic)"
        dir="rtl"
        className="px-2 py-1 text-sm border border-neutral-700 bg-neutral-900 text-neutral-100 rounded"
      />

      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={tintable}
            onChange={(e) => setTintable(e.target.checked)}
          />
          Tintable
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      {error && (
        <div className="text-xs text-red-300 bg-red-900/30 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex-1 px-2 py-1 text-xs rounded bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-700"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onEdit}
          className="px-2 py-1 text-xs rounded bg-sky-900/40 text-sky-300 hover:bg-sky-900/60"
          title="Open in the drawing studio"
          aria-label="Edit this item in the drawing studio"
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
        <button
          onClick={handleDelete}
          disabled={saving}
          className="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 disabled:opacity-40"
          aria-label="Delete this item"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ─── Klecks draw modal ───────────────────────────────────────────────

function KlecksDrawModal({
  slot,
  editingId,
  initialPngUrl,
  onClose,
  onSaved,
}: {
  slot: Slot;
  editingId: string | null;
  initialPngUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [tintable, setTintable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [klecksReady, setKlecksReady] = useState(false);

  // Klecks bridge — listen for ready, then send "open" with rig + (optional)
  // existing PNG as layers. On submit, the iframe posts the PNG blob back
  // and we upload + insert/update the row.
  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data as
        | {
            type: "ready" | "submit" | "error";
            png?: Blob;
            message?: string;
          }
        | null;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ready") {
        setKlecksReady(true);
        const layers: Array<{
          name: string;
          imageUrl?: string;
          opacity?: number;
        }> = [
          // The name must start with "GUIDE": the studio bridge leaves such
          // layers out of the saved PNG.
          { name: "GUIDE body", imageUrl: RIG_REFERENCE_URL, opacity: 0.35 },
        ];
        if (initialPngUrl) {
          layers.push({ name: "Previous", imageUrl: initialPngUrl });
        } else {
          layers.push({ name: "Drawing" });
        }
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "open",
            spec: { width: FRAME_W, height: FRAME_H, layers },
          },
          window.location.origin
        );
        return;
      }

      if (msg.type === "submit" && msg.png) {
        try {
          setSaving(true);
          setError(null);
          // 1. Upload PNG to avatar-assets bucket
          const prep = await prepareForUpload(msg.png, "avatar", { keepSize: true });
          const form = new FormData();
          form.append(
            "file",
            new File([prep.blob], `${slot}-${Date.now()}.${prep.ext}`, {
              type: prep.type,
            })
          );
          form.append("bucket", "avatar-assets");
          const upRes = await fetch("/api/editor/upload", {
            method: "POST",
            body: form,
          });
          const upBody = await upRes.json();
          if (!upRes.ok)
            throw new Error(apiErrorMessage(upRes, upBody, `upload failed: ${upRes.status}`));

          // 2. Insert or update the row.
          const payload = {
            slot,
            name: name.trim() || `Untitled ${slot}`,
            name_ar: nameAr.trim() || null,
            sprite_url: upBody.url,
            tintable,
            enabled: true,
            scene: { drawnInKlecks: true },
          };
          const route = editingId
            ? { method: "PATCH" as const, body: { id: editingId, ...payload } }
            : { method: "POST" as const, body: payload };
          const rowRes = await fetch("/api/admin/avatar-assets", {
            method: route.method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(route.body),
          });
          const rowBody = await rowRes.json();
          if (!rowRes.ok)
            throw new Error(apiErrorMessage(rowRes, rowBody, `save failed: ${rowRes.status}`));

          // 3. Ack the submit so Klecks closes its dialog.
          iframeRef.current?.contentWindow?.postMessage(
            { type: "submitAck" },
            window.location.origin
          );
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          iframeRef.current?.contentWindow?.postMessage(
            { type: "submitError" },
            window.location.origin
          );
        } finally {
          setSaving(false);
        }
        return;
      }

      if (msg.type === "error") {
        setError(msg.message ?? "The drawing studio reported an error");
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editingId, initialPngUrl, name, nameAr, slot, tintable, onSaved]);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      <header className="bg-neutral-900 text-white px-4 py-3 flex items-center gap-3">
        <h2 className="font-semibold">
          {editingId ? "Edit" : "Draw new"} — {SLOT_LABELS[slot]}
        </h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (EN)"
          className="px-2 py-1 text-sm rounded bg-neutral-800 text-white placeholder-neutral-500"
        />
        <input
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          placeholder="الاسم (AR)"
          dir="rtl"
          className="px-2 py-1 text-sm rounded bg-neutral-800 text-white placeholder-neutral-500"
        />
        <label className="text-sm flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={tintable}
            onChange={(e) => setTintable(e.target.checked)}
          />
          Tintable
        </label>
        <div className="flex-1" />
        {!klecksReady && (
          <span className="text-xs text-neutral-400">Starting the drawing studio…</span>
        )}
        {saving && <span className="text-xs text-amber-400">Saving…</span>}
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded bg-neutral-700 hover:bg-neutral-600"
        >
          Close
        </button>
      </header>

      {error && (
        <div className="bg-red-900/80 text-red-100 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <iframe
        ref={iframeRef}
        src="/klecks/index.html"
        className="flex-1 bg-neutral-900 border-0"
        title="Drawing studio"
      />
    </div>
  );
}
