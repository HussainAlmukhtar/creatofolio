// Fixtures for the pop-up lab (/admin/popup-lab). In-memory only: nothing
// here is ever written to the database. Names start with "zz-test" so they
// can't be mistaken for real content.

import type { ObjectContent, TipTapDoc } from "@/data/contentTypes";
import type { RoomConfig, RoomObject } from "@/data/roomTypes";
import { staticWorld } from "@/data/staticRooms";
import { migrateRoom } from "@/data/migrations";
import { newIid } from "@/lib/iid";

const doc = (...content: TipTapDoc["content"]): TipTapDoc => ({ type: "doc", content });
const p = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});
const swatch = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${fill}"/><path d="M40 240c60-90 120-30 180-110s110-20 140-60" stroke="#2b2420" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`
  )}`;

const base = { roomId: "zz-test-lab", type: "blocks", contentVersion: 2, layout: "sheet" } as const;

/** Every core block, EN + AR. */
export const zzEveryBlock: ObjectContent = {
  ...base,
  objectId: "zz-test-every-block",
  title: "zz-test · every block",
  titleAr: "zz-test · كل الكتل",
  blocks: [
    {
      id: "rt",
      type: "rich-text",
      props: {
        doc: {
          en: doc(
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] },
            p("Plain paragraph with a "),
            {
              type: "paragraph",
              content: [
                { type: "text", text: "bold", marks: [{ type: "bold" }] },
                { type: "text", text: " word and a " },
                { type: "text", text: "safe link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
                { type: "text", text: "." },
              ],
            },
            { type: "bulletList", content: [{ type: "listItem", content: [p("First")] }, { type: "listItem", content: [p("Second")] }] },
            { type: "blockquote", content: [p("A quote, set in italics.")] }
          ),
          ar: doc(
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "عنوان" }] },
            p("فقرة عادية مع رابط آمن."),
            { type: "bulletList", content: [{ type: "listItem", content: [p("الأول")] }, { type: "listItem", content: [p("الثاني")] }] }
          ),
        },
      },
    },
    {
      id: "gl",
      type: "gallery",
      props: {
        images: [
          { id: "g1", image: swatch("#e9d8b4"), alt: { en: "Sand", ar: "رمل" }, caption: { en: "Sand", ar: "رمل" } },
          { id: "g2", image: swatch("#cfe0d8"), alt: { en: "Sea", ar: "بحر" }, caption: { en: "Sea", ar: "بحر" } },
          { id: "g3", image: swatch("#f1c9b8"), alt: { en: "Dusk", ar: "غسق" }, caption: { en: "Dusk", ar: "غسق" } },
        ],
        columns: 2,
        mobileColumns: 2,
        gapPx: 12,
        aspect: "4 / 3",
        fit: "cover",
        rounded: true,
        muted: false,
        lightbox: true,
      },
    },
    {
      id: "ln",
      type: "links",
      props: {
        links: [
          { id: "l1", url: "mailto:hello@example.com", icon: "email", label: { en: "Email me", ar: "راسلني" } },
          { id: "l2", url: "https://example.com", icon: "website", label: { en: "Website", ar: "الموقع" } },
          { id: "l3", url: "/#section", icon: "", label: { en: "Same-site link", ar: "رابط داخلي" } },
        ],
      },
    },
    {
      id: "cv",
      type: "cv-timeline",
      props: {
        sections: [
          {
            id: "s1",
            kind: "experience",
            title: { en: "Experience", ar: "الخبرة" },
            items: [
              {
                id: "i1",
                title: { en: "Role", ar: "الدور" },
                subtitle: { en: "Company", ar: "الشركة" },
                period: { en: "2024 – now", ar: "٢٠٢٤ – الآن" },
                highlights: { en: "Did a thing\nDid another", ar: "أنجزت شيئاً\nوشيئاً آخر" },
              },
            ],
          },
        ],
      },
    },
  ],
};

/** Every URL here must be refused (rendered inert / not at all). */
export const zzUnsafe: ObjectContent = {
  ...base,
  objectId: "zz-test-unsafe",
  title: "zz-test · unsafe URLs (all refused)",
  titleAr: "zz-test · روابط غير آمنة",
  blocks: [
    {
      id: "rt",
      type: "rich-text",
      props: {
        doc: {
          en: doc(
            {
              type: "paragraph",
              content: [
                { type: "text", text: "javascript: link (plain text)", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "//evil.example link (plain text)", marks: [{ type: "link", attrs: { href: "//evil.example" } }] }],
            },
            { type: "image", attrs: { src: "data:text/html,<script>alert(1)</script>", alt: "refused image" } },
            p("↑ a data:text/html image was here and must not render.")
          ),
        },
      },
    },
    {
      id: "ln",
      type: "links",
      props: {
        links: [
          { id: "l1", url: "javascript:alert(1)", icon: "website", label: { en: "javascript: (inert)", ar: "غير آمن" } },
          { id: "l2", url: "  JaVaScRiPt:alert(1)", icon: "", label: { en: "mixed-case javascript: (inert)", ar: "غير آمن" } },
          { id: "l3", url: "data:text/html,hi", icon: "", label: { en: "data: (inert)", ar: "غير آمن" } },
        ],
      },
    },
    { id: "fr", type: "platform-embed", props: { url: "https://evil.example/frame", platform: "custom-iframe" } },
    { id: "ig", type: "platform-embed", props: { url: "https://evil.example/p/abc", platform: "instagram" } },
  ],
};

/** Allowlisted players that must PLAY inside their sandbox. */
export const zzEmbeds: ObjectContent = {
  ...base,
  objectId: "zz-test-embeds",
  title: "zz-test · embeds",
  titleAr: "zz-test · تضمينات",
  size: "l",
  blocks: [
    { id: "yt", type: "platform-embed", props: { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", platform: "youtube" } },
    { id: "vm", type: "embed", props: { url: "https://vimeo.com/1084537", title: { en: "Vimeo", ar: "فيميو" }, aspect: "16:9", rounded: true } },
    { id: "ci", type: "platform-embed", props: { url: "https://youtu.be/aqz-KE-bpKQ", platform: "custom-iframe" } },
  ],
};

export const zzEmpty: ObjectContent = {
  ...base,
  objectId: "zz-test-empty",
  title: "zz-test · empty",
  titleAr: "zz-test · فارغ",
  blocks: [],
};

/** Media + portfolio blocks. */
export const zzPhase3Blocks: ObjectContent = {
  ...base,
  objectId: "zz-test-phase3-blocks",
  title: "zz-test · media & portfolio",
  titleAr: "zz-test · وسائط وأعمال",
  size: "l",
  blocks: [
    {
      id: "vd",
      type: "video",
      props: {
        source: "link",
        url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        file: "",
        poster: swatch("#3a2f27"),
        title: { en: "Big Buck Bunny", ar: "الأرنب الكبير" },
        caption: { en: "Loads only when you press play.", ar: "يُحمَّل فقط عند الضغط على التشغيل." },
        aspect: "16:9",
        loop: false,
      },
    },
    {
      id: "sc",
      type: "screen",
      props: {
        media: swatch("#cfe0d8"),
        mediaKind: "image",
        heading: { en: "Now showing", ar: "يُعرض الآن" },
        text: { en: "Words over a picture, like a TV.", ar: "كلمات فوق صورة، مثل التلفاز." },
        position: "bottom",
        align: "left",
        scrim: 50,
        aspect: "4:3",
      },
    },
    {
      id: "pc",
      type: "project-card",
      props: {
        cover: swatch("#f1c9b8"),
        title: { en: "The Blog", ar: "المدونة" },
        role: { en: "Writer & illustrator", ar: "كاتب ورسام" },
        year: "2026",
        tags: { en: "Drawing, Writing, Games", ar: "رسم، كتابة، ألعاب" },
        description: { en: "A hand-drawn world you walk through.", ar: "عالم مرسوم باليد تمشي فيه." },
        links: [{ id: "k1", label: { en: "See it", ar: "شاهده" }, url: "https://example.com" }],
      },
    },
    {
      id: "fd",
      type: "file-download",
      props: {
        file: "https://example.com/zz-test-cv.pdf",
        fileName: "zz-test-cv.pdf",
        bytes: 482133,
        label: { en: "Download my CV", ar: "حمّل سيرتي الذاتية" },
        description: { en: "One page, updated this year.", ar: "صفحة واحدة، محدثة هذا العام." },
      },
    },
    {
      id: "ct",
      type: "contact",
      props: {
        intro: { en: "Say hello — I read everything.", ar: "قل مرحبًا — أقرأ كل الرسائل." },
        email: "hello@example.com",
        phone: "+966 50 000 0000",
        links: [{ id: "c1", label: { en: "Instagram", ar: "إنستغرام" }, url: "https://instagram.com/example", icon: "instagram" }],
        showForm: true,
        formName: "zz-test-contact",
      },
    },
    { id: "au", type: "audio", props: { file: "", title: { en: "A sound", ar: "صوت" }, caption: { en: "", ar: "" } } },
  ],
};

const txt = (id: string, en: string, ar: string) => ({
  id,
  type: "rich-text",
  props: { doc: { en: doc(p(en)), ar: doc(p(ar)) } },
});

/** Columns, tabs and accordion holding other blocks. */
export const zzLayout: ObjectContent = {
  ...base,
  objectId: "zz-test-layout",
  title: "zz-test · layout",
  titleAr: "zz-test · تخطيط",
  size: "l",
  blocks: [
    {
      id: "co",
      type: "columns",
      props: {
        stackOnPhones: true,
        gap: "m",
        slots: [
          { id: "a", label: { en: "", ar: "" }, blocks: [txt("c1", "Left column text.", "نص العمود الأول.")] },
          {
            id: "b",
            label: { en: "", ar: "" },
            blocks: [{ id: "c2", type: "image", props: { url: swatch("#e9d8b4"), alt: { en: "Sand", ar: "رمل" } } }],
          },
        ],
      },
    },
    {
      id: "tb",
      type: "tab-set",
      props: {
        slots: [
          { id: "t1", label: { en: "About", ar: "عني" }, blocks: [txt("t1a", "First tab.", "التبويب الأول.")] },
          { id: "t2", label: { en: "Work", ar: "أعمالي" }, blocks: [txt("t2a", "Second tab.", "التبويب الثاني.")] },
        ],
      },
    },
    {
      id: "ac",
      type: "accordion-set",
      props: {
        firstOpen: true,
        slots: [
          { id: "r1", label: { en: "What is this?", ar: "ما هذا؟" }, blocks: [txt("r1a", "A row that opens.", "صف يُفتح.")] },
          { id: "r2", label: { en: "How long?", ar: "كم المدة؟" }, blocks: [txt("r2a", "Not long.", "ليس طويلاً.")] },
        ],
      },
    },
  ],
};

/** A magazine: cover, two pages, back cover. */
export const zzMagazine: ObjectContent = {
  ...base,
  objectId: "zz-test-magazine",
  title: "zz-test · magazine",
  titleAr: "zz-test · مجلة",
  layout: "pages",
  blocks: [],
  pages: [
    {
      id: "pg-c",
      kind: "cover",
      blocks: [
        { id: "m1", type: "heading", props: { text: { en: "The Sketchbook Times", ar: "صحيفة الدفتر" }, level: "h2", align: "center" } },
        txt("m2", "Issue one", "العدد الأول"),
      ],
    },
    { id: "pg-1", kind: "page", blocks: [txt("m3", "Page one: the news.", "الصفحة الأولى: الأخبار.")] },
    { id: "pg-2", kind: "page", blocks: [txt("m4", "Page two: the comics.", "الصفحة الثانية: القصص المصورة.")] },
    { id: "pg-b", kind: "back", blocks: [txt("m5", "See you next issue.", "نراكم في العدد القادم.")] },
  ],
};

/** An OLD-format (v1) reel row: captions as caption/captionAr strings.
 *  Proves the read-time conversion to a reel block with Localized captions. */
export const zzLegacyReel = {
  objectId: "zz-test-legacy-reel",
  roomId: "zz-test-lab",
  title: "zz-test · v1 reel",
  titleAr: "zz-test · عرض قديم",
  type: "reel",
  reelItems: [
    { kind: "upload", mediaType: "image", url: swatch("#e9d8b4"), caption: "Sand", captionAr: "رمل" },
    { kind: "embed", embedType: "youtube", url: "https://youtu.be/aqz-KE-bpKQ", thumbnailUrl: swatch("#cfe0d8"), caption: "Bunny", captionAr: "أرنب" },
  ],
} as unknown as ObjectContent;

export const LAB_FIXTURES: ObjectContent[] = [
  zzLegacyReel,
  zzEveryBlock,
  zzPhase3Blocks,
  zzLayout,
  zzMagazine,
  zzUnsafe,
  zzEmbeds,
  zzEmpty,
];

// ─── Game harness room ──────────────────────────────────────────

/**
 * The static seed's home room, renamed zz-test-lab. Its objects keep their
 * ids; the harness maps them to fixtures (HARNESS_CONTENT) instead of loading
 * anything from the database.
 */
export function harnessRoom(): RoomConfig {
  const home = structuredClone(staticWorld.rooms.home) as RoomConfig;
  // "Step through pop-ups" on: board, couch and plant form a sequence.
  return {
    ...home,
    id: "zz-test-lab",
    name: "zz-test lab",
    nameAr: "zz-test مختبر",
    popupNav: { enabled: true },
    // Name tag with the owner's own icon (an inline test drawing).
    nameTag: {
      icon: "art",
      art: {
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 6c11 0 20 9 20 20 0 15-20 32-20 32S12 41 12 26C12 15 21 6 32 6z' fill='%235b8c85' stroke='%232b2622' stroke-width='3'/%3E%3Ccircle cx='32' cy='26' r='7' fill='%23fbf8f1' stroke='%232b2622' stroke-width='3'/%3E%3C/svg%3E",
        w: 64,
        h: 64,
      },
    },
  };
}

export const HARNESS_CONTENT: Record<string, ObjectContent | null> = {
  "welcome-board": zzEveryBlock,
  couch: zzMagazine, // pages: ←/→ turn pages first, then step to the next pop-up
  plant: null, // → friendly empty state
};

// ─── Actions harness room ────────────────

const L = (en: string, ar: string) => ({ en, ar });

/**
 * zz-test-actions: the home seed (migrated, so iids exist) with one object
 * per kind of step, plus near zones. In memory only. `soundUrl` is a blob:
 * the lab generates (a short beep), so no file is uploaded.
 */
export function harnessActionsRoom(soundUrl: string): RoomConfig {
  const room = migrateRoom({
    ...structuredClone(staticWorld.rooms.home),
    id: "zz-test-actions",
    name: "zz-test actions",
    nameAr: "zz-test خطوات",
    nameTag: { icon: "pin" },
  }) as RoomConfig;
  const iid = (id: string) => room.objects.find((o) => o.id === id)?.iid ?? "";
  const extra: RoomObject[] = [
    {
      id: "zz-lamp",
      iid: newIid(),
      x: 1150, y: 470, width: 70, height: 130,
      type: "object", label: "zz lamp", labelAr: "zz مصباح",
      interactionRadius: 90, isWallMounted: false,
      hiddenAtStart: true,
      interactions: { click: { actions: [{ kind: "effect", reaction: "confetti", message: L("You found the lamp!", "وجدت المصباح!") }] } },
    },
    {
      id: "zz-mat",
      iid: newIid(),
      x: 700, y: 640, width: 120, height: 40,
      type: "object", label: "zz welcome mat", labelAr: "zz سجادة",
      interactionRadius: 110, isWallMounted: false,
      moveTo: { x: 760, y: 660 },
      interactions: {
        click: { actions: [] },
        near: { enabled: true, actions: [{ kind: "effect", reaction: "sparkle", message: L("Mat: welcome back!", "السجادة: أهلاً بعودتك!") }] },
      },
    },
    {
      id: "zz-sign",
      iid: newIid(),
      x: 1000, y: 560, width: 70, height: 100,
      type: "object", label: "zz sign", labelAr: "zz لافتة",
      interactionRadius: 120, isWallMounted: false,
      moveTo: { x: 1035, y: 680 },
      interactions: {
        click: { actions: [{ kind: "open-popup", objectIid: iid("welcome-board") }] },
        near: {
          enabled: true,
          once: "session",
          actions: [
            { kind: "effect", reaction: "jump", message: L("Read me!", "اقرأني!") },
            { kind: "wait", ms: 700 },
            { kind: "open-popup", objectIid: iid("welcome-board") },
          ],
        },
      },
    },
    {
      id: "zz-music-box",
      iid: newIid(),
      x: 560, y: 600, width: 90, height: 80,
      type: "object", label: "zz music box", labelAr: "zz صندوق موسيقى",
      interactionRadius: 90, isWallMounted: false,
      interactions: { click: { actions: [{ kind: "sound", url: soundUrl, volume: 0.6 }, { kind: "effect", reaction: "wiggle" }] } },
    },
    {
      id: "zz-unsafe",
      iid: newIid(),
      x: 470, y: 470, width: 70, height: 90,
      type: "object", label: "zz unsafe box", labelAr: "zz صندوق غير آمن",
      interactionRadius: 90, isWallMounted: false,
      interactions: {
        click: {
          actions: [
            { kind: "link", url: "javascript:alert('zz')", confirm: false },
            { kind: "download", url: "data:text/html,<script>alert(1)</script>" },
            { kind: "sound", url: "javascript:alert(2)" },
            { kind: "effect", reaction: "shake", message: L("Unsafe steps were refused", "رُفضت الخطوات غير الآمنة") },
          ],
        },
      },
    },
    {
      id: "zz-guide",
      iid: newIid(),
      x: 1080, y: 380, width: 80, height: 110,
      type: "npc", label: "zz Guide", labelAr: "zz المرشد",
      interactionRadius: 100, isWallMounted: false,
      moveTo: { x: 1120, y: 520 },
      interactions: {
        click: {
          actions: [
            {
              kind: "dialogue",
              dialogue: {
                speaker: L("Guide (zz-test)", "المرشد (zz-test)"),
                lines: [
                  { id: "g1", text: L("Hey there! I’m the zz-test guide.", "أهلاً! أنا المرشد التجريبي.") },
                  {
                    id: "g2",
                    text: L(
                      "Every room has secrets. This line is long on purpose, so you can see the words type themselves out and the box keep its size.",
                      "لكل غرفة أسرارها. هذا السطر طويل عن قصد، لترى الكلمات تكتب نفسها ويحافظ الصندوق على حجمه."
                    ),
                  },
                  {
                    id: "g3",
                    text: L("Want to see something?", "تريد أن ترى شيئاً؟"),
                    choices: [
                      { id: "a1", label: L("Show me the board", "أرني اللوحة"), actions: [{ kind: "open-popup", objectIid: iid("welcome-board") }] },
                      { id: "a2", label: L("Confetti, please", "قصاصات ملوّنة من فضلك"), actions: [{ kind: "effect", reaction: "confetti", message: L("Ta-da!", "تادا!") }] },
                      { id: "a3", label: L("Not now", "ليس الآن"), actions: [] },
                    ],
                  },
                ],
              },
            },
            { kind: "effect", reaction: "jump" },
          ],
        },
      },
    },
    {
      id: "zz-shop-chest",
      iid: newIid(),
      x: 860, y: 600, width: 80, height: 70,
      type: "object", label: "zz shop chest", labelAr: "zz صندوق المتجر",
      interactionRadius: 90, isWallMounted: false,
      interactions: { click: { actions: [{ kind: "shop" }] } },
    },
  ];
  const steps: Record<string, RoomObject["interactions"]> = {
    "welcome-board": {
      click: {
        actions: [
          { kind: "effect", reaction: "sparkle", message: L("Hello!", "أهلاً!") },
          { kind: "wait", ms: 800 },
          { kind: "popup" },
        ],
      },
    },
    couch: { click: { once: "session", actions: [{ kind: "link", url: "https://example.com/zz-test", confirm: true }] } },
    plant: { click: { actions: [{ kind: "toggle-object", objectIid: extra[0].iid!, mode: "toggle" }] } },
    "door-archive": {
      click: { actions: [{ kind: "email", address: "zz-test@example.com", subject: L("zz-test hello", "zz-test مرحبا") }] },
    },
    "door-professional": { click: { actions: [{ kind: "effect", reaction: "spin" }, { kind: "wait", ms: 700 }, { kind: "door" }] } },
    "door-gallery": {
      click: {
        actions: [
          { kind: "go-to-room", roomIid: room.iid!, entryPointIid: room.entryPoints.find((e) => e.id === "from-archive")?.iid },
        ],
      },
    },
  };
  return {
    ...room,
    objects: [
      ...room.objects.map((o) => (steps[o.id] ? { ...o, interactions: steps[o.id] } : o)),
      ...extra,
    ],
  };
}

/** A short beep as a WAV blob: URL (no upload). Revoke when done. */
export function makeBeepUrl(): string {
  const rate = 22050;
  const n = Math.round(rate * 0.25);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 1600);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 660 * i) / rate) * 9000 * env, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
