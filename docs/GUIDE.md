# Owner's guide

How to use Creatofolio once it is running. This guide starts where the [README](../README.md) "Quick start" ends: the site is up and you are signed in at `/admin`. Installation, environment variables and deployment are in the README and are not repeated here.

Everything a visitor sees at first is starter content: placeholder art from open packs (credits in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)) that you are expected to replace with your own drawings.

## Contents

1. [A map of the admin](#1-a-map-of-the-admin)
2. [Rooms](#2-rooms)
3. [The World map](#3-the-world-map)
4. [Drafts, Publish, history and the trash](#4-drafts-publish-history-and-the-trash)
5. [Pop-ups](#5-pop-ups)
6. [The landing page editor](#6-the-landing-page-editor)
7. [The drawing studio](#7-the-drawing-studio)
8. [The wardrobe and the character creator](#8-the-wardrobe-and-the-character-creator)
9. [The loading screen](#9-the-loading-screen)
10. [Storage and security](#10-storage-and-security)
11. [Two languages, and working on an iPad](#11-two-languages-and-working-on-an-ipad)
12. [Replacing the starter content](#12-replacing-the-starter-content)

Two things to know first:

- **Saving is not always publishing.** Rooms, landing pages and pop-up styles keep a private draft until you press **Publish**. Site settings, the navigation bar, the loading screen, the wardrobe and room positions on the World map change for visitors as soon as you save them.
- **Shortcuts** are written with `Ctrl`. On a Mac, use `Cmd`. They do nothing while you are typing in a text field.

## 1. A map of the admin

`/admin` is the dashboard. It edits nothing itself: it lists your rooms and pages and links to every tool. Its header has **View site**, **Security** and **Sign out**.

| Page | What it is for |
| --- | --- |
| `/admin` | Dashboard. Room list (a **Draft** badge marks unpublished changes), page list (**Live** or **Offline**, number of drafts), a **Maintenance** switch and the **Recently deleted** card. |
| `/admin/editor` | Room editor: the objects, doors, backgrounds and pop-ups of one room. |
| `/admin/editor/world` | World map: arrange, add and delete rooms; manage worlds. |
| `/admin/play` | Play the game with your unpublished room drafts. Nothing is saved there. |
| `/admin/landing-editor` | Landing page editor: the public pages, plus **Site settings** and the **Nav Studio**. |
| `/admin/landing-editor/preview/<page>` | One page as visitors would see it. |
| `/admin/popup-styles` | Draw how pop-ups look: themes and frames. |
| `/admin/loading-screen` | The animated screen shown while the site loads. |
| `/admin/wardrobe` | The clothes, hair and bodies visitors pick for their character. |
| `/admin/storage` | See what uses storage space; delete files nothing uses. |
| `/admin/security` | Two-factor sign-in and your password. |

## 2. Rooms

A room is one scene of the walkable world. Open the editor with **Open room editor** on the dashboard, or click a room in the dashboard list.

- **Toolbar** (top): room picker, **Add**, the tools, undo and redo, **Save draft**, **Publish**. In the room picker a dot marks unsaved edits and a diamond marks a saved draft.
- **Outline** (left, `Ctrl+B`): every object and entry point in the room.
- **Canvas** (middle): the room, always 1520 × 960 pixels.
- **Properties** (right): **Room Properties** when nothing is selected, **Object Properties** for a selected object.

### To add an object

1. Press **Add** (or `A`).
2. Under **New Object**, pick **Object**, **Door** or **Character**. A placeholder lands in the middle of the view, selected.
3. Or use the **Starter elements** palette: click a drawing to drop it in the middle, or drag it onto the room.
4. Name it in **Label (EN)** and **Label (AR)**.

**From Library…** opens the **Library** panel (`L`). **Templates** holds objects you saved with **Save as Template** (drawing, size and click steps included; the object needs a drawing first). **Sprites** holds pictures you added with **Upload sprites**. Drag either onto the room.

### To move, resize, layer and lock

- **Move and resize:** with the **Select** tool (`S`), drag an object, or drag its handles to resize and rotate. Corners keep the proportions. Hold `Shift` while dragging to stay on a straight line. For exact values type into **X**, **Y**, **Width**, **Height** and **Rotation (°)**.
- **Snap:** **Grid** (`G`) snaps to a grid; the box beside it sets the cell size.
- **Several at once:** `Shift`-click or `Ctrl`-click objects, or drag a box on empty canvas. The panel then offers **Align** and **Distribute**.
- **Layer:** by default objects sort by how low they sit in the room, so the character walks behind things higher up. To override, use **Bring to Front**, **Bring Forward**, **Send Backward** and **Send to Back** under **Layer**. **Pin depth at current layer** freezes the depth; **Reset to Auto** undoes that.
- **Lock:** use the padlock on the Outline row or in the panel header, right-click and choose **Lock in place**, or press `Ctrl+Shift+L`. A locked object cannot be moved, resized or rotated, and canvas clicks pass through it. Select it from the Outline and press **Unlock**. An object covering almost the whole room is locked by default.
- **Hide while editing:** the eye on an Outline row hides an object on the canvas only. It is still saved and still shows in the game.

### To give an object, or the room, your own art

Under **Sprite** in **Object Properties**:

- **Draw Sprite in Studio** opens the [drawing studio](#7-the-drawing-studio) for this object (**Edit Sprite in Studio** once it has a drawing).
- **Use a starter drawing** swaps in a starter element. **Remove sprite** returns to the placeholder.
- **Hotspot only** draws nothing in the game: use it for something already painted into the background.
- For a picture made elsewhere, upload it in **Library** > **Sprites** and drag it onto the room. It arrives as a new object; an existing object has no upload button.

**Room Properties** has three **Background Layers**: **Behind everything**, **The room** and **Above player**. For each, **Upload** a picture (you then crop it to the room) or **Draw in Studio**. The same panel holds the room's name and description in both languages, a **Foreground Effect** and the **Room name tag**.

### To choose what a click does

Under **When clicked…**, build a list of steps. The character walks to the object, then the steps run in order. With no steps, the character just walks there.

1. Press **Add a step** and pick one: **Show this object's pop-up**, **Show another object's pop-up**, **Talk (dialogue box)**, **Go to a room**, **Open a link**, **Write an email**, **Download a file**, **Play an effect**, **Play a sound**, **Show / hide an object**, **Open the character creator** or **Wait**. (The Shop room's two collections use **Open the character creator**.)
2. Fill the step in. A link step can ask the visitor before leaving the site.
3. Reorder, duplicate or delete steps from each step's menu.
4. Choose how often the list runs: **Every time**, **Once per visit** or **Only the first time ever**.

Nearby in the same panel:

- **Edit pop-up** (or `Enter`) opens the [pop-up composer](#5-pop-ups) for the object.
- **When the player walks near…** runs a second list inside the **Radius**.
- **Hover** sets the mouse-over effect, with **Show name tag on hover** and **Starts hidden**. **Easter egg** adds a small surprise reaction.
- **Walk-To Point** is where the character stops: press **Pick** and click the floor, or right-click the object and choose **Set walk-to here**. Tick **Wall Mounted** for things on the back wall.
- **Add Hitbox** gives the object a custom clickable shape.

### Doors and entry points

A door sends the character to another room. An entry point is a named spot where the character arrives.

1. In the destination room, choose the **Entry** tool (`E`) and click the floor. Select the point to set its **ID** and **Direction**.
2. In the first room, add a **Door**, or set an object's **Kind** to **Door**.
3. In its **Go through this door** step, choose **Target Room** and **Target Entry Point**. Left at its default, the character arrives at the room's default spot.

Faint previews at each door show where it leads. The World map draws every door link and marks broken ones.

### The walkable area

1. Choose the **Walkable** tool (`W`). The area the character may walk in shows in green.
2. Drag a corner point to reshape it. Click a smaller point between two corners to add a corner.
3. Right-click a point to delete it (long-press on a touch screen). Keep at least three.

### Undo, checks and shortcuts

Undo history belongs to the open room and is cleared when you switch rooms. Deleting shows an **Undo** button in the message. **Preview** (`P`) opens a live preview where you can try clicks and hover effects. `Ctrl+K` lists every command; **Show issues panel** there opens **Issues** (broken doors, unsafe links, missing Arabic).

| Keys | Action |
| --- | --- |
| `S`, `W`, `H`, `E` | Select, Walkable, Hitbox and Entry tools |
| Hold `Space` | Pan the canvas |
| `A` / `L` / `D` / `P` / `G` | Add menu / Library / drawing studio / Preview / grid snap |
| `+`, `-`, `0`, `F` | Zoom in, zoom out, fit the room, frame the selected object |
| `Tab`, `Shift+Tab` | Select the next or previous object |
| Arrow keys | Nudge 1 pixel (`Shift`: 10) |
| `]` `[` `}` `{` | Forward, backward, to front, to back |
| `Enter` | Open the selected object's pop-up |
| `Delete` or `Backspace` | Delete the selection |
| `Ctrl+D` / `Ctrl+A` | Duplicate / select all |
| `Ctrl+Shift+L` | Lock or unlock the selection |
| `Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+S` | Save draft |
| `Ctrl+K` or `?` | Command list |
| `Esc` | Deselect, or return to the Select tool |

## 3. The World map

`/admin/editor/world` shows the rooms of one world as cards, with a line for each door link: green when it works, dashed red when it is broken. Room positions are not part of drafts. The toolbar says **Positions save instantly**: dragging a room changes the live map at once.

- **To arrange rooms:** drag a card. Arrow keys nudge the selected room.
- **To open a room:** double-click it, or select it and press **Open** (or `Enter`).
- **To add a room:** press **New room**, give it a **Slug** (lowercase letters, digits, `-` and `_`) and a **Display name**, and optionally a room to **Copy from**. A new room is live straight away.
- **To choose where visitors start:** select a room and press **Set as start**.
- **To rename a room's slug:** select it and press **Rename**. Doors leading to it are updated for you.
- **To remove a room:** select it and press **Delete**. It moves to **Recently deleted**. The start room of the live world cannot be deleted; set another start room first.

A world is a separate set of rooms, for example a seasonal version of the site. Visitors play exactly one: the live world.

- **To switch or create worlds:** use the world picker in the toolbar. **New world…** asks for **One room** (a single scene with no map) or **A world**.
- **To choose the live world:** open it and press **Make live**. It needs at least one room.
- **To delete a world:** press **Delete world**. The button is not offered for the live world or for the original `main` world.

The gear button opens the world's settings: name, **Default start room**, map **Layout** and whether room name tags show in the game.

## 4. Drafts, Publish, history and the trash

### Rooms: Save draft, then Publish

- **Save draft** (`Ctrl+S`) stores your changes privately, pop-up content included, for every room you edited. Visitors keep seeing the live room.
- **Publish** makes the open room's draft live, saving first if needed.
- The arrow beside **Publish** opens **Publish all rooms with drafts**, **Play the draft (new tab)** and **Discard draft of this room…**. Discarding deletes the draft for good and returns to the live room.
- If a room has a serious problem, such as a door with no target, saving or publishing lists the errors first. Cancel and fix them, or continue anyway.

**To play the draft:** **Play the draft (new tab)** opens `/admin/play`, the real game with each drafted room replaced by its draft, under the banner **Draft preview: visitors don't see these changes**. Only saved drafts are included, so save first, and press **Reload drafts** after saving again. The dashboard shows a play button beside each room with a draft.

**History:** the history button in the room toolbar lists earlier versions of the open room. **Auto History** keeps the last 20 saves. **Named Versions** stay until you delete them: press **+ Save current state as version** before a big change. **Load into draft** puts an old version into the editor; visitors see nothing until you save and publish it. History stores the room, not its pop-up content.

**If the page closes before you save:** the room and landing editors keep a copy of unsaved work in your browser. On your return a banner offers **Restore** or **Discard**. The copy lives on that device only.

### Trash and restore

Deleted rooms, worlds and landing pages go to **Recently deleted**, reachable from the dashboard and the World map toolbar. A delete also offers **Undo** straight away.

- **Restore** brings an item back. A restored page comes back offline.
- **Delete forever** removes it for good. Nothing is removed automatically.
- The trash does not touch stored files; see [Storage](#10-storage-and-security).

### The conflict warning

If the same room or page is open in two tabs of one browser, a banner says **This is also open in another tab. Saving in both will conflict.** Close one.

If a save finds the room was changed somewhere else after you opened it, nothing is overwritten silently. You choose **Keep both (recommended)** (your version goes into History as a named copy and the newer one loads), **Overwrite with mine** (the newer one is kept in History) or **Cancel**. Publishing over a changed live room asks the same way, with **Publish anyway**. Landing drafts offer **Save mine as a new draft (recommended)**, **Load theirs** or **Overwrite**; site settings offer a reload or an overwrite.

## 5. Pop-ups

A pop-up is the card that opens when a visitor clicks a room object or a landing page button. Both are built in the same composer.

- **To open it from a room:** select an object and press **Edit pop-up** (or `Enter`).
- **To open it from a landing page:** select an element, set **Role** to **Button (runs an action)** and **Action** to **Open a pop-up**, then press **Edit pop-up…**.

Edits go into the room or page you came from: they are saved when you save it and visible when you publish it.

### To build a pop-up

1. An empty pop-up offers presets: **Project**, **About me**, **CV**, **Gallery**, **Video showcase**, **Contact**, **Magazine** and **TV screen**. Pick one, or start with a single block.
2. Add blocks from the list on the left. They stack from top to bottom.
3. Click a block in the preview or the list to edit it on the right.
4. Reorder by dragging rows, or from each row's menu: **Move up**, **Move down**, **Duplicate**, **Delete**.
5. In the header, preview as a desktop or phone and in either language. The **Arabic** counter shows how many texts have both languages. The header also has undo, redo and a revert button.

**Content types:** Rich text, Heading, Image, Gallery, Button, Quote / testimonial, Links, Video (a YouTube or Vimeo link, or your own file), Sound, Screen, Reel, Social post, Project card, CV / timeline, File download, Contact, Divider and Spacer. Columns, Tabs and Accordion hold other blocks inside them.

**Pop-up settings** (top of the block list): **Title** in both languages; **Width on computers** (phones always show a card rising from the bottom); **Layout**, either **One scrolling sheet** or **Pages you flip (magazine)**; **Frame**; and **Presets**, where **Start from a preset…** replaces the blocks and **Save as preset…** keeps this pop-up as a preset of your own.

In a room, **Step through pop-ups** (in **Room Properties**) adds arrows so visitors move between the room's pop-ups without walking.

### Themes and frames

`/admin/popup-styles` holds two kinds of item, made with **New theme** and **New frame**.

- A **theme** dresses every pop-up: the panel, close button, title strip, page arrows and corner, and the dialogue box with its name plate, next mark and choice buttons. For each part choose **Draw** or **Upload**; an untouched part keeps the built-in look.
- A **frame** is a drawing one pop-up sits inside, such as a television. Draw it with a see-through hole for the screen, then press **Find the screen in my drawing** or place the box by hand. **On phones** chooses a plain card or keeping the frame.

1. Press **Save draft** while you work, then **Publish**.
2. A published frame appears in the **Frame** list of every pop-up's settings.
3. A published theme does nothing until you choose **Make this the active theme** in its **More** menu. One theme is active at a time; **Stop using this theme** returns to the built-in look.

**History** lists earlier published versions. Items cannot be deleted, only put away with **Archive**.

## 6. The landing page editor

`/admin/landing-editor` edits the public pages: **Sections** on the left, the page in the middle, the inspector on the right. The inspector shows page settings when nothing is selected, otherwise the selected section or element.

### Sections and elements

A page is a stack of sections; each is a canvas you place things on.

- **To add a section:** press the add button in the **Sections** panel. **Add a section** offers a **Blank canvas**, ready-made layouts and **My templates**.
- **To reorder, hide, copy or remove one:** drag its row, or use the row menu: **Move up**, **Move down**, **Hide from the live site**, **Duplicate section**, **Save as a reusable template**, **Delete section**.
- **To style one:** select it. **Background** sets surface, colour and art (**Upload image** or **Draw background**); **Layout & size** its height; **Visibility & schedule** hides it per device or outside a date range; **Animation** how it appears on scroll.

With a section selected, the bar above the page adds elements:

- **Text**: free text. Double-click it to type, or edit **Content (EN)** and **Content (AR)** in the inspector, with font, size, weight, colour and alignment.
- **Image**: pick from everything you uploaded or drew, or upload a file. **Shape** and **Grid** add empty picture frames.
- **Draw**: opens the drawing studio and adds the result.
- **Component**: a content block, such as Heading, Button, Carousel, Gallery, Accordion (FAQ), Tabs, Video embed, Social links, Form, Quote / testimonial, Feature list, Map or Newsletter signup.

Drag an element to move it and use its handles to resize and rotate. Arrow keys nudge (`Shift` for bigger steps). `Ctrl+D` duplicates, `Ctrl+C` and `Ctrl+V` copy and paste between sections and pages, `]` and `[` change the layer order, `Delete` removes, `Ctrl+Shift+L` locks. A picture at the bottom of a section that covers nearly all of it counts as the backdrop and is locked by default: select it in the section's layers list and press **Unlock**. To make an element clickable, open **Link & behaviour** and set its **Role**.

### The arcade hero and Screen UI

The arcade is the section that holds the game: a drawn machine with the live game inside, which visitors scroll past or click to play. Select it to open **The arcade scene**.

- **Canvas tool**: **Select** moves elements and the machine, **Screen** places the box where the game shows, **Frames** shows each camera view as a rectangle to drag.
- **Machine**: draw or upload the **Back layer (behind the screen)**, leaving a transparent hole for the game, and an optional **Front layer (over the screen)**. Choose the machine's shape before drawing.
- **Backdrop**: the room the machine stands in. **Draw backdrop** opens a canvas with a guide of what each screen size will see.
- **Screen art**: the "click to play" picture for each language and a poster shown while the game loads.
- **Camera**: the view before scrolling (**Rest framing**), the zoom while scrolling and the fly-in on **Click to play**. Desktop and phones have separate cameras.
- **Guardrails** only warn, for example when a phone view crops the machine.

**Screen UI**, in the same inspector, restyles four on-screen controls: the language switcher on every page, and the close, language and map buttons shown while playing. Pick a control, draw or upload **Art · English** and **Art · Arabic** (one alone serves both), and optionally pin it to a corner, separately for desktop and phones. Two hint texts for players are edited there too. The language switcher's art is site-wide and saved with **Save & go live**.

### Nav Studio

Open the navigation bar editor with **Nav** in the header or the dashboard card. It has a live preview and four tabs:

- **Behaviour**: the style (**Standard** text, **Hybrid** with some drawn pieces, or **Drawn**, one drawing for the whole bar) and what the bar does while scrolling.
- **Content**: logo, links (label in both languages, and where each goes) and an optional call-to-action button. For a drawn bar, **Place the clickable areas…** puts a box over each link in your drawing.
- **Look**: layout, sizes, font and colours. **Phone**: the phone menu and its drawings.

### Pages, versions and publishing

- **Pages:** the page picker in the header creates, renames, duplicates and deletes pages. A page lives at `/<slug>`; the home page is `/`. A new page is offline until published. Link to it from the Nav Studio or any button.
- **Versions:** each page has one live version and any number of drafts, switched in the version picker. **New draft** copies a version so you can rework a page without touching the live one.
- **Save** (`Ctrl+S`) changes only the open version. **Publish** makes the open draft live; the version it replaces stays as a draft. While editing the live version the button reads **Update live**. **Take page offline…** is in the version picker.
- **Checks** lists broken links, unlabelled buttons, missing translations and missing search details. Errors must be confirmed before a publish goes ahead.
- The history button keeps named snapshots and the last 20 saves of the open version. The eye button previews the page as visitors see it, unsaved changes included.

### Phone and desktop layouts

The **Device** switch in the header picks the layout you are editing. In **Mobile**, moving or resizing an element changes the phone layout only.

- A section can **Auto-stack on mobile**: elements line up in one column in the order of the desktop layout. To place one by hand, turn on **Free on phones (don't stack)** under **Visibility**.
- **Hide on mobile** and **Hide on desktop** exist for elements and sections.
- When elements overlap on phones, a notice offers **Auto-stack this section** or **Keep overlap**.

### Page and site settings

With nothing selected, **Search & sharing** sets the page's title, description and share image for search engines and link previews.

**Site settings** (the **Site** button, or the dashboard card) cover every page: **Maintenance / password page** (a holding page for visitors; you still see the real site while signed in), **Announcement bar**, **Fonts** (one for headings, one for text, each with an English and an Arabic choice; you can upload font files), **Interactions** (default hover effect), **Forms** (where submissions go; forms stay hidden from visitors until a destination is set, and the webhook option also needs a server variable from `app/.env.example`), **SEO defaults** and **Footer**.

Site settings and the Nav Studio are not part of page drafts: **Save & go live** changes them for visitors at once. Unsaved site-wide changes show as a **Site-wide changes** button in the header.

## 7. The drawing studio

The studio is an embedded copy of [Klecks](https://github.com/bitbof/klecks). The same one opens from every place that takes a drawing:

- **Rooms:** **Draw Sprite in Studio** on an object, **Draw in Studio** on a background layer, or `D` for a free drawing you can save to the library, drop in as an object or set as a layer.
- **Landing pages:** **Draw** above the page, **Edit in drawing studio** on an element, **Draw background** on a section, and the draw buttons in the arcade inspector and Nav Studio.
- **Elsewhere:** the draw button beside each part in pop-up styles, the loading screen and the room name tag; **Draw…** beside picture fields in pop-up blocks; **Draw a new one** in the wardrobe.

**Layers.** The studio has its own layers panel. Visitors get one flattened picture; your layers are stored alongside it, so opening the drawing again brings them back.

**Guide layers.** Many drawings open with a faint guide, such as the outline to draw inside or the starter body in the wardrobe.

- A guide is any layer whose name starts with `GUIDE`. It is never part of the saved picture, visible or hidden.
- **Guides** in the studio header shows and hides them. To add your own, rename a layer so its name starts with `GUIDE`.
- If the studio cannot leave a guide out, it refuses to save and says so, rather than baking the guide into your art.

**Pencil-only mode.** With **Pencil only** on, a finger moves and zooms the canvas and only the Apple Pencil (or a mouse) draws. It turns on by itself the first time a Pencil touches the screen; press the button to change it. The header also has brush size buttons and **Full screen**.

**Saving, autosave and restore.**

- Save with the button in the studio header. Its name says what it does, for example **Save & Replace**, **Add to section** or **Use this drawing**.
- While you draw, a copy is kept on your device a few seconds after each change; the header shows **Draft kept** and the time.
- If the page closes before you save, opening that drawing again asks **Restore your unsaved drawing?** Choose **Restore it** or **Start fresh**. The copy is on that device only and is cleared when you save.

The wardrobe wraps the studio in a simpler window: none of the header buttons above, no autosave, and layers are not kept (an edited item reopens as one flat layer). Save there with the studio's own **Submit** button.

## 8. The wardrobe and the character creator

`/admin/wardrobe` is the catalogue visitors dress their character from, grouped into **Body**, **Face**, **Hair**, **Outfit**, **Pants**, **Shoes** and **Extras**. There is no draft: changes apply when you save them.

- **To add an item:** in its group, press **Upload PNG**, or **Draw a new one** to draw over a faint guide of the starter body.
- **To edit an item:** set its English and Arabic names, tick **Tintable** if visitors may recolour it and **Enabled** if they may pick it, then press **Save** on the card. The pencil button reopens the picture in the studio.
- **To remove an item:** press the bin button. This is permanent and skips the trash.

Visitors open the creator with the **Character** button in the game. They pick an item in each category, choose a colour from a fixed set where one is offered, preview the character with **Stand**, **Walk** and **Turn**, and press **Save & Play**. The outfit is remembered in their own browser.

## 9. The loading screen

`/admin/loading-screen` sets the animation shown while the site loads. The preview beside the settings switches between desktop and phone and between languages; leave it on **Loop** or press **Play the intro**.

1. Turn **Show a loading screen** on or off.
2. Under **Animation**, pick **Spinner**, **Hop**, **Being drawn**, **Flipbook**, **Orbit** or **The book**.
3. Under **Your drawings**, draw or upload each spot. An empty spot shows a doodle placeholder.
4. Under **Words**, write the caption in English and Arabic.
5. Adjust **Look**, **Progress** and **Opening onto the site**. Under **When**, choose every visit or once per visit, the home page or every page, and a minimum time.
6. Press **Save & go live** (`Ctrl+S`). There is no draft: visitors see the change at once.

## 10. Storage and security

**To clean up storage:** `/admin/storage` shows how much space your files use and which ones nothing uses any more, such as drawings you replaced.

1. Open the page and wait for the scan.
2. Under **Unused files**, tick files or press **Select all**.
3. Press **Delete selected** and confirm. This cannot be undone.

A file counts as unused only when no room, page, version, backup, draft, template or deleted item mentions it. Files from the last 48 hours are never listed, and nothing is deleted automatically.

**To turn on two-factor sign-in:** go to `/admin/security`.

1. Type a name for the device, press **Set up two-factor** and scan the code with an authenticator app.
2. Type the 6-digit code the app shows and press **Turn on**.
3. Press **Add another authenticator** and repeat on a second device.

From then on, signing in asks for a code after your password. There are no recovery codes: if you lose your only authenticator, getting back in is a job on the server, described in [ops/ACCOUNT_RECOVERY.md](ops/ACCOUNT_RECOVERY.md). That is why you enrol two devices. The same page has **Change password**.

## 11. Two languages, and working on an iPad

### English and Arabic

Visitors switch language with the language button on the site. Every text a visitor can read has an English field and an Arabic field. That covers:

- Room names and descriptions, object labels, dialogue lines and answers, speech bubbles.
- Pop-up titles and every text inside pop-up blocks.
- Landing page text, button labels, page titles and descriptions, navigation links, the footer, the announcement bar and the maintenance message.
- The loading screen caption and wardrobe item names.
- Drawn words: the "click to play" art, the Screen UI buttons and the navigation drawings each take a separate Arabic drawing.

To check, switch the preview language in the landing editor, the Nav Studio, the pop-up composer, the loading screen editor or the draft player. The composer's **Arabic** counter, the landing editor's **Checks** and the room editor's **Issues** list texts with one language missing. These are warnings and never stop a publish.

Right-to-left is handled for you. In Arabic, pages, pop-ups and the game's buttons flip to a right-to-left layout, pop-up arrows and magazine pages swap sides, and the room name tag moves to the other corner. Arabic text uses the Arabic font chosen in **Site settings**. You do not build a second layout.

### On an iPad

The admin switches to touch mode by itself on a touch screen. Buttons grow, and everything a mouse does by right-click, hover or shortcut has a touch equivalent. A desktop with a mouse is unaffected.

- **Select and move:** tap to select, then drag the selected item. Dragging something unselected scrolls or pans instead.
- **Zoom:** pinch with two fingers. The landing editor also shows zoom buttons above the page.
- **Menus:** a long press opens what a right-click would, and shows a button's tooltip.
- **Room editor:** a bar over the canvas offers **Content**, **Duplicate**, **Delete** and a menu for the rest. Less-used toolbar buttons move into **More tools**.
- **Panels:** in portrait, side panels become drawers opened with a button. In landscape, buttons hide and show them.
- **Drawing:** the studio opens edge to edge, and **Pencil only** keeps fingers and palm from drawing.

## 12. Replacing the starter content

A sensible order for making the site yours:

1. **Secure the account:** enrol two-factor on two devices at `/admin/security`.
2. **Hide the work:** if the site is already public, turn on the **Maintenance** switch on the dashboard.
3. **Site settings and navigation:** set the site name, fonts and footer, then your logo and links in the Nav Studio.
4. **Home page:** replace the arcade machine and backdrop, rework or delete the starter sections, and fill in **Search & sharing**.
5. **Other pages:** add the pages you need and link them from the navigation.
6. **Rooms:** for each room, draw the background layers, replace or remove the starter objects and write their pop-ups. Check doors and the walkable area.
7. **World map:** delete rooms you do not want, arrange the rest and set the start room.
8. **Pop-up look:** draw a theme and make it active; add frames if you want them.
9. **Character and loading screen:** replace the wardrobe items; pick a loading animation and draw its art.
10. **Arabic and phones:** switch the previews to Arabic, clear the warnings in **Checks** and **Issues**, and check each page in **Mobile**.
11. **Publish:** publish every room and page, play the result as a visitor, then turn maintenance off.
12. **Clean up:** a couple of days later, delete unused files at `/admin/storage`.

For how the pieces work underneath, see [ARCHITECTURE.md](ARCHITECTURE.md).
