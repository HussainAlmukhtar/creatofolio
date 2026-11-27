"use client";

// LandingDrawModal — draw a custom element (button/shape/illustration) with the
// same Klecks studio the game editor uses, and drop the result into the current
// landing section as a positioned asset.
//
// It reuses the /klecks/index.html iframe + postMessage protocol (open a
// project, requestExport on save) but its save logic is landing-specific — it
// uploads the PNG and hands the URL to the caller. The game's DrawModalInner is
// left untouched (it is coupled to the room store).
//
// Re-editable: every save also keeps the layered PSD (lib/landingDrawings.ts)
// under a fresh sceneId, returned to the caller to store on the asset /
// background as `{ kind: "drawn", sceneId, pngUrl }`. Opening with `edit`
// reloads that PSD (layers intact); a drawing with no PSD — anything made
// before PSDs were kept, or a plain uploaded image — opens as a single layer
// holding the flattened image, so it can still be drawn over.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trimTransparentPadding } from "@/lib/trimImage";
import { uploadContentImage } from "@/lib/editorData";
import {
  loadLandingScenePsd,
  newLandingSceneId,
  uploadLandingScenePsd,
} from "@/lib/landingDrawings";
import { StudioModal } from "@/components/studio/StudioModal";
import { useStudioBridge } from "@/components/studio/useStudioBridge";

/** Largest side of a canvas opened from a flattened image (px). */
const MAX_IMPORT_SIDE = 2000;

type OpenMessage =
  | {
      type: "open";
      psdBuffer: ArrayBuffer;
      /** Replace the PSD's saved GUIDE layers with this fresh one. */
      guide?: { imageUrl: string; opacity: number; name: string };
    }
  | {
      type: "open";
      spec: {
        width: number;
        height: number;
        layers: (
          | { name: string; fill: string }
          | { name: string; imageUrl: string; opacity?: number }
        )[];
      };
    };

