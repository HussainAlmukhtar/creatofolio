/* eslint-disable @typescript-eslint/no-explicit-any */
// Site nav (SiteConfig.header) — defaults + read-time normalization.
//
// Every nav field has a default here, so a v1 row (enabled / logoText /
// links / sticky only) or a hand-edited one renders as before: a standard
// text bar. normalizeHeader() deep-fills missing keys — migrateSiteConfig's
// `cur.header ?? default` only covers a header missing entirely.

import type {
  HeaderConfig,
  LocalizedArt,
  NavCta,
  NavLayout,
  NavLook,
  NavMobile,
  NavScroll,
  NavStyle,
} from "./landingTypes";
import type { ArcadeArt } from "./arcadeConfig";

export const DEFAULT_NAV_LOOK: NavLook = {
  height: 64,
  paddingX: 24,
  maxWidth: 1024,
  bg: "",
  ink: "",
  inkHover: "",
  linkSize: 14,
  logoArtHeight: 44,
  linkArtHeight: 30,
  indicator: "underline",
  divider: true,
};

export const DEFAULT_NAV_MOBILE: NavMobile = {
  hidden: false,
  panel: "fullscreen",
  panelBg: "",
};

export const DEFAULT_NAV_CTA: NavCta = {
  id: "cta",
  enabled: false,
  label: { en: "Get in touch", ar: "تواصل معي" },
  href: "#contact",
  variant: "solid",
};

export const DEFAULT_HEADER: HeaderConfig = {
  enabled: false,
  logoText: { en: "Creatofolio", ar: "كرياتوفوليو" },
  links: [],
  style: "standard",
  scroll: "sticky",
  layout: "logoLeft",
  overHero: "solid",
  look: DEFAULT_NAV_LOOK,
  cta: DEFAULT_NAV_CTA,
  languageButton: true,
  mobile: DEFAULT_NAV_MOBILE,
};

const STYLES: NavStyle[] = ["standard", "hybrid", "drawn"];
const SCROLLS: NavScroll[] = ["static", "sticky", "hideOnScroll", "afterHero"];
const LAYOUTS: NavLayout[] = ["logoLeft", "logoCenterSplit", "logoCenterStacked"];

const oneOf = <T extends string>(v: unknown, all: T[], fallback: T): T =>
  all.includes(v as T) ? (v as T) : fallback;

/** Fill every missing / invalid nav field from the defaults. */
export function normalizeHeader(raw: any): HeaderConfig {
  const h = raw && typeof raw === "object" ? raw : {};
  // v1 → v2: `sticky` became `scroll` (only when scroll was never set).
  const legacyScroll: NavScroll | undefined =
    typeof h.sticky === "boolean" ? (h.sticky ? "sticky" : "static") : undefined;
  const mobile = h.mobile && typeof h.mobile === "object" ? h.mobile : {};
  return {
    enabled: Boolean(h.enabled),
    logoText: h.logoText ?? DEFAULT_HEADER.logoText,
    links: Array.isArray(h.links) ? h.links : [],
    style: oneOf(h.style, STYLES, "standard"),
    scroll: oneOf(h.scroll, SCROLLS, legacyScroll ?? DEFAULT_HEADER.scroll),
    layout: oneOf(h.layout, LAYOUTS, "logoLeft"),
    overHero: h.overHero === "transparent" ? "transparent" : "solid",
    look: { ...DEFAULT_NAV_LOOK, ...(h.look && typeof h.look === "object" ? h.look : {}) },
    logoArt: h.logoArt ?? undefined,
    logoHotspot: h.logoHotspot ?? undefined,
    barArt: h.barArt ?? undefined,
    cta: { ...DEFAULT_NAV_CTA, ...(h.cta && typeof h.cta === "object" ? h.cta : {}) },
    // Default on: the floating pill sits where the nav's links end.
    languageButton: h.languageButton !== false,
    mobile: {
      ...DEFAULT_NAV_MOBILE,
      ...mobile,
      scroll: mobile.scroll ? oneOf(mobile.scroll, SCROLLS, "sticky") : undefined,
      panel: mobile.panel === "dropdown" ? "dropdown" : "fullscreen",
    },
  };
}

/** The art for the active language (one alone is used for both). */
export function pickArt(art: LocalizedArt | undefined, language: "en" | "ar"): ArcadeArt | null {
  return art?.[language] ?? art?.en ?? art?.ar ?? null;
}

export function hasArt(art: LocalizedArt | undefined): boolean {
  return Boolean(art?.en || art?.ar);
}

/**
 * Where a drawn-style link sits when no hotspot was set yet: the logo takes
 * the left quarter, links share the rest evenly (mirrored for Arabic by the
 * bar's `dir`).
 */
export function defaultHotspot(index: number, count: number) {
  const start = 34;
  const span = 100 - start - 3;
  const w = span / Math.max(1, count);
  return { x: start + index * w, y: 20, w: w * 0.9, h: 60 };
}

export const DEFAULT_LOGO_HOTSPOT = { x: 3, y: 15, w: 26, h: 70 };

export const NAV_STYLE_LABEL: Record<NavStyle, string> = {
  standard: "Standard",
  hybrid: "Hybrid",
  drawn: "Drawn",
};

export const NAV_SCROLL_LABEL: Record<NavScroll, string> = {
  static: "Static",
  sticky: "Always sticky",
  hideOnScroll: "Hide down, show up",
  afterHero: "Appear after hero",
};

/**
 * `data-nav-lang` for .landing-root: where the nav's own language switch
 * replaces the floating pill. Phones always get it in the phone bar (the
 * pill would sit on the menu button); desktop only with `languageButton`.
 */
export function navLangAttr(header: HeaderConfig): "all" | "desktop" | "phone" | undefined {
  if (!header.enabled) return undefined;
  const desktop = header.languageButton;
  const phone = !header.mobile.hidden;
  if (desktop && phone) return "all";
  if (desktop) return "desktop";
  if (phone) return "phone";
  return undefined;
}

/** Fonts the nav itself picked (they must load with the page). */
export function navFontKeys(header: HeaderConfig): string[] {
  return [header.look.font, header.look.fontAr].filter((k): k is string => Boolean(k));
}
