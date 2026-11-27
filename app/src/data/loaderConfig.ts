// Loading screen ("welcome" intro) — shown over the public site while the
// first page load settles, then it opens onto the page.
//
// Lives in SiteConfig.loader (website_site_config), so it is live-on-save
// like the rest of the site settings and needs no migration. Absent = the
// default: ON with "The book" preset (turning it off in the editor stores
// `enabled: false`).
// Edited at /admin/loading-screen (components/loading-screen/).
//
// Every drawable slot falls back to a built-in doodle placeholder
// (components/landing/loader/LoaderArt.tsx) until the site owner draws or uploads
// their own art for it, so a preset always looks finished.

import type { Localized } from "./landingTypes";
import type { DrawnArt } from "./popupStyleTypes";

export type LoaderPreset = "spin" | "hop" | "scribble" | "flipbook" | "orbit" | "book";
/** How the screen leaves once the page is ready. */
export type LoaderExit = "fade" | "curtain" | "book" | "iris";
export type LoaderProgress = "none" | "line" | "dots" | "percent";
export type LoaderPaper = "sketchbook" | "coldpress" | "kraft" | "newsprint" | "flat";
/** Drawable slots. Shared across presets, so switching preset keeps drawings
 *  that fit (the main character stays the main character). */
export type LoaderSlot = "main" | "f1" | "f2" | "f3" | "f4" | "o1" | "o2" | "o3" | "cover";

export interface LoaderConfig {
  enabled: boolean;
  preset: LoaderPreset;
  /** Missing slot = the built-in placeholder doodle. */
  art: Partial<Record<LoaderSlot, DrawnArt>>;
  caption: Localized;
  paper: LoaderPaper;
  /** "" = the paper's own colour. */
  background: string;
  /** "" = the site's ink. Colours the placeholders, caption and progress. */
  ink: string;
  progress: LoaderProgress;
  exit: LoaderExit;
  /** Animation speed multiplier, 0.5–2. */
  speed: number;
  /** Art size multiplier, 0.6–1.6. */
  size: number;
  /** Shortest time on screen (ms) so the animation reads even on a fast
   *  connection. The screen stays longer while the page is still loading. */
  minMs: number;
  /** "session" = only the first page load of a browser tab session. */
  showOn: "every" | "session";
  /** "home" = only the home page; "all" = any public page loaded directly. */
  pages: "home" | "all";
}

export interface LoaderSlotSpec {
  key: LoaderSlot;
  label: string;
  hint: string;
  /** Drawing canvas (px). */
  canvas: { w: number; h: number };
}

export interface LoaderPresetSpec {
  id: LoaderPreset;
  name: string;
  description: string;
  slots: LoaderSlotSpec[];
  /** Suggested exit when the preset is picked. */
  exit: LoaderExit;
}

const SQUARE = { w: 800, h: 800 };
const SMALL = { w: 400, h: 400 };

export const LOADER_PRESETS: LoaderPresetSpec[] = [
  {
    id: "spin",
    name: "Spinner",
    description: "One drawing turning round and round, like a coin or a pinwheel.",
    exit: "fade",
    slots: [{ key: "main", label: "The spinning drawing", hint: "Draw it centred: it turns around its middle.", canvas: SQUARE }],
  },
  {
    id: "hop",
    name: "Hop",
    description: "A little character bouncing in place, with a squash on landing and a shadow.",
    exit: "curtain",
    slots: [{ key: "main", label: "The character", hint: "Stand it on the bottom edge: it lands there.", canvas: SQUARE }],
  },
  {
    id: "scribble",
    name: "Being drawn",
    description: "The drawing appears stroke by stroke, rests, then rubs out and starts again.",
    exit: "iris",
    slots: [{ key: "main", label: "The drawing", hint: "It is revealed from left to right, like a pen going over it.", canvas: SQUARE }],
  },
  {
    id: "flipbook",
    name: "Flipbook",
    description: "Up to four frames played in a loop, like the corner of a notebook.",
    exit: "fade",
    slots: [1, 2, 3, 4].map((n) => ({
      key: `f${n}` as LoaderSlot,
      label: `Frame ${n}`,
      hint:
        n === 1
          ? "Draw each frame on the same spot. Only the frames you draw play (the doodle plays until you draw one)."
          : "Same canvas, next pose.",
      canvas: SQUARE,
    })),
  },
  {
    id: "orbit",
    name: "Orbit",
    description: "Your character in the middle, three little doodles circling around it.",
    exit: "iris",
    slots: [
      { key: "main", label: "Centre drawing", hint: "Bobs gently in the middle.", canvas: SQUARE },
      { key: "o1", label: "Orbiting doodle 1", hint: "Small things read best: a star, a pencil, a heart.", canvas: SMALL },
      { key: "o2", label: "Orbiting doodle 2", hint: "Stays upright while it circles.", canvas: SMALL },
      { key: "o3", label: "Orbiting doodle 3", hint: "Stays upright while it circles.", canvas: SMALL },
    ],
  },
  {
    id: "book",
    name: "The book",
    description: "A closed book that peeks open while loading, then its cover swings open onto the site.",
    exit: "book",
    slots: [{ key: "cover", label: "Book cover", hint: "The left edge is the spine: the cover opens from there.", canvas: { w: 600, h: 800 } }],
  },
];

