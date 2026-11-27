"use client";

// AvatarCreator — game-style "player card" wardrobe modal.
//
// Left: a live stage where the character walks in place (the real
// 4-frame sheet from avatarCompositor, so what you see is exactly what
// ships in-game). Click the character or the Turn chip to flip direction,
// Stand/Walk chips to switch the preview animation.
//
// Right: chunky slot rail + item cards + curated color swatches
// (SLOT_PALETTES). No free color wheel — hand-picked palettes keep every
// combination looking good in-game, like deployed dress-up games do.
//
// On Save → calls onSave(config) which persists to localStorage and emits
// AVATAR_UPDATED so Phaser rebuilds the player sprite sheet in-place.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PersonStanding,
  User,
  Eye,
  Brush,
  Shirt,
  Footprints,
  Glasses,
  CircleOff,
  Dices,
  Check,
  ArrowLeftRight,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";
import type { AvatarAsset, AvatarConfig, Slot } from "@/data/avatarTypes";
import {
  AVATAR_SCHEMA_VERSION,
  DEFAULT_TINTS,
  SLOT_PALETTES,
  TINTABLE_SLOTS,
  getSlotAssetId,
  getSlotTint,
  withSlotAssetId,
  withSlotTint,
} from "@/data/avatarTypes";
import { drawAvatarFrame, FRAME_H, FRAME_W } from "@/lib/avatarLayersV2";
import { buildAvatarSheet } from "@/lib/avatarCompositor";
import { loadAvatarImage } from "@/lib/avatarAssetCache";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// lucide-react has no trousers glyph — a small hand-drawn-to-spec
// substitute matching lucide's own icon conventions (24x24, stroke-2,
// round joins, currentColor).
function PantsIcon(props: LucideProps) {
  const { size = 24, strokeWidth = 2, className, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M6 3 L6 8 L4 21 L9 21 L11 10 L13 10 L15 21 L20 21 L18 8 L18 3 Z" />
      <path d="M6 3 L18 3" />
    </svg>
  );
}

interface AvatarCreatorProps {
  initialConfig: AvatarConfig;
  catalog: AvatarAsset[];
  language: "en" | "ar";
  onSave: (config: AvatarConfig) => void;
  onClose: () => void;
}

const SLOTS_IN_ORDER: Slot[] = [
  "body",
  "eyes",
  "hair",
  "shirt",
  "pants",
  "shoes",
  "accessory",
];

const SLOT_LABELS: Record<Slot, { en: string; ar: string; icon: ComponentType<LucideProps> }> = {
  body: { en: "Body", ar: "الجسم", icon: User },
  eyes: { en: "Face", ar: "الوجه", icon: Eye },
  hair: { en: "Hair", ar: "الشعر", icon: Brush },
  shirt: { en: "Outfit", ar: "الملابس", icon: Shirt },
  pants: { en: "Pants", ar: "البنطال", icon: PantsIcon },
  shoes: { en: "Shoes", ar: "الحذاء", icon: Footprints },
  accessory: { en: "Extras", ar: "إكسسوار", icon: Glasses },
};

const SLOTS_ALLOW_NONE: Set<Slot> = new Set(["hair"]);

