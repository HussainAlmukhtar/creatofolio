"use client";

// ArcadeInspector — the right-rail controls for the arcade scene ("Arcade
// Studio"). Everything edits the section's stored `arcade` config through
// updateArcade (one undo step per change); values for the CURRENT device
// (the editor's Desktop / Phone toggle) are edited where they're per-device.
//
//   Machine  — draw/upload the back + front layers on one shared canvas,
//              mark the screen, place/rotate, layer order, hover, idle motion,
//              CTA + poster art.
//   Camera   — the device frame (aspect, letterbox), the rest framing, scroll
//              keyframes (with a live scrub preview), the click-in zoom.
//   Guards   — the four guardrails (toggles, warnings only) + live warnings.

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crop,
  Eye,
  ImagePlus,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  Video,
} from "lucide-react";
import type { DrawnSection } from "@/data/landingTypes";
import {
  ARCADE_EASES,
  ARCADE_MACHINE_IID,
  BUILTIN_CTA,
  BUILTIN_MACHINE_BACK,
  GAME_SCREEN_ASPECT,
  machinePlacement,
  machineVariant,
  resolveArcade,
  screenHeightPct,
  type AmbientPreset,
  type ArcadeArt,
  type ArcadeCamera,
  type ArcadeConfig,
  type ArcadeDeviceKey,
  type ArcadeEase,
  type ArcadeHover,
  type MachineArt,
  type StoredArcadeConfig,
} from "@/data/arcadeConfig";
import { cameraAt, mixCamera, playCamera } from "@/lib/arcadeCamera";
import {
  arcadeImageBytes,
  arcadeWarnings,
  machineDrawCanvas,
  machineRequiredWidth,
  MAX_DRAW_SIDE,
} from "@/lib/arcadeQuality";
import { uploadContentImage } from "@/lib/editorData";
import { newIid } from "@/lib/iid";
import { backdropBounds, backdropCanvasFor, buildBackdropGuide, isBackdropAsset } from "@/lib/arcadeGuides";
import { isMachineLocked } from "@/lib/layerLock";
import { toggleMachineLockWithFeedback } from "@/lib/landingEditorActions";
import { LockButton, LockedNote } from "./LockControls";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import LandingDrawModal from "./LandingDrawModal";
import { InfoTip } from "./InfoTip";
import { BackdropPlaceDialog } from "./BackdropPlaceDialog";
import { ArcadeChromeEditor } from "./ArcadeChromeEditor";
import { withCamera } from "./ArcadeEditorStage";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Small field helpers ────────────────────────────────────

