// Static content data — seed/fallback content for room objects.
//
// Everything here is SAMPLE DATA for an imaginary creative ("Alex Example"):
// replace it in the editor with your own. This mirrors the staticRooms.ts
// pattern: it serves as the fallback when Supabase is unavailable and as seed
// data for the initial database population.

import type { ObjectContent } from "./contentTypes";
import { textToTipTap } from "./contentTypes";

// ─── Home Hub ────────────────────────────────────────────────

const welcomeBoard: ObjectContent = {
  objectId: "welcome-board",
  roomId: "home",
  title: "Welcome to my world",
  titleAr: "أهلاً بكم في عالمي",
  type: "richtext",
  body: textToTipTap([
    "Welcome! I'm Alex Example, an imaginary illustrator and designer.",
    "This is my interactive portfolio. Walk around, explore rooms, and click on objects to discover my work, experience, and creative projects.",
    "Use the map to navigate between rooms, or walk through the doors.",
    "Start by heading to the Professional room for my CV, or visit the Gallery for creative work!",
  ]),
  bodyAr: textToTipTap([
    "أهلاً! أنا أليكس مثال، رسّام ومصمّم من نسج الخيال.",
    "هذا معرض أعمالي التفاعلي. تجوّل واستكشف الغرف وانقر على الأشياء لاكتشاف عملي وخبرتي ومشاريعي الإبداعية.",
    "استخدم الخريطة للتنقل بين الغرف أو امشِ عبر الأبواب.",
    "ابدأ بالتوجه إلى الغرفة المهنية للاطلاع على سيرتي الذاتية، أو زُر المعرض لمشاهدة الأعمال الإبداعية!",
  ]),
};

const couch: ObjectContent = {
  objectId: "couch",
  roomId: "home",
  title: "The Cozy Couch",
  titleAr: "الأريكة المريحة",
  type: "richtext",
  body: textToTipTap([
    "Take a seat! This is a good spot to rest between adventures.",
    "Feel free to explore at your own pace.",
  ]),
  bodyAr: textToTipTap([
    "تفضّل بالجلوس! هذا مكان مناسب للاستراحة بين المغامرات.",
    "استكشف المكان على راحتك.",
  ]),
};

const plant: ObjectContent = {
  objectId: "plant",
  roomId: "home",
  title: "The plant",
  titleAr: "النبتة",
  type: "richtext",
  body: textToTipTap(["A trusty house plant. It likes sunlight and a kind word now and then."]),
  bodyAr: textToTipTap(["نبتة منزلية وفيّة. تحب ضوء الشمس وكلمة لطيفة بين حين وآخر."]),
};

// ─── Professional Room ──────────────────────────────────────

