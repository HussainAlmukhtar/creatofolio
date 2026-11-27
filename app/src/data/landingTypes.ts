// Landing-page / drawn-website schema.
//
// Mirrors the room/object pattern: human slug + stable iid, schemaVersion
// for read-time migrations, tagged unions for behaviour. The built-in
// instance is in landingConfig.ts; published pages load from the Supabase
// `website_pages` table using exactly this shape.
//
// Schema notes (convergent across Payload / Tina / Sanity / Puck):
//   - `blockType` is a tagged-union discriminator on sections, so new
//     section types can be added without a migration.
//   - `role` is a tagged-union on assets that forces accessibility decisions
//     at author time. Sites that bolt a11y on later fail audits until they
//     re-author content.
//   - x/y/w/h are PERCENTAGES of the section box, never pixels — every
//     illustrated portfolio that uses pixels ends up with a separate mobile
//     layout.
//   - `props: Record<string, unknown>` is Puck's escape hatch — costs
//     nothing, prevents migrations.

import type { AmbientPreset, ArcadeArt, StoredArcadeConfig } from "./arcadeConfig";
import type { ChromeSkin } from "./chromeSkin";
import type { LoaderConfig } from "./loaderConfig";

export const CURRENT_LANDING_SCHEMA_VERSION = 10;

// v5 (2026-07): block/component engine. Sections gain an optional `layout`
// ("canvas" | "flow"); flow sections hold `blocks: ContentBlock[]` — real,
// responsive, self-contained components (carousel, accordion, tabs, …) rendered
// by a registry (see components/landing/blocks/registry.ts). Existing sections
// omit `layout` and default to "canvas" (the freeform absolute-asset model),
// so v4 data renders unchanged. Also adds section visibility (hidden/hiddenOn/
// schedule). All additive → migration is a version-stamp only, no transform.

// v6 (2026-07): components become ASSETS. `DrawnAssetSource` gains a
// `component` kind, so a registry component is just another positioned element
// on the normal canvas — mixable with drawings/text/boxes in ANY section, and
// moved/resized/hidden-per-device by the existing asset machinery. Additive →
// version-stamp only, no transform.
//
// v7 (2026-07): retire `layout: "flow"` and `blocks` entirely. v6 left flow in
// place as a stacked-column convenience, but two ways to hold a component is
// one too many — every section is now a canvas and components are always
// assets. The migration converts each flow block into a stacked component
// asset, so no authored content is lost.
//
// v8 (2026-10): the arcade becomes an authorable scene. The `containsGame`
// section gains `arcade?: StoredArcadeConfig` (machine art + screen rect,
// per-device frame/camera/scroll keyframes, guardrails — see
// data/arcadeConfig.ts) and assets gain optional `ambient` / `fadeInPlay` /
// `naturalW`/`naturalH`. All optional; readers resolve defaults that reproduce
// the old hardcoded cabinet → version-stamp only, no transform.
//
// v9 (2026-10): per-element fonts. Text assets gain `style.font` / `fontAr`
// and heading/text blocks a `font` / `fontAr` prop (data/fonts.ts keys); the
// site-wide picks live in SiteConfig.typography. Optional → version-stamp
// only, no transform.
//
// v10 (2026-10): section titles become canvas elements. The fixed
// `heading` / `subheading` / `textColor` fields turn into text assets tagged
// `titleRole` inside a title band added to the top of the canvas (so nothing
// moves), and the section gains an editor-only `name`. Transform:
// data/sectionTitles.ts titlesToAssets.

/**
 * Torn-paper silhouette applied to a paper section's top/bottom edge —
 * "rough" (jagged hand-tear) or "deckle" (soft scalloped deckle edge).
 * Rendered via a CSS mask (see globals.css --tear-mask-*), so the edge
 * strip carries the section's own surface color — no raster asset needed.
 */
export type TornEdgeStyle = "rough" | "deckle" | "none";

/** Paper stock for a paper surface (see globals.css `.paper-material`). */
export type PaperPreset = "sketchbook" | "coldpress" | "kraft" | "newsprint";

/**
 * Section surface — the "material" a section is presented on. Lets the
 * (future) CMS mix paper / digital / plain sections on one page, each
 * blending into its neighbours via a torn-edge divider. Optional on
 * DrawnSection; defaults to `{ kind: "paper" }` when absent so v1 content
 * (schemaVersion 1, no `surface` field) still renders correctly.
 */
