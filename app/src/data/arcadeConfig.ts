// Arcade scene config — the authorable hero (schemaVersion 8).
//
// The arcade section (`DrawnSection.containsGame`) is a layered SCENE viewed
// through a CAMERA:
//
//   world   — a fixed coordinate space the size of the section's aspectRatio
//             (default 1520×960). Scene assets AND the machine are placed in
//             it in % — one drawing, the same spot on every device.
//   machine — ONE grouped object: back art → live game screen → front art.
//             z-ordered among the scene assets (zIndex), so props can sit
//             behind it or in front of the screen (a dangling wire, a paper).
//   camera  — {scale, focus, rotation}: which part of the world fills the
//             device's frame. Each device has a REST camera (its framing of
//             the world — "reframe the same drawing" on phones) plus scroll
//             keyframes; the click-to-play camera is computed (auto-fit the
//             screen, level any machine tilt).
//
// Stored on the section as `arcade?: ArcadeConfig` (all fields optional in
// storage); every reader goes through `resolveArcade()`, which deep-merges the
// defaults below. The defaults reproduce the pre-v8 hardcoded cabinet
// (the old CABINET_CONFIG + useLandingMotion scrub), so a page with no saved
// arcade config renders as it always did — and changing a default later
// reaches every page that never touched that field.

/** A drawn or uploaded image used by the arcade. Natural size drives the
 *  sharpness budget (how far it can be zoomed before it blurs). */
export interface ArcadeArt {
  kind: "drawn" | "upload";
  url: string;
  /** Drawing Studio scene id (layered PSD kept in `drawing-scenes`). */
  sceneId?: string;
  naturalW: number;
  naturalH: number;
}

/**
 * A camera framing of the world. `focusX/Y` (% of the world) is the point that
 * sits at the centre of the device frame; `scale` 1 = the whole world fitted
 * ("contain") in the frame; `rotation` (deg) tilts the view around the focus.
 */
export interface ArcadeCamera {
  scale: number;
  focusX: number;
  focusY: number;
  rotation: number;
}

/** GSAP ease names offered in the editor. */
export const ARCADE_EASES = [
  "none",
  "sine.inOut",
  "power1.inOut",
  "power2.inOut",
  "power2.out",
  "power2.in",
  "power3.out",
  "expo.out",
] as const;
export type ArcadeEase = (typeof ARCADE_EASES)[number];

export interface ArcadeKeyframe {
  /** Scroll progress 0–1 through the hero (0 = the rest camera). */
  at: number;
  camera: ArcadeCamera;
  /** Ease of the segment arriving at this keyframe. */
  ease: ArcadeEase;
}

export interface ArcadeDevice {
  /** The device's window onto the world. `aspect` is fitted ("contain") into
   *  the viewport; `fill` paints any letterbox (transparent = hero paper). */
  frame: { aspect: { w: number; h: number }; fill: string };
  /** Framing before any scroll, and the static framing under reduced motion. */
  rest: ArcadeCamera;
  scroll: {
    enabled: boolean;
    /** Scroll distance of the zoom, in % of the viewport height. Desktop pins
     *  the hero for this long; phones never pin (the zoom plays as the hero
     *  scrolls past). */
    lengthVh: number;
    /** Scrub smoothing in seconds (0 = locked to the scrollbar). */
    smoothing: number;
    /** Ordered by `at`; the rest camera is the implicit `at: 0`. */
    keyframes: ArcadeKeyframe[];
  };
  /** Click-to-play zoom (desktop; phones break the screen out fullscreen). */
  play: {
    /** Share of the viewport the screen fills when zoomed in (0.3–0.95). */
    screenFill: number;
    /** Seconds. */
    duration: number;
    ease: ArcadeEase;
  };
  /** Per-device machine placement override; unset fields use the base. */
  machine?: Partial<Pick<ArcadeMachine, "x" | "y" | "w" | "rotation">>;
}

export interface AmbientPreset {
  kind: "sway" | "float" | "flicker" | "pulse";
  /** Which devices play it. Default both. */
  devices?: "both" | "desktop" | "mobile";
  /** 0–1 → how far it moves / how much it fades. */
  strength: number;
  /** Seconds per cycle. */
  speed: number;
  /** Pivot for sway, % of the element box. */
  pivotX: number;
  pivotY: number;
}