const resumeDesk: ObjectContent = {
  objectId: "cv-board",
  roomId: "professional",
  title: "Resume & CV",
  titleAr: "السيرة الذاتية",
  type: "cv",
  cvSections: [
    {
      id: "experience",
      title: "Experience",
      titleAr: "الخبرة",
      type: "experience",
      items: [
        {
          id: "sample-studio",
          title: "Senior Illustrator & Designer",
          titleAr: "رسّام ومصمّم أول",
          subtitle: "Sample Studio (example)",
          subtitleAr: "استوديو النموذج (مثال)",
          period: "January 2023 – Present",
          periodAr: "يناير 2023 – الحاضر",
          highlights: [
            "Led the visual direction for sample client projects from first sketch to launch",
            "Built a reusable illustration library used across web and print",
            "Mentored two junior designers",
          ],
          highlightsAr: [
            "قيادة التوجه البصري لمشاريع عملاء نموذجية من أول رسم تخطيطي حتى الإطلاق",
            "بناء مكتبة رسوم قابلة لإعادة الاستخدام على الويب وفي المطبوعات",
            "توجيه مصمّمَين مبتدئَين",
          ],
        },
        {
          id: "placeholder-press",
          title: "Junior Designer",
          titleAr: "مصمّم مبتدئ",
          subtitle: "Placeholder Press (example)",
          subtitleAr: "دار العنوان المؤقت (مثال)",
          period: "September 2020 – December 2022",
          periodAr: "سبتمبر 2020 – ديسمبر 2022",
          highlights: [
            "Designed book covers and editorial layouts",
            "Prepared print-ready files and worked with printers",
            "Kept the brand guidelines up to date",
          ],
          highlightsAr: [
            "تصميم أغلفة الكتب والصفحات التحريرية",
            "تجهيز الملفات للطباعة والتنسيق مع المطابع",
            "تحديث إرشادات الهوية البصرية",
          ],
        },
        {
          id: "freelance",
          title: "Freelance Illustrator",
          titleAr: "رسّام مستقل",
          subtitle: "Self-employed",
          subtitleAr: "عمل حر",
          period: "2018 – 2020",
          periodAr: "2018 – 2020",
          highlights: [
            "Created illustrations for posters, packaging and small brands",
            "Managed projects end to end, from brief to delivery",
          ],
          highlightsAr: [
            "رسم أعمال للملصقات والعبوات والعلامات التجارية الصغيرة",
            "إدارة المشاريع من البداية إلى النهاية، من الموجز حتى التسليم",
          ],
        },
      ],
    },
    {
      id: "education",
      title: "Education",
      titleAr: "التعليم",
      type: "education",
      items: [
        {
          id: "example-university",
          title: "B.A. in Visual Communication",
          titleAr: "بكالوريوس في التواصل البصري",
          subtitle: "Example University",
          subtitleAr: "جامعة المثال",
          period: "September 2014 – June 2018",
          periodAr: "سبتمبر 2014 – يونيو 2018",
          highlights: [
            "Illustration and typography",
            "Graduation project: a hand-drawn picture book",
          ],
          highlightsAr: [
            "الرسم التوضيحي وفن الخط الطباعي",
            "مشروع التخرج: كتاب مصوّر مرسوم باليد",
          ],
        },
        {
          id: "sample-course",
          title: "Animation Basics (short course)",
          titleAr: "أساسيات التحريك (دورة قصيرة)",
          subtitle: "Sample Art School",
          subtitleAr: "مدرسة الفنون النموذجية",
          period: "2021",
          periodAr: "2021",
          highlights: ["Frame-by-frame animation and walk cycles"],
          highlightsAr: ["التحريك إطاراً بإطار ودورات المشي"],
        },
      ],
    },
    {
      id: "skills",
      title: "Skills",
      titleAr: "المهارات",
      type: "skills",
      items: [
        {
          id: "illustration",
          title: "Illustration",
          titleAr: "الرسم التوضيحي",
          highlights: [
            "Ink & Brush",
            "Digital Painting",
            "Character Design",
            "Storyboarding",
          ],
          highlightsAr: [
            "الحبر والفرشاة",
            "الرسم الرقمي",
            "تصميم الشخصيات",
            "القصص المصوّرة",
          ],
        },
        {
          id: "design",
          title: "Design",
          titleAr: "التصميم",
          highlights: [
            "Brand Identity",
            "Editorial Layout",
            "Typography",
            "Web Design",
          ],
          highlightsAr: [
            "الهوية البصرية",
            "التصميم التحريري",
            "فن الخط الطباعي",
            "تصميم المواقع",
          ],
        },
        {
          id: "tools",
          title: "Tools",
          titleAr: "الأدوات",
          highlights: [
            "Drawing tablet",
            "Vector & raster editors",
            "HTML & CSS",
          ],
          highlightsAr: [
            "لوح الرسم الرقمي",
            "برامج الرسم المتجهي والنقطي",
            "HTML و CSS",
          ],
        },
      ],
    },
    {
      id: "languages",
      title: "Languages",
      titleAr: "اللغات",
      type: "languages",
      items: [
        {
          id: "english",
          title: "English",
          titleAr: "الإنجليزية",
          highlights: ["Native"],
          highlightsAr: ["اللغة الأم"],
        },
        {
          id: "arabic",
          title: "Arabic",
          titleAr: "العربية",
          highlights: ["Fluent"],
          highlightsAr: ["بطلاقة"],
        },
        {
          id: "spanish",
          title: "Spanish",
          titleAr: "الإسبانية",
          highlights: ["Basic"],
          highlightsAr: ["مستوى أساسي"],
        },
      ],
    },
    {
      id: "awards",
      title: "Awards & Activities",
      titleAr: "الجوائز والأنشطة",
      type: "awards",
      items: [
        {
          id: "sample-award",
          title: "Best Picture Book — Example Illustration Awards",
          titleAr: "أفضل كتاب مصوّر — جوائز المثال للرسم",
          period: "2024",
          periodAr: "2024",
          highlights: [
            "A sample award entry: replace it with your own",
          ],
          highlightsAr: [
            "جائزة نموذجية: استبدلها بجوائزك",
          ],
        },
        {
          id: "sample-talk",
          title: "Speaker — Sample Design Meetup",
          titleAr: "متحدّث — ملتقى التصميم النموذجي",
          period: "2023",
          periodAr: "2023",
          highlights: [
            "Gave a talk about drawing websites by hand",
          ],
          highlightsAr: [
            "محاضرة عن رسم المواقع باليد",
          ],
        },
      ],
    },
  ],
};

