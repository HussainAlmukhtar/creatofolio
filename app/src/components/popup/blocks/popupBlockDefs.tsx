"use client";

// Pop-up blocks in the shared block registry (landing/blocks/registry.tsx).
//
// The blocks v1 pop-up content migrates into (data/contentMigrations.ts: rich
// text, links, CV timeline, platform embed, reel) plus the media,
// portfolio and layout blocks (video, audio, screen, project card, file
// download, contact, columns, tabs, accordion). They declare
// `surfaces: ["popup"]`, so the landing page palette never offers them; the
// pop-up composer offers POPUP_PALETTE (stores/popupComposerStore.ts).
//
// Container blocks (columns / tab-set / accordion-set) hold
// `props.slots[].blocks` and render them through ctx.renderBlocks.
//
// Styling uses the section ink tokens (text-section-ink / -soft, border-line),
// defined for the pop-up scope by `.popup-surface` in globals.css, never the
// ambient chrome tokens.

import dynamic from "next/dynamic";
import {
  AudioLines,
  BriefcaseBusiness,
  Clapperboard,
  Columns3,
  Contact,
  FileDown,
  Film,
  Link2,
  ListCollapse,
  ListTree,
  PanelsTopLeft,
  Pilcrow,
  SquarePlay,
  Tv,
} from "lucide-react";
import type { BlockDef } from "@/components/landing/blocks/registry";
import type { FieldDescriptor } from "@/data/landingTypes";
import {
  reelItemOf,
  type AccordionSetProps,
  type AudioProps,
  type ColumnsProps,
  type ContactProps,
  type CvTimelineProps,
  type FileDownloadProps,
  type LinksProps,
  type PlatformEmbedProps,
  type ProjectCardProps,
  type ReelProps,
  type RichTextProps,
  type ScreenProps,
  type TabSetProps,
  type VideoProps,
} from "@/data/popupBlockTypes";
import { L } from "@/components/landing/blocks/shared";
import { safeHref } from "@/lib/safeUrl";
import { PlatformEmbed } from "@/components/game/PlatformEmbed";
import { TipTapView } from "./TipTapView";
import { docText } from "@/lib/localizedChecks";
import { LINK_ICON_OPTIONS, LinkRow } from "./LinkRow";
import { AudioBlock, ScreenBlock, VideoBlock } from "./MediaBlocks";
import { ContactBlock, FileDownloadBlock, ProjectCardBlock } from "./PortfolioBlocks";
import { AccordionSetBlock, ColumnsBlock, TabSetBlock } from "./ContainerBlocks";

// The reel viewer is the heaviest renderer; only load it when a reel shows.
const ReelRenderer = dynamic(
  () => import("@/components/game/ReelRenderer").then((m) => m.ReelRenderer),
  { ssr: false }
);

const ASPECT_OPTIONS = [
  { value: "16:9", label: "Widescreen 16:9" },
  { value: "4:3", label: "Classic 4:3" },
  { value: "1:1", label: "Square 1:1" },
  { value: "9:16", label: "Vertical 9:16 (Shorts/Reels)" },
];

const loc = (en = "", ar = "") => ({ en, ar });

// ─── Rich text ──────────────────────────────────────────────────

const richTextBlock: BlockDef = {
  type: "rich-text",
  label: "Rich text",
  labelAr: "نص منسّق",
  category: "text",
  icon: Pilcrow,
  surfaces: ["popup"],
  fields: [{ kind: "richtext", key: "doc", label: "Text" }],
  defaultProps: {
    doc: { en: { type: "doc", content: [{ type: "paragraph" }] }, ar: { type: "doc", content: [{ type: "paragraph" }] } },
  } satisfies RichTextProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => {
    const doc = (p as unknown as RichTextProps).doc ?? {};
    // Arabic visitors see the Arabic body; fall back to English rather than a
    // blank block (the Checks panel flags the missing translation).
    const d = language === "ar" ? (docText(doc.ar) ? doc.ar : doc.en) : docText(doc.en) ? doc.en : doc.ar;
    if (!docText(d) && !d?.content?.some((n) => n.type === "image")) {
      // Visitors see nothing; the composer shows something to click.
      return editor ? <p className="popup-block-hint">Text: type it in the panel on the right.</p> : null;
    }
    return <TipTapView doc={d} />;
  },
};

