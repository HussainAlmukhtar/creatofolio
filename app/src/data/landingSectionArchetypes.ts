// Ready-made section archetypes offered by the "+" section picker, so authors
// aren't starting every section from an empty canvas. Each factory returns a
// fully-formed DrawnSection with sensibly arranged placeholder assets — swap
// the placeholder art/text/links for real content, or delete what you don't
// need. Mints fresh iids on every call (so adding the same archetype twice
// never collides).
//
// Deliberately built on the EXISTING primitives (percentage assets, text
// sources, horizontalScroll) rather than new schema/rendering — a "grid" is
// just several image+text assets at computed percentages, a "carousel" is
// horizontalScroll turned on with assets spread left-to-right. No migration
// needed for any of this.

import type { DrawnAsset, DrawnAssetRole, DrawnSection, DrawnTextStyle } from "@/data/landingTypes";
import { newIid } from "@/lib/iid";
import { PLACEHOLDER_SVG } from "@/data/landingPlaceholders";
import { makeComponentAsset } from "@/components/landing/blocks/registry";
import { titlesToAssets } from "./sectionTitles";

const INK = "#2B2420";
const INK_SOFT = "#57493E";
const ACCENT = "#C05B3F";

function img(x: number, y: number, w: number, h: number, z: number): DrawnAsset {
  return {
    iid: newIid(),
    source: { kind: "upload", url: PLACEHOLDER_SVG },
    x,
    y,
    w,
    h,
    zIndex: z,
    role: { kind: "decoration" },
  };
}

/** A registry component as a positioned asset, with prop overrides. */
function comp(
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  props: Record<string, unknown> = {}
): DrawnAsset {
  const a = makeComponentAsset(type, { y, zIndex: z });
  if (!a || a.source.kind !== "component") throw new Error(`Unknown block type: ${type}`);
  return {
    ...a,
    x,
    y,
    w,
    h,
    source: { ...a.source, block: { ...a.source.block, props: { ...a.source.block.props, ...props } } },
  };
}

function text(
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  en: string,
  ar: string,
  style: Partial<DrawnTextStyle> = {},
  role: DrawnAssetRole = { kind: "decoration" }
): DrawnAsset {
  return {
    iid: newIid(),
    source: {
      kind: "text",
      text: { en, ar },
      style: {
        fontFamily: "body",
        fontSize: 2.2,
        fontWeight: 500,
        color: INK,
        align: "center",
        lineHeight: 1.25,
        ...style,
      },
    },
    x,
    y,
    w,
    h,
    zIndex: z,
    role,
  };
}

function baseSection(id: string, over: Partial<DrawnSection> = {}): DrawnSection {
  const section: DrawnSection = {
    iid: newIid(),
    id: `${id}-${Date.now().toString(36)}`,
    blockType: "stack",
    aspectRatio: { w: 1520, h: 960 },
    // Paper with a torn top edge: dropped anywhere on a page, the new sheet
    // rips over whatever is above it instead of meeting it in a hard line.
    surface: { kind: "paper", grain: true, tornEdge: { top: "rough" } },
    assets: [],
    revealStyle: "fade-up",
    // Multi-element layouts reflow into a readable column on phones rather
    // than shrinking every column to a sliver (turn off per section to
    // hand-place the mobile layout instead).
    autoStackMobile: true,
    ...over,
  };
  // Archetypes author a heading/subheading; they become title elements
  // (data/sectionTitles.ts) like every saved section's.
  return titlesToAssets(section) as DrawnSection;
}

export interface SectionArchetype {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  build: () => DrawnSection;
}

