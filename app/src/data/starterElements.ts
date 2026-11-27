// Starter elements — flat-colour art that ships with the site under
// /public/elements: furniture rendered from Kenney's "Furniture Kit" models
// (CC0) and small objects from Microsoft's Fluent Emoji (MIT). Rebuilt by
// app/scripts/starter-art/build_elements.py. Two jobs:
//   1. Default look for any object without its own sprite (doors, NPCs,
//      objects by template category) instead of flat coloured boxes — in the
//      editor canvas, the live preview and the game (see `defaultArtFor`).
//   2. A one-click palette in the editor's Add menu.
// Sizes are in room pixels (the room canvas is 1520×960) and match each
// drawing's aspect ratio.

import type { RoomObject } from "./roomTypes";

export interface StarterElement {
  id: string;
  name: string;
  nameAr: string;
  url: string;
  w: number;
  h: number;
  type: RoomObject["type"];
  category?: string;
  /** Hangs on the back wall (frames, windows, clocks). */
  wallMounted?: boolean;
  /** Pure decoration by default (rugs etc.). */
  decoration?: boolean;
}

const el = (
  id: string,
  name: string,
  nameAr: string,
  w: number,
  h: number,
  extra: Partial<StarterElement> = {},
  ext: "png" | "svg" = "png"
): StarterElement => ({
  id,
  name,
  nameAr,
  url: `/elements/${id}.${ext}`,
  w,
  h,
  type: "object",
  ...extra,
});

export const STARTER_ELEMENTS: StarterElement[] = [
  el("door", "Door", "باب", 126, 261, { type: "door", category: "door" }),
  el("archway", "Open doorway", "مدخل مفتوح", 126, 261, { type: "door", category: "door" }),
  el("mascot", "Character (NPC)", "شخصية", 111, 169, { type: "npc" }),
  el("sofa", "Sofa", "أريكة", 278, 152, { category: "furniture", decoration: true }),
  el("armchair", "Armchair", "كرسي بذراعين", 140, 152, { category: "furniture", decoration: true }),
  el("desk", "Desk", "مكتب", 243, 151, { category: "furniture" }),
  el("chair", "Desk chair", "كرسي مكتب", 98, 192, { category: "furniture", decoration: true }),
  el("table", "Coffee table", "طاولة قهوة", 197, 96, { category: "furniture", decoration: true }),
  el("bookshelf", "Cabinet", "خزانة", 224, 231, { category: "furniture" }),
  el("shelf", "Shelving", "رفوف", 115, 261, { category: "furniture" }),
  el("computer", "Computer", "حاسوب", 172, 131, { category: "furniture" }),
  el("tv", "Television", "تلفاز", 164, 121, { category: "furniture" }),
  el("lamp", "Floor lamp", "مصباح", 48, 262, { category: "decoration", decoration: true }),
  el("plant", "Plant", "نبتة", 66, 202, { category: "plant", decoration: true }),
  el("rug", "Rug", "سجادة", 154, 97, { category: "decoration", decoration: true }),
  el("chest", "Closed box", "صندوق مغلق", 82, 122, { category: "other" }),
  el("box", "Open box", "صندوق مفتوح", 142, 122, { category: "other" }),
  el("window", "Window", "نافذة", 120, 120, { category: "wall-art", wallMounted: true, decoration: true }, "svg"),
  el("frame", "Picture frame", "إطار صورة", 120, 120, { category: "wall-art", wallMounted: true }, "svg"),
  el("clock", "Clock", "ساعة", 120, 120, { category: "wall-art", wallMounted: true, decoration: true }, "svg"),
  el("noteboard", "Clipboard", "لوح ملاحظات", 120, 120, { category: "wall-art", wallMounted: true }, "svg"),
  el("sign", "Sign", "لافتة", 120, 120, { category: "decoration" }, "svg"),
  el("easel", "Paint palette", "لوحة ألوان", 120, 120, { category: "decoration" }, "svg"),
  el("books", "Books", "كتب", 120, 120, { category: "decoration" }, "svg"),
  el("trophy", "Trophy", "كأس", 120, 120, { category: "decoration" }, "svg"),
  el("microscope", "Microscope", "مجهر", 120, 120, { category: "decoration" }, "svg"),
  el("camera", "Camera", "كاميرا", 120, 120, { category: "decoration" }, "svg"),
  el("briefcase", "Briefcase", "حقيبة عمل", 120, 120, { category: "decoration" }, "svg"),
  el("shopping", "Shopping bags", "أكياس تسوق", 120, 120, { category: "decoration" }, "svg"),
  el("rocket", "Rocket", "صاروخ", 120, 120, { category: "decoration" }, "svg"),
  el("lightbulb", "Light bulb", "مصباح أفكار", 120, 120, { category: "decoration" }, "svg"),
  el("envelope", "Envelope", "ظرف", 120, 120, { category: "decoration" }, "svg"),
  el("joystick", "Joystick", "ذراع تحكم", 120, 120, { category: "decoration" }, "svg"),
];

