"use client";

// ArcadeChromeEditor — Arcade Studio's "Screen UI" panel: skin the on-screen
// controls around the arcade with your own drawings, and place each one per
// device. The language switcher is site-wide (saved with the site settings,
// same Save button); the rest belongs to the arcade.
//
// A live mini-screen shows where everything sits on the device being edited
// (the Desktop / Mobile toggle at the top of the editor).

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import type { ArcadeArt } from "@/data/arcadeConfig";
import {
  CHROME_DEFAULT_PLACEMENT,
  CHROME_SLOT_LABEL,
  resolvedPlacement,
  type ArcadeChrome,
  type ChromeAnchor,
  type ChromeSkin,
  type ChromeSlotId,
} from "@/data/chromeSkin";
import { uploadContentImage } from "@/lib/editorData";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import LandingDrawModal from "./LandingDrawModal";
import { InfoTip } from "./InfoTip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANCHORS: { value: ChromeAnchor; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top centre" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom centre" },
  { value: "bottom-right", label: "Bottom right" },
];

const SLOT_INFO: Record<ChromeSlotId, string> = {
  languagePill:
    "The EN / عربي switch in the corner of every page. Its art and placement are site-wide: saved separately with Save & go live.",
  close: "The button that leaves the game while playing.",
  hudLanguage: "The language switch shown while playing the game.",
  map: "Opens the room list while playing (only shown when the world has more than one room).",
};

function naturalSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 400, h: 160 });
    img.src = url;
  });
}

type ArtKey = "art" | "hoverArt";

