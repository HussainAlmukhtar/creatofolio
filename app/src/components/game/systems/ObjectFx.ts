// ObjectFx — hover effects, secret (reveal-on-hover) objects and Easter egg
// reactions for room objects. One controller per object per scene visit;
// shared by BaseRoomScene (the live game) and PreviewScene (the editor's
// live preview) so what you tune in the editor is what players get.
//
// All motion is tween-based on the object's sprite (a Phaser Image). Objects
// still drawn as procedural placeholders get the non-transform parts only
// (label tag, reveal, particle reactions, speech bubble).

import Phaser from "phaser";
import type {
  EasterEggReaction,
  HoverEffect,
  RoomObject,
} from "@/data/roomTypes";
import { isClickable } from "@/lib/objectActions";

const STAR_KEY = "fx_star";
const BIT_KEY = "fx_bit";
/** "Invisible" but still hit-testable (see setVisible). */
const HIDDEN_ALPHA = 0.001;

/** Resolve "auto"/omitted into a concrete effect. */
export function resolveHoverEffect(obj: RoomObject): Exclude<HoverEffect, "auto"> {
  const e = obj.hoverEffect ?? "auto";
  if (e !== "auto") return e;
  // Doors always counted as clickable for the hover (the legacy rule).
  const clickable = obj.type === "door" || isClickable(obj);
  return clickable ? "lift" : "none";
}

/** Hover strength 0.25–2 (default 1); scales how far/much things move. */
export function hoverIntensityOf(obj: RoomObject): number {
  const v = obj.hoverIntensity;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(2, Math.max(0.25, v)) : 1;
}

function ensureTextures(scene: Phaser.Scene) {
  if (!scene.textures.exists(STAR_KEY)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    // Four-point sparkle, 16×16.
    g.fillPoints(
      [
        { x: 8, y: 0 },
        { x: 10, y: 6 },
        { x: 16, y: 8 },
        { x: 10, y: 10 },
        { x: 8, y: 16 },
        { x: 6, y: 10 },
        { x: 0, y: 8 },
        { x: 6, y: 6 },
      ],
      true
    );
    g.generateTexture(STAR_KEY, 16, 16);
    g.destroy();
  }
  if (!scene.textures.exists(BIT_KEY)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 5);
    g.generateTexture(BIT_KEY, 8, 5);
    g.destroy();
  }
}

