// AvatarTexture — bridges the canvas-based v2 avatar pipeline into Phaser.
//
// Builds an offscreen sprite sheet via avatarCompositor.buildAvatarSheet()
// and registers it as a Phaser canvas texture with 8 frames + 2 walk
// animations (left / right). The async signature exists because the
// underlying asset PNGs are network-loaded.
//
// Sprite-sheet layout (from avatarCompositor.ts, FRAMES_PER_DIRECTION=7):
//   Columns 0-6:  direction "right", frames 0-6 (0=idle, 1-6=walk)
//   Columns 7-13: direction "left",  frames 0-6
//   Cell size: 240 × 280
//
// Player sprites are scaled to 0.5× so the on-screen footprint matches the
// pre-rework 120×140 character while we get the extra detail headroom.

import Phaser from "phaser";
import type { AvatarAsset, AvatarConfig } from "@/data/avatarTypes";
import {
  buildAvatarSheet,
  FRAME_W,
  FRAME_H,
  FRAMES_PER_DIRECTION,
} from "@/lib/avatarCompositor";

const TEXTURE_KEY = "player-avatar";
const WALK_RIGHT_ANIM = "player-walk-right";
const WALK_LEFT_ANIM = "player-walk-left";
const IDLE_RIGHT_FRAME = 0;
const IDLE_LEFT_FRAME = FRAMES_PER_DIRECTION;
const PLAYER_SCALE = 0.5;

/** Look up the avatar catalog stashed in the registry by PhaserGame. */
function getCatalogFromScene(scene: Phaser.Scene): AvatarAsset[] {
  return (scene.registry.get("avatarCatalog") as AvatarAsset[] | undefined) ?? [];
}

/**
 * Build the avatar sprite sheet and register it as a Phaser texture.
 * Call this on initial scene load and whenever avatar config changes.
 *
 * Async because asset images are network-loaded. Callers that can't await
 * (e.g. Scene.create()) should fire-and-forget and rely on the catch
 * handler — the player sprite shows whatever frame was previously bound
 * until the new texture lands.
 */
export async function registerAvatarTexture(
  scene: Phaser.Scene,
  config: AvatarConfig
): Promise<void> {
  // Bail out if the scene's game or renderer has been destroyed
  if (!scene.game || !scene.sys.renderer) return;

  const catalog = getCatalogFromScene(scene);
  const sheetCanvas = await buildAvatarSheet(config, catalog);

  // Scene may have been torn down while we awaited the network fetches.
  if (!scene.sys || !scene.sys.isActive?.()) return;

  const textures = scene.textures;
  if (!textures) return;

  // Replace any prior texture (e.g. from a previous equipment change).
  if (textures.exists(TEXTURE_KEY)) {
    textures.remove(TEXTURE_KEY);
  }

  textures.addCanvas(TEXTURE_KEY, sheetCanvas);

  // Manually slice the sheet into frames (idle + walk poses per direction).
  const texture = textures.get(TEXTURE_KEY);
  const totalFrames = FRAMES_PER_DIRECTION * 2;
  for (let i = 0; i < totalFrames; i++) {
    texture.add(i, 0, i * FRAME_W, 0, FRAME_W, FRAME_H);
  }

  // (Re)create the walk animations — Phaser keys are global so we
  // remove-and-recreate to be safe across scene restarts.
  const anims = scene.anims;
  if (anims.exists(WALK_RIGHT_ANIM)) anims.remove(WALK_RIGHT_ANIM);
  if (anims.exists(WALK_LEFT_ANIM)) anims.remove(WALK_LEFT_ANIM);

  // The character's 6-pose high-step strut: one full two-step cycle per loop.
  const walkFrames = Array.from(
    { length: FRAMES_PER_DIRECTION - 1 },
    (_, i) => i + 1
  );
  anims.create({
    key: WALK_RIGHT_ANIM,
    frames: walkFrames.map((frame) => ({ key: TEXTURE_KEY, frame })),
    frameRate: 7,
    repeat: -1,
  });

  anims.create({
    key: WALK_LEFT_ANIM,
    frames: walkFrames.map((frame) => ({
      key: TEXTURE_KEY,
      frame: frame + FRAMES_PER_DIRECTION,
    })),
    frameRate: 7,
    repeat: -1,
  });
}

/**
 * Create a player sprite using the registered avatar texture. Returns a
 * Phaser.GameObjects.Sprite positioned at (x, y), facing right idle.
 */
export function createPlayerSprite(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Sprite {
  const sprite = scene.add.sprite(x, y, TEXTURE_KEY, IDLE_RIGHT_FRAME);

  // Origin at bottom-center (feet); scale so 240×280 art renders at the
  // pre-rework 120×140 footprint visible on screen.
  sprite.setOrigin(0.5, 1);
  sprite.setScale(PLAYER_SCALE);

  return sprite;
}

/** Play walk animation in the given direction. */
export function playWalkAnim(
  sprite: Phaser.GameObjects.Sprite,
  direction: "left" | "right"
): void {
  const key = direction === "right" ? WALK_RIGHT_ANIM : WALK_LEFT_ANIM;
  // Replay when the direction changed OR the anim isn't currently running.
  // playIdleFrame() calls stop(), which leaves currentAnim pointing at the
  // last walk key while isPlaying is false — so a same-direction second
  // walk must be caught by the isPlaying check, otherwise the character slides
  // on the idle frame with no animation.
  if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) {
    sprite.play(key);
  }
}

/** Stop walking and show the idle frame in the given direction. */
export function playIdleFrame(
  sprite: Phaser.GameObjects.Sprite,
  direction: "left" | "right"
): void {
  sprite.stop();
  sprite.setFrame(direction === "right" ? IDLE_RIGHT_FRAME : IDLE_LEFT_FRAME);
}

export { TEXTURE_KEY, WALK_RIGHT_ANIM, WALK_LEFT_ANIM };
