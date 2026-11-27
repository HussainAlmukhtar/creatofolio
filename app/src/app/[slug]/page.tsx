// Public sub-page route — /<slug> for any published landing page other than
// home. Server component: loads the DrawnPage, 404s if it's missing or still a
// draft, and hands the data to the SubPageView client shell.
//
// Static route segments (/admin, /api) and files under public/ take precedence
// over this dynamic segment, so this only catches genuinely unclaimed slugs.

import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { loadPublishedLandingPage, loadPublishedSiteConfig } from "@/lib/landingData";
import { buildLandingMetadata } from "@/lib/landingMetadata";
import SubPageView from "@/components/landing/SubPageView";

// Owner edits should appear within a minute without a redeploy; this also keeps
// the DB read off the hot path for repeat visitors.
export const revalidate = 60;

interface SlugPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: SlugPageProps): Promise<Metadata> {
  const { slug } = await params;
  // /home is the home page, served at "/": no metadata of its own.
  if (slug === "home") return {};
  const [page, site] = await Promise.all([
    loadPublishedLandingPage(slug),
    loadPublishedSiteConfig(),
  ]);
  if (!page) return {};
  return buildLandingMetadata(page, site, { path: `/${encodeURIComponent(slug)}` });
}

export default async function SlugPage({ params }: SlugPageProps) {
  const { slug } = await params;
  // The home page lives at "/". Serving it a second time at /home made a
  // duplicate (canonical /home) for search engines; send it to the real URL.
  if (slug === "home") permanentRedirect("/");
  const [page, site] = await Promise.all([
    loadPublishedLandingPage(slug),
    loadPublishedSiteConfig(),
  ]);
  if (!page) notFound();
  // The render instant, so scheduled sections resolve identically in the SSR
  // HTML and during hydration (see useMinuteClock). With ISR it's the
  // regeneration time — at most `revalidate` seconds stale, and the client
  // clock takes over right after hydration anyway. (react-hooks/purity guards
  // against unstable client re-renders; an async server component renders once
  // per request/regeneration, so reading the clock here is the point.)
  // eslint-disable-next-line react-hooks/purity
  return <SubPageView page={page} serverNow={Date.now()} initialSiteConfig={site} />;
}