const certificatesShelf: ObjectContent = {
  objectId: "desk-datascience",
  roomId: "professional",
  title: "Certificates & Education",
  titleAr: "الشهادات والتعليم",
  type: "richtext",
  body: textToTipTap([
    "B.A. in Visual Communication — Example University (2014-2018)",
    "Animation Basics — Sample Art School (2021)",
    "Sample certificate — replace these lines with your own",
  ]),
  bodyAr: textToTipTap([
    "بكالوريوس في التواصل البصري — جامعة المثال (2014-2018)",
    "أساسيات التحريك — مدرسة الفنون النموذجية (2021)",
    "شهادة نموذجية — استبدل هذه السطور بشهاداتك",
  ]),
};

const skillsBoard: ObjectContent = {
  objectId: "desk-operations",
  roomId: "professional",
  title: "Skills & Tools",
  titleAr: "المهارات والأدوات",
  type: "richtext",
  body: textToTipTap([
    "Illustration • Character Design • Storyboarding",
    "Brand Identity • Editorial Layout • Typography",
    "Drawing tablet • Vector & raster editors • HTML & CSS",
    "Clear communication • Reliable deadlines",
  ]),
  bodyAr: textToTipTap([
    "الرسم التوضيحي • تصميم الشخصيات • القصص المصوّرة",
    "الهوية البصرية • التصميم التحريري • فن الخط الطباعي",
    "لوح الرسم الرقمي • برامج الرسم المتجهي والنقطي • HTML و CSS",
    "تواصل واضح • التزام بالمواعيد",
  ]),
};

const contactBook: ObjectContent = {
  objectId: "contact-board",
  roomId: "professional",
  title: "Contact",
  titleAr: "التواصل",
  type: "link-collection",
  links: [
    {
      url: "mailto:hello@example.com",
      label: "hello@example.com",
      labelAr: "hello@example.com",
      icon: "email",
    },
    {
      url: "https://example.com/profile",
      label: "Professional profile",
      labelAr: "الملف المهني",
      icon: "linkedin",
    },
    {
      url: "https://example.com/shop",
      label: "Shop",
      labelAr: "المتجر",
      icon: "store",
    },
  ],
};

const awardsDisplay: ObjectContent = {
  objectId: "video-setup",
  roomId: "professional",
  title: "Awards & Recognition",
  titleAr: "الجوائز والتقدير",
  type: "richtext",
  body: textToTipTap([
    "Best Picture Book — Example Illustration Awards (2024)",
    "Speaker — Sample Design Meetup (2023)",
    "Shortlisted — Placeholder Poster Prize (2022)",
  ]),
  bodyAr: textToTipTap([
    "أفضل كتاب مصوّر — جوائز المثال للرسم (2024)",
    "متحدّث — ملتقى التصميم النموذجي (2023)",
    "القائمة القصيرة — جائزة الملصق النموذجية (2022)",
  ]),
};

// ─── Gallery Room ───────────────────────────────────────────