export function ArcadeChromeEditor({
  chrome,
  device,
  onArcadeChrome,
}: {
  chrome: ArcadeChrome;
  device: "desktop" | "mobile";
  /** Write the arcade's chrome (one undo step). */
  onArcadeChrome: (next: ArcadeChrome) => void;
}) {
  const siteHydrate = useSiteConfigEditorStore((s) => s.hydrate);
  const pillSkin = useSiteConfigEditorStore((s) => s.config.chrome?.languagePill);
  const updateChromeSkin = useSiteConfigEditorStore((s) => s.updateChromeSkin);
  useEffect(() => {
    void siteHydrate();
  }, [siteHydrate]);

  const [slot, setSlot] = useState<ChromeSlotId>("languagePill");
  const skinOf = (id: ChromeSlotId): ChromeSkin | undefined =>
    id === "languagePill" ? pillSkin : chrome[id];
  const setSkin = (id: ChromeSlotId, skin: ChromeSkin) => {
    if (id === "languagePill") updateChromeSkin("languagePill", skin);
    else onArcadeChrome({ ...chrome, [id]: skin });
  };
  const skin = skinOf(slot) ?? {};
  const place = resolvedPlacement(skin, slot, device);
  const setDevice = (patch: Partial<NonNullable<ChromeSkin["desktop"]>>) =>
    setSkin(slot, { ...skin, [device]: { ...place, ...skin[device], ...patch } });

  // Art upload / draw.
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<{ key: ArtKey; lang: "en" | "ar" } | null>(null);
  const [drawing, setDrawing] = useState<{ key: ArtKey; lang: "en" | "ar" } | null>(null);
  const setArt = (key: ArtKey, lang: "en" | "ar", art: ArcadeArt | null) =>
    setSkin(slot, { ...skin, [key]: { ...skin[key], [lang]: art } });

  const artRow = (key: ArtKey, lang: "en" | "ar", label: string) => {
    const art = skin[key]?.[lang] ?? null;
    return (
      <div className="flex items-center gap-2" key={`${key}-${lang}`}>
        <div className="grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded border border-border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:8px_8px]">
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art.url} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">built-in</span>
          )}
        </div>
        <span className="min-w-0 flex-1 truncate text-[12px]">{label}</span>
        <Button size="icon-xs" variant="ghost" title={`Draw: ${label}`} onClick={() => setDrawing({ key, lang })}>
          <Pencil />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title={`Upload: ${label}`}
          onClick={() => {
            pending.current = { key, lang };
            fileRef.current?.click();
          }}
        >
          <ImagePlus />
        </Button>
        {art && (
          <Button size="icon-xs" variant="ghost" title="Back to the built-in look" onClick={() => setArt(key, lang, null)}>
            <Trash2 />
          </Button>
        )}
      </div>
    );
  };

  const hints = (which: "exitHint" | "controlsHint", label: string, info: string, placeholder: { en: string; ar: string }) => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {label}
        <InfoTip text={info} />
      </div>
      {(["en", "ar"] as const).map((lang) => (
        <Input
          key={lang}
          className="h-8 text-[12px]"
          dir={lang === "ar" ? "rtl" : "ltr"}
          placeholder={placeholder[lang]}
          value={chrome[which]?.[lang] ?? ""}
          onChange={(e) => onArcadeChrome({ ...chrome, [which]: { ...chrome[which], [lang]: e.target.value } })}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Slot picker */}
      <Select value={slot} onValueChange={(v) => setSlot(v as ChromeSlotId)}>
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(CHROME_SLOT_LABEL) as ChromeSlotId[]).map((id) => (
            <SelectItem key={id} value={id}>
              {CHROME_SLOT_LABEL[id]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <InfoTip text={SLOT_INFO[slot]} />
        {SLOT_INFO[slot]}
      </p>

      <ChromePreview chrome={chrome} pillSkin={pillSkin} device={device} active={slot} />

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          Art
          <InfoTip text="Replace the built-in pill with your own drawing, one per language (the English art shows to English visitors, the Arabic art to Arabic visitors; one alone is used for both). The optional hover image swaps in when a mouse is over it. Draw opens the studio; transparent edges are trimmed so the image hugs your drawing." />
        </div>
        {artRow("art", "en", "Art · English")}
        {artRow("art", "ar", "Art · Arabic")}
        {artRow("hoverArt", "en", "Hover · English (optional)")}
        {artRow("hoverArt", "ar", "Hover · Arabic (optional)")}
      </div>

      <div className="space-y-2 rounded-md border border-border p-2">
        <label className="flex items-center justify-between gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1.5">
            Custom position on {device === "mobile" ? "phones" : "desktop"}
            <InfoTip text="Pin this control to a screen corner or edge with an offset, separately for desktop and phones (switch Desktop / Mobile at the top). Off = its built-in spot. The two in-game buttons (language + map) leave their row together, so pinning one also places the other at its default spot." />
          </span>
          <Switch size="sm" checked={place.custom} onCheckedChange={(custom) => setDevice({ custom })} />
        </label>
        {place.custom && (
          <>
            <Select
              value={place.anchor}
              // A new edge starts at a sensible offset (centre anchors at 0)
              // instead of keeping one measured from the old edge.
              onValueChange={(v) =>
                setDevice({ anchor: v as ChromeAnchor, x: v.endsWith("center") ? 0 : 16, y: 16 })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANCHORS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["x", "Side px", "Distance from the side edge (centre anchors: shift left/right)."],
                  ["y", "Edge px", "Distance from the top or bottom edge (phone notches are added automatically)."],
                  ["size", "Size px", "Height of your art in pixels (the built-in pill keeps its own size)."],
                ] as const
              ).map(([k, label, info]) => (
                <label key={k} className="block space-y-1">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {label}
                    <InfoTip text={info} />
                  </span>
                  <Input
                    type="number"
                    className="h-8"
                    value={place[k]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isNaN(v)) setDevice({ [k]: k === "size" ? Math.max(12, v) : v });
                    }}
                  />
                </label>
              ))}
            </div>
          </>
        )}
        <label className="flex items-center justify-between gap-2 text-[13px]">
          <span className="inline-flex items-center gap-1.5">
            Hide on {device === "mobile" ? "phones" : "desktop"}
            <InfoTip text="Remove this control on this device only. Careful with ✕: on desktop visitors can still scroll or swipe out of the game, but the button is the obvious way out." />
          </span>
          <Switch size="sm" checked={place.hidden} onCheckedChange={(hidden) => setDevice({ hidden })} />
        </label>
        {(skin.desktop || skin.mobile) && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setSkin(slot, { art: skin.art, hoverArt: skin.hoverArt })}
          >
            Reset position on both devices
          </Button>
        )}
      </div>

      {hints(
        "exitHint",
        "“How to leave” hint (first play)",
        "The short tip shown the first time someone plays. Leave empty for the built-in wording.",
        { en: "Scroll down to pull back", ar: "اسحب للأسفل للخروج" }
      )}
      {hints(
        "controlsHint",
        "Controls hint (while playing)",
        "The tip in the corner while playing. Empty = the built-in wording (which says Tap on phones and Click on desktop).",
        { en: "Click to walk • Click objects to interact", ar: "انقر للمشي • انقر على الأشياء للتفاعل" }
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/svg+xml,image/jpeg"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          const p = pending.current;
          if (!f || !p) return;
          const url = await uploadContentImage(f, "landing");
          if (!url) {
            toast.error("Upload failed");
            return;
          }
          const n = await naturalSize(url);
          setArt(p.key, p.lang, { kind: "upload", url, naturalW: n.w, naturalH: n.h });
        }}
      />
      {drawing && (
        <LandingDrawModal
          title={`Draw: ${CHROME_SLOT_LABEL[slot]} — ${drawing.key === "hoverArt" ? "hover" : "art"} (${drawing.lang === "ar" ? "Arabic" : "English"})`}
          canvas={{ w: 1024, h: 1024 }}
          saveLabel="Use this art"
          edit={(() => {
            const a = skin[drawing.key]?.[drawing.lang];
            return a ? { sceneId: a.sceneId, pngUrl: a.url } : undefined;
          })()}
          onClose={() => setDrawing(null)}
          onSaved={(url, size, sceneId) =>
            setArt(drawing.key, drawing.lang, {
              kind: sceneId ? "drawn" : "upload",
              url,
              sceneId,
              naturalW: size?.w ?? 1024,
              naturalH: size?.h ?? 1024,
            })
          }
        />
      )}
    </div>
  );
}

