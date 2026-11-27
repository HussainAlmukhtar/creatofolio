"use client";

// Block registry — the single source of truth for every flow-section component.
//
// Each entry (BlockDef) bundles: palette metadata (label/category/icon), the
// declarative `fields` that GENERATE the settings inspector, `defaultProps` that
// seed a fully-formed block on insert, and `render` — the REAL public React
// component. One registry drives the add-block palette, the inspector, and
// rendering, so adding a component is a single entry here (the "data change, not
// code change" ethos, mirroring BootScene/DynamicRoomScene).

import type { ReactNode } from "react";
import {
  Heading1,
  Type as TypeIcon,
  MousePointerClick,
  Image as ImageIcon,
  Minus,
  MoveVertical,
  GalleryHorizontalEnd,
  ListCollapse,
  PanelsTopLeft,
  Clapperboard,
  Share2,
  Send,
  LayoutGrid,
  Quote,
  ListChecks,
  Map as MapIcon,
  MailPlus,
  type LucideIcon,
} from "lucide-react";
import type {
  HoverEffect,
  BlockCategory,
  ContentBlock,
  DrawnAsset,
  FieldDescriptor,
  Localized,
} from "@/data/landingTypes";
import { newIid } from "@/lib/iid";
import { safeHref, safeMediaSrc } from "@/lib/safeUrl";
import { HOVER_EFFECT_OPTIONS } from "../hoverEffect";
import { PLACEHOLDER_SVG, isPlaceholderSrc } from "@/data/landingPlaceholders";
import ImagePlaceholder from "../ImagePlaceholder";
import { L, alignToCss } from "./shared";
import { CarouselBlock, type CarouselProps } from "./CarouselBlock";
import { AccordionBlock, type AccordionProps } from "./AccordionBlock";
import { TabsBlock, type TabsProps } from "./TabsBlock";
import { EmbedBlock, type EmbedProps } from "./EmbedBlock";
import { FormBlock, type FormProps } from "./FormBlock";
import { Fonted } from "./Fonted";
import {
  GalleryBlock,
  QuoteBlock,
  FeatureListBlock,
  MapBlock,
  FEATURE_ICON_OPTIONS,
  type GalleryProps,
  type QuoteProps,
  type FeatureListProps,
  type MapProps,
} from "./MoreBlocks";
import { POPUP_BLOCK_DEFS } from "@/components/popup/blocks/popupBlockDefs";
import { PopupImage } from "@/components/popup/blocks/PopupImage";
import {
  SocialLinksBlock,
  SOCIAL_PLATFORM_OPTIONS,
  type SocialLinksProps,
} from "./SocialLinksBlock";

export interface RenderCtx {
  language: "en" | "ar";
  /** True inside the editor canvas (blocks can soften interactivity if needed). */
  editor?: boolean;
  /** The site-wide default hover effect (blocks with a "hover" prop of
   *  "inherit" resolve to this). */
  hoverDefault?: HoverEffect;
  /** Where the block renders: a landing canvas box (default) or a pop-up's
   *  vertical flow (no box height to fill). */
  surface?: BlockSurface;
  /** Pop-up container blocks render their slots' child blocks with this
   *  (PopupView's BlockList: same selection + rendering as the top level). */
  renderBlocks?: (blocks: ContentBlock[]) => ReactNode;
  /** Composer: the selected block, so a container can open the tab/row
   *  holding it. */
  selectedId?: string | null;
}

export interface BlockDef<P = Record<string, unknown>> {
  type: string;
  label: string;
  labelAr?: string;
  category: BlockCategory;
  icon: LucideIcon;
  fields: FieldDescriptor[];
  defaultProps: P;
  render: (props: P, ctx: RenderCtx) => ReactNode;
  /**
   * Starting box when this component is dropped onto a section canvas, as
   * percentages of the section. `autoHeight` means the component sizes its own
   * height rather than filling the box — needed for anything whose height
   * changes with interaction (an accordion expanding) or with text length.
   */
  defaultSize?: { w: number; h: number; autoHeight?: boolean };
  /**
   * Where this block may be added: landing page canvases ("page") and/or
   * pop-ups ("popup", rendered in a vertical flow). Absent = ["page"] only, so
   * a new landing block never leaks into pop-ups by accident.
   */
  surfaces?: BlockSurface[];
}

export type BlockSurface = "page" | "popup";

/** Box used when a block declares no `defaultSize`. */
export const FALLBACK_BLOCK_SIZE = { w: 60, h: 20, autoHeight: true } as const;

// ─── Simple inline blocks ───────────────────────────────────────

const HEADING_TAGS = { h2: "h2", h3: "h3", h4: "h4" } as const;

