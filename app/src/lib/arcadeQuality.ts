// Arcade quality budget — how big art must be drawn to stay sharp at the
// largest zoom the camera will ever show it, plus the editor's guardrail
// warnings (blur, off-stage, foreground over the screen). Warnings only —
// nothing here blocks the author; the runtime guard (CabinetStage) is the
// only enforcement, and it's a toggle.

import type { DrawnAsset } from "@/data/landingTypes";
import {
  machineGeometry,
  machinePlacement,
  type ArcadeArt,
  type ArcadeConfig,
  type ArcadeDeviceKey,
} from "@/data/arcadeConfig";
import { frameRect, maxScrollScale, playCamera } from "@/lib/arcadeCamera";

/** Viewports the budget is computed for (a big desktop, a big phone). */
export const REFERENCE: Record<ArcadeDeviceKey, { w: number; h: number }> = {
  desktop: { w: 1920, h: 1080 },
  mobile: { w: 430, h: 932 },
};
/** Pixel density to stay sharp on (retina). */
export const QUALITY_DPR = 2;
/** Largest drawing canvas offered (px, longest side). */
export const MAX_DRAW_SIDE = 4096;

/** World width in CSS px on a device's reference viewport (scale 1). */
export function worldPx(a: ArcadeConfig, device: ArcadeDeviceKey, world: { w: number; h: number }) {
  const vp = REFERENCE[device];
  const fa = a[device].frame.aspect.w / a[device].frame.aspect.h;
  const stageW = Math.min(vp.w, vp.h * fa);
  const wa = world.w / world.h;
  return stageW * Math.min(1, wa / fa);
}

/** Largest camera scale on a device: rest, scroll keyframes, click-in. */
export function maxDeviceScale(
  a: ArcadeConfig,
  device: ArcadeDeviceKey,
  world: { w: number; h: number }
): number {
  const vp = REFERENCE[device];
  const play = playCamera({
    arcade: a,
    device,
    world,
    worldPxW: worldPx(a, device, world),
    stageCentre: { x: vp.w / 2, y: vp.h / 2 },
    viewport: vp,
  }).cam.scale;
  return Math.max(maxScrollScale(a[device]), play);
}

/** Natural width (px) an image `wPct` % of the world wide needs. */
function requiredWidth(
  a: ArcadeConfig,
  world: { w: number; h: number },
  wPct: (device: ArcadeDeviceKey) => number,
  /** Ignore the click-in zoom (backdrops sit dimmed behind the game then). */
  scrollOnly = false
): number {
  return Math.max(
    ...(["desktop", "mobile"] as const).map(
      (d) =>
        (wPct(d) / 100) *
        worldPx(a, d, world) *
        (scrollOnly ? maxScrollScale(a[d]) : maxDeviceScale(a, d, world)) *
        QUALITY_DPR
    )
  );
}

/** Natural width the machine's art needs to stay sharp everywhere (or, with
 *  separate phone art, on the devices that show this drawing). */
export function machineRequiredWidth(
  a: ArcadeConfig,
  world: { w: number; h: number },
  variant: "shared" | "desktop" | "phone" = "shared"
) {
  const only =
    !a.machine.phoneArt || variant === "shared"
      ? null
      : variant === "phone"
        ? "mobile"
        : "desktop";
  return Math.ceil(
    requiredWidth(a, world, (d) => (only && d !== only ? 0 : machinePlacement(a, d).w))
  );
}

/** Drawing canvas for the machine: the budget, in the machine's aspect,
 *  capped so the longest side ≤ MAX_DRAW_SIDE and never below 1200px wide. */
