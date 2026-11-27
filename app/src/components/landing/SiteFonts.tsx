"use client";

// SiteFonts — loads the fonts a page needs (site typography + any element's
// own font): one Google Fonts stylesheet (React hoists it into <head>) and
// @font-face rules for uploaded fonts. Renders nothing visible.
//
// The role overrides themselves are CSS vars on the page root
// (typographyVars), and elements read uploaded-font names through
// CustomFontsContext.

import { createContext } from "react";
import type { CustomFont, FontKey, SiteTypography } from "@/data/landingTypes";
import { customFontFaces, googleFontsHref, typographyKeys } from "@/data/fonts";

export const CustomFontsContext = createContext<CustomFont[]>([]);

export default function SiteFonts({
  typography,
  extraKeys = [],
}: {
  typography: SiteTypography | undefined;
  /** Fonts picked on individual elements (pageFontKeys). */
  extraKeys?: FontKey[];
}) {
  const keys = [...typographyKeys(typography), ...extraKeys];
  const href = googleFontsHref(keys);
  const faces = customFontFaces(keys, typography?.customFonts ?? []);
  return (
    <>
      {href && <link rel="stylesheet" href={href} precedence="default" />}
      {faces && <style>{faces}</style>}
    </>
  );
}