export type SectionSurface =
  | {
      kind: "paper";
      /** CSS color (usually a paper-* token). Default var(--paper-1). */
      color?: string;
      /** Paper texture (tooth, flecks, tone). Default true. */
      grain?: boolean;
      /** Paper stock — sets the texture recipe and (unless `color` is set)
       *  the base colour. Default "sketchbook". Additive (no migration). */
      paper?: PaperPreset;
      /** Torn edge biting into the section above/below. Prefer `top` —
       *  it paints over the previous section's bottom by DOM order with
       *  no z-index juggling; `bottom` needs the section to opt into a
       *  z-lift (see SectionSurface.tsx). */
      tornEdge?: {
        top?: TornEdgeStyle;
        bottom?: TornEdgeStyle;
        /** Overrides the default seed (the section iid) — the editor's
         *  "re-roll tear" writes a new one. Additive (no migration). */
        seed?: string;
        /** How deep/dramatic the tear is. Default "natural". Additive. */
        intensity?: "subtle" | "natural" | "dramatic";
      };
    }
  | {
      kind: "digital";
      /** Default var(--digital-bg). */
      color?: string;
      /** Default "none". */
      texture?: "none" | "grid" | "scanlines";
    }
  | {
      kind: "plain";
      color?: string;
    };

/** Top-level page = ordered list of heterogeneous sections. */
export interface DrawnPage {
  schemaVersion: number;
  /** Stable opaque UUID, never user-edited. */
  iid: string;
  /** Human slug, mutable. */
  slug: string;
  sections: DrawnSection[];
  /**
   * Per-page SEO metadata, surfaced via Next `generateMetadata` on the
   * `[slug]` route. Optional; introduced in schemaVersion 3. Bilingual so the
   * `<title>`/description can follow the active language later if needed —
   * for now the `[slug]` route uses the `en` values.
   */
  meta?: {
    title: { en: string; ar: string };
    description?: { en: string; ar: string };
    /** Share-card image (absolute public URL). Falls back to
     *  SiteConfig.seo.defaultOgImage. */
    ogImage?: string;
  };
}

