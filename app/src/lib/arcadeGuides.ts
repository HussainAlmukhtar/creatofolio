// Arcade drawing guides — the "safe area" template for drawing the backdrop.
//
// A backdrop is drawn at the arcade's MAXIMUM zoom-out: the canvas covers the
// union of every view any visitor can get (each device's rest framing, every
// scroll keyframe, the click-in view, and the world itself), so nothing ever
// shows an empty edge. Over it, a GUIDE layer (never saved) marks what each
// state shows — nested translucent frames like a banner safe-area template —
// plus the machine and its game screen, and the SAFE AREA everyone sees at
// rest.

import {
  machineGeometry,
  machineVariant,
  type ArcadeConfig,
  type ArcadeDeviceKey,
} from "@/data/arcadeConfig";
import { frameRect, maxScrollScale, playCamera } from "@/lib/arcadeCamera";
import { MAX_DRAW_SIDE, QUALITY_DPR, REFERENCE, worldPx } from "@/lib/arcadeQuality";

/** Axis-aligned rect in WORLD % (x/w of world width, y/h of world height). */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideFrame {
  label: string;
  device: ArcadeDeviceKey;
  kind: "rest" | "scroll" | "play";
  rect: WorldRect;
  /** Rotation of the view (deg) — drawn rotated, bounded axis-aligned. */
  rotation: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds of a rotated rect (centre, size in %, rotation). */
function aabb(cx: number, cy: number, w: number, h: number, rot: number, wa: number): WorldRect {
  // Rotate in true proportions (x% and y% have different units).
  const r = (rot * Math.PI) / 180;
  const W = w * wa; // width in "height-% units"
  const hw = (Math.abs(W * Math.cos(r)) + Math.abs(h * Math.sin(r))) / 2;
  const hh = (Math.abs(W * Math.sin(r)) + Math.abs(h * Math.cos(r))) / 2;
  return { x: cx - hw / wa, y: cy - hh, w: (2 * hw) / wa, h: 2 * hh };
}

/** A backdrop: bottom of the stack (behind the machine), drawn or uploaded,
 *  covering at least the whole drawing area. */
export function isBackdropAsset(
  a: { zIndex: number; x: number; y: number; w: number; h: number; source: { kind: string } },
  machineZ: number
): boolean {
  return (
    a.zIndex < machineZ &&
    (a.source.kind === "drawn" || a.source.kind === "upload") &&
    a.x <= 0.5 &&
    a.y <= 0.5 &&
    a.x + a.w >= 99.5 &&
    a.y + a.h >= 99.5
  );
}

/** Does the rect reach every edge of the max zoom-out box? */
export function reachesBounds(a: { x: number; y: number; w: number; h: number }, bounds: WorldRect): boolean {
  return (
    a.x <= bounds.x + 0.5 &&
    a.y <= bounds.y + 0.5 &&
    a.x + a.w >= bounds.x + bounds.w - 0.5 &&
    a.y + a.h >= bounds.y + bounds.h - 0.5
  );
}

/** Every camera state as a frame on the world. */
export function guideFrames(a: ArcadeConfig, world: { w: number; h: number }): GuideFrame[] {
  const wa = world.w / world.h;
  const out: GuideFrame[] = [];
  for (const device of ["desktop", "mobile"] as const) {
    const d = a[device];
    const name = device === "mobile" ? "Phone" : "Desktop";
    const fa = d.frame.aspect.w / d.frame.aspect.h;
    const push = (label: string, kind: GuideFrame["kind"], cam: { scale: number; focusX: number; focusY: number; rotation: number }, aspect: number) => {
      const f = frameRect(cam, aspect, wa);
      out.push({
        label,
        device,
        kind,
        rect: aabb(f.cx, f.cy, f.w, f.h, f.rotation, wa),
        rotation: f.rotation,
        cx: f.cx,
        cy: f.cy,
        w: f.w,
        h: f.h,
      });
    };
    push(`${name} · at rest`, "rest", d.rest, fa);
    if (d.scroll.enabled) {
      for (const k of d.scroll.keyframes) {
        push(`${name} · scrolled ${Math.round(k.at * 100)}%`, "scroll", k.camera, fa);
      }
    }
    // Click-in: what the visitor's whole window shows when zoomed in.
    const vp = REFERENCE[device];
    const play = playCamera({
      arcade: a,
      device,
      world,
      worldPxW: worldPx(a, device, world),
      stageCentre: { x: vp.w / 2, y: vp.h / 2 },
      viewport: vp,
    }).cam;
    // The viewport (not the frame) is what's visible while playing; express
    // it as a frame of the viewport's aspect at the equivalent scale.
    const scaleInViewport = play.scale * (worldPx(a, device, world) / Math.min(vp.w, vp.h * wa));
    push(`${name} · playing`, "play", { ...play, scale: scaleInViewport }, vp.w / vp.h);
  }
  return out;
}

/** The maximum zoom-out: union of the world and every view. */
export function backdropBounds(a: ArcadeConfig, world: { w: number; h: number }): WorldRect {
  let x0 = 0;
  let y0 = 0;
  let x1 = 100;
  let y1 = 100;
  for (const f of guideFrames(a, world)) {
    x0 = Math.min(x0, f.rect.x);
    y0 = Math.min(y0, f.rect.y);
    x1 = Math.max(x1, f.rect.x + f.rect.w);
    y1 = Math.max(y1, f.rect.y + f.rect.h);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { x: r2(x0), y: r2(y0), w: r2(x1 - x0), h: r2(y1 - y0) };
}

/** Pixel canvas for a backdrop covering `bounds`, sharp at the deepest zoom
 *  where possible (capped at MAX_DRAW_SIDE on the longest side). */
export function backdropCanvasFor(
  a: ArcadeConfig,
  world: { w: number; h: number },
  bounds: WorldRect
): { w: number; h: number; sharp: boolean } {
  const wa = world.w / world.h;
  // px per world-% needed at the deepest zoom on either device.
  const need = Math.max(
    ...(["desktop", "mobile"] as const).map(
      // Scroll zoom only: during the click-in the backdrop sits dimmed behind
      // the game, and play-sharp would need an impossible file size.
      (d) => (worldPx(a, d, world) / 100) * maxScrollScale(a[d]) * QUALITY_DPR
    )
  );
  let w = Math.max(2400, bounds.w * need);
  let h = (w / bounds.w) * (bounds.h / wa) * (100 / 100);
  // h in px: bounds.h% of world height; world height px = world width px / wa.
  h = ((w / bounds.w) * 100) / wa * (bounds.h / 100);
  const over = Math.max(w, h) / MAX_DRAW_SIDE;
  const sharp = over <= 1;
  if (over > 1) {
    w /= over;
    h /= over;
  }
  return { w: Math.round(w), h: Math.round(h), sharp };
}

const COLORS: Record<GuideFrame["kind"], Record<ArcadeDeviceKey, string>> = {
  rest: { desktop: "#f97316", mobile: "#0ea5e9" },
  scroll: { desktop: "#fdba74", mobile: "#7dd3fc" },
  play: { desktop: "#a855f7", mobile: "#ec4899" },
};

/**
 * Paint the guide layer for a backdrop canvas covering `bounds`: the safe
 * area, every state's frame (labelled with its size on screen), the world
 * edge and the machine + screen. Returns a same-origin blob: URL.
 */
export async function buildBackdropGuide(
  a: ArcadeConfig,
  world: { w: number; h: number },
  bounds: WorldRect,
  canvas: { w: number; h: number }
): Promise<string | undefined> {
  const c = document.createElement("canvas");
  c.width = canvas.w;
  c.height = canvas.h;
  const ctx = c.getContext("2d");
  if (!ctx) return undefined;
  // World % → canvas px.
  const X = (x: number) => ((x - bounds.x) / bounds.w) * canvas.w;
  const Y = (y: number) => ((y - bounds.y) / bounds.h) * canvas.h;
  const unit = canvas.w / 600; // line/label scale
  const font = (px: number) => `600 ${Math.round(px * unit)}px system-ui, sans-serif`;

  // Outside the world (only seen when zoomed out): faint hatch.
  ctx.fillStyle = "rgba(100, 116, 139, 0.10)";
  ctx.fillRect(0, 0, canvas.w, canvas.h);
  ctx.clearRect(X(0), Y(0), X(100) - X(0), Y(100) - Y(0));

  const frames = guideFrames(a, world);

  // Safe area: what EVERY device shows at rest (intersection of rest frames).
  const rests = frames.filter((f) => f.kind === "rest").map((f) => f.rect);
  const sx0 = Math.max(...rests.map((r) => r.x));
  const sy0 = Math.max(...rests.map((r) => r.y));
  const sx1 = Math.min(...rests.map((r) => r.x + r.w));
  const sy1 = Math.min(...rests.map((r) => r.y + r.h));
  if (sx1 > sx0 && sy1 > sy0) {
    ctx.fillStyle = "rgba(249, 115, 22, 0.16)";
    ctx.fillRect(X(sx0), Y(sy0), X(sx1) - X(sx0), Y(sy1) - Y(sy0));
    ctx.fillStyle = "rgba(194, 65, 12, 0.9)";
    ctx.font = font(9);
    ctx.fillText("SAFE AREA — seen on every screen at rest", X(sx0) + 6 * unit, Y(sy1) - 6 * unit);
    ctx.font = font(7);
    ctx.fillStyle = "rgba(71, 85, 105, 0.9)";
    ctx.fillText(
      "On screens wider than the frame the left/right edges fade into the paper (Soft edges)",
      X(sx0) + 6 * unit,
      Y(sy1) - 18 * unit
    );
  }

  // Each state's frame.
  frames.forEach((f, i) => {
    const color = COLORS[f.kind][f.device];
    ctx.save();
    ctx.translate(X(f.cx), Y(f.cy));
    ctx.rotate((f.rotation * Math.PI) / 180);
    const w = (f.w / bounds.w) * canvas.w;
    const h = (f.h / bounds.h) * canvas.h;
    ctx.lineWidth = Math.max(2, 2 * unit);
    ctx.strokeStyle = color;
    if (f.kind !== "rest") ctx.setLineDash([8 * unit, 5 * unit]);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    // Label tab in a corner — cycling corners (and stepping inward) so frames
    // that share an edge don't hide each other's labels.
    ctx.font = font(8);
    const text = f.label;
    const tw = ctx.measureText(text).width + 10 * unit;
    const th = 12 * unit;
    const corner = i % 4;
    const step = Math.floor(i / 4) * (th + 2 * unit);
    const lx = corner % 2 === 0 ? -w / 2 : w / 2 - tw;
    const ly = corner < 2 ? -h / 2 + step : h / 2 - th - step;
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly, tw, th);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, lx + 5 * unit, ly + 9 * unit);
    ctx.restore();
  });

  // The world edge (scale 1 = the whole drawing area of the old canvas).
  ctx.lineWidth = Math.max(1, unit);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.5)";
  ctx.strokeRect(X(0), Y(0), X(100) - X(0), Y(100) - Y(0));

  // Machine footprint + game screen (desktop placement; phones dashed).
  for (const device of ["desktop", "mobile"] as const) {
    const g = machineGeometry(a, device, world);
    ctx.save();
    const cx = g.box.x + g.box.w / 2;
    const cy = g.box.y + g.box.h / 2;
    ctx.translate(X(cx), Y(cy));
    ctx.rotate((g.rotation * Math.PI) / 180);
    const mw = (g.box.w / bounds.w) * canvas.w;
    const mh = (g.box.h / bounds.h) * canvas.h;
    ctx.lineWidth = Math.max(2, 1.5 * unit);
    ctx.strokeStyle = device === "desktop" ? "rgba(15,23,42,0.75)" : "rgba(14,165,233,0.75)";
    if (device === "mobile") ctx.setLineDash([6 * unit, 4 * unit]);
    ctx.strokeRect(-mw / 2, -mh / 2, mw, mh);
    ctx.setLineDash([]);
    if (device === "desktop") {
      const sw = (g.screenUnits.w / world.w) * 100;
      const sh = (g.screenUnits.h / world.h) * 100;
      const scr = machineVariant(a, device).screen;
      const sl = (scr.x / 100) * mw - mw / 2;
      const st = (scr.y / 100) * mh - mh / 2;
      ctx.fillStyle = "rgba(225, 29, 72, 0.22)";
      ctx.fillRect(sl, st, (sw / bounds.w) * canvas.w, (sh / bounds.h) * canvas.h);
      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.font = font(8);
      ctx.fillText("MACHINE", -mw / 2 + 4 * unit, -mh / 2 - 4 * unit);
    }
    ctx.restore();
  }

  try {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch {
    return undefined;
  }
}
