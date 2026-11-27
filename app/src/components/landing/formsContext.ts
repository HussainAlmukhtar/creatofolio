"use client";

// The site's form destination (SiteConfig.forms), provided where the site
// config is loaded (LandingPage / SubPageView / the editor canvas) so the
// Form block knows whether it's connected — hidden from visitors until it is.

import { createContext, useContext } from "react";
import type { FormsConfig } from "@/data/landingTypes";

export const NO_FORMS: FormsConfig = { destination: "none" };

export const FormsContext = createContext<FormsConfig>(NO_FORMS);

export function useFormsConfig(): FormsConfig {
  return useContext(FormsContext);
}