export type ArcadeHover = "none" | "glow" | "nudge" | "lift";

/** One drawing of the machine: its layers, shared canvas and screen rect. */
export interface MachineArt {
  back: ArcadeArt | null;
  front: ArcadeArt | null;
  canvas: { w: number; h: number };
  screen: { x: number; y: number; w: number };
}

export interface ArcadeMachine {
  /** Art drawn BEHIND the game screen (the cabinet body). null = built-in. */
  back: ArcadeArt | null;
  /** Art drawn IN FRONT of the screen (bezel, glare, a drooping paper…).
   *  Click-through while playing. */
  front: ArcadeArt | null;
  /** Shared drawing size — both layers are drawn on (and stretched to) this
   *  canvas, so they always align. Its aspect is the machine's aspect. */
  canvas: { w: number; h: number };
  /** Game screen rect, % of the machine box. Height is locked to the game's
   *  19:12 aspect (derived, never stored). */
  screen: { x: number; y: number; w: number };
  /** Placement in the world (% — x/w of world width, y of world height). */
  x: number;
  y: number;
  w: number;
  rotation: number;
  zIndex: number;
  hover: ArcadeHover;
  ambient: AmbientPreset | null;
  shadow: boolean;
  /** Optional separate drawing for phones (its own layers, shape and screen
   *  rect). null = phones show the same machine art as desktop. */
  phoneArt: MachineArt | null;
  /** Editor-only layer lock: the cabinet can't be moved / scaled / rotated on
   *  the canvas. Absent = free. The public scene never reads it. */
  locked?: boolean;
}

export interface ArcadeGuards {
  /** Clamp the click-in zoom so art never shows past its drawn pixels. */
  sharpness: boolean;
  /** Warn when the machine leaves a device frame. */
  onStage: boolean;
  /** Auto-fade props covering more than `foregroundFadePct` of the screen
   *  while playing. */
  foregroundFade: boolean;
  foregroundFadePct: number;
  /** Warn when the arcade's images exceed this many MB. */
  weightBudgetMb: number;
}

export interface ArcadeConfig {
  machine: ArcadeMachine;
  /** "Click to play" art over the screen, per language. null = built-in. */
  cta: { en: ArcadeArt | null; ar: ArcadeArt | null; pulse: boolean };
  /** Still shown in the screen until the game has booted. */
  poster: ArcadeArt | null;
  desktop: ArcadeDevice;
  mobile: ArcadeDevice;
  guards: ArcadeGuards;
  /** Skins for the play-mode UI (✕, in-game buttons, hint texts). */
  chrome: ArcadeChrome;
  /** Soft edges (default on): on a window wider than the device frame the
   *  scene's left / right edges fade into the page instead of ending in a hard
   *  vertical cut, and a backdrop that doesn't reach past the furthest view
   *  fades at its own edges. The safety net for every screen shape. */
  softEdges: boolean;
}

/** Stored shape — anything may be missing; `resolveArcade` fills it. */
export type StoredArcadeConfig = {
  machine?: Partial<Omit<ArcadeMachine, "phoneArt">> & { phoneArt?: Partial<MachineArt> | null };
  cta?: Partial<ArcadeConfig["cta"]>;
  poster?: ArcadeArt | null;
  desktop?: StoredArcadeDevice;
  mobile?: StoredArcadeDevice;
  guards?: Partial<ArcadeGuards>;
  chrome?: ArcadeChrome;
  softEdges?: boolean;
};
export type StoredArcadeDevice = {
  frame?: Partial<ArcadeDevice["frame"]>;
  rest?: Partial<ArcadeCamera>;
  scroll?: Partial<ArcadeDevice["scroll"]>;
  play?: Partial<ArcadeDevice["play"]>;
  machine?: ArcadeDevice["machine"];
};

import type { ArcadeChrome } from "./chromeSkin";

// ─── Constants ──────────────────────────────────────────────────

/** The game canvas — the screen rect is always this aspect. */
export const GAME_SCREEN_ASPECT = 1520 / 960;

/** Built-in art shipped in /public/landing: Kenney's arcade machine
 *  (app/scripts/starter-art/build_landing.py) and the "click to play" card. */
