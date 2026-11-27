// Public landing page (home).
//
// Server component: loads the published home page + site config so the
// server-rendered HTML carries the real sections and the real <title>/share
// card (crawlers and link previews don't run the client swap). All UI lives
// in <LandingPage>; scrolling drives the GSAP/Lenis zoom-out and reveals the
// hand-drawn sections below.
//
// The loaders never throw: on a miss, timeout or outage they hand back the
// static seed, so the site renders either way.

import type { Metadata } from "next";
import LandingPage from "@/components/landing/LandingPage";
import { loadPublishedLandingPage, loadPublishedSiteConfig } from "@/lib/landingData";
import {
  buildLandingMetadata,
  SITE_DESCRIPTION,
  SITE_TITLE,
} from "@/lib/landingMetadata";

// Owner edits appear within a minute; Publish also revalidates on demand
// through /api/admin/revalidate.
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [page, site] = await Promise.all([
    loadPublishedLandingPage("home"),
    loadPublishedSiteConfig(),
  ]);
  return buildLandingMetadata(page, site, {
    path: "/",
    fallbackTitle: SITE_TITLE,
    fallbackDescription: SITE_DESCRIPTION,
  });
}

export default async function Home() {
  const [page, site] = await Promise.all([
    loadPublishedLandingPage("home"),
    loadPublishedSiteConfig(),
  ]);
  return <LandingPage initialPage={page ?? undefined} initialSiteConfig={site} />;
}