/** One full-width scrollable section worth of drawn assets. */
export interface DrawnSection {
  iid: string;
  /** Human slug (e.g. "about", "projects"). Editor-friendly, mutable. */
  id: string;
  /**
   * Tagged-union discriminator. New section types can be added without a
   * migration.
   */
  blockType: "hero" | "stack" | "split" | "full-bleed";
  /** Aspect ratio of the section's design box. Default 1520x960 matches rooms. */
  aspectRatio: { w: number; h: number };
  /**
   * The section's "material" — paper/digital/plain, with paper's grain +
   * torn-edge dividers. Optional; defaults to `{ kind: "paper" }` (see
   * SectionSurface.tsx). Introduced in schemaVersion 2.
   */
  surface?: SectionSurface;
  /**
   * Solid color is deprecated in favour of `surface.color` (schemaVersion
   * 2) — kept as a tagged union member only so old `{ kind: "color" }}`
   * data still narrows correctly; DrawnSection no longer reads it.
   * image/drawn stay live: an optional art layer painted ON TOP of the
   * surface (e.g. a full-bleed illustration), not a replacement for it.
   */
  background?:
    | { kind: "color"; value: string }
    | { kind: "image"; src: string }
    | { kind: "drawn"; sceneId: string; pngUrl: string };
  assets: DrawnAsset[];
  /** The section's name in the editor (outline, thumbnails). Not shown to
   *  visitors — the visible title is a `titleRole` text element. v10. */
  name?: Localized;
  /** @deprecated v10 — became a `titleRole: "heading"` text element
   *  (data/sectionTitles.ts). Only read by the migration. */
  heading?: { en: string; ar: string };
  /** @deprecated v10 — became a `titleRole: "subheading"` text element. */
  subheading?: { en: string; ar: string };
  /**
   * Explicit color for the heading/subheading, overriding the theme's
   * surface-derived ink. Optional; when unset the text follows the surface
   * (paper = dark ink, digital = light). Lets authors keep text readable after
   * changing the surface. schemaVersion 4.
   * @deprecated v10 — moved onto the title elements' colour.
   */
  textColor?: string;
  /**
   * Section height as a percentage of the viewport height (svh). Default 100
   * (full screen). Lets authors make shorter/taller sections instead of every
   * section being forced to a full viewport. schemaVersion 4.
   */
  minHeightVh?: number;
  /**
   * When true, the section's asset canvas is wider than the viewport and
   * scrolls horizontally (native overflow-x). Use a wide `aspectRatio` (e.g.
   * 4000×960) and place assets left-to-right. Height comes from `minHeightVh`.
   * schemaVersion 4.
   */
  horizontalScroll?: boolean;
  /**
   * When true, the section auto-reflows into a centered vertical column on
   * mobile (below the container breakpoint) instead of keeping the absolute
   * desktop layout — so most sections need no manual mobile editing. Elements
   * stack top-to-bottom by their desktop Y. When false, mobile uses each asset's
   * manual `mobile` override (falling back to the scaled desktop layout).
   * schemaVersion 4.
   */
  autoStackMobile?: boolean;
  /**
   * Marks the section that hosts the arcade/game (the home-page hero). The
   * game itself stays bolted in place (CabinetStage); this section's assets are
   * the art + navigation buttons placed AROUND it. On the public home page the
   * assets overlay the hero; in the editor a cabinet reference is shown so
   * authors can position around it. Cap: one per page. schemaVersion 4.
   */
  containsGame?: boolean;
  /** The arcade scene (machine, cameras, guardrails) — only meaningful on the
   *  `containsGame` section. Always read through `resolveArcade()`.
   *  schemaVersion 8. */
  arcade?: StoredArcadeConfig;
  /** How the section's CONTENT enters on scroll (the paper never moves) —
   *  see components/landing/sectionReveal.ts. "ink"/"place" added in the
   *  visual pass (additive, no migration). */
  revealStyle?: "fade-up" | "fade" | "parallax" | "ink" | "place" | "none";
  // NOTE: v5's `layout: "canvas" | "flow"` + `blocks` are gone as of v7. Every
  // section is a canvas; components live in `assets` as a `component` source, so
  // they mix with drawings instead of needing a section of their own. The v6→v7
  // migration converts any old flow blocks into component assets.
  /**
   * Section visibility (schemaVersion 5). `hidden` hides it from the public site
   * (still editable, shown dimmed in the editor — the non-destructive hide).
   * `hiddenOn` hides per device; `schedule` bounds it to a date window. All ride
   * inside the page config, so version history/backups record visibility per
   * version automatically.
   */
  hidden?: boolean;
  hiddenOn?: { mobile?: boolean; desktop?: boolean };
  schedule?: { startISO?: string; endISO?: string };
}

/** Behaviour role — forces a11y intent at author time. */
export type DrawnAssetRole =
  | { kind: "decoration" }
  | { kind: "link"; href: string; targetIid?: string; newTab?: boolean }
  | { kind: "button"; actionId: string };

/**
 * Typography for a text asset. `fontSize` is in `cqw` units — a percentage of
 * the section canvas width — so text scales with the section at every viewport
 * (the canvas is a CSS container; see DrawnSection). Introduced schemaVersion 4.
 */
export interface DrawnTextStyle {
  fontFamily: "display" | "body" | "mono";
  /** cqw — % of the section canvas width. ~5 = a big heading, ~2 = body. */
  fontSize: number;
  /** 300–800. */
  fontWeight: number;
  /** CSS color or var(). */
  color: string;
  align: "left" | "center" | "right";
  lineHeight?: number;
  italic?: boolean;
  /** Own font (data/fonts.ts key) — overrides `fontFamily`'s role. v9. */
  font?: FontKey;
  /** Own font for the Arabic text; falls back to `font`. v9. */
  fontAr?: FontKey;
}

/**
 * Source of a drawn asset — a Klecks scene, an external upload, (schemaVersion
 * 4) live text with its own typography, or (schemaVersion 6) a real component
 * from the block registry. All four are placed and transformed exactly like any
 * other asset.
 *
 * `component` is the important one: it makes a carousel/accordion/tabs just
 * another positioned element, so components MIX freely with drawings, text and
 * boxes in ANY section and inherit the whole asset system for free — x/y/w/h
 * percentages, resize handles, z-index layering and per-device mobile
 * overrides. That is what "customise the area for a component" means here; no
 * dedicated component-only section is needed (or wanted).
 */
