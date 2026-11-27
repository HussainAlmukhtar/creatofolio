// Avatar Layer Compositor (v2 — human, PNG/SVG layers)
//
// One drawAvatarFrame() call lays down all enabled slot layers on the
// caller's canvas, anchored at (0, FRAME_H) (i.e. feet at origin, drawing
// upward). Tintable layers (body / hair / shirt / pants / shoes) are
// recolored via an HSL remap before composite — preserves the artist's
// line-art and shading instead of multiply-darkening it.
//
// Asset images come in two shapes, auto-detected by aspect ratio:
//   - 4-frame walk sheet (e.g. 960×280): cells are idle / step-A /
//     passing / step-B — the seed art and any future animated uploads.
//   - single portrait pose (e.g. 240×280): legacy + hand-drawn static
//     uploads; shown for every frame with a procedural walk bob.
//
// Used by avatarCompositor.buildAvatarSheet() to render every animation
// frame once into a single sprite sheet, which Phaser then displays via
// frame indexes.

import type {
  AvatarAsset,
  AvatarConfig,
  AnimState,
  Slot,
} from "@/data/avatarTypes";
import {
  SLOT_Z_ORDER,
  TINTABLE_SLOTS,
  getSlotAssetId,
  getSlotTint,
} from "@/data/avatarTypes";
import { loadAvatarImage } from "@/lib/avatarAssetCache";

export const FRAME_W = 240;
export const FRAME_H = 280;

/** Y-bob amplitude for the walk cycle. Subtle, like the v1 avatar. */
const WALK_BOB_AMPLITUDE = 6;

function walkBobOffset(animState: AnimState): number {
  if (!animState.isWalking) return 0;
  // one full sine cycle across the 6 walk poses (frames 1-6)
  return Math.sin(((animState.frame - 1) * Math.PI) / 3) * WALK_BOB_AMPLITUDE;
}

/**
 * Draw all configured slot layers for one frame onto `ctx`. The caller is
 * expected to have already translated to the desired anchor — drawing
 * happens in the rectangle (-FRAME_W/2, -FRAME_H, FRAME_W, FRAME_H) so
 * (0, 0) is the character's feet center.
 */
export async function drawAvatarFrame(
  ctx: CanvasRenderingContext2D,
  config: AvatarConfig,
  catalog: readonly AvatarAsset[],
  animState: AnimState
): Promise<void> {
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const bob = walkBobOffset(animState);

  // Soft shadow under the feet — independent of any asset, scales subtly
  // with bob so the character feels grounded.
  drawGroundShadow(ctx);

  // Sort by z-order with per-asset z_offset as a tie-breaker.
  const orderedAssets: Array<{ slot: Slot; asset: AvatarAsset }> = [];
  for (const slot of SLOT_Z_ORDER) {
    const id = getSlotAssetId(config, slot);
    if (!id) continue;
    const asset = byId.get(id);
    if (!asset) continue;
    orderedAssets.push({ slot, asset });
  }

  for (const { slot, asset } of orderedAssets) {
    const url =
      animState.direction === "left" && asset.spriteLeftUrl
        ? asset.spriteLeftUrl
        : asset.spriteUrl;

    let img: HTMLImageElement;
    try {
      img = await loadAvatarImage(url);
    } catch {
      continue; // missing PNG — skip this slot rather than crash the frame
    }

    // Walk-sheet detection: cell count is derived from the image's aspect
    // ratio versus the canonical cell aspect (240:280) — e.g. the default
    // seed sheets are 7 cells (idle + 6 walk poses), legacy chibi sheets
    // were 4, and a single portrait pose is 1. Sheets carry authored
    // motion, so the procedural bob only applies to static assets.
    const cells = Math.max(
      1,
      Math.round(img.width / img.height / (FRAME_W / FRAME_H))
    );
    const isSheet = cells >= 2;
    const cellW = img.width / cells;
    const cellH = img.height;
    const srcX = isSheet ? cellW * Math.min(animState.frame, cells - 1) : 0;
    const dy = isSheet ? 0 : bob;

    const tint = TINTABLE_SLOTS.has(slot) ? getSlotTint(config, slot) : null;
    const mirror =
      animState.direction === "left" && !asset.spriteLeftUrl;

    if (tint || mirror) {
      // Off-screen canvas to apply mirror + tint without dirtying the sheet.
      const off = document.createElement("canvas");
      off.width = FRAME_W;
      off.height = FRAME_H;
      const offCtx = off.getContext("2d")!;

      if (mirror) {
        offCtx.translate(FRAME_W, 0);
        offCtx.scale(-1, 1);
      }
      offCtx.drawImage(img, srcX, 0, cellW, cellH, 0, 0, FRAME_W, FRAME_H);
      if (tint) recolorCanvas(offCtx, tint);
      ctx.drawImage(off, -FRAME_W / 2, -FRAME_H + dy);
    } else {
      ctx.drawImage(
        img,
        srcX,
        0,
        cellW,
        cellH,
        -FRAME_W / 2,
        -FRAME_H + dy,
        FRAME_W,
        FRAME_H
      );
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function drawGroundShadow(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  ctx.ellipse(0, -8, 50, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Recolor the canvas toward a target color — a full HSL remap, not just a
 * hue rotation. The asset's average colorable pixel is taken as its
 * reference color; every colorable pixel is then mapped so the reference
 * lands exactly on the target while shading/highlights keep their relative
 * saturation and lightness ratios. This is what lets one skin sprite
 * express pale-to-deep tones and one hair sprite go blonde-to-black —
 * a pure hue shift can never change lightness.
 *
 * Pixels that are very dark (ink line art) or very desaturated (whites,
 * soles, glints) are left untouched so outlines and highlights survive.
 */
function recolorCanvas(
  ctx: CanvasRenderingContext2D,
  targetHex: string
): void {
  const target = hexToHsl(targetHex);
  const { width, height } = ctx.canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;

  const colorable = (a: number, s: number, l: number) =>
    a > 0 && l >= 0.15 && s >= 0.12;

  // Pass 1: the asset's reference color = average s/l of colorable pixels.
  let sumS = 0;
  let sumL = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const { s, l } = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (!colorable(px[i + 3], s, l)) continue;
    sumS += s;
    sumL += l;
    n++;
  }
  if (n === 0) return;
  const baseS = Math.max(sumS / n, 0.05);
  const baseL = Math.max(sumL / n, 0.05);

  // Pass 2: remap every colorable pixel relative to the reference.
  for (let i = 0; i < px.length; i += 4) {
    const { s, l } = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (!colorable(px[i + 3], s, l)) continue;

    const ns = Math.min(1, Math.max(0, (s / baseS) * target.s));
    const nl = Math.min(0.97, Math.max(0.04, (l / baseL) * target.l));

    const { r: nr, g: ng, b: nb } = hslToRgb(target.h, ns, nl);
    px[i] = nr;
    px[i + 1] = ng;
    px[i + 2] = nb;
  }

  ctx.putImageData(imageData, 0, 0);
}

// ─── HSL ↔ RGB ───────────────────────────────────────────────────────

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 0 };
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return rgbToHsl(r, g, b);
}

function rgbToHsl(
  r: number,
  g: number,
  b: number
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
