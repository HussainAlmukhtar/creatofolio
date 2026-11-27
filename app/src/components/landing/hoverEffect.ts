"use client";

// The site-wide default hover effect, provided where the site config is
// loaded (LandingPage / SubPageView / the editor canvas) and resolved per
// element: an element's own `hoverEffect` wins, else this default.

import { createContext, useContext } from "react";
import type { HoverEffect } from "@/data/landingTypes";

export const DEFAULT_HOVER_EFFECT: HoverEffect = "lift";

export const HoverDefaultContext = createContext<HoverEffect>(DEFAULT_HOVER_EFFECT);

export function useHoverDefault(): HoverEffect {
  return useContext(HoverDefaultContext);
}

export const HOVER_EFFECT_OPTIONS: { value: HoverEffect; label: string }[] = [
  { value: "lift", label: "Lift — rises off the page with a shadow" },
  { value: "wobble", label: "Wobble — hand-drawn line boil" },
  { value: "scribble", label: "Scribble — underline draws itself" },
  { value: "glow", label: "Glow — soft warm halo" },
  { value: "none", label: "None" },
];
