// Content data model for interactive objects.
//
// Each RoomObject can have associated content that's displayed
// in a modal when the player interacts with it.
// Content is bilingual (en/ar) and supports multiple types.

import type { RoomId } from "./roomTypes";
import type { ContentBlock } from "./landingTypes";

/** TipTap-compatible JSON document content (simplified for typing) */
export interface TipTapDoc {
  type: "doc";
  content: TipTapNode[];
}

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** An image in a gallery or embedded in content */
export interface ContentImage {
  url: string;
  caption: string;
  captionAr: string;
  width?: number;
  height?: number;
}

/** A link in a link collection */
export interface ContentLink {
  url: string;
  label: string;
  labelAr: string;
  icon?: string;
}

/** A section in a structured CV */
export interface CvSection {
  id: string;
  title: string;
  titleAr: string;
  type: "experience" | "education" | "skills" | "languages" | "awards";
  items: CvItem[];
}

export interface CvItem {
  id: string;
  title: string;
  titleAr: string;
  subtitle?: string;
  subtitleAr?: string;
  period?: string;
  periodAr?: string;
  highlights: string[];
  highlightsAr: string[];
}

/** Platforms a single embed or a reel item can point at. */
export type EmbedType = "youtube" | "instagram" | "tiktok" | "twitter" | "custom-iframe";

/** One item in a reel — either a platform embed or a self-hosted upload. */
export interface ReelItemEmbed {
  kind: "embed";
  url: string;
  /** Reels only support real oEmbed platforms, not the "any iframe" escape hatch. */
  embedType: Exclude<EmbedType, "custom-iframe">;
  /** Author-set poster image so the grid never has to load a platform script just to show a preview. */
  thumbnailUrl?: string;
  caption?: string;
  captionAr?: string;
}

export interface ReelItemUpload {
  kind: "upload";
  mediaType: "video" | "image";
  url: string;
  /** Poster frame for video uploads; ignored for images (the image itself is the thumbnail). */
  posterUrl?: string;
  caption?: string;
  captionAr?: string;
}

export type ReelItem = ReelItemEmbed | ReelItemUpload;

/**
 * Legacy (v1) content types: one type per pop-up. v2 content is always
 * `"blocks"` (a stack of registry blocks); v1 rows are converted on read by
 * `migrateObjectContent` (src/data/contentMigrations.ts) and keep rendering.
 */
export type ContentType =
  | "richtext"
  | "gallery"
  | "cv"
  | "link-collection"
  | "embed"
  | "mixed"
  | "reel"
  | "blocks";

/** Current pop-up content shape version (see contentMigrations.ts). */
export const CURRENT_CONTENT_VERSION = 2;

/** One page of a "pages" (magazine) pop-up. */
export interface PopupPage {
  id: string;
  kind: "cover" | "page" | "back";
  blocks: ContentBlock[];
}

/** Full content attached to a room object (or a landing button pop-up). */
export interface ObjectContent {
  objectId: string;
  roomId: RoomId;
  title: string;
  titleAr: string;
  type: ContentType;

  // ── v2 (contentVersion 2) ──
  contentVersion?: number;
  /** "sheet" = one block stack; "pages" = cover/pages/back (magazine). */
  layout?: "sheet" | "pages";
  /** Sheet-mode blocks (ContentBlock is the shared landing/pop-up block). */
  blocks?: ContentBlock[];
  pages?: PopupPage[];
  /** A drawn frame from the frame library; null/absent = theme panel. */
  frameIid?: string | null;
  /** Desktop width. */
  size?: "s" | "m" | "l";
  /** Set when converted from a v1 row: the original `type` (e.g. "gallery"). */
  migratedFrom?: ContentType;

  // ── v1 fields below: read-only legacy, converted by migrateObjectContent ──

  // Rich text (TipTap JSON document)
  body?: TipTapDoc;
  bodyAr?: TipTapDoc;

  // Image gallery
  images?: ContentImage[];

  // Link collection
  links?: ContentLink[];

  // Embed (single platform post or arbitrary iframe)
  embedUrl?: string;
  embedType?: EmbedType;

  // Reel — a grid of embeds and/or uploads that opens into a full-screen
  // swipeable viewer (e.g. a content-creation showcase mixing TikToks,
  // YouTube Shorts, and self-hosted clips).
  reelItems?: ReelItem[];

  // CV (structured)
  cvSections?: CvSection[];

  // Metadata
  updatedAt?: string;
}

/** Helper to create a simple TipTap doc from plain text paragraphs */
export function textToTipTap(paragraphs: string[]): TipTapDoc {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : undefined,
    })),
  };
}

/** Helper to create a TipTap doc with a heading + paragraphs */
export function headingAndText(
  heading: string,
  paragraphs: string[],
  level = 2
): TipTapDoc {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: heading }],
      },
      ...paragraphs.map((text) => ({
        type: "paragraph" as const,
        content: text ? [{ type: "text" as const, text }] : undefined,
      })),
    ],
  };
}
