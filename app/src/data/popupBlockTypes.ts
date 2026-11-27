// Prop shapes for the pop-up blocks that joined the shared block registry
// (components/landing/blocks/registry.tsx). Pure types + tiny helpers so the
// content migration (data/contentMigrations.ts) and the renderers agree on one
// shape without importing React.
//
// Every visitor-facing string is a `Localized` ({ en, ar }) pair, so the
// shape-based translation check (landingChecks' walker) finds half-translated
// text in pop-ups exactly like it does on landing pages.

import type { Localized } from "./landingTypes";
import type { EmbedType, ReelItem, TipTapDoc } from "./contentTypes";

/** Rich text: one TipTap document per language. */
export interface RichTextProps {
  doc: { en?: TipTapDoc; ar?: TipTapDoc };
}

export interface LinkItem {
  id: string;
  url: string;
  /** email | linkedin | store | github | twitter | instagram | website | phone */
  icon?: string;
  label: Localized;
}
export interface LinksProps {
  links: LinkItem[];
}

export type CvSectionKind = "experience" | "education" | "skills" | "languages" | "awards";
export interface CvTimelineItem {
  id: string;
  title: Localized;
  subtitle: Localized;
  period: Localized;
  /** One highlight per line. */
  highlights: Localized;
}
export interface CvTimelineSection {
  id: string;
  kind: CvSectionKind;
  title: Localized;
  items: CvTimelineItem[];
}
export interface CvTimelineProps {
  sections: CvTimelineSection[];
}

/** A single social/platform post (Instagram, TikTok, X) or allowlisted iframe. */
export interface PlatformEmbedProps {
  url: string;
  platform: EmbedType;
}

/**
 * One reel item as the block stores it: like the v1 `ReelItem`, but with a
 * `Localized` caption so the translation check sees it. `reelItemOf()` reads
 * either shape (v1 rows keep `caption` + `captionAr` strings until re-saved).
 */
export interface ReelBlockItem {
  id?: string;
  kind: "embed" | "upload";
  url: string;
  /** embed: the platform. */
  embedType?: Exclude<EmbedType, "custom-iframe">;
  /** upload: what the file is (set from the media library pick). */
  mediaType?: "video" | "image";
  /** embed: author-set preview image; upload video: poster frame. */
  thumbnailUrl?: string;
  posterUrl?: string;
  caption?: Localized | string;
  captionAr?: string;
}
/** Reel: a grid of embeds/uploads opening a swipeable viewer. */
export interface ReelProps {
  items: (ReelBlockItem | ReelItem)[];
}

/** Either reel item shape → the v1 `ReelItem` the viewer renders. */
export function reelItemOf(raw: ReelBlockItem | ReelItem): ReelItem {
  const r = raw as ReelBlockItem;
  const cap = r.caption;
  const caption = typeof cap === "string" ? cap : (cap?.en ?? "");
  const captionAr = typeof cap === "string" ? (r.captionAr ?? "") : (cap?.ar ?? "");
  if (r.kind === "upload") {
    return {
      kind: "upload",
      mediaType: r.mediaType === "image" ? "image" : "video",
      url: r.url ?? "",
      posterUrl: r.posterUrl,
      caption,
      captionAr,
    };
  }
  return {
    kind: "embed",
    url: r.url ?? "",
    embedType: r.embedType ?? "youtube",
    thumbnailUrl: r.thumbnailUrl,
    caption,
    captionAr,
  };
}

/** Video: a YouTube/Vimeo link (loads only when played) or an uploaded file. */
export interface VideoProps {
  source: "link" | "upload";
  /** source "link": a YouTube, Vimeo or direct video-file link. */
  url: string;
  /** source "upload": a file in content-videos. */
  file: string;
  poster: string;
  title: Localized;
  caption: Localized;
  aspect: "16:9" | "4:3" | "1:1" | "9:16";
  /** Uploads only: plays silently on a loop (no controls), like a GIF. */
  loop: boolean;
}

/** Audio: an uploaded sound file (content-files) with a title. */
export interface AudioProps {
  file: string;
  title: Localized;
  caption: Localized;
}

/** Screen: an image or video with text laid over it (the TV look). */
export interface ScreenProps {
  media: string;
  mediaKind: "image" | "video";
  heading: Localized;
  text: Localized;
  /** Where the words sit. */
  position: "top" | "center" | "bottom";
  align: "left" | "center" | "right";
  /** Darkening behind the words, 0–80 (%). */
  scrim: number;
  aspect: "16:9" | "4:3" | "1:1" | "3:4";
}

export interface ProjectLink {
  id: string;
  label: Localized;
  url: string;
}
/** Project card: a piece of work at a glance. */
export interface ProjectCardProps {
  cover: string;
  title: Localized;
  /** "Illustrator", "Writer & director"… */
  role: Localized;
  year: string;
  /** Comma-separated tags. */
  tags: Localized;
  description: Localized;
  links: ProjectLink[];
}

/** A file to download (PDF or audio from content-files), with its size. */
export interface FileDownloadProps {
  file: string;
  /** The file's name as uploaded (shown when there's no label). */
  fileName: string;
  /** Size in bytes, recorded when the file was picked. */
  bytes: number;
  label: Localized;
  description: Localized;
}

/** Contact: email / phone / social rows, plus the site form when connected. */
export interface ContactProps {
  intro: Localized;
  email: string;
  phone: string;
  links: LinkItem[];
  /** Show the contact form (only to visitors once Site settings → Forms has a
   *  destination). */
  showForm: boolean;
  formName: string;
}

/** A slot of a container block (a column, a tab, an accordion row). */
export interface SlotItem {
  id: string;
  label: Localized;
  blocks: { id: string; type: string; props: Record<string, unknown> }[];
}
export interface ColumnsProps {
  slots: SlotItem[];
  /** Columns stack on narrow sheets (phones) below this width. */
  stackOnPhones: boolean;
  gap: "s" | "m" | "l";
}
export interface TabSetProps {
  slots: SlotItem[];
}
export interface AccordionSetProps {
  slots: SlotItem[];
  /** Open the first row to start with. */
  firstOpen: boolean;
}

export function loc(en?: string, ar?: string): Localized {
  return { en: en ?? "", ar: ar ?? "" };
}
