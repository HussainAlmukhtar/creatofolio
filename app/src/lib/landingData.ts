// Landing-page public runtime loader.
//
// Mirrors gameData.ts: a Supabase read capped at 4s (a hung request can't block
// the page) with a SILENT fallback — the public site must never break. This is
// the deliberate opposite of landingEditorData.ts, which surfaces a `source`
// tag so the editor can warn the owner; here we just render something.
//
// Callable from both server components (the [slug] route) and the client (the
// home-page hydrate swap), so it uses a plain anon-key client from
// @supabase/supabase-js rather than the cookie-backed browser client — public
// reads are RLS-safe as anon and need no session.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DrawnPage, SiteConfig } from "@/data/landingTypes";
import { defaultLandingPage } from "@/data/landingConfig";
import { defaultSiteConfig } from "@/data/siteConfig";
import { migrateLandingPage } from "@/data/landingMigrations";
import { migrateSiteConfig } from "@/data/siteConfigMigrations";
import { withTimeout } from "./withTimeout";
import { rewriteStorageUrls } from "./storageUrl";
import { migrateObjectContent } from "@/data/contentMigrations";

let anonClient: SupabaseClient | null = null;

/** The public, session-less anon client (also used by the pop-up style loader). */
export function getPublicAnonClient(): SupabaseClient | null {
  return getAnonClient();
}

function getAnonClient(): SupabaseClient | null {
  if (anonClient) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  // A distinct storageKey: the cookie-backed browser client (supabase/client.ts)
  // uses the default one, and two GoTrue clients sharing a key in one tab make
  // supabase-js warn "Multiple GoTrueClient instances detected".
  anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "sb-public-anon" },
  });
  return anonClient;
}

/**
 * Load a published landing page by slug. Returns the migrated DrawnPage, or the
 * static seed for "home" / null for any other slug on miss, timeout, or error.
 * Reads through the `get_published_landing_page` RPC, NOT the table: anon has
 * no SELECT on website_pages (drafts, hidden and not-yet-scheduled sections
 * must not be readable with the public anon key). The RPC returns only
 * published pages, with non-public sections already stripped server-side —
 * see supabase/migrations/20260925000001_landing_public_read_hardening.sql.
 */
export async function loadPublishedLandingPage(
  slug: string
): Promise<DrawnPage | null> {
  const fallback = slug === "home" ? defaultLandingPage : null;

  const supabase = getAnonClient();
  if (!supabase) return fallback;

  const fetchFromDb = (async (): Promise<DrawnPage | null> => {
    try {
      const { data, error } = await supabase.rpc("get_published_landing_page", {
        page_slug: slug,
      });
      if (!error) return data ? migrateLandingPage(data) : null;
      // PGRST202 = function not found: the hardening migration isn't applied
      // to this database yet. Fall back to the legacy table read so deploying
      // this code first doesn't blank the site; once the migration lands,
      // anon can't read the table and this branch is never reached.
      if (error.code !== "PGRST202") return null;
      const legacy = await supabase
        .from("website_pages")
        .select("config")
        .eq("id", slug)
        .eq("status", "published")
        .maybeSingle();
      if (legacy.error || !legacy.data?.config) return null;
      return migrateLandingPage(legacy.data.config);
    } catch {
      return null;
    }
  })();

  const fromDb = await withTimeout(fetchFromDb, 4000, null);
  return fromDb ?? fallback;
}

/**
 * Load rich content for a single landing "button" asset. Same 4s-timeout,
 * silent-fallback shape as loadPublishedLandingPage. Returns null when there's
 * no content authored yet (the caller shows a "coming soon" placeholder).
 */
export async function loadPageContentPublic(
  pageSlug: string,
  assetIid: string
): Promise<import("@/data/contentTypes").ObjectContent | null> {
  const supabase = getAnonClient();
  if (!supabase) return null;

  const fetchFromDb = (async () => {
    try {
      const { data, error } = await supabase
        .from("website_page_content")
        .select("content")
        .eq("page_slug", pageSlug)
        .eq("asset_iid", assetIid)
        .maybeSingle();
      if (error || !data?.content) return null;
      return migrateObjectContent(rewriteStorageUrls(data.content as import("@/data/contentTypes").ObjectContent));
    } catch {
      return null;
    }
  })();

  return withTimeout(fetchFromDb, 4000, null);
}

/**
 * Load the site-wide announcement bar / header / footer config. Same 4s-
 * timeout, silent-fallback shape as loadPublishedLandingPage — falls back to
 * the static default (header/announcement off, footer with the original
 * hardcoded copy) on miss, timeout, or error, so the public site's chrome
 * never disappears.
 */
export async function loadPublishedSiteConfig(): Promise<SiteConfig> {
  const supabase = getAnonClient();
  if (!supabase) return defaultSiteConfig;

  const fetchFromDb = (async (): Promise<SiteConfig | null> => {
    try {
      const { data, error } = await supabase
        .from("website_site_config")
        .select("config")
        .eq("id", "default")
        .maybeSingle();
      if (error || !data?.config) return null;
      return migrateSiteConfig(data.config);
    } catch {
      return null;
    }
  })();

  const fromDb = await withTimeout(fetchFromDb, 4000, null);
  return fromDb ?? defaultSiteConfig;
}

/**
 * Slugs + last-modified of every published page, for sitemap.xml. Same
 * silent-fallback shape as the loaders above (empty list on any failure — the
 * sitemap still lists "/"). Uses the `list_published_landing_pages` RPC (anon
 * can't read website_pages directly); falls back to the legacy table read
 * only while that function doesn't exist yet (PGRST202), like
 * loadPublishedLandingPage.
 */
export async function listPublishedLandingPages(): Promise<
  { slug: string; updatedAt?: string }[]
> {
  const supabase = getAnonClient();
  if (!supabase) return [];

  const fetchFromDb = (async () => {
    try {
      const { data, error } = await supabase.rpc("list_published_landing_pages");
      if (!error) {
        return ((data ?? []) as { slug: string; updated_at?: string }[]).map(
          (r) => ({ slug: r.slug, updatedAt: r.updated_at })
        );
      }
      if (error.code !== "PGRST202") return [];
      const legacy = await supabase
        .from("website_pages")
        .select("id, updated_at")
        .eq("status", "published");
      if (legacy.error || !legacy.data) return [];
      return legacy.data.map((r) => ({
        slug: r.id as string,
        updatedAt: r.updated_at as string | undefined,
      }));
    } catch {
      return [];
    }
  })();

  return withTimeout(fetchFromDb, 4000, []);
}