export const LOADER_EXITS: { id: LoaderExit; name: string; description: string }[] = [
  { id: "fade", name: "Fade", description: "Fades away with a small zoom." },
  { id: "curtain", name: "Curtain", description: "Lifts up like a page being raised." },
  { id: "book", name: "Open the book", description: "Swings open like a book cover (from the right in Arabic)." },
  { id: "iris", name: "Ink hole", description: "A circle opens from the middle onto the page." },
];

export const LOADER_PAPERS: { id: LoaderPaper; name: string }[] = [
  { id: "sketchbook", name: "Sketchbook" },
  { id: "coldpress", name: "Cold press" },
  { id: "kraft", name: "Kraft" },
  { id: "newsprint", name: "Newsprint" },
  { id: "flat", name: "Flat colour" },
];

export function presetSpec(id: LoaderPreset): LoaderPresetSpec {
  return LOADER_PRESETS.find((p) => p.id === id) ?? LOADER_PRESETS[0];
}

export const DEFAULT_LOADER: LoaderConfig = {
  enabled: true,
  preset: "book",
  art: {},
  caption: { en: "Loading…", ar: "جارٍ التحميل…" },
  paper: "sketchbook",
  background: "",
  ink: "",
  progress: "line",
  exit: "book",
  speed: 1,
  size: 1,
  minMs: 1600,
  showOn: "every",
  pages: "home",
};

/** Exit animation length (ms), including the book cover opening first. */
export function exitDurationMs(c: Pick<LoaderConfig, "exit" | "preset">): number {
  const base = { fade: 650, curtain: 900, book: 1150, iris: 950 }[c.exit];
  return base + (c.preset === "book" ? 550 : 0);
}

const PRESET_IDS = LOADER_PRESETS.map((p) => p.id) as string[];
const EXIT_IDS = LOADER_EXITS.map((e) => e.id) as string[];
const PAPER_IDS = LOADER_PAPERS.map((p) => p.id) as string[];
const SLOT_IDS: LoaderSlot[] = ["main", "f1", "f2", "f3", "f4", "o1", "o2", "o3", "cover"];

const clamp = (n: unknown, lo: number, hi: number, d: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
const pick = <T extends string>(v: unknown, ids: string[], d: T): T =>
  typeof v === "string" && ids.includes(v) ? (v as T) : d;
const loc = (v: unknown, d: Localized): Localized =>
  v && typeof v === "object"
    ? { en: String((v as Localized).en ?? ""), ar: String((v as Localized).ar ?? "") }
    : d;

/** Deep-fill a stored (or hand-edited) loader blob. Absent → the default (on). */
export function normalizeLoader(raw: unknown): LoaderConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LOADER, art: {}, caption: { ...DEFAULT_LOADER.caption } };
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_LOADER;
  const art: LoaderConfig["art"] = {};
  const rawArt = (r.art && typeof r.art === "object" ? r.art : {}) as Record<string, unknown>;
  for (const k of SLOT_IDS) {
    const a = rawArt[k] as DrawnArt | undefined;
    if (a && typeof a.url === "string" && a.url) {
      art[k] = {
        url: a.url,
        ...(typeof a.sceneId === "string" && a.sceneId ? { sceneId: a.sceneId } : {}),
        w: clamp(a.w, 1, 10000, 800),
        h: clamp(a.h, 1, 10000, 800),
      };
    }
  }
  return {
    enabled: r.enabled === true,
    preset: pick(r.preset, PRESET_IDS, d.preset),
    art,
    caption: loc(r.caption, d.caption),
    paper: pick(r.paper, PAPER_IDS, d.paper),
    background: typeof r.background === "string" ? r.background : "",
    ink: typeof r.ink === "string" ? r.ink : "",
    progress: pick(r.progress, ["none", "line", "dots", "percent"], d.progress),
    exit: pick(r.exit, EXIT_IDS, d.exit),
    speed: clamp(r.speed, 0.5, 2, 1),
    size: clamp(r.size, 0.6, 1.6, 1),
    minMs: Math.round(clamp(r.minMs, 0, 5000, d.minMs)),
    showOn: r.showOn === "session" ? "session" : "every",
    pages: r.pages === "all" ? "all" : "home",
  };
}

/** Flipbook frames to play: the drawn ones, or every placeholder frame. */
export function flipbookFrames(c: LoaderConfig): { slot: LoaderSlot; art?: DrawnArt }[] {
  const slots: LoaderSlot[] = ["f1", "f2", "f3", "f4"];
  const drawn = slots.filter((s) => c.art[s]);
  return drawn.length ? drawn.map((s) => ({ slot: s, art: c.art[s] })) : slots.map((s) => ({ slot: s }));
}