export type DrawnAssetSource =
  | { kind: "drawn"; sceneId: string; pngUrl: string }
  | { kind: "upload"; url: string }
  | { kind: "text"; text: { en: string; ar: string }; style: DrawnTextStyle }
  | {
      kind: "component";
      /** Registry-keyed component instance — see components/landing/blocks/. */
      block: ContentBlock;
      /**
       * Let the component size its own height instead of filling the asset box.
       * Content whose height depends on interaction (an accordion expanding)
       * needs this or it would clip; a carousel wants the fixed box. Seeded from
       * the registry's `defaultSize.autoHeight` on insert.
       */
      autoHeight?: boolean;
    };

/**
 * Per-device (mobile) layout override for an asset. Any field left undefined
 * inherits the desktop value. Applied below the container breakpoint (see
 * DrawnSection / globals.css `@container` rules) — so it works both on real
 * phones AND in the editor's narrow phone view. schemaVersion 4.
 */
export interface DrawnAssetMobile {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  /** Hide this element on mobile. */
  hidden?: boolean;
  /**
   * Opt out of the section's auto-stack: on phones this element keeps its
   * own (mobile) position and size, floating over the stacked column, so it
   * can overlap other elements freely. No effect in hand-placed sections,
   * where every element is already free. Additive (no migration).
   */
  free?: boolean;
}

export interface DrawnAsset {
  iid: string;
  source: DrawnAssetSource;
  /**
   * Position inside the section box, in PERCENTAGES (0–100).
   * x/y are the top-left corner; w/h are width/height of the asset.
   */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  zIndex: number;
  /** Mobile layout override (below the container breakpoint). */
  mobile?: DrawnAssetMobile;
  /** Hide this element on desktop (show only on mobile). */
  hiddenOnDesktop?: boolean;
  role: DrawnAssetRole;
  /** Hover feel for link/button elements; undefined = the site default
   *  (SiteConfig.interactions.hoverEffect). Additive (no migration). */
  hoverEffect?: HoverEffect;
  /** 0 = stationary, 1 = scrolls 1:1 with the page. Default 0. */
  parallax?: { factor: number };
  /** Optional drawn variant to swap in on hover. */
  hoverScene?: string;
  /** Idle motion loop (sway/float/flicker/pulse). Arcade scene + sections.
   *  schemaVersion 8. */
  ambient?: AmbientPreset;
  /** Arcade only: fade this element out while the game is being played. */
  fadeInPlay?: boolean;
  /** Pixel size of the drawn/uploaded image — feeds the sharpness budget.
   *  Backfilled on load where missing. schemaVersion 8. */
  naturalW?: number;
  naturalH?: number;
  /** This text element is the section's title (rendered as <h2>) or its
   *  subtitle (<p>); titles lead the section's reveal. v10. */
  titleRole?: "heading" | "subheading";
  /** Editor-only layer lock. true = can't be moved / resized / rotated on the
   *  canvas (and clicks pass through it); false = free. Absent = the default:
   *  locked for a backdrop, free for everything else (lib/layerLock.ts). The
   *  public site never reads it. Additive (no migration). */
  locked?: boolean;
  /** A11y label — required when role !== decoration. */
  label?: string;
  labelAr?: string;
  description?: string;
  descriptionAr?: string;
}

// ─── Block / component engine ───────────────────────────────────
//
// Real, responsive component objects (carousel, accordion, tabs, …) placed as
// canvas assets via `DrawnAssetSource`'s `component` kind. Modeled on
// Puck/Payload: a single registry keyed by block `type` drives the palette, the
// (generated) inspector, and public rendering; storage is a generic tagged shape
// (`{ id, type, props }`) so adding a component is one registry entry, never a
// schema/union edit. See components/landing/blocks/.

/** Bilingual string used across blocks. */
export interface Localized {
  en: string;
  ar: string;
}

/**
 * One placed component instance (carried by a `component` asset). `type` is the registry
 * key; `props` is the component's settings (typed per-block inside its registry
 * entry, generic here so the union never needs editing to add a block). `id` is
 * a stable local key for React + selection + reorder.
 */
export interface ContentBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

/**
 * A field in a block's settings inspector. The inspector UI is *generated* from
 * a block's `fields`, so no block hand-builds its own form. Mirrors Shopify's
 * input-setting vocabulary + Puck's field types. `key` addresses into the
 * block's `props` (dot-free, top-level). `heading`/`note` are sidebar-only (no
 * value). `localized` text fields store a `Localized` value instead of a string.
 */
