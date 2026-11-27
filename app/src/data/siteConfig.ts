// Site-wide config — static seed for the announcement bar, header/nav and
// footer. Mirrors landingConfig.ts's role: always present so something
// renders without network/DB, overridden by the `website_site_config` row
// once Supabase is reachable. The footer copy here matches what was
// previously hardcoded identically in LandingPage.tsx and SubPageView.tsx.

import type { SiteConfig } from "./landingTypes";
import { CURRENT_SITE_CONFIG_SCHEMA_VERSION } from "./landingTypes";
import { DEFAULT_HEADER } from "./navConfig";

export const defaultSiteConfig: SiteConfig = {
  schemaVersion: CURRENT_SITE_CONFIG_SCHEMA_VERSION,
  interactions: { hoverEffect: "lift" },
  forms: { destination: "none" },
  maintenance: {
    enabled: false,
    title: { en: "Opening soon", ar: "قريبًا" },
    message: {
      en: "This site is being put together. Please come back soon.",
      ar: "الموقع قيد الإعداد. عُد قريبًا من فضلك.",
    },
  },
  announcementBar: {
    enabled: false,
    text: { en: "", ar: "" },
    dismissible: true,
    bg: "#2b2420",
    color: "#f5efe4",
  },
  header: DEFAULT_HEADER,
  footer: {
    enabled: true,
    brandLine: { en: "", ar: "" },
    links: [],
    copyright: {
      en: "© 2026 — made with love and ink",
      ar: "© ٢٠٢٦ — صنع بحب وحبر",
    },
  },
};
