/* eslint-disable @typescript-eslint/no-explicit-any */
// Schema-version registry for DrawnPage (landing-page CMS).
//
// `any` is used deliberately throughout: migration steps receive pre-migration
// rows that by definition don't match the current DrawnPage shape, so asserting
// a static type on them would defeat the purpose. Same rationale as
// migrations.ts (the RoomConfig sibling).
//
// Deliberately separate from migrations.ts, whose header declares it the source
// of truth for RoomConfig specifically. Same registry pattern: every persisted
// page is stamped with `schemaVersion`; `migrateLandingPage()` walks each
// registered step from the row's stored version up to
// CURRENT_LANDING_SCHEMA_VERSION and stamps the final version on the result.
//
// Adding a future migration = one entry in LANDING_MIGRATIONS plus a bumped
// CURRENT_LANDING_SCHEMA_VERSION in landingTypes.ts.

import type { DrawnPage } from "./landingTypes";
import { CURRENT_LANDING_SCHEMA_VERSION } from "./landingTypes";
import { newIid } from "@/lib/iid";
import { rewriteStorageUrls } from "@/lib/storageUrl";
import { titlesToAssets } from "./sectionTitles";

// Each migration takes the raw page at version N and returns it at version N+1.
// Loose-typed on purpose — pre-migration rows don't match the current DrawnPage
// shape, and asserting that statically would defeat the point.
type LandingMigration = (page: any) => any;

// v2 → v3: mint iids on the page, every section, and every asset if missing.
// Idempotent — existing iids are preserved. Load-time safety net so any DB row
// (or hand-authored static seed) becomes self-healing on the next save. The v3
// `meta` field is optional, so there's no data transform beyond the stamp — but
// centralizing the mint here keeps the walker the single upgrade path.
function mintLandingIidsIfMissing(page: any): any {
  let changed = false;
  let next = page;

  if (!next.iid) {
    next = { ...next, iid: newIid() };
    changed = true;
  }

  if (Array.isArray(next.sections)) {
    let sectionsChanged = false;
    const sections = next.sections.map((s: any) => {
      let section = s;
      let sectionChanged = false;

      if (!section.iid) {
        section = { ...section, iid: newIid() };
        sectionChanged = true;
      }

      if (Array.isArray(section.assets)) {
        let assetsChanged = false;
        const assets = section.assets.map((a: any) => {
          if (!a.iid) {
            assetsChanged = true;
            return { ...a, iid: newIid() };
          }
          return a;
        });
        if (assetsChanged) {
          section = { ...section, assets };
          sectionChanged = true;
        }
      }

      if (sectionChanged) sectionsChanged = true;
      return section;
    });
    if (sectionsChanged) {
      next = { ...next, sections };
      changed = true;
    }
  }

  return changed ? next : page;
}

// v6 → v7: retire `layout: "flow"`. Flow sections were a separate stacked-block
// mode, which made components mutually exclusive with hand-drawn art. Since v6 a
// component is just a positioned asset, so every section is a canvas and each
// flow `block` becomes a full-width component asset stacked down the section in
// its original order. Nothing is dropped — the blocks carry over verbatim as
// `source.block`, keeping their type and props.
function flowBlocksToComponentAssets(page: any): any {
  if (!Array.isArray(page?.sections)) return page;

  let changed = false;
  const sections = page.sections.map((section: any) => {
    if (section?.layout !== "flow") {
      // A non-flow section may still carry a stray `layout: "canvas"`; that key
      // no longer exists in the schema, so drop it for cleanliness.
      if (section && "layout" in section) {
        changed = true;
        const rest = { ...section };
        delete rest.layout;
        return rest;
      }
      return section;
    }

    changed = true;
    const blocks: any[] = Array.isArray(section.blocks) ? section.blocks : [];
    // Stack the blocks vertically, mirroring how they used to render. Heights
    // are advisory — `autoHeight` lets each component size itself, so a long
    // accordion won't clip if the estimate is short.
    const GAP = 2;
    const H = blocks.length ? Math.max(8, (100 - GAP * (blocks.length + 1)) / blocks.length) : 0;
    const topZ = Math.max(
      0,
      ...(Array.isArray(section.assets) ? section.assets : []).map((a: any) => a?.zIndex ?? 0)
    );
    const converted = blocks.map((block, i) => ({
      iid: newIid(),
      source: { kind: "component", block, autoHeight: true },
      x: 10,
      y: GAP + i * (H + GAP),
      w: 80,
      h: H,
      zIndex: topZ + 1 + i,
      role: { kind: "decoration" },
    }));

    const rest = { ...section };
    delete rest.layout;
    delete rest.blocks;
    return {
      ...rest,
      assets: [...(Array.isArray(section.assets) ? section.assets : []), ...converted],
    };
  });

  return changed ? { ...page, sections } : page;
}

// v9 → v10: fixed section titles become canvas text elements (titleRole),
// in a title band added to the top of the canvas so nothing moves.
function sectionTitlesToAssets(page: any): any {
  if (!Array.isArray(page.sections)) return page;
  return { ...page, sections: page.sections.map(titlesToAssets) };
}

const LANDING_MIGRATIONS: Record<number, LandingMigration> = {
  2: mintLandingIidsIfMissing,
  6: flowBlocksToComponentAssets,
  9: sectionTitlesToAssets,
};

/**
 * Bring a raw `website_pages.config` JSONB blob up to the current schema
 * version. Idempotent — running on an already-current row is a no-op in shape.
 */
export function migrateLandingPage(raw: any): DrawnPage {
  const from = typeof raw?.schemaVersion === "number" ? raw.schemaVersion : 1;
  let cur = raw;
  for (let v = from; v < CURRENT_LANDING_SCHEMA_VERSION; v++) {
    const step = LANDING_MIGRATIONS[v];
    if (step) cur = step(cur);
  }
  // Stamp on every read so writes downstream don't need to remember.
  if (cur.schemaVersion !== CURRENT_LANDING_SCHEMA_VERSION) {
    cur = { ...cur, schemaVersion: CURRENT_LANDING_SCHEMA_VERSION };
  }
  // Re-root saved Storage URLs at the current storage origin (see
  // lib/storageUrl.ts) — drawings/uploads saved before a storage move.
  return rewriteStorageUrls(cur) as DrawnPage;
}