const urlOf = (id: string): string =>
  STARTER_ELEMENTS.find((e) => e.id === id)?.url ?? "/elements/box.png";

const BY_CATEGORY: Record<string, string> = {
  door: "door",
  furniture: "desk",
  plant: "plant",
  decoration: "lamp",
  "wall-art": "frame",
  other: "box",
};

/**
 * The drawing to show for an object that has no sprite of its own, or null
 * when it should stay invisible (a hotspot over painted background art).
 */
export function defaultArtFor(obj: RoomObject): string | null {
  if (obj.invisible) return null;
  if (obj.type === "door") return urlOf("door");
  if (obj.type === "npc") return urlOf("mascot");
  // Name it and it looks like it: "Reading Desk" gets a desk, "Plant" a
  // plant, "Artwork 2" a framed picture…
  const text = `${obj.label} ${obj.id}`.toLowerCase();
  for (const [re, id] of BY_KEYWORD) if (re.test(text)) return urlOf(id);
  if (obj.category && BY_CATEGORY[obj.category]) return urlOf(BY_CATEGORY[obj.category]);
  // Things on the back wall read best as a frame; everything else a box.
  return urlOf(obj.isWallMounted ? "frame" : "box");
}

const BY_KEYWORD: [RegExp, string][] = [
  [/\b(couch|sofa|lounge)\b/, "sofa"],
  [/\b(armchair)\b/, "armchair"],
  [/\b(coffee table)\b/, "table"],
  [/\b(mascot|guide|logo)\b/, "mascot"],
  [/\b(award|awards|trophy|prize|achievement|achievements)\b/, "trophy"],
  [/\b(lab|experiment|experiments|science|research)\b/, "microscope"],
  [/\b(camera|photo|photos|photography)\b/, "camera"],
  [/\b(video|reel|film|videography|tv|television)/, "tv"],
  [/\b(cv|resume|career|experience|work|job)\b/, "briefcase"],
  [/\b(shop|store|merch|counter)\b/, "shopping"],
  [/\b(contact|mail|email|letter|hello)\b/, "envelope"],
  [/\b(idea|ideas|thoughts|philosophy|quotes)\b/, "lightbulb"],
  [/\b(project|projects|launch|startup)\b/, "rocket"],
  [/\b(game|games|arcade|play)\b/, "joystick"],
  [/\b(desk|workbench|operations)\b/, "desk"],
  [/\b(table)\b/, "table"],
  [/\b(chair|seat|stool)\b/, "chair"],
  [/\b(plant|tree|flower|garden|growth)\b/, "plant"],
  [/\b(shelf|shelves|shelving)\b/, "shelf"],
  [/\b(bookshelf|bookcase|cabinet|archive|certificates|certificate)\b/, "bookshelf"],
  [/\b(book|books|stories|reading|library)\b/, "books"],
  [/\b(computer|pc|laptop|screen|data|code|skills|tools)/, "computer"],
  [/\b(art|artwork|painting|picture|gallery|collection|frame|poster|instagram)/, "frame"],
  [/\b(board|note|notes|now)\b/, "noteboard"],
  [/\b(clock|time|memory)\b/, "clock"],
  [/\b(window)\b/, "window"],
  [/\b(lamp|light)\b/, "lamp"],
  [/\b(easel|draw|sketch|studio|palette|paint)\b/, "easel"],
  [/\b(treasure|chest|box)\b/, "chest"],
  [/\b(sign|welcome|beginning|milestone)\b/, "sign"],
  [/\b(rug|carpet|mat)\b/, "rug"],
];

/** What an object renders: its own sprite, else its default drawing. */
export function objectArtUrl(obj: RoomObject): string | null {
  return obj.spriteUrl || defaultArtFor(obj);
}

/**
 * Fit a default drawing inside the object's box without distorting it,
 * standing on the box's bottom edge (so doors/furniture sit on the floor).
 * Own sprites fill the box exactly, as before.
 */
export function fitArt(
  obj: Pick<RoomObject, "x" | "y" | "width" | "height">,
  natural: { w: number; h: number }
): { cx: number; cy: number; w: number; h: number } {
  const s = Math.min(obj.width / natural.w, obj.height / natural.h);
  const w = natural.w * s;
  const h = natural.h * s;
  return {
    cx: obj.x + obj.width / 2,
    cy: obj.y + obj.height - h / 2,
    w,
    h,
  };
}
