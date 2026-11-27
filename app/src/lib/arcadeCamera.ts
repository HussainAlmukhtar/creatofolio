// Arcade camera maths — pure functions shared by the public runtime
// (CabinetStage's click-in, useLandingMotion's scroll keyframes) and the
// editor (frame rectangles, scrub preview).
//
// The camera is applied as CSS on `.arcade-world` (see globals.css):
//
//   transform-origin: F
//   transform: translate(px, py) translate(-F) rotate(r) scale(s)
//
// With the world's top-left pinned to the stage centre, that puts world point
// F (focusX/Y, % of the world) at the stage centre, scaled by s and rotated by
// r around it. (px, py) is an extra screen-space offset, used only by the
// click-in to centre the screen in the VIEWPORT when the stage isn't.

import gsap from "gsap";
import type {
  ArcadeCamera,
  ArcadeConfig,
  ArcadeDevice,
  ArcadeDeviceKey,
  ArcadeEase,
  ArcadeKeyframe,
} from "@/data/arcadeConfig";
import { machineGeometry } from "@/data/arcadeConfig";

export interface CameraPx {
  /** Screen-space offset in px (click-in only). */
  px: number;
  py: number;
}

/** CSS custom properties for a camera — set on `.arcade-world`. */
export function cameraVars(c: ArcadeCamera, off: CameraPx = { px: 0, py: 0 }) {
  return {
    "--cam-s": String(c.scale),
    "--cam-x": String(c.focusX),
    "--cam-y": String(c.focusY),
    "--cam-r": String(c.rotation),
    "--cam-px": `${off.px}px`,
    "--cam-py": `${off.py}px`,
  } as const;
}

