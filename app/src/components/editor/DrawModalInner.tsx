"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trimTransparentPadding } from "@/lib/trimImage";
import { ImageDown, Wand2, Image as ImageIcon, Replace } from "lucide-react";
import {
  uploadLibrarySprite,
  loadDrawingScenePsd,
  uploadDrawingScenePsd,
  saveDrawingScene,
} from "@/lib/editorData";
import { useEditorStore } from "@/stores/editorStore";
import { ROOM_WIDTH, ROOM_HEIGHT, type BgLayer } from "@/data/roomTypes";
import { StudioModal } from "@/components/studio/StudioModal";
import { useStudioBridge } from "@/components/studio/useStudioBridge";

export type DrawEditTarget =
  | { kind: "background"; layer: BgLayer }
  | { kind: "sprite"; objectId: string };

const LAYER_URL_FIELD = {
  back: "bgBackUrl",
  middle: "bgMiddleUrl",
  front: "bgFrontUrl",
} as const;
const LAYER_ORIG_FIELD = {
  back: "bgBackOriginalPath",
  middle: "bgMiddleOriginalPath",
  front: "bgFrontOriginalPath",
} as const;
const LAYER_CROP_FIELD = {
  back: "bgBackCrop",
  middle: "bgMiddleCrop",
  front: "bgFrontCrop",
} as const;
const LAYER_LABELS: Record<BgLayer, string> = {
  back: "Behind everything",
  middle: "The room",
  front: "Above player",
};

interface DrawModalInnerProps {
  onClose: () => void;
  onLibraryUpdated: () => void;
  editTarget?: DrawEditTarget;
}

const SCRATCH_KEY = "studio:scratch";

interface ResolvedTarget {
  /** Used as the iframe `key` to force remount when target changes. */
  persistenceKey: string;
  title: string;
  /** Existing PNG to seed as a "Reference" layer when first opening. */
  initialImage: { url: string; label: string } | null;
  /** Canvas dimensions — fixed at openProject() time in Klecks. */
  size: { w: number; h: number };
  /** Supabase row coords for the PSD scene — null in scratch mode. */
  scene:
    | { roomId: string; targetKind: "object" | "background"; targetId: string }
    | null;
}

function resolveTarget(editTarget?: DrawEditTarget): ResolvedTarget {
  const state = useEditorStore.getState();
  const config = state.currentRoomConfig;
  const roomId = state.currentRoomId;

  if (!editTarget) {
    return {
      persistenceKey: SCRATCH_KEY,
      title: "Drawing Studio (scratch)",
      initialImage: null,
      size: { w: ROOM_WIDTH, h: ROOM_HEIGHT },
      scene: null,
    };
  }

  if (!config || !roomId) {
    return {
      persistenceKey: SCRATCH_KEY,
      title: "Drawing Studio",
      initialImage: null,
      size: { w: ROOM_WIDTH, h: ROOM_HEIGHT },
      scene: null,
    };
  }

  if (editTarget.kind === "background") {
    const layer = editTarget.layer;
    const url = config[LAYER_URL_FIELD[layer]] as string | undefined;
    const layerLabel = LAYER_LABELS[layer];
    return {
      persistenceKey: `studio:bg:${layer}:${roomId}`,
      title: url
        ? `Editing "${layerLabel}" layer`
        : `Drawing "${layerLabel}" layer`,
      initialImage: url ? { url, label: `${layerLabel} layer` } : null,
      size: { w: ROOM_WIDTH, h: ROOM_HEIGHT },
      scene: {
        roomId,
        targetKind: "background",
        targetId: `background_${layer}`,
      },
    };
  }

  const obj = config.objects.find((o) => o.id === editTarget.objectId);
  const label = obj?.label || "object";
  return {
    persistenceKey: `studio:obj:${roomId}:${editTarget.objectId}`,
    title: obj?.spriteUrl
      ? `Editing sprite — "${label}"`
      : `Drawing sprite — "${label}"`,
    initialImage: obj?.spriteUrl ? { url: obj.spriteUrl, label } : null,
    size: obj ? { w: obj.width, h: obj.height } : { w: ROOM_WIDTH, h: ROOM_HEIGHT },
    scene: { roomId, targetKind: "object", targetId: editTarget.objectId },
  };
}