export const SECTION_ARCHETYPES: SectionArchetype[] = [
  {
    id: "hero",
    name: "Hero",
    nameAr: "قسم رئيسي",
    description: "Big headline, supporting line, one call-to-action.",
    build: () =>
      baseSection("hero", {
        blockType: "hero",
        heading: { en: "Your headline here", ar: "عنوانك هنا" },
        subheading: { en: "A short line that supports the headline.", ar: "" },
        assets: [
          text(
            40,
            72,
            20,
            8,
            1,
            "Get started →",
            "ابدأ →",
            { fontFamily: "display", fontSize: 2.6, fontWeight: 700, color: ACCENT },
            { kind: "link", href: "#" }
          ),
        ],
      }),
  },
  {
    id: "feature-grid",
    name: "Feature grid",
    nameAr: "شبكة ميزات",
    description: "Three columns, each with an image, a title, and a line of body text.",
    build: () => {
      const cols = [8, 40, 72];
      const assets: DrawnAsset[] = [];
      let z = 1;
      cols.forEach((cx, i) => {
        assets.push(img(cx, 44, 24, 20, z++));
        assets.push(
          text(cx, 67, 24, 8, z++, `Feature ${i + 1}`, `ميزة ${i + 1}`, {
            fontFamily: "display",
            fontWeight: 700,
            fontSize: 2.4,
          })
        );
        assets.push(
          text(cx, 76, 24, 14, z++, "A short line about this feature.", "", {
            fontSize: 1.7,
            color: INK_SOFT,
          })
        );
      });
      return baseSection("features", {
        heading: { en: "What you get", ar: "ما الذي ستحصل عليه" },
        subheading: { en: "Three reasons to keep reading.", ar: "" },
        assets,
      });
    },
  },
  {
    id: "cta-banner",
    name: "CTA banner",
    nameAr: "بانر دعوة للعمل",
    description: "A short, high-contrast band with one button — good between sections.",
    build: () =>
      baseSection("cta", {
        blockType: "full-bleed",
        surface: { kind: "digital" },
        minHeightVh: 45,
        heading: { en: "Ready to dive in?", ar: "جاهز للبدء؟" },
        subheading: { en: "Let's build something together.", ar: "" },
        aspectRatio: { w: 1520, h: 360 },
        assets: [
          comp("button", 35, 10, 30, 30, 1, {
            label: { en: "Get in touch", ar: "تواصل معي" },
            size: "lg",
            arrow: true,
          }),
        ],
      }),
  },
  {
    id: "testimonial",
    name: "Testimonial",
    nameAr: "شهادة",
    description: "One large pull-quote with a photo and attribution.",
    build: () =>
      baseSection("testimonial", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: undefined,
        aspectRatio: { w: 1520, h: 600 },
        assets: [
          comp("quote", 15, 10, 70, 60, 1, {
            style: "large",
            quote: {
              en: "This is where the quote goes — swap in the real words.",
              ar: "هنا يوضع الاقتباس — ضع الكلمات الحقيقية.",
            },
            role: { en: "Title, Place", ar: "" },
          }),
        ],
      }),
  },
  {
    id: "testimonials",
    name: "Testimonials (3)",
    nameAr: "ثلاث شهادات",
    description: "Three quote cards side by side; they stack on phones.",
    build: () =>
      baseSection("testimonials", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: { en: "Kind words", ar: "كلمات لطيفة" },
        aspectRatio: { w: 1520, h: 560 },
        assets: [0, 1, 2].map((i) =>
          comp("quote", 4 + i * 32, 8, 28, 60, i + 1, {
            style: "card",
            quote: { en: "A short, specific line someone said.", ar: "جملة قصيرة ومحددة قالها أحدهم." },
            author: { en: `Name ${i + 1}`, ar: `الاسم ${i + 1}` },
          })
        ),
      }),
  },
  {
    id: "gallery",
    name: "Gallery / carousel",
    nameAr: "معرض / كاروسيل",
    description: "A horizontally-scrolling strip of images — drop in photos or drawings.",
    build: () => {
      const assets: DrawnAsset[] = [];
      let z = 1;
      for (let i = 0; i < 5; i++) {
        assets.push(img(4 + i * 20, 20, 17, 60, z++));
      }
      return baseSection("gallery", {
        aspectRatio: { w: 3600, h: 960 },
        horizontalScroll: true,
        heading: { en: "Gallery", ar: "معرض" },
        subheading: { en: "A few pieces, side by side.", ar: "" },
        assets,
      });
    },
  },
  {
    id: "faq",
    name: "FAQ",
    nameAr: "الأسئلة الشائعة",
    description: "Questions that open to reveal their answers (a real accordion).",
    build: () =>
      baseSection("faq", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: { en: "Questions", ar: "الأسئلة" },
        aspectRatio: { w: 1520, h: 640 },
        assets: [
          comp("accordion", 15, 6, 70, 60, 1, {
            items: [1, 2, 3, 4].map((n) => ({
              id: newIid(),
              title: { en: `Question ${n}?`, ar: `السؤال ${n}؟` },
              body: { en: "The answer goes here.", ar: "الإجابة هنا." },
            })),
          }),
        ],
      }),
  },
  {
    id: "image-with-text",
    name: "Image with text",
    nameAr: "صورة مع نص",
    description: "A picture on one side; heading, a paragraph and a button on the other.",
    build: () =>
      baseSection("image-text", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: undefined,
        aspectRatio: { w: 1520, h: 800 },
        assets: [
          comp("image", 5, 8, 44, 84, 1),
          comp("heading", 54, 22, 40, 12, 2, { text: { en: "Tell a small story", ar: "احكِ قصة صغيرة" }, align: "left" }),
          comp("text", 54, 40, 40, 20, 3, {
            text: {
              en: "A few sentences about the picture — what it is, why it matters, where it leads.",
              ar: "بضع جمل عن الصورة — ما هي، ولماذا تهم، وإلى أين تقود.",
            },
            align: "left",
          }),
          comp("button", 54, 66, 24, 8, 4, { align: "left", variant: "outline", arrow: true }),
        ],
      }),
  },
  {
    id: "icon-features",
    name: "Features with icons",
    nameAr: "مزايا بأيقونات",
    description: "Icon, title and a line of text in columns; one column on phones.",
    build: () =>
      baseSection("icon-features", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: { en: "What I do", ar: "ماذا أفعل" },
        aspectRatio: { w: 1520, h: 480 },
        assets: [comp("feature-list", 8, 8, 84, 70, 1)],
      }),
  },
  {
    id: "photo-gallery",
    name: "Photo gallery",
    nameAr: "معرض صور",
    description: "A tidy grid of images that enlarge on click (fewer columns on phones).",
    build: () =>
      baseSection("photo-gallery", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: { en: "Gallery", ar: "معرض" },
        aspectRatio: { w: 1520, h: 1000 },
        assets: [comp("gallery", 10, 6, 80, 88, 1)],
      }),
  },
  {
    id: "newsletter",
    name: "Newsletter",
    nameAr: "النشرة البريدية",
    description: "A heading and a one-line email sign-up.",
    build: () =>
      baseSection("newsletter", {
        heading: { en: "Stay in touch", ar: "لنبقَ على تواصل" },
        minHeightVh: 20,
        aspectRatio: { w: 1520, h: 300 },
        assets: [comp("newsletter", 28, 10, 44, 40, 1)],
      }),
  },
  {
    id: "contact",
    name: "Contact",
    nameAr: "تواصل",
    description: "A contact form beside a map.",
    build: () =>
      baseSection("contact", {
        // Height follows the content (the canvas), not a full screen.
        minHeightVh: 20,
        heading: { en: "Get in touch", ar: "تواصل معي" },
        aspectRatio: { w: 1520, h: 760 },
        assets: [comp("form", 6, 6, 42, 80, 1), comp("map", 52, 6, 42, 80, 2)],
      }),
  },
  {
    id: "footer",
    name: "Footer",
    nameAr: "تذييل",
    description: "Brand line, a few links, and a copyright line.",
    build: () =>
      baseSection("footer", {
        // The last sheet on the pile: deeper tone, soft deckled top.
        surface: { kind: "paper", color: "var(--paper-3)", grain: true, tornEdge: { top: "deckle" } },
        minHeightVh: 35,
        assets: [
          text(6, 15, 40, 15, 1, "Creatofolio", "كرياتوفوليو", {
            fontFamily: "display",
            fontWeight: 700,
            fontSize: 2.4,
            align: "left",
          }),
          text(55, 20, 12, 8, 2, "About", "عن", { fontSize: 1.6, align: "left" }, { kind: "link", href: "#" }),
          text(68, 20, 12, 8, 3, "Contact", "تواصل", { fontSize: 1.6, align: "left" }, { kind: "link", href: "#" }),
          text(81, 20, 14, 8, 4, "Privacy", "الخصوصية", { fontSize: 1.6, align: "left" }, { kind: "link", href: "#" }),
          text(6, 78, 88, 8, 5, "© 2026 Creatofolio", "© ٢٠٢٦ كرياتوفوليو", {
            fontSize: 1.2,
            color: INK_SOFT,
            align: "left",
          }),
        ],
      }),
  },
];