/** Mini screen showing where each control sits on the device being edited. */
function ChromePreview({
  chrome,
  pillSkin,
  device,
  active,
}: {
  chrome: ArcadeChrome;
  pillSkin: ChromeSkin | undefined;
  device: "desktop" | "mobile";
  active: ChromeSlotId;
}) {
  const vp = device === "mobile" ? { w: 390, h: 844 } : { w: 1440, h: 900 };
  const boxW = device === "mobile" ? 120 : 260;
  const k = boxW / vp.w;
  const slots: ChromeSlotId[] = ["languagePill", "close", "hudLanguage", "map"];
  return (
    <div className="flex justify-center">
      <div
        className="relative overflow-hidden rounded border border-border bg-neutral-800"
        style={{ width: boxW, height: vp.h * k }}
        aria-label="Preview of the on-screen controls"
      >
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[9px] text-white/30">
          {device === "mobile" ? "phone" : "desktop"} · playing
        </span>
        {slots.map((id) => {
          const skin = id === "languagePill" ? pillSkin : chrome[id];
          const p = resolvedPlacement(skin, id, device);
          if (p.hidden) return null;
          const defaultSpot = !p.custom;
          const pp = defaultSpot ? CHROME_DEFAULT_PLACEMENT[id][device] : p;
          const [v, h] = pp.anchor.split("-");
          const art = skin?.art?.en ?? skin?.art?.ar;
          const style: React.CSSProperties = {
            position: "absolute",
            [v === "top" ? "top" : "bottom"]: pp.y * k,
            ...(h === "left"
              ? { left: pp.x * k }
              : h === "right"
                ? { right: pp.x * k }
                : { left: `calc(50% + ${pp.x * k}px)`, transform: "translateX(-50%)" }),
            height: Math.max(6, (art ? pp.size : 40) * k),
          };
          return (
            <div
              key={id}
              style={style}
              className={`flex items-center justify-center rounded-sm text-[7px] leading-none ${
                id === active ? "outline outline-1 outline-amber-400" : ""
              } ${art ? "" : "bg-white/80 px-1 text-black"}`}
              title={CHROME_SLOT_LABEL[id]}
            >
              {art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={art.url} alt="" className="h-full w-auto" />
              ) : id === "close" ? (
                "✕"
              ) : id === "map" ? (
                "Map"
              ) : (
                "عربي"
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