export type FieldDescriptor = FieldDescriptorBase & {
  /** Show the field only while another prop of the same object has one of
   *  these values (e.g. a button's email fields only when kind = "email"). */
  when?: { key: string; is: string | string[] };
  /** Only in this surface's inspector (e.g. an image's lightbox is pop-up only). */
  surface?: "page" | "popup";
};

/**
 * Show-condition check for `FieldDescriptor.when` (absent = always shown).
 * A controlling prop that is missing (a block saved before the prop existed,
 * e.g. a button without `kind`) counts as what the inspector shows for it: the
 * controlling select's first option, else "". Pass the sibling fields so the
 * controller can be found.
 */
export function fieldVisible(
  field: FieldDescriptor,
  values: Record<string, unknown>,
  siblings?: readonly FieldDescriptor[]
): boolean {
  if (!field.when) return true;
  let v = values[field.when.key];
  if (v === undefined || v === null || v === "") {
    const ctl = siblings?.find((f) => "key" in f && f.key === field.when!.key);
    v = ctl?.kind === "select" ? (ctl.options[0]?.value ?? "") : "";
  }
  // Toggles store booleans; `is: "true"` reads naturally in a descriptor.
  if (typeof v === "boolean") v = String(v);
  const is = field.when.is;
  return Array.isArray(is) ? is.includes(v as string) : v === is;
}

type FieldDescriptorBase =
  | { kind: "text"; key: string; label: string; placeholder?: string; localized?: boolean }
  /** Bilingual rich text (TipTap): stores `{ en?: TipTapDoc, ar?: TipTapDoc }`. */
  | { kind: "richtext"; key: string; label: string }
  | { kind: "textarea"; key: string; label: string; localized?: boolean }
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number }
  | { kind: "range"; key: string; label: string; min: number; max: number; step?: number; unit?: string }
  /** A font pick (FontKey) for English + Arabic: writes `key` and `${key}Ar`. */
  | { kind: "font"; key: string; label: string }
  | { kind: "toggle"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "color"; key: string; label: string }
  | { kind: "align"; key: string; label: string }
  | { kind: "url"; key: string; label: string }
  | { kind: "image"; key: string; label: string }
  /**
   * A file from the media library (tabs per accepted kind; uploads go to the
   * kind's bucket). Stores the URL at `key`; `meta` names sibling props that
   * also get written on pick: the picked kind, the file name, its size.
   */
  | {
      kind: "media";
      key: string;
      label: string;
      accept: MediaKind[];
      meta?: { kind?: string; name?: string; bytes?: string };
    }
  | {
      // Repeatable sub-items (carousel slides, accordion rows, feature cards, …).
      // Value is an array of objects shaped by `itemFields`; `defaultItem` seeds
      // a new row; `itemLabelKey` names each row in the list UI.
      kind: "array";
      key: string;
      label: string;
      itemFields: FieldDescriptor[];
      defaultItem: Record<string, unknown>;
      itemLabelKey?: string;
      min?: number;
      max?: number;
    }
  | { kind: "heading"; label: string }
  | { kind: "note"; label: string };

/** What a media field / the media library deals in. */
export type MediaKind = "image" | "video" | "audio" | "file";

/** A block's category — groups it in the add-block palette. */
export type BlockCategory =
  | "text"
  | "media"
  | "interactive"
  | "layout"
  | "conversion"
  | "embed"
  | "social";

// ─── Site config (schemaVersion-independent — own version) ──────
//
// Site-wide chrome that wraps EVERY page: announcement bar, header/nav,
// footer. Deliberately NOT part of DrawnPage — a page is one entry in
// `website_pages`, this is a single row in `website_site_config`, edited once
// and rendered on every public route. Versioned separately so page-schema
// migrations never need to touch it and vice versa.

// v2: header became the full nav (style / scroll / layout / art / mobile
// menu) — `sticky` folded into `scroll`.
export const CURRENT_SITE_CONFIG_SCHEMA_VERSION = 2;

/** One link in the header nav or footer link list. */
export interface SiteNavLink {
  id: string;
  label: Localized;
  href: string;
  /** Open in a new tab (external links). */
  newTab?: boolean;
}

export interface AnnouncementBarConfig {
  enabled: boolean;
  text: Localized;
  /** Optional — the whole bar becomes a link when set. */
  href?: string;
  /** Per-visitor dismiss, remembered in localStorage. Re-shows if `text` changes. */
  dismissible: boolean;
  bg: string;
  color: string;
}

/** A drawn/uploaded image per language (one alone is used for both). */
export interface LocalizedArt {
  en?: ArcadeArt | null;
  ar?: ArcadeArt | null;
}

