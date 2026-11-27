# Third-party notices

Creatofolio's own code is MIT-licensed (see [LICENSE](LICENSE)). It builds on
the work below. Each project keeps its own licence; the full texts ship inside
`app/node_modules/<package>/` after `npm install`.

## Built and embedded at install time

| Project | Use | Licence |
| --- | --- | --- |
| [Klecks](https://github.com/bitbof/klecks) by bitbof | The in-app drawing studio. `app/scripts/build-klecks.mjs` clones Klecks at a pinned commit (0.10.1.5), applies the patches in `app/scripts/klecks-patches/` and builds it into `app/public/klecks/`. The Klecks source is **not** stored in this repository. | MIT |

The patch files in `app/scripts/klecks-patches/` are modifications of Klecks
source and are offered under the same MIT terms (original lines © bitbof).

## Runtime dependencies

| Project | Use | Licence |
| --- | --- | --- |
| [Next.js](https://nextjs.org), [React](https://react.dev) | App framework | MIT |
| [Phaser 3](https://phaser.io) | The walkable game world | MIT |
| [Konva](https://konvajs.org), react-konva | Room editor canvas | MIT |
| [Supabase JS](https://github.com/supabase/supabase-js), @supabase/ssr | Database, auth, storage client | MIT |
| [TipTap](https://tiptap.dev) | Rich-text editing | MIT |
| [Zustand](https://github.com/pmndrs/zustand), [zundo](https://github.com/charkour/zundo) | Editor state, undo/redo | MIT |
| [Radix UI](https://www.radix-ui.com), [shadcn/ui](https://ui.shadcn.com), cmdk, sonner | UI primitives | MIT |
| [dnd kit](https://dndkit.com), [Moveable](https://github.com/daybrush/moveable), react-colorful | Drag, transform, colour picking | MIT |
| [Embla Carousel](https://www.embla-carousel.com), [Lenis](https://github.com/darkroomengineering/lenis) | Carousels, smooth scroll | MIT |
| [Tailwind CSS](https://tailwindcss.com), tailwind-merge, tw-animate-css, clsx | Styling | MIT |
| class-variance-authority | Styling variants | Apache-2.0 |
| [Lucide](https://lucide.dev) | Icons | ISC |
| [Simple Icons](https://simpleicons.org) | Brand icons (the marks themselves remain trademarks of their owners) | CC0-1.0 |
| [GSAP](https://gsap.com) | Scroll and motion on the landing page | **GSAP Standard "no charge" licence** (not an OSI licence) |

**About GSAP:** GSAP is free to use, including commercially, under its own
[standard licence](https://gsap.com/standard-license), which carries
restrictions that MIT does not. Read it before building on top of it. GSAP is
installed from npm and is not redistributed in this repository.

## Fonts

Loaded through `next/font/google` at build time, not stored in this
repository: Fraunces, IBM Plex Sans, IBM Plex Sans Arabic and Geist Mono (all
SIL Open Font License 1.1).

The landing editor's font picker also offers a list of Google Fonts
(`app/src/data/fonts.ts`). A font chosen there is loaded in the visitor's
browser from `fonts.googleapis.com` and is under its own open licence; none
is stored here.

Next.js optimises images on the server with [sharp](https://sharp.pixelplumbing.com)
(Apache-2.0), which downloads a prebuilt libvips (LGPL-3.0-or-later) at
install time. Neither is stored in this repository.

## Ported code

| Project | What | Licence |
| --- | --- | --- |
| [Yukon](https://github.com/wizguin/yukon) by wizguin | `app/src/components/game/systems/PathEngine.ts` (click-to-walk pathing) is a TypeScript port of Yukon's `PathEngine.js`, and the room scene follows the same structure. | MIT, Copyright (c) 2022 wizguin |

## Design inspiration

No code from these projects is included, but their ideas shaped this one:

- [LDtk](https://ldtk.io) by Sébastien Bénard: the world-map layouts
  (free / gridvania / linear) and several level-editor conventions.
- Classic click-to-walk virtual worlds, for the room, door and avatar-layer
  model.

## Artwork

The starter art comes from the open packs below; the scripts in
`app/scripts/` only assemble it. The one exception is the loading screen's
small doodles (a star, a pencil, a heart and the book cover), which are a few
lines of SVG written for this project in
`app/src/components/landing/loader/LoaderArt.tsx` and are MIT with the code. All of it exists to be replaced with your own drawings.

### Kenney (CC0, public domain)

By **[Kenney](https://kenney.nl)** (Kenney Vleugels), released under
[Creative Commons Zero 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
CC0 does not require credit; it is given here gladly.

| Pack | Used for | Files |
| --- | --- | --- |
| [Modular Characters](https://kenney.nl/assets/modular-characters) | The starter avatar and every option in the character creator (skin, faces, hair, tops, bottoms, shoes), the wardrobe's drawing guide, the app icons and the NPC element. | `app/public/avatar/seed/*.png`, `app/public/avatar/_rig_reference.png`, `app/src/app/icon.png`, `apple-icon.png`, `favicon.ico`, `app/public/elements/mascot.png` |
| [Furniture Kit](https://kenney.nl/assets/furniture-kit) | Room furniture: doors, sofa, armchair, desk, chair, cabinet, shelving, computer, television, coffee table, lamp, plant, rug, boxes. | `app/public/elements/*.png` (except `mascot.png`) |
| [Mini Arcade](https://kenney.nl/assets/mini-arcade) | The arcade machine on the landing page. | `app/public/landing/machine.png` |
| [UI Pack](https://kenney.nl/assets/ui-pack) | The built-in game buttons (HUD, map list, character creator, close button), copied unchanged; and the "click to play" card: round button, play icon, label button and the "Kenney Future" lettering. | `app/public/ui/*.svg`, `app/public/landing/cta-en.svg`, `cta-ar.svg` |
| [Input Prompts](https://kenney.nl/assets/input-prompts) | The mouse icon on the "click to play" card. | `app/public/landing/cta-en.svg`, `cta-ar.svg` |
| [Pattern Pack](https://kenney.nl/assets/pattern-pack) | Wallpaper patterns and the checkered floor in the room backdrops. | `app/public/rooms/*.jpg` |

What was changed:

- The character parts are assembled and posed into 7-frame walk sheets by
  `app/scripts/avatar-seed/build_sheets.py`.
- The furniture and the arcade machine are Kenney's 3D models rendered to
  sprites by `app/scripts/starter-art/render_obj.py` (`build_elements.py`,
  `build_landing.py`). The arcade machine's proportions are adjusted so its
  screen has the game's shape, and the screen is cut out so the game shows
  through.
- The "click to play" card is laid out from the pack's vector files by
  `app/scripts/starter-art/build_cta.py`; the label button's flat middle is
  stretched to fit the text.

The original packs are not redistributed here; download them from the links
above to rebuild.

### Fluent Emoji (MIT)

The small objects in `app/public/elements/*.svg` (window, picture frame, clock,
clipboard, sign, paint palette, books, trophy, microscope, camera, briefcase,
shopping bags, rocket, light bulb, envelope, joystick) are the flat-style
[Fluent Emoji](https://github.com/microsoft/fluentui-emoji), copied unchanged
and renamed. Copyright (c) Microsoft Corporation, MIT licence; the licence
text is in `app/public/elements/LICENSE-fluent-emoji.txt`.

### Lucide (ISC)

The loading screen's built-in face is the "smile" and "laugh" icons from
[Lucide](https://lucide.dev), inlined in
`app/src/components/landing/loader/LoaderArt.tsx`.

### Room textures from OpenGameArt (CC0, public domain)

The room backdrops in `app/public/rooms/*.jpg` are these textures, tinted and
laid out in perspective by `app/scripts/starter-art/build_rooms.py`, with
Kenney's Pattern Pack (above) as wallpaper:

| Work | Author | Used for |
| --- | --- | --- |
| [Seamless Cartoon Textures](https://opengameart.org/content/seamless-cartoon-textures) | OzMaister | Plaster walls, wood panelling and trim, board floors, marble and stone floors. |
| [Wooden Floors (2K)](https://opengameart.org/content/wooden-floors-2k) | PamNawi | Hand-painted plank floors. |

Both are released under
[Creative Commons Zero 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The texture files themselves are not redistributed here.

### Lalezar (SIL Open Font License 1.1)

The Arabic lettering on the "click to play" card (`app/public/landing/cta-ar.svg`)
is set in [Lalezar](https://github.com/BornaIz/Lalezar), Copyright 2015 The
Lalezar Project Authors, and stored as outlines. The font file is not
redistributed; its licence is in `app/public/landing/LICENSE-lalezar.txt`.
