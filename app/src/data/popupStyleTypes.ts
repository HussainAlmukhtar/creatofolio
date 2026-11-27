// Pop-up theme + frame library — data shapes.
//
// One `popup_styles` row per library item (migration 20261008000001_popup_styles):
//   - a THEME: the drawn parts every pop-up uses (panel, close, arrows, title
//     strip, page turn, dialogue box parts). One theme can be active; none
//     active = the built-in look (the paper sheet and its hand-drawn marks).
//   - a FRAME: a drawn frame (a TV, a book…) with a "screen" window the
//     content sits in. A pop-up picks one by `ObjectContent.frameIid`.
// Each item has a live `config` (what visitors see), an owner-only draft and
// a history; drawings are never replaced silently (archive-only, new art =
// a new version you publish).
//
// Pure: no React, no Supabase.

export type StyleKind = "theme" | "frame";

/** A drawing (or upload) used by a part. `sceneId` = its layered PSD in
 *  drawing-scenes/landing/<sceneId>.psd (the landing drawing convention, so
 *  the unused-files scan already counts it as referenced). */
export interface DrawnArt {
  url: string;
  sceneId?: string;
  /** Natural size in px (the canvas it was drawn on). */
  w: number;
  h: number;
}

export type ThemePartKey =
  | "panel"
  | "close"
  | "prev"
  | "next"
  | "titleStrip"
  | "pageTurn"
  | "dialogueBox"
  | "namePlate"
  | "dialogueNext"
  | "choiceButton";

/** Nine-slice insets of the panel drawing, in its own pixels. */
export interface SliceInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PopupThemeConfig {
  version: 1;
  /** Absent part = the built-in look for it. */
  parts: Partial<Record<ThemePartKey, DrawnArt>>;
  panelSlice: SliceInsets;
  /** On-screen size of the panel's edges relative to the drawing (0.2–1;
   *  0.5 suits art drawn at twice the size it shows). */
  panelScale: number;
  /** Edges between the corners: stretched, or repeated (keeps a hand-drawn
   *  edge's texture from smearing on wide pop-ups). */
  panelRepeat: "stretch" | "round";
  /** Nine-slice insets of the dialogue box drawing (its corners stay as
   *  drawn, its middle stretches across the screen). Shown at panelScale. */
  dialogueSlice: SliceInsets;
  /** Text colours on the drawn panel ("" = the theme's usual ink). */
  ink: string;
  inkSoft: string;
}

/** The content window of a frame, in % of the frame drawing. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PopupFrameConfig {
  version: 1;
  art: DrawnArt | null;
  screen: ScreenRect;
  /** Phones: keep the frame (scaled to fit) or show the plain bottom card. */
  phone: "keep" | "sheet";
  /** Fill behind the content inside the screen ("" = the paper sheet;
   *  "transparent" = see-through). */
  background: string;
  /** Text inside the screen: dark ink or light ink. */
  ink: "dark" | "light";
  /** The drawing sits ON TOP of the content, like a picture frame: its
   *  see-through screen hole shows the content and its own edges cover the
   *  content's edges. Set automatically when a hole is found. Off = the
   *  screen is laid over the drawing (for drawings with a solid screen). */
  artOver: boolean;
  /** Screen corner rounding, in the drawing's pixels. */
  radius: number;
  /** A soft inner shadow + sheen, like glass. */
  glass: boolean;
}