function Row({
  label,
  hint,
  info,
  children,
}: {
  label: string;
  hint?: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        {info && <InfoTip text={info} />}
      </Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Num({
  label,
  value,
  step = 0.5,
  min,
  max,
  info,
  readOnly,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  info?: React.ReactNode;
  /** Layer lock: shown, not editable. */
  readOnly?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{label}</span>
        {info && <InfoTip text={info} />}
      </span>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        className={readOnly ? "h-8 opacity-60" : "h-8"}
        readOnly={readOnly}
        aria-readonly={readOnly || undefined}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onChange={(e) => {
          if (readOnly) return;
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  info,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  info?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 text-[13px]">
      <span>
        <span className="inline-flex items-center gap-1.5">
          {label}
          {info && <InfoTip text={info} />}
        </span>
        {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Pick<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-8 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Block({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background/30">
      <div className="flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium">
        {title}
        {info && <InfoTip text={info} />}
      </div>
      <div className="space-y-3.5 border-t border-border px-3 pb-3.5 pt-3">{children}</div>
    </section>
  );
}

const EASE_LABEL: Record<ArcadeEase, string> = {
  none: "Linear",
  "sine.inOut": "Gentle in/out",
  "power1.inOut": "Soft in/out",
  "power2.inOut": "In/out",
  "power2.out": "Settle (ease out)",
  "power2.in": "Build up (ease in)",
  "power3.out": "Strong settle",
  "expo.out": "Snap then glide",
};
const EASE_OPTIONS = ARCADE_EASES.map((e) => ({ value: e, label: EASE_LABEL[e] }));

const FRAME_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Same as drawing", w: 0, h: 0 },
  { label: "16:10 laptop", w: 16, h: 10 },
  { label: "16:9 widescreen", w: 16, h: 9 },
  { label: "21:9 ultrawide", w: 21, h: 9 },
  { label: "4:5 portrait", w: 4, h: 5 },
  { label: "9:16 phone", w: 9, h: 16 },
  { label: "9:19.5 tall phone", w: 9, h: 19.5 },
];

const SHAPE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "3:4 upright cabinet", w: 750, h: 1000 },
  { label: "2:3 tall cabinet", w: 800, h: 1200 },
  { label: "1:1 square", w: 1000, h: 1000 },
  { label: "4:3 cocktail table", w: 1200, h: 900 },
];

// ─── Scroll zoom presets ────────────────────────────────────

type ZoomPresetId = "none" | "short" | "medium" | "long" | "custom";
const ZOOM_PRESETS: Record<Exclude<ZoomPresetId, "custom" | "none">, {
  lengthVh: number;
  smoothing: number;
  steps: { at: number; scale: number; ease: ArcadeEase }[];
}> = {
  short: { lengthVh: 100, smoothing: 0.6, steps: [{ at: 1, scale: 0.75, ease: "sine.inOut" }] },
  medium: {
    lengthVh: 180,
    smoothing: 1,
    steps: [
      { at: 0.6, scale: 0.55, ease: "power1.inOut" },
      { at: 1, scale: 0.5, ease: "sine.inOut" },
    ],
  },
  long: { lengthVh: 300, smoothing: 1.2, steps: [{ at: 1, scale: 0.35, ease: "sine.inOut" }] },
};

/** Scroll config for a preset, zooming out around the current rest aim. */
function zoomPreset(id: Exclude<ZoomPresetId, "custom">, dev: ArcadeConfig["desktop"]): ArcadeConfig["desktop"]["scroll"] {
  if (id === "none") return { ...dev.scroll, enabled: false };
  const p = ZOOM_PRESETS[id];
  return {
    enabled: true,
    lengthVh: p.lengthVh,
    smoothing: p.smoothing,
    keyframes: p.steps.map((st) => ({
      at: st.at,
      ease: st.ease,
      camera: { ...dev.rest, scale: Math.round(dev.rest.scale * st.scale * 1000) / 1000 },
    })),
  };
}

function detectZoomPreset(dev: ArcadeConfig["desktop"]): ZoomPresetId {
  if (!dev.scroll.enabled) return "none";
  for (const id of ["short", "medium", "long"] as const) {
    const want = zoomPreset(id, dev);
    const same =
      want.lengthVh === dev.scroll.lengthVh &&
      want.keyframes.length === dev.scroll.keyframes.length &&
      want.keyframes.every((k, i) => {
        const h = dev.scroll.keyframes[i];
        return (
          Math.abs(k.at - h.at) < 0.001 &&
          Math.abs(k.camera.scale - h.camera.scale) < 0.002 &&
          Math.abs(k.camera.focusX - h.camera.focusX) < 0.01 &&
          Math.abs(k.camera.focusY - h.camera.focusY) < 0.01 &&
          Math.abs(k.camera.rotation - h.camera.rotation) < 0.01
        );
      });
    if (same) return id;
  }
  return "custom";
}

// ─── Art helpers ────────────────────────────────────────────

function naturalSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * The faded reference layer for drawing one machine layer: the OTHER layer
 * (or the built-in cabinet) stretched to the shared canvas, plus the game
 * screen rect. Returned as a blob: URL (same-origin → the studio can read it).
 */
async function machineGuide(
  a: ArcadeConfig,
  layer: "back" | "front",
  canvas: { w: number; h: number },
  mv: MachineArt
): Promise<string | undefined> {
  const c = document.createElement("canvas");
  c.width = canvas.w;
  c.height = canvas.h;
  const ctx = c.getContext("2d");
  if (!ctx) return undefined;
  const otherUrl =
    layer === "front" ? mv.back?.url ?? BUILTIN_MACHINE_BACK : mv.front?.url ?? (mv.back ? undefined : BUILTIN_MACHINE_BACK);
  if (otherUrl) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.w, canvas.h);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = otherUrl;
    });
  }
  // The game screen: where the live game renders (behind the front layer).
  const sx = (mv.screen.x / 100) * canvas.w;
  const sy = (mv.screen.y / 100) * canvas.h;
  const sw = (mv.screen.w / 100) * canvas.w;
  const sh = sw / GAME_SCREEN_ASPECT;
  ctx.fillStyle = "rgba(225, 29, 72, 0.18)";
  ctx.fillRect(sx, sy, sw, sh);
  ctx.setLineDash([Math.max(8, canvas.w / 120), Math.max(6, canvas.w / 160)]);
  ctx.lineWidth = Math.max(3, canvas.w / 400);
  ctx.strokeStyle = "#e11d48";
  ctx.strokeRect(sx, sy, sw, sh);
  ctx.setLineDash([]);
  ctx.fillStyle = "#e11d48";
  ctx.font = `600 ${Math.round(canvas.w / 40)}px system-ui, sans-serif`;
  ctx.fillText("GAME SCREEN", sx + canvas.w / 80, sy + canvas.w / 28);
  try {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch {
    // A cross-origin layer without CORS taints the canvas — draw without it.
    return undefined;
  }
}

type DrawTarget = "back" | "front" | "cta-en" | "cta-ar" | "poster" | "backdrop";

// ─── Inspector ──────────────────────────────────────────────

export function ArcadeInspector({ section }: { section: DrawnSection }) {
  const arcade = useMemo(() => resolveArcade(section.arcade), [section.arcade]);
  const world = section.aspectRatio;
  const device = useLandingEditorStore((s) => s.deviceMode) as ArcadeDeviceKey;
  const tool = useLandingEditorStore((s) => s.arcadeTool);
  const target = useLandingEditorStore((s) => s.arcadeCameraTarget);
  const preview = useLandingEditorStore((s) => s.arcadePreview);
  const selectedAssetIid = useLandingEditorStore((s) => s.selectedAssetIid);
  const updateArcade = useLandingEditorStore((s) => s.updateArcade);
  const moveArcadeLayer = useLandingEditorStore((s) => s.moveArcadeLayer);
  const setTool = useLandingEditorStore((s) => s.setArcadeTool);
  const setTarget = useLandingEditorStore((s) => s.setArcadeCameraTarget);
  const setPreview = useLandingEditorStore((s) => s.setArcadePreview);
  const selectAsset = useLandingEditorStore((s) => s.selectAsset);
  const addAsset = useLandingEditorStore((s) => s.addAsset);

  const edit = (fn: (st: StoredArcadeConfig) => StoredArcadeConfig) => updateArcade(section.iid, fn);
  const editDevice = (fn: (d: NonNullable<StoredArcadeConfig["desktop"]>) => NonNullable<StoredArcadeConfig["desktop"]>) =>
    edit((st) => ({ ...st, [device]: fn({ ...st[device] }) }));

  const dev = arcade[device];
  const devLabel = device === "mobile" ? "phones" : "desktop";
  const placement = machinePlacement(arcade, device);
  const machineSelected = selectedAssetIid === ARCADE_MACHINE_IID;
  const machineLocked = isMachineLocked(arcade);

  // Stop any camera preview when the inspector goes away.
  useEffect(() => () => setPreview(null), [setPreview]);

  // ── Drawing / uploading art ──
  const [draw, setDraw] = useState<{ target: DrawTarget; guideUrl?: string; canvas: { w: number; h: number } } | null>(null);
  const [drawSize, setDrawSize] = useState<"auto" | "2048" | "3072" | "4096">("auto");
  const [backdropDraw, setBackdropDraw] = useState<{ guideUrl?: string; canvas: { w: number; h: number } } | null>(null);
  // The backdrop covers the MAXIMUM zoom-out: every view any visitor gets.
  const bounds = backdropBounds(arcade, world);
  const bCanvas = backdropCanvasFor(arcade, world, bounds);
  const [placing, setPlacing] = useState<{
    url: string;
    size: { w: number; h: number };
    guideUrl?: string;
    /** Re-placing an existing backdrop element. */
    assetIid?: string;
    initial?: { x: number; y: number; w: number };
  } | null>(null);
  const updateAssetTransform = useLandingEditorStore((s) => s.updateAssetTransform);
  const updateAssetMeta = useLandingEditorStore((s) => s.updateAssetMeta);
  // The backdrop element(s): bottom of the stack, behind the machine,
  // covering at least the whole drawing area.
  const backdrops = section.assets.filter((a) => isBackdropAsset(a, arcade.machine.zIndex));
  // Views that reach past every backdrop show the letterbox there.
  const uncovered =
    backdrops.length > 0 &&
    !backdrops.some(
      (b) =>
        b.x <= bounds.x + 0.5 &&
        b.y <= bounds.y + 0.5 &&
        b.x + b.w >= bounds.x + bounds.w - 0.5 &&
        b.y + b.h >= bounds.y + bounds.h - 0.5
    );
  const openPlace = async (opts: {
    url: string;
    size?: { w: number; h: number };
    assetIid?: string;
    initial?: { x: number; y: number; w: number };
  }) => {
    const size = opts.size ?? (await naturalSize(opts.url)) ?? { w: 1600, h: 1000 };
    const guideUrl = await buildBackdropGuide(arcade, world, bounds, {
      w: 1600,
      h: Math.round((1600 * bCanvas.h) / bCanvas.w),
    });
    setPlacing({ url: opts.url, size, guideUrl, assetIid: opts.assetIid, initial: opts.initial });
  };
  // Re-open a DRAWN backdrop in the studio with a guide rebuilt for its own
  // area (its rect on the world) and pixel size — current camera settings.
  const [editingBackdrop, setEditingBackdrop] = useState<{
    iid: string;
    sceneId?: string;
    pngUrl: string;
    canvas: { w: number; h: number };
    guideUrl?: string;
  } | null>(null);
  const openBackdropEdit = async () => {
    const b =
      backdrops.find((x) => x.source.kind === "drawn") ?? backdrops[0];
    if (!b) return;
    const pngUrl = b.source.kind === "drawn" ? b.source.pngUrl : b.source.kind === "upload" ? b.source.url : "";
    const sceneId = b.source.kind === "drawn" ? b.source.sceneId : undefined;
    const nat = b.naturalW && b.naturalH ? { w: b.naturalW, h: b.naturalH } : (await naturalSize(pngUrl)) ?? { w: 2400, h: 1500 };
    const guideUrl = await buildBackdropGuide(arcade, world, { x: b.x, y: b.y, w: b.w, h: b.h }, nat);
    setEditingBackdrop({ iid: b.iid, sceneId, pngUrl, canvas: nat, guideUrl });
  };
  const openBackdropDraw = async () => {
    const guideUrl = await buildBackdropGuide(arcade, world, bounds, bCanvas);
    setBackdropDraw({ guideUrl, canvas: { w: bCanvas.w, h: bCanvas.h } });
  };
  // "Extend the canvas": the existing backdrop stays exactly where it is on a
  // new, bigger canvas that covers the furthest view; the author draws out to
  // the edges. (Edit backdrop drawing stretches the picture onto its OWN rect;
  // this one grows the area around it.)
  const [extending, setExtending] = useState<{
    iid: string;
    pngUrl: string;
    canvas: { w: number; h: number };
    guideUrl?: string;
  } | null>(null);
  const openBackdropExtend = async () => {
    const b =
      backdrops.find((x) => x.iid === selectedAssetIid) ??
      [...backdrops].sort((x, y) => x.zIndex - y.zIndex)[0];
    if (!b) return;
    const url = b.source.kind === "drawn" ? b.source.pngUrl : b.source.kind === "upload" ? b.source.url : "";
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new window.Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("The backdrop picture couldn't be loaded."));
        el.src = url;
      });
      const W = bCanvas.w;
      const H = bCanvas.h;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas available.");
      ctx.drawImage(
        img,
        ((b.x - bounds.x) / bounds.w) * W,
        ((b.y - bounds.y) / bounds.h) * H,
        (b.w / bounds.w) * W,
        (b.h / bounds.h) * H
      );
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      canvas.width = 1;
      canvas.height = 1;
      if (!blob) throw new Error("Couldn't prepare the bigger canvas.");
      const guideUrl = await buildBackdropGuide(arcade, world, bounds, bCanvas);
      setExtending({ iid: b.iid, pngUrl: URL.createObjectURL(blob), canvas: { w: W, h: H }, guideUrl });
    } catch (e) {
      toast.error("Couldn't extend the canvas", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  // Dev-only: lets the guide be inspected from devtools.
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    (window as unknown as { __arcadeGuide__?: () => Promise<string | undefined> }).__arcadeGuide__ = () =>
      buildBackdropGuide(arcade, world, bounds, { w: 1600, h: Math.round((1600 * bCanvas.h) / bCanvas.w) });
  }
  const downloadGuide = async () => {
    const url = await buildBackdropGuide(arcade, world, bounds, bCanvas);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `arcade-backdrop-guide-${bCanvas.w}x${bCanvas.h}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  /** Add a backdrop as the bottom-most layer (behind the machine), covering
   *  the max zoom-out bounds. An image of another shape keeps its proportions
   *  (full bounds width, centred vertically). */
  const addBackdrop = (
    url: string,
    size: { w: number; h: number },
    sceneId?: string,
    rect?: { x: number; y: number; w: number; h: number }
  ) => {
    const lowest = Math.min(arcade.machine.zIndex, ...section.assets.map((a) => a.zIndex));
    const wa = world.w / world.h;
    // Height (% of world height) the image needs at the bounds' width.
    const h = (bounds.w * wa) / (size.w / size.h);
    const r = rect ?? {
      x: bounds.x,
      y: Math.round((bounds.y + (bounds.h - h) / 2) * 100) / 100,
      w: bounds.w,
      h: Math.round(h * 100) / 100,
    };
    addAsset(section.iid, {
      iid: newIid(),
      source: sceneId ? { kind: "drawn", sceneId, pngUrl: url } : { kind: "upload", url },
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      zIndex: lowest - 1,
      role: { kind: "decoration" },
      label: "Backdrop",
      naturalW: size.w,
      naturalH: size.h,
    });
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<DrawTarget>("back");

  // The machine drawing being edited: phones with their own drawing edit
  // that one; otherwise the shared (desktop) drawing.
  const phoneVariant = device === "mobile" && Boolean(arcade.machine.phoneArt);
  const variantName: "shared" | "desktop" | "phone" = phoneVariant
    ? "phone"
    : arcade.machine.phoneArt
      ? "desktop"
      : "shared";
  const mv = machineVariant(arcade, device);
  const editMachineArt = (patch: Partial<MachineArt>) =>
    edit((st) =>
      phoneVariant
        ? {
            ...st,
            machine: {
              ...st.machine,
              phoneArt: { ...arcade.machine.phoneArt!, ...st.machine?.phoneArt, ...patch },
            },
          }
        : { ...st, machine: { ...st.machine, ...patch } }
    );

  const machineCanvas = (() => {
    const auto = machineDrawCanvas(arcade, world, variantName);
    if (drawSize === "auto") return auto;
    const side = Math.min(MAX_DRAW_SIDE, Number(drawSize));
    const aspect = mv.canvas.w / mv.canvas.h;
    return aspect >= 1
      ? { w: side, h: Math.round(side / aspect) }
      : { w: Math.round(side * aspect), h: side };
  })();
  const screenCanvas = { w: 1520, h: 960 };

  const setArt = (t: Exclude<DrawTarget, "backdrop">, art: ArcadeArt | null) =>
    edit((st) => {
      if (t === "back" || t === "front") {
        return phoneVariant
          ? {
              ...st,
              machine: {
                ...st.machine,
                phoneArt: { ...arcade.machine.phoneArt!, ...st.machine?.phoneArt, [t]: art },
              },
            }
          : { ...st, machine: { ...st.machine, [t]: art } };
      }
      if (t === "poster") return { ...st, poster: art };
      const lang = t === "cta-en" ? "en" : "ar";
      return { ...st, cta: { ...st.cta, [lang]: art } };
    });

  const openDraw = async (t: DrawTarget) => {
    if (t === "back" || t === "front") {
      const guideUrl = await machineGuide(arcade, t, machineCanvas, mv);
      setDraw({ target: t, guideUrl, canvas: machineCanvas });
    } else {
      setDraw({ target: t, canvas: screenCanvas });
    }
  };
  const currentArt = (t: DrawTarget): ArcadeArt | null =>
    t === "backdrop"
      ? null
      : t === "back" || t === "front"
      ? mv[t]
      : t === "poster"
        ? arcade.poster
        : arcade.cta[t === "cta-en" ? "en" : "ar"];

  const onUpload = async (file: File) => {
    const t = uploadTarget.current;
    const url = await uploadContentImage(file, "landing");
    if (!url) {
      toast.error("Upload failed");
      return;
    }
    const size = (await naturalSize(url)) ?? { w: 1000, h: 1000 };
    if (t === "backdrop") {
      // Pan/zoom it against the state guides before it lands.
      await openPlace({ url, size });
      return;
    }
    const art: ArcadeArt = { kind: "upload", url, naturalW: size.w, naturalH: size.h };
    if (t === "back" || t === "front") {
      const aspect = size.w / size.h;
      const cur = mv.canvas.w / mv.canvas.h;
      const other = t === "back" ? mv.front : mv.back;
      // The machine takes the upload's shape unless the other layer
      // already fixes it.
      editMachineArt({ [t]: art, ...(other ? {} : { canvas: { w: size.w, h: size.h } }) });
      if (other && Math.abs(aspect - cur) / cur > 0.02) {
        toast.warning("Different shape", {
          description: "This image's proportions differ from the other machine layer, so it is stretched to match.",
        });
      }
    } else {
      setArt(t, art);
    }
  };
  const pickUpload = (t: DrawTarget) => {
    uploadTarget.current = t;
    fileRef.current?.click();
  };

  // ── Camera preview (scrub / click-in) ──
  const [scrub, setScrub] = useState<number | null>(null);
  const tweenRef = useRef<gsap.core.Timeline | null>(null);
  useEffect(() => () => {
    tweenRef.current?.kill();
  }, []);
  const stopPreview = () => {
    tweenRef.current?.kill();
    tweenRef.current = null;
    setScrub(null);
    setPreview(null);
  };
  // Stopped from elsewhere (Esc, the canvas's Stop preview): halt a running
  // fly-in too, or its next frame would bring the preview back.
  useEffect(() => {
    if (preview) return;
    tweenRef.current?.kill();
    tweenRef.current = null;
    setScrub(null);
  }, [preview]);
  const playCam = (): ArcadeCamera => {
    const fa = dev.frame.aspect.w / dev.frame.aspect.h;
    const wa = world.w / world.h;
    const stageW = 1000;
    const stageH = stageW / fa;
    return playCamera({
      arcade,
      device,
      world,
      worldPxW: stageW * Math.min(1, wa / fa),
      stageCentre: { x: stageW / 2, y: stageH / 2 },
      viewport: { w: stageW, h: stageH },
    }).cam;
  };
  const previewClickIn = () => {
    stopPreview();
    const from = scrub !== null ? cameraAt(dev, scrub / 100) : dev.rest;
    const to = playCam();
    const p = { t: 0 };
    const apply = () => setPreview(mixCamera(from, to, p.t));
    apply();
    tweenRef.current = gsap
      .timeline({ onComplete: () => setPreview(null) })
      .to(p, { t: 1, duration: dev.play.duration, ease: dev.play.ease, onUpdate: apply })
      .to(p, { t: 0, duration: 0.7, ease: "power2.out", onUpdate: apply }, "+=1.2");
  };

  // ── Keyframes ──
  const kfs = dev.scroll.keyframes;
  const writeKeyframes = (next: typeof kfs) =>
    editDevice((d) => ({ ...d, scroll: { ...d.scroll, keyframes: [...next].sort((a, b) => a.at - b.at) } }));
  const addKeyframe = () => {
    const last = kfs[kfs.length - 1];
    const prev = kfs[kfs.length - 2];
    let at = !last ? 1 : last.at <= 0.75 ? last.at + 0.25 : ((prev?.at ?? 0) + last.at) / 2;
    at = Math.round(at * 100) / 100;
    const camera = last ? cameraAt(dev, at) : { ...dev.rest, scale: dev.rest.scale * 0.8 };
    writeKeyframes([...kfs, { at, camera, ease: "none" }]);
    setTarget({ kind: "keyframe", index: [...kfs, { at }].sort((a, b) => a.at - b.at).findIndex((k) => k.at === at) });
    setTool("frame");
  };
  const editingCam = (t: typeof target) =>
    tool === "frame" &&
    target.kind === t.kind &&
    (t.kind === "rest" || (target.kind === "keyframe" && target.index === t.index));

  // ── Guards / warnings ──
  const warnings = arcadeWarnings(arcade, world, section.assets);
  const [bytes, setBytes] = useState<number | null>(null);
  const checkWeight = async () => {
    const urls = [
      arcade.machine.back?.url,
      arcade.machine.front?.url,
      arcade.machine.phoneArt?.back?.url,
      arcade.machine.phoneArt?.front?.url,
      arcade.cta.en?.url,
      arcade.cta.ar?.url,
      arcade.poster?.url,
      ...section.assets.map((a) =>
        a.source.kind === "drawn" ? a.source.pngUrl : a.source.kind === "upload" ? a.source.url : undefined
      ),
    ].filter((u): u is string => Boolean(u));
    setBytes(await arcadeImageBytes(urls));
  };

  const artRow = (
    t: Exclude<DrawTarget, "backdrop">,
    label: string,
    opts: { canRemove?: boolean; builtin?: string; info?: string } = {}
  ) => {
    const art = currentArt(t);
    const src = art?.url ?? opts.builtin;
    return (
      <div className="flex items-center gap-2">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:10px_10px]">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <Square className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate">{label}</span>
            {opts.info && <InfoTip text={opts.info} />}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {art ? `${art.naturalW}×${art.naturalH}${art.kind === "drawn" ? " · drawn" : ""}` : opts.builtin ? "built-in" : "none"}
          </div>
        </div>
        <Button size="icon-xs" variant="ghost" title={`Draw ${label.toLowerCase()}`} onClick={() => void openDraw(t)}>
          <Pencil />
        </Button>
        <Button size="icon-xs" variant="ghost" title={`Upload ${label.toLowerCase()}`} onClick={() => pickUpload(t)}>
          <ImagePlus />
        </Button>
        {art && (
          <Button
            size="icon-xs"
            variant="ghost"
            title={opts.canRemove ? `Remove ${label.toLowerCase()}` : "Back to the built-in art"}
            onClick={() => setArt(t, null)}
          >
            {opts.canRemove ? <Trash2 /> : <RotateCcw />}
          </Button>
        )}
      </div>
    );
  };

  const need = machineRequiredWidth(arcade, world);

  return (
    <div className="space-y-2.5">
      <div className="px-0.5 pb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Arcade studio · editing {devLabel}
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-sm font-semibold">{machineSelected ? "The machine" : "The arcade scene"}</div>
          {machineSelected && (
            <LockButton locked={machineLocked} onToggle={() => toggleMachineLockWithFeedback(section.iid)} />
          )}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          One drawing for every screen. Elements behind the machine are the backdrop; elements in front can hang over the game screen.
        </p>
      </div>

      {/* Canvas tools */}
      <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
        Canvas tool
        <InfoTip text="Select: click and drag elements and the machine (move, resize, tilt). Screen: drag the dashed box that marks where the live game shows inside the machine. Frames: each camera view is a blue rectangle on your drawing — drag to aim, corner-drag to zoom, top handle to tilt. Click a frame's label to pick it." />
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border p-1">
        {(
          [
            ["select", "Select", MousePointer2],
            ["screen", "Screen", Crop],
            ["frame", "Frames", Video],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              // Clicking the active Screen / Frames tool again = done.
              if (tool === k && k !== "select") return setTool("select");
              setTool(k);
              if (k === "screen") selectAsset(ARCADE_MACHINE_IID);
            }}
            title={tool === k && k !== "select" ? `Done with ${label} (or press Esc)` : undefined}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs ${
              tool === k ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <Block title="Machine" info="The arcade machine with the live game inside. It is ONE object: the back layer, the game screen and the front layer always move, tilt, hover and animate together. It can't be deleted or duplicated — one game per page.">
        {device === "mobile" && (
          <Toggle
            label="Separate phone drawing"
            info="Off: phones show the same machine drawing as desktop (reframed by the phone camera). On: phones get their own machine drawing, with its own back and front layers, shape and game-screen box, starting as a copy of the desktop one. Position, hover and idle motion stay as set for phones."
            checked={Boolean(arcade.machine.phoneArt)}
            onChange={(on) => {
              if (!on && arcade.machine.phoneArt && (arcade.machine.phoneArt.back || arcade.machine.phoneArt.front)) {
                if (!window.confirm("Remove the phone drawing? Phones go back to the desktop machine.")) return;
              }
              edit((st) => ({
                ...st,
                machine: {
                  ...st.machine,
                  phoneArt: on
                    ? {
                        back: arcade.machine.back,
                        front: arcade.machine.front,
                        canvas: { ...arcade.machine.canvas },
                        screen: { ...arcade.machine.screen },
                      }
                    : null,
                },
              }));
            }}
          />
        )}
        {arcade.machine.phoneArt && (
          <p className="text-[11px] text-muted-foreground">
            Editing the {phoneVariant ? "PHONE" : "DESKTOP"} drawing of the machine. Switch Desktop / Mobile at the top to edit the other.
          </p>
        )}
        {artRow("back", "Back layer (behind the screen)", {
          builtin: BUILTIN_MACHINE_BACK,
          info: "The machine body, drawn BEHIND the game: cabinet, buttons, marquee. Leave a hole (transparent area) where the game screen goes. Pencil = draw in the studio (the front layer and the screen area show as a faded guide that is never saved), picture = upload, arrow = back to the built-in cabinet.",
        })}
        {artRow("front", "Front layer (over the screen)", {
          canRemove: true,
          info: "Optional art drawn ON TOP of the game: a wobbly bezel edge, glass glare, a paper or wire hanging over the screen. It always lines up with the back layer (same canvas). Clicks pass straight through it to the game.",
        })}
        <Row
          label="Drawing size"
          info="Pixel size of the canvas the Draw buttons open for the machine. Recommended is calculated from how far the camera ever zooms in, so the art stays crisp at the deepest zoom. Bigger = sharper but heavier files."
          hint={`Both layers share one canvas (${machineCanvas.w}×${machineCanvas.h}). To stay sharp at the deepest zoom the art needs ≥ ${need}px across.`}
        >
          <Pick
            value={drawSize}
            onChange={setDrawSize}
            options={[
              { value: "auto", label: `Recommended (${machineDrawCanvas(arcade, world, variantName).w}px wide)` },
              { value: "2048", label: "2048 px" },
              { value: "3072", label: "3072 px" },
              { value: "4096", label: "4096 px (max)" },
            ]}
          />
        </Row>
        <Row label="Machine shape" info="The proportions (width:height) of the machine drawing. Pick this BEFORE drawing — changing it later stretches existing art. Uploading a back layer sets the shape from the image automatically." hint="Proportions of the drawing. Existing art stretches to a new shape.">
          <Pick
            value={
              SHAPE_PRESETS.find(
                (p) => Math.abs(p.w / p.h - mv.canvas.w / mv.canvas.h) < 0.01
              )?.label ?? "custom"
            }
            onChange={(label) => {
              const p = SHAPE_PRESETS.find((x) => x.label === label);
              if (!p) return;
              if (
                (mv.back || mv.front) &&
                !window.confirm("The machine already has art — change its shape and stretch it?")
              )
                return;
              editMachineArt({ canvas: { w: p.w, h: p.h } });
            }}
            options={[
              ...SHAPE_PRESETS.map((p) => ({ value: p.label, label: p.label })),
              { value: "custom", label: `Custom (${mv.canvas.w}×${mv.canvas.h})` },
            ]}
          />
        </Row>

        {machineLocked && <LockedNote what="The machine" onUnlock={() => toggleMachineLockWithFeedback(section.iid)} />}
        <div className="grid grid-cols-2 gap-2">
          <Num label="X %" info="Left edge of the machine, as % of the drawing's width. In Mobile mode this edits the phone placement only." value={placement.x} readOnly={machineLocked} onChange={(v) => setPlacement({ x: v })} />
          <Num label="Y %" info="Top edge of the machine, as % of the drawing's height." value={placement.y} readOnly={machineLocked} onChange={(v) => setPlacement({ y: v })} />
          <Num label="Width %" info="Machine width as % of the drawing's width. Height follows automatically — the machine never stretches." value={placement.w} min={1} readOnly={machineLocked} onChange={(v) => setPlacement({ w: Math.max(1, v) })} />
          <Num label="Tilt °" info="Rotates the whole machine. When a visitor clicks to play, the camera straightens it so the game is level." value={placement.rotation} step={1} readOnly={machineLocked} onChange={(v) => setPlacement({ rotation: v })} />
        </div>
        {device === "mobile" && (
          <Button
            size="xs"
            variant="outline"
            disabled={machineLocked}
            onClick={() => edit((st) => ({ ...st, mobile: { ...st.mobile, machine: {} } }))}
            title="Phones use the desktop spot in the drawing (reframe with the phone camera instead)"
          >
            <RotateCcw /> Same spot as desktop
          </Button>
        )}
        {device === "mobile" && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <InfoTip text="By default phones can place the machine differently. Same spot as desktop makes phones use the desktop position in the drawing, so you only reframe with the phone camera — the machine stays exactly where you drew it." />
            Phone placement can differ from desktop.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Num label="Screen X %" info="Where the live game sits inside the machine (% of the machine). Or use the Screen tool to drag it on the canvas." value={mv.screen.x} onChange={(v) => setScreen({ x: v })} />
          <Num label="Screen Y %" info="Top of the game screen inside the machine (% of the machine's height)." value={mv.screen.y} onChange={(v) => setScreen({ y: v })} />
          <Num label="Screen W %" info="Game screen width (% of the machine). Its height is always locked to the game's 19:12 shape." value={mv.screen.w} min={2} onChange={(v) => setScreen({ w: Math.max(2, v) })} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Screen height follows the game (19:12) = {Math.round(screenHeightPct(arcade, device) * 10) / 10}% of the machine.
        </p>

        <div className="flex items-center gap-1.5">
          <InfoTip text="Moves the machine one step in the layer stack (also in the layers list on the left, or the ] and [ keys). Elements below the machine are the backdrop; elements above it can hang over the game screen." />
          <Button size="xs" variant="outline" onClick={() => moveArcadeLayer(section.iid, ARCADE_MACHINE_IID, "up")}>
            <ArrowUp /> Forward
          </Button>
          <Button size="xs" variant="outline" onClick={() => moveArcadeLayer(section.iid, ARCADE_MACHINE_IID, "down")}>
            <ArrowDown /> Backward
          </Button>
        </div>

        <Row label="On hover (desktop)" info="What the whole machine does when a mouse hovers it before playing: glow, lift slightly, or a playful wiggle. Phones have no hover, so it never shows there.">
          <Pick<ArcadeHover>
            value={arcade.machine.hover}
            onChange={(hover) => edit((st) => ({ ...st, machine: { ...st.machine, hover } }))}
            options={[
              { value: "none", label: "Nothing" },
              { value: "glow", label: "Glow" },
              { value: "lift", label: "Lift" },
              { value: "nudge", label: "Nudge (wiggle)" },
            ]}
          />
        </Row>
        <AmbientFields
          value={arcade.machine.ambient}
          onChange={(ambient) => edit((st) => ({ ...st, machine: { ...st.machine, ambient } }))}
        />
        <Toggle
          label="Drop shadow"
          info="A soft shadow under the machine's back layer so it sits on the page. Turn off if your drawing has its own shadow."
          checked={arcade.machine.shadow}
          onChange={(shadow) => edit((st) => ({ ...st, machine: { ...st.machine, shadow } }))}
        />
      </Block>

      <Block title="Backdrop" info="A full-size drawing of the room the arcade stands in. It's added as a normal element at the bottom of the layers, so you can move, resize or replace it like any drawing. Phones show the same drawing through their own frame.">
        <p className="text-[11px] leading-snug text-muted-foreground">
          A full-size drawing behind the machine — the room the arcade sits in. Phones reframe the same drawing with their own camera.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => void openBackdropDraw()}>
            <Pencil /> Draw backdrop
          </Button>
          <Button size="xs" variant="outline" onClick={() => pickUpload("backdrop")}>
            <ImagePlus /> Upload backdrop
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void downloadGuide()}>
            Download guide
          </Button>
          {backdrops.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => void openBackdropEdit()}>
              <Pencil /> Edit backdrop drawing
            </Button>
          )}
          {backdrops.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                // The selected backdrop, else the bottom-most one.
                const b =
                  backdrops.find((x) => x.iid === selectedAssetIid) ??
                  [...backdrops].sort((x, y) => x.zIndex - y.zIndex)[0];
                const url = b.source.kind === "drawn" ? b.source.pngUrl : b.source.kind === "upload" ? b.source.url : "";
                void openPlace({ url, assetIid: b.iid, initial: { x: b.x, y: b.y, w: b.w } });
              }}
            >
              Re-place backdrop
            </Button>
          )}
          <InfoTip text="The backdrop canvas covers the furthest the camera ever zooms out, so no visitor sees an empty edge. Its faded guide layer (never saved) shows every state as a labelled frame: orange = desktop, blue = phone, solid = at rest, dashed = scrolled / playing, the shaded SAFE AREA everyone sees at rest, the grey world edge, and where the machine and its screen sit. In the studio, hide or show the guide with the eye on its layer in the Layers panel. Download guide saves the same template as a PNG to draw in another app; Upload backdrop then lets you pan and zoom your picture against the guides (with a show/hide switch). The guides are always made from your CURRENT camera settings — shorten or lengthen the zoom-out and they follow; if the camera later zooms out past your backdrop you get a warning here, and Re-place backdrop lets you reposition it." />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Canvas {bCanvas.w}×{bCanvas.h} covers the max zoom-out ({Math.round(bounds.w)}% × {Math.round(bounds.h)}% of the drawing area).
          {!bCanvas.sharp && " Capped at 4096px — the deepest zoom may soften slightly."}
        </p>
        <Toggle
          label="Soft edges"
          info="On a window wider than the frame (most desktops) the scene would end in hard vertical cuts against the page; with soft edges its left and right edges fade into the paper. A backdrop that doesn't reach past the furthest camera view also fades at its own edges. On by default; turn off if your drawing has its own deliberate edge."
          checked={arcade.softEdges}
          onChange={(softEdges) => edit((st) => ({ ...st, softEdges }))}
        />
        {uncovered && (
          <div className="space-y-1.5 rounded-md bg-amber-500/15 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
            <p>
              Your camera now zooms out further than the backdrop reaches
              {arcade.softEdges
                ? ": the furthest views fade out at the backdrop's edge instead of ending in a cut."
                : ": the furthest views show the page at the edges, with a hard edge."}{" "}
              Pick one:
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="outline" onClick={() => void openBackdropExtend()}>
                Extend the canvas
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const b =
                    backdrops.find((x) => x.iid === selectedAssetIid) ??
                    [...backdrops].sort((x, y) => x.zIndex - y.zIndex)[0];
                  const url = b.source.kind === "drawn" ? b.source.pngUrl : b.source.kind === "upload" ? b.source.url : "";
                  void openPlace({ url, assetIid: b.iid, initial: { x: b.x, y: b.y, w: b.w } });
                }}
              >
                Re-place
              </Button>
              {!arcade.softEdges && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => edit((st) => ({ ...st, softEdges: true }))}
                >
                  Fade edges
                </Button>
              )}
            </div>
          </div>
        )}
      </Block>

      <Block title="Screen art" info="Art shown INSIDE the game screen: the click-to-play label visitors see before playing (one per language), and a poster still shown while the game is loading.">
        {artRow("cta-en", "“Click to play” (English)", {
          builtin: BUILTIN_CTA.en,
          info: "The invitation shown over the screen before playing, for English visitors. Drawn at the game's 19:12 shape so it fills the screen exactly.",
        })}
        {artRow("cta-ar", "“Click to play” (Arabic)", {
          builtin: BUILTIN_CTA.ar,
          info: "Same, for Arabic visitors.",
        })}
        <Toggle
          label="Gentle pulse"
          info="The click-to-play art softly breathes to invite a click. Visitors who prefer reduced motion never see it move."
          checked={arcade.cta.pulse}
          onChange={(pulse) => edit((st) => ({ ...st, cta: { ...st.cta, pulse } }))}
        />
        {artRow("poster", "Poster (until the game loads)", {
          canRemove: true,
          info: "A still picture shown in the screen while the game is still loading (slow phones), instead of the blinking “booting” screen.",
        })}
      </Block>

      <Block title={`Camera · ${devLabel}`} info="The camera decides which part of your drawing visitors see, how it zooms while they scroll, and how it flies into the screen when they click to play. Per device — switch Desktop / Mobile at the top to edit the other one.">
        <Row label="Frame (the visitor's screen)" info="The shape of the window visitors see your drawing through on this device. Same as drawing shows the whole drawing; 9:16 phone gives a tall portrait view you then aim with Rest framing. The frame always fits inside the visitor's screen.">
          <Pick
            value={
              FRAME_PRESETS.find(
                (p) =>
                  p.w > 0 &&
                  Math.abs(p.w / p.h - dev.frame.aspect.w / dev.frame.aspect.h) < 0.005
              )?.label ??
              (Math.abs(dev.frame.aspect.w / dev.frame.aspect.h - world.w / world.h) < 0.005
                ? "Same as drawing"
                : "custom")
            }
            onChange={(label) => {
              const p = FRAME_PRESETS.find((x) => x.label === label);
              if (!p) return;
              const aspect = p.w ? { w: p.w, h: p.h } : { w: world.w, h: world.h };
              editDevice((d) => ({ ...d, frame: { ...d.frame, aspect } }));
            }}
            options={[
              ...FRAME_PRESETS.map((p) => ({ value: p.label, label: p.label })),
              { value: "custom", label: `Custom (${dev.frame.aspect.w}:${dev.frame.aspect.h})` },
            ]}
          />
        </Row>
        <Row label="Letterbox colour" info="Fills the empty bands when the frame and the drawing have different shapes, or when the camera zooms out past the drawing's edges. Leave empty to show the page's paper." hint="Shown where the frame is wider than the drawing. Empty = the page's paper.">
          <div className="flex gap-2">
            <input
              type="color"
              value={dev.frame.fill.startsWith("#") ? dev.frame.fill : "#e9e3d6"}
              onChange={(e) => editDevice((d) => ({ ...d, frame: { ...d.frame, fill: e.target.value } }))}
              className="h-8 w-10 shrink-0 rounded-lg border border-input bg-transparent"
            />
            <Input
              className="h-8"
              value={dev.frame.fill === "transparent" ? "" : dev.frame.fill}
              placeholder="transparent"
              onChange={(e) =>
                editDevice((d) => ({ ...d, frame: { ...d.frame, fill: e.target.value || "transparent" } }))
              }
            />
          </div>
        </Row>

        <CameraRow
          title="Rest framing"
          hint="What visitors see before scrolling."
          cam={dev.rest}
          editing={editingCam({ kind: "rest" })}
          onEdit={() => {
            // Second click = done (back to Select).
            if (editingCam({ kind: "rest" })) return setTool("select");
            setTarget({ kind: "rest" });
            setTool("frame");
          }}
          onChange={(cam) =>
            edit((st) => withCamera(st, kfs, device, { kind: "rest" }, cam))
          }
        />

        <Row
          label="Zoom-out preset"
          info="Quick, tested starting points for the scroll zoom. Picking one rewrites this device's scroll length and keyframes around your current rest aim (zooming out from where the camera already looks). Fine-tune anything below afterwards — the preset then shows Custom. The backdrop guides always follow whatever the camera ends up doing."
        >
          <Pick
            value={detectZoomPreset(dev)}
            onChange={(id) => {
              if (id === "custom") return;
              editDevice((d) => ({ ...d, scroll: zoomPreset(id, dev) }));
              setTarget({ kind: "rest" });
            }}
            options={[
              { value: "none", label: "Still (no scroll zoom)" },
              { value: "short", label: "Short — gentle pull-back" },
              { value: "medium", label: "Medium — reveal the room" },
              { value: "long", label: "Long — slow, dramatic" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </Row>

        <Toggle
          label="Zoom while scrolling"
          info="Plays the keyframes below as visitors scroll. On desktop the arcade pins in place until the zoom finishes; on phones it never pins — the zoom plays while the arcade scrolls past."
          hint={device === "mobile" ? "Plays as the arcade scrolls past (never pins on phones)." : "Pins the arcade while the camera moves."}
          checked={dev.scroll.enabled}
          onChange={(enabled) => editDevice((d) => ({ ...d, scroll: { ...d.scroll, enabled } }))}
        />
        {dev.scroll.enabled && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Num
                label={device === "mobile" ? "Scroll length (% screen)" : "Pin length (% screen)"}
                info="How much scrolling the zoom takes: 100 = one full screen of scrolling, 300 = a long, slow zoom."
                value={dev.scroll.lengthVh}
                step={10}
                min={20}
                onChange={(lengthVh) => editDevice((d) => ({ ...d, scroll: { ...d.scroll, lengthVh: Math.max(20, lengthVh) } }))}
              />
              <Num
                label="Smoothing (s)"
                info="How long the camera takes to catch up with the scrollbar. 0 = locked exactly to the scroll; 1 = buttery but slightly behind."
                value={dev.scroll.smoothing}
                step={0.1}
                min={0}
                onChange={(smoothing) => editDevice((d) => ({ ...d, scroll: { ...d.scroll, smoothing: Math.max(0, smoothing) } }))}
              />
            </div>
            {kfs.map((k, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    Keyframe {i + 1}
                    {i === 0 && (
                      <InfoTip text="A keyframe is a camera position at a point in the scroll. The camera moves from the rest framing to keyframe 1, then to keyframe 2, and so on as visitors scroll. Camera icon = edit its frame on the canvas, eye = preview that moment, bin = delete." />
                    )}
                  </span>
                  <span className="flex-1" />
                  <Button
                    size="icon-xs"
                    variant={editingCam({ kind: "keyframe", index: i }) ? "secondary" : "ghost"}
                    title={editingCam({ kind: "keyframe", index: i }) ? "Done editing this frame" : "Edit this frame on the canvas"}
                    onClick={() => {
                      // Second click = done (back to Select).
                      if (editingCam({ kind: "keyframe", index: i })) return setTool("select");
                      setTarget({ kind: "keyframe", index: i });
                      setTool("frame");
                    }}
                  >
                    <Video />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="Preview this moment"
                    onClick={() => {
                      setScrub(Math.round(k.at * 100));
                      setPreview(k.camera);
                    }}
                  >
                    <Eye />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title="Delete keyframe"
                    onClick={() => {
                      writeKeyframes(kfs.filter((_, j) => j !== i));
                      setTarget({ kind: "rest" });
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Num
                    label="At % of scroll"
                    info="When this keyframe is reached, as % of the scroll length. 50 = halfway through the zoom."
                    value={k.at * 100}
                    step={5}
                    min={1}
                    max={100}
                    onChange={(v) =>
                      writeKeyframes(kfs.map((x, j) => (j === i ? { ...x, at: Math.min(1, Math.max(0.01, v / 100)) } : x)))
                    }
                  />
                  <Num
                    label="Zoom ×"
                    info="How close the camera is at this keyframe: 1 = the whole frame, 2 = twice as close, 0.5 = zoomed out. Aim it by dragging its frame on the canvas (camera icon)."
                    value={k.camera.scale}
                    step={0.05}
                    min={0.05}
                    onChange={(v) =>
                      writeKeyframes(kfs.map((x, j) => (j === i ? { ...x, camera: { ...x.camera, scale: Math.max(0.05, v) } } : x)))
                    }
                  />
                  <Num
                    label="Tilt °"
                    info="Rotates the camera (the whole view) at this keyframe — a dutch-angle effect."
                    value={k.camera.rotation}
                    step={1}
                    onChange={(v) =>
                      writeKeyframes(kfs.map((x, j) => (j === i ? { ...x, camera: { ...x.camera, rotation: v } } : x)))
                    }
                  />
                </div>
                <Pick<ArcadeEase>
                  value={k.ease}
                  onChange={(ease) => writeKeyframes(kfs.map((x, j) => (j === i ? { ...x, ease } : x)))}
                  options={EASE_OPTIONS}
                />
              </div>
            ))}
            <Button size="xs" variant="outline" onClick={addKeyframe}>
              <Plus /> Add keyframe
            </Button>
          </>
        )}

        <Row label="Scrub preview" info="Drag to play the scroll zoom on the canvas without scrolling: left = top of the page, right = end of the zoom. Editing pauses while previewing — press Stop preview or Esc." hint="Drag to watch the scroll camera without scrolling.">
          <Slider
            min={0}
            max={100}
            step={1}
            value={[scrub ?? 0]}
            onValueChange={([v]) => {
              tweenRef.current?.kill();
              setScrub(v);
              setPreview(cameraAt(dev, v / 100));
            }}
          />
        </Row>

        <div className="space-y-2 rounded-md border border-border p-2">
          <div className="text-[12px] font-medium">Click to play</div>
          <Row label={`Screen fills ${Math.round(dev.play.screenFill * 100)}% of the view`} info="When someone clicks to play, the camera flies to the game screen and zooms until the screen takes up this much of their window. It also straightens any tilt so taps land correctly.">
            <Slider
              min={30}
              max={98}
              step={1}
              value={[Math.round(dev.play.screenFill * 100)]}
              onValueChange={([v]) => editDevice((d) => ({ ...d, play: { ...d.play, screenFill: v / 100 } }))}
            />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Num
              label="Duration (s)"
              info="How long the click-to-play fly-in takes, in seconds."
              value={dev.play.duration}
              step={0.1}
              min={0.1}
              onChange={(duration) => editDevice((d) => ({ ...d, play: { ...d.play, duration: Math.max(0.1, duration) } }))}
            />
            <div className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Feel
                <InfoTip text="The motion curve of the fly-in: Settle starts fast and lands softly; Linear is constant speed; Snap then glide is punchy." />
              </span>
              <Pick<ArcadeEase>
                value={dev.play.ease}
                onChange={(ease) => editDevice((d) => ({ ...d, play: { ...d.play, ease } }))}
                options={EASE_OPTIONS}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" onClick={previewClickIn}>
            <Play /> Preview click-in
          </Button>
          <InfoTip text="Plays the click-to-play fly-in on the canvas through this device's frame, holds a moment, then returns. Copy desktop camera (phones) starts the phone camera from the desktop settings." />
          {preview && (
            <Button size="xs" variant="outline" onClick={stopPreview}>
              Stop preview
            </Button>
          )}
          {device === "mobile" && (
            <Button
              size="xs"
              variant="outline"
              title="Start the phone camera from the desktop one"
              onClick={() =>
                edit((st) => ({
                  ...st,
                  mobile: {
                    ...st.mobile,
                    rest: arcade.desktop.rest,
                    scroll: { ...arcade.desktop.scroll, enabled: arcade.mobile.scroll.enabled },
                    play: { ...arcade.mobile.play },
                  },
                }))
              }
            >
              Copy desktop camera
            </Button>
          )}
        </div>
      </Block>

      <Block
        title="Screen UI"
        info="The controls on top of the arcade: the language switcher, the ✕ that leaves the game, the in-game language and map buttons, and the hint texts. Draw your own art for each and place it per device. They are always pinned to the visitor's screen and never zoom with the camera."
      >
        <ArcadeChromeEditor
          chrome={arcade.chrome}
          device={device}
          onArcadeChrome={(chrome) => edit((st) => ({ ...st, chrome }))}
        />
      </Block>

      <Block title="Guardrails (warnings, never forced)" info="Safety nets for the hero. Each one only warns you (or gently fades/caps while playing) — none of them ever stops you placing or drawing something. Turn any off if it gets in the way.">
        <Toggle
          label="Never zoom past sharpness"
          info="Limits the click-to-play zoom so your machine drawing is never stretched beyond its real pixels (which looks blurry). Playability still wins: the game never ends up smaller than 60% of the Screen fills size. Vector SVG art is never limited. Off = always zoom to the Screen fills size."
          hint="Caps the click-in zoom so the machine art isn't shown bigger than its pixels (SVG exempt)."
          checked={arcade.guards.sharpness}
          onChange={(sharpness) => edit((st) => ({ ...st, guards: { ...st.guards, sharpness } }))}
        />
        <Toggle
          label="Machine stays on stage"
          info="Shows a warning below when the rest framing on a device crops part of the machine. Only a warning — the machine can still go anywhere."
          hint="Warn when a device frame crops the machine."
          checked={arcade.guards.onStage}
          onChange={(onStage) => edit((st) => ({ ...st, guards: { ...st.guards, onStage } }))}
        />
        <Toggle
          label="Foreground can't block play"
          info="Anything layered IN FRONT of the machine that covers more than the set share of the game screen fades out while someone plays, and comes back when they leave. Things behind the machine are never affected."
          hint="Props in front of the machine that cover the screen fade out while playing."
          checked={arcade.guards.foregroundFade}
          onChange={(foregroundFade) => edit((st) => ({ ...st, guards: { ...st.guards, foregroundFade } }))}
        />
        {arcade.guards.foregroundFade && (
          <Num
            label="Fade props covering more than (% of screen)"
            info="Threshold for the rule above: 15 means a front prop covering over 15% of the game screen fades while playing."
            value={arcade.guards.foregroundFadePct}
            step={5}
            min={1}
            max={100}
            onChange={(v) => edit((st) => ({ ...st, guards: { ...st.guards, foregroundFadePct: Math.min(100, Math.max(1, v)) } }))}
          />
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Num
              label="Keep it light (MB budget)"
              info="A size budget for all arcade images. Press Check to add up the original files; over budget shows a warning. Visitors get resized copies, so real downloads are smaller."
              value={arcade.guards.weightBudgetMb}
              step={0.5}
              min={0.5}
              onChange={(v) => edit((st) => ({ ...st, guards: { ...st.guards, weightBudgetMb: Math.max(0.5, v) } }))}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void checkWeight()}>
            Check
          </Button>
        </div>
        {bytes !== null && (
          <p className={`text-[12px] ${bytes / 1e6 > arcade.guards.weightBudgetMb ? "text-amber-400" : "text-muted-foreground"}`}>
            Arcade images: {(bytes / 1e6).toFixed(2)} MB (originals; the site serves resized copies)
            {bytes / 1e6 > arcade.guards.weightBudgetMb ? " — over budget." : "."}
          </p>
        )}
        {warnings.length > 0 ? (
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li
                key={i}
                className={`rounded-md px-2 py-1.5 text-[11px] leading-snug ${
                  w.level === "warn" ? "bg-amber-500/15 text-amber-200" : "bg-sky-500/10 text-sky-200"
                }`}
              >
                {w.text}
                {w.target && (
                  <button
                    type="button"
                    className="ms-1 underline"
                    onClick={() => selectAsset(w.target === "machine" ? ARCADE_MACHINE_IID : w.target!)}
                  >
                    select
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">No warnings.</p>
        )}
      </Block>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/svg+xml,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onUpload(f);
        }}
      />

      {placing && (
        <BackdropPlaceDialog
          imageUrl={placing.url}
          imageSize={placing.size}
          bounds={bounds}
          worldAspect={world.w / world.h}
          guideUrl={placing.guideUrl}
          initial={placing.initial}
          onCancel={() => {
            if (placing.guideUrl) URL.revokeObjectURL(placing.guideUrl);
            setPlacing(null);
          }}
          onPlace={(rect) => {
            if (placing.assetIid) updateAssetTransform(placing.assetIid, rect);
            else addBackdrop(placing.url, placing.size, undefined, rect);
            if (placing.guideUrl) URL.revokeObjectURL(placing.guideUrl);
            setPlacing(null);
          }}
        />
      )}

      {editingBackdrop && (
        <LandingDrawModal
          title="Edit the arcade backdrop — the GUIDE layer is rebuilt from your current camera settings (never saved)"
          canvas={editingBackdrop.canvas}
          fixedCanvas
          trimToContent={false}
          guideUrl={editingBackdrop.guideUrl}
          edit={{ sceneId: editingBackdrop.sceneId, pngUrl: editingBackdrop.pngUrl }}
          saveLabel="Update backdrop"
          onClose={() => {
            if (editingBackdrop.guideUrl) URL.revokeObjectURL(editingBackdrop.guideUrl);
            setEditingBackdrop(null);
          }}
          onSaved={(url, _size, sceneId) =>
            updateAssetMeta(editingBackdrop.iid, {
              source: sceneId ? { kind: "drawn", sceneId, pngUrl: url } : { kind: "upload", url },
              naturalW: editingBackdrop.canvas.w,
              naturalH: editingBackdrop.canvas.h,
            })
          }
        />
      )}

      {extending && (
        <LandingDrawModal
          title="Extend the arcade backdrop — your drawing stays where it is; draw out to the edges (the GUIDE layer is never saved)"
          canvas={extending.canvas}
          fixedCanvas
          trimToContent={false}
          guideUrl={extending.guideUrl}
          edit={{ pngUrl: extending.pngUrl }}
          saveLabel="Use the extended backdrop"
          autosaveKey={`arcade-backdrop-extend:${section.iid}`}
          onClose={() => {
            if (extending.guideUrl) URL.revokeObjectURL(extending.guideUrl);
            URL.revokeObjectURL(extending.pngUrl);
            setExtending(null);
          }}
          onSaved={(url, _size, sceneId) => {
            updateAssetTransform(extending.iid, { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
            updateAssetMeta(extending.iid, {
              source: sceneId ? { kind: "drawn", sceneId, pngUrl: url } : { kind: "upload", url },
              naturalW: extending.canvas.w,
              naturalH: extending.canvas.h,
            });
          }}
        />
      )}

      {backdropDraw && (
        <LandingDrawModal
          title="Draw the arcade backdrop — the GUIDE layer shows every screen state and is never saved (hide it with its eye in Layers)"
          canvas={backdropDraw.canvas}
          fixedCanvas
          trimToContent={false}
          guideUrl={backdropDraw.guideUrl}
          saveLabel="Add behind the machine"
          onClose={() => {
            if (backdropDraw.guideUrl) URL.revokeObjectURL(backdropDraw.guideUrl);
            setBackdropDraw(null);
          }}
          onSaved={(url, _size, sceneId) => addBackdrop(url, backdropDraw.canvas, sceneId)}
        />
      )}

      {draw && draw.target !== "backdrop" && (
        <LandingDrawModal
          title={
            draw.target === "back"
              ? "Draw the machine — back layer"
              : draw.target === "front"
                ? "Draw the machine — front layer (over the screen)"
                : draw.target === "poster"
                  ? "Draw the screen poster"
                  : "Draw the “click to play” art"
          }
          canvas={draw.canvas}
          fixedCanvas
          trimToContent={false}
          guideUrl={draw.guideUrl}
          saveLabel="Save to the arcade"
          edit={
            currentArt(draw.target)
              ? { sceneId: currentArt(draw.target)!.sceneId, pngUrl: currentArt(draw.target)!.url }
              : undefined
          }
          onClose={() => {
            if (draw.guideUrl) URL.revokeObjectURL(draw.guideUrl);
            setDraw(null);
          }}
          onSaved={(url, _size, sceneId) => {
            const t = draw.target as Exclude<DrawTarget, "backdrop">;
            const art: ArcadeArt = {
              kind: sceneId ? "drawn" : "upload",
              url,
              sceneId,
              naturalW: draw.canvas.w,
              naturalH: draw.canvas.h,
            };
            if (t === "back" || t === "front") {
              editMachineArt({ [t]: art, canvas: { w: draw.canvas.w, h: draw.canvas.h } });
            } else {
              setArt(t, art);
            }
          }}
        />
      )}
    </div>
  );

  function setPlacement(t: Partial<{ x: number; y: number; w: number; rotation: number }>) {
    edit((st) =>
      device === "desktop"
        ? { ...st, machine: { ...st.machine, ...t } }
        : { ...st, mobile: { ...st.mobile, machine: { ...arcade.mobile.machine, ...t } } }
    );
  }
  function setScreen(t: Partial<{ x: number; y: number; w: number }>) {
    editMachineArt({ screen: { ...mv.screen, ...t } });
  }
}

/** Numeric camera editor + "edit on canvas" for one camera. */
function CameraRow({
  title,
  hint,
  cam,
  editing,
  onEdit,
  onChange,
}: {
  title: string;
  hint?: string;
  cam: ArcadeCamera;
  editing: boolean;
  onEdit: () => void;
  onChange: (c: ArcadeCamera) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium">
          {title}
          <InfoTip text="What visitors see when the page opens, before any scrolling. Edit frame shows it as a blue rectangle on the drawing: drag to aim, corner-drag to zoom, top handle to tilt." />
        </span>
        <span className="flex-1" />
        <Button
          size="xs"
          variant={editing ? "secondary" : "outline"}
          onClick={onEdit}
          title={editing ? "Stop editing the frame (or press Esc)" : "Show this view as a frame on the canvas"}
        >
          {editing ? <Check /> : <Video />} {editing ? "Done" : "Edit frame"}
        </Button>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Num label="Zoom ×" info="1 = the whole frame; higher zooms in. Same as resizing this frame's rectangle on the canvas." value={cam.scale} step={0.05} min={0.05} onChange={(v) => onChange({ ...cam, scale: Math.max(0.05, v) })} />
        <Num label="Aim X %" info="The point of the drawing (% across) at the centre of the visitor's view." value={cam.focusX} onChange={(v) => onChange({ ...cam, focusX: v })} />
        <Num label="Aim Y %" info="The point of the drawing (% down) at the centre of the visitor's view." value={cam.focusY} onChange={(v) => onChange({ ...cam, focusY: v })} />
        <Num label="Tilt °" info="Rotates the whole view." value={cam.rotation} step={1} onChange={(v) => onChange({ ...cam, rotation: v })} />
      </div>
    </div>
  );
}

/** Idle motion preset editor (machine + scene elements). */
export function AmbientFields({
  value,
  onChange,
}: {
  value: AmbientPreset | null | undefined;
  onChange: (v: AmbientPreset | null) => void;
}) {
  const kind = value?.kind ?? "none";
  const base: AmbientPreset = value ?? { kind: "sway", strength: 0.5, speed: 3, pivotX: 50, pivotY: 0 };
  return (
    <div className="space-y-2">
      <Row label="Idle motion" info="A gentle endless loop: Sway hangs and swings from the pivot (a dangling wire or sign), Float bobs up and down, Flicker blinks like a neon tube, Pulse softly grows and shrinks." hint="A gentle loop — a dangling wire swaying, a neon sign flickering. Off for visitors who prefer reduced motion.">
        <Pick
          value={kind}
          onChange={(k) =>
            onChange(
              k === "none"
                ? null
                : {
                    ...base,
                    kind: k as AmbientPreset["kind"],
                    // Sway hangs from the top by default; the rest centre.
                    pivotY: k === "sway" ? 0 : base.kind === "sway" ? 50 : base.pivotY,
                  }
            )
          }
          options={[
            { value: "none", label: "None" },
            { value: "sway", label: "Sway (hanging)" },
            { value: "float", label: "Float" },
            { value: "flicker", label: "Flicker" },
            { value: "pulse", label: "Pulse" },
          ]}
        />
      </Row>
      {value && (
        <Row
          label="Plays on"
          info="Which devices show this idle motion. Handy when a loop that looks lovely big on desktop is too busy on a small phone screen, or the other way round."
        >
          <Pick
            value={value.devices ?? "both"}
            onChange={(devices) => onChange({ ...value, devices })}
            options={[
              { value: "both", label: "Desktop and phones" },
              { value: "desktop", label: "Desktop only" },
              { value: "mobile", label: "Phones only" },
            ]}
          />
        </Row>
      )}
      {value && (
        <div className="grid grid-cols-2 gap-2">
          <Num label="Strength (0–1)" info="How big the motion is: 0.2 subtle, 1 dramatic." value={value.strength} step={0.1} min={0} max={1} onChange={(v) => onChange({ ...value, strength: Math.min(1, Math.max(0, v)) })} />
          <Num label="Seconds per cycle" info="How slow the loop is. Bigger = calmer." value={value.speed} step={0.5} min={0.3} onChange={(v) => onChange({ ...value, speed: Math.max(0.3, v) })} />
          {value.kind === "sway" && (
            <>
              <Num label="Pivot X %" info="The hinge point for Sway, % across the element. 50 = centre." value={value.pivotX} step={5} onChange={(v) => onChange({ ...value, pivotX: v })} />
              <Num label="Pivot Y %" info="The hinge point for Sway, % down the element. 0 = hangs from the top edge." value={value.pivotY} step={5} onChange={(v) => onChange({ ...value, pivotY: v })} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

