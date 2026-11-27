// Landing page configuration — the built-in default page.
//
// Published pages are rows in the `website_pages` Supabase table; this one is
// the fallback when there is no row (or no database). The shape is the same:
// `defaultLandingPage` is exactly what a row's JSONB holds.

import type { DrawnPage, DrawnSection } from "./landingTypes";
import { titlesToAssets } from "./sectionTitles";
import { CURRENT_LANDING_SCHEMA_VERSION } from "./landingTypes";

// The arcade (cabinet art, screen rect, cameras) lives in data/arcadeConfig.ts
// — DEFAULT_ARCADE reproduces the old hardcoded CABINET_CONFIG, and the
// arcade section's `arcade` field overrides it from the CMS (schemaVersion 8).

// ─── Hardcoded page content ─────────────────────────────────────

export const defaultLandingPage: DrawnPage = {
  schemaVersion: CURRENT_LANDING_SCHEMA_VERSION,
  iid: "00000000-0000-4000-8000-000000000001",
  slug: "home",
  // Authored with heading/subheading for readability; they become title
  // elements (data/sectionTitles.ts) exactly as a saved page's would.
  sections: ([
    {
      // The arcade/game section: one world holding the machine (with the live
      // game) and the art + buttons around it. No `arcade` config yet →
      // DEFAULT_ARCADE (the original ink cabinet). Authored in Arcade Studio.
      iid: "00000000-0000-4000-8000-000000000005",
      id: "arcade",
      blockType: "hero",
      aspectRatio: { w: 1520, h: 960 },
      containsGame: true,
      assets: [],
    },
    {
      iid: "00000000-0000-4000-8000-000000000010",
      id: "about",
      blockType: "stack",
      aspectRatio: { w: 1520, h: 960 },
      // Top tear bites up into the hero's paper wash — the page's first
      // torn edge, establishing the "sheets of paper" read immediately. The
      // bottom tear lays this sheet over the digital section below, so the
      // paper→screen change is a rip, not a hard straight line.
      surface: {
        kind: "paper",
        color: "var(--paper-1)",
        grain: true,
        tornEdge: { top: "rough", bottom: "rough" },
      },
      heading: {
        en: "About this place",
        ar: "عن هذا المكان",
      },
      subheading: {
        en: "An interactive portfolio you can wander through. Make it yours.",
        ar: "معرض أعمال تفاعلي يمكنك التجول فيه. اجعله لك.",
      },
      revealStyle: "fade-up",
      assets: [
        // Placeholders. Each "asset" is a hand-drawn PNG positioned by
        // percentage. Decorative — no aria-label, no click target.
        {
          iid: "00000000-0000-4000-8000-000000000011",
          source: { kind: "upload", url: "/elements/easel.svg" },
          x: 6, y: 12, w: 11, h: 20, zIndex: 1,
          role: { kind: "decoration" },
          parallax: { factor: 0.15 },
        },
      ],
    },
    {
      iid: "00000000-0000-4000-8000-000000000020",
      id: "what-im-building",
      blockType: "stack",
      aspectRatio: { w: 1520, h: 960 },
      // "digital" surface — demonstrates paper↔digital blending. This
      // section paints no tear of its own; the paper sections on either
      // side own their top tears and bite into it (see "about" above and
      // "get-in-touch" below).
      surface: { kind: "digital", texture: "grid" },
      heading: {
        en: "What I'm building",
        ar: "ما الذي أبنيه",
      },
      subheading: {
        en: "Projects, products, and curiosities. Click any drawing to dig in.",
        ar: "مشاريع ومنتجات وفضول. انقر على أي رسم لتغوص فيه.",
      },
      revealStyle: "fade-up",
      assets: [
        {
          iid: "00000000-0000-4000-8000-000000000021",
          source: { kind: "upload", url: "/elements/rocket.svg" },
          x: 70, y: 18, w: 11, h: 20, zIndex: 1,
          role: { kind: "decoration" },
          parallax: { factor: 0.25 },
        },
      ],
    },
    {
      iid: "00000000-0000-4000-8000-000000000030",
      id: "get-in-touch",
      blockType: "stack",
      aspectRatio: { w: 1520, h: 960 },
      surface: {
        kind: "paper",
        color: "var(--paper-2)",
        grain: true,
        tornEdge: { top: "deckle" },
      },
      heading: {
        en: "Get in touch",
        ar: "تواصل معي",
      },
      subheading: {
        en: "Drop a note, or scroll back up and come find me in the game.",
        ar: "اترك رسالة، أو ارجع إلى الأعلى وتعال ابحث عني في اللعبة.",
      },
      revealStyle: "fade-up",
      assets: [
        {
          iid: "00000000-0000-4000-8000-000000000031",
          source: { kind: "upload", url: "/elements/envelope.svg" },
          x: 10, y: 50, w: 11, h: 20, zIndex: 1,
          role: { kind: "decoration" },
          parallax: { factor: 0.1 },
        },
      ],
    },
  ] as DrawnSection[]).map((s) => titlesToAssets(s) as DrawnSection),
};
