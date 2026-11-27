"use client";

// StylePreview — the item being edited, worn by the REAL visitor sheet
// (PopupSheet + PopupView) with sample content: a short sheet, a magazine
// with pages (shows the arrows and page corner) or the real dialogue box
// characters talk in (a still preview at its last line, with answers). Desktop / phone and
// English / Arabic, plus "Show basic shapes": faint outlines naming every
// drawable part, so you can see what each one is in its most basic form.

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import type { ObjectContent } from "@/data/contentTypes";
import type { PopupLook } from "@/data/popupStyleTypes";
import { PopupSheet } from "@/components/popup/PopupSheet";
import { PopupView } from "@/components/popup/PopupView";
import { DialogueBox } from "@/components/game/DialogueBox";
import type { Dialogue } from "@/data/roomTypes";
import "@/components/popup-editor/composer.css";

type Sample = "sheet" | "pages" | "dialogue";

const doc = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const rt = (id: string, en: string, ar: string) => ({ id, type: "rich-text", props: { doc: { en: doc(en), ar: doc(ar) } } });

const SHEET: ObjectContent = {
  objectId: "zz-test-style-sample",
  roomId: "zz-test-lab",
  title: "A sample pop-up",
  titleAr: "نافذة تجريبية",
  type: "blocks",
  contentVersion: 2,
  layout: "sheet",
  blocks: [
    rt("s1", "This is how a pop-up looks in this style. Text, pictures and buttons sit on the panel.", "هكذا تبدو النافذة بهذا الأسلوب. النصوص والصور والأزرار تجلس على اللوحة."),
    { id: "s2", type: "button", props: { label: { en: "A button", ar: "زر" }, kind: "link", href: "#", variant: "solid", size: "md", align: "center" } },
  ],
};

const PAGES: ObjectContent = {
  ...SHEET,
  title: "A sample magazine",
  titleAr: "مجلة تجريبية",
  layout: "pages",
  blocks: [],
  pages: [
    { id: "p0", kind: "cover", blocks: [rt("c1", "The cover", "الغلاف")] },
    { id: "p1", kind: "page", blocks: [rt("c2", "Page one. Use the arrows or the page corner.", "الصفحة الأولى. استخدم الأسهم أو زاوية الصفحة.")] },
    { id: "p2", kind: "page", blocks: [rt("c3", "Page two.", "الصفحة الثانية.")] },
  ],
};

export function StylePreview({ look }: { look: PopupLook }) {
  const [sample, setSample] = useState<Sample>("sheet");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [shapes, setShapes] = useState(false);
  const content = sample === "pages" ? PAGES : SHEET;
  const title = lang === "ar" ? content.titleAr : content.title;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <Seg
          value={sample}
          onChange={setSample}
          options={[
            ["sheet", "Pop-up"],
            ["pages", "Magazine"],
            ["dialogue", "Dialogue"],
          ]}
        />
        <Seg
          value={device}
          onChange={setDevice}
          options={[
            ["desktop", <Monitor key="d" className="size-4" aria-label="Desktop" />],
            ["phone", <Smartphone key="p" className="size-4" aria-label="Phone" />],
          ]}
        />
        <Seg value={lang} onChange={setLang} options={[["en", "EN"], ["ar", "ع"]]} />
        <label className="ms-auto flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={shapes} onChange={(e) => setShapes(e.target.checked)} />
          Show basic shapes
        </label>
      </div>
      <div className="composer-preview relative min-h-0 flex-1" data-shapes={shapes ? "" : undefined}>
        <div className="absolute inset-0 grid place-items-center overflow-auto p-4">
          <div
            className={`composer-frame relative overflow-hidden ${device === "phone" ? "composer-frame--phone" : "composer-frame--desktop"}`}
            data-touch-exempt=""
          >
            <div className="popup-backdrop popup-backdrop--preview" data-device={device} dir={lang === "ar" ? "rtl" : "ltr"}>
              {sample === "dialogue" ? (
                <div className="dialogue-sample">
                  <DialogueBox dialogue={SAMPLE_DIALOGUE} language={lang} theme={look.theme} preview={{ line: 0 }} />
                </div>
              ) : (
                <PopupSheet
                  key={sample}
                  title={title}
                  language={lang}
                  theme="game"
                  size="m"
                  device={device}
                  look={look}
                  dialogProps={{ "aria-label": "Style preview" }}
                >
                  <PopupView content={content} language={lang} />
                </PopupSheet>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SAMPLE_DIALOGUE: Dialogue = {
  speaker: { en: "Guide", ar: "المرشد" },
  lines: [
    {
      id: "l1",
      text: { en: "Hello! This is the box characters talk in.", ar: "أهلاً! هذا الصندوق الذي تتحدث فيه الشخصيات." },
      choices: [
        { id: "c1", label: { en: "Yes, tell me more", ar: "نعم، أخبرني المزيد" }, actions: [] },
        { id: "c2", label: { en: "Not now", ar: "ليس الآن" }, actions: [] },
      ],
    },
  ],
};

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, React.ReactNode][];
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-neutral-700" role="group">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`grid h-8 min-w-8 place-items-center px-2 text-xs font-semibold ${
            value === v ? "bg-neutral-200 text-neutral-900" : "text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
