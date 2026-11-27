/* eslint-disable @typescript-eslint/no-explicit-any */
// Schema-version registry for SiteConfig (announcement bar / header / footer).
//
// `any` is used deliberately: migration steps receive pre-migration rows that
// by definition don't match the current SiteConfig shape. Same registry
// pattern as landingMigrations.ts / migrations.ts — no steps registered yet
// since this is the first version; the walker exists up front so a future
// field addition is one entry here, not a new mechanism.

import type { SiteConfig } from "./landingTypes";
import { CURRENT_SITE_CONFIG_SCHEMA_VERSION } from "./landingTypes";
import { defaultSiteConfig } from "./siteConfig";
import { normalizeHeader } from "./navConfig";
import { normalizeTypography } from "./fonts";
import { normalizeLoader } from "./loaderConfig";
import { rewriteStorageUrls } from "@/lib/storageUrl";

type SiteConfigMigration = (config: any) => any;

const SITE_CONFIG_MIGRATIONS: Record<number, SiteConfigMigration> = {
  // v1 → v2: the header grew into the full nav. normalizeHeader() folds the
  // old `sticky` flag into `scroll` and defaults every new field.
  1: (c) => ({ ...c, header: c.header ? normalizeHeader(c.header) : c.header }),
};

/**
 * Bring a raw `website_site_config.config` JSONB blob up to the current
 * schema version, filling in any top-level section missing from an older or
 * hand-edited row with its default rather than crashing the public render.
 */
export function migrateSiteConfig(raw: any): SiteConfig {
  const from = typeof raw?.schemaVersion === "number" ? raw.schemaVersion : 1;
  let cur = raw ?? {};
  for (let v = from; v < CURRENT_SITE_CONFIG_SCHEMA_VERSION; v++) {
    const step = SITE_CONFIG_MIGRATIONS[v];
    if (step) cur = step(cur);
  }
  // Re-root saved Storage URLs (logo/images) — see lib/storageUrl.ts.
  cur = rewriteStorageUrls(cur);
  return {
    schemaVersion: CURRENT_SITE_CONFIG_SCHEMA_VERSION,
    announcementBar: cur.announcementBar ?? defaultSiteConfig.announcementBar,
    // Deep-filled: nav fields added in v2 (style, scroll, art…) default in.
    header: normalizeHeader(cur.header ?? defaultSiteConfig.header),
    footer: cur.footer ?? defaultSiteConfig.footer,
    // Optional sections added after v1 — MUST be carried through here: this
    // function rebuilds the object from known keys, so a section missing
    // from this list is silently dropped on every load (a saved hover
    // default would revert on reload).
    interactions: cur.interactions ?? defaultSiteConfig.interactions,
    forms: cur.forms ?? defaultSiteConfig.forms,
    maintenance: cur.maintenance ?? defaultSiteConfig.maintenance,
    // UI chrome skins (language switcher art/placement) — optional.
    chrome: cur.chrome && typeof cur.chrome === "object" ? cur.chrome : undefined,
    // Site fonts — optional (absent = the built-in fonts).
    typography: normalizeTypography(cur.typography),
    // SEO defaults — optional; carried through or dropped on every load.
    seo: cur.seo && typeof cur.seo === "object" ? cur.seo : undefined,
    // Loading screen — absent = the default (on, the book), deep-filled.
    loader: normalizeLoader(cur.loader),
  };
}