const headingBlock: BlockDef = {
  type: "heading",
  label: "Heading",
  labelAr: "عنوان",
  category: "text",
  icon: Heading1,
  fields: [
    { kind: "text", key: "text", label: "Text", localized: true },
    {
      kind: "select",
      key: "level",
      label: "Size",
      options: [
        { value: "h2", label: "Large (H2)" },
        { value: "h3", label: "Medium (H3)" },
        { value: "h4", label: "Small (H4)" },
      ],
    },
    { kind: "align", key: "align", label: "Alignment" },
    { kind: "font", key: "font", label: "Font (optional)" },
    { kind: "color", key: "color", label: "Color (optional)" },
  ],
  defaultProps: {
    text: { en: "Heading", ar: "عنوان" },
    level: "h2",
    align: "center",
    color: "",
  },
  defaultSize: { w: 60, h: 10, autoHeight: true },
  render: (p, { language, surface }) => {
    const Tag = HEADING_TAGS[(p.level as keyof typeof HEADING_TAGS) ?? "h2"] ?? "h2";
    // A pop-up sheet is ~32rem wide: page-sized headings would shout.
    const size =
      surface === "popup"
        ? Tag === "h2"
          ? "text-2xl"
          : Tag === "h3"
            ? "text-xl"
            : "text-lg"
        : Tag === "h2"
          ? "text-4xl md:text-5xl"
          : Tag === "h3"
            ? "text-3xl md:text-4xl"
            : "text-2xl md:text-3xl";
    return (
      <Fonted
        as={Tag}
        font={p.font}
        fontAr={p.fontAr}
        role="display"
        language={language}
        className={`font-display font-semibold text-section-ink ${size}`}
        style={{ textAlign: alignToCss(p.align), color: (p.color as string) || undefined }}
      >
        {L(p.text, language)}
      </Fonted>
    );
  },
};

const textBlock: BlockDef = {
  type: "text",
  label: "Text",
  labelAr: "نص",
  category: "text",
  icon: TypeIcon,
  fields: [
    { kind: "textarea", key: "text", label: "Text", localized: true },
    { kind: "align", key: "align", label: "Alignment" },
    {
      kind: "select",
      key: "size",
      label: "Size",
      options: [
        { value: "sm", label: "Small" },
        { value: "base", label: "Normal" },
        { value: "lg", label: "Large" },
        { value: "xl", label: "Lead (extra large)" },
      ],
    },
    {
      kind: "select",
      key: "tone",
      label: "Tone",
      options: [
        { value: "soft", label: "Soft (body)" },
        { value: "strong", label: "Strong (full ink)" },
      ],
    },
    { kind: "font", key: "font", label: "Font (optional)" },
    { kind: "color", key: "color", label: "Colour (optional)" },
  ],
  defaultProps: {
    text: { en: "Write something here.", ar: "اكتب شيئًا هنا." },
    align: "center",
    size: "base",
    tone: "soft",
    color: "",
  },
  defaultSize: { w: 50, h: 12, autoHeight: true },
  // Fills its element box's width — the box IS the measure the author sets
  // on the canvas (a max-width here used to fight the resize handles).
  render: (p, { language }) => {
    const size =
      p.size === "sm"
        ? "text-sm"
        : p.size === "lg"
          ? "text-lg md:text-xl"
          : p.size === "xl"
            ? "text-xl md:text-2xl"
            : "text-base md:text-lg";
    const tone = p.tone === "strong" ? "text-section-ink" : "text-section-ink-soft";
    return (
      <Fonted
        as="p"
        font={p.font}
        fontAr={p.fontAr}
        role="body"
        language={language}
        className={`whitespace-pre-wrap leading-relaxed text-pretty ${tone} ${size}`}
        style={{ textAlign: alignToCss(p.align), color: (p.color as string) || undefined }}
      >
        {L(p.text, language)}
      </Fonted>
    );
  },
};

const buttonBlock: BlockDef = {
  type: "button",
  label: "Button",
  labelAr: "زر",
  category: "conversion",
  icon: MousePointerClick,
  fields: [
    { kind: "text", key: "label", label: "Label", localized: true },
    {
      kind: "select",
      key: "kind",
      label: "When clicked",
      options: [
        { value: "link", label: "Open a link" },
        { value: "email", label: "Write an email" },
        { value: "download", label: "Download a file" },
      ],
    },
    { kind: "url", key: "href", label: "Link URL", when: { key: "kind", is: "link" } },
    { kind: "toggle", key: "newTab", label: "Open in a new tab", when: { key: "kind", is: "link" } },
    { kind: "text", key: "email", label: "Email address", placeholder: "you@example.com", when: { key: "kind", is: "email" } },
    { kind: "text", key: "subject", label: "Subject (optional)", localized: true, when: { key: "kind", is: "email" } },
    { kind: "url", key: "file", label: "File link (https://…)", when: { key: "kind", is: "download" } },
    {
      kind: "select",
      key: "variant",
      label: "Style",
      options: [
        { value: "solid", label: "Solid" },
        { value: "outline", label: "Outline" },
        { value: "link", label: "Text link" },
      ],
    },
    {
      kind: "select",
      key: "size",
      label: "Size",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    { kind: "toggle", key: "arrow", label: "Show arrow →" },
    { kind: "toggle", key: "fullWidth", label: "Full width of its box" },
    { kind: "align", key: "align", label: "Alignment" },
    { kind: "color", key: "color", label: "Colour (optional — defaults to the section ink)" },
    {
      kind: "select",
      key: "hover",
      label: "Hover effect",
      options: [{ value: "inherit", label: "Site default" }, ...HOVER_EFFECT_OPTIONS],
    },
  ],
  defaultProps: {
    label: { en: "Learn more", ar: "اعرف المزيد" },
    kind: "link",
    href: "#",
    newTab: false,
    variant: "solid",
    size: "md",
    arrow: false,
    fullWidth: false,
    align: "center",
    color: "",
    hover: "inherit",
  },
  defaultSize: { w: 24, h: 7, autoHeight: true },
  render: (p, { language, hoverDefault, editor }) => {
    const hover = !p.hover || p.hover === "inherit" ? (hoverDefault ?? "lift") : (p.hover as string);
    const variant = p.variant === "outline" || p.variant === "link" ? p.variant : "solid";
    const size = p.size === "sm" || p.size === "lg" ? p.size : "md";
    const justify =
      alignToCss(p.align) === "left" ? "flex-start" : alignToCss(p.align) === "right" ? "flex-end" : "center";
    const color = (p.color as string) || "";
    const style = color
      ? ({ "--btn": color, "--btn-text": readableTextOn(color) } as React.CSSProperties)
      : undefined;
    return (
      <div style={{ display: "flex", justifyContent: justify }}>
        <a
          // Unsafe links (javascript:, data:, //host…) fall back to an inert "#".
          href={buttonHref(p, language) ?? "#"}
          download={p.kind === "download" ? "" : undefined}
          target={(!p.kind || p.kind === "link") && p.newTab && !editor ? "_blank" : undefined}
          rel={(!p.kind || p.kind === "link") && p.newTab ? "noopener noreferrer" : undefined}
          data-hover={variant === "link" ? undefined : hover}
          data-variant={variant}
          data-size={size}
          data-full={p.fullWidth ? "true" : undefined}
          className="block-button relative"
          style={style}
        >
          {L(p.label, language)}
          {Boolean(p.arrow) && (
            <span aria-hidden="true" className="block-button__arrow">
              →
            </span>
          )}
        </a>
      </div>
    );
  },
};

/** Black or white text, whichever reads better on a hex background. */
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? "#1f1b18" : "#fff";
}

