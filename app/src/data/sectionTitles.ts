/* eslint-disable @typescript-eslint/no-explicit-any */
// Section titles as canvas elements.
//
// Until v10 a section's heading + subheading were fixed fields drawn in a
// centred block ABOVE its canvas: you could change the words and one colour,
// nothing else. Now they're ordinary text elements on the canvas (tagged
// `titleRole` so they still render as <h2>/<p> and lead the reveal), so they
// can be moved, resized, rotated, restyled, given their own font and per-
// device positions like anything else.
//
// The conversion keeps the page looking the same: the canvas grows by a
// "title band" as tall as the old text block (measured at a 1440px-wide
// desktop, where it was 264px: 80px padding, 60px heading, 16px gap, 28px
// subheading, 80px padding), the titles go into that band, and every existing
// element keeps its exact size and spot below it.

import type { DrawnAsset, DrawnSection, DrawnTextStyle, Localized } from "./landingTypes";

const REF_W = 1440;

/** px at the 1440px reference → the section's aspect-ratio units. */
const unitsOf = (px: number, aspectW: number) => (px / REF_W) * aspectW;

/** Title text elements' defaults (match the old fixed heading block). */
export const TITLE_STYLE: Record<"heading" | "subheading", DrawnTextStyle> = {
  heading: {
    fontFamily: "display",
    fontSize: 4.17, // 60px at 1440
    fontWeight: 600,
    color: "var(--section-ink)",
    align: "center",
    lineHeight: 1.1,
  },
  subheading: {
    fontFamily: "body",
    fontSize: 1.39, // 20px at 1440
    fontWeight: 400,
    color: "var(--section-ink-soft)",
    align: "center",
    lineHeight: 1.4,
  },
};

/** A title text element (also used by the editor's "Add heading" buttons). */
export function makeTitleAsset(
  role: "heading" | "subheading",
  text: Localized,
  rect: { x: number; y: number; w: number; h: number },
  iid: string,
  zIndex: number,
  color?: string
): DrawnAsset {
  return {
    iid,
    source: {
      kind: "text",
      text: { en: text.en ?? "", ar: text.ar ?? "" },
      style: { ...TITLE_STYLE[role], ...(color ? { color } : {}) },
    },
    ...rect,
    zIndex,
    role: { kind: "decoration" },
    titleRole: role,
  } as DrawnAsset;
}

function nonEmpty(l: any): l is Localized {
  return Boolean(l && typeof l === "object" && ((l.en ?? "").trim() || (l.ar ?? "").trim()));
}

/**
 * Turn a section's fixed heading/subheading into title elements. Returns the
 * section unchanged when it has neither. Loose-typed: runs on raw (pre-v10)
 * rows inside the migration walker.
 */
export function titlesToAssets(section: any): any {
  const heading = nonEmpty(section.heading) ? section.heading : null;
  const sub = nonEmpty(section.subheading) ? section.subheading : null;
  const { heading: _h, subheading: _s, textColor, ...rest } = section;
  void _h;
  void _s;
  if (!heading && !sub) {
    // Drop the dead fields (an empty heading) without touching the layout.
    return "heading" in section || "subheading" in section || "textColor" in section ? rest : section;
  }

  const ar = section.aspectRatio && section.aspectRatio.w > 0 ? section.aspectRatio : { w: 1520, h: 960 };
  const assets: any[] = Array.isArray(section.assets) ? section.assets : [];

  // Band: the old block's height (shorter with only one of the two lines).
  const bandPx = 80 + (heading ? 60 : 0) + (heading && sub ? 16 : 0) + (sub ? 28 : 0) + 80;
  const band = unitsOf(bandPx, ar.w);
  const newH = ar.h + band;
  const pctY = (units: number) => (units / newH) * 100;
  // Existing elements: same pixel size + spot, pushed below the band.
  const shiftY = (y: number) => ((y / 100) * ar.h + band) / newH * 100;
  const scaleH = (h: number) => (h / 100) * ar.h / newH * 100;
  const moved = assets.map((a) => ({
    ...a,
    y: shiftY(a.y),
    h: scaleH(a.h),
    ...(a.mobile && (typeof a.mobile.y === "number" || typeof a.mobile.h === "number")
      ? {
          mobile: {
            ...a.mobile,
            ...(typeof a.mobile.y === "number" ? { y: shiftY(a.mobile.y) } : {}),
            ...(typeof a.mobile.h === "number" ? { h: scaleH(a.mobile.h) } : {}),
          },
        }
      : {}),
  }));

  // Titles: centred, 60% wide (wide enough to count as a divider in the
  // phone auto-stack, so they stay on top there too).
  const z = assets.reduce((m, a) => Math.max(m, a.zIndex ?? 0), 0) + 1;
  const sectionIid = section.iid ?? section.id ?? "section";
  const color = typeof textColor === "string" && textColor ? textColor : undefined;
  const titles: DrawnAsset[] = [];
  // Boxes (px at 1440) chosen so the glyphs land where the old block drew
  // them (measured against the live site): text is centred in its box.
  if (heading) {
    titles.push(
      makeTitleAsset(
        "heading",
        heading,
        { x: 20, y: pctY(unitsOf(100, ar.w)), w: 60, h: pctY(unitsOf(66, ar.w)) },
        `${sectionIid}-title`,
        z,
        color
      )
    );
  }
  if (sub) {
    titles.push(
      makeTitleAsset(
        "subheading",
        sub,
        { x: 20, y: pctY(unitsOf(heading ? 149 : 72, ar.w)), w: 60, h: pctY(unitsOf(44, ar.w)) },
        `${sectionIid}-subtitle`,
        z,
        color
      )
    );
  }

  return {
    ...rest,
    // The editor's name for the section (outline, thumbnails) — the old
    // heading, so the list reads the same.
    name: rest.name ?? heading ?? sub,
    aspectRatio: { w: ar.w, h: Math.round(newH * 100) / 100 },
    assets: [...moved, ...titles],
    // Phones: the old block sat ABOVE a scaled canvas at fixed pixel sizes;
    // a title band that scales with the width is far too short there. The
    // phone auto-stack (title, subtitle, then the content, in a column) is
    // that same layout — switched on where it can't rearrange anything else
    // (at most one other element). Busier sections keep their phone layout
    // and the author places the titles in Mobile mode.
    ...(rest.autoStackMobile || rest.horizontalScroll || assets.length > 1 ? {} : { autoStackMobile: true }),
  };
}

/** The editor's label for a section: its name, else its title, else its id. */
export function sectionLabel(section: DrawnSection, language: "en" | "ar" = "en"): string {
  const title = section.assets.find((a) => a.titleRole === "heading" && a.source.kind === "text");
  const titleText = title && title.source.kind === "text" ? title.source.text : undefined;
  return (
    section.name?.[language] ||
    section.name?.en ||
    titleText?.[language] ||
    titleText?.en ||
    section.id
  );
}
