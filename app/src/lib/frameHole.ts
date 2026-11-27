// Find a frame drawing's screen: the see-through hole the pop-up shows
// through. Browser-only (canvas).
//
// The drawing is shrunk to ≤ 360 px, then every connected see-through region
// (alpha < 24) that does NOT touch the drawing's edge is a candidate hole
// (the transparent space AROUND a TV doesn't count). The biggest one wins;
// its bounding box, grown by a hair so it tucks under the drawn bezel, is
// returned in % of the drawing. null = no enclosed hole (a solid screen).

import type { ScreenRect } from "@/data/popupStyleTypes";

const MAX_SIDE = 360;
const SEE_THROUGH = 24;
/** Grow the box so its edge hides under the bezel (% of each side). */
const BLEED = 0.6;
/** Ignore specks: a hole must cover at least this much of the drawing. */
const MIN_AREA = 0.02;

export async function findScreenHole(url: string): Promise<ScreenRect | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = g.getImageData(0, 0, w, h).data;
  } catch {
    return null; // a cross-origin image without CORS
  }

  const clear = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) clear[i] = data[i * 4 + 3] < SEE_THROUGH ? 1 : 0;
  const seen = new Uint8Array(w * h);
  let best: { area: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const stack: number[] = [];

  for (let start = 0; start < w * h; start++) {
    if (!clear[start] || seen[start]) continue;
    // Flood fill this see-through region.
    let area = 0;
    let touchesEdge = false;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of next) {
        if (q >= 0 && clear[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (touchesEdge || area < MIN_AREA * w * h) continue;
    if (!best || area > best.area) best = { area, x0, y0, x1, y1 };
  }
  if (!best) return null;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const x = Math.max(0, (best.x0 / w) * 100 - BLEED);
  const y = Math.max(0, (best.y0 / h) * 100 - BLEED);
  const right = Math.min(100, ((best.x1 + 1) / w) * 100 + BLEED);
  const bottom = Math.min(100, ((best.y1 + 1) / h) * 100 + BLEED);
  return { x: r1(x), y: r1(y), w: r1(right - x), h: r1(bottom - y) };
}
