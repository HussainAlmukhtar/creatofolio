"use client";

// HeroSection — the arcade hero. Hosts the authored arcade scene (the
// `containsGame` section: machine + art in one world, framed per device —
// see data/arcadeConfig.ts) and its play controller (CabinetStage).
//
// The scroll camera (desktop: pinned keyframes; phones: keyframes that play
// as the hero scrolls past, no pin) is registered by useLandingMotion using
// the `#hero` id and the `.arcade-world` element.
//
// Sizing: the stage is the device's frame aspect fitted ("contain") inside
// the viewport (globals.css `.arcade-stage`), pinned to the hero's TOP so the
// drawing starts right under the site header (never a strip of paper above
// it). Desktop keeps a full-viewport hero; below 1024px the hero shrinks to
// the stage plus a little air below it, so a landscape frame doesn't leave a
// near-empty phone screen.

import CabinetStage from "./CabinetStage";
import type { DrawnSection } from "@/data/landingTypes";
import { resolveArcade } from "@/data/arcadeConfig";

const DEFAULT_WORLD = { w: 1520, h: 960 };

export default function HeroSection({
  section,
  ready = true,
}: {
  section?: DrawnSection;
  /** False until the published page has loaded — the arcade stays hidden
   *  (no flash of the default cabinet), then fades in. */
  ready?: boolean;
}) {
  const world = section?.aspectRatio ?? DEFAULT_WORLD;
  const arcade = resolveArcade(section?.arcade);
  const fa = (d: typeof arcade.desktop) => d.frame.aspect.w / d.frame.aspect.h;

  return (
    <section
      id="hero"
      className="hero-section relative flex items-start justify-center"
      data-arcade-ready={ready ? "true" : "false"}
      // The hero's phone height follows the mobile frame (globals.css).
      style={
        {
          "--frame-a-m": fa(arcade.mobile),
          "--frame-a-d": fa(arcade.desktop),
        } as React.CSSProperties
      }
    >
      <CabinetStage arcade={arcade} world={world} assets={section?.assets ?? []} />
    </section>
  );
}