export default function AvatarCreator({
  initialConfig,
  catalog,
  language,
  onSave,
  onClose,
}: AvatarCreatorProps) {
  const isAr = language === "ar";
  const [config, setConfig] = useState<AvatarConfig>(initialConfig);
  const [activeSlot, setActiveSlot] = useState<Slot>("body");

  const catalogBySlot = useMemo(() => {
    const map = new Map<Slot, AvatarAsset[]>();
    for (const slot of SLOTS_IN_ORDER) map.set(slot, []);
    for (const asset of catalog) {
      const arr = map.get(asset.slot);
      if (arr) arr.push(asset);
    }
    return map;
  }, [catalog]);

  // The rail only shows slots the visitor can actually do something with:
  // multiple items to pick from, or at least one item with a color palette.
  // With the seed character that is every slot except Extras. New
  // owner-uploaded items surface slots
  // automatically.
  const visibleSlots = useMemo(
    () =>
      SLOTS_IN_ORDER.filter((slot) => {
        const count = catalogBySlot.get(slot)?.length ?? 0;
        if (count > 1) return true;
        if (count === 1 && TINTABLE_SLOTS.has(slot) && SLOT_PALETTES[slot])
          return true;
        return false;
      }),
    [catalogBySlot]
  );

  const handlePickAsset = useCallback(
    (slot: Slot, assetId: string | null) => {
      setConfig((c) => withSlotAssetId(c, slot, assetId));
    },
    []
  );

  const handlePickTint = useCallback((slot: Slot, hex: string) => {
    setConfig((c) => withSlotTint(c, slot, hex));
  }, []);

  // Dice roll: random item + random palette color for every slot.
  const handleRandomize = useCallback(() => {
    setConfig((c) => {
      let next = c;
      for (const slot of SLOTS_IN_ORDER) {
        const assets = catalogBySlot.get(slot) ?? [];
        const pool: Array<string | null> = assets.map((a) => a.id);
        if (SLOTS_ALLOW_NONE.has(slot)) pool.push(null);
        if (pool.length === 0) continue;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        next = withSlotAssetId(next, slot, pick);
        const palette = SLOT_PALETTES[slot];
        if (pick !== null && palette && TINTABLE_SLOTS.has(slot)) {
          next = withSlotTint(
            next,
            slot,
            palette[Math.floor(Math.random() * palette.length)]
          );
        }
      }
      return next;
    });
  }, [catalogBySlot]);

  const handleSave = () => onSave(config);

  const tintForActiveSlot = TINTABLE_SLOTS.has(activeSlot)
    ? getSlotTint(config, activeSlot) ?? DEFAULT_TINTS[activeSlot] ?? "#888888"
    : null;
  const paletteForActiveSlot = TINTABLE_SLOTS.has(activeSlot)
    ? SLOT_PALETTES[activeSlot] ?? null
    : null;

  return (
    // modal={false}: this dialog is opened only from play mode, while
    // CabinetStage already holds the body in position:fixed (its own
    // scroll lock) and freezes Phaser input via EVENTS.UI_MODAL. Radix's
    // own modal scroll-lock/focus-trap machinery would fight that body
    // fixation on close, so it's disabled here — outside-click and Escape
    // still dismiss via onOpenChange, just without Radix managing scroll.
    <Dialog open onOpenChange={(next) => !next && onClose()} modal={false}>
      <DialogContent
        className="w-full max-w-[calc(100%-1.5rem)] sm:max-w-4xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col rounded-2xl border-2 border-ink/70 bg-paper-1 shadow-[0_24px_60px_-16px_rgba(43,36,32,0.5)]"
        dir={isAr ? "rtl" : "ltr"}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 px-4 sm:px-6 py-3.5 border-b-2 border-ink/10 bg-paper-2/70">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid shrink-0 place-items-center w-10 h-10 rounded-xl border-2 border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
              <Shirt size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-display text-xl sm:text-2xl font-semibold text-ink leading-tight truncate">
                {isAr ? "خزانة الملابس" : "Wardrobe"}
              </DialogTitle>
              <p className="text-xs text-ink-soft truncate">
                {isAr ? "جهّز شخصيتك للمغامرة" : "Suit up your character"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRandomize}
            className="kui-btn me-8 shrink-0"
          >
            <Dices size={17} aria-hidden="true" />
            <span className="hidden sm:inline">{isAr ? "فاجئني" : "Surprise me"}</span>
          </button>
        </DialogHeader>

        {/* Body: stage + picker */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Character stage */}
          <div className="md:w-[290px] md:min-w-[290px] flex flex-row md:flex-col items-center justify-center gap-3 md:gap-4 p-4 md:p-6 border-b-2 md:border-b-0 md:border-e-2 border-ink/10 bg-[radial-gradient(ellipse_at_50%_20%,var(--paper-0),var(--paper-2)_75%)]">
            <PreviewStage config={config} catalog={catalog} language={language} />
          </div>

          {/* Slot rail + items + swatches */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div
              className="shrink-0 flex gap-2 px-4 pt-4 pb-2 overflow-x-auto"
              role="tablist"
              aria-label={isAr ? "فئات الملابس" : "Wardrobe slots"}
            >
              {visibleSlots.map((slot) => {
                const label = SLOT_LABELS[slot];
                const Icon = label.icon;
                const active = activeSlot === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveSlot(slot)}
                    className="kui-btn shrink-0"
                    data-stack=""
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="leading-none">
                      {isAr ? label.ar : label.en}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-5">
              {/* Item cards only when there's an actual choice to make —
                  a single fixed item (the body sheet, the shoes) shows
                  just its swatches. */}
              {((catalogBySlot.get(activeSlot)?.length ?? 0) > 1 ||
                SLOTS_ALLOW_NONE.has(activeSlot)) && (
                <SlotGrid
                  slot={activeSlot}
                  assets={catalogBySlot.get(activeSlot) ?? []}
                  selectedId={getSlotAssetId(config, activeSlot)}
                  tint={tintForActiveSlot}
                  language={language}
                  allowNone={SLOTS_ALLOW_NONE.has(activeSlot)}
                  onPick={(id) => handlePickAsset(activeSlot, id)}
                />
              )}

              {paletteForActiveSlot && tintForActiveSlot && (
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint mb-2.5">
                    {isAr ? "اللون" : "Colour"}
                  </h4>
                  <div className="flex flex-wrap gap-2.5">
                    {paletteForActiveSlot.map((hex) => {
                      const selected =
                        hex.toUpperCase() === tintForActiveSlot.toUpperCase();
                      return (
                        <button
                          key={hex}
                          type="button"
                          aria-label={hex}
                          aria-pressed={selected}
                          onClick={() => handlePickTint(activeSlot, hex)}
                          className={cn(
                            "w-9 h-9 rounded-full border-2 transition-transform",
                            selected
                              ? "border-paper-0 ring-2 ring-accent-brand ring-offset-2 ring-offset-paper-1 scale-110"
                              : "border-ink/20 hover:scale-110"
                          )}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex gap-3 px-4 sm:px-6 py-4 border-t-2 border-ink/10 bg-paper-2/70">
          <button
            type="button"
            onClick={onClose}
            className="kui-btn flex-1"
            data-size="lg"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="kui-btn flex-[2]"
            data-size="lg"
            data-tone="green"
          >
            {isAr ? "حفظ واللعب" : "Save & Play"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Slot thumbnail grid ─────────────────────────────────────────────

function SlotGrid({
  slot,
  assets,
  selectedId,
  tint,
  language,
  allowNone,
  onPick,
}: {
  slot: Slot;
  assets: AvatarAsset[];
  selectedId: string | null;
  tint: string | null;
  language: "en" | "ar";
  allowNone: boolean;
  onPick: (id: string | null) => void;
}) {
  const isAr = language === "ar";

  if (assets.length === 0 && !allowNone) {
    return (
      <p className="text-sm text-ink-soft italic">
        {isAr
          ? "لا توجد عناصر متاحة لهذه الفئة بعد. اطلب من المالك إضافتها."
          : "No items in this slot yet — ask the owner to add some."}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      {allowNone && (
        <ItemCard
          isSelected={selectedId === null}
          label={isAr ? "بدون" : "None"}
          onClick={() => onPick(null)}
        >
          <div className="w-full aspect-[5/6] flex items-center justify-center text-ink-faint">
            <CircleOff size={30} aria-hidden="true" />
          </div>
        </ItemCard>
      )}
      {assets.map((asset) => (
        <ItemCard
          key={asset.id}
          isSelected={selectedId === asset.id}
          label={isAr ? asset.nameAr ?? asset.name : asset.name}
          onClick={() => onPick(asset.id)}
        >
          <ThumbnailCanvas slot={slot} asset={asset} tint={tint} />
        </ItemCard>
      ))}
    </div>
  );
}

function ItemCard({
  isSelected,
  label,
  onClick,
  children,
}: {
  isSelected: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        "group relative flex flex-col rounded-xl border-2 p-1.5 pb-1 transition-all",
        isSelected
          ? "border-accent-brand bg-paper-0 shadow-[0_4px_0_rgba(192,91,63,0.35)]"
          : "border-ink/10 bg-paper-0/70 hover:bg-paper-0 hover:border-ink/30 hover:-translate-y-0.5 hover:shadow-md"
      )}
    >
      <div className="rounded-lg bg-paper-2/70 overflow-hidden">{children}</div>
      <span className="mt-1.5 mb-0.5 text-xs font-semibold text-ink text-center truncate">
        {label}
      </span>
      {isSelected && (
        <span className="absolute -top-2 -end-2 grid place-items-center w-6 h-6 rounded-full bg-accent-brand text-paper-0 border-2 border-paper-0 shadow">
          <Check size={13} strokeWidth={3.5} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

// ─── Thumbnail canvas — per-slot zoom so cards read as item icons ────

const THUMB_W = 110;
const THUMB_H = 132;

// Focus window per slot in feet-space (x: 0 = center, y: 0 = feet,
// negative = up). Zooming the card onto the item region — instead of
// always framing the whole 240×280 cell — is what makes shoe/pants cards
// legible at thumbnail size.
const SLOT_FOCUS: Record<Slot, { cx: number; cy: number; w: number; h: number }> = {
  body: { cx: 0, cy: -138, w: 145, h: 270 },
  eyes: { cx: 15, cy: -200, w: 110, h: 90 },
  hair: { cx: 0, cy: -225, w: 156, h: 122 },
  accessory: { cx: -25, cy: -105, w: 110, h: 150 },
  shirt: { cx: 0, cy: -120, w: 140, h: 120 },
  pants: { cx: 0, cy: -55, w: 120, h: 95 },
  shoes: { cx: 12, cy: -30, w: 115, h: 75 },
};

function ThumbnailCanvas({
  slot,
  asset,
  tint,
}: {
  slot: Slot;
  asset: AvatarAsset;
  tint: string | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Synthesize a 1-asset config so we can reuse drawAvatarFrame's tint
  // pipeline. drawAvatarFrame skips slots with no matching asset, so the
  // single thumb asset is the only thing that draws.
  const fakeConfig: AvatarConfig = useMemo(
    () => ({
      schemaVersion: AVATAR_SCHEMA_VERSION,
      bodyAssetId: asset.slot === "body" ? asset.id : "",
      bodyTint: asset.slot === "body" && tint ? tint : "#888",
      eyesAssetId: asset.slot === "eyes" ? asset.id : "",
      hairAssetId: asset.slot === "hair" ? asset.id : null,
      hairTint: asset.slot === "hair" && tint ? tint : null,
      shirtAssetId: asset.slot === "shirt" ? asset.id : null,
      shirtTint: asset.slot === "shirt" && tint ? tint : null,
      pantsAssetId: asset.slot === "pants" ? asset.id : null,
      pantsTint: asset.slot === "pants" && tint ? tint : null,
      shoesAssetId: asset.slot === "shoes" ? asset.id : null,
      shoesTint: asset.slot === "shoes" && tint ? tint : null,
      accessoryAssetId: asset.slot === "accessory" ? asset.id : null,
    }),
    [asset, tint]
  );

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let cancelled = false;

    (async () => {
      // Preload the image first so the draw block below runs without
      // ever yielding the JS thread (no race with Strict-Mode-double-
      // mount cleanup, no concurrent transform writes on the same ctx).
      try {
        await loadAvatarImage(asset.spriteUrl);
      } catch {
        return;
      }
      if (cancelled) return;

      const ctx = cv.getContext("2d");
      if (!ctx) return;

      const focus = SLOT_FOCUS[slot];
      const scale = Math.min(THUMB_W / focus.w, THUMB_H / focus.h);

      // Clear in device space, then map the focus window's center to the
      // canvas center. drawAvatarFrame draws with feet at (0, 0).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(
        scale,
        0,
        0,
        scale,
        cv.width / 2 - focus.cx * scale,
        cv.height / 2 - focus.cy * scale
      );

      try {
        await drawAvatarFrame(ctx, fakeConfig, [asset], {
          direction: "right",
          isWalking: false,
          frame: 0,
        });
      } catch {
        /* bad URL → empty thumb */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slot, asset, fakeConfig]);

  return (
    <canvas
      ref={ref}
      width={THUMB_W}
      height={THUMB_H}
      className="w-full h-auto"
      style={{ imageRendering: "auto" }}
    />
  );
}

// ─── Live preview stage — the character walks in place ──────────────

const PREVIEW_W = 260;
const PREVIEW_H = 304;
// The character's full 6-pose strut, matching the in-game 7fps playback.
const WALK_SEQUENCE = [1, 2, 3, 4, 5, 6] as const;
const PREVIEW_FRAME_MS = 145;

function PreviewStage({
  config,
  catalog,
  language,
}: {
  config: AvatarConfig;
  catalog: AvatarAsset[];
  language: "en" | "ar";
}) {
  const isAr = language === "ar";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement | null>(null);
  const [walking, setWalking] = useState(true);
  const [direction, setDirection] = useState<"right" | "left">("right");

  // Rebuild the real in-game sprite sheet whenever the outfit changes —
  // the preview IS the game render, not an approximation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sheet = await buildAvatarSheet(config, catalog);
        if (!cancelled) sheetRef.current = sheet;
      } catch {
        /* missing assets are skipped per-layer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, catalog]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let step = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < PREVIEW_FRAME_MS) return;
      last = t;

      const cv = canvasRef.current;
      const sheet = sheetRef.current;
      if (!cv || !sheet) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;

      const frame = walking ? WALK_SEQUENCE[step % WALK_SEQUENCE.length] : 0;
      step++;

      const col = (direction === "left" ? 4 : 0) + frame;
      const scale = Math.min(cv.width / FRAME_W, cv.height / FRAME_H);
      const dw = FRAME_W * scale;
      const dh = FRAME_H * scale;

      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        sheet,
        col * FRAME_W,
        0,
        FRAME_W,
        FRAME_H,
        (cv.width - dw) / 2,
        cv.height - dh,
        dw,
        dh
      );
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [walking, direction]);

  const flip = () =>
    setDirection((d) => (d === "right" ? "left" : "right"));

  return (
    <>
      <button
        type="button"
        onClick={flip}
        title={isAr ? "انقر للالتفاف" : "Click to turn around"}
        className="rounded-2xl transition-transform hover:scale-[1.02] active:scale-[0.99]"
      >
        <canvas
          ref={canvasRef}
          width={PREVIEW_W}
          height={PREVIEW_H}
          className="w-[150px] md:w-[230px] h-auto"
          style={{ imageRendering: "auto" }}
        />
      </button>
      <div className="flex md:flex-row flex-col items-center gap-2">
        <ModeChip
          active={!walking}
          onClick={() => setWalking(false)}
          icon={PersonStanding}
          label={isAr ? "وقوف" : "Stand"}
        />
        <ModeChip
          active={walking}
          onClick={() => setWalking(true)}
          icon={Footprints}
          label={isAr ? "مشي" : "Walk"}
        />
        <ModeChip
          active={false}
          onClick={flip}
          icon={ArrowLeftRight}
          label={isAr ? "التفاف" : "Turn"}
        />
      </div>
    </>
  );
}

function ModeChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<LucideProps>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="kui-btn"
      data-size="sm"
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
