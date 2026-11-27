// Pop-up content migrations — the single source of truth for the in-memory
// ObjectContent shape, mirroring src/data/migrations.ts for rooms.
//
// v1: one `type` per pop-up (richtext | gallery | cv | link-collection
//     | embed | reel | mixed) with the payload in type-specific fields.
// v2: `type: "blocks"`, an ordered `blocks` stack of shared registry blocks
//     (layout "sheet"), or `pages` of blocks (layout "pages", magazine).
//
// migrateObjectContent() is PURE and IDEMPOTENT: v2 in → same v2 out. Block
// ids are derived from the object id (not random) so a re-read yields the
// same ids (stable React keys, stable editor selection). Nothing is written
// back to the database here: a row stays v1 until the owner saves it.

import type { ContentBlock } from "./landingTypes";
import type { ObjectContent, TipTapDoc } from "./contentTypes";
import { CURRENT_CONTENT_VERSION } from "./contentTypes";
import type {
  CvTimelineProps,
  LinksProps,
  PlatformEmbedProps,
  ReelProps,
  RichTextProps,
} from "./popupBlockTypes";
import { loc } from "./popupBlockTypes";

function hasDoc(doc: unknown): doc is TipTapDoc {
  return !!doc && typeof doc === "object" && Array.isArray((doc as TipTapDoc).content) && (doc as TipTapDoc).content.length > 0;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- v1 rows are loose by nature */
function richText(id: string, raw: any): ContentBlock | null {
  if (!hasDoc(raw.body) && !hasDoc(raw.bodyAr)) return null;
  const props: RichTextProps = { doc: { en: raw.body, ar: raw.bodyAr } };
  return { id, type: "rich-text", props: props as unknown as Record<string, unknown> };
}

function links(id: string, raw: any): ContentBlock | null {
  const list = Array.isArray(raw.links) ? raw.links : [];
  if (!list.length) return null;
  const props: LinksProps = {
    links: list.map((l: any, i: number) => ({
      id: `${id}-${i}`,
      url: String(l?.url ?? ""),
      icon: l?.icon || undefined,
      label: loc(l?.label, l?.labelAr),
    })),
  };
  return { id, type: "links", props: props as unknown as Record<string, unknown> };
}

function cv(id: string, raw: any): ContentBlock | null {
  const sections = Array.isArray(raw.cvSections) ? raw.cvSections : [];
  if (!sections.length) return null;
  const props: CvTimelineProps = {
    sections: sections.map((s: any, si: number) => ({
      id: String(s?.id ?? `${id}-s${si}`),
      kind: s?.type ?? "experience",
      title: loc(s?.title, s?.titleAr),
      items: (Array.isArray(s?.items) ? s.items : []).map((it: any, ii: number) => ({
        id: String(it?.id ?? `${id}-s${si}-${ii}`),
        title: loc(it?.title, it?.titleAr),
        subtitle: loc(it?.subtitle, it?.subtitleAr),
        period: loc(it?.period, it?.periodAr),
        highlights: loc(
          (Array.isArray(it?.highlights) ? it.highlights : []).join("\n"),
          (Array.isArray(it?.highlightsAr) ? it.highlightsAr : []).join("\n")
        ),
      })),
    })),
  };
  return { id, type: "cv-timeline", props: props as unknown as Record<string, unknown> };
}

function gallery(id: string, raw: any): ContentBlock | null {
  const images = (Array.isArray(raw.images) ? raw.images : []).filter((img: any) => img?.url);
  if (!images.length) return null;
  return {
    id,
    type: "gallery",
    props: {
      images: images.map((img: any, i: number) => ({
        id: `${id}-${i}`,
        image: String(img?.url ?? ""),
        alt: loc(img?.caption, img?.captionAr),
        caption: loc(img?.caption, img?.captionAr),
        ...(img?.width ? { width: img.width } : {}),
        ...(img?.height ? { height: img.height } : {}),
      })),
      // The v1 renderer showed a 2-up grid; keep that, with zoom.
      columns: 2,
      mobileColumns: 2,
      gapPx: 12,
      aspect: "4 / 3",
      fit: "cover",
      rounded: true,
      muted: false,
      lightbox: true,
    },
  };
}

function embed(id: string, raw: any): ContentBlock | null {
  if (!raw.embedUrl) return null;
  const props: PlatformEmbedProps = {
    url: String(raw.embedUrl ?? ""),
    platform: raw.embedType ?? "youtube",
  };
  return { id, type: "platform-embed", props: props as unknown as Record<string, unknown> };
}

function reel(id: string, raw: any): ContentBlock | null {
  const v1 = Array.isArray(raw.reelItems) ? raw.reelItems : [];
  if (!v1.length) return null;
  // Captions become Localized pairs; every other key is kept as it was.
  const items = v1.map((it: any, i: number) => {
    const { caption, captionAr, ...rest } = it ?? {};
    return { id: `${id}-i${i}`, ...rest, caption: loc(caption, captionAr) };
  });
  const props: ReelProps = { items };
  return { id, type: "reel", props: props as unknown as Record<string, unknown> };
}

/** v1 → v2 blocks for one legacy pop-up. Empty legacy content → []. */
function v1Blocks(raw: any): ContentBlock[] {
  const base = `${raw.objectId ?? "content"}-b`;
  const out: (ContentBlock | null)[] = [];
  switch (raw.type) {
    case "cv":
      out.push(cv(`${base}0`, raw));
      break;
    case "link-collection":
      out.push(links(`${base}0`, raw));
      break;
    case "gallery":
      out.push(gallery(`${base}0`, raw));
      break;
    case "embed":
      out.push(embed(`${base}0`, raw));
      break;
    case "reel":
      out.push(reel(`${base}0`, raw));
      break;
    case "mixed":
      out.push(richText(`${base}0`, raw), links(`${base}1`, raw));
      break;
    default:
      // richtext and anything unknown: the body is the content.
      out.push(richText(`${base}0`, raw));
  }
  return out.filter((b): b is ContentBlock => b !== null);
}

/** Every key a v1 row may carry; the payload ones are converted into blocks. */
const V1_KEYS = new Set([
  "objectId",
  "roomId",
  "title",
  "titleAr",
  "type",
  "body",
  "bodyAr",
  "images",
  "links",
  "embedUrl",
  "embedType",
  "reelItems",
  "cvSections",
  "updatedAt",
  "contentVersion",
  "layout",
  "blocks",
  "pages",
]);

/**
 * Bring any stored pop-up content (v1 or v2) to the current shape. Returns
 * null for null/garbage input so callers keep their "no content" branch.
 */
export function migrateObjectContent(raw: unknown): ObjectContent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  if ((r.contentVersion ?? 1) >= CURRENT_CONTENT_VERSION && r.type === "blocks") {
    return {
      ...r,
      layout: r.layout === "pages" ? "pages" : "sheet",
      blocks: Array.isArray(r.blocks) ? r.blocks : [],
      pages: Array.isArray(r.pages) ? r.pages : undefined,
    } as ObjectContent;
  }
  // Unknown top-level keys ride along untouched (nothing is ever dropped).
  const rest: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(r)) if (!V1_KEYS.has(k)) rest[k] = val;
  return {
    ...rest,
    objectId: String(r.objectId ?? ""),
    roomId: r.roomId,
    title: typeof r.title === "string" ? r.title : "",
    titleAr: typeof r.titleAr === "string" ? r.titleAr : "",
    type: "blocks",
    contentVersion: CURRENT_CONTENT_VERSION,
    layout: "sheet",
    blocks: v1Blocks(r),
    // Where it came from (e.g. "gallery"), for the record.
    ...(r.type && r.type !== "blocks" ? { migratedFrom: r.type } : {}),
    ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Migrate every value of a `{ key: content }` map, dropping unreadable ones. */
export function migrateContentMap(map: Record<string, unknown> | null | undefined): Record<string, ObjectContent> {
  const out: Record<string, ObjectContent> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    const m = migrateObjectContent(v);
    if (m) out[k] = m;
  }
  return out;
}

/** True when a (migrated) pop-up has nothing to show. */
export function isContentEmpty(c: ObjectContent | null | undefined): boolean {
  if (!c) return true;
  if (c.layout === "pages") return !(c.pages ?? []).some((p) => p.blocks.length > 0);
  return !(c.blocks ?? []).length;
}
