// Static room configurations: the starter world.
// This serves as the fallback data when Supabase is unavailable, and is what
// `npm run db:seed` copies into an empty database.
//
// Canvas design size: 1520 x 960 (about 16:10).

import type { RoomConfig, RoomId, StaticWorldBundle } from "./roomTypes";

// Room connection network (a tree, at most three doors per room):
//
//   [Shop] ←→ [Gallery] ←→ [Living Room] ←→ [Professional] ←→ [The Lab]
//                               ↕
//                         [The Archive] ←→ [The Blog] ←→ [Memory Lane]
//
// Layout rules for the starter rooms, so they read as real rooms:
//   - Every door is on the back wall and stands on the floor line. The door
//     back towards the Living Room is on the left, the way onward on the right.
//   - Furniture keeps the proportions of its drawing (sizes are listed in
//     starterElements.ts) and stands against the back wall or on the floor.
//   - Floor pieces pin their depth to their bottom edge, so the character
//     passes behind and in front of them correctly.

const W = 1520;
const H = 960;

type Obj = RoomConfig["objects"][number];
type Extra = Partial<Obj>;

/** A door on the back wall, standing on the floor line `y0`, centred on `cx`. */
const door = (
  id: string,
  label: string,
  labelAr: string,
  cx: number,
  y0: number,
  targetRoomId: RoomId,
  targetEntryPointId: string
): Obj => ({
  id,
  x: cx - 60,
  y: y0 - 244,
  width: 120,
  height: 249,
  type: "door",
  label,
  labelAr,
  targetRoomId,
  targetEntryPointId,
  interactionRadius: 120,
  isWallMounted: true,
  moveTo: { x: cx, y: y0 + 34 },
});

/** Where the character appears after coming through the door at `cx`. */
const arrive = (id: string, cx: number, y0: number) => ({
  id,
  x: cx,
  y: y0 + 70,
  direction: "right" as const,
});

/** Something hanging on the back wall, centred on `cx` with its top at `top`. */
const onWall = (
  id: string,
  label: string,
  labelAr: string,
  cx: number,
  top: number,
  size: number,
  y0: number,
  extra: Extra = {}
): Obj => ({
  id,
  x: cx - size / 2,
  y: top,
  width: size,
  height: size,
  type: "object",
  label,
  labelAr,
  interactionRadius: 140,
  isWallMounted: true,
  moveTo: { x: cx, y: y0 + 40 },
  interactionType: "content",
  zIndex: 0,
  ...extra,
});

/** Something standing on the floor: centred on `cx`, feet at `bottom`. */
const onFloor = (
  id: string,
  label: string,
  labelAr: string,
  cx: number,
  bottom: number,
  w: number,
  h: number,
  extra: Extra = {}
): Obj => ({
  id,
  x: Math.round(cx - w / 2),
  y: bottom - h,
  width: w,
  height: h,
  type: "object",
  label,
  labelAr,
  interactionRadius: 120,
  isWallMounted: false,
  interactionType: "content",
  zIndex: bottom,
  ...extra,
});

const DECOR: Extra = { interactionType: "none", interactionRadius: 80 };

const windowOn = (id: string, cx: number, top: number, y0: number) =>
  onWall(id, "Window", "نافذة", cx, top, 150, y0, DECOR);
const plantAt = (id: string, cx: number, bottom: number) =>
  onFloor(id, "Plant", "نبتة", cx, bottom, 66, 202, DECOR);
const rugAt = (cx: number, bottom: number) =>
  onFloor("rug", "Rug", "سجادة", cx, bottom, 300, 189, { ...DECOR, zIndex: 1 });