const EMAIL_RE = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;

/** A button's target for its kind: link (safe href), email (mailto with an
 *  optional subject) or download (safe file link). null = inert. */
function buttonHref(p: Record<string, unknown>, language: "en" | "ar"): string | null {
  if (p.kind === "email") {
    const addr = typeof p.email === "string" ? p.email.trim() : "";
    if (!EMAIL_RE.test(addr)) return null;
    const subject = L(p.subject, language);
    return `mailto:${addr}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  }
  if (p.kind === "download") return safeHref(p.file);
  return safeHref(p.href);
}

const imageBlock: BlockDef = {
  type: "image",
  label: "Image",
  labelAr: "صورة",
  category: "media",
  icon: ImageIcon,
  fields: [
    { kind: "image", key: "url", label: "Image" },
    { kind: "text", key: "alt", label: "Alt text (describe the image)", localized: true },
    {
      kind: "select",
      key: "fit",
      label: "Fit",
      options: [
        { value: "cover", label: "Fill the frame (crop)" },
        { value: "contain", label: "Show whole image" },
      ],
    },
    { kind: "toggle", key: "rounded", label: "Rounded corners" },
    { kind: "text", key: "caption", label: "Caption (optional)", localized: true, surface: "popup" },
    { kind: "toggle", key: "lightbox", label: "Tap to enlarge", surface: "popup" },
    { kind: "url", key: "href", label: "Link (optional)" },
  ],
  defaultProps: {
    url: PLACEHOLDER_SVG,
    alt: { en: "", ar: "" },
    fit: "cover",
    rounded: true,
    href: "",
    caption: { en: "", ar: "" },
    lightbox: true,
  },
  defaultSize: { w: 40, h: 40 },
  // The image FILLS its element box (resize the frame on the canvas, like a
  // builder's image block); `fit` decides crop vs letterbox. Legacy
  // maxWidthPct still narrows it inside the box.
  render: (p, { language, editor, surface }) => {
    const raw = p.url as string;
    const url = isPlaceholderSrc(raw) ? raw : (safeMediaSrc(raw, "image") ?? "");
    if (surface === "popup") {
      if (!url || isPlaceholderSrc(url)) {
        return editor ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl">
            <ImagePlaceholder fill />
          </div>
        ) : null;
      }
      return (
        <PopupImage
          src={url}
          alt={p.alt as Localized}
          caption={p.caption as Localized}
          rounded={Boolean(p.rounded)}
          lightbox={p.lightbox !== false}
          href={safeHref(p.href) ?? ""}
          language={language}
          editor={editor}
        />
      );
    }
    const rounded = p.rounded ? "rounded-xl" : "";
    const inner =
      !url || isPlaceholderSrc(url) ? (
        <ImagePlaceholder fill />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={L(p.alt, language)}
          draggable={false}
          className={`absolute inset-0 h-full w-full ${rounded} ${p.fit === "contain" ? "object-contain" : "object-cover"}`}
        />
      );
    const href = safeHref(p.href) ?? "";
    const frame = `relative mx-auto block h-full overflow-hidden ${rounded}`;
    const style = { width: `${(p.maxWidthPct as number) ?? 100}%` };
    return href && !editor ? (
      <a href={href} className={`${frame} focus-visible:outline-3 focus-visible:outline-offset-4`} style={style}>
        {inner}
      </a>
    ) : (
      <div className={frame} style={style}>
        {inner}
      </div>
    );
  },
};

const dividerBlock: BlockDef = {
  type: "divider",
  label: "Divider",
  labelAr: "فاصل",
  category: "layout",
  icon: Minus,
  fields: [
    {
      kind: "select",
      key: "style",
      label: "Style",
      options: [
        { value: "line", label: "Line" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" },
        { value: "wave", label: "Hand-drawn wave" },
        { value: "ornament", label: "Ornament ✦" },
      ],
    },
    { kind: "range", key: "thickness", label: "Thickness", min: 1, max: 4, step: 0.5, unit: "px" },
    { kind: "color", key: "color", label: "Colour (optional)" },
  ],
  defaultProps: { style: "line", thickness: 1, color: "" },
  defaultSize: { w: 40, h: 4, autoHeight: true },
  // Spans its element box: resize the box to change the rule's length.
  render: (p) => {
    const color = (p.color as string) || "var(--line)";
    const t = (p.thickness as number) || 1;
    const style = (p.style as string) || "line";
    if (style === "wave") {
      return (
        <svg aria-hidden="true" className="block h-3 w-full" preserveAspectRatio="none" viewBox="0 0 240 12">
          <path
            d="M0 6 Q 10 1 20 6 T 40 6 T 60 6 T 80 6 T 100 6 T 120 6 T 140 6 T 160 6 T 180 6 T 200 6 T 220 6 T 240 6"
            fill="none"
            stroke={(p.color as string) || "var(--section-ink-soft)"}
            strokeOpacity={p.color ? 1 : 0.55}
            strokeWidth={t}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      );
    }
    if (style === "ornament") {
      return (
        <div role="separator" className="flex items-center gap-3 text-section-ink-soft">
          <span className="h-0 flex-1" style={{ borderTop: `${t}px solid ${color}` }} />
          <span aria-hidden="true" className="text-xs opacity-70" style={p.color ? { color: p.color as string } : undefined}>
            ✦
          </span>
          <span className="h-0 flex-1" style={{ borderTop: `${t}px solid ${color}` }} />
        </div>
      );
    }
    const border = style === "dashed" ? "dashed" : style === "dotted" ? "dotted" : "solid";
    return <hr className="my-1.5 w-full border-0" style={{ borderTop: `${t}px ${border} ${color}` }} />;
  },
};

const spacerBlock: BlockDef = {
  type: "spacer",
  label: "Spacer",
  labelAr: "مسافة",
  category: "layout",
  icon: MoveVertical,
  fields: [
    { kind: "range", key: "height", label: "Height", min: 8, max: 240, step: 4, unit: "px" },
    { kind: "note", label: "Adds breathing room in the stacked phone layout. Invisible to visitors." },
  ],
  defaultProps: { height: 48 },
  defaultSize: { w: 20, h: 6, autoHeight: true },
  render: (p, { editor }) => (
    <div
      aria-hidden="true"
      className={editor ? "editor-spacer" : undefined}
      style={{ height: `${(p.height as number) ?? 48}px` }}
    />
  ),
};

// ─── Interactive blocks ─────────────────────────────────────────

const carouselBlock: BlockDef = {
  type: "carousel",
  label: "Carousel",
  labelAr: "كاروسيل",
  category: "interactive",
  icon: GalleryHorizontalEnd,
  fields: [
    {
      kind: "array",
      key: "slides",
      label: "Slides",
      itemLabelKey: "caption",
      min: 1,
      itemFields: [
        { kind: "image", key: "image", label: "Image" },
        { kind: "text", key: "caption", label: "Caption", localized: true },
      ],
      defaultItem: { image: PLACEHOLDER_SVG, caption: { en: "", ar: "" } },
    },
    { kind: "toggle", key: "autoplay", label: "Autoplay" },
    { kind: "number", key: "intervalMs", label: "Autoplay interval (ms)", min: 1000, step: 500 },
    { kind: "toggle", key: "loop", label: "Loop" },
    { kind: "toggle", key: "draggable", label: "Drag / swipe" },
    { kind: "toggle", key: "showArrows", label: "Show arrows" },
    { kind: "toggle", key: "showDots", label: "Show dots" },
    { kind: "number", key: "slidesPerView", label: "Slides per view", min: 1, max: 6, step: 1 },
    { kind: "number", key: "gapPx", label: "Gap (px)", min: 0, max: 64, step: 4 },
    {
      kind: "select",
      key: "fit",
      label: "Image fit",
      options: [
        { value: "cover", label: "Fill the slide (crop)" },
        { value: "contain", label: "Show whole image" },
      ],
    },
  ],
  defaultProps: {
    fit: "cover",
    slides: [
      { id: "1", image: PLACEHOLDER_SVG, caption: { en: "Slide one", ar: "شريحة ١" } },
      { id: "2", image: PLACEHOLDER_SVG, caption: { en: "Slide two", ar: "شريحة ٢" } },
      { id: "3", image: PLACEHOLDER_SVG, caption: { en: "Slide three", ar: "شريحة ٣" } },
    ],
    autoplay: true,
    intervalMs: 4000,
    loop: true,
    draggable: true,
    showArrows: true,
    showDots: true,
    slidesPerView: 1,
    gapPx: 16,
  } satisfies CarouselProps as unknown as Record<string, unknown>,
  // Fixed box: a carousel's slide viewport should be author-controlled.
  defaultSize: { w: 70, h: 45 },
  render: (p, { language, editor }) => <CarouselBlock props={p as unknown as CarouselProps} language={language} editor={editor} />,
};

const accordionBlock: BlockDef = {
  type: "accordion",
  label: "Accordion (FAQ)",
  labelAr: "أكورديون",
  category: "interactive",
  icon: ListCollapse,
  fields: [
    {
      kind: "array",
      key: "items",
      label: "Rows",
      itemLabelKey: "title",
      min: 1,
      itemFields: [
        { kind: "text", key: "title", label: "Question / title", localized: true },
        { kind: "textarea", key: "body", label: "Answer / content", localized: true },
      ],
      defaultItem: { title: { en: "New question", ar: "سؤال جديد" }, body: { en: "Answer.", ar: "الإجابة." } },
    },
    {
      kind: "select",
      key: "mode",
      label: "Open behaviour",
      options: [
        { value: "single", label: "One at a time" },
        { value: "multiple", label: "Allow multiple open" },
      ],
    },
    { kind: "toggle", key: "collapsible", label: "Allow closing the open row" },
  ],
  defaultProps: {
    items: [
      { id: "1", title: { en: "What is this?", ar: "ما هذا؟" }, body: { en: "A real accordion.", ar: "أكورديون حقيقي." } },
      { id: "2", title: { en: "How does it work?", ar: "كيف يعمل؟" }, body: { en: "Click a row to expand it.", ar: "انقر على صف لتوسيعه." } },
    ],
    mode: "single",
    collapsible: true,
  } satisfies AccordionProps as unknown as Record<string, unknown>,
  // Auto height — rows expand on click and must not clip.
  defaultSize: { w: 60, h: 25, autoHeight: true },
  render: (p, { language, editor }) => <AccordionBlock props={p as unknown as AccordionProps} language={language} editor={editor} />,
};

const tabsBlock: BlockDef = {
  type: "tabs",
  label: "Tabs",
  labelAr: "تبويبات",
  category: "interactive",
  icon: PanelsTopLeft,
  fields: [
    {
      kind: "array",
      key: "tabs",
      label: "Tabs",
      itemLabelKey: "label",
      min: 1,
      itemFields: [
        { kind: "text", key: "label", label: "Tab label", localized: true },
        { kind: "textarea", key: "body", label: "Tab content", localized: true },
      ],
      defaultItem: { label: { en: "New tab", ar: "تبويب جديد" }, body: { en: "Content.", ar: "المحتوى." } },
    },
  ],
  defaultProps: {
    tabs: [
      { id: "1", label: { en: "Tab one", ar: "تبويب ١" }, body: { en: "First panel.", ar: "اللوحة الأولى." } },
      { id: "2", label: { en: "Tab two", ar: "تبويب ٢" }, body: { en: "Second panel.", ar: "اللوحة الثانية." } },
    ],
  } satisfies TabsProps as unknown as Record<string, unknown>,
  // Auto height — panel content length varies per tab.
  defaultSize: { w: 60, h: 25, autoHeight: true },
  render: (p, { language, editor }) => <TabsBlock props={p as unknown as TabsProps} language={language} editor={editor} />,
};

// ─── Embed & social ─────────────────────────────────────────────

const embedBlock: BlockDef = {
  type: "embed",
  label: "Video embed",
  labelAr: "فيديو مضمّن",
  category: "embed",
  icon: Clapperboard,
  fields: [
    { kind: "url", key: "url", label: "YouTube, Vimeo or video-file link" },
    {
      kind: "note",
      label:
        "Only YouTube (privacy-enhanced), Vimeo and direct .mp4/.webm links embed — other sites can't run code on your page.",
    },
    { kind: "text", key: "title", label: "Title (read by screen readers)", localized: true },
    {
      kind: "select",
      key: "aspect",
      label: "Shape",
      options: [
        { value: "16:9", label: "Widescreen 16:9" },
        { value: "4:3", label: "Classic 4:3" },
        { value: "1:1", label: "Square 1:1" },
        { value: "9:16", label: "Vertical 9:16 (Shorts/Reels)" },
      ],
    },
    { kind: "toggle", key: "rounded", label: "Rounded corners" },
  ],
  defaultProps: {
    url: "",
    title: { en: "Video", ar: "فيديو" },
    aspect: "16:9",
    rounded: true,
  } satisfies EmbedProps as unknown as Record<string, unknown>,
  // Height follows the chosen aspect ratio.
  defaultSize: { w: 50, h: 45, autoHeight: true },
  render: (p, { language, editor }) => (
    <EmbedBlock props={p as unknown as EmbedProps} language={language} editor={editor} />
  ),
};

const socialLinksBlock: BlockDef = {
  type: "social-links",
  label: "Social links",
  labelAr: "روابط التواصل",
  category: "social",
  icon: Share2,
  fields: [
    {
      kind: "array",
      key: "links",
      label: "Profiles",
      itemLabelKey: "url",
      min: 1,
      itemFields: [
        { kind: "select", key: "platform", label: "Platform", options: SOCIAL_PLATFORM_OPTIONS },
        { kind: "text", key: "url", label: "Profile link (or email address)" },
      ],
      defaultItem: { platform: "instagram", url: "" },
    },
    {
      kind: "select",
      key: "style",
      label: "Style",
      options: [
        { value: "icons", label: "Icons only" },
        { value: "icons-labels", label: "Icons + names" },
      ],
    },
    {
      kind: "select",
      key: "size",
      label: "Icon size",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    { kind: "align", key: "align", label: "Alignment" },
    { kind: "toggle", key: "newTab", label: "Open in a new tab" },
  ],
  defaultProps: {
    links: [
      { id: "1", platform: "instagram", url: "" },
      { id: "2", platform: "youtube", url: "" },
      { id: "3", platform: "email", url: "" },
    ],
    style: "icons",
    size: "md",
    align: "center",
    newTab: true,
  } satisfies SocialLinksProps as unknown as Record<string, unknown>,
  defaultSize: { w: 40, h: 8, autoHeight: true },
  render: (p, { editor }) => (
    <SocialLinksBlock props={p as unknown as SocialLinksProps} editor={editor} />
  ),
};

// ─── Conversion ─────────────────────────────────────────────────

const formBlock: BlockDef = {
  type: "form",
  label: "Form",
  labelAr: "نموذج",
  category: "conversion",
  icon: Send,
  fields: [
    {
      kind: "note",
      label:
        "Submissions go to the destination in Site settings → Forms (HubSpot or a webhook to any CRM / mailing tool). Until one is set, visitors don't see this form.",
    },
    { kind: "text", key: "formName", label: "Form name (sent with each submission)", placeholder: "contact" },
    {
      kind: "array",
      key: "fields",
      label: "Fields",
      itemLabelKey: "name",
      min: 1,
      max: 12,
      itemFields: [
        { kind: "text", key: "label", label: "Label", localized: true },
        {
          kind: "text",
          key: "name",
          label: "Field key (lowercase, e.g. email / firstname / message — for HubSpot use the property's internal name)",
        },
        {
          kind: "select",
          key: "type",
          label: "Type",
          options: [
            { value: "text", label: "Short text" },
            { value: "email", label: "Email" },
            { value: "textarea", label: "Long text" },
          ],
        },
        { kind: "toggle", key: "required", label: "Required" },
      ],
      defaultItem: { label: { en: "New field", ar: "حقل جديد" }, name: "field", type: "text", required: false },
    },
    { kind: "text", key: "submitLabel", label: "Button label", localized: true },
    { kind: "text", key: "successMessage", label: "Thank-you message", localized: true },
    { kind: "align", key: "align", label: "Button alignment" },
  ],
  defaultProps: {
    formName: "contact",
    fields: [
      { id: "1", label: { en: "Name", ar: "الاسم" }, name: "firstname", type: "text", required: true },
      { id: "2", label: { en: "Email", ar: "البريد الإلكتروني" }, name: "email", type: "email", required: true },
      { id: "3", label: { en: "Message", ar: "الرسالة" }, name: "message", type: "textarea", required: false },
    ],
    submitLabel: { en: "Send", ar: "إرسال" },
    successMessage: { en: "Thanks — your message is on its way.", ar: "شكرًا — رسالتك في الطريق." },
    align: "center",
  } satisfies FormProps as unknown as Record<string, unknown>,
  // Height follows the fields (and the error / thank-you states).
  defaultSize: { w: 44, h: 40, autoHeight: true },
  render: (p, { language, editor }) => (
    <FormBlock props={p as unknown as FormProps} language={language} editor={editor} />
  ),
};

// ─── Builder staples (Shopify-style) ────────────────────────────

const galleryBlock: BlockDef = {
  type: "gallery",
  label: "Gallery",
  labelAr: "معرض صور",
  category: "media",
  icon: LayoutGrid,
  fields: [
    {
      kind: "array",
      key: "images",
      label: "Images",
      itemLabelKey: "caption",
      min: 1,
      max: 36,
      itemFields: [
        { kind: "image", key: "image", label: "Image" },
        { kind: "text", key: "alt", label: "Alt text", localized: true },
        { kind: "text", key: "caption", label: "Caption (optional)", localized: true },
      ],
      defaultItem: { image: PLACEHOLDER_SVG, alt: { en: "", ar: "" }, caption: { en: "", ar: "" } },
    },
    { kind: "range", key: "columns", label: "Columns", min: 1, max: 6, step: 1 },
    { kind: "range", key: "mobileColumns", label: "Columns on phones", min: 1, max: 3, step: 1 },
    { kind: "range", key: "gapPx", label: "Gap", min: 0, max: 40, step: 2, unit: "px" },
    {
      kind: "select",
      key: "aspect",
      label: "Tile shape",
      options: [
        { value: "1 / 1", label: "Square" },
        { value: "4 / 3", label: "Landscape 4:3" },
        { value: "3 / 2", label: "Landscape 3:2" },
        { value: "16 / 9", label: "Wide 16:9" },
        { value: "3 / 4", label: "Portrait 3:4" },
      ],
    },
    {
      kind: "select",
      key: "fit",
      label: "Image fit",
      options: [
        { value: "cover", label: "Fill the tile (crop)" },
        { value: "contain", label: "Show whole image (logos)" },
      ],
    },
    { kind: "toggle", key: "rounded", label: "Rounded corners" },
    { kind: "toggle", key: "muted", label: "Greyscale until hover (logo wall)" },
    { kind: "toggle", key: "lightbox", label: "Click to enlarge" },
  ],
  defaultProps: {
    images: Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1),
      image: PLACEHOLDER_SVG,
      alt: { en: "", ar: "" },
      caption: { en: "", ar: "" },
    })),
    columns: 3,
    mobileColumns: 2,
    gapPx: 12,
    aspect: "1 / 1",
    fit: "cover",
    rounded: true,
    muted: false,
    lightbox: true,
  } satisfies GalleryProps as unknown as Record<string, unknown>,
  defaultSize: { w: 64, h: 50, autoHeight: true },
  render: (p, { language, editor }) => (
    <GalleryBlock props={p as unknown as GalleryProps} language={language} editor={editor} />
  ),
};

const quoteBlock: BlockDef = {
  type: "quote",
  label: "Quote / testimonial",
  labelAr: "اقتباس / شهادة",
  category: "text",
  icon: Quote,
  fields: [
    { kind: "textarea", key: "quote", label: "Quote", localized: true },
    { kind: "text", key: "author", label: "Who said it", localized: true },
    { kind: "text", key: "role", label: "Their role / where (optional)", localized: true },
    { kind: "image", key: "avatar", label: "Photo (optional)" },
    {
      kind: "select",
      key: "style",
      label: "Style",
      options: [
        { value: "classic", label: "Classic" },
        { value: "card", label: "Card" },
        { value: "large", label: "Large statement" },
      ],
    },
    { kind: "align", key: "align", label: "Alignment" },
  ],
  defaultProps: {
    quote: {
      en: "A line someone said about you, your work or your writing.",
      ar: "جملة قالها أحدهم عنك أو عن عملك أو كتابتك.",
    },
    author: { en: "Name", ar: "الاسم" },
    role: { en: "", ar: "" },
    avatar: "",
    style: "classic",
    align: "center",
  } satisfies QuoteProps as unknown as Record<string, unknown>,
  defaultSize: { w: 56, h: 22, autoHeight: true },
  render: (p, { language }) => <QuoteBlock props={p as unknown as QuoteProps} language={language} />,
};

const featureListBlock: BlockDef = {
  type: "feature-list",
  label: "Feature list",
  labelAr: "قائمة مزايا",
  category: "text",
  icon: ListChecks,
  fields: [
    {
      kind: "array",
      key: "items",
      label: "Items",
      itemLabelKey: "title",
      min: 1,
      max: 12,
      itemFields: [
        { kind: "select", key: "icon", label: "Icon", options: FEATURE_ICON_OPTIONS },
        { kind: "text", key: "title", label: "Title", localized: true },
        { kind: "textarea", key: "body", label: "Text", localized: true },
      ],
      defaultItem: { icon: "sparkles", title: { en: "New item", ar: "عنصر جديد" }, body: { en: "", ar: "" } },
    },
    { kind: "range", key: "columns", label: "Columns", min: 1, max: 4, step: 1 },
    {
      kind: "select",
      key: "iconStyle",
      label: "Icon style",
      options: [
        { value: "circle", label: "In a circle" },
        { value: "plain", label: "Plain" },
      ],
    },
    {
      kind: "select",
      key: "align",
      label: "Alignment",
      options: [
        { value: "center", label: "Centred" },
        { value: "left", label: "Start" },
      ],
    },
  ],
  defaultProps: {
    items: [
      { id: "1", icon: "pen", title: { en: "Writing", ar: "الكتابة" }, body: { en: "A short line about it.", ar: "سطر قصير عنه." } },
      { id: "2", icon: "palette", title: { en: "Drawing", ar: "الرسم" }, body: { en: "A short line about it.", ar: "سطر قصير عنه." } },
      { id: "3", icon: "sparkles", title: { en: "Making", ar: "الصنع" }, body: { en: "A short line about it.", ar: "سطر قصير عنه." } },
    ],
    columns: 3,
    iconStyle: "circle",
    align: "center",
  } satisfies FeatureListProps as unknown as Record<string, unknown>,
  defaultSize: { w: 72, h: 24, autoHeight: true },
  render: (p, { language, editor }) => (
    <FeatureListBlock props={p as unknown as FeatureListProps} language={language} editor={editor} />
  ),
};

const mapBlock: BlockDef = {
  type: "map",
  label: "Map",
  labelAr: "خريطة",
  category: "embed",
  icon: MapIcon,
  fields: [
    { kind: "text", key: "address", label: "Address or place name", placeholder: "e.g. Dammam Corniche" },
    { kind: "range", key: "zoom", label: "Zoom", min: 3, max: 20, step: 1 },
    { kind: "toggle", key: "rounded", label: "Rounded corners" },
    { kind: "toggle", key: "muted", label: "Greyscale (quieter on paper)" },
    { kind: "note", label: "Google Maps, no API key needed. Resize the box to set its height." },
  ],
  defaultProps: { address: "", zoom: 14, rounded: true, muted: false } satisfies MapProps as unknown as Record<
    string,
    unknown
  >,
  defaultSize: { w: 50, h: 40 },
  render: (p, { editor }) => <MapBlock props={p as unknown as MapProps} editor={editor} />,
};

const newsletterBlock: BlockDef = {
  type: "newsletter",
  label: "Newsletter signup",
  labelAr: "اشتراك بالنشرة",
  category: "conversion",
  icon: MailPlus,
  fields: [
    {
      kind: "note",
      label:
        "An email-only form on one line. Sign-ups go to the destination in Site settings → Forms (HubSpot or a webhook to your mailing tool).",
    },
    { kind: "text", key: "intro", label: "Line above (optional)", localized: true },
    { kind: "text", key: "placeholder", label: "Email box placeholder", localized: true },
    { kind: "text", key: "submitLabel", label: "Button label", localized: true },
    { kind: "text", key: "successMessage", label: "Thank-you message", localized: true },
    { kind: "text", key: "formName", label: "Form name (sent with each sign-up)", placeholder: "newsletter" },
    { kind: "align", key: "align", label: "Text alignment" },
  ],
  defaultProps: {
    intro: { en: "Get new posts by email.", ar: "تصلك التدوينات الجديدة بالبريد." },
    placeholder: { en: "Your email", ar: "بريدك الإلكتروني" },
    submitLabel: { en: "Subscribe", ar: "اشترك" },
    successMessage: { en: "You're on the list — thank you!", ar: "تمت إضافتك — شكرًا لك!" },
    formName: "newsletter",
    align: "center",
  },
  defaultSize: { w: 44, h: 12, autoHeight: true },
  render: (p, { language, editor }) => (
    <FormBlock
      language={language}
      editor={editor}
      props={{
        formName: (p.formName as string) || "newsletter",
        layout: "inline",
        intro: p.intro as FormProps["intro"],
        fields: [
          { id: "email", label: p.placeholder as FormProps["submitLabel"], name: "email", type: "email", required: true },
        ],
        submitLabel: p.submitLabel as FormProps["submitLabel"],
        successMessage: p.successMessage as FormProps["successMessage"],
        align: alignToCss(p.align),
      }}
    />
  ),
};

// ─── Registry ───────────────────────────────────────────────────

const DEFS: BlockDef[] = [
  headingBlock,
  textBlock,
  buttonBlock,
  formBlock,
  newsletterBlock,
  quoteBlock,
  featureListBlock,
  imageBlock,
  galleryBlock,
  carouselBlock,
  accordionBlock,
  tabsBlock,
  embedBlock,
  mapBlock,
  socialLinksBlock,
  dividerBlock,
  spacerBlock,
  ...POPUP_BLOCK_DEFS,
];

// Landing blocks that also work stacked inside a pop-up.
const POPUP_SAFE = new Set([
  "heading",
  "text",
  "button",
  "form",
  "quote",
  "feature-list",
  "image",
  "gallery",
  "embed",
  "social-links",
  "divider",
  "spacer",
]);
for (const d of DEFS) {
  if (!d.surfaces) d.surfaces = POPUP_SAFE.has(d.type) ? ["page", "popup"] : ["page"];
}

export const BLOCK_REGISTRY: Record<string, BlockDef> = Object.fromEntries(
  DEFS.map((d) => [d.type, d])
);

/** Every block def, optionally only those allowed on one surface. */
export function listBlockDefs(surface?: BlockSurface): BlockDef[] {
  return surface ? DEFS.filter((d) => (d.surfaces ?? ["page"]).includes(surface)) : DEFS;
}

export function getBlockDef(type: string): BlockDef | undefined {
  return BLOCK_REGISTRY[type];
}

/** Create a fresh, fully-formed block instance from its registry defaults. */
export function makeBlock(type: string): ContentBlock | null {
  const def = getBlockDef(type);
  if (!def) return null;
  const props = structuredClone(def.defaultProps) as Record<string, unknown>;
  // Mint fresh ids for any repeatable array items so duplicated blocks don't
  // share item keys.
  for (const f of def.fields) {
    if (f.kind === "array" && Array.isArray(props[f.key])) {
      props[f.key] = (props[f.key] as Record<string, unknown>[]).map((it) => ({
        ...it,
        id: newIid(),
      }));
    }
  }
  return { id: newIid(), type, props };
}

/**
 * Create a component wrapped as a canvas ASSET, ready to drop into any section
 * alongside drawings, text and boxes. Size/auto-height come from the block's
 * registry `defaultSize`; the box is centred horizontally so it lands somewhere
 * sane, and the author moves/resizes it with the normal handles afterwards.
 *
 * Role is always `decoration`: a component owns its own interactivity (carousel
 * arrows, accordion rows, its own buttons), so wrapping it in a link or button
 * asset would nest interactive elements and break both behaviour and a11y.
 */
export function makeComponentAsset(
  type: string,
  opts?: { y?: number; zIndex?: number }
): DrawnAsset | null {
  const block = makeBlock(type);
  if (!block) return null;
  const size = getBlockDef(type)?.defaultSize ?? FALLBACK_BLOCK_SIZE;
  return {
    iid: newIid(),
    source: { kind: "component", block, autoHeight: size.autoHeight },
    x: Math.max(0, (100 - size.w) / 2),
    y: opts?.y ?? 38,
    w: size.w,
    h: size.h,
    zIndex: opts?.zIndex ?? 1,
    role: { kind: "decoration" },
  };
}
