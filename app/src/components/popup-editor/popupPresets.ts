// Built-in pop-up presets: ready-made starting points
// for a new pop-up, in English and Arabic. Built from the block registry's
// own defaults (`makeBlock`) with friendlier placeholder words, so a preset
// is exactly what adding those blocks by hand would give. Saved presets
// ("Save as preset", migration 20261008000002_popup_presets) live in lib/popupPresets.ts.

import { makeBlock } from "@/components/landing/blocks/registry";
import type { ContentBlock } from "@/data/landingTypes";
import type { PopupPage } from "@/data/contentTypes";
import type { PresetBody } from "@/lib/popupPresets";
import { newIid } from "@/lib/iid";

export interface BuiltInPreset {
  id: string;
  name: string;
  nameAr: string;
  hint: string;
  build: () => PresetBody;
}

const L = (en: string, ar: string) => ({ en, ar });
const doc = (...paras: string[]) => ({
  type: "doc" as const,
  content: paras.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});
const text = (en: string[], ar: string[]) => block("rich-text", { doc: { en: doc(...en), ar: doc(...ar) } });

/** A registry block with its defaults, plus overrides. */
function block(type: string, props: Record<string, unknown> = {}): ContentBlock {
  const b = makeBlock(type);
  if (!b) throw new Error(`Unknown block type ${type}`);
  return { ...b, props: { ...b.props, ...props } };
}

const page = (kind: PopupPage["kind"], blocks: ContentBlock[]): PopupPage => ({ id: newIid(), kind, blocks });

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    id: "project",
    name: "Project",
    nameAr: "مشروع",
    hint: "A project card, its story and pictures.",
    build: () => ({
      layout: "sheet",
      size: "m",
      title: "Project",
      titleAr: "مشروع",
      blocks: [
        block("project-card"),
        text(["The story: what it was, what I did, what I learned."], ["القصة: ما هو، وما الذي فعلته، وما الذي تعلّمته."]),
        block("gallery", { columns: 3, mobileColumns: 2 }),
      ],
    }),
  },
  {
    id: "about",
    name: "About me",
    nameAr: "عنّي",
    hint: "A picture, a few words and where to find me.",
    build: () => ({
      layout: "sheet",
      size: "m",
      title: "About me",
      titleAr: "عنّي",
      blocks: [
        block("image", { caption: L("That's me.", "هذا أنا.") }),
        text(["Hi, I'm … Write a few lines about yourself here."], ["مرحباً، أنا … اكتب هنا بضعة أسطر عن نفسك."]),
        block("links"),
      ],
    }),
  },
  {
    id: "cv",
    name: "CV",
    nameAr: "السيرة الذاتية",
    hint: "Experience, education and skills, plus a download.",
    build: () => ({
      layout: "sheet",
      size: "l",
      title: "CV",
      titleAr: "السيرة الذاتية",
      blocks: [
        block("cv-timeline", {
          sections: [
            { id: "1", kind: "experience", title: L("Experience", "الخبرة"), items: [] },
            { id: "2", kind: "education", title: L("Education", "التعليم"), items: [] },
            { id: "3", kind: "skills", title: L("Skills", "المهارات"), items: [] },
          ],
        }),
        block("file-download"),
      ],
    }),
  },
  {
    id: "gallery",
    name: "Gallery",
    nameAr: "معرض صور",
    hint: "A wide grid of pictures with a line of intro.",
    build: () => ({
      layout: "sheet",
      size: "l",
      title: "Gallery",
      titleAr: "معرض صور",
      blocks: [text(["A few words about these pictures."], ["بضع كلمات عن هذه الصور."]), block("gallery")],
    }),
  },
  {
    id: "video",
    name: "Video showcase",
    nameAr: "عرض فيديو",
    hint: "A video, what it is, and links.",
    build: () => ({
      layout: "sheet",
      size: "l",
      title: "Video",
      titleAr: "فيديو",
      blocks: [
        block("video"),
        text(["What this video is about."], ["عن ماذا يتحدث هذا الفيديو."]),
        block("links", { links: [] }),
      ],
    }),
  },
  {
    id: "contact",
    name: "Contact",
    nameAr: "تواصل",
    hint: "Email, phone, links and (when set up) a form.",
    build: () => ({
      layout: "sheet",
      size: "m",
      title: "Say hello",
      titleAr: "قل مرحباً",
      blocks: [block("contact")],
    }),
  },
  {
    id: "magazine",
    name: "Magazine",
    nameAr: "مجلة",
    hint: "Cover, pages and a back cover to flip through.",
    build: () => ({
      layout: "pages",
      size: "m",
      title: "Magazine",
      titleAr: "مجلة",
      blocks: [],
      pages: [
        page("cover", [block("heading", { text: L("The cover", "الغلاف") }), block("image")]),
        page("page", [text(["Page one."], ["الصفحة الأولى."])]),
        page("page", [text(["Page two."], ["الصفحة الثانية."])]),
        page("back", [text(["The end. Thanks for reading!"], ["النهاية. شكراً للقراءة!"])]),
      ],
    }),
  },
  {
    id: "tv",
    name: "TV screen",
    nameAr: "شاشة تلفاز",
    hint: "A picture or video with words on top. Pick a TV frame in Pop-up settings.",
    build: () => ({
      layout: "sheet",
      size: "m",
      title: "Now showing",
      titleAr: "يُعرض الآن",
      blocks: [block("screen"), text(["What's on."], ["ما الذي يُعرض."])],
    }),
  },
];
