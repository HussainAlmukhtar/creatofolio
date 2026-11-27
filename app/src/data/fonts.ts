// Fonts — the catalog the pickers offer, and how a FontKey becomes a CSS
// font-family + what has to load for it.
//
//   builtin  the self-hosted next/font defaults (app/layout.tsx). Their real
//            (hashed) family names live in CSS vars that globals.css copies
//            to --font-builtin-* on <body>, so a site that overrides
//            --font-body etc. can still point back at them.
//   google   loaded on demand from Google Fonts (one css2 request).
//   custom   uploaded .woff2/.ttf, loaded with @font-face.

import type { CustomFont, FontKey, FontPair, SiteTypography } from "./landingTypes";

export type FontCategory = "serif" | "sans" | "display" | "handwriting" | "mono";

export interface CatalogFont {
  key: FontKey;
  name: string;
  category: FontCategory;
  /** Has Arabic glyphs. */
  arabic: boolean;
  /** Has Latin glyphs. */
  latin: boolean;
  /** Google css2 weight list ("400;700"); empty = single weight. */
  weights?: string;
  /** builtin: the CSS var holding the real family name. */
  cssVar?: string;
}

const g = (
  name: string,
  category: FontCategory,
  weights: string,
  script: "latin" | "arabic" = "latin"
): CatalogFont => ({
  key: `google:${name}`,
  name,
  category,
  // Every Arabic family on Google Fonts also ships Latin glyphs.
  arabic: script === "arabic",
  latin: true,
  weights,
});

export const BUILTIN_FONTS: CatalogFont[] = [
  { key: "builtin:fraunces", name: "Fraunces (default headings)", category: "serif", arabic: false, latin: true, cssVar: "--font-builtin-display" },
  { key: "builtin:plex-sans", name: "IBM Plex Sans (default text)", category: "sans", arabic: false, latin: true, cssVar: "--font-builtin-body" },
  { key: "builtin:plex-arabic", name: "IBM Plex Sans Arabic (default Arabic)", category: "sans", arabic: true, latin: true, cssVar: "--font-builtin-arabic" },
  { key: "builtin:geist-mono", name: "Geist Mono", category: "mono", arabic: false, latin: true, cssVar: "--font-builtin-mono" },
];

export const GOOGLE_FONTS: CatalogFont[] = [
  // Serif
  g("Playfair Display", "serif", "400;500;600;700;800"),
  g("DM Serif Display", "serif", ""),
  g("Cormorant Garamond", "serif", "300;400;500;600;700"),
  g("Lora", "serif", "400;500;600;700"),
  g("Libre Baskerville", "serif", "400;700"),
  g("EB Garamond", "serif", "400;500;600;700;800"),
  // Sans
  g("Inter", "sans", "300;400;500;600;700;800"),
  g("DM Sans", "sans", "300;400;500;600;700;800"),
  g("Space Grotesk", "sans", "300;400;500;600;700"),
  g("Manrope", "sans", "300;400;500;600;700;800"),
  g("Outfit", "sans", "300;400;500;600;700;800"),
  g("Nunito", "sans", "300;400;500;600;700;800"),
  g("Work Sans", "sans", "300;400;500;600;700;800"),
  // Display
  g("Bebas Neue", "display", ""),
  g("Abril Fatface", "display", ""),
  g("Righteous", "display", ""),
  g("Fredoka", "display", "300;400;500;600;700"),
  g("Rubik", "display", "300;400;500;600;700;800"),
  // Hand-drawn
  g("Caveat", "handwriting", "400;500;600;700"),
  g("Patrick Hand", "handwriting", ""),
  g("Gochi Hand", "handwriting", ""),
  g("Kalam", "handwriting", "300;400;700"),
  g("Shadows Into Light", "handwriting", ""),
  g("Indie Flower", "handwriting", ""),
  g("Architects Daughter", "handwriting", ""),
  g("Gaegu", "handwriting", "300;400;700"),
  g("Permanent Marker", "handwriting", ""),
  // Mono
  g("JetBrains Mono", "mono", "300;400;500;600;700;800"),
  g("Space Mono", "mono", "400;700"),
  // Arabic
  g("Tajawal", "sans", "300;400;500;700;800", "arabic"),
  g("Cairo", "sans", "300;400;500;600;700;800", "arabic"),
  g("Almarai", "sans", "300;400;700;800", "arabic"),
  g("Readex Pro", "sans", "300;400;500;600;700", "arabic"),
  g("Noto Kufi Arabic", "sans", "300;400;500;600;700;800", "arabic"),
  g("Changa", "display", "300;400;500;600;700;800", "arabic"),
  g("Reem Kufi", "display", "400;500;600;700", "arabic"),
  g("El Messiri", "display", "400;500;600;700", "arabic"),
  g("Lalezar", "display", "", "arabic"),
  g("Rakkas", "display", "", "arabic"),
  g("Amiri", "serif", "400;700", "arabic"),
  g("Noto Naskh Arabic", "serif", "400;500;600;700", "arabic"),
  g("Aref Ruqaa", "handwriting", "400;700", "arabic"),
  g("Marhey", "handwriting", "300;400;500;600;700", "arabic"),
];

