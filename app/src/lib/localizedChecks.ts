// Translation completeness by SHAPE — shared by the landing Checks panel
// (landingChecks.ts), the room editor's Issues panel (integrityCheck.ts) and
// the pop-up composer's "Arabic n/m" badges.
//
// A bilingual value is any `{ en, ar }` object whose two sides are both
// strings (a Localized text) or both TipTap docs / absent (a rich-text body).
// Nothing here knows block types, so a new block needs no change to be
// checked. Pure: no React, no DOM.

import type { Localized } from "@/data/landingTypes";
import type { ObjectContent, TipTapDoc, TipTapNode } from "@/data/contentTypes";
import { allBlocks } from "@/data/popupTree";

const isStr = (v: unknown): v is string => typeof v === "string";

/** `{ en: string, ar: string }` with no other keys. */
export function isLocalized(v: unknown): v is Localized {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return isStr(o.en) && isStr(o.ar) && Object.keys(o).every((k) => k === "en" || k === "ar");
}

function isDoc(v: unknown): v is TipTapDoc {
  return !!v && typeof v === "object" && (v as TipTapDoc).type === "doc";
}

/** `{ en?: TipTapDoc, ar?: TipTapDoc }` (a rich-text body pair). */
export function isLocalizedDoc(v: unknown): v is { en?: TipTapDoc; ar?: TipTapDoc } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return (
    keys.length > 0 &&
    keys.every((k) => k === "en" || k === "ar") &&
    keys.some((k) => isDoc(o[k])) &&
    keys.every((k) => o[k] === undefined || o[k] === null || isDoc(o[k]))
  );
}

/** Plain text of a TipTap doc (for "is it filled?" and previews). */
export function docText(doc?: TipTapDoc | null): string {
  if (!doc?.content) return "";
  const walk = (n: TipTapNode): string =>
    (n.text ?? "") + (n.content ? n.content.map(walk).join(n.type === "paragraph" ? "" : " ") : "");
  return doc.content.map(walk).join(" ").replace(/\s+/g, " ").trim();
}

export interface LocalizedPair {
  path: string[];
  en: string;
  ar: string;
}

/**
 * Walk any JSON-ish value, yielding every bilingual pair (as plain text) and
 * every `href` string, each with a readable path.
 */
export function walkLocalized(
  value: unknown,
  path: string[],
  onPair: (p: LocalizedPair) => void,
  onHref?: (href: string, path: string[]) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkLocalized(v, [...path, `#${i + 1}`], onPair, onHref));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (isLocalized(value)) {
    onPair({ path, en: value.en, ar: value.ar });
    return;
  }
  if (isLocalizedDoc(value)) {
    onPair({ path, en: docText(value.en), ar: docText(value.ar) });
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "href" && isStr(v) && v.trim()) onHref?.(v, [...path, k]);
    else walkLocalized(v, [...path, k], onPair, onHref);
  }
}

export type TranslationState = "empty" | "complete" | "half";

/** One pair: both filled = complete, one side = half, neither = empty. */
export function pairState(en: string, ar: string): TranslationState {
  const e = en.trim() !== "";
  const a = ar.trim() !== "";
  return e && a ? "complete" : e || a ? "half" : "empty";
}

/** A whole value (a block's props, say): half if ANY pair is half. */
export function translationState(value: unknown): TranslationState {
  let any = false;
  let half = false;
  walkLocalized(value, [], ({ en, ar }) => {
    const s = pairState(en, ar);
    if (s === "half") half = true;
    if (s !== "empty") any = true;
  });
  return half ? "half" : any ? "complete" : "empty";
}

export interface ContentTranslation {
  /** Things with text in at least one language (title + blocks). */
  total: number;
  /** Of those, fully bilingual. */
  complete: number;
  /** Half-translated pairs with a short preview of the filled side. */
  gaps: { path: string[]; filled: "en" | "ar"; preview: string }[];
}

function preview(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 37)}…` : t;
}

/** A block's props without its container slots' child blocks. */
export function ownProps(props: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(props.slots)) return props;
  return {
    ...props,
    slots: (props.slots as { label?: unknown }[]).map((s) => ({ label: s.label })),
  };
}

/** Arabic/English coverage of one pop-up: the title plus each block. */
export function contentTranslation(c: ObjectContent | null | undefined): ContentTranslation {
  const out: ContentTranslation = { total: 0, complete: 0, gaps: [] };
  if (!c) return out;
  const title = pairState(c.title ?? "", c.titleAr ?? "");
  if (title !== "empty") {
    out.total++;
    if (title === "complete") out.complete++;
    else out.gaps.push({ path: ["title"], filled: c.title ? "en" : "ar", preview: preview(c.title || c.titleAr) });
  }
  // Every block on every page; a container counts for its own text (slot
  // labels), its children count separately, so a gap selects the right block.
  for (const b of allBlocks(c)) {
    const own = ownProps(b.props);
    const s = translationState(own);
    if (s === "empty") continue;
    out.total++;
    if (s === "complete") out.complete++;
    walkLocalized(own, [b.id], ({ path, en, ar }) => {
      if (pairState(en, ar) === "half") {
        out.gaps.push({ path, filled: en.trim() ? "en" : "ar", preview: preview(en.trim() ? en : ar) });
      }
    });
  }
  return out;
}