export const BUILTIN_MACHINE_BACK = "/landing/machine.png";
export const BUILTIN_CTA = {
  en: "/landing/cta-en.svg",
  ar: "/landing/cta-ar.svg",
} as const;

/** Below this viewport width the arcade uses its MOBILE device config (the
 *  same breakpoint where play mode breaks out fullscreen). The editor's
 *  390px phone view resolves the same way through the world's @container. */
export const ARCADE_MOBILE_MAX_PX = 1023;
export const ARCADE_MOBILE_QUERY = `(max-width: ${ARCADE_MOBILE_MAX_PX}px)`;

/** Sentinel selection id for the machine in the editor's asset selection. */
export const ARCADE_MACHINE_IID = "__arcade_machine__";

export const IDENTITY_CAMERA: ArcadeCamera = {
  scale: 1,
  focusX: 50,
  focusY: 50,
  rotation: 0,
};

// ─── Defaults (reproduce the pre-v8 hardcoded hero) ─────────────
//
// Desktop: the cabinet was ~68% of a 100svh hero tall, centred; the scrub zoomed
// 1 → 0.45 around the screen and drifted up. Phones: the cabinet was 92% of a
// contained 1520×960 stage, no scroll zoom.

export const DEFAULT_ARCADE: ArcadeConfig = {
  machine: {
    back: null,
    front: null,
    // The built-in machine (build_landing.py prints canvas + screen).
    canvas: { w: 764, h: 1153 },
    screen: { x: 12.7, y: 23.8, w: 74.61 },
    // 82% of the stage's height: 0.82 × 960 × 764 / 1153 / 1520 = 34.3% wide.
    x: 32.85,
    y: 9,
    w: 34.3,
    rotation: 0,
    zIndex: 0,
    hover: "none",
    ambient: null,
    shadow: true,
    phoneArt: null,
  },
  cta: { en: null, ar: null, pulse: true },
  poster: null,
  desktop: {
    frame: { aspect: { w: 1520, h: 960 }, fill: "transparent" },
    rest: { ...IDENTITY_CAMERA },
    scroll: {
      enabled: true,
      lengthVh: 180,
      smoothing: 1,
      keyframes: [
        { at: 0.5, camera: { scale: 0.45, focusX: 50, focusY: 81.7, rotation: 0 }, ease: "none" },
        { at: 1, camera: { scale: 0.45, focusX: 50, focusY: 93.8, rotation: 0 }, ease: "none" },
      ],
    },
    play: { screenFill: 0.62, duration: 1, ease: "power2.out" },
  },
  mobile: {
    frame: { aspect: { w: 1520, h: 960 }, fill: "transparent" },
    rest: { ...IDENTITY_CAMERA },
    scroll: {
      enabled: false,
      lengthVh: 100,
      smoothing: 0.5,
      keyframes: [
        { at: 1, camera: { scale: 0.8, focusX: 50, focusY: 50, rotation: 0 }, ease: "none" },
      ],
    },
    play: { screenFill: 0.9, duration: 0.6, ease: "power2.out" },
    // 92% of the world's height: 0.92 × 960 × 764 / 1153 / 1520 = 38.5% wide.
    machine: { x: 30.75, y: 4, w: 38.5 },
  },
  guards: {
    sharpness: true,
    onStage: true,
    foregroundFade: true,
    foregroundFadePct: 15,
    weightBudgetMb: 3,
  },
  chrome: {},
  softEdges: true,
};

// ─── Resolve ────────────────────────────────────────────────────