const artworkPlaceholder = (
  id: string,
  title: string,
  titleAr: string
): ObjectContent => ({
  objectId: id,
  roomId: "gallery",
  title,
  titleAr,
  type: "gallery",
  images: [],
  body: textToTipTap(["Upload artwork images in the editor to populate this gallery."]),
  bodyAr: textToTipTap(["قم بتحميل صور الأعمال الفنية في المحرر لملء هذا المعرض."]),
});

// ─── Blog Room ─────────────────────────────────────────────

const journalPlaceholder = (
  id: string,
  title: string,
  titleAr: string
): ObjectContent => ({
  objectId: id,
  roomId: "content",
  title,
  titleAr,
  type: "richtext",
  body: textToTipTap(["Write your post in the editor."]),
  bodyAr: textToTipTap(["اكتب تدوينتك في المحرر."]),
});

// ─── Shop ───────────────────────────────────────────────────

const shopCounter: ObjectContent = {
  objectId: "counter",
  roomId: "shop",
  title: "Shop",
  titleAr: "المتجر",
  // `mixed` = description (richtext) + action links. Lets the player read
  // what they're about to leave the world for before clicking through.
  type: "mixed",
  body: textToTipTap([
    "Step up to the counter to visit the online shop.",
    "A small collection of prints and handmade pieces (sample text). Opens in a new tab so you don't lose your spot here.",
  ]),
  bodyAr: textToTipTap([
    "تقدّم إلى المنضدة لزيارة المتجر الإلكتروني.",
    "مجموعة صغيرة من المطبوعات والقطع المصنوعة يدوياً (نص نموذجي). يُفتح في علامة تبويب جديدة حتى لا تفقد مكانك هنا.",
  ]),
  links: [
    {
      url: "https://example.com/shop",
      label: "Open the shop",
      labelAr: "افتح المتجر",
      icon: "store",
    },
  ],
};

// ─── Short starter notes ────────────────────────────────────

/** A one-paragraph pop-up, so every clickable thing has something to say. */
const note = (
  roomId: string,
  id: string,
  title: string,
  titleAr: string,
  text: string,
  textAr: string
): ObjectContent => ({
  objectId: id,
  roomId,
  title,
  titleAr,
  type: "richtext",
  body: textToTipTap([text]),
  bodyAr: textToTipTap([textAr]),
});

// ─── Aggregate ──────────────────────────────────────────────