/** Write a camera onto an element's inline style. */
export function applyCamera(el: HTMLElement, c: ArcadeCamera, off?: CameraPx) {
  const vars = cameraVars(c, off);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/** Remove inline camera vars → the element falls back to the CSS rest camera. */
export function clearCamera(el: HTMLElement) {
  for (const k of ["--cam-s", "--cam-x", "--cam-y", "--cam-r", "--cam-px", "--cam-py"]) {
    el.style.removeProperty(k);
  }
}

/** Read the camera currently in effect on an element (inline or CSS rest). */
export function readCamera(el: HTMLElement): { cam: ArcadeCamera; off: CameraPx } {
  const cs = getComputedStyle(el);
  const n = (k: string, d: number) => {
    const v = parseFloat(cs.getPropertyValue(k));
    return Number.isFinite(v) ? v : d;
  };
  return {
    cam: {
      scale: n("--cam-s", 1),
      focusX: n("--cam-x", 50),
      focusY: n("--cam-y", 50),
      rotation: n("--cam-r", 0),
    },
    off: { px: n("--cam-px", 0), py: n("--cam-py", 0) },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Blend two cameras. Scale interpolates in LOG space, so a long zoom
 * (×0.3 → ×3) moves at an even perceived speed instead of rushing the
 * zoomed-out end.
 */
export function mixCamera(a: ArcadeCamera, b: ArcadeCamera, t: number): ArcadeCamera {
  return {
    scale: Math.exp(lerp(Math.log(a.scale), Math.log(b.scale), t)),
    focusX: lerp(a.focusX, b.focusX, t),
    focusY: lerp(a.focusY, b.focusY, t),
    rotation: lerp(a.rotation, b.rotation, t),
  };
}

export function mixOffset(a: CameraPx, b: CameraPx, t: number): CameraPx {
  return { px: lerp(a.px, b.px, t), py: lerp(a.py, b.py, t) };
}

const easeFns = new Map<string, (t: number) => number>();
export function easeFn(name: ArcadeEase): (t: number) => number {
  let f = easeFns.get(name);
  if (!f) {
    f = (gsap.parseEase(name) as ((t: number) => number) | undefined) ?? ((t) => t);
    easeFns.set(name, f);
  }
  return f;
}

/** The rest camera as the implicit `at: 0` keyframe, then the authored ones. */
export function timelineFrames(device: ArcadeDevice): ArcadeKeyframe[] {
  return [
    { at: 0, camera: device.rest, ease: "none" },
    ...device.scroll.keyframes.filter((k) => k.at > 0),
  ];
}

/** Camera at scroll progress `at` (0–1) through a device's keyframes. */
export function cameraAt(device: ArcadeDevice, at: number): ArcadeCamera {
  const frames = timelineFrames(device);
  if (frames.length === 1 || at <= 0) return frames[0].camera;
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const next = frames[i];
    if (at <= next.at) {
      const span = Math.max(1e-6, next.at - prev.at);
      const local = Math.min(1, Math.max(0, (at - prev.at) / span));
      return mixCamera(prev.camera, next.camera, easeFn(next.ease)(local));
    }
  }
  return frames[frames.length - 1].camera;
}

/**
 * How much of the world a camera shows, in world % — the frame rectangle the
 * editor draws (centre, size, rotation). `scale: 1` = the world fitted
 * ("contain") into a frame of `frameAspect`.
 */
export function frameRect(
  cam: ArcadeCamera,
  frameAspect: number,
  worldAspect: number
): { cx: number; cy: number; w: number; h: number; rotation: number } {
  // Fraction of the world visible at scale 1 along each axis.
  const fw = frameAspect >= worldAspect ? frameAspect / worldAspect : 1;
  const fh = frameAspect >= worldAspect ? 1 : worldAspect / frameAspect;
  return {
    cx: cam.focusX,
    cy: cam.focusY,
    w: (fw / cam.scale) * 100,
    h: (fh / cam.scale) * 100,
    // The camera rotates the WORLD by r, so the frame sits at −r on it.
    rotation: -cam.rotation,
  };
}

/** Inverse of frameRect: the camera that shows a given frame rectangle. */
export function cameraFromFrame(
  rect: { cx: number; cy: number; w: number; rotation: number },
  frameAspect: number,
  worldAspect: number
): ArcadeCamera {
  const fw = frameAspect >= worldAspect ? frameAspect / worldAspect : 1;
  return {
    scale: Math.max(0.05, (fw * 100) / Math.max(0.01, rect.w)),
    focusX: rect.cx,
    focusY: rect.cy,
    rotation: -rect.rotation,
  };
}

/**
 * Largest camera scale at which an image still has ≥ `dpr` real pixels per
 * CSS pixel. `displayedPxAtScale1` = its layout width at camera scale 1.
 * Vector art (SVG) never runs out of pixels.
 */
export function maxSharpScale(
  naturalW: number | undefined,
  displayedPxAtScale1: number,
  dpr: number,
  url?: string
): number {
  if (url && /\.svg(\?|#|$)/i.test(url)) return Infinity;
  if (!naturalW || displayedPxAtScale1 <= 0) return Infinity;
  return naturalW / (displayedPxAtScale1 * dpr);
}

/**
 * The click-to-play camera: auto-fit the machine's screen so it fills
 * `screenFill` of the viewport, level any machine tilt, and centre it in the
 * viewport (the px offset corrects for a stage that isn't viewport-centred).
 */
export function playCamera(opts: {
  arcade: ArcadeConfig;
  device: ArcadeDeviceKey;
  world: { w: number; h: number };
  /** Layout (untransformed) width of `.arcade-world` in px. */
  worldPxW: number;
  /** Stage centre in viewport px. */
  stageCentre: { x: number; y: number };
  viewport: { w: number; h: number };
  /** Optional cap from the sharpness guard. */
  maxScale?: number;
}): { cam: ArcadeCamera; off: CameraPx } {
  const { arcade, device, world, worldPxW, stageCentre, viewport } = opts;
  const g = machineGeometry(arcade, device, world);
  const pxPerUnit = worldPxW / world.w;
  const screenW1 = g.screenUnits.w * pxPerUnit;
  const screenH1 = g.screenUnits.h * pxPerUnit;
  const fill = arcade[device].play.screenFill;
  let scale = fill * Math.min(viewport.w / screenW1, viewport.h / screenH1);
  if (opts.maxScale && Number.isFinite(opts.maxScale)) scale = Math.min(scale, opts.maxScale);
  scale = Math.max(0.05, scale);
  return {
    cam: {
      scale,
      focusX: g.screenCentre.x,
      focusY: g.screenCentre.y,
      rotation: -g.rotation,
    },
    off: {
      px: viewport.w / 2 - stageCentre.x,
      py: viewport.h / 2 - stageCentre.y,
    },
  };
}

/** Largest camera scale any keyframe / the rest camera reaches on a device. */
export function maxScrollScale(device: ArcadeDevice): number {
  return Math.max(
    device.rest.scale,
    ...(device.scroll.enabled ? device.scroll.keyframes.map((k) => k.camera.scale) : [])
  );
}