/** Visitor asked the OS to reduce motion — swap movement for glows/fades. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

interface Base {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
}

export class ObjectFxController {
  private image: Phaser.GameObjects.Image | null = null;
  private extras: Phaser.GameObjects.GameObject[] = [];
  private base: Base | null = null;
  private hoverTween: Phaser.Tweens.Tween | null = null;
  private glow: Phaser.FX.Glow | null = null;
  private tag: Phaser.GameObjects.Text | null = null;
  private hovered = false;
  private reacting = false;
  private clicks = 0;
  private revealed = false;
  private hidden = false;

  constructor(
    private scene: Phaser.Scene,
    private obj: RoomObject,
    private language: () => "en" | "ar",
    private roomId: string
  ) {}

  /** Bind the object's visual (sprite, or null for a placeholder). */
  attach(image: Phaser.GameObjects.Image | null, extras: Phaser.GameObjects.GameObject[] = []) {
    this.stopHover();
    this.image = image;
    this.extras = extras;
    this.base = image
      ? {
          x: image.x,
          y: image.y,
          scaleX: image.scaleX,
          scaleY: image.scaleY,
          angle: image.angle,
        }
      : null;
    if (this.obj.revealOnHover && !this.revealed) this.setVisible(0);
    if (this.hidden) this.applyHidden();
  }

  /** "Show / hide an object" steps (this visit only). */
  setHidden(hidden: boolean) {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) {
      this.hovered = false;
      this.tag?.destroy();
      this.tag = null;
      this.stopHover();
    }
    this.applyHidden(!hidden);
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  private applyHidden(fadeIn = false) {
    const targets = [this.image, ...this.extras].filter(Boolean) as unknown as (Phaser.GameObjects.Components.Visible &
      Phaser.GameObjects.Components.Alpha)[];
    for (const t of targets) t.setVisible(!this.hidden);
    if (fadeIn && !this.hidden && !(this.obj.revealOnHover && !this.revealed)) {
      for (const t of targets) t.setAlpha(0);
      this.scene.tweens.add({ targets, alpha: 1, duration: 260, ease: "Sine.easeOut" });
    }
  }

  /** An "effect" step: the reaction plus an optional speech bubble. */
  playReaction(reaction: EasterEggReaction, message?: string) {
    if (this.obj.revealOnHover) {
      this.revealed = true;
      this.setVisible(1, true);
    }
    this.react(reaction);
    if (message) this.bubble(message);
  }

  private setVisible(alpha: number, animate = false) {
    const targets = [this.image, ...this.extras].filter(Boolean) as unknown as Phaser.GameObjects.Components.Alpha[];
    if (!targets.length) return;
    // Phaser's input hit test skips anything at alpha 0 (it "won't render"),
    // so a hidden secret whose sprite is its own hit target could never be
    // hovered to reveal it. Keep it imperceptibly visible instead.
    if (alpha === 0) alpha = HIDDEN_ALPHA;
    if (animate) {
      this.scene.tweens.add({ targets, alpha, duration: 220, ease: "Sine.easeOut" });
    } else {
      for (const t of targets) t.setAlpha(alpha);
    }
  }

  onOver() {
    if (this.hovered || this.hidden) return;
    this.hovered = true;
    if (this.obj.revealOnHover && !this.revealed) this.setVisible(1, true);
    if (this.obj.hoverLabel) this.showTag();
    if (!this.reacting) this.startHover();
    const egg = this.obj.easterEgg;
    if (egg?.trigger === "hover") this.fire();
  }

  onOut() {
    if (!this.hovered) return;
    this.hovered = false;
    this.tag?.destroy();
    this.tag = null;
    if (!this.reacting) this.stopHover();
    if (this.obj.revealOnHover && !this.revealed) this.setVisible(0, true);
  }

  /** Call on every click. Returns true if the Easter egg fired. */
  onClick(): boolean {
    const egg = this.obj.easterEgg;
    if (!egg || egg.trigger === "hover") return false;
    this.clicks++;
    const needed = egg.trigger === "clicks" ? Math.max(2, egg.count ?? 5) : 1;
    if (this.clicks < needed) return false;
    this.clicks = 0;
    return this.fire();
  }

  private fire(): boolean {
    const egg = this.obj.easterEgg;
    if (!egg) return false;
    const onceKey = `egg:${this.roomId}:${this.obj.iid ?? this.obj.id}`;
    if (egg.once && this.scene.registry.get(onceKey)) return false;
    if (egg.once) this.scene.registry.set(onceKey, true);
    // A found secret stays found.
    if (this.obj.revealOnHover) {
      this.revealed = true;
      this.setVisible(1, true);
    }
    this.react(egg.reaction);
    const msg = this.language() === "ar" ? egg.messageAr || egg.message : egg.message;
    if (msg) this.bubble(msg);
    return true;
  }

  // ─── Hover ────────────────────────────────────────────────

  private startHover() {
    const img = this.image;
    const b = this.base;
    let effect = resolveHoverEffect(this.obj);
    if (!img || !b || effect === "none") return;
    const k = hoverIntensityOf(this.obj);
    // Reduced motion: every moving effect becomes a still glow.
    if (prefersReducedMotion()) effect = "glow";
    this.hoverTween?.stop();
    switch (effect) {
      case "lift":
        this.hoverTween = this.scene.tweens.add({
          targets: img,
          y: b.y - 6 * k,
          scaleX: b.scaleX * (1 + 0.03 * k),
          scaleY: b.scaleY * (1 + 0.03 * k),
          duration: 160,
          ease: "Sine.easeOut",
        });
        break;
      case "grow":
        this.hoverTween = this.scene.tweens.add({
          targets: img,
          scaleX: b.scaleX * (1 + 0.08 * k),
          scaleY: b.scaleY * (1 + 0.08 * k),
          duration: 160,
          ease: "Back.easeOut",
        });
        break;
      case "wiggle":
        this.hoverTween = this.scene.tweens.add({
          targets: img,
          angle: { from: b.angle - 4 * k, to: b.angle + 4 * k },
          duration: 180,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        break;
      case "pulse":
        this.hoverTween = this.scene.tweens.add({
          targets: img,
          scaleX: b.scaleX * (1 + 0.05 * k),
          scaleY: b.scaleY * (1 + 0.05 * k),
          duration: 420,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        break;
      case "glow":
        // WebGL only; the Canvas renderer has no preFX — fall back to a grow
        // (or nothing, when motion is reduced).
        if (img.preFX) {
          this.glow = img.preFX.addGlow(0xfff1b8, 4 * k, 0, false, 0.1, 12);
        } else if (!prefersReducedMotion()) {
          this.hoverTween = this.scene.tweens.add({
            targets: img,
            scaleX: b.scaleX * (1 + 0.05 * k),
            scaleY: b.scaleY * (1 + 0.05 * k),
            duration: 160,
          });
        }
        break;
    }
  }

  private stopHover() {
    this.hoverTween?.stop();
    this.hoverTween = null;
    if (this.glow && this.image?.preFX) this.image.preFX.remove(this.glow);
    this.glow = null;
    const img = this.image;
    const b = this.base;
    if (!img || !b || !img.active) return;
    this.scene.tweens.add({
      targets: img,
      x: b.x,
      y: b.y,
      scaleX: b.scaleX,
      scaleY: b.scaleY,
      angle: b.angle,
      duration: 160,
      ease: "Sine.easeOut",
    });
  }

  private showTag() {
    this.tag?.destroy();
    const lang = this.language();
    const text = lang === "ar" ? this.obj.labelAr || this.obj.label : this.obj.label;
    if (!text) return;
    this.tag = this.scene.add
      .text(this.obj.x + this.obj.width / 2, this.obj.y - 10, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#1f1a14",
        backgroundColor: "#fff8e7",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setDepth(10001)
      .setAlpha(0);
    this.scene.tweens.add({ targets: this.tag, alpha: 1, y: this.obj.y - 16, duration: 140 });
  }

  // ─── Reactions ────────────────────────────────────────────

  private center() {
    return {
      x: this.obj.x + this.obj.width / 2,
      y: this.obj.y + this.obj.height / 2,
    };
  }

  private react(reaction: EasterEggReaction) {
    const img = this.image;
    const b = this.base;
    const done = () => {
      this.reacting = false;
      if (!img || !b || !img.active) return;
      img.setPosition(b.x, b.y).setAngle(b.angle).setScale(b.scaleX, b.scaleY);
      if (this.hovered) this.startHover();
    };

    if (reaction === "sparkle" || reaction === "confetti") {
      this.burst(reaction);
      return;
    }
    if (prefersReducedMotion()) {
      // No spinning/jumping/shaking — a brief sparkle says "found it".
      this.burst("sparkle");
      return;
    }
    if (!img || !b) {
      // Placeholder objects can't move — celebrate with sparkles instead.
      this.burst("sparkle");
      return;
    }
    this.reacting = true;
    this.hoverTween?.stop();
    this.hoverTween = null;
    img.setPosition(b.x, b.y).setAngle(b.angle).setScale(b.scaleX, b.scaleY);
    switch (reaction) {
      case "spin":
        this.scene.tweens.add({
          targets: img,
          angle: b.angle + 360,
          duration: 650,
          ease: "Cubic.easeInOut",
          onComplete: done,
        });
        break;
      case "jump":
        this.scene.tweens.add({
          targets: img,
          y: b.y - Math.max(30, this.obj.height * 0.35),
          duration: 220,
          yoyo: true,
          ease: "Quad.easeOut",
          onComplete: done,
        });
        break;
      case "wiggle":
        this.scene.tweens.add({
          targets: img,
          angle: { from: b.angle - 12, to: b.angle + 12 },
          duration: 90,
          yoyo: true,
          repeat: 3,
          onComplete: done,
        });
        break;
      case "shake":
        this.scene.tweens.add({
          targets: img,
          x: { from: b.x - 8, to: b.x + 8 },
          duration: 45,
          yoyo: true,
          repeat: 5,
          onComplete: done,
        });
        break;
      default:
        done();
    }
  }

  private burst(kind: "sparkle" | "confetti") {
    ensureTextures(this.scene);
    const { x, y } = this.center();
    const confetti = kind === "confetti";
    const emitter = this.scene.add.particles(x, y, confetti ? BIT_KEY : STAR_KEY, {
      speed: confetti ? { min: 180, max: 420 } : { min: 60, max: 220 },
      angle: confetti ? { min: 200, max: 340 } : { min: 0, max: 360 },
      gravityY: confetti ? 600 : 0,
      lifespan: confetti ? 1400 : 800,
      scale: confetti ? { start: 1.2, end: 1 } : { start: 1.1, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: confetti ? { min: 0, max: 360 } : 0,
      tint: confetti
        ? [0xf97316, 0x22c55e, 0x3b82f6, 0xeab308, 0xec4899, 0xa855f7]
        : [0xfff1b8, 0xffffff, 0xfde68a],
      emitting: false,
    });
    emitter.setDepth(10500);
    emitter.explode(confetti ? 48 : 22);
    this.scene.time.delayedCall(1600, () => emitter.destroy());
  }

  private bubble(text: string) {
    const x = this.obj.x + this.obj.width / 2;
    const y = this.obj.y - 12;
    const t = this.scene.add
      .text(x, y, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "18px",
        color: "#1f1a14",
        backgroundColor: "#ffffff",
        padding: { x: 12, y: 8 },
        align: "center",
        wordWrap: { width: 320 },
      })
      .setOrigin(0.5, 1)
      .setDepth(10600)
      .setAlpha(0)
      .setScale(0.85);
    this.scene.tweens.add({
      targets: t,
      alpha: 1,
      scale: 1,
      y: y - 14,
      duration: 180,
      ease: "Back.easeOut",
    });
    this.scene.tweens.add({
      targets: t,
      alpha: 0,
      y: y - 34,
      delay: 2600,
      duration: 380,
      onComplete: () => t.destroy(),
    });
  }

  destroy() {
    this.hoverTween?.stop();
    this.tag?.destroy();
  }
}

/**
 * Tiny floating notice (e.g. "This door doesn't lead anywhere yet"). Used
 * when an action can't complete, so the player gets feedback instead of a
 * silent click.
 */
export function floatNotice(scene: Phaser.Scene, x: number, y: number, text: string) {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "16px",
      color: "#ffffff",
      backgroundColor: "#00000099",
      padding: { x: 10, y: 6 },
    })
    .setOrigin(0.5, 1)
    .setDepth(10600);
  scene.tweens.add({
    targets: t,
    y: y - 30,
    alpha: 0,
    delay: 1400,
    duration: 500,
    onComplete: () => t.destroy(),
  });
}