const CATALOG = new Map([...BUILTIN_FONTS, ...GOOGLE_FONTS].map((f) => [f.key, f]));

/** Today's look — what an absent `typography` means. */
export const DEFAULT_TYPOGRAPHY: SiteTypography = {
  display: { latin: "builtin:fraunces", arabic: "builtin:plex-arabic" },
  body: { latin: "builtin:plex-sans", arabic: "builtin:plex-arabic" },
  customFonts: [],
};

export function normalizeTypography(raw: unknown): SiteTypography | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Partial<SiteTypography>;
  const pair = (p: Partial<FontPair> | undefined, d: FontPair): FontPair => ({
    latin: typeof p?.latin === "string" ? p.latin : d.latin,
    arabic: typeof p?.arabic === "string" ? p.arabic : d.arabic,
  });
  return {
    display: pair(t.display, DEFAULT_TYPOGRAPHY.display),
    body: pair(t.body, DEFAULT_TYPOGRAPHY.body),
    customFonts: Array.isArray(t.customFonts) ? t.customFonts : [],
  };
}

const customId = (key: FontKey) => (key.startsWith("custom:") ? key.slice(7) : null);
/** @font-face family name for an uploaded font. */
const customFamily = (id: string) => `cf-${id}`;

export function fontLabel(key: FontKey, customFonts: CustomFont[] = []): string {
  const id = customId(key);
  if (id) return customFonts.find((f) => f.id === id)?.name ?? "Uploaded font (missing)";
  return CATALOG.get(key)?.name ?? key.replace(/^\w+:/, "");
}

/** The CSS font-family value for a key (no fallbacks). */
export function fontFamilyCss(key: FontKey | undefined, customFonts: CustomFont[] = []): string | undefined {
  if (!key) return undefined;
  const id = customId(key);
  if (id) return customFonts.some((f) => f.id === id) ? `"${customFamily(id)}"` : undefined;
  if (key.startsWith("google:")) return `"${key.slice(7).replace(/"/g, "")}"`;
  const v = CATALOG.get(key)?.cssVar;
  return v ? `var(${v})` : undefined;
}

/** Google Fonts stylesheet for the given keys (null when none are Google). */
export function googleFontsHref(keys: Iterable<FontKey>): string | null {
  const families = new Set<string>();
  for (const key of keys) {
    if (!key?.startsWith("google:")) continue;
    const f = CATALOG.get(key);
    const name = key.slice(7);
    const w = f?.weights;
    families.add(`family=${encodeURIComponent(name).replace(/%20/g, "+")}${w ? `:wght@${w}` : ""}`);
  }
  if (!families.size) return null;
  return `https://fonts.googleapis.com/css2?${[...families].sort().join("&")}&display=swap`;
}

