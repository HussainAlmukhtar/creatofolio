// BaseRoomScene — abstract Phaser Scene that all 8 room scenes extend.
//
// Handles:
//  - Procedural room drawing (walls, floor, perspective)
//  - Player spawning at correct entry point
//  - Click/tap-to-walk movement via PathEngine
//  - Interactive object rendering and click detection
//  - Object steps ("When clicked…" / "When the player walks near…") through
//    ActionRunner; steps needing the page go to React via EVENTS.ACTION_UI
//  - Room transitions (fade out → start new scene → fade in)
//  - Depth sorting (depth = y)
//  - EventBridge communication with React
//
// Reference: the room / player structure follows Yukon's room scene pattern.

import Phaser from "phaser";
import type { RoomConfig, RoomObject, Point, ObjectAction, Trigger } from "@/data/roomTypes";
import { categoryNumber } from "@/lib/templateCategories";
import { getPath, findSafeSpawn, directionToString } from "../systems/PathEngine";
import {
  createPlayerSprite,
  playWalkAnim,
  playIdleFrame,
  registerAvatarTexture,
} from "../systems/AvatarTexture";
import { EventBridge, EVENTS } from "../EventBridge";
import { ObjectFxController, floatNotice } from "../systems/ObjectFx";
import { objectArtUrl, fitArt } from "@/data/starterElements";
import type { AvatarConfig } from "@/data/avatarTypes";
import { ActionRunner, chainTakesOver } from "../systems/ActionRunner";
import { markOnce, onceUsed } from "../systems/onceFlags";
import { requestActionUi, type ActionStepLog, type PopupStop } from "../actionUi";
import {
  clickTriggerOf,
  downloadHref,
  mailtoHref,
  nearTriggerOf,
  objectByIid,
  onceKey,
  popupSequence,
  roomByIid,
  soundSrc,
  walkTargetOf,
  type TriggerName,
} from "@/lib/objectActions";
import { safeHref } from "@/lib/safeUrl";
import { createRoomNameTag, roomNameTagVisible } from "../systems/RoomNameTag";

interface SceneData {
  entryFrom?: string;
}

/**
 * Returns the object's hitbox polygon in world coordinates, respecting its
 * rotation and custom polygon (if any). If the object has no custom polygon,
 * the 4 corners of its axis-aligned rectangle are used.
 */