export function machineDrawCanvas(
  a: ArcadeConfig,
  world: { w: number; h: number },
  variant: "shared" | "desktop" | "phone" = "shared"
) {
  const c = variant === "phone" && a.machine.phoneArt ? a.machine.phoneArt.canvas : a.machine.canvas;
  const aspect = c.w / c.h;
  let w = Math.max(1200, machineRequiredWidth(a, world, variant));
  let h = w / aspect;
  const over = Math.max(w, h) / MAX_DRAW_SIDE;
  if (over > 1) {
    w /= over;
    h /= over;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Drawing canvas for a full-world backdrop. */
export function backdropDrawCanvas(a: ArcadeConfig, world: { w: number; h: number }) {
  const aspect = world.w / world.h;
  let w = Math.max(2400, Math.ceil(requiredWidth(a, world, () => 100)));
  let h = w / aspect;
  const over = Math.max(w, h) / MAX_DRAW_SIDE;
  if (over > 1) {
    w /= over;
    h /= over;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

const isVector = (url: string) => /\.svg(\?|#|$)/i.test(url);

export interface ArcadeWarning {
  level: "warn" | "info";
  text: string;
  /** Asset iid or "machine" the warning is about (for "select" links). */
  target?: string;
}

function artWarning(label: string, art: ArcadeArt | null, need: number): ArcadeWarning | null {
  if (!art || isVector(art.url) || !art.naturalW) return null;
  if (art.naturalW >= need * 0.95) return null;
  const blurAt = (art.naturalW / need).toFixed(2);
  return {
    level: "warn",
    target: "machine",
    text: `${label} is ${art.naturalW}px wide — it softens past ${Math.round(
      Number(blurAt) * 100
    )}% of the deepest zoom. Redraw at ≥ ${need}px wide.`,
  };
}

/** Editor guardrail warnings for the arcade (never enforced). */
export function arcadeWarnings(
  a: ArcadeConfig,
  world: { w: number; h: number },
  assets: DrawnAsset[]
): ArcadeWarning[] {
  const out: ArcadeWarning[] = [];
  const wa = world.w / world.h;

  // Sharpness: machine layers (each drawing judged on the devices that show
  // it) + scene images with a known pixel size.
  const phone = a.machine.phoneArt;
  const needMain = machineRequiredWidth(a, world, phone ? "desktop" : "shared");
  const checks = [
    artWarning(phone ? "Machine (back, desktop)" : "Machine (back)", a.machine.back, needMain),
    artWarning(phone ? "Machine (front, desktop)" : "Machine (front)", a.machine.front, needMain),
  ];
  if (phone) {
    const needPhone = machineRequiredWidth(a, world, "phone");
    checks.push(
      artWarning("Machine (back, phone)", phone.back, needPhone),
      artWarning("Machine (front, phone)", phone.front, needPhone)
    );
  }
  for (const w of checks) {
    if (w) out.push(w);
  }
  for (const asset of assets) {
    const url =
      asset.source.kind === "drawn"
        ? asset.source.pngUrl
        : asset.source.kind === "upload"
          ? asset.source.url
          : null;
    if (!url || isVector(url) || !asset.naturalW) continue;
    // A backdrop (behind the machine, covering the drawing area) is judged
    // on the SCROLL zoom: during the click-in it sits dimmed behind the game,
    // and a sharp-at-play backdrop would need an impossible file size.
    const isBackdrop =
      asset.zIndex < a.machine.zIndex &&
      asset.x <= 0.5 &&
      asset.y <= 0.5 &&
      asset.x + asset.w >= 99.5 &&
      asset.y + asset.h >= 99.5;
    const needA = Math.ceil(
      requiredWidth(
        a,
        world,
        (d) => (d === "mobile" ? asset.mobile?.w ?? asset.w : asset.w),
        isBackdrop
      )
    );
    if (asset.naturalW < needA * 0.95) {
      out.push({
        level: "warn",
        target: asset.iid,
        text: isBackdrop
          ? `Backdrop “${asset.label || "Drawing"}” is ${asset.naturalW}px wide; it needs ≥ ${needA}px to stay sharp while scrolling (it softens slightly behind the game when zoomed in to play — expected).`
          : `“${asset.label || "Drawing"}” is ${asset.naturalW}px wide; it needs ≥ ${needA}px to stay sharp at the deepest zoom.`,
      });
    }
  }

  // Machine on-stage (per device, against the rest framing).
  if (a.guards.onStage) {
    for (const d of ["desktop", "mobile"] as const) {
      const fa = a[d].frame.aspect.w / a[d].frame.aspect.h;
      const fr = frameRect(a[d].rest, fa, wa);
      const g = machineGeometry(a, d, world);
      const fl = fr.cx - fr.w / 2;
      const ft = fr.cy - fr.h / 2;
      const off =
        g.box.x < fl - 0.5 ||
        g.box.y < ft - 0.5 ||
        g.box.x + g.box.w > fl + fr.w + 0.5 ||
        g.box.y + g.box.h > ft + fr.h + 0.5;
      if (off) {
        out.push({
          level: "warn",
          target: "machine",
          text: `On ${d === "mobile" ? "phones" : "desktop"} the machine pokes out of the frame — part of it is cropped at rest.`,
        });
      }
    }
  }

  // Foreground over the screen.
  const g = machineGeometry(a, "desktop", world);
  const sw = (g.screenUnits.w / world.w) * 100;
  const sh = (g.screenUnits.h / world.h) * 100;
  const sl = g.screenCentre.x - sw / 2;
  const st = g.screenCentre.y - sh / 2;
  for (const asset of assets) {
    if (asset.zIndex <= a.machine.zIndex) continue;
    const ox = Math.max(0, Math.min(asset.x + asset.w, sl + sw) - Math.max(asset.x, sl));
    const oy = Math.max(0, Math.min(asset.y + asset.h, st + sh) - Math.max(asset.y, st));
    const cover = (ox / sw) * (oy / sh);
    if (cover <= 0.02) continue;
    const pct = Math.round(cover * 100);
    const fades = asset.fadeInPlay || (a.guards.foregroundFade && cover > a.guards.foregroundFadePct / 100);
    out.push({
      level: fades ? "info" : cover > 0.25 ? "warn" : "info",
      target: asset.iid,
      text: fades
        ? `“${asset.label || "An element"}” covers ${pct}% of the screen — it fades out while playing.`
        : `“${asset.label || "An element"}” covers ${pct}% of the screen and stays visible while playing.`,
    });
  }
  return out;
}

/** Sum of the arcade's image sizes in bytes (HEAD content-length). Missing
 *  headers count as 0, so this is a floor, not exact. */
export async function arcadeImageBytes(urls: string[]): Promise<number> {
  const unique = [...new Set(urls.filter(Boolean))];
  const sizes = await Promise.all(
    unique.map(async (u) => {
      try {
        const r = await fetch(u, { method: "HEAD" });
        return Number(r.headers.get("content-length")) || 0;
      } catch {
        return 0;
      }
    })
  );
  return sizes.reduce((s, n) => s + n, 0);
}