// ─── Links ──────────────────────────────────────────────────────

const linksBlock: BlockDef = {
  type: "links",
  label: "Links",
  labelAr: "روابط",
  category: "interactive",
  icon: Link2,
  surfaces: ["popup"],
  fields: [
    {
      kind: "array",
      key: "links",
      label: "Links",
      itemLabelKey: "label",
      itemFields: [
        { kind: "text", key: "label", label: "Label", localized: true },
        { kind: "url", key: "url", label: "Link (https://…, mailto:…, tel:…)" },
        { kind: "select", key: "icon", label: "Icon", options: LINK_ICON_OPTIONS },
      ],
      defaultItem: { label: { en: "New link", ar: "" }, url: "", icon: "website" },
    },
  ],
  defaultProps: {
    links: [{ id: "1", url: "mailto:", icon: "email", label: { en: "Email me", ar: "راسلني" } }],
  } satisfies LinksProps as unknown as Record<string, unknown>,
  render: (p, { language }) => {
    const links = (p as unknown as LinksProps).links ?? [];
    return (
      <ul className="popup-links">
        {links.map((link) => (
          <LinkRow key={link.id} href={safeHref(link.url)} iconKey={link.icon} label={L(link.label, language) || link.url} />
        ))}
      </ul>
    );
  },
};

// ─── CV timeline ────────────────────────────────────────────────