const home: RoomConfig = {
  id: "home",
  config: { minimapEmoji: "🏠" },
  name: "Living Room",
  nameAr: "غرفة المعيشة",
  description: "The central hub of this little world",
  descriptionAr: "المركز الرئيسي لهذا العالم الصغير",
  backgroundColor: "#F4E3C9",
  bgMiddleUrl: "/rooms/home.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 120, y: 420 },
      { x: 1400, y: 420 },
      { x: W, y: 500 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 500 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 600, direction: "right" },
    arrive("from-gallery", 280, 420),
    arrive("from-archive", 760, 420),
    arrive("from-professional", 1240, 420),
  ],
  objects: [
    // Back wall, left to right: door, window, door, window, door.
    door("door-gallery", "Gallery", "المعرض", 280, 420, "gallery", "from-home"),
    door("door-archive", "The Archive", "الأرشيف", 760, 420, "archive", "from-home"),
    door("door-professional", "Professional", "المهني", 1240, 420, "professional", "from-home"),
    windowOn("window-left", 520, 100, 420),
    windowOn("window-right", 1000, 100, 420),
    onWall("welcome-board", "Welcome", "أهلاً", 760, 62, 96, 420, { spriteUrl: "/elements/sign.svg" }),

    // Under the left window: the sofa. Under the right one: armchair and lamp.
    onFloor("couch", "Couch", "أريكة", 532, 452, 278, 152),
    onFloor("armchair", "Armchair", "كرسي بذراعين", 985, 452, 140, 152, DECOR),
    onFloor("lamp", "Floor lamp", "مصباح", 1100, 448, 48, 262, DECOR),
    onFloor("plant", "Plant", "نبتة", 366, 452, 66, 202),

    // Middle of the floor.
    rugAt(760, 800),
    onFloor("coffee-table", "Coffee table", "طاولة قهوة", 760, 745, 197, 96, DECOR),
  ],
};

const gallery: RoomConfig = {
  id: "gallery",
  config: { minimapEmoji: "🎨" },
  name: "Gallery",
  nameAr: "المعرض",
  description: "Visual work and creative projects",
  descriptionAr: "الأعمال المرئية والمشاريع الإبداعية",
  backgroundColor: "#E9E4DC",
  bgMiddleUrl: "/rooms/gallery.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 80, y: 460 },
      { x: 1440, y: 460 },
      { x: W, y: 530 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 530 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 640, direction: "right" },
    arrive("from-home", 200, 460),
    arrive("from-shop", 1320, 460),
  ],
  objects: [
    door("door-home", "Living Room", "غرفة المعيشة", 200, 460, "home", "from-gallery"),
    door("door-shop", "Shop", "المتجر", 1320, 460, "shop", "from-gallery"),

    // A hung row of four pictures.
    onWall("frame-1", "Artwork 1", "عمل فني 1", 430, 150, 160, 460),
    onWall("frame-2", "Artwork 2", "عمل فني 2", 650, 150, 160, 460),
    onWall("frame-3", "Artwork 3", "عمل فني 3", 870, 150, 160, 460),
    onWall("frame-4", "Artwork 4", "عمل فني 4", 1090, 150, 160, 460),

    // The screen, and a bench to watch it from.
    onFloor("video-wall", "Video Reels", "مقاطع الفيديو", 760, 690, 220, 162),
    onFloor("bench", "Sofa", "أريكة", 760, 910, 278, 152, DECOR),
    plantAt("plant-left", 330, 492),
    plantAt("plant-right", 1190, 492),
  ],
};

const professional: RoomConfig = {
  id: "professional",
  config: { minimapEmoji: "💼" },
  name: "Professional Hub",
  nameAr: "المركز المهني",
  description: "Experience, skills and contact",
  descriptionAr: "الخبرة والمهارات والتواصل",
  backgroundColor: "#C4D7DF",
  bgMiddleUrl: "/rooms/professional.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 100, y: 440 },
      { x: 1420, y: 440 },
      { x: W, y: 520 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 520 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 640, direction: "right" },
    arrive("from-home", 220, 440),
    arrive("from-lab", 1300, 440),
  ],
  objects: [
    door("door-home", "Living Room", "غرفة المعيشة", 220, 440, "home", "from-professional"),
    door("door-lab", "The Lab", "المختبر", 1300, 440, "lab", "from-professional"),

    // Two desks against the wall under their windows: the CV on one, the
    // post on the other.
    windowOn("window-left", 500, 100, 440),
    windowOn("window-right", 1020, 100, 440),
    onWall("clock", "Clock", "ساعة", 760, 110, 120, 440, DECOR),
    onFloor("cv-board", "My CV", "سيرتي الذاتية", 440, 350, 84, 84, { zIndex: 473 }),
    onFloor("contact-board", "Contact Me", "تواصل معي", 1080, 350, 84, 84, { zIndex: 473 }),
    onFloor("desk-operations", "Skills & Tools", "المهارات والأدوات", 500, 472, 243, 151),
    onFloor("desk-datascience", "Certificates", "الشهادات", 1020, 472, 243, 151, {
      spriteUrl: "/elements/desk.png",
    }),

    // Awards on a table in the middle of the room.
    rugAt(760, 800),
    onFloor("awards-table", "Coffee table", "طاولة قهوة", 760, 745, 197, 96, DECOR),
    onFloor("video-setup", "Awards", "الجوائز", 760, 690, 96, 96, { zIndex: 746 }),
    plantAt("plant", 760, 472),
  ],
};