const num = (v: unknown, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

function resolveCamera(c: Partial<ArcadeCamera> | undefined, d: ArcadeCamera): ArcadeCamera {
  return {
    scale: Math.max(0.05, num(c?.scale, d.scale)),
    focusX: num(c?.focusX, d.focusX),
    focusY: num(c?.focusY, d.focusY),
    rotation: num(c?.rotation, d.rotation),
  };
}

function resolveDevice(s: StoredArcadeDevice | undefined, d: ArcadeDevice): ArcadeDevice {
  const kfs = Array.isArray(s?.scroll?.keyframes) ? s.scroll.keyframes : d.scroll.keyframes;
  return {
    frame: {
      aspect: {
        w: Math.max(1, num(s?.frame?.aspect?.w, d.frame.aspect.w)),
        h: Math.max(1, num(s?.frame?.aspect?.h, d.frame.aspect.h)),
      },
      fill: typeof s?.frame?.fill === "string" ? s.frame.fill : d.frame.fill,
    },
    rest: resolveCamera(s?.rest, d.rest),
    scroll: {
      enabled: typeof s?.scroll?.enabled === "boolean" ? s.scroll.enabled : d.scroll.enabled,
      lengthVh: Math.max(20, num(s?.scroll?.lengthVh, d.scroll.lengthVh)),
      smoothing: Math.max(0, num(s?.scroll?.smoothing, d.scroll.smoothing)),
      keyframes: kfs
        .map((k) => ({
          at: Math.min(1, Math.max(0.01, num(k?.at, 1))),
          camera: resolveCamera(k?.camera, IDENTITY_CAMERA),
          ease: (ARCADE_EASES as readonly string[]).includes(k?.ease) ? k.ease : "none",
        }))
        .sort((a, b) => a.at - b.at),
    },
    play: {
      screenFill: Math.min(0.98, Math.max(0.2, num(s?.play?.screenFill, d.play.screenFill))),
      duration: Math.max(0.1, num(s?.play?.duration, d.play.duration)),
      ease: (ARCADE_EASES as readonly string[]).includes(s?.play?.ease as string)
        ? (s!.play!.ease as ArcadeEase)
        : d.play.ease,
    },
    // A stored device override replaces the default one wholesale (an author
    // who resets it gets the base placement, not the seeded phone placement).
    machine: s && "machine" in s ? s.machine : d.machine,
  };
}

/** The full, defaulted arcade config for a section's stored `arcade` field. */
export function resolveArcade(stored: StoredArcadeConfig | undefined | null): ArcadeConfig {
  const s = stored ?? {};
  const m = s.machine ?? {};
  const dm = DEFAULT_ARCADE.machine;
  const isArt = (a: unknown): a is ArcadeArt =>
    !!a && typeof (a as ArcadeArt).url === "string" && (a as ArcadeArt).url.length > 0;
  return {
    machine: {
      back: isArt(m.back) ? m.back : null,
      front: isArt(m.front) ? m.front : null,
      canvas: {
        w: Math.max(1, num(m.canvas?.w, dm.canvas.w)),
        h: Math.max(1, num(m.canvas?.h, dm.canvas.h)),
      },
      screen: {
        x: num(m.screen?.x, dm.screen.x),
        y: num(m.screen?.y, dm.screen.y),
        w: Math.max(1, num(m.screen?.w, dm.screen.w)),
      },
      x: num(m.x, dm.x),
      y: num(m.y, dm.y),
      w: Math.max(1, num(m.w, dm.w)),
      rotation: num(m.rotation, dm.rotation),
      zIndex: num(m.zIndex, dm.zIndex),
      hover: (["none", "glow", "nudge", "lift"] as const).includes(m.hover as ArcadeHover)
        ? (m.hover as ArcadeHover)
        : dm.hover,
      ambient: m.ambient && typeof m.ambient === "object" ? m.ambient : null,
      shadow: typeof m.shadow === "boolean" ? m.shadow : dm.shadow,
      ...(m.locked === true ? { locked: true } : {}),
      phoneArt:
        m.phoneArt && typeof m.phoneArt === "object"
          ? {
              back: isArt(m.phoneArt.back) ? m.phoneArt.back : null,
              front: isArt(m.phoneArt.front) ? m.phoneArt.front : null,
              canvas: {
                w: Math.max(1, num(m.phoneArt.canvas?.w, m.canvas?.w ?? dm.canvas.w)),
                h: Math.max(1, num(m.phoneArt.canvas?.h, m.canvas?.h ?? dm.canvas.h)),
              },
              screen: {
                x: num(m.phoneArt.screen?.x, m.screen?.x ?? dm.screen.x),
                y: num(m.phoneArt.screen?.y, m.screen?.y ?? dm.screen.y),
                w: Math.max(1, num(m.phoneArt.screen?.w, m.screen?.w ?? dm.screen.w)),
              },
            }
          : null,
    },
    cta: {
      en: isArt(s.cta?.en) ? s.cta.en : null,
      ar: isArt(s.cta?.ar) ? s.cta.ar : null,
      pulse: typeof s.cta?.pulse === "boolean" ? s.cta.pulse : DEFAULT_ARCADE.cta.pulse,
    },
    poster: isArt(s.poster) ? s.poster : null,
    desktop: resolveDevice(s.desktop, DEFAULT_ARCADE.desktop),
    mobile: resolveDevice(s.mobile, DEFAULT_ARCADE.mobile),
    chrome: s.chrome && typeof s.chrome === "object" ? s.chrome : {},
    softEdges: typeof s.softEdges === "boolean" ? s.softEdges : DEFAULT_ARCADE.softEdges,
    guards: {
      sharpness: s.guards?.sharpness ?? DEFAULT_ARCADE.guards.sharpness,
      onStage: s.guards?.onStage ?? DEFAULT_ARCADE.guards.onStage,
      foregroundFade: s.guards?.foregroundFade ?? DEFAULT_ARCADE.guards.foregroundFade,
      foregroundFadePct: num(s.guards?.foregroundFadePct, DEFAULT_ARCADE.guards.foregroundFadePct),
      weightBudgetMb: num(s.guards?.weightBudgetMb, DEFAULT_ARCADE.guards.weightBudgetMb),
    },
  };
}

// ─── Geometry helpers (all in % of the world unless noted) ──────

export type ArcadeDeviceKey = "desktop" | "mobile";

/** The machine's placement on a device (base + that device's override). */
export function machinePlacement(a: ArcadeConfig, device: ArcadeDeviceKey) {
  const o = a[device].machine ?? {};
  return {
    x: o.x ?? a.machine.x,
    y: o.y ?? a.machine.y,
    w: o.w ?? a.machine.w,
    rotation: o.rotation ?? a.machine.rotation,
  };
}

/** The machine drawing a device shows (phones may have their own). */
export function machineVariant(a: ArcadeConfig, device: ArcadeDeviceKey = "desktop"): MachineArt {
  if (device === "mobile" && a.machine.phoneArt) return a.machine.phoneArt;
  return {
    back: a.machine.back,
    front: a.machine.front,
    canvas: a.machine.canvas,
    screen: a.machine.screen,
  };
}

/** Machine aspect (width / height), from the shared drawing canvas. */
export function machineAspect(a: ArcadeConfig, device: ArcadeDeviceKey = "desktop"): number {
  const c = machineVariant(a, device).canvas;
  return c.w / c.h;
}

/** Screen height as % of the machine box (locked to the game's 19:12). */
export function screenHeightPct(a: ArcadeConfig, device: ArcadeDeviceKey = "desktop"): number {
  return (machineVariant(a, device).screen.w * machineAspect(a, device)) / GAME_SCREEN_ASPECT;
}

/**
 * The machine box and its screen rect in WORLD % (unrotated box + rotation),
 * plus the screen's centre after the machine's rotation — the click-in focus.
 */
export function machineGeometry(
  a: ArcadeConfig,
  device: ArcadeDeviceKey,
  world: { w: number; h: number }
) {
  const p = machinePlacement(a, device);
  const W = world.w;
  const H = world.h;
  // Work in world units, report in %.
  const v = machineVariant(a, device);
  const mw = (p.w / 100) * W;
  const mh = mw / machineAspect(a, device);
  const mx = (p.x / 100) * W;
  const my = (p.y / 100) * H;
  const sw = (v.screen.w / 100) * mw;
  const sh = sw / GAME_SCREEN_ASPECT;
  const sx = (v.screen.x / 100) * mw;
  const sy = (v.screen.y / 100) * mh;
  // Screen centre relative to the machine centre, rotated with the machine.
  const lx = sx + sw / 2 - mw / 2;
  const ly = sy + sh / 2 - mh / 2;
  const r = (p.rotation * Math.PI) / 180;
  const cx = mx + mw / 2 + lx * Math.cos(r) - ly * Math.sin(r);
  const cy = my + mh / 2 + lx * Math.sin(r) + ly * Math.cos(r);
  return {
    placement: p,
    /** Machine box, % of world (h is % of world height). */
    box: { x: p.x, y: p.y, w: p.w, h: (mh / H) * 100 },
    /** Screen size in world units (for zoom math). */
    screenUnits: { w: sw, h: sh },
    /** Screen centre, % of world (rotation applied). */
    screenCentre: { x: (cx / W) * 100, y: (cy / H) * 100 },
    rotation: p.rotation,
  };
}