const cvTimelineBlock: BlockDef = {
  type: "cv-timeline",
  label: "CV / timeline",
  labelAr: "السيرة الذاتية",
  category: "text",
  icon: ListTree,
  surfaces: ["popup"],
  fields: [
    {
      kind: "array",
      key: "sections",
      label: "Sections",
      itemLabelKey: "title",
      itemFields: [
        { kind: "text", key: "title", label: "Section title", localized: true },
        {
          kind: "select",
          key: "kind",
          label: "Kind",
          options: [
            { value: "experience", label: "Experience" },
            { value: "education", label: "Education" },
            { value: "skills", label: "Skills" },
            { value: "languages", label: "Languages" },
            { value: "awards", label: "Awards" },
          ],
        },
        {
          kind: "array",
          key: "items",
          label: "Entries",
          itemLabelKey: "title",
          itemFields: [
            { kind: "text", key: "title", label: "Title", localized: true },
            { kind: "text", key: "subtitle", label: "Where / subtitle", localized: true },
            { kind: "text", key: "period", label: "Dates", localized: true },
            { kind: "textarea", key: "highlights", label: "Highlights (one per line)", localized: true },
          ],
          defaultItem: {
            title: { en: "Role", ar: "" },
            subtitle: { en: "", ar: "" },
            period: { en: "", ar: "" },
            highlights: { en: "", ar: "" },
          },
        },
      ],
      defaultItem: { title: { en: "Experience", ar: "الخبرة" }, kind: "experience", items: [] },
    },
  ],
  defaultProps: {
    sections: [{ id: "1", kind: "experience", title: { en: "Experience", ar: "الخبرة" }, items: [] }],
  } satisfies CvTimelineProps as unknown as Record<string, unknown>,
  render: (p, { language }) => {
    const sections = (p as unknown as CvTimelineProps).sections ?? [];
    return (
      <div className="popup-cv">
        {sections.map((section) => (
          <section key={section.id}>
            <h3 className="popup-cv__section font-display">{L(section.title, language)}</h3>
            {section.items.map((item) => {
              const subtitle = L(item.subtitle, language);
              const period = L(item.period, language);
              const highlights = L(item.highlights, language)
                .split("\n")
                .map((h) => h.trim())
                .filter(Boolean);
              return (
                <div key={item.id} className="popup-cv__item">
                  <div className="popup-cv__head">
                    <p>
                      <strong>{L(item.title, language)}</strong>
                      {subtitle && <span className="popup-cv__sub"> — {subtitle}</span>}
                    </p>
                    {period && <span className="popup-cv__period">{period}</span>}
                  </div>
                  {highlights.length > 0 && (
                    <ul>
                      {highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );
  },
};

// ─── Platform embed (legacy "embed" content) ────────────────────

const platformEmbedBlock: BlockDef = {
  type: "platform-embed",
  label: "Social post",
  labelAr: "منشور",
  category: "embed",
  icon: Clapperboard,
  surfaces: ["popup"],
  fields: [
    {
      kind: "select",
      key: "platform",
      label: "Platform",
      options: [
        { value: "youtube", label: "YouTube" },
        { value: "instagram", label: "Instagram" },
        { value: "tiktok", label: "TikTok" },
        { value: "twitter", label: "X / Twitter" },
        { value: "custom-iframe", label: "Other video link" },
      ],
    },
    { kind: "url", key: "url", label: "Post or video link" },
  ],
  defaultProps: { url: "", platform: "youtube" } satisfies PlatformEmbedProps as unknown as Record<string, unknown>,
  render: (p, { editor }) => {
    const props = p as unknown as PlatformEmbedProps;
    return <PlatformEmbed url={props.url ?? ""} embedType={props.platform} editor={editor} />;
  },
};

// ─── Reel ───────────────────────────────────────────────────────

const reelBlock: BlockDef = {
  type: "reel",
  label: "Reel",
  labelAr: "عرض مقاطع",
  category: "media",
  icon: Film,
  surfaces: ["popup"],
  fields: [
    {
      kind: "note",
      label: "A grid of clips that opens full screen; visitors swipe through. Mix TikTok/Instagram/YouTube links with your own uploads.",
    },
    {
      kind: "array",
      key: "items",
      label: "Clips",
      itemLabelKey: "caption",
      max: 30,
      itemFields: [
        {
          kind: "select",
          key: "kind",
          label: "Clip",
          options: [
            { value: "embed", label: "A post on another site" },
            { value: "upload", label: "My own video or image" },
          ],
        },
        {
          kind: "select",
          key: "embedType",
          label: "Site",
          options: [
            { value: "youtube", label: "YouTube" },
            { value: "tiktok", label: "TikTok" },
            { value: "instagram", label: "Instagram" },
            { value: "twitter", label: "X / Twitter" },
          ],
          when: { key: "kind", is: "embed" },
        },
        { kind: "url", key: "url", label: "Post link", when: { key: "kind", is: "embed" } },
        { kind: "image", key: "thumbnailUrl", label: "Preview image (shown in the grid)", when: { key: "kind", is: "embed" } },
        {
          kind: "media",
          key: "url",
          label: "Video or image",
          accept: ["video", "image"],
          meta: { kind: "mediaType" },
          when: { key: "kind", is: "upload" },
        },
        { kind: "image", key: "posterUrl", label: "Poster frame (videos)", when: { key: "kind", is: "upload" } },
        { kind: "text", key: "caption", label: "Caption", localized: true },
      ],
      defaultItem: { kind: "embed", embedType: "youtube", url: "", caption: loc() },
    },
  ],
  defaultProps: { items: [] } satisfies ReelProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => {
    const items = ((p as unknown as ReelProps).items ?? []).map(reelItemOf).filter((i) => i.url);
    if (!items.length) {
      return editor ? <p className="popup-block-hint">Reel: add clips in the panel on the right.</p> : null;
    }
    return <ReelRenderer items={items} language={language} />;
  },
};

// ─── Video / audio / screen ─────────────────────────────────────

const videoBlock: BlockDef = {
  type: "video",
  label: "Video",
  labelAr: "فيديو",
  category: "media",
  icon: SquarePlay,
  surfaces: ["popup"],
  fields: [
    {
      kind: "select",
      key: "source",
      label: "Video",
      options: [
        { value: "link", label: "YouTube or Vimeo link" },
        { value: "upload", label: "My own video file" },
      ],
    },
    { kind: "url", key: "url", label: "YouTube or Vimeo link", when: { key: "source", is: "link" } },
    {
      kind: "note",
      label: "The player only loads when a visitor presses play (faster, and nothing is sent to YouTube before that).",
      when: { key: "source", is: "link" },
    },
    { kind: "media", key: "file", label: "Video file", accept: ["video"], when: { key: "source", is: "upload" } },
    {
      kind: "toggle",
      key: "loop",
      label: "Play silently on a loop (like a GIF)",
      when: { key: "source", is: "upload" },
    },
    { kind: "image", key: "poster", label: "Poster image (shown before it plays)" },
    { kind: "text", key: "title", label: "Title (read by screen readers)", localized: true },
    { kind: "text", key: "caption", label: "Caption (optional)", localized: true },
    { kind: "select", key: "aspect", label: "Shape", options: ASPECT_OPTIONS },
  ],
  defaultProps: {
    source: "link",
    url: "",
    file: "",
    poster: "",
    title: loc("Video", "فيديو"),
    caption: loc(),
    aspect: "16:9",
    loop: false,
  } satisfies VideoProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => <VideoBlock p={p as unknown as VideoProps} language={language} editor={editor} />,
};

const audioBlock: BlockDef = {
  type: "audio",
  label: "Sound",
  labelAr: "صوت",
  category: "media",
  icon: AudioLines,
  surfaces: ["popup"],
  fields: [
    { kind: "media", key: "file", label: "Sound file", accept: ["audio"] },
    { kind: "text", key: "title", label: "Title", localized: true },
    { kind: "text", key: "caption", label: "Caption (optional)", localized: true },
  ],
  defaultProps: { file: "", title: loc(), caption: loc() } satisfies AudioProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => <AudioBlock p={p as unknown as AudioProps} language={language} editor={editor} />,
};

const screenBlock: BlockDef = {
  type: "screen",
  label: "Screen",
  labelAr: "شاشة",
  category: "media",
  icon: Tv,
  surfaces: ["popup"],
  fields: [
    {
      kind: "media",
      key: "media",
      label: "Image or video",
      accept: ["image", "video"],
      meta: { kind: "mediaKind" },
    },
    { kind: "text", key: "heading", label: "Big words", localized: true },
    { kind: "textarea", key: "text", label: "Smaller words", localized: true },
    {
      kind: "select",
      key: "position",
      label: "Words sit",
      options: [
        { value: "bottom", label: "At the bottom" },
        { value: "center", label: "In the middle" },
        { value: "top", label: "At the top" },
      ],
    },
    { kind: "align", key: "align", label: "Alignment" },
    { kind: "range", key: "scrim", label: "Darken behind the words", min: 0, max: 80, step: 5, unit: "%" },
    {
      kind: "select",
      key: "aspect",
      label: "Shape",
      options: [
        { value: "16:9", label: "Widescreen 16:9" },
        { value: "4:3", label: "TV 4:3" },
        { value: "1:1", label: "Square 1:1" },
        { value: "3:4", label: "Portrait 3:4" },
      ],
    },
  ],
  defaultProps: {
    media: "",
    mediaKind: "image",
    heading: loc("Now showing", "يُعرض الآن"),
    text: loc(),
    position: "bottom",
    align: "left",
    scrim: 45,
    aspect: "4:3",
  } satisfies ScreenProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => <ScreenBlock p={p as unknown as ScreenProps} language={language} editor={editor} />,
};

// ─── Portfolio ──────────────────────────────────────────────────

const projectCardBlock: BlockDef = {
  type: "project-card",
  label: "Project card",
  labelAr: "بطاقة مشروع",
  category: "text",
  icon: BriefcaseBusiness,
  surfaces: ["popup"],
  fields: [
    { kind: "image", key: "cover", label: "Cover image" },
    { kind: "text", key: "title", label: "Project", localized: true },
    { kind: "text", key: "role", label: "My role", localized: true },
    { kind: "text", key: "year", label: "Year", placeholder: "2026" },
    { kind: "text", key: "tags", label: "Tags (separated by commas)", localized: true },
    { kind: "textarea", key: "description", label: "About it", localized: true },
    {
      kind: "array",
      key: "links",
      label: "Links",
      itemLabelKey: "label",
      max: 4,
      itemFields: [
        { kind: "text", key: "label", label: "Label", localized: true },
        { kind: "url", key: "url", label: "Link" },
      ],
      defaultItem: { label: loc("See it", "شاهده"), url: "" },
    },
  ],
  defaultProps: {
    cover: "",
    title: loc("Project name", "اسم المشروع"),
    role: loc("What I did", "دوري"),
    year: "",
    tags: loc(),
    description: loc(),
    links: [],
  } satisfies ProjectCardProps as unknown as Record<string, unknown>,
  render: (p, { language }) => <ProjectCardBlock p={p as unknown as ProjectCardProps} language={language} />,
};

const fileDownloadBlock: BlockDef = {
  type: "file-download",
  label: "File download",
  labelAr: "تنزيل ملف",
  category: "conversion",
  icon: FileDown,
  surfaces: ["popup"],
  fields: [
    {
      kind: "media",
      key: "file",
      label: "File (PDF or sound)",
      accept: ["file", "audio"],
      meta: { name: "fileName", bytes: "bytes" },
    },
    { kind: "text", key: "label", label: "Label (blank = the file name)", localized: true },
    { kind: "text", key: "description", label: "Line under it (optional)", localized: true },
  ],
  defaultProps: {
    file: "",
    fileName: "",
    bytes: 0,
    label: loc("Download my CV", "حمّل سيرتي الذاتية"),
    description: loc(),
  } satisfies FileDownloadProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => (
    <FileDownloadBlock p={p as unknown as FileDownloadProps} language={language} editor={editor} />
  ),
};

const contactBlock: BlockDef = {
  type: "contact",
  label: "Contact",
  labelAr: "تواصل",
  category: "conversion",
  icon: Contact,
  surfaces: ["popup"],
  fields: [
    { kind: "textarea", key: "intro", label: "A line first (optional)", localized: true },
    { kind: "text", key: "email", label: "Email address", placeholder: "you@example.com" },
    { kind: "text", key: "phone", label: "Phone (optional)", placeholder: "+966 …" },
    {
      kind: "array",
      key: "links",
      label: "Other links",
      itemLabelKey: "label",
      max: 8,
      itemFields: [
        { kind: "text", key: "label", label: "Label", localized: true },
        { kind: "url", key: "url", label: "Link" },
        { kind: "select", key: "icon", label: "Icon", options: LINK_ICON_OPTIONS },
      ],
      defaultItem: { label: loc("Instagram", "إنستغرام"), url: "", icon: "instagram" },
    },
    { kind: "toggle", key: "showForm", label: "Add a contact form" },
    {
      kind: "note",
      label:
        "Messages go to the destination in Site settings → Forms. Until one is set, visitors don't see the form (you still see it here).",
      when: { key: "showForm", is: "true" },
    },
    { kind: "text", key: "formName", label: "Form name (sent with each message)", placeholder: "contact", when: { key: "showForm", is: "true" } },
  ],
  defaultProps: {
    intro: loc("Say hello — I read everything.", "قل مرحبًا — أقرأ كل الرسائل."),
    email: "",
    phone: "",
    links: [],
    showForm: false,
    formName: "contact",
  } satisfies ContactProps as unknown as Record<string, unknown>,
  render: (p, { language, editor }) => <ContactBlock p={p as unknown as ContactProps} language={language} editor={editor} />,
};

// ─── Layout containers (one level) ──────────────────────────────

/** Slot list field shared by the containers (labels + order; blocks inside
 *  are managed in the composer outline). */
function slotsField(label: string, noun: string, min: number, max: number, withLabel: boolean): FieldDescriptor {
  return {
    kind: "array",
    key: "slots",
    label,
    itemLabelKey: "label",
    min,
    max,
    itemFields: withLabel
      ? [{ kind: "text", key: "label", label: `${noun} title`, localized: true }]
      : [{ kind: "note", label: "Add blocks to it from the list on the left." }],
    defaultItem: { label: loc(`New ${noun.toLowerCase()}`, ""), blocks: [] },
  };
}

const slot = (id: string, en: string, ar: string) => ({ id, label: loc(en, ar), blocks: [] });

const columnsBlock: BlockDef = {
  type: "columns",
  label: "Columns",
  labelAr: "أعمدة",
  category: "layout",
  icon: Columns3,
  surfaces: ["popup"],
  fields: [
    slotsField("Columns", "Column", 2, 3, false),
    { kind: "toggle", key: "stackOnPhones", label: "Stack on narrow screens (phones)" },
    {
      kind: "select",
      key: "gap",
      label: "Space between",
      options: [
        { value: "s", label: "Small" },
        { value: "m", label: "Medium" },
        { value: "l", label: "Large" },
      ],
    },
  ],
  defaultProps: {
    slots: [slot("1", "Column 1", "العمود ١"), slot("2", "Column 2", "العمود ٢")],
    stackOnPhones: true,
    gap: "m",
  } satisfies ColumnsProps as unknown as Record<string, unknown>,
  render: (p, ctx) => <ColumnsBlock p={p as unknown as ColumnsProps} ctx={ctx} />,
};

const tabSetBlock: BlockDef = {
  type: "tab-set",
  label: "Tabs",
  labelAr: "تبويبات",
  category: "layout",
  icon: PanelsTopLeft,
  surfaces: ["popup"],
  fields: [slotsField("Tabs", "Tab", 1, 6, true)],
  defaultProps: {
    slots: [slot("1", "First", "الأول"), slot("2", "Second", "الثاني")],
  } satisfies TabSetProps as unknown as Record<string, unknown>,
  render: (p, ctx) => <TabSetBlock p={p as unknown as TabSetProps} ctx={ctx} />,
};

const accordionSetBlock: BlockDef = {
  type: "accordion-set",
  label: "Accordion",
  labelAr: "أكورديون",
  category: "layout",
  icon: ListCollapse,
  surfaces: ["popup"],
  fields: [
    slotsField("Rows", "Row", 1, 12, true),
    { kind: "toggle", key: "firstOpen", label: "Open the first row to start with" },
  ],
  defaultProps: {
    slots: [slot("1", "First question", "السؤال الأول"), slot("2", "Second question", "السؤال الثاني")],
    firstOpen: true,
  } satisfies AccordionSetProps as unknown as Record<string, unknown>,
  render: (p, ctx) => <AccordionSetBlock p={p as unknown as AccordionSetProps} ctx={ctx} />,
};

/** Blocks that hold other blocks (never nested inside each other). */
export const CONTAINER_BLOCK_TYPES = ["columns", "tab-set", "accordion-set"];

export const POPUP_BLOCK_DEFS: BlockDef[] = [
  richTextBlock,
  linksBlock,
  cvTimelineBlock,
  platformEmbedBlock,
  reelBlock,
  videoBlock,
  audioBlock,
  screenBlock,
  projectCardBlock,
  fileDownloadBlock,
  contactBlock,
  columnsBlock,
  tabSetBlock,
  accordionSetBlock,
];
