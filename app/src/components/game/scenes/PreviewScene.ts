// PreviewScene — standalone Phaser scene for the editor's live preview panel.
//
// Replicates BaseRoomScene's visual drawing but:
//  - Does NOT emit EventBridge events (avoids conflicting with main game React)
//  - Accepts RoomConfig dynamically via scene data
//  - Hot-reloads when EDITOR_ROOM_UPDATED fires
//  - Shows walkable area overlay and entry point markers
//  - Supports click-to-walk for testing room feel

import Phaser from "phaser";
import type { RoomConfig, RoomObject } from "@/data/roomTypes";
import { getPath, findSafeSpawn, directionToString } from "../systems/PathEngine";
import {
  createPlayerSprite,
  playWalkAnim,
  playIdleFrame,
  registerAvatarTexture,
} from "../systems/AvatarTexture";
import {
  buildDefaultAvatarConfig,
  type AvatarAsset,
  type AvatarConfig,
} from "@/data/avatarTypes";
import { EventBridge, EVENTS } from "../EventBridge";
import { ObjectFxController } from "../systems/ObjectFx";
import { objectArtUrl, fitArt } from "@/data/starterElements";

interface PreviewData {
  roomConfig?: RoomConfig;
}

export default class PreviewScene extends Phaser.Scene {
  private roomConfig!: RoomConfig;
  private player!: Phaser.GameObjects.Sprite;
  private playerDirection: "left" | "right" = "right";
  private playerTween: Phaser.Tweens.Tween | null = null;
  private walkTargetGfx!: Phaser.GameObjects.Graphics;
  private avatarRegistered = false;

  constructor() {
    super({ key: "PreviewScene" });
  }

  init(data: PreviewData) {
    if (data.roomConfig) {
      this.roomConfig = data.roomConfig;
    }
  }