/**
 * How the nav looks:
 *  - "standard" — a clean text bar (logo text + link labels).
 *  - "hybrid"   — the standard layout, but any piece (bar background, logo,
 *                 each link, the CTA) can be swapped for a drawing.
 *  - "drawn"    — the whole bar is one drawing; links are hotspots on it.
 */
export type NavStyle = "standard" | "hybrid" | "drawn";

/**
 * What the nav does while the page scrolls:
 *  - "static"       — sits at the top and scrolls away with the page.
 *  - "sticky"       — always pinned to the top.
 *  - "hideOnScroll" — slides away scrolling down, comes back scrolling up.
 *  - "afterHero"    — hidden over the hero, slides in once you're past it.
 */
export type NavScroll = "static" | "sticky" | "hideOnScroll" | "afterHero";

export type NavLayout = "logoLeft" | "logoCenterSplit" | "logoCenterStacked";

/** A rectangle on the drawn bar, % of the bar's width/height. */
export interface NavHotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Editor-only layer lock (Nav Studio): can't be dragged or resized. The
   *  public nav never reads it. */
  locked?: boolean;
}

export interface NavLink extends SiteNavLink {
  /** Hybrid: drawing shown instead of the label. */
  art?: LocalizedArt;
  /** Hybrid + drawn: swapped in on hover. */
  hoverArt?: LocalizedArt;
  /** Hybrid + drawn: shown while this link is the current page / section. */
  activeArt?: LocalizedArt;
  /** Drawn style: where this link sits on the bar drawing. */
  hotspot?: NavHotspot;
}

export interface NavCta extends NavLink {
  enabled: boolean;
  variant: "solid" | "outline";
}

export interface NavLook {
  /** Bar height, px (minimum — a stacked layout grows past it). */
  height: number;
  /** Side padding, px. */
  paddingX: number;
  /** Content width cap, px. 0 = full width. */
  maxWidth: number;
  /** Bar background (CSS colour). Empty = soft paper with blur. */
  bg: string;
  /** Link / logo colour. Empty = theme ink. */
  ink: string;
  /** Hover / active colour. Empty = theme ink (strong). */
  inkHover: string;
  /** Link label size, px. */
  linkSize: number;
  /** Drawn logo height, px (hybrid). */
  logoArtHeight: number;
  /** Drawn link / CTA height, px (hybrid). */
  linkArtHeight: number;
  /** How hover / the current link are marked (standard + hybrid). */
  indicator: "none" | "underline" | "pill";
  /** Thin line under the bar. */
  divider: boolean;
  /** Own font for the logo text + links (data/fonts.ts key); absent = site fonts. */
  font?: FontKey;
  fontAr?: FontKey;
}

export interface NavMobile {
  /** Hide the nav on phones entirely. */
  hidden: boolean;
  /** Scroll behaviour on phones; absent = same as desktop. */
  scroll?: NavScroll;
  /** The opened menu: covers the screen, or drops down under the bar. */
  panel: "fullscreen" | "dropdown";
  /** Panel background colour. Empty = paper. */
  panelBg: string;
  /** Drawn menu (☰) button. */
  menuButtonArt?: LocalizedArt;
  /** Drawn close (✕) button. */
  closeButtonArt?: LocalizedArt;
  /** Drawing behind the opened menu. */
  panelArt?: LocalizedArt;
  /** Drawing behind the phone bar (hybrid + drawn). */
  barArt?: LocalizedArt;
}

export interface HeaderConfig {
  enabled: boolean;
  logoText: Localized;
  links: NavLink[];
  /** @deprecated v1 — replaced by `scroll` (migrated on read). */
  sticky?: boolean;
  style: NavStyle;
  scroll: NavScroll;
  layout: NavLayout;
  /** "transparent": float over the top of the page (the hero shows through)
   *  and gain the bar background once scrolled past it. */
  overHero: "solid" | "transparent";
  look: NavLook;
  /** Drawn logo (hybrid + drawn); falls back to `logoText`. */
  logoArt?: LocalizedArt;
  /** Drawn style: where the logo sits on the bar drawing. */
  logoHotspot?: NavHotspot;
  /** Hybrid: drawing behind the bar. Drawn: the bar itself. */
  barArt?: LocalizedArt;
  cta: NavCta;
  /** Put the EN / عربي switch inside the nav (replaces the floating pill). */
  languageButton: boolean;
  mobile: NavMobile;
}

