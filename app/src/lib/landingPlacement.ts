// Where a newly added element lands in a section.
//
// Everything used to drop at one fixed spot (centred, y≈38%), so adding three
// components stacked them on top of each other. Builders put a new element in
// the first free space instead; this does the same. It scans top to bottom,
// trying the centre column first and then the left and right edges, and takes
// the first slot that doesn't overlap an existing element (with a small gap).
// Only when the section is full does it fall back to a cascade: slightly
// offset from the last element, so the new one is still visibly separate.
//
// Coordinates are section percentages (x/y = top-left, w/h = size), the same
// space DrawnAsset uses. Desktop layout only, since that's where elements are
// added. Mobile is derived from it or auto-stacked.

import type { DrawnAsset } from "@/data/landingTypes";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 2; // % breathing room between elements
const MARGIN = 4; // % from the section edges
const STEP = 2;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP &&
  b.x < a.x + a.w + GAP &&
  a.y < b.y + b.h + GAP &&
  b.y < a.y + a.h + GAP;

export function findFreeSpot(
  existing: Pick<DrawnAsset, "x" | "y" | "w" | "h">[],
  w: number,
  h: number
): { x: number; y: number; full?: boolean } {
  const W = Math.min(w, 100 - MARGIN * 2);
  const H = Math.min(h, 100 - MARGIN * 2);
  const centre = (100 - W) / 2;
  const xs = [centre, MARGIN, 100 - MARGIN - W];
  for (let x = MARGIN; x <= 100 - MARGIN - W; x += 4) xs.push(x);
  const round = (n: number) => Math.round(n * 100) / 100;

  for (let y = MARGIN; y <= 100 - MARGIN - H; y += STEP) {
    for (const x of xs) {
      const r = { x, y, w: W, h: H };
      if (!existing.some((e) => overlaps(r, e))) return { x: round(x), y: round(y) };
    }
  }
  // Full: cascade off the last element.
  const last = existing[existing.length - 1];
  if (!last) return { x: round(centre), y: MARGIN };
  return {
    x: round(Math.min(Math.max(0, last.x + 3), 100 - W)),
    y: round(Math.min(Math.max(0, last.y + 3), 100 - H)),
    full: true,
  };
}

/** Return `asset` moved to a free spot among `existing`. */
export function placeAsset<T extends DrawnAsset>(existing: DrawnAsset[], asset: T): T {
  const { x, y } = findFreeSpot(existing, asset.w, asset.h);
  return { ...asset, x, y };
}

// ─── Editor-side measuring ──────────────────────────────────────
//
// Auto-height components (carousel, accordion, embed, form…) render taller
// than their stored `h`, so placing by stored geometry still overlaps them.
// In the editor we can measure what's actually on screen instead.

type PctRect = Pick<DrawnAsset, "x" | "y" | "w" | "h">;

function sectionContainer(sectionId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-editor-canvas] [data-section-id="${CSS.escape(sectionId)}"] .drawn-section__container`
  );
}

/** On-screen rect of one asset, as section percentages (null if not rendered). */
export function measureAsset(sectionId: string, iid: string): PctRect | null {
  const box = sectionContainer(sectionId);
  const el = box?.querySelector<HTMLElement>(`.drawn-asset-pos[data-asset-iid="${CSS.escape(iid)}"]`);
  if (!box || !el) return null;
  const c = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (c.width === 0 || c.height === 0 || r.width === 0) return null;
  return {
    x: ((r.left - c.left) / c.width) * 100,
    y: ((r.top - c.top) / c.height) * 100,
    w: (r.width / c.width) * 100,
    h: (r.height / c.height) * 100,
  };
}

/** Every asset's footprint: measured where rendered, stored geometry otherwise. */
export function occupiedRects(sectionId: string, assets: DrawnAsset[]): PctRect[] {
  return assets.map((a) => measureAsset(sectionId, a.iid) ?? a);
}

export function rectsOverlap(a: PctRect, b: PctRect): boolean {
  return overlaps(a, b);
}

/** Bounding box of several rects. */
export function unionRect(rs: PctRect[]): PctRect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const right = Math.max(...rs.map((r) => r.x + r.w));
  const bottom = Math.max(...rs.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * A section with no room left grows below its content. Returns the height
 * factor to grow the canvas by, and where the new block goes, in the GROWN
 * canvas's percentages (centred, one gap under the lowest element).
 */
export function planGrowth(
  others: PctRect[],
  block: Pick<PctRect, "w" | "h">
): { factor: number; x: number; y: number } {
  const bottom = Math.max(0, ...others.map((o) => o.y + o.h));
  const factor = Math.max(1, (bottom + GAP * 2 + block.h + MARGIN) / 100);
  return {
    factor,
    x: Math.max(0, (100 - block.w) / 2),
    y: (bottom + GAP * 2) / factor,
  };
}

/**
 * Height (section-%) that shows an image of `natural` px size undistorted
 * at `wPct` width in a canvas of `canvas` design px. (% of width vs % of
 * height of a canvas with its own aspect.)
 */
export function heightForImage(
  wPct: number,
  canvas: { w: number; h: number },
  natural: { w: number; h: number } | undefined,
  fallback: number
): number {
  if (!natural || natural.w === 0 || natural.h === 0) return fallback;
  return Math.round(((wPct * (canvas.w / canvas.h)) / (natural.w / natural.h)) * 100) / 100;
}
