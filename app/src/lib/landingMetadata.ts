// Next.js Metadata for a published landing page (home and /<slug>): title and
// description from the page's Search & sharing fields, share card from the
// page's own image or the site-wide default. Server-only in practice (called
// from generateMetadata), but pure — no React, no browser APIs.

import type { Metadata } from "next";
import type { DrawnPage, SiteConfig } from "@/data/landingTypes";
import { getSiteUrl } from "@/lib/siteUrl";

export const SITE_TITLE = "Creatofolio";
export const SITE_DESCRIPTION =
  "An interactive, hand-drawn portfolio you can walk around in.";

function nonEmpty(s: string | undefined | null): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

export function buildLandingMetadata(
  page: DrawnPage | null,
  site: SiteConfig | null,
  opts: { path: string; fallbackTitle?: string; fallbackDescription?: string }
): Metadata {
  const meta = page?.meta;
  const title = nonEmpty(meta?.title?.en) ?? opts.fallbackTitle;
  const description = nonEmpty(meta?.description?.en) ?? opts.fallbackDescription;
  const image = nonEmpty(meta?.ogImage) ?? nonEmpty(site?.seo?.defaultOgImage);
  const siteName = nonEmpty(site?.seo?.siteName?.en) ?? "Creatofolio";
  const handle = nonEmpty(site?.seo?.twitterHandle);

  const base = getSiteUrl();
  const result: Metadata = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    alternates: { canonical: `${base}${opts.path}` },
    openGraph: {
      title: title ?? siteName,
      ...(description ? { description } : {}),
      type: "website",
      siteName,
      url: `${base}${opts.path}`,
      locale: "en_US",
      alternateLocale: "ar_AR",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: title ?? siteName,
      ...(description ? { description } : {}),
      ...(handle ? { site: handle } : {}),
      ...(image ? { images: [image] } : {}),
    },
  };
  return result;
}
