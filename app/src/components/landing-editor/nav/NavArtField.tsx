"use client";

// NavArtField — one drawable piece of the nav (logo, bar, a link's hover
// state…): Draw / Upload / Remove, per language. One language alone is used
// for both. Same storage as the chrome skins (ArcadeArt: PNG + the layered
// PSD's scene id, so Draw re-opens it with layers).

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import type { ArcadeArt } from "@/data/arcadeConfig";
import type { LocalizedArt } from "@/data/landingTypes";
import { uploadContentImage } from "@/lib/editorData";
import LandingDrawModal from "../LandingDrawModal";
import { InfoTip } from "../InfoTip";
import { Button } from "@/components/ui/button";

function naturalSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 400, h: 160 });
    img.src = url;
  });
}

export function NavArtField({
  label,
  info,
  value,
  onChange,
  canvas,
  trim = true,
  guideUrl,
}: {
  label: string;
  info?: string;
  value: LocalizedArt | undefined;
  onChange: (v: LocalizedArt | undefined) => void;
  /** Drawing canvas size. */
  canvas: { w: number; h: number };
  /** Crop the drawing to its painted pixels (false for full-bleed pieces). */
  trim?: boolean;
  /** Faded reference shown while drawing (e.g. the bar, for a hover state). */
  guideUrl?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingLang = useRef<"en" | "ar">("en");
  const [drawing, setDrawing] = useState<"en" | "ar" | null>(null);

  const set = (lang: "en" | "ar", art: ArcadeArt | null) => {
    const next = { ...value, [lang]: art };
    onChange(next.en || next.ar ? next : undefined);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {label}
        {info && <InfoTip text={info} side="right" />}
      </div>
      {(["en", "ar"] as const).map((lang) => {
        const art = value?.[lang] ?? null;
        const shared = !art && (value?.en || value?.ar);
        return (
          <div key={lang} className="flex items-center gap-2">
            <div className="grid h-10 w-20 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:8px_8px]">
              {art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={art.url} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="px-1 text-center text-[10px] leading-tight text-muted-foreground">
                  {shared ? `uses ${lang === "en" ? "Arabic" : "English"}` : "none"}
                </span>
              )}
            </div>
            <span className="min-w-0 flex-1 truncate text-[12px]">{lang === "en" ? "English" : "Arabic"}</span>
            <Button size="sm" variant="outline" onClick={() => setDrawing(lang)}>
              <Pencil /> {art ? "Redraw" : "Draw"}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Upload an image"
              onClick={() => {
                pendingLang.current = lang;
                fileRef.current?.click();
              }}
            >
              <ImagePlus />
            </Button>
            {art && (
              <Button size="icon-sm" variant="ghost" title="Remove" onClick={() => set(lang, null)}>
                <Trash2 />
              </Button>
            )}
          </div>
        );
      })}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/svg+xml,image/jpeg"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const url = await uploadContentImage(f, "landing");
          if (!url) {
            toast.error("Upload failed");
            return;
          }
          const n = await naturalSize(url);
          set(pendingLang.current, { kind: "upload", url, naturalW: n.w, naturalH: n.h });
        }}
      />
      {drawing &&
        createPortal(
          <LandingDrawModal
            title={`Draw: ${label} (${drawing === "ar" ? "Arabic" : "English"})`}
            canvas={canvas}
            trimToContent={trim}
            guideUrl={guideUrl}
            saveLabel="Use this drawing"
            edit={(() => {
              const a = value?.[drawing];
              return a ? { sceneId: a.sceneId, pngUrl: a.url } : undefined;
            })()}
            onClose={() => setDrawing(null)}
            onSaved={(url, size, sceneId) =>
              set(drawing, {
                kind: sceneId ? "drawn" : "upload",
                url,
                sceneId,
                naturalW: size?.w ?? canvas.w,
                naturalH: size?.h ?? canvas.h,
              })
            }
          />,
          document.body
        )}
    </div>
  );
}
