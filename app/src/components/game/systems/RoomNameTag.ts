// RoomNameTag — the room's name in the game's top corner, as a small paper
// tag in the site's display font (Arabic font in Arabic), instead of the old
// "📍 name" system-font text with a black outline.
//
// Shown when the room says so (`nameTag.show`), else when the live world's
// `roomNameTags` default is on (registry "roomNameTags", default true).
// Optional icon: a small drawn pin, or the owner's own drawing/upload
// (`nameTag.art`). Pinned to the camera via the scene's uiPoint(); top-left
// in English, top-right (icon after the name) in Arabic.

import Phaser from "phaser";
import type { RoomConfig } from "@/data/roomTypes";
import { safeMediaSrc } from "@/lib/safeUrl";

const PAPER = 0xfbf8f1;
const INK = "#2b2622";
const INK_HEX = 0x2b2622;
const PIN_RED = 0xc8553d;
// The cabinet's drawn bezel overlaps the outer ~14 screen px of the canvas
// (about 24 logical px at desktop scale), so a 16 px inset clipped the first
// letter ("allery"), and its thick top corners (worst in the Arabic top-right) crossed the tag.
const MARGIN_X = 36;
const MARGIN_Y = 30;
const PAD_X = 12;
const PAD_Y = 6;
const GAP = 8;
const FONT_PX = 20;
const ICON_PX = 22;

/** Whether this room shows its name tag. */
export function roomNameTagVisible(room: RoomConfig, worldDefault: boolean): boolean {
  const show = room.nameTag?.show ?? "world";
  return show === "world" ? worldDefault : show === "show";
}

/** The page's display font stack (custom properties set by the site's fonts). */
function fontStack(canvas: HTMLCanvasElement | undefined, lang: "en" | "ar"): string {
  let latin = "";
  let arabic = "";
  try {
    if (canvas) {
      const cs = getComputedStyle(canvas);
      latin = cs.getPropertyValue("--font-display-latin").trim();
      arabic = cs.getPropertyValue("--font-arabic").trim();
    }
  } catch {
    // Fall through to the generic stack.
  }
  const parts = lang === "ar" ? [arabic, latin] : [latin, arabic];
  return [...parts.filter(Boolean), "Georgia", "serif"].join(", ");
}

export function createRoomNameTag(
  scene: Phaser.Scene,
  room: RoomConfig,
  lang: "en" | "ar",
  uiPoint: (x: number, y: number) => { x: number; y: number }
): Phaser.GameObjects.Container | null {
  const name = (lang === "ar" ? room.nameAr || room.name : room.name || room.nameAr)?.trim();
  if (!name) return null;

  const cam = scene.cameras.main;
  const zoom = cam.zoom || 1;
  const rtl = lang === "ar";
  const family = fontStack(scene.game.canvas, lang);

  const shadow = scene.add.graphics();
  const bg = scene.add.graphics();
  const text = scene.add
    .text(0, 0, name, {
      fontFamily: family,
      fontSize: `${FONT_PX}px`,
      color: INK,
      rtl,
      // Phaser under-measures mixed Latin + Arabic in RTL and clips the
      // edge glyph: a little slack on both sides keeps it whole.
      ...(rtl ? { padding: { left: 6, right: 6 } } : {}),
    })
    .setResolution(Math.max(1, zoom * (window.devicePixelRatio || 1)));

  const iconKind = room.nameTag?.icon ?? "none";
  let icon: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image | null = null;
  if (iconKind === "pin") {
    const g = scene.add.graphics();
    // A small map pin: round head + point, with a paper-coloured dot.
    g.fillStyle(PIN_RED, 1);
    g.fillCircle(ICON_PX / 2, 8, 7);
    g.fillTriangle(ICON_PX / 2 - 6, 11, ICON_PX / 2 + 6, 11, ICON_PX / 2, ICON_PX);
    g.fillStyle(PAPER, 1);
    g.fillCircle(ICON_PX / 2, 8, 2.6);
    icon = g;
  }

  const container = scene.add.container(0, 0).setDepth(10000).setScrollFactor(0);
  container.add([shadow, bg, text]);
  if (icon) container.add(icon);

  const layout = () => {
    if (!container.active) return;
    const iconW = icon ? ICON_PX : 0;
    const contentW = text.width + (icon ? GAP + iconW : 0);
    const h = Math.max(text.height, icon ? ICON_PX : 0) + PAD_Y * 2;
    const w = contentW + PAD_X * 2;

    shadow.clear();
    shadow.fillStyle(0x000000, 0.16);
    shadow.fillRoundedRect(1, 3, w, h, 10);
    bg.clear();
    bg.fillStyle(PAPER, 0.96);
    bg.fillRoundedRect(0, 0, w, h, 10);
    bg.lineStyle(1.5, INK_HEX, 0.22);
    bg.strokeRoundedRect(0, 0, w, h, 10);

    // Icon first in English, last in Arabic.
    const iconX = rtl ? PAD_X + text.width + GAP : PAD_X;
    const textX = rtl ? PAD_X : PAD_X + (icon ? iconW + GAP : 0);
    // Phaser draws RTL text leftwards from its anchor: anchor it on the right.
    text.setOrigin(rtl ? 1 : 0, 0);
    text.setPosition(rtl ? textX + text.width : textX, (h - text.height) / 2);
    if (icon instanceof Phaser.GameObjects.Image) {
      icon.setPosition(iconX + ICON_PX / 2, h / 2);
    } else if (icon) {
      icon.setPosition(iconX, (h - ICON_PX) / 2);
    }

    // uiPoint takes logical room-view coordinates (1520 wide): top-left in
    // English, top-right in Arabic.
    const at = uiPoint(rtl ? room.width - MARGIN_X - w : MARGIN_X, MARGIN_Y);
    container.setPosition(at.x, at.y);
  };

  // The owner's icon: loaded like room backgrounds (anonymous CORS image).
  const artUrl = iconKind === "art" ? safeMediaSrc(room.nameTag?.art?.url, "image") : null;
  if (artUrl) {
    const key = `nametag_${artUrl}`;
    const attach = () => {
      if (!container.active || !scene.sys?.isActive?.()) return;
      const img = scene.add.image(0, 0, key);
      const s = ICON_PX / Math.max(img.width, img.height, 1);
      img.setScale(s);
      icon = img;
      container.add(img);
      layout();
    };
    if (scene.textures.exists(key)) {
      attach();
    } else {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => {
        if (!scene.textures.exists(key)) {
          // Rasterise onto a small canvas first: works for PNG/WebP and for
          // SVGs without an intrinsic size (which load as 0×0 textures).
          const px = ICON_PX * 4;
          const cv = document.createElement("canvas");
          cv.width = px;
          cv.height = px;
          const g = cv.getContext("2d");
          const iw = el.naturalWidth || px;
          const ih = el.naturalHeight || px;
          const s = px / Math.max(iw, ih);
          g?.drawImage(el, (px - iw * s) / 2, (px - ih * s) / 2, iw * s, ih * s);
          scene.textures.addCanvas(key, cv);
        }
        attach();
      };
      el.src = artUrl;
    }
  }

  layout();

  // Web fonts may still be loading: re-measure once they're ready.
  try {
    void document.fonts?.load(`${FONT_PX}px ${family}`).then(() => {
      if (!text.active) return;
      text.setFontFamily(family);
      layout();
    });
  } catch {
    // Old browsers: the first layout stands.
  }

  return container;
}