const archive: RoomConfig = {
  id: "archive",
  config: { minimapEmoji: "📚" },
  name: "The Archive",
  nameAr: "الأرشيف",
  description: "Stories and memories",
  descriptionAr: "القصص والذكريات",
  backgroundColor: "#D2C7AB",
  bgMiddleUrl: "/rooms/archive.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 140, y: 420 },
      { x: 1380, y: 420 },
      { x: W, y: 500 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 500 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 600, direction: "right" },
    arrive("from-home", 260, 420),
    arrive("from-content", 1260, 420),
  ],
  objects: [
    door("door-home", "Living Room", "غرفة المعيشة", 260, 420, "home", "from-archive"),
    door("door-content", "The Blog", "المدونة", 1260, 420, "content", "from-archive"),

    // Two cabinets against the wall with a clock between them.
    onFloor("bookshelf-left", "Life Stories", "قصص الحياة", 520, 448, 224, 231),
    onFloor("bookshelf-right", "Philosophy", "الفلسفة", 1000, 448, 224, 231, {
      spriteUrl: "/elements/bookshelf.png",
    }),
    onWall("clock", "Clock", "ساعة", 760, 130, 120, 420, DECOR),

    // A reading corner.
    rugAt(760, 820),
    onFloor("reading-desk", "Reading Desk", "مكتب القراءة", 760, 740, 243, 151),
    onFloor("lamp", "Floor lamp", "مصباح", 930, 740, 48, 262, DECOR),
  ],
};

const lab: RoomConfig = {
  id: "lab",
  config: { minimapEmoji: "🧪" },
  name: "The Lab",
  nameAr: "المختبر",
  description: "Experiments and explorations",
  descriptionAr: "التجارب والاستكشافات",
  backgroundColor: "#C6DEC9",
  bgMiddleUrl: "/rooms/lab.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 120, y: 440 },
      { x: 1400, y: 440 },
      { x: W, y: 520 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 520 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 640, direction: "right" },
    arrive("from-professional", 240, 440),
  ],
  objects: [
    door("door-professional", "Professional", "المهني", 240, 440, "professional", "from-lab"),

    // The workbench against the wall, the microscope on it, a board each side.
    onWall("learning-board", "Learning Now", "أتعلم الآن", 500, 130, 140, 440),
    onWall("ideas-wall", "Ideas Board", "لوحة الأفكار", 1020, 130, 140, 440),
    onFloor("workbench", "Workbench", "طاولة العمل", 760, 474, 300, 186, DECOR),
    onFloor("experiment-table", "Current Experiments", "التجارب الحالية", 760, 330, 110, 110, {
      zIndex: 475,
    }),
    onFloor("shelving", "Shelving", "رفوف", 1260, 470, 115, 261, DECOR),
    onFloor("crate", "Closed box", "صندوق مغلق", 1130, 480, 82, 122, DECOR),
  ],
};

const shop: RoomConfig = {
  id: "shop",
  config: { minimapEmoji: "🛍️" },
  name: "Shop",
  nameAr: "المتجر",
  description: "Prints and handmade pieces",
  descriptionAr: "مطبوعات وقطع مصنوعة يدوياً",
  backgroundColor: "#F3CDBB",
  bgMiddleUrl: "/rooms/shop.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 100, y: 440 },
      { x: 1420, y: 440 },
      { x: W, y: 520 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 520 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 840, direction: "right" },
    arrive("from-gallery", 220, 440),
  ],
  objects: [
    door("door-gallery", "Gallery", "المعرض", 220, 440, "gallery", "from-shop"),

    // Two collections on the wall, the shopkeeper and stock beside them.
    onWall("rack-1", "Collection 1", "مجموعة 1", 520, 130, 160, 440, { interactionType: "avatar-shop" }),
    onWall("rack-2", "Collection 2", "مجموعة 2", 800, 130, 160, 440, { interactionType: "avatar-shop" }),
    onFloor("brand-logo", "Our Brand", "علامتنا", 1080, 480, 111, 169),
    onFloor("shelving", "Shelving", "رفوف", 1280, 470, 115, 261, DECOR),

    // The counter. Its content modal describes the shop and offers an "Open
    // store" button, which keeps the in-world feel better than a bare link.
    onFloor("sales-desk", "Desk", "طاولة البيع", 760, 740, 300, 186, DECOR),
    onFloor("counter", "Visit Online Store", "زيارة المتجر", 760, 600, 100, 100, { zIndex: 741 }),
  ],
};

