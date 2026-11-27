// UI chrome skins — the on-screen controls around the arcade (language
// switcher, ✕ close, in-game language + map buttons) and the hint toasts.
//
// Every control keeps its built-in look unless a skin says otherwise:
//   art       drawn/uploaded image per language (replaces the pill)
//   hoverArt  optional image swapped in on hover
//   desktop / mobile  optional placement: a screen corner/edge + offset (px)
//             and a size (image height, px); `hidden` hides it on that device
// Chrome is ALWAYS viewport-fixed and never inside the arcade camera, so it
// never scales with the zoom (the CabinetStage portal invariant).

import type { ArcadeArt } from "./arcadeConfig";

export type ChromeAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface ChromePlacement {
  anchor: ChromeAnchor;
  /** Horizontal offset from the anchored edge, px (centre anchors: shift). */
  x: number;
  /** Vertical offset from the anchored edge, px. */
  y: number;
  /** Image height, px (art only — the built-in pill keeps its own size). */
  size: number;
}

export interface ChromeDevice extends Partial<ChromePlacement> {
  /** Move it off its default spot to this placement. */
  custom?: boolean;
  hidden?: boolean;
}

export interface ChromeSkin {
  art?: { en?: ArcadeArt | null; ar?: ArcadeArt | null };
  hoverArt?: { en?: ArcadeArt | null; ar?: ArcadeArt | null };
  desktop?: ChromeDevice;
  mobile?: ChromeDevice;
}

/** Arcade-only chrome (lives in the arcade section's config). */
export interface ArcadeChrome {
  close?: ChromeSkin;
  hudLanguage?: ChromeSkin;
  map?: ChromeSkin;
  /** Custom hint texts; empty = the built-in wording. */
  exitHint?: { en?: string; ar?: string };
  controlsHint?: { en?: string; ar?: string };
}

export type ChromeSlotId = "languagePill" | "close" | "hudLanguage" | "map";

/** Where each control sits when "custom position" is first switched on —
 *  matches its built-in spot so nothing jumps. */
export const CHROME_DEFAULT_PLACEMENT: Record<
  ChromeSlotId,
  { desktop: ChromePlacement; mobile: ChromePlacement }
> = {
  languagePill: {
    desktop: { anchor: "top-right", x: 16, y: 16, size: 40 },
    mobile: { anchor: "top-right", x: 16, y: 16, size: 36 },
  },
  close: {
    desktop: { anchor: "top-right", x: 16, y: 16, size: 44 },
    mobile: { anchor: "top-right", x: 16, y: 16, size: 40 },
  },
  hudLanguage: {
    desktop: { anchor: "top-right", x: 80, y: 16, size: 44 },
    mobile: { anchor: "bottom-center", x: -50, y: 16, size: 40 },
  },
  map: {
    desktop: { anchor: "top-right", x: 190, y: 16, size: 44 },
    mobile: { anchor: "bottom-center", x: 50, y: 16, size: 40 },
  },
};

export const CHROME_SLOT_LABEL: Record<ChromeSlotId, string> = {
  languagePill: "Language switcher (every page)",
  close: "✕ Close (while playing)",
  hudLanguage: "Language button (while playing)",
  map: "Map button (while playing)",
};

function placementOf(
  skin: ChromeSkin | undefined,
  slot: ChromeSlotId,
  device: "desktop" | "mobile"
): (ChromePlacement & { custom: boolean; hidden: boolean }) {
  const d = skin?.[device] ?? {};
  const def = CHROME_DEFAULT_PLACEMENT[slot][device];
  return {
    anchor: d.anchor ?? def.anchor,
    x: typeof d.x === "number" ? d.x : def.x,
    y: typeof d.y === "number" ? d.y : def.y,
    size: typeof d.size === "number" ? d.size : def.size,
    custom: Boolean(d.custom),
    hidden: Boolean(d.hidden),
  };
}

export function resolvedPlacement(
  skin: ChromeSkin | undefined,
  slot: ChromeSlotId,
  device: "desktop" | "mobile"
) {
  return placementOf(skin, slot, device);
}

/** CSS custom properties for one device's placement (inset + shift). */
function insetVars(p: ChromePlacement, suffix: "d" | "m") {
  const [v, h] = p.anchor.split("-") as ["top" | "bottom", "left" | "center" | "right"];
  const px = (n: number) => `${n}px`;
  const safeTop = "env(safe-area-inset-top, 0px)";
  const safeBottom = "env(safe-area-inset-bottom, 0px)";
  return {
    [`--cs-t-${suffix}`]: v === "top" ? `calc(${px(p.y)} + ${safeTop})` : "auto",
    [`--cs-b-${suffix}`]: v === "bottom" ? `calc(${px(p.y)} + ${safeBottom})` : "auto",
    [`--cs-l-${suffix}`]: h === "left" ? px(p.x) : h === "center" ? `calc(50% + ${px(p.x)})` : "auto",
    [`--cs-r-${suffix}`]: h === "right" ? px(p.x) : "auto",
    [`--cs-tx-${suffix}`]: h === "center" ? "-50%" : "0",
    [`--cs-h-${suffix}`]: px(p.size),
  } as Record<string, string>;
}

/**
 * Attributes + CSS vars that apply a skin's placement / visibility to a
 * control (see globals.css `.chrome-slot`). Spread onto the element.
 */
export function chromeSlotAttrs(
  skin: ChromeSkin | undefined,
  slot: ChromeSlotId,
  /** Place on BOTH devices (a control pulled out of its button row must sit
   *  somewhere on every device — its default spot where not customised). */
  forcePlaced = false
) {
  const d = placementOf(skin, slot, "desktop");
  const m = placementOf(skin, slot, "mobile");
  const hasArt = Boolean(skin?.art?.en || skin?.art?.ar);
  return {
    "data-chrome-slot": slot,
    "data-placed-d": d.custom || forcePlaced ? "true" : undefined,
    "data-placed-m": m.custom || forcePlaced ? "true" : undefined,
    "data-hide-d": d.hidden ? "true" : undefined,
    "data-hide-m": m.hidden ? "true" : undefined,
    "data-has-art": hasArt ? "true" : undefined,
    style: { ...insetVars(d, "d"), ...insetVars(m, "m") } as React.CSSProperties,
  };
}

/** True when the control has any custom placement (it leaves its group). */
export function isDetached(skin: ChromeSkin | undefined) {
  return Boolean(skin?.desktop?.custom || skin?.mobile?.custom);
}