/** All static content, keyed by "roomId:objectId" */
export const staticContent: Record<string, ObjectContent> = {
  // Home
  "home:welcome-board": welcomeBoard,
  "home:couch": couch,
  "home:plant": plant,

  // Professional (matches staticRooms.ts: cv-board, contact-board,
  // desk-operations, desk-datascience, video-setup)
  "professional:cv-board": resumeDesk,
  "professional:desk-datascience": certificatesShelf,
  "professional:desk-operations": skillsBoard,
  "professional:contact-board": contactBook,
  "professional:video-setup": awardsDisplay,

  // Gallery (matches staticRooms.ts: frame-1..4, video-wall)
  "gallery:frame-1": artworkPlaceholder("frame-1", "Artwork 1", "عمل فني 1"),
  "gallery:frame-2": artworkPlaceholder("frame-2", "Artwork 2", "عمل فني 2"),
  "gallery:frame-3": artworkPlaceholder("frame-3", "Artwork 3", "عمل فني 3"),
  "gallery:frame-4": artworkPlaceholder("frame-4", "Artwork 4", "عمل فني 4"),
  "gallery:video-wall": note(
    "gallery", "video-wall", "Video Reels", "مقاطع الفيديو",
    "A screen for your reels and films. Add a video or an embed to this pop-up in the editor.",
    "شاشة لمقاطعك وأفلامك. أضف فيديو أو تضميناً إلى هذه النافذة من المحرر."
  ),

  // The Blog (matches staticRooms.ts: journal-desk, quotes-tree,
  // instagram-display)
  "content:journal-desk": journalPlaceholder("journal-desk", "Latest Thoughts", "آخر الأفكار"),
  "content:quotes-tree": journalPlaceholder("quotes-tree", "Reflections", "تأملات"),
  "content:instagram-display": note(
    "content", "instagram-display", "Instagram Feed", "انستغرام",
    "A frame for your social feed. Add an embed or a few pictures to this pop-up in the editor.",
    "إطار لحسابك على وسائل التواصل. أضف تضميناً أو بعض الصور إلى هذه النافذة من المحرر."
  ),

  // The Archive
  "archive:bookshelf-left": note(
    "archive", "bookshelf-left", "Life Stories", "قصص الحياة",
    "A cabinet of stories. Each one could be a page here: where you started, what you tried, what stayed with you.",
    "خزانة من القصص. كل قصة يمكن أن تكون صفحة هنا: من أين بدأت، وما الذي جرّبته، وما الذي بقي معك."
  ),
  "archive:bookshelf-right": note(
    "archive", "bookshelf-right", "Philosophy", "الفلسفة",
    "The ideas you keep coming back to. Write a few of them down here.",
    "الأفكار التي تعود إليها دائماً. دوّن بعضها هنا."
  ),
  "archive:reading-desk": note(
    "archive", "reading-desk", "Reading Desk", "مكتب القراءة",
    "What is on the desk right now: a book, an article, a quote worth keeping.",
    "ما يوجد على المكتب الآن: كتاب، مقال، أو اقتباس يستحق الاحتفاظ به."
  ),

  // The Lab
  "lab:learning-board": note(
    "lab", "learning-board", "Learning Now", "أتعلم الآن",
    "A running list of what you are learning this season.",
    "قائمة متجددة بما تتعلمه هذا الموسم."
  ),
  "lab:ideas-wall": note(
    "lab", "ideas-wall", "Ideas Board", "لوحة الأفكار",
    "Half-formed ideas are welcome here. Pin them up before they get away.",
    "الأفكار غير المكتملة مرحّب بها هنا. ثبّتها قبل أن تفلت."
  ),
  "lab:experiment-table": note(
    "lab", "experiment-table", "Current Experiments", "التجارب الحالية",
    "Works in progress: what you are testing, and what you have found so far.",
    "أعمال قيد التنفيذ: ما الذي تختبره، وما الذي وجدته حتى الآن."
  ),

  // Memory Lane
  "memory-lane:milestone-1": note(
    "memory-lane", "milestone-1", "Beginning", "البداية",
    "Where it all started. Add a date, a photo and a few lines.",
    "من هنا بدأ كل شيء. أضف تاريخاً وصورة وبضعة أسطر."
  ),
  "memory-lane:milestone-2": note(
    "memory-lane", "milestone-2", "Growth", "النمو",
    "The years of learning the craft.",
    "سنوات تعلّم الحرفة."
  ),
  "memory-lane:milestone-3": note(
    "memory-lane", "milestone-3", "Challenges", "التحديات",
    "The hard parts, and what they taught you.",
    "الأوقات الصعبة، وما علّمتك إياه."
  ),
  "memory-lane:milestone-4": note(
    "memory-lane", "milestone-4", "Now", "الآن",
    "Where you are today, and what comes next.",
    "أين أنت اليوم، وما الذي يأتي بعد ذلك."
  ),

  // Shop (roomId is "shop")
  "shop:counter": shopCounter,
  "shop:brand-logo": note(
    "shop", "brand-logo", "Our Brand", "علامتنا",
    "Hello! I look after the shop. Tell visitors the story behind what you make.",
    "أهلاً! أنا المسؤول عن المتجر. احكِ للزوار القصة وراء ما تصنعه."
  ),
};

/** Look up content for a specific object in a room */
export function getStaticContent(
  roomId: string,
  objectId: string
): ObjectContent | null {
  return staticContent[`${roomId}:${objectId}`] ?? null;
}

/** Get all content for a room */
export function getStaticContentForRoom(
  roomId: string
): Record<string, ObjectContent> {
  const result: Record<string, ObjectContent> = {};
  for (const [key, content] of Object.entries(staticContent)) {
    if (key.startsWith(`${roomId}:`)) {
      result[content.objectId] = content;
    }
  }
  return result;
}