const content: RoomConfig = {
  id: "content",
  config: { minimapEmoji: "📖" },
  name: "The Blog",
  nameAr: "المدونة",
  description: "Self-improvement and motivation",
  descriptionAr: "تطوير الذات والتحفيز",
  backgroundColor: "#FFE7BF",
  bgMiddleUrl: "/rooms/content.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 60, y: 400 },
      { x: 1460, y: 400 },
      { x: W, y: 460 },
      { x: W, y: H },
      { x: 0, y: H },
      { x: 0, y: 460 },
    ],
  },
  entryPoints: [
    { id: "default", x: 760, y: 600, direction: "right" },
    arrive("from-archive", 200, 400),
    arrive("from-memory-lane", 1320, 400),
  ],
  objects: [
    door("door-archive", "The Archive", "الأرشيف", 200, 400, "archive", "from-content"),
    door("door-memory", "Memory Lane", "ممر الذكريات", 1320, 400, "memory-lane", "from-content"),

    // The writing desk against the wall, a picture and a plant either side.
    onFloor("writing-desk", "Desk", "مكتب", 760, 432, 243, 151, DECOR),
    onFloor("journal-desk", "Latest Thoughts", "آخر الأفكار", 760, 330, 118, 90, {
      spriteUrl: "/elements/computer.png",
      zIndex: 433,
    }),
    onWall("instagram-display", "Instagram Feed", "انستغرام", 480, 110, 150, 400),
    onWall("clock", "Clock", "ساعة", 1040, 110, 120, 400, DECOR),
    onFloor("quotes-tree", "Quotes", "اقتباسات", 1040, 436, 66, 202, { spriteUrl: "/elements/plant.png" }),

    // Somewhere to sit and read.
    rugAt(760, 800),
    onFloor("sofa", "Sofa", "أريكة", 760, 740, 278, 152, DECOR),
  ],
};

const MILESTONE: Extra = { spriteUrl: "/elements/sign.svg" };

const memoryLane: RoomConfig = {
  id: "memory-lane",
  config: { minimapEmoji: "🛤️" },
  name: "Memory Lane",
  nameAr: "ممر الذكريات",
  description: "A journey through time",
  descriptionAr: "رحلة عبر الزمن",
  backgroundColor: "#DCCDE8",
  bgMiddleUrl: "/rooms/memory-lane.jpg",
  width: W,
  height: H,
  walkableArea: {
    polygon: [
      { x: 0, y: 340 },
      { x: W, y: 340 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
  },
  entryPoints: [
    { id: "default", x: 160, y: 520, direction: "right" },
    arrive("from-content", 160, 340),
  ],
  objects: [
    door("door-content", "The Blog", "المدونة", 160, 340, "content", "from-memory-lane"),
    windowOn("window-left", 530, 60, 340),
    windowOn("window-right", 1130, 60, 340),

    // Four signposts in a line, oldest first.
    onFloor("milestone-1", "Beginning", "البداية", 380, 640, 170, 170, MILESTONE),
    onFloor("milestone-2", "Growth", "النمو", 680, 640, 170, 170, MILESTONE),
    onFloor("milestone-3", "Challenges", "التحديات", 980, 640, 170, 170, MILESTONE),
    onFloor("milestone-4", "Now", "الآن", 1280, 640, 170, 170, MILESTONE),
    plantAt("plant-left", 830, 372),
    plantAt("plant-right", 1420, 372),
  ],
};

export const staticWorld: StaticWorldBundle = {
  rooms: {
    home,
    gallery,
    professional,
    archive,
    lab,
    shop,
    content,
    "memory-lane": memoryLane,
  },
};