function getObjectWorldHitPolygon(obj: RoomObject): Point[] {
  const localPoly: Point[] = obj.hitboxPolygon ?? [
    { x: 0, y: 0 },
    { x: obj.width, y: 0 },
    { x: obj.width, y: obj.height },
    { x: 0, y: obj.height },
  ];
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const rad = ((obj.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return localPoly.map((p) => {
    const lx = p.x - obj.width / 2;
    const ly = p.y - obj.height / 2;
    return {
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    };
  });
}

export default abstract class BaseRoomScene extends Phaser.Scene {
  protected roomConfig!: RoomConfig;
  protected player!: Phaser.GameObjects.Sprite;
  protected playerDirection: "left" | "right" = "right";
  protected playerTween: Phaser.Tweens.Tween | null = null;
  protected walkTargetIndicator!: Phaser.GameObjects.Graphics;

  // Interactive objects — Phaser zones overlaying each RoomObject
  protected objectZones: Map<string, Phaser.GameObjects.Zone> = new Map();

  // Procedural placeholder graphics / labels drawn per object while its
  // remote sprite texture is still loading. Tracked so we can destroy
  // them when the async image arrives and swap in the real sprite.
  protected proceduralPlaceholders: Map<
    string,
    Phaser.GameObjects.GameObject[]
  > = new Map();

  // Hover / secret / Easter-egg controllers, one per object per visit.
  protected objectFx: Map<string, ObjectFxController> = new Map();

  // Pending interaction: player walks to an object, then this fires
  private pendingInteraction: RoomObject | null = null;

  // Runs object steps, one chain at a time (a new chain cancels the old).
  private runner = new ActionRunner();

  // "Walks near" zones the player is currently inside (by object id). A zone
  // fires on entering and re-arms only after leaving radius × NEAR_EXIT.
  private nearInside: Map<string, boolean> = new Map();
  private nearClock = 0;

  // Is the room currently transitioning out?
  private isLeaving = false;

  // Is a React UI modal open? (disables all game input)
  private uiModalOpen = false;

  // Has the landing page left play mode? (PLAY_MODE_EXIT). While true the
  // scene is an ambient preview: it keeps rendering but ignores pointer
  // input. Defaults to false (permissive) — the admin editor preview never
  // emits PLAY_MODE events, and on the landing page scroll-mode input is
  // already blocked at the DOM level (pointer-events: none on the mount).
  private ambientMode = false;

  constructor(key: string, roomConfig: RoomConfig) {
    super({ key });
    this.roomConfig = roomConfig;
  }

  create(data: SceneData) {
    this.isLeaving = false;
    this.pendingInteraction = null;
    this.runner.cancel();
    this.nearInside.clear();
    this.nearClock = 0;
    this.objectZones.clear();
    this.proceduralPlaceholders.clear();
    for (const c of this.objectFx.values()) c.destroy();
    this.objectFx.clear();

    // 0a. Apply live room config from the registry. PhaserGame preloads
    // all configs from Supabase before starting the game and stashes them
    // under "roomConfigs"; this lets scenes keep their constructor-time
    // static default (for offline / first-paint safety) while still
    // reflecting the admin editor's latest saved state when it exists.
    // Scene restarts (room transitions) also pick up any newer config
    // pushed into the registry since last mount.
    const liveConfigs = this.registry.get("roomConfigs") as
      | Record<string, RoomConfig>
      | undefined;
    if (liveConfigs && liveConfigs[this.roomConfig.id]) {
      this.roomConfig = liveConfigs[this.roomConfig.id];
    }

    // 0b. Load textures from the (possibly freshly-overridden) config
    this.loadObjectSprites();
    this.loadRoomLayers();

    // 1. Draw the room (procedural fallback — skipped when any art layer set)
    this.drawRoom();

    // 2. Draw interactive objects
    this.createInteractiveObjects();

    // 2b. Animated foreground effect (rain/snow/cctv), if configured
    this.createForegroundEffect();

    // 3. Spawn player at the correct entry point
    const entryFrom = data?.entryFrom || "default";
    const entryPoint =
      this.roomConfig.entryPoints.find((ep) => ep.id === entryFrom) ||
      this.roomConfig.entryPoints[0];

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

    // Objects that start hidden (until a "Show / hide" step shows them).
    for (const obj of this.roomConfig.objects) {
      if (obj.hiddenAtStart) this.setObjectHidden(obj, true);
    }
    // Near zones the player spawns inside start "inside": they must be left
    // first, so nothing fires on arrival.
    this.syncNearZones(false);

    // Camera: follow + bounds
    this.cameras.main.setBounds(0, 0, this.roomConfig.width, this.roomConfig.height);
    // HiDPI: PhaserGame sizes the backing store at 1520×960 × hiDpiScale (for
    // crispness when the arcade camera zooms the canvas) but the room is laid
    // out in logical 1520×960. Zoom the camera by the same factor, from the
    // canvas centre, so the room fills the canvas exactly (without this, any
    // hiDpiScale > 1 — phones, retina — drew the room into the top-left
    // ~80% of the screen). Camera-pinned UI must be placed via uiPoint().
    const hiDpi = this.scale.width / this.roomConfig.width;
    if (hiDpi > 1.001) this.cameras.main.setZoom(hiDpi);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // 4. Walk target indicator (subtle circle on click)
    this.walkTargetIndicator = this.add.graphics();
    this.walkTargetIndicator.setDepth(9999);

    // Leaving the canvas sends no pointerout to objects — end every hover
    // (or a revealed secret / wiggle stays on until the pointer returns).
    this.input.on("gameout", () => {
      for (const c of this.objectFx.values()) c.onOut();
    });

    // 5. Input: click/tap anywhere
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return; // left click only
      if (!this.isPointerOnCanvas(pointer)) return;
      if (this.isLeaving) return;
      if (this.uiModalOpen) return;
      if (this.ambientMode) return;
      this.handleClick(pointer.worldX, pointer.worldY);
    });

    // 6. Room name tag (paper tag; the room or the world can hide it)
    if (roomNameTagVisible(this.roomConfig, this.registry.get("roomNameTags") !== false)) {
      createRoomNameTag(this, this.roomConfig, this.lang, (x, y) => this.uiPoint(x, y));
    }

    // 7. Fade in
    this.cameras.main.fadeIn(400, 0, 0, 0);

    // 8. Listen for avatar updates from React
    EventBridge.on(EVENTS.AVATAR_UPDATED, this.onAvatarUpdated);

    // 9. Listen for room navigation from mini-map
    EventBridge.on(EVENTS.NAVIGATE_TO_ROOM, this.onNavigateToRoom);

    // 10. Listen for UI modal state (disable game input when modal is open)
    EventBridge.on(EVENTS.UI_MODAL, this.onUIModal);

    // 10b. Landing play-mode gate — freeze the avatar and ignore input
    // while the cabinet is an ambient scroll-mode preview.
    EventBridge.on(EVENTS.PLAY_MODE_ENTER, this.onPlayModeEnter);
    EventBridge.on(EVENTS.PLAY_MODE_EXIT, this.onPlayModeExit);

    // 11. Tell React which room we're in
    EventBridge.emit(EVENTS.ROOM_CHANGED, this.roomConfig.id);

    // Cleanup on scene shutdown. `once`, not `on` — `create()` reruns every
    // time this room is re-entered (Phaser reuses the scene instance), so
    // an `.on` registration here would accumulate one extra shutdown
    // listener per visit forever (confirmed: 14 stacked listeners on one
    // scene after normal play-session navigation).
    this.events.once("shutdown", () => {
      this.runner.cancel();
      EventBridge.off(EVENTS.AVATAR_UPDATED, this.onAvatarUpdated);
      EventBridge.off(EVENTS.NAVIGATE_TO_ROOM, this.onNavigateToRoom);
      EventBridge.off(EVENTS.UI_MODAL, this.onUIModal);
      EventBridge.off(EVENTS.PLAY_MODE_ENTER, this.onPlayModeEnter);
      EventBridge.off(EVENTS.PLAY_MODE_EXIT, this.onPlayModeExit);
    });
  }

  // ─── Sprite Loading ─────────────────────────────────────────

  /**
   * Texture key for an object's sprite. Keyed by URL, not object id:
   * Phaser's texture cache is game-wide, and object ids are only unique
   * within a room — two rooms with a "plant" object used to share whichever
   * image loaded first (and a replaced sprite never showed until reload).
   */
  private spriteKey(obj: RoomObject): string {
    return `sprite|${objectArtUrl(obj) ?? ""}`;
  }

  /**
   * Put an object's art on screen. Its own sprite fills the object box (as
   * authored); a default starter drawing (no sprite) is fitted inside the box
   * without distortion, standing on the box's bottom edge.
   */
  private placeArt(obj: RoomObject, textureKey: string): Phaser.GameObjects.Image {
    const sprite = this.add.image(obj.x + obj.width / 2, obj.y + obj.height / 2, textureKey);
    if (obj.spriteUrl) {
      sprite.setDisplaySize(obj.width, obj.height);
    } else {
      const src = sprite.texture.getSourceImage() as { width: number; height: number };
      const f = fitArt(obj, { w: src.width || obj.width, h: src.height || obj.height });
      sprite.setPosition(f.cx, f.cy).setDisplaySize(f.w, f.h);
    }
    if (obj.rotation) sprite.setAngle(obj.rotation);
    sprite.setDepth(obj.zIndex ?? obj.y);
    return sprite;
  }

  private fxFor(obj: RoomObject): ObjectFxController {
    let c = this.objectFx.get(obj.id);
    if (!c) {
      c = new ObjectFxController(
        this,
        obj,
        () => (this.registry.get("language") === "ar" ? "ar" : "en"),
        this.roomConfig.id
      );
      this.objectFx.set(obj.id, c);
    }
    return c;
  }

  private loadObjectSprites() {
    for (const obj of this.roomConfig.objects) {
      // Own sprite, else the default starter drawing (null = invisible).
      const artUrl = objectArtUrl(obj);
      if (!artUrl) continue;
      const textureKey = this.spriteKey(obj);
      // Skip if already loaded (e.g. from a previous scene create)
      if (this.textures.exists(textureKey)) continue;

      const img = new Image();
      // Required for WebGL texture upload without tainting — Supabase
      // public storage sends the matching CORS headers.
      img.crossOrigin = "anonymous";

      img.onload = () => {
        if (!this.textures || !this.sys?.isActive?.()) return;
        if (!this.textures.exists(textureKey)) {
          this.textures.addImage(textureKey, img);
        }
        // drawObject has already rendered a procedural placeholder for this
        // object (teal rect or door). Swap it out for the real sprite now
        // that the texture has arrived.
        this.attachObjectSprite(obj);
      };
      img.onerror = () => {
        console.warn(
          `[BaseRoomScene] Failed to load sprite for "${obj.id}": ${artUrl}`
        );
      };
      img.src = artUrl;

      // Data URLs (and some cached remotes) may be complete synchronously.
      // Add the texture now so drawObject's sync path renders the sprite
      // directly — no placeholder needed, and no onload swap.
      if (img.complete && img.naturalWidth > 0) {
        if (!this.textures.exists(textureKey)) {
          this.textures.addImage(textureKey, img);
        }
        img.onload = null;
      }
    }
  }

  /**
   * Called from loadObjectSprites's onload handler once a remote sprite
   * texture finishes loading after drawObject has already rendered the
   * procedural placeholder. Destroys the placeholder's tracked graphics /
   * label and replaces them with the real sprite game object at the
   * object's transform.
   */
  private attachObjectSprite(obj: RoomObject) {
    const textureKey = this.spriteKey(obj);
    if (!this.textures.exists(textureKey)) return;
    const placeholders = this.proceduralPlaceholders.get(obj.id);
    if (placeholders) {
      for (const go of placeholders) go.destroy();
      this.proceduralPlaceholders.delete(obj.id);
    }
    const sprite = this.placeArt(obj, textureKey);
    if (obj.showLabel) {
      this.renderObjectLabel(obj, []); // re-create; was destroyed with placeholder
    }
    this.fxFor(obj).attach(sprite);
  }

  // ─── Room Background Layers (back / middle / front) ─────────

  /**
   * Layer slots composed back-to-front around the gameplay layer:
   *   back    → distant scenery (sky, sea)
   *   middle  → the room itself (walls, floor, fixtures)
   *   front   → overlay above the player (CCTV frame, vignette)
   *
   * Depths are spaced so doors/objects (depth = y, 0..ROOM_HEIGHT) and
   * effect particles (depth 8500/10500) sit cleanly between them.
   */
  private static readonly LAYERS: ReadonlyArray<{
    field: "bgBackUrl" | "bgMiddleUrl" | "bgFrontUrl";
    keyPart: "back" | "middle" | "front";
    depth: number;
  }> = [
    { field: "bgBackUrl", keyPart: "back", depth: -30 },
    { field: "bgMiddleUrl", keyPart: "middle", depth: -20 },
    { field: "bgFrontUrl", keyPart: "front", depth: 8000 },
  ];

  /** True iff *any* art layer URL is set on this room. */
  protected hasAnyLayerArt(): boolean {
    return BaseRoomScene.LAYERS.some((l) => !!this.roomConfig[l.field]);
  }

  private loadRoomLayers() {
    for (const layer of BaseRoomScene.LAYERS) {
      this.loadOneLayer(layer.field, layer.keyPart, layer.depth);
    }
  }

  private loadOneLayer(
    field: "bgBackUrl" | "bgMiddleUrl" | "bgFrontUrl",
    keyPart: "back" | "middle" | "front",
    depth: number
  ) {
    const url = this.roomConfig[field];
    if (!url) return;
    const key = `room_bg_${keyPart}_${this.roomConfig.id}`;
    if (this.textures.exists(key)) return;

    const img = new Image();
    img.crossOrigin = "anonymous";

    const attach = () => {
      if (!this.sys?.isActive?.()) return;
      if (!this.textures.exists(key)) this.textures.addImage(key, img);
      const { width: W, height: H } = this.roomConfig;
      const bgImg = this.add.image(W / 2, H / 2, key);
      bgImg.setDisplaySize(W, H);
      bgImg.setDepth(depth);
    };

    img.onload = attach;
    img.onerror = () => {
      console.warn(
        `[BaseRoomScene] Failed to load ${keyPart} bg for room "${this.roomConfig.id}": ${url}`
      );
    };
    img.src = url;

    // Cached / data URLs may complete synchronously — register the texture
    // so drawRoom()'s sync path picks it up on the next line.
    if (img.complete && img.naturalWidth > 0) {
      if (!this.textures.exists(key)) this.textures.addImage(key, img);
      img.onload = null;
    }
  }

  // ─── Room Drawing ──────────────────────────────────────────
  //
  protected drawRoom() {
    const { width: W, height: H, backgroundColor } = this.roomConfig;

    // Always paint the camera background — fills any transparent pixels in
    // the user's layer art, and is the *only* paint when no art is set yet
    // (matches LDtk's empty-level behaviour: a flat bgColor fill).
    this.cameras.main.setBackgroundColor(backgroundColor);

    if (!this.hasAnyLayerArt()) return;

    for (const layer of BaseRoomScene.LAYERS) {
      if (!this.roomConfig[layer.field]) continue;
      const key = `room_bg_${layer.keyPart}_${this.roomConfig.id}`;
      if (this.textures.exists(key)) {
        const bgImg = this.add.image(W / 2, H / 2, key);
        bgImg.setDisplaySize(W, H);
        bgImg.setDepth(layer.depth);
      }
    }
  }

  /**
   * Where to put a scroll-factor-0 (camera-pinned) object so it shows at
   * logical (x, y) of the 1520×960 room view. The HiDPI camera zoom scales
   * pinned objects around the canvas centre, so invert that.
   */
  protected uiPoint(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    return {
      x: (x * z - cam.width / 2) / z + cam.width / 2,
      y: (y * z - cam.height / 2) / z + cam.height / 2,
    };
  }

  // ─── Foreground Effect (rain / snow / cctv) ────────────────

  private createForegroundEffect() {
    const fx = this.roomConfig.foregroundEffect;
    if (!fx) return;
    const depth = this.roomConfig.foregroundEffectAboveUI ? 10500 : 8500;
    const cam = this.cameras.main;
    const { width: VW, height: VH } = cam;

    if (fx === "rain" || fx === "snow") {
      // Use a 1×1 white pixel as the particle texture so we don't depend on
      // any preloaded asset. Generated lazily and cached on the texture
      // manager so repeated room visits don't pile up.
      const pxKey = "fx_pixel_white";
      if (!this.textures.exists(pxKey)) {
        const c = this.textures.createCanvas(pxKey, 2, 2);
        if (c) {
          c.context.fillStyle = "#ffffff";
          c.context.fillRect(0, 0, 2, 2);
          c.refresh();
        }
      }
      const isRain = fx === "rain";
      const emitter = this.add.particles(0, 0, pxKey, {
        x: { min: 0, max: VW },
        y: -10,
        lifespan: isRain ? 1100 : 4500,
        speedY: isRain ? { min: 900, max: 1200 } : { min: 60, max: 140 },
        speedX: isRain ? { min: -40, max: -20 } : { min: -30, max: 30 },
        scale: isRain
          ? { start: 1.2, end: 1.2 }
          : { start: 2.5, end: 2.5 },
        alpha: isRain ? { start: 0.35, end: 0.35 } : { start: 0.85, end: 0.85 },
        quantity: isRain ? 4 : 1,
        frequency: isRain ? 25 : 80,
        blendMode: isRain ? "ADD" : "NORMAL",
      });
      emitter.setDepth(depth);
      emitter.setScrollFactor(0);
      // Cover the whole viewport even when the camera scrolls within the room.
      emitter.setPosition(0, 0);
      // Keep emitter region in sync with camera viewport (cheap; runs each
      // frame). Removed on shutdown — scene `events` persist across
      // restarts, so an anonymous un-removed listener would stack one copy
      // per room visit.
      const syncEmitterToCamera = () => {
        emitter.setPosition(cam.scrollX, cam.scrollY);
      };
      this.events.on("update", syncEmitterToCamera);
      this.events.once("shutdown", () => {
        this.events.off("update", syncEmitterToCamera);
      });
      return;
    }

    if (fx === "cctv") {
      // Lightweight CCTV look: tinted vignette + scanlines drawn to a graphics
      // object pinned to the camera. A real shader pipeline (Phaser FX) is a
      // future upgrade — this gets the visual hook in place today.
      const gfx = this.add.graphics();
      gfx.setScrollFactor(0);
      gfx.setDepth(depth);
      // Greenish wash
      gfx.fillStyle(0x00ff66, 0.06);
      gfx.fillRect(0, 0, VW, VH);
      // Scanlines
      gfx.fillStyle(0x000000, 0.18);
      for (let y = 0; y < VH; y += 4) gfx.fillRect(0, y, VW, 1);
      // Corner vignette frame
      gfx.lineStyle(8, 0x000000, 0.5);
      gfx.strokeRect(4, 4, VW - 8, VH - 8);
    }
  }

  // ─── Interactive Objects ────────────────────────────────────

  private createInteractiveObjects() {
    for (const obj of this.roomConfig.objects) {
      // Draw the object visually (procedural)
      this.drawObject(obj);

      // Compute world-space hit polygon (respects rotation + custom polygon).
      const worldHitPoly = getObjectWorldHitPolygon(obj);
      // Depth anchor = max Y of the footprint, not raw y + height (which is
      // wrong once the object is rotated or has a custom polygon).
      const depthAnchor =
        obj.zIndex ?? Math.max(...worldHitPoly.map((p) => p.y));

      // Size the zone to the hit polygon's axis-aligned bounding box, with
      // its top-left at the bbox origin. Force origin (0, 0) so that Phaser's
      // hitAreaCallback receives local coordinates ranging from (0, 0) to
      // (zoneW, zoneH) — matching how we build the polygon.
      const minX = Math.min(...worldHitPoly.map((p) => p.x));
      const maxX = Math.max(...worldHitPoly.map((p) => p.x));
      const minY = Math.min(...worldHitPoly.map((p) => p.y));
      const maxY = Math.max(...worldHitPoly.map((p) => p.y));
      const zoneW = Math.max(1, maxX - minX);
      const zoneH = Math.max(1, maxY - minY);
      const zone = this.add.zone(minX, minY, zoneW, zoneH);
      zone.setOrigin(0, 0);
      const localPolyPoints = worldHitPoly.flatMap((p) => [
        p.x - minX,
        p.y - minY,
      ]);
      const hitPolygon = new Phaser.Geom.Polygon(localPolyPoints);
      zone.setInteractive({
        useHandCursor: true,
        hitArea: hitPolygon,
        hitAreaCallback: Phaser.Geom.Polygon.Contains,
      });
      zone.setData("roomObject", obj);
      zone.setDepth(depthAnchor);

      // Hover → effect, name tag, secret reveal, hover Easter egg.
      zone.on("pointerover", () => {
        if (this.uiModalOpen || this.ambientMode || this.isLeaving) return;
        if (this.fxFor(obj).isHidden) return;
        this.fxFor(obj).onOver();
      });
      zone.on("pointerout", () => this.fxFor(obj).onOut());

      // Click on object → walk to it, then interact
      zone.on("pointerup", (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        if (pointer.button !== 0) return;
        if (!this.isPointerOnCanvas(pointer)) return;
        if (this.isLeaving) return;
        if (this.uiModalOpen) return;
        if (this.ambientMode) return;
        // Stop the event from also triggering the scene-level pointerup,
        // which would override the walk target with the raw click position.
        event.stopPropagation();
        // A hidden object ("Show / hide" step) is just floor.
        if (this.fxFor(obj).isHidden) {
          this.handleClick(pointer.worldX, pointer.worldY);
          return;
        }
        this.fxFor(obj).onClick();
        if (!this.hasLiveTrigger(obj, "click")) {
          // Decoration (no steps, or a once-only click already used):
          // behave like a floor click (walk toward the spot).
          this.handleClick(pointer.worldX, pointer.worldY);
          return;
        }
        this.handleObjectClick(obj);
      });

      this.objectZones.set(obj.id, zone);
    }
  }

  private renderObjectLabel(
    obj: RoomObject,
    tracked: Phaser.GameObjects.GameObject[]
  ) {
    const lang = this.registry.get("language") || "en";
    const label = lang === "ar" ? obj.labelAr : obj.label;
    const labelText = this.add
      .text(obj.x + obj.width / 2, obj.y - 8, label, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#FFFFFF",
        stroke: "#000000",
        strokeThickness: 2,
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(obj.zIndex ?? obj.y + obj.height);
    tracked.push(labelText);
  }

  protected drawObject(obj: RoomObject) {
    // Render the art (own sprite or default drawing) if it's loaded.
    const textureKey = this.spriteKey(obj);
    const artUrl = objectArtUrl(obj);
    if (artUrl && this.textures.exists(textureKey)) {
      const sprite = this.placeArt(obj, textureKey);
      if (obj.showLabel) {
        this.renderObjectLabel(obj, []); // untracked — persists with the sprite
      }
      this.fxFor(obj).attach(sprite);
      return;
    }

    // Invisible hotspot (painted into the background): nothing to draw.
    // Default drawing still loading: draw nothing (it's a local file and
    // arrives in a frame) — the old coloured box would just flash.
    if (!artUrl || !obj.spriteUrl) {
      const tracked: Phaser.GameObjects.GameObject[] = [];
      if (obj.showLabel) this.renderObjectLabel(obj, tracked);
      if (artUrl) this.proceduralPlaceholders.set(obj.id, tracked);
      this.fxFor(obj).attach(null, tracked);
      return;
    }

    // Procedural fallback. Track each created game object in the
    // placeholder map so attachObjectSprite() can destroy them when the
    // async texture load completes (for objects with a remote spriteUrl).
    const tracked: Phaser.GameObjects.GameObject[] = [];
    const gfx = this.add.graphics();
    tracked.push(gfx);

    // Tint placeholders by template category so a busy room is scannable.
    // Falls back to the legacy hard-coded color when category is missing,
    // which preserves existing rooms' look until objects get re-saved.
    const categoryFill = obj.category ? categoryNumber(obj.category) : null;

    if (obj.type === "door") {
      // Door: brown rectangle with doorknob (or category-tinted if set).
      // Stairs used to render the same way; 7c collapsed them into doors.
      gfx.fillStyle(categoryFill ?? 0x6b4226);
      gfx.fillRoundedRect(obj.x, obj.y, obj.width, obj.height, 6);
      // Doorknob
      gfx.fillStyle(0xd4a017);
      gfx.fillCircle(
        obj.x + obj.width * 0.8,
        obj.y + obj.height * 0.55,
        5
      );
    } else {
      // Generic interactive object: teal rectangle with sparkle (or
      // category-tinted if the object came from a template).
      gfx.fillStyle(categoryFill ?? 0x5f9ea0);
      gfx.fillRoundedRect(obj.x, obj.y, obj.width, obj.height, 8);
      // Sparkle indicator
      const sparkleX = obj.x + obj.width / 2;
      const sparkleY = obj.y + obj.height / 2;
      gfx.fillStyle(0xffa500);
      // Draw a small diamond/sparkle indicator
      gfx.fillTriangle(
        sparkleX, sparkleY - 8,
        sparkleX + 6, sparkleY,
        sparkleX, sparkleY + 8
      );
      gfx.fillTriangle(
        sparkleX, sparkleY - 8,
        sparkleX - 6, sparkleY,
        sparkleX, sparkleY + 8
      );
    }

    gfx.setDepth(obj.zIndex ?? obj.y);

    if (obj.showLabel) {
      this.renderObjectLabel(obj, tracked); // in tracked so it's cleaned up with placeholder
    }

    // Only record the placeholder for objects that have a sprite URL
    // still loading — an object without a sprite keeps the procedural
    // look permanently.
    if (obj.spriteUrl) {
      this.proceduralPlaceholders.set(obj.id, tracked);
    }
    this.fxFor(obj).attach(null, tracked);
  }

  // ─── Click Handling ─────────────────────────────────────────

  /**
   * Phaser's InputManager also listens on `window` (not just the canvas) so
   * a drag started on the canvas still ends cleanly if released elsewhere.
   * That means ANY pointerup on the page — including a click that natively
   * targeted a completely unrelated DOM element, like the landing page's
   * "Play" button that sits over this same screen region — reaches this
   * handler too, with `pointer.worldX/Y` computed as if it were a real
   * canvas click. Confirmed live: clicking Play over a door fired this
   * scene's interaction BEFORE the click's own onClick handler (and its
   * UI_MODAL freeze) even ran, because native `pointerup` always precedes
   * the synthesized `click` event — no amount of freezing on `click` can
   * beat that ordering. Checking the event's real target is the actual
   * fix: it filters out every pointerup that didn't originate on this
   * game's own canvas, regardless of timing.
   */
  private isPointerOnCanvas(pointer: Phaser.Input.Pointer): boolean {
    const target = pointer.event?.target;
    return target === this.sys.game.canvas;
  }

  private handleClick(x: number, y: number) {
    this.pendingInteraction = null;
    this.walkTo({ x, y });
  }

  private handleObjectClick(obj: RoomObject) {
    // No steps = pure decoration: the zone handler already walked there.
    if (!this.hasLiveTrigger(obj, "click")) return;
    // A new click stops whatever the last one was still doing (a wait…).
    this.runner.cancel();
    this.pendingInteraction = obj;
    this.walkTo(this.walkTargetOf(obj), () => {
      if (this.pendingInteraction !== obj) return;
      this.pendingInteraction = null;
      this.runTrigger(obj, "click");
    });
  }

  /** Where the player stands to use an object (moveTo, else the floor below it). */
  private walkTargetOf(obj: RoomObject): Point {
    return walkTargetOf(obj, this.roomConfig);
  }

  private walkTo(target: Point, onComplete?: () => void) {
    const polygon = this.roomConfig.walkableArea.polygon;
    const playerPos = { x: this.player.x, y: this.player.y };

    const path = getPath(playerPos, target, polygon, this.roomConfig.width, this.roomConfig.height);
    if (!path) {
      // Already close enough
      onComplete?.();
      return;
    }

    // Cancel existing tween
    if (this.playerTween) {
      this.playerTween.stop();
      this.playerTween = null;
    }

    // Determine facing direction
    this.playerDirection = directionToString(path.direction);

    // Play walk animation
    playWalkAnim(this.player, this.playerDirection);

    // Show click indicator
    this.showWalkTarget(path.target);

    // Tween to destination (Yukon pattern: addMoveTween)
    this.playerTween = this.tweens.add({
      targets: this.player,
      x: path.target.x,
      y: path.target.y,
      duration: path.duration,
      ease: "Linear",
      onUpdate: () => {
        // Depth sorting: depth = y
        this.player.setDepth(this.player.y);
      },
      onComplete: () => {
        this.playerTween = null;
        playIdleFrame(this.player, this.playerDirection);
        this.walkTargetIndicator.clear();
        onComplete?.();
      },
    });
  }

  private showWalkTarget(target: Point) {
    this.walkTargetIndicator.clear();
    this.walkTargetIndicator.lineStyle(2, 0xffffff, 0.5);
    this.walkTargetIndicator.strokeCircle(target.x, target.y, 12);
  }

  // ─── Interactions ──────────────────────────────────────────

  // ─── Steps ─────────────────────────────────────────────────

  private triggerOf(obj: RoomObject, name: TriggerName): Trigger | null {
    return name === "click" ? clickTriggerOf(obj) : nearTriggerOf(obj);
  }

  private get harness(): boolean {
    return this.registry.get("harness") === true;
  }

  /** Has steps, and isn't a once-only trigger that already ran. */
  private hasLiveTrigger(obj: RoomObject, name: TriggerName): boolean {
    const t = this.triggerOf(obj, name);
    if (!t || !t.actions.length) return false;
    return !onceUsed(onceKey(this.roomConfig, obj, name), t.once, this.harness);
  }

  /** Run an object's click / near steps (once-only flags marked up front). */
  private runTrigger(obj: RoomObject, name: TriggerName) {
    if (this.isLeaving) return;
    const t = this.triggerOf(obj, name);
    if (!t || !t.actions.length) return;
    const key = onceKey(this.roomConfig, obj, name);
    if (onceUsed(key, t.once, this.harness)) return;
    markOnce(key, t.once, this.harness);
    void this.runner.run(t.actions, (step, alive) => this.performStep(step, obj, name, alive));
  }

  private log(obj: RoomObject, trigger: TriggerName, kind: string, detail?: string) {
    const entry: ActionStepLog = { roomId: this.roomConfig.id, objectId: obj.id, trigger, kind, detail };
    EventBridge.emit(EVENTS.ACTION_STEP, entry);
  }

  private get lang(): "en" | "ar" {
    return this.registry.get("language") === "ar" ? "ar" : "en";
  }

  private notice(text: string) {
    const p = this.player;
    floatNotice(this, p?.x ?? this.roomConfig.width / 2, (p?.y ?? this.roomConfig.height / 2) - 90, text);
  }

  /** One step. Resolves when it's done (pop-ups/confirms: when closed). */
  private async performStep(
    step: ObjectAction,
    obj: RoomObject,
    trigger: TriggerName,
    alive: () => boolean
  ): Promise<ObjectAction[] | void> {
    if (!alive() || this.isLeaving || !this.sys?.isActive?.()) return;
    const ar = this.lang === "ar";
    switch (step.kind) {
      case "popup":
        this.log(obj, trigger, "popup", `${this.roomConfig.id}:${obj.id}`);
        await requestActionUi({
          type: "popup",
          roomId: this.roomConfig.id,
          objectId: obj.id,
          label: obj.label,
          labelAr: obj.labelAr,
          sequence: this.popupStops(obj),
        });
        return;
      case "open-popup": {
        const room = step.roomIid ? roomByIid(this.allRooms(), step.roomIid) : this.roomConfig;
        const target = objectByIid(room, step.objectIid);
        if (!room || !target) {
          this.log(obj, trigger, "open-popup", "no target");
          return;
        }
        this.log(obj, trigger, "open-popup", `${room.id}:${target.id}`);
        await requestActionUi({
          type: "popup",
          roomId: room.id,
          objectId: target.id,
          label: target.label,
          labelAr: target.labelAr,
        });
        return;
      }
      case "door":
        this.goThroughDoor(obj, trigger);
        return;
      case "go-to-room": {
        const room = roomByIid(this.allRooms(), step.roomIid);
        if (!room) {
          this.log(obj, trigger, "go-to-room", "no target");
          this.notice(ar ? "هذا لا يؤدي إلى أي مكان بعد" : "This doesn't lead anywhere yet");
          return;
        }
        const ep = step.entryPointIid ? room.entryPoints.find((e) => e.iid === step.entryPointIid) : undefined;
        this.log(obj, trigger, "go-to-room", `${room.id}${ep ? `#${ep.id}` : ""}`);
        this.transitionToRoom(room.id, ep?.id);
        return;
      }
      case "link": {
        const href = safeHref(step.url);
        if (!href) {
          // Refused quietly, exactly like an unsafe external link before.
          this.log(obj, trigger, "link", "refused");
          return;
        }
        this.log(obj, trigger, "link", `${step.confirm ? "confirm " : ""}${href}`);
        await requestActionUi({ type: "link", url: href, confirm: step.confirm });
        return;
      }
      case "email": {
        const subject = ar ? step.subject?.ar || step.subject?.en : step.subject?.en || step.subject?.ar;
        const href = mailtoHref(step.address, subject);
        this.log(obj, trigger, "email", href ?? "refused");
        if (href) await requestActionUi({ type: "email", href });
        return;
      }
      case "download": {
        const href = downloadHref(step.url, step.fileName);
        this.log(obj, trigger, "download", href ?? "refused");
        if (href) await requestActionUi({ type: "download", href, fileName: step.fileName });
        return;
      }
      case "dialogue": {
        this.log(obj, trigger, "dialogue");
        const choice = await requestActionUi({
          type: "dialogue",
          dialogue: step.dialogue,
          label: obj.label,
          labelAr: obj.labelAr,
        });
        if (choice) this.log(obj, trigger, "dialogue-answer", choice.label.en || choice.label.ar);
        return choice?.actions;
      }
      case "effect": {
        const msg = ar ? step.message?.ar || step.message?.en : step.message?.en || step.message?.ar;
        this.log(obj, trigger, "effect", step.reaction);
        this.fxFor(obj).playReaction(step.reaction, msg || undefined);
        return;
      }
      case "sound": {
        const src = soundSrc(step.url);
        this.log(obj, trigger, "sound", src ?? "refused");
        if (!src || typeof Audio === "undefined") return;
        const audio = new Audio(src);
        audio.volume = Math.min(1, Math.max(0, step.volume ?? 0.8));
        // Not awaited: the next step starts while it plays.
        audio.play().catch(() => {
          // Autoplay blocked or the file is gone: stay silent.
        });
        return;
      }
      case "toggle-object": {
        const target = objectByIid(this.roomConfig, step.objectIid);
        if (!target) {
          this.log(obj, trigger, "toggle-object", "no target");
          return;
        }
        const fx = this.fxFor(target);
        const hide = step.mode === "hide" ? true : step.mode === "show" ? false : !fx.isHidden;
        this.log(obj, trigger, "toggle-object", `${hide ? "hide" : "show"} ${target.id}`);
        this.setObjectHidden(target, hide);
        return;
      }
      case "shop":
        // Opens the visitor's character creator (the same panel as the HUD's
        // Character button).
        this.log(obj, trigger, "shop", "character creator");
        EventBridge.emit(EVENTS.OPEN_CHARACTER_CREATOR);
        return;
      case "wait": {
        const ms = Math.min(10000, Math.max(0, step.ms));
        this.log(obj, trigger, "wait", `${ms}ms`);
        await new Promise<void>((resolve) => {
          // A room change stops the scene clock: don't leave the chain hanging.
          const onShutdown = () => resolve();
          this.events.once("shutdown", onShutdown);
          this.time.delayedCall(ms, () => {
            this.events.off("shutdown", onShutdown);
            resolve();
          });
        });
        return;
      }
    }
  }

  /** "Step through pop-ups": the room's visible pop-ups, when it's on and
   *  this object is one of at least two. */
  private popupStops(obj: RoomObject): PopupStop[] | undefined {
    if (!this.roomConfig.popupNav?.enabled) return undefined;
    const seq = popupSequence(this.roomConfig).filter((o) => !this.fxFor(o).isHidden);
    if (seq.length < 2 || !seq.includes(obj)) return undefined;
    return seq.map((o) => ({ objectId: o.id, label: o.label, labelAr: o.labelAr }));
  }

  private allRooms(): Record<string, RoomConfig> {
    return (
      (this.registry.get("roomConfigs") as Record<string, RoomConfig> | undefined) ?? {
        [this.roomConfig.id]: this.roomConfig,
      }
    );
  }

  /** The "door" step: the door's own target (iid first, slug fallback). */
  private goThroughDoor(obj: RoomObject, trigger: TriggerName) {
    // Resolve the door's target by iid first (rename-proof), falling back
    // to the legacy slug. Scene keys downstream are still slug-based, so
    // we resolve to a slug here at the boundary.
    const liveConfigs = this.registry.get("roomConfigs") as Record<string, RoomConfig> | undefined;
    let targetSlug: string | undefined;
    let targetEntrySlug: string | undefined;

    if (obj.targetRoomIid && liveConfigs) {
      const byIid = Object.values(liveConfigs).find((r) => r?.iid === obj.targetRoomIid);
      if (byIid) {
        targetSlug = byIid.id;
        if (obj.targetEntryPointIid) {
          const ep = byIid.entryPoints.find((e) => e.iid === obj.targetEntryPointIid);
          if (ep) targetEntrySlug = ep.id;
        }
      }
    }
    // Slug fallbacks if iid resolution didn't yield anything.
    if (!targetSlug) targetSlug = obj.targetRoomId;
    if (!targetEntrySlug) targetEntrySlug = obj.targetEntryPointId;

    this.log(obj, trigger, "door", targetSlug ? `${targetSlug}${targetEntrySlug ? `#${targetEntrySlug}` : ""}` : "no target");
    if (targetSlug) {
      this.transitionToRoom(targetSlug, targetEntrySlug);
    }
  }

  /** "Show / hide" steps + hiddenAtStart: art, label and clicks, this visit. */
  private setObjectHidden(obj: RoomObject, hidden: boolean) {
    this.fxFor(obj).setHidden(hidden);
    const zone = this.objectZones.get(obj.id);
    if (zone?.input) zone.input.enabled = !hidden;
  }

  // ─── Walks near ─────────────────────────────────────────────

  /** Re-arm distance factor (hysteresis): leave radius × this to re-arm. */
  private static readonly NEAR_EXIT = 1.25;

  /**
   * Track which near zones the player is in. With `fire`, entering a zone
   * runs its steps; without (spawn, or while a pop-up / dialogue / link
   * confirm is open, during a door transition, while a chain runs, or while
   * walking to a clicked object), the entry is only recorded, so it never
   * fires late. The click wins: a sign passed on the way to the plant must
   * not swallow the plant click.
   */
  private syncNearZones(fire: boolean) {
    const p = this.player;
    if (!p) return;
    if (this.pendingInteraction) fire = false;
    for (const obj of this.roomConfig.objects) {
      const near = nearTriggerOf(obj);
      if (!near) continue;
      const r = Math.max(0, obj.interactionRadius || 0);
      const t = this.walkTargetOf(obj);
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      const wasInside = this.nearInside.get(obj.id) ?? false;
      if (!wasInside && d <= r) {
        this.nearInside.set(obj.id, true);
        if (fire && !this.fxFor(obj).isHidden && this.hasLiveTrigger(obj, "near")) {
          if (chainTakesOver(near.actions)) {
            // Stop walking before a pop-up, dialogue or room change takes
            // over (only a floor walk gets here: no click is pending).
            this.stopWalking();
          }
          this.runner.cancel();
          this.runTrigger(obj, "near");
          fire = false; // one trigger per tick; the rest just record entry
        }
      } else if (wasInside && d > r * BaseRoomScene.NEAR_EXIT) {
        this.nearInside.set(obj.id, false);
      }
    }
  }

  private stopWalking() {
    if (this.playerTween) {
      this.playerTween.stop();
      this.playerTween = null;
    }
    if (this.player?.active) playIdleFrame(this.player, this.playerDirection);
    this.walkTargetIndicator?.clear();
  }

  update(_time: number, delta: number) {
    // Proximity checks ~10× a second are plenty for a walking avatar.
    this.nearClock += delta;
    if (this.nearClock < 100) return;
    this.nearClock = 0;
    const blocked = this.uiModalOpen || this.isLeaving || this.ambientMode || this.runner.busy;
    this.syncNearZones(!blocked);
  }

  protected transitionToRoom(roomId: string, entryPointId?: string) {
    if (this.isLeaving) return;
    // A door whose target room was deleted/renamed used to fade to black and
    // strand the player (starting an unknown scene is a silent no-op).
    if (!this.scene.manager.keys[`Room_${roomId}`]) {
      const p = this.player;
      floatNotice(
        this,
        p?.x ?? this.roomConfig.width / 2,
        (p?.y ?? this.roomConfig.height / 2) - 90,
        this.registry.get("language") === "ar"
          ? "هذا الباب لا يؤدي إلى أي مكان بعد"
          : "This door doesn't lead anywhere yet"
      );
      return;
    }
    this.isLeaving = true;

    // Stop player movement
    if (this.playerTween) {
      this.playerTween.stop();
      this.playerTween = null;
    }

    // Fade out then switch scene
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start(`Room_${roomId}`, {
        entryFrom: entryPointId || "default",
      });
    });
  }

  // ─── Event Handlers ────────────────────────────────────────

  private onAvatarUpdated = (config: unknown) => {
    // Async build of the new sprite sheet. While it's in flight the
    // player keeps the old frame; once registerAvatarTexture finishes
    // we refresh the texture binding and snap back to idle.
    void (async () => {
      try {
        await registerAvatarTexture(this, config as AvatarConfig);
        if (!this.player || !this.sys?.isActive?.()) return;
        this.player.setTexture("player-avatar");
        playIdleFrame(this.player, this.playerDirection);
      } catch (err) {
        console.warn("Avatar update failed; keeping previous texture", err);
      }
    })();
  };

  private onNavigateToRoom = (roomId: unknown) => {
    if (typeof roomId === "string" && roomId !== this.roomConfig.id) {
      this.transitionToRoom(roomId, "default");
    }
  };

  private onUIModal = (open: unknown) => {
    this.uiModalOpen = open === true;
  };

  private onPlayModeEnter = () => {
    this.ambientMode = false;
  };

  private onPlayModeExit = () => {
    this.ambientMode = true;
    // Freeze mid-walk cleanly: stop the tween where it is, settle into
    // the idle frame, and drop any queued walk-to-interact so it can't
    // fire a modal while the visitor is back on the page.
    if (this.playerTween) {
      this.playerTween.stop();
      this.playerTween = null;
    }
    if (this.player && this.sys?.isActive?.()) {
      playIdleFrame(this.player, this.playerDirection);
    }
    this.walkTargetIndicator?.clear();
    this.pendingInteraction = null;
  };
}