  create() {
    if (!this.roomConfig) return;
    // scene.restart() reuses this instance; the old game objects are gone.
    this.placeholders.clear();
    for (const c of this.fx.values()) c.destroy();
    this.fx.clear();

    // Register avatar texture (once per game instance). The editor preview
    // doesn't need the visitor's outfit — any default-from-catalog works,
    // since the user is here to verify the room, not the character.
    if (!this.avatarRegistered) {
      const catalog =
        (this.registry.get("avatarCatalog") as AvatarAsset[] | undefined) ??
        [];
      const defaultConfig: AvatarConfig | null =
        buildDefaultAvatarConfig(catalog);
      if (defaultConfig) {
        void registerAvatarTexture(this, defaultConfig);
      }
      this.avatarRegistered = true;
    }

    // 1. Load textures + draw room geometry
    this.loadRoomBackground();
    this.drawRoom();

    // 2. Load sprite textures + draw interactive objects
    this.loadObjectSprites();
    this.drawObjects();

    // 3. Draw walkable area overlay
    this.drawWalkableArea();

    // 4. Draw entry points
    this.drawEntryPoints();

    // 5. Spawn player
    const entryPoint = this.roomConfig.entryPoints[0];
    if (entryPoint) {
      const spawnPos = findSafeSpawn(
        entryPoint.x,
        entryPoint.y,
        this.roomConfig.walkableArea.polygon,
        80,
        this.roomConfig.width,
        this.roomConfig.height
      );
      this.playerDirection = entryPoint.direction;
      this.player = createPlayerSprite(this, spawnPos.x, spawnPos.y);
      this.player.setDepth(spawnPos.y);
    }

    // 6. Camera
    this.cameras.main.setBounds(
      0,
      0,
      this.roomConfig.width,
      this.roomConfig.height
    );
    if (this.player) {
      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    }
    this.cameras.main.setBackgroundColor(this.roomConfig.backgroundColor);

    // 7. Walk target indicator
    this.walkTargetGfx = this.add.graphics().setDepth(9999);

    // Leaving the canvas sends no pointerout to objects — end every hover.
    this.input.on("gameout", () => {
      for (const c of this.fx.values()) c.onOut();
    });

    // 8. Click-to-walk
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return;
      this.handleClick(pointer.worldX, pointer.worldY);
    });

    // 9. Room label
    this.add
      .text(20, 16, `Preview: ${this.roomConfig.name}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setDepth(10000)
      .setScrollFactor(0);

    // 10. Fade in
    this.cameras.main.fadeIn(200, 0, 0, 0);

    // 11. Listen for editor updates
    EventBridge.on(EVENTS.EDITOR_ROOM_UPDATED, this.onRoomUpdated);

    // `once`: create() runs again on every restart. Closing the preview
    // destroys the game, which emits "destroy" but not "shutdown" — without
    // it the dead scene stayed subscribed and the next Refresh threw.
    const unsubscribe = () => {
      EventBridge.off(EVENTS.EDITOR_ROOM_UPDATED, this.onRoomUpdated);
      this.playerTween = null;
    };
    this.events.once("shutdown", unsubscribe);
    this.events.once("destroy", unsubscribe);
  }

  // ─── Room Background Layers (back / middle / front) ───────

  private static readonly LAYERS: ReadonlyArray<{
    field: "bgBackUrl" | "bgMiddleUrl" | "bgFrontUrl";
    keyPart: "back" | "middle" | "front";
    depth: number;
  }> = [
    { field: "bgBackUrl", keyPart: "back", depth: -30 },
    { field: "bgMiddleUrl", keyPart: "middle", depth: -20 },
    { field: "bgFrontUrl", keyPart: "front", depth: 8000 },
  ];

  private hasAnyLayerArt(): boolean {
    return PreviewScene.LAYERS.some((l) => !!this.roomConfig[l.field]);
  }

  // Texture keys include the image URL. The preview hot-reloads the SAME
  // room over and over while the owner edits it; keying by room/object id
  // alone meant a replaced background or sprite kept showing the first image
  // ever loaded under that id (or nothing, if that first load was still in
  // flight when the scene restarted) until the page was reloaded.
  private static textureKey(prefix: string, url: string): string {
    return `${prefix}|${url}`;
  }

  private bgKey(keyPart: string, url: string): string {
    return PreviewScene.textureKey(`room_bg_${keyPart}_${this.roomConfig.id}`, url);
  }

  private spriteKey(obj: RoomObject): string {
    return PreviewScene.textureKey(`sprite_${obj.id}`, objectArtUrl(obj) ?? "");
  }

  private loadRoomBackground() {
    for (const layer of PreviewScene.LAYERS) {
      const url = this.roomConfig[layer.field];
      if (!url) continue;
      const key = this.bgKey(layer.keyPart, url);
      if (this.textures.exists(key)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      const attach = () => {
        if (!this.sys?.isActive?.()) return;
        if (this.textures && !this.textures.exists(key)) {
          this.textures.addImage(key, img);
          // Also place the image now if drawRoom() already ran without it.
          const { width: W, height: H } = this.roomConfig;
          const bgImg = this.add.image(W / 2, H / 2, key);
          bgImg.setDisplaySize(W, H);
          bgImg.setDepth(layer.depth);
        }
      };
      img.onload = attach;
      img.onerror = () => {
        console.warn(`[PreviewScene] Failed to load ${layer.keyPart} bg: ${url}`);
      };
      img.src = url;
      if (img.complete && img.naturalWidth > 0) {
        if (!this.textures.exists(key)) this.textures.addImage(key, img);
        img.onload = null;
      }
    }
  }

  // ─── Room Drawing (matches BaseRoomScene.drawRoom) ────────

  private drawRoom() {
    const { width: W, height: H, backgroundColor } = this.roomConfig;

    this.cameras.main.setBackgroundColor(backgroundColor);

    if (!this.hasAnyLayerArt()) return;

    for (const layer of PreviewScene.LAYERS) {
      const url = this.roomConfig[layer.field];
      if (!url) continue;
      const key = this.bgKey(layer.keyPart, url);
      if (this.textures.exists(key)) {
        const bgImg = this.add.image(W / 2, H / 2, key);
        bgImg.setDisplaySize(W, H);
        bgImg.setDepth(layer.depth);
      }
    }
  }

  // ─── Sprite Loading ────────────────────────────────────────

  private loadObjectSprites() {
    for (const obj of this.roomConfig.objects) {
      // Own sprite, else the default starter drawing (null = invisible).
      const artUrl = objectArtUrl(obj);
      if (!artUrl) continue;
      const textureKey = this.spriteKey(obj);
      if (this.textures.exists(textureKey)) continue;
      const img = new Image();
      // CORS must be set BEFORE src, otherwise WebGL refuses to upload the
      // texture ("image element contains cross-origin data"). Supabase public
      // buckets reply with Access-Control-Allow-Origin: *.
      img.crossOrigin = "anonymous";
      const addIfAlive = () => {
        // Scene may have been shut down before the image finished loading.
        // Don't use `isActive()`: it's false while create() is still running,
        // which is exactly when an already-cached image lands here — the
        // texture was refused and the placeholder box stayed for good.
        const status = this.sys?.settings.status;
        if (
          status === undefined ||
          status === Phaser.Scenes.SHUTDOWN ||
          status === Phaser.Scenes.DESTROYED
        ) {
          return false;
        }
        if (!this.textures || this.textures.exists(textureKey)) return false;
        try {
          this.textures.addImage(textureKey, img);
          return true;
        } catch {
          // Swallow — scene likely torn down mid-frame.
          return false;
        }
      };
      img.onload = () => {
        // drawObjects() already ran and drew the procedural placeholder —
        // swap the real sprite in now that it has arrived. (Without this the
        // preview kept showing placeholder boxes for every remote sprite.)
        if (addIfAlive()) this.attachObjectSprite(obj);
      };
      img.onerror = () => {
        // Non-fatal: object will render as a colored rect instead.
        console.warn(`[PreviewScene] Failed to load sprite "${obj.id}": ${artUrl}`);
      };
      img.src = artUrl;
      if (img.complete && img.naturalWidth > 0 && addIfAlive()) {
        img.onload = null;
      }
    }
  }

  // Procedural placeholders drawn while a sprite is still loading, so the
  // late-arriving sprite can replace them (mirrors BaseRoomScene).
  private placeholders: Map<string, Phaser.GameObjects.GameObject[]> = new Map();

  // Hover effects + Easter eggs, same controller the live game uses.
  private fx: Map<string, ObjectFxController> = new Map();

  private fxFor(obj: RoomObject): ObjectFxController {
    let c = this.fx.get(obj.id);
    if (!c) {
      c = new ObjectFxController(this, obj, () => "en", this.roomConfig.id);
      this.fx.set(obj.id, c);
    }
    return c;
  }

  private attachObjectSprite(obj: RoomObject) {
    const textureKey = this.spriteKey(obj);
    if (!this.textures.exists(textureKey)) return;
    for (const go of this.placeholders.get(obj.id) ?? []) go.destroy();
    this.placeholders.delete(obj.id);
    this.drawObject(obj);
  }

  // ─── Objects (matches BaseRoomScene.drawObject) ───────────

  private drawObjects() {
    for (const obj of this.roomConfig.objects) {
      this.drawObject(obj);
    }
  }

  private drawObject(obj: RoomObject) {
    // Sprite rendering
    const textureKey = this.spriteKey(obj);
    const artUrl = objectArtUrl(obj);
    if (artUrl && this.textures.exists(textureKey)) {
      const sprite = this.add.image(
        obj.x + obj.width / 2,
        obj.y + obj.height / 2,
        textureKey
      );
      if (obj.spriteUrl) {
        sprite.setDisplaySize(obj.width, obj.height);
      } else {
        // Default starter drawing: fit without distortion, on the floor line.
        const src = sprite.texture.getSourceImage() as { width: number; height: number };
        const f = fitArt(obj, { w: src.width || obj.width, h: src.height || obj.height });
        sprite.setPosition(f.cx, f.cy).setDisplaySize(f.w, f.h);
      }
      if (obj.rotation) sprite.setAngle(obj.rotation);
      sprite.setDepth(obj.zIndex ?? obj.y);
      // Hover + Easter egg preview on the sprite itself.
      const ctl = this.fxFor(obj);
      ctl.attach(sprite);
      sprite.setInteractive({ useHandCursor: true });
      sprite.on("pointerover", () => ctl.onOver());
      sprite.on("pointerout", () => ctl.onOut());
      sprite.on("pointerup", () => ctl.onClick());
      return;
    }

    // Invisible hotspot, or a default drawing still loading: draw nothing
    // (same as the game).
    if (!artUrl || !obj.spriteUrl) {
      this.placeholders.set(obj.id, []);
      return;
    }

    // Procedural fallback while an own sprite loads
    const gfx = this.add.graphics();
    const drawn: Phaser.GameObjects.GameObject[] = [gfx];
    this.placeholders.set(obj.id, drawn);

    if (obj.type === "door") {
      gfx.fillStyle(0x6b4226);
      gfx.fillRoundedRect(obj.x, obj.y, obj.width, obj.height, 6);
      gfx.fillStyle(0xd4a017);
      gfx.fillCircle(obj.x + obj.width * 0.8, obj.y + obj.height * 0.55, 5);

      const label = this.add
        .text(obj.x + obj.width / 2, obj.y - 8, obj.label, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#FFFFFF",
          stroke: "#000000",
          strokeThickness: 2,
          align: "center",
        })
        .setOrigin(0.5, 1)
        .setDepth(obj.zIndex ?? obj.y + obj.height);
      drawn.push(label);
    } else {
      gfx.fillStyle(0x5f9ea0);
      gfx.fillRoundedRect(obj.x, obj.y, obj.width, obj.height, 8);
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      gfx.fillStyle(0xffa500);
      gfx.fillTriangle(cx, cy - 8, cx + 6, cy, cx, cy + 8);
      gfx.fillTriangle(cx, cy - 8, cx - 6, cy, cx, cy + 8);
    }

    gfx.setDepth(obj.zIndex ?? obj.y);
  }

  // ─── Walkable Area Overlay ────────────────────────────────

  private drawWalkableArea() {
    const polygon = this.roomConfig.walkableArea.polygon;
    if (polygon.length < 3) return;

    const gfx = this.add.graphics();
    gfx.fillStyle(0x00ff00, 0.08);
    gfx.lineStyle(2, 0x00ff00, 0.4);

    gfx.beginPath();
    gfx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      gfx.lineTo(polygon[i].x, polygon[i].y);
    }
    gfx.closePath();
    gfx.fillPath();
    gfx.strokePath();
    gfx.setDepth(9990);
  }

  // ─── Entry Points ────────────────────────────────────────

  private drawEntryPoints() {
    for (const ep of this.roomConfig.entryPoints) {
      const gfx = this.add.graphics();

      // Marker circle
      gfx.fillStyle(0x3b82f6, 0.6);
      gfx.fillCircle(ep.x, ep.y, 10);
      gfx.lineStyle(2, 0x3b82f6, 0.9);
      gfx.strokeCircle(ep.x, ep.y, 10);

      // Direction arrow
      const arrowDir = ep.direction === "right" ? 1 : -1;
      gfx.fillStyle(0xffffff, 0.8);
      gfx.fillTriangle(
        ep.x + arrowDir * 16,
        ep.y,
        ep.x + arrowDir * 8,
        ep.y - 5,
        ep.x + arrowDir * 8,
        ep.y + 5
      );

      // Label
      this.add
        .text(ep.x, ep.y - 18, ep.id, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          color: "#93C5FD",
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(9995);

      gfx.setDepth(9995);
    }
  }

  // ─── Click-to-Walk ────────────────────────────────────────

  private handleClick(x: number, y: number) {
    if (!this.player) return;

    const polygon = this.roomConfig.walkableArea.polygon;
    const playerPos = { x: this.player.x, y: this.player.y };

    const path = getPath(
      playerPos,
      { x, y },
      polygon,
      this.roomConfig.width,
      this.roomConfig.height
    );
    if (!path) return;

    // Cancel existing tween
    if (this.playerTween) {
      this.playerTween.stop();
      this.playerTween = null;
    }

    this.playerDirection = directionToString(path.direction);
    playWalkAnim(this.player, this.playerDirection);

    // Walk target indicator
    this.walkTargetGfx.clear();
    this.walkTargetGfx.lineStyle(2, 0xffffff, 0.5);
    this.walkTargetGfx.strokeCircle(path.target.x, path.target.y, 12);

    this.playerTween = this.tweens.add({
      targets: this.player,
      x: path.target.x,
      y: path.target.y,
      duration: path.duration,
      ease: "Linear",
      onUpdate: () => {
        this.player.setDepth(this.player.y);
      },
      onComplete: () => {
        this.playerTween = null;
        playIdleFrame(this.player, this.playerDirection);
        this.walkTargetGfx.clear();
      },
    });
  }

  // ─── Hot-Reload ───────────────────────────────────────────

  private onRoomUpdated = (config: unknown) => {
    const newConfig = config as RoomConfig;
    // Only reload if it's the same room we're previewing
    if (newConfig.id === this.roomConfig.id) {
      this.scene.restart({ roomConfig: newConfig });
    }
  };
}