// ─── iframe protocol ───────────────────────────────────────────
// The wrapper page at /klecks/index.html accepts these messages from us
// and emits a small set back. Keep these types aligned with the JS wrapper.

interface KlSpecLayer {
  name: string;
  fill?: string;
  imageUrl?: string;
  opacity?: number;
}
interface KlSpec {
  width: number;
  height: number;
  layers: KlSpecLayer[];
}

export default function DrawModalInner({
  onClose,
  onLibraryUpdated,
  editTarget,
}: DrawModalInnerProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // "Set as Layer ▾" opens on hover (mouse) or on tap/click (touch has no hover).
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  // A ref, not state: two quick taps on a save button must not run two saves.
  const savingRef = useRef(false);

  // The studio's own OK button hands its blobs to whichever save is primary.
  const submitRef = useRef<(png: Blob, psd: Blob) => void>(() => {});
  const bridge = useStudioBridge({ onSubmit: (r) => submitRef.current(r.png, r.psd) });
  const { requestExport, ackSubmit, clearAutosave, isReady } = bridge;

  const target = useMemo(() => resolveTarget(editTarget), [editTarget]);
  const isEditMode = editTarget !== undefined;

  // ─── Initial state load ────────────────────────────────────
  // Pull the saved PSD (if any) once when the target resolves; build a
  // fresh spec otherwise. This effect runs in parallel with the iframe
  // mount; the "send open" effect below waits for both to be done.
  const [initialState, setInitialState] = useState<
    | { kind: "psd"; buffer: ArrayBuffer }
    | { kind: "spec"; spec: KlSpec }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setInitialState(null);
    (async () => {
      let buffer: ArrayBuffer | null = null;
      if (target.scene) {
        try {
          buffer = await loadDrawingScenePsd(
            target.scene.roomId,
            target.scene.targetKind,
            target.scene.targetId
          );
        } catch (err) {
          console.warn("loadDrawingScenePsd failed", err);
        }
      }
      if (cancelled) return;

      if (buffer) {
        setInitialState({ kind: "psd", buffer });
        return;
      }
      // Fresh project. Two layers when there's a reference PNG to seed,
      // one transparent layer when free-drawing. The reference layer
      // gives the user the same visual hand-hold the old tldraw frame
      // provided, plus it's a real editable layer they can dim or hide.
      const layers: KlSpecLayer[] = [];
      if (target.initialImage) {
        layers.push({
          name: `Reference (${target.initialImage.label})`,
          imageUrl: target.initialImage.url,
        });
      }
      layers.push({ name: "Paint", fill: "rgba(0,0,0,0)" });
      setInitialState({
        kind: "spec",
        spec: { width: target.size.w, height: target.size.h, layers },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Action handlers — all accept optional pre-fetched blobs (passed in
  // when Klecks's own OK button fired and already produced them) so we
  // don't double-export.

  const handleSaveToLibrary = useCallback(
    async (preFetchedPng?: Blob) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setIsBusy(true);
      try {
        let png = preFetchedPng;
        if (!png) {
          setProgress("Exporting…");
          const r = await requestExport();
          if ("error" in r) {
            toast.error("Couldn't save", { description: r.error });
            ackSubmit(false);
            return;
          }
          png = r.png;
        }
        setProgress("Uploading…");
        const result = await uploadLibrarySprite(
          png,
          `drawing-${Date.now()}.png`
        );
        if (!result.ok || !result.url) {
          toast.error("Upload failed", { description: result.error });
          ackSubmit(false);
          return;
        }
        toast.success("Saved to library");
        onLibraryUpdated();
        ackSubmit(true);
      } finally {
        savingRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    },
    [requestExport, onLibraryUpdated, ackSubmit]
  );

  const persistPsd = useCallback(
    async (
      scene: NonNullable<ResolvedTarget["scene"]>,
      psd: Blob
    ): Promise<{ ok: boolean; error?: string }> => {
      const uploaded = await uploadDrawingScenePsd(
        scene.roomId,
        scene.targetKind,
        scene.targetId,
        psd
      );
      if (!uploaded) return { ok: false, error: "PSD upload failed" };
      const saved = await saveDrawingScene(
        scene.roomId,
        scene.targetKind,
        scene.targetId,
        uploaded.path
      );
      return saved.ok ? { ok: true } : { ok: false, error: saved.error };
    },
    []
  );

  const handleSaveAndReplace = useCallback(
    async (preFetchedPng?: Blob, preFetchedPsd?: Blob) => {
      if (!editTarget || savingRef.current) return;
      savingRef.current = true;
      setIsBusy(true);
      try {
        let png = preFetchedPng;
        let psd = preFetchedPsd;
        if (!png || !psd) {
          setProgress("Exporting…");
          const r = await requestExport();
          if ("error" in r) {
            toast.error("Couldn't save", { description: r.error });
            ackSubmit(false);
            return;
          }
          png = r.png;
          psd = r.psd;
        }
        setProgress("Uploading…");
        const prefix =
          editTarget.kind === "background"
            ? "room-bg-drawing"
            : "sprite-drawing";
        const upload = await uploadLibrarySprite(
          png,
          `${prefix}-${Date.now()}.png`
        );
        if (!upload.ok || !upload.url) {
          toast.error("Upload failed", { description: upload.error });
          ackSubmit(false);
          return;
        }

        const store = useEditorStore.getState();
        if (editTarget.kind === "background") {
          const layer = editTarget.layer;
          store.updateRoom({
            [LAYER_URL_FIELD[layer]]: upload.url,
            [LAYER_ORIG_FIELD[layer]]: undefined,
            [LAYER_CROP_FIELD[layer]]: undefined,
          });
        } else {
          // Klecks always exports at canvas size, so no crop-dim coordination
          // is needed — the existing object width/height stays accurate.
          store.updateObject(editTarget.objectId, { spriteUrl: upload.url });
        }

        let sceneRes: { ok: boolean; error?: string } = { ok: true };
        if (target.scene) {
          sceneRes = await persistPsd(target.scene, psd);
        }

        const baseMsg =
          editTarget.kind === "background"
            ? "Background saved"
            : "Sprite saved";
        if (sceneRes.ok) {
          toast.success(baseMsg);
        } else {
          toast.warning(`${baseMsg} (scene didn't persist)`, {
            description: `${sceneRes.error}. The PNG saved fine; you may not be able to re-edit later.`,
          });
        }
        clearAutosave();
        onLibraryUpdated();
        ackSubmit(true);
        onClose();
      } finally {
        savingRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    },
    [
      clearAutosave,
      editTarget,
      target.scene,
      requestExport,
      persistPsd,
      ackSubmit,
      onLibraryUpdated,
      onClose,
    ]
  );

  const handleDropAsObject = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsBusy(true);
    try {
      setProgress("Exporting…");
      const r = await requestExport();
      if ("error" in r) {
        toast.error("Couldn't save", { description: r.error });
        return;
      }
      setProgress("Uploading…");
      // Klecks exports the whole canvas. Trim the empty margin so the object
      // (and its click area) hugs the drawing instead of covering the room.
      const trim = await trimTransparentPadding(r.png);
      const upload = await uploadLibrarySprite(
        trim.blob,
        `drawing-${Date.now()}.png`
      );
      if (!upload.ok || !upload.url) {
        toast.error("Upload failed", { description: upload.error });
        return;
      }
      const store = useEditorStore.getState();
      const config = store.currentRoomConfig;
      const roomId = store.currentRoomId;
      if (!config || !roomId) {
        toast.error("No room loaded");
        return;
      }
      const w = trim.w;
      const h = trim.h;
      // The scratch canvas is room-sized, so the drawing lands exactly where
      // it was drawn. Other canvas sizes scale the position proportionally.
      const sx = config.width / target.size.w;
      const sy = config.height / target.size.h;
      const x = trim.trimmed
        ? Math.round(trim.x * sx)
        : Math.round(config.width / 2 - w / 2);
      const y = trim.trimmed
        ? Math.round(trim.y * sy)
        : Math.round(config.height / 2 - h / 2);
      const newId = `object-${Date.now().toString(36)}`;
      store.addObject({
        id: newId,
        x,
        y,
        width: w,
        height: h,
        type: "object",
        label: "Drawing",
        labelAr: "رسم",
        interactionRadius: Math.round(Math.max(w, h) * 0.8),
        isWallMounted: false,
        spriteUrl: upload.url,
        // A fresh drawing is decoration until you give it something to do.
        interactionType: "none",
      });

      // The layered PSD is canvas-sized; only keep it when nothing was
      // trimmed, otherwise re-opening would stretch the full canvas into the
      // trimmed box. A trimmed drawing re-opens from its flattened PNG.
      let sceneRes: { ok: boolean; error?: string } = { ok: true };
      if (!trim.trimmed) {
        sceneRes = await persistPsd(
          { roomId, targetKind: "object", targetId: newId },
          r.psd
        );
      }
      if (sceneRes.ok) {
        toast.success("Dropped as object", {
          description: "Placed where you drew it. Set what it does in the side panel.",
        });
      } else {
        toast.warning("Dropped as object (scene didn't persist)", {
          description: `${sceneRes.error}. The PNG saved; you won't be able to re-edit this drawing later.`,
        });
      }
      clearAutosave();
      onLibraryUpdated();
      onClose();
    } finally {
      savingRef.current = false;
      setIsBusy(false);
      setProgress(null);
    }
  }, [requestExport, persistPsd, clearAutosave, target.size, onLibraryUpdated, onClose]);

  const handleSetAsBackground = useCallback(
    async (layer: BgLayer) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setIsBusy(true);
      try {
        setProgress("Exporting…");
        const r = await requestExport();
        if ("error" in r) {
          toast.error("Couldn't save", { description: r.error });
          return;
        }
        setProgress("Uploading…");
        const upload = await uploadLibrarySprite(
          r.png,
          `room-bg-drawing-${Date.now()}.png`
        );
        if (!upload.ok || !upload.url) {
          toast.error("Upload failed", { description: upload.error });
          return;
        }
        const store = useEditorStore.getState();
        const roomId = store.currentRoomId;
        store.updateRoom({
          [LAYER_URL_FIELD[layer]]: upload.url,
          [LAYER_ORIG_FIELD[layer]]: undefined,
          [LAYER_CROP_FIELD[layer]]: undefined,
        });

        let sceneRes: { ok: boolean; error?: string } = { ok: true };
        if (roomId) {
          sceneRes = await persistPsd(
            { roomId, targetKind: "background", targetId: `background_${layer}` },
            r.psd
          );
        }

        const label = LAYER_LABELS[layer];
        if (sceneRes.ok) {
          toast.success(`Set as "${label}" layer`);
        } else {
          toast.warning(`Set as "${label}" layer (scene didn't persist)`, {
            description: `${sceneRes.error}. The PNG saved; you won't be able to re-edit this drawing later.`,
          });
        }
        clearAutosave();
        onLibraryUpdated();
        onClose();
      } finally {
        savingRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    },
    [requestExport, persistPsd, clearAutosave, onLibraryUpdated, onClose]
  );

  // Klecks's own OK button → run the primary save action with the blobs it
  // already produced. Edit mode = Save & Replace, scratch = Save to Library.
  useEffect(() => {
    submitRef.current = (png, psd) => {
      if (isEditMode) void handleSaveAndReplace(png, psd);
      else void handleSaveToLibrary(png);
    };
  }, [isEditMode, handleSaveAndReplace, handleSaveToLibrary]);

  // ─── Send open once iframe ready + state loaded ──────────
  const open = bridge.open;
  useEffect(() => {
    if (!isReady || !initialState) return;
    if (initialState.kind === "psd") {
      open({ psdBuffer: initialState.buffer, autosaveKey: target.persistenceKey });
    } else {
      open({ spec: initialState.spec, autosaveKey: target.persistenceKey });
    }
  }, [isReady, initialState, open, target.persistenceKey]);

  // ─── Render ──────────────────────────────────────────────

  const replaceLabel = isEditMode
    ? target.initialImage
      ? "Save & Replace"
      : "Save"
    : "";

  const actions = (
    <>
      <button
        onClick={() => handleSaveToLibrary()}
        disabled={isBusy || !isReady}
        className="flex h-8 items-center gap-1 rounded bg-indigo-700 px-2.5 text-xs font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-40"
        title="Export PNG and save to Asset Library"
      >
        <ImageDown size={13} />
        Save to Library
      </button>

      {isEditMode ? (
        <button
          onClick={() => handleSaveAndReplace()}
          disabled={isBusy || !isReady}
          className="flex h-8 items-center gap-1 rounded bg-amber-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
          title={
            editTarget?.kind === "background"
              ? target.initialImage
                ? "Replace the current room background"
                : "Save as the room background"
              : target.initialImage
              ? "Replace the current object's sprite"
              : "Save as the object's sprite"
          }
        >
          <Replace size={13} />
          {replaceLabel}
        </button>
      ) : (
        <>
          <button
            onClick={handleDropAsObject}
            disabled={isBusy || !isReady}
            className="flex h-8 items-center gap-1 rounded bg-green-700 px-2.5 text-xs font-medium text-white transition-colors hover:bg-green-600 disabled:opacity-40"
            title="Drop as a new object in the current room"
          >
            <Wand2 size={13} />
            Drop as Object
          </button>

          <div className="group relative">
            {layerMenuOpen && (
              <div className="fixed inset-0 z-[9]" onClick={() => setLayerMenuOpen(false)} />
            )}
            <button
              disabled={isBusy || !isReady}
              onClick={() => setLayerMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={layerMenuOpen}
              className="relative z-10 flex h-8 items-center gap-1 rounded bg-purple-700 px-2.5 text-xs font-medium text-white transition-colors hover:bg-purple-600 disabled:opacity-40"
              title="Use this drawing as one of the room's three art layers"
            >
              <ImageIcon size={13} />
              Set as Layer ▾
            </button>
            <div
              role="menu"
              className={`absolute right-0 top-full z-10 mt-1 min-w-[160px] flex-col rounded border border-neutral-700 bg-neutral-800 shadow-xl group-focus-within:flex group-hover:flex ${layerMenuOpen ? "flex" : "hidden"}`}
            >
              {(["back", "middle", "front"] as const).map((bgLayer) => (
                <button
                  key={bgLayer}
                  role="menuitem"
                  onClick={() => {
                    setLayerMenuOpen(false);
                    handleSetAsBackground(bgLayer);
                  }}
                  disabled={isBusy || !isReady}
                  className="px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-purple-700 hover:text-white disabled:opacity-40"
                >
                  {LAYER_LABELS[bgLayer]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <StudioModal
      bridge={bridge}
      title={target.title}
      meta={
        <>
          <span className="rounded border border-neutral-700 bg-neutral-900/60 px-1.5 py-0.5 font-mono" title="Per-target persistence key">
            {target.persistenceKey}
          </span>{" "}
          <span title="Canvas size (fixed)">
            {target.size.w}×{target.size.h}
          </span>
        </>
      }
      actions={actions}
      progress={progress}
      busy={isBusy}
      // Force a remount when the target changes so a fresh Klecks
      // instance picks up the new project size + initial image.
      iframeKey={target.persistenceKey}
      zIndex={50}
      onClose={onClose}
    />
  );
}