export interface PopupStyleRow {
  iid: string;
  kind: StyleKind;
  name: string;
  nameAr: string;
  config: PopupThemeConfig | PopupFrameConfig;
  isActive: boolean;
  archivedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

/** What a pop-up renders with: the active theme and (maybe) its frame. */
export interface PopupLook {
  theme: PopupThemeConfig | null;
  frame: PopupFrameConfig | null;
}

// ─── Part catalogue (editor + guides) ──────────────────────────

export interface PartSpec {
  key: ThemePartKey;
  label: string;
  hint: string;
  /** The canvas it is drawn on (px). */
  canvas: { w: number; h: number };
  group: "sheet" | "pages" | "dialogue";
}

export const THEME_PARTS: PartSpec[] = [
  {
    key: "panel",
    label: "Panel",
    hint: "The sheet itself. Its edges stretch around any content (set where they are by dragging the guides).",
    canvas: { w: 900, h: 700 },
    group: "sheet",
  },
  { key: "close", label: "Close button", hint: "Shown top corner of every pop-up.", canvas: { w: 160, h: 160 }, group: "sheet" },
  {
    key: "titleStrip",
    label: "Title strip",
    hint: "Behind the pop-up title; stretched to the title's width.",
    canvas: { w: 1000, h: 180 },
    group: "sheet",
  },
  {
    key: "prev",
    label: "Previous arrow",
    hint: "Turning back a page (mirrored automatically in Arabic).",
    canvas: { w: 160, h: 160 },
    group: "pages",
  },
  {
    key: "next",
    label: "Next arrow",
    hint: "Turning forward a page. Not drawn = the previous arrow, flipped.",
    canvas: { w: 160, h: 160 },
    group: "pages",
  },
  {
    key: "pageTurn",
    label: "Page corner",
    hint: "A curled corner at the bottom of each page that turns it.",
    canvas: { w: 240, h: 240 },
    group: "pages",
  },
  {
    key: "dialogueBox",
    label: "Dialogue box",
    hint: "Characters' speech at the bottom of the screen. Its edges stretch like the panel's (set them with the guides).",
    canvas: { w: 1400, h: 360 },
    group: "dialogue",
  },
  { key: "namePlate", label: "Name plate", hint: "The speaker's name above the box.", canvas: { w: 520, h: 140 }, group: "dialogue" },
  { key: "dialogueNext", label: "Next mark", hint: "The little 'more' arrow in the box.", canvas: { w: 120, h: 120 }, group: "dialogue" },
  { key: "choiceButton", label: "Choice button", hint: "Each answer a visitor can pick.", canvas: { w: 700, h: 140 }, group: "dialogue" },
];

export const FRAME_CANVAS = { w: 1200, h: 900 };

// ─── Defaults + normalising (stored JSON is never trusted) ──────

export function defaultThemeConfig(): PopupThemeConfig {
  return {
    version: 1,
    parts: {},
    panelSlice: { top: 120, right: 120, bottom: 120, left: 120 },
    panelScale: 0.5,
    panelRepeat: "stretch",
    dialogueSlice: { top: 90, right: 120, bottom: 90, left: 120 },
    ink: "",
    inkSoft: "",
  };
}

export function defaultFrameConfig(): PopupFrameConfig {
  return {
    version: 1,
    art: null,
    screen: { x: 12, y: 12, w: 76, h: 66 },
    phone: "sheet",
    background: "",
    ink: "dark",
    artOver: false,
    radius: 24,
    glass: true,
  };
}

const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function art(v: unknown): DrawnArt | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (typeof a.url !== "string" || !a.url) return null;
  return {
    url: a.url,
    ...(typeof a.sceneId === "string" && a.sceneId ? { sceneId: a.sceneId } : {}),
    w: num(a.w, 0, 0, 10000),
    h: num(a.h, 0, 0, 10000),
  };
}

const PART_KEYS = new Set<string>(THEME_PARTS.map((p) => p.key));

export function normalizeTheme(raw: unknown): PopupThemeConfig {
  const d = defaultThemeConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const parts: PopupThemeConfig["parts"] = {};
  for (const [k, v] of Object.entries((r.parts as Record<string, unknown>) ?? {})) {
    const a = art(v);
    if (PART_KEYS.has(k) && a) parts[k as ThemePartKey] = a;
  }
  const s = (r.panelSlice as Record<string, unknown>) ?? {};
  const ds = (r.dialogueSlice as Record<string, unknown>) ?? {};
  return {
    version: 1,
    parts,
    panelSlice: {
      top: num(s.top, d.panelSlice.top, 0, 5000),
      right: num(s.right, d.panelSlice.right, 0, 5000),
      bottom: num(s.bottom, d.panelSlice.bottom, 0, 5000),
      left: num(s.left, d.panelSlice.left, 0, 5000),
    },
    panelScale: num(r.panelScale, d.panelScale, 0.2, 1),
    panelRepeat: r.panelRepeat === "round" ? "round" : "stretch",
    dialogueSlice: {
      top: num(ds.top, d.dialogueSlice.top, 0, 5000),
      right: num(ds.right, d.dialogueSlice.right, 0, 5000),
      bottom: num(ds.bottom, d.dialogueSlice.bottom, 0, 5000),
      left: num(ds.left, d.dialogueSlice.left, 0, 5000),
    },
    ink: str(r.ink),
    inkSoft: str(r.inkSoft),
  };
}

export function normalizeFrame(raw: unknown): PopupFrameConfig {
  const d = defaultFrameConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const s = (r.screen as Record<string, unknown>) ?? {};
  const x = num(s.x, d.screen.x, 0, 95);
  const y = num(s.y, d.screen.y, 0, 95);
  return {
    version: 1,
    art: art(r.art),
    screen: { x, y, w: num(s.w, d.screen.w, 5, 100 - x), h: num(s.h, d.screen.h, 5, 100 - y) },
    phone: r.phone === "keep" ? "keep" : "sheet",
    background: str(r.background),
    ink: r.ink === "light" ? "light" : "dark",
    artOver: r.artOver === true,
    radius: num(r.radius, d.radius, 0, 400),
    glass: r.glass !== false,
  };
}

export function normalizeConfig(kind: StyleKind, raw: unknown): PopupThemeConfig | PopupFrameConfig {
  return kind === "theme" ? normalizeTheme(raw) : normalizeFrame(raw);
}
