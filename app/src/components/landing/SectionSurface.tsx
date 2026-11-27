// SectionSurface — renders a DrawnSection's "material" (paper / digital /
// plain) as an absolutely-positioned backdrop behind the section's
// heading + drawn-asset canvas.
//
// Pure presentational, no state, no effects. Safe to render unconditionally
// (including conditionally on `surface.kind`) because sections live OUTSIDE
// the GSAP-animated cabinet tree — useLandingMotion animates the whole
// <section> element via opacity/y, never unmounts children mid-tween.

import { useCallback, useMemo } from "react";
import type { SectionSurface as SectionSurfaceConfig } from "@/data/landingTypes";
import { tearPaths, type TearIntensity } from "@/lib/tornEdge";

interface SectionSurfaceProps {
  surface?: SectionSurfaceConfig;
  /** Stable per-section seed (the section iid) so each section tears its
   *  own way — and the same way on the server and after hydration. */
  seed?: string;
}

const DEFAULT_SURFACE: SectionSurfaceConfig = { kind: "paper" };

export default function SectionSurface({ surface, seed = "section" }: SectionSurfaceProps) {
  const s = surface ?? DEFAULT_SURFACE;

  const style = s.color
    ? ({ "--surface-color": s.color } as React.CSSProperties)
    : undefined;

  const texture = s.kind === "digital" ? (s.texture ?? "none") : undefined;
  const grain = s.kind === "paper" ? (s.grain ?? true) : false;
  const tornEdge = s.kind === "paper" ? s.tornEdge : undefined;

  const hasBottom = Boolean(tornEdge?.bottom && tornEdge.bottom !== "none");
  // A bottom tear's texture must line up with the section's, which needs the
  // section's height (CSS can't read it). Measured into --surface-h; only
  // sections that actually have a bottom tear pay for the observer.
  const measureRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !hasBottom) return;
      const ro = new ResizeObserver(() => {
        el.style.setProperty("--surface-h", `${el.offsetHeight}px`);
      });
      ro.observe(el);
      return () => ro.disconnect();
    },
    [hasBottom]
  );

  return (
    <div
      ref={measureRef}
      className={s.kind === "paper" ? "section-surface paper-material" : "section-surface"}
      data-kind={s.kind}
      data-grain={grain ? "true" : "false"}
      data-paper={s.kind === "paper" ? (s.paper ?? "sketchbook") : undefined}
      data-texture={texture && texture !== "none" ? texture : undefined}
      style={style}
      aria-hidden="true"
    >
      {tornEdge?.top && tornEdge.top !== "none" && (
        <TornEdge
          side="top"
          style={tornEdge.top === "deckle" ? "deckle" : "rough"}
          seed={`${tornEdge.seed ?? seed}:top`}
          intensity={tornEdge.intensity ?? "natural"}
          grain={grain}
        />
      )}
      {tornEdge?.bottom && tornEdge.bottom !== "none" && (
        <TornEdge
          side="bottom"
          style={tornEdge.bottom === "deckle" ? "deckle" : "rough"}
          seed={`${tornEdge.seed ?? seed}:bottom`}
          intensity={tornEdge.intensity ?? "natural"}
          grain={grain}
        />
      )}
    </div>
  );
}

/** Whether a section's surface paints a bottom tear — callers set
 *  `data-has-bottom-edge` on the owning `.drawn-section` so it z-lifts
 *  above the next section (see globals.css). */
export function hasBottomTornEdge(surface?: SectionSurfaceConfig): boolean {
  return (
    surface?.kind === "paper" &&
    !!surface.tornEdge?.bottom &&
    surface.tornEdge.bottom !== "none"
  );
}

/** Clip-path ids must be unique in the document and safe in url(#…). */
function clipId(seed: string, layer: string): string {
  return `tear-${layer}-${seed.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * One torn edge: a strip with a lighter torn-core rim under the paper face,
 * both clipped by the seeded contour from lib/tornEdge.ts. The face is a
 * `.paper-material`, inheriting the section's stock/colour custom
 * properties, so the tear is visibly the same sheet.
 */
function TornEdge({
  side,
  style,
  seed,
  intensity,
  grain,
}: {
  side: "top" | "bottom";
  style: "rough" | "deckle";
  seed: string;
  intensity: TearIntensity;
  grain: boolean;
}) {
  const paths = useMemo(
    () => tearPaths(seed, style, side === "bottom", intensity),
    [seed, style, side, intensity]
  );
  const outerId = clipId(seed, "outer");
  const innerId = clipId(seed, "inner");
  return (
    <div
      className={`section-surface__edge section-surface__edge--${side}`}
      data-style={style}
    >
      <svg className="section-surface__edge-defs" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={outerId} clipPathUnits="userSpaceOnUse">
            <path d={paths.outer} />
          </clipPath>
          <clipPath id={innerId} clipPathUnits="userSpaceOnUse">
            <path d={paths.inner} />
          </clipPath>
        </defs>
      </svg>
      <div className="section-surface__edge-rim" style={{ clipPath: `url(#${outerId})` }} />
      <div
        className="section-surface__edge-face paper-material"
        data-grain={grain ? "true" : "false"}
        style={{ clipPath: `url(#${innerId})` }}
      />
    </div>
  );
}
