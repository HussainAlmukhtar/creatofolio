"use client";

// ArtPicker — one drawable slot (a theme part or a frame drawing):
// thumbnail · Draw (Klecks, on the part's own canvas, over a faint GUIDE
// layer that is never saved) · Upload (media library) · Back to default.
//
// Drawings keep their layers: LandingDrawModal stores the PSD under a fresh
// sceneId (drawing-scenes/landing/<id>.psd) and "Draw" on an existing
// drawing reopens it with layers intact (a fresh guide swapped in).

import dynamic from "next/dynamic";
import { useState } from "react";
import { ImageIcon, Paintbrush, RotateCcw, Upload } from "lucide-react";
import type { DrawnArt } from "@/data/popupStyleTypes";
import { MediaLibraryDialog } from "@/components/landing-editor/MediaLibraryDialog";

const LandingDrawModal = dynamic(() => import("@/components/landing-editor/LandingDrawModal"), { ssr: false });

export function ArtPicker({
  label,
  hint,
  art,
  canvas,
  guide,
  onChange,
  defaultLabel = "Default",
  thumbClass = "size-16",
}: {
  label: string;
  hint?: string;
  art: DrawnArt | null | undefined;
  canvas: { w: number; h: number };
  /** Builds the GUIDE layer image when Draw opens (data URL). */
  guide: () => string;
  onChange: (art: DrawnArt | null) => void;
  defaultLabel?: string;
  thumbClass?: string;
}) {
  const [drawing, setDrawing] = useState<{ guideUrl: string } | null>(null);
  const [library, setLibrary] = useState(false);

  return (
    <div className="flex gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div
        className={`media-tile grid shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-neutral-700 ${thumbClass}`}
      >
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art.url} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImageIcon className="size-5 text-neutral-500" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium">{label}</p>
          <span className={`text-[11px] ${art ? "text-emerald-300" : "text-neutral-500"}`}>
            {art ? (art.sceneId ? "Drawn" : "Uploaded") : defaultLabel}
          </span>
        </div>
        {hint && <p className="text-[11px] leading-snug text-neutral-400 touch:text-[13px]">{hint}</p>}
        <div className="flex flex-wrap gap-1.5">
          <SmallBtn onClick={() => setDrawing({ guideUrl: guide() })}>
            <Paintbrush className="size-3.5" /> {art?.sceneId ? "Edit drawing" : "Draw"}
          </SmallBtn>
          <SmallBtn onClick={() => setLibrary(true)}>
            <Upload className="size-3.5" /> Upload
          </SmallBtn>
          {art && (
            <SmallBtn onClick={() => onChange(null)}>
              <RotateCcw className="size-3.5" /> {defaultLabel === "Default" ? "Back to default" : "Remove"}
            </SmallBtn>
          )}
        </div>
      </div>

      {drawing && (
        <LandingDrawModal
          title={`Draw: ${label}`}
          canvas={canvas}
          fixedCanvas
          trimToContent={false}
          guideUrl={drawing.guideUrl}
          edit={art ? { sceneId: art.sceneId, pngUrl: art.url } : undefined}
          saveLabel="Use this drawing"
          onClose={() => setDrawing(null)}
          onSaved={(url, _size, sceneId) =>
            onChange({ url, ...(sceneId ? { sceneId } : {}), w: canvas.w, h: canvas.h })
          }
        />
      )}
      <MediaLibraryDialog
        open={library}
        onOpenChange={setLibrary}
        uploadKind="content"
        title={`Upload: ${label}`}
        onPick={({ url, naturalSize }) =>
          onChange({ url, w: naturalSize?.w ?? canvas.w, h: naturalSize?.h ?? canvas.h })
        }
      />
    </div>
  );
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
    >
      {children}
    </button>
  );
}