/** @font-face rules for the uploaded fonts among `keys`. */
export function customFontFaces(keys: Iterable<FontKey>, customFonts: CustomFont[]): string {
  const used = new Set<string>();
  for (const k of keys) {
    const id = customId(k);
    if (id) used.add(id);
  }
  return customFonts
    .filter((f) => used.has(f.id))
    .map((f) => {
      const ext = f.url.split("?")[0].split(".").pop()?.toLowerCase();
      const format = ext === "woff2" ? "woff2" : ext === "woff" ? "woff" : ext === "otf" ? "opentype" : "truetype";
      return `@font-face{font-family:"${customFamily(f.id)}";src:url("${f.url.replace(/"/g, "%22")}") format("${format}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`;
    })
    .join("\n");
}

/** Every font key the site typography uses. */
export function typographyKeys(t: SiteTypography | undefined): FontKey[] {
  if (!t) return [];
  return [t.display.latin, t.display.arabic, t.body.latin, t.body.arabic];
}

/**
 * CSS vars that point the site's font roles at the chosen fonts, for one
 * language. Arabic pages put the Arabic pick first so Arabic text uses it
 * (most Arabic families also carry Latin glyphs); English pages put the
 * Latin pick first and fall through to the Arabic one for Arabic glyphs.
 */
export function typographyVars(
  t: SiteTypography | undefined,
  language: "en" | "ar"
): Record<string, string> | undefined {
  if (!t) return undefined;
  const css = (k: FontKey) => fontFamilyCss(k, t.customFonts);
  const chain = (p: FontPair) => {
    const latin = css(p.latin);
    const arabic = css(p.arabic);
    const order = language === "ar" ? [arabic, latin] : [latin, arabic];
    return order.filter(Boolean).join(", ");
  };
  const display = chain(t.display);
  const body = chain(t.body);
  return {
    ...(display ? { "--font-display-latin": display } : {}),
    ...(body ? { "--font-body": body } : {}),
    // The Arabic fallback in every chain: the body's Arabic pick.
    ...(css(t.body.arabic) ? { "--font-arabic": css(t.body.arabic)! } : {}),
  };
}

/** The role stacks (same as globals.css @theme), used as fallbacks. */
export const ROLE_STACK = {
  display: "var(--font-display-latin), var(--font-arabic), ui-serif, Georgia, serif",
  body: "var(--font-body), var(--font-arabic), ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, monospace",
} as const;

/**
 * font-family for one element's own font (a text element / heading block),
 * with the role it would otherwise use as the fallback.
 */
export function elementFontFamily(
  font: FontKey | undefined,
  fontAr: FontKey | undefined,
  language: "en" | "ar",
  customFonts: CustomFont[] = [],
  role: "display" | "body" | "mono" = "body"
): string | undefined {
  const key = language === "ar" ? fontAr || font : font;
  const fam = fontFamilyCss(key, customFonts);
  return fam ? `${fam}, ${ROLE_STACK[role]}` : undefined;
}

/** Font keys chosen on individual elements of a page (text + blocks). */
export function pageFontKeys(page: { sections: { assets: { source: unknown }[] }[] }): FontKey[] {
  const keys = new Set<FontKey>();
  const add = (v: unknown) => typeof v === "string" && v && keys.add(v);
  for (const section of page.sections) {
    for (const asset of section.assets) {
      const src = asset.source as
        | { kind: "text"; style?: { font?: unknown; fontAr?: unknown } }
        | { kind: "component"; block?: { props?: Record<string, unknown> } }
        | { kind: string };
      if (src.kind === "text" && "style" in src) {
        add(src.style?.font);
        add(src.style?.fontAr);
      } else if (src.kind === "component" && "block" in src) {
        add(src.block?.props?.font);
        add(src.block?.props?.fontAr);
      }
    }
  }
  return [...keys];
}
