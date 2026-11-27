"use client";

// useSiteConfig — shared hook for the public announcement bar / header /
// footer. The public routes load the published config on the SERVER and pass
// it in (`initial`), so the first paint already carries the real header and
// footer and nothing swaps in later. Without `initial` (previews, callers that
// have no server data) it keeps the old seed-then-swap behaviour: the static
// default first, the published DB row once it resolves. Used by both
// LandingPage (home) and SubPageView (sub-pages).

import { useEffect, useState } from "react";
import type { SiteConfig } from "@/data/landingTypes";
import { defaultSiteConfig } from "@/data/siteConfig";
import { loadPublishedSiteConfig } from "@/lib/landingData";

export function useSiteConfig(initial?: SiteConfig): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>(initial ?? defaultSiteConfig);
  useEffect(() => {
    if (initial) return; // server-provided: no client swap
    let cancelled = false;
    loadPublishedSiteConfig().then((loaded) => {
      if (cancelled) return;
      setConfig(loaded);
    });
    return () => {
      cancelled = true;
    };
    // `initial` is fixed for the life of the page; the fetch only runs without it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return config;
}
