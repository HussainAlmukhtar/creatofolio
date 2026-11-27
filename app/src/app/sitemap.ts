// /sitemap.xml — the home page plus every PUBLISHED landing page. Drafts never
// appear (the RPC only returns published rows). Regenerated at most hourly;
// a failed Supabase read degrades to just "/" rather than erroring.

import type { MetadataRoute } from "next";
import { listPublishedLandingPages } from "@/lib/landingData";
import { getSiteUrl } from "@/lib/siteUrl";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const pages = await listPublishedLandingPages();
  const home = pages.find((p) => p.slug === "home");

  return [
    {
      url: `${base}/`,
      lastModified: home?.updatedAt ? new Date(home.updatedAt) : undefined,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...pages
      .filter((p) => p.slug !== "home")
      .map((p) => ({
        url: `${base}/${encodeURIComponent(p.slug)}`,
        lastModified: p.updatedAt ? new Date(p.updatedAt) : undefined,
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
  ];
}