export interface FooterConfig {
  enabled: boolean;
  brandLine: Localized;
  links: SiteNavLink[];
  copyright: Localized;
}

/**
 * Hover / press feel for interactive elements (link + button assets, the
 * Button block). Site-wide default in SiteConfig.interactions; any element
 * can override it (DrawnAsset.hoverEffect). See globals.css "Hover effects".
 */
export type HoverEffect = "lift" | "wobble" | "scribble" | "glow" | "none";

export interface InteractionsConfig {
  hoverEffect: HoverEffect;
}

/**
 * Where Form-block submissions go. The destination is swappable
 * (a mailing service or a CRM can be added later):
 *  - "none"    — not connected: forms are hidden from visitors (the editor
 *                shows them with a notice).
 *  - "hubspot" — HubSpot's public Forms submission API. Portal id + form
 *                GUID are public identifiers (HubSpot embeds put them in
 *                page source), so they can live in this public config.
 *  - "webhook" — POST JSON to any CRM / mailing tool / automation. The URL
 *                is a secret, so it is NOT stored here: it's the
 *                FORM_WEBHOOK_URL server env var.
 */
export interface FormsConfig {
  destination: "none" | "hubspot" | "webhook";
  hubspotPortalId?: string;
  hubspotFormGuid?: string;
}

/**
 * "Under maintenance" / password page. While enabled, public visitors see a
 * holding page (served by src/proxy.ts) instead of the site; a logged-in
 * owner always gets through. The PASSWORD is not stored here (this config
 * is publicly readable): it's the server-only SITE_PASSWORD env var, and
 * without it the page simply shows the message.
 */
export interface MaintenanceConfig {
  enabled: boolean;
  title: Localized;
  message: Localized;
}

/**
 * A font, as a string key (data/fonts.ts):
 *   "builtin:<id>"  one of the self-hosted defaults (Fraunces, IBM Plex…)
 *   "google:<Family Name>"  a Google Fonts family from the catalog
 *   "custom:<id>"   an uploaded font (SiteTypography.customFonts)
 */
export type FontKey = string;

/** A role's font for each script: Arabic text uses `arabic`. */
export interface FontPair {
  latin: FontKey;
  arabic: FontKey;
}

export interface CustomFont {
  id: string;
  /** Display name, e.g. "My Handwriting". */
  name: string;
  url: string;
  /** 100–900. */
  weight: number;
  style: "normal" | "italic";
  /** Which text it's for (filters the pickers). */
  script: "latin" | "arabic" | "both";
}

/** Site-wide fonts. Absent = the built-in defaults. */
export interface SiteTypography {
  /** Headings, logo, big display text. */
  display: FontPair;
  /** Paragraphs, links, buttons. */
  body: FontPair;
  customFonts: CustomFont[];
}

export interface SiteConfig {
  schemaVersion: number;
  announcementBar: AnnouncementBarConfig;
  header: HeaderConfig;
  footer: FooterConfig;
  /** Optional (added after v1 rows existed) — absent = defaults. */
  interactions?: InteractionsConfig;
  /** Optional — absent = { destination: "none" }. */
  forms?: FormsConfig;
  /** Optional — absent = off. */
  maintenance?: MaintenanceConfig;
  /** Optional UI chrome skins shown on every page (data/chromeSkin.ts). */
  chrome?: { languagePill?: ChromeSkin };
  /** Optional — absent = the built-in fonts. */
  typography?: SiteTypography;
  /** Optional site-wide SEO defaults (share cards, site name). */
  seo?: SiteSeo;
  /** Loading screen shown on a fresh page load (data/loaderConfig.ts).
   *  Absent = the default (on, "The book"). */
  loader?: LoaderConfig;
}

export interface SiteSeo {
  siteName?: Localized;
  /** Absolute public URL of the fallback share image. */
  defaultOgImage?: string;
  /** e.g. "@example" — emitted as twitter:site. */
  twitterHandle?: string;
}

// ─── Type guards ────────────────────────────────────────────────

export function isInteractive(asset: DrawnAsset): boolean {
  return asset.role.kind !== "decoration";
}

export function assetA11yLabel(
  asset: DrawnAsset,
  language: "en" | "ar"
): string | undefined {
  if (asset.role.kind === "decoration") return undefined;
  return language === "ar" ? asset.labelAr ?? asset.label : asset.label;
}