function naturalSizeOf(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** What to open the studio with: the saved PSD, the flattened image, or blank. */
async function resolveOpenMessage(
  canvas: { w: number; h: number },
  edit: { sceneId?: string; pngUrl: string } | undefined,
  opts: { guideUrl?: string; fixedCanvas?: boolean } = {}
): Promise<{ msg: OpenMessage; fromPsd: boolean }> {
  if (edit?.sceneId) {
    const psdBuffer = await loadLandingScenePsd(edit.sceneId);
    if (psdBuffer) {
      return {
        msg: {
          type: "open",
          psdBuffer,
          // The wrapper swaps the PSD's old guide for this current one.
          guide: opts.guideUrl
            ? { imageUrl: opts.guideUrl, opacity: 0.45, name: "GUIDE — reference, not saved" }
            : undefined,
        },
        fromPsd: true,
      };
    }
  }
  // Reference art under the drawing, left out of the saved PNG (the Klecks
  // wrapper skips layers named GUIDE…).
  const guide = opts.guideUrl
    ? [{ name: "GUIDE — reference, not saved", imageUrl: opts.guideUrl, opacity: 0.45 }]
    : [];
  if (opts.fixedCanvas) {
    // The canvas size is fixed by the caller (e.g. the arcade machine, whose
    // back and front layers must align pixel for pixel): any existing image
    // is stretched onto it rather than opening at its own size.
    return {
      msg: {
        type: "open",
        spec: {
          width: canvas.w,
          height: canvas.h,
          layers: [
            ...guide,
            edit?.pngUrl
              ? { name: "Drawing", imageUrl: edit.pngUrl }
              : { name: "Paint", fill: "rgba(0,0,0,0)" },
          ],
        },
      },
      fromPsd: false,
    };
  }
  if (edit?.pngUrl) {
    const size = await naturalSizeOf(edit.pngUrl);
    if (size && size.w > 0 && size.h > 0) {
      const scale = Math.min(1, MAX_IMPORT_SIDE / Math.max(size.w, size.h));
      return {
        msg: {
          type: "open",
          spec: {
            width: Math.round(size.w * scale),
            height: Math.round(size.h * scale),
            layers: [{ name: "Drawing", imageUrl: edit.pngUrl }],
          },
        },
        fromPsd: false,
      };
    }
  }
  return {
    msg: {
      type: "open",
      spec: {
        width: canvas.w,
        height: canvas.h,
        layers: [{ name: "Paint", fill: "rgba(0,0,0,0)" }],
      },
    },
    fromPsd: false,
  };
}

interface LandingDrawModalProps {
  /**
   * Called with the uploaded PNG URL when the drawing is saved. When
   * `trimToContent` crops the export, `naturalSize` carries the cropped
   * pixel dimensions so the caller can size the new asset to match the
   * drawing's real aspect ratio instead of a generic default. `sceneId` is
   * the kept PSD's id — undefined if the PSD couldn't be stored (the PNG
   * still saved; store it as a plain upload).
   */
  onSaved: (
    url: string,
    naturalSize?: { w: number; h: number },
    sceneId?: string
  ) => void;
  onClose: () => void;
  title?: string;
  /** Drawing canvas size. Wide for backgrounds, square for elements. */
  canvas?: { w: number; h: number };
  /**
   * Crop the export to the bounding box of its non-transparent pixels before
   * upload, so a small doodle on a big canvas becomes a small element instead
   * of one padded with empty space. Only right for standalone elements — a
   * section background is meant to fill the whole canvas, so callers drawing
   * a background pass false.
   * @default true
   */
  trimToContent?: boolean;
  /**
   * Re-open an existing drawing instead of a blank canvas: its PSD when
   * `sceneId` has one, else the flattened `pngUrl` as a layer.
   */
  edit?: { sceneId?: string; pngUrl: string };
  /** Save button label. @default "Add to section" */
  saveLabel?: string;
  /** Reference image shown as a faded bottom layer, never saved. */
  guideUrl?: string;
  /** Always open at exactly `canvas` (stretching any existing image). */
  fixedCanvas?: boolean;
  /** Where unsaved work is kept on this device while drawing (and offered back
   *  if the page closes first). One key per thing being drawn. */
  autosaveKey?: string;
}


export default function LandingDrawModal({
  onSaved,
  onClose,
  title = "Draw an element",
  canvas = { w: 800, h: 800 },
  trimToContent = true,
  edit,
  saveLabel = "Add to section",
  guideUrl,
  fixedCanvas,
  autosaveKey,
}: LandingDrawModalProps) {
  const CANVAS = canvas;
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // A ref, not state: two quick taps on Save must not start two exports.
  const savingRef = useRef(false);

  const saveRef = useRef<(png?: Blob, psd?: Blob) => Promise<void>>(async () => {});
  const bridge = useStudioBridge({ onSubmit: (r) => void saveRef.current(r.png, r.psd) });
  const { requestExport, ackSubmit, clearAutosave } = bridge;

  const saveDrawing = useCallback(
    async (preFetchedPng?: Blob, preFetchedPsd?: Blob) => {
      if (savingRef.current) return;
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
        // Keep the layered source first. A failed PSD upload doesn't block
        // the save — the PNG is what visitors see — but say so, since the
        // layers won't come back next time.
        setProgress("Saving layers…");
        const sceneId = newLandingSceneId();
        const psdKept = await uploadLandingScenePsd(sceneId, psd);
        if (!psdKept) {
          toast.warning("Layers couldn't be kept", {
            description:
              "The drawing is saved, but re-opening it will show a flattened image.",
          });
        }
        let uploadBlob: Blob = png;
        let naturalSize: { w: number; h: number } | undefined;
        if (trimToContent) {
          const trimmed = await trimTransparentPadding(png);
          uploadBlob = trimmed.blob;
          naturalSize = { w: trimmed.w, h: trimmed.h };
        }
        setProgress("Uploading…");
        const url = await uploadContentImage(uploadBlob);
        if (!url) {
          toast.error("Upload failed", { description: "Nothing was saved. Your drawing is still open: try again." });
          ackSubmit(false);
          return;
        }
        onSaved(url, naturalSize, psdKept ? sceneId : undefined);
        clearAutosave();
        ackSubmit(true);
        onClose();
      } catch (e) {
        toast.error("Couldn't save", { description: e instanceof Error ? e.message : String(e) });
        ackSubmit(false);
      } finally {
        savingRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    },
    [requestExport, ackSubmit, clearAutosave, onSaved, onClose, trimToContent]
  );
  useEffect(() => {
    saveRef.current = saveDrawing;
  }, [saveDrawing]);

  // Once ready, open the project: the saved PSD, the flattened image, or a
  // fresh transparent canvas (resolveOpenMessage). Only the first ready runs
  // this — `edit` is fixed for the modal's lifetime.
  const [openedSize, setOpenedSize] = useState<string | null>(null);
  const editSceneId = edit?.sceneId;
  const editPngUrl = edit?.pngUrl;
  const isReady = bridge.isReady;
  const open = bridge.open;
  const key = autosaveKey ?? `landing-draw:${editSceneId ?? editPngUrl ?? title}`;
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    void (async () => {
      const { msg, fromPsd } = await resolveOpenMessage(
        CANVAS,
        editPngUrl ? { sceneId: editSceneId, pngUrl: editPngUrl } : undefined,
        { guideUrl, fixedCanvas }
      );
      if (cancelled) return;
      open({ ...msg, autosaveKey: key });
      setOpenedSize(
        "spec" in msg
          ? `${msg.spec.width}×${msg.spec.height}`
          : fromPsd
            ? "layers restored"
            : null
      );
    })();
    return () => {
      cancelled = true;
    };
    // CANVAS is a fresh object per render; its numbers are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, CANVAS.w, CANVAS.h, editSceneId, editPngUrl, guideUrl, fixedCanvas, key, open]);

  return (
    <StudioModal
      bridge={bridge}
      title={title}
      meta={openedSize ?? `${CANVAS.w}×${CANVAS.h}`}
      progress={progress}
      busy={isBusy}
      onClose={onClose}
      actions={
        <button
          type="button"
          onClick={() => void saveDrawing()}
          disabled={isBusy || !isReady}
          className="h-8 rounded bg-indigo-700 px-3 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-40"
        >
          {isBusy ? "Saving…" : saveLabel}
        </button>
      }
    />
  );
}
