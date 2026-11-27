// Avatar Compositor (v2)
//
// Pre-composites every animation frame into a single offscreen canvas
// (sprite sheet). A standard pattern in classic click-to-walk virtual worlds:
// render all layers once on equipment change, then displays via cheap
// drawImage(sheet, sourceRect) per frame.
//
// Sheet layout (FRAMES_PER_DIRECTION = 7 for the seed character's 6-pose
// high-step strut):
//   Columns 0-6:  direction "right", frames 0-6 (0=idle, 1-6=walk)
//   Columns 7-13: direction "left",  frames 0-6
//   1 row
//
// Cell size: FRAME_W × FRAME_H (240 × 280)
// Total sheet: 3360 × 280 px — well within WebGL texture limits.

import type { AnimState, AvatarAsset, AvatarConfig } from "@/data/avatarTypes";
import { drawAvatarFrame, FRAME_H, FRAME_W } from "@/lib/avatarLayersV2";
import { preloadAvatarImages } from "@/lib/avatarAssetCache";

export { FRAME_W, FRAME_H };

/** Idle + walk poses per facing direction. Single source of truth for the
 * compositor and AvatarTexture's frame indexing. */
export const FRAMES_PER_DIRECTION = 7;

const DIRECTIONS: Array<"right" | "left"> = ["right", "left"];
const WALK_FRAMES = FRAMES_PER_DIRECTION;
const TOTAL_COLS = DIRECTIONS.length * WALK_FRAMES; // 14

/**
 * Build an offscreen canvas containing all 8 animation frames for this
 * config. Async because asset PNGs/SVGs are network-loaded — the cache
 * memoizes after the first build, so subsequent equipment changes are
 * fast (only the off-screen tint canvases get rebuilt).
 */
export async function buildAvatarSheet(
  config: AvatarConfig,
  catalog: readonly AvatarAsset[]
): Promise<HTMLCanvasElement> {
  // Kick off all referenced asset fetches in parallel before we start
  // drawing. drawAvatarFrame() also lazy-loads, but pre-warming halves
  // the wall time for a cold cache.
  await preloadAvatarImages(config, catalog);

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W * TOTAL_COLS;
  canvas.height = FRAME_H;

  const ctx = canvas.getContext("2d")!;

  let col = 0;
  for (const direction of DIRECTIONS) {
    for (let frame = 0; frame < WALK_FRAMES; frame++) {
      const animState: AnimState = {
        direction,
        isWalking: frame > 0,
        frame,
      };

      ctx.save();
      // Anchor at bottom-center of this cell so feet sit at (0, 0) for the
      // layer drawer (which then draws into negative-Y space to fill upward).
      ctx.translate(col * FRAME_W + FRAME_W / 2, FRAME_H);
      await drawAvatarFrame(ctx, config, catalog, animState);
      ctx.restore();

      col++;
    }
  }

  return canvas;
}
