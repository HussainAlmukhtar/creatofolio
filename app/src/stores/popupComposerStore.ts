// Pop-up composer store — the working copy of ONE pop-up while the composer is
// open (components/popup-editor/PopupComposer.tsx). Undo/redo via zundo covers
// the content only (selection, page, device and preview language are UI state).
//
// Gotchas handled here (both bit the landing store before):
// - `equality` compares the content reference, so UI-only set() calls (select
//   a block, switch device) never become no-op Undo steps;
// - `settle()` clears history once the composer has hydrated, so the first
//   Undo never just "undoes" loading the pop-up.
// Typing bursts are grouped: one Undo step per pause (see handleSet).
//
// Blocks live in a sheet, on pages (pages layout) or in a container's slots
// (one level); data/popupTree.ts addresses all three.

import { create } from "zustand";
import { temporal } from "zundo";
import type { ObjectContent, PopupPage } from "@/data/contentTypes";
import { CURRENT_CONTENT_VERSION } from "@/data/contentTypes";
import type { ContentBlock } from "@/data/landingTypes";
import { makeBlock } from "@/components/landing/blocks/registry";
import type { PresetBody } from "@/lib/popupPresets";
import { CONTAINER_BLOCK_TYPES } from "@/components/popup/blocks/popupBlockDefs";
import { newIid } from "@/lib/iid";
import { listAt, locate, slotsOf, updateBlock, withListAt, type ListLoc } from "@/data/popupTree";

/** Which blocks the composer offers, in palette order. */
export const POPUP_PALETTE = [
  "rich-text",
  "heading",
  "image",
  "gallery",
  "button",
  "quote",
  "links",
  "video",
  "audio",
  "screen",
  "reel",
  "platform-embed",
  "project-card",
  "cv-timeline",
  "file-download",
  "contact",
  "columns",
  "tab-set",
  "accordion-set",
  "divider",
  "spacer",
];

/** What may go inside a container slot (no containers in containers). */
export const SLOT_PALETTE = POPUP_PALETTE.filter((t) => !CONTAINER_BLOCK_TYPES.includes(t));

/** Undo steps closer together than this merge into one (typing). */
const GROUP_MS = 700;

export type ComposerSelection = string | "settings" | null;

interface ComposerState {
  content: ObjectContent | null;
  selected: ComposerSelection;
  /** Pages layout: the page being edited (and previewed). */
  page: string | null;
  device: "desktop" | "phone";
  previewLang: "en" | "ar";

  init: (content: ObjectContent) => void;
  settle: () => void;
  setMeta: (partial: Partial<Pick<ObjectContent, "title" | "titleAr" | "size" | "frameIid">>) => void;
  /** Add a block after `afterId` (in that block's list), or at the end of
   *  `into` (a container slot), else at the end of the current page/sheet. */
  addBlock: (type: string, opts?: { afterId?: string | null; into?: ListLoc }) => string | null;
  updateBlockProps: (id: string, partial: Record<string, unknown>) => void;
  /** Move within the block's own list. */
  moveBlock: (id: string, toIndex: number) => void;
  duplicateBlock: (id: string) => void;
  removeBlock: (id: string) => void;
  select: (sel: ComposerSelection) => void;
  setDevice: (d: "desktop" | "phone") => void;
  setPreviewLang: (l: "en" | "ar") => void;

  // Pages (magazine)
  setLayout: (layout: "sheet" | "pages") => void;
  setPage: (id: string) => void;
  addPage: (kind: PopupPage["kind"]) => void;
  movePage: (id: string, dir: -1 | 1) => void;
  duplicatePage: (id: string) => void;
  removePage: (id: string) => void;

  /** Replace the pop-up's body with a preset's (one undo step; fresh ids;
   *  the title is taken only while the pop-up has none). */
  applyPreset: (body: PresetBody) => void;
}

function normalized(c: ObjectContent): ObjectContent {
  return { ...c, type: "blocks", contentVersion: CURRENT_CONTENT_VERSION, layout: c.layout ?? "sheet" };
}

/** Give a copied block (its array items, slots and slot children) fresh ids. */
export function cloneBlock(b: ContentBlock): ContentBlock {
  const props = structuredClone(b.props);
  for (const [k, v] of Object.entries(props)) {
    if (!Array.isArray(v)) continue;
    props[k] = v.map((it) => {
      if (!it || typeof it !== "object" || !("id" in it)) return it;
      const copy = { ...it, id: newIid() } as Record<string, unknown>;
      if (k === "slots" && Array.isArray(copy.blocks)) {
        copy.blocks = (copy.blocks as ContentBlock[]).map(cloneBlock);
      }
      return copy;
    });
  }
  return { id: newIid(), type: b.type, props };
}

/** Pages keep cover first and back cover last. */
function ordered(pages: PopupPage[]): PopupPage[] {
  return [
    ...pages.filter((p) => p.kind === "cover"),
    ...pages.filter((p) => p.kind === "page"),
    ...pages.filter((p) => p.kind === "back"),
  ];
}

const isContainerType = (t: string) => CONTAINER_BLOCK_TYPES.includes(t);

export const usePopupComposerStore = create<ComposerState>()(
  temporal(
    (set, get) => ({
      content: null,
      selected: null,
      page: null,
      device: "desktop",
      previewLang: "en",

      init: (content) => {
        const page = content.layout === "pages" ? (content.pages?.[0]?.id ?? null) : null;
        const first = content.layout === "pages" ? content.pages?.[0]?.blocks[0] : content.blocks?.[0];
        set({ content, page, selected: first?.id ?? "settings" });
        clearHistory();
      },
      settle: () => clearHistory(),

      setMeta: (partial) => {
        const c = get().content;
        if (c) set({ content: { ...c, ...partial } });
      },

      addBlock: (type, opts) => {
        const c = get().content;
        const block = makeBlock(type);
        if (!c || !block) return null;
        const root: ListLoc = { page: get().page };
        let loc: ListLoc = root;
        let at = -1;
        if (opts?.into) {
          loc = opts.into;
        } else if (opts?.afterId) {
          const found = locate(c, opts.afterId);
          if (found) {
            loc = found.loc;
            at = found.index + 1;
            // A container never goes inside another one: add it after the
            // container instead.
            if (loc.parent && isContainerType(type)) {
              const parent = locate(c, loc.parent);
              loc = parent?.loc ?? root;
              at = (parent?.index ?? -2) + 1;
            }
          }
        }
        if (loc.parent && isContainerType(type)) return null;
        const list = [...listAt(c, loc)];
        list.splice(at < 0 || at > list.length ? list.length : at, 0, block);
        set({ content: normalized(withListAt(c, loc, list)), selected: block.id });
        return block.id;
      },

      updateBlockProps: (id, partial) => {
        const c = get().content;
        if (!c) return;
        set({ content: normalized(updateBlock(c, id, (b) => ({ ...b, props: { ...b.props, ...partial } }))) });
      },

      moveBlock: (id, toIndex) => {
        const c = get().content;
        const found = c && locate(c, id);
        if (!c || !found) return;
        const list = [...listAt(c, found.loc)];
        const to = Math.max(0, Math.min(list.length - 1, toIndex));
        if (found.index === to) return;
        const [b] = list.splice(found.index, 1);
        list.splice(to, 0, b);
        set({ content: normalized(withListAt(c, found.loc, list)) });
      },

      duplicateBlock: (id) => {
        const c = get().content;
        const found = c && locate(c, id);
        if (!c || !found) return;
        const list = [...listAt(c, found.loc)];
        const copy = cloneBlock(found.block);
        list.splice(found.index + 1, 0, copy);
        set({ content: normalized(withListAt(c, found.loc, list)), selected: copy.id });
      },

      removeBlock: (id) => {
        const c = get().content;
        const found = c && locate(c, id);
        if (!c || !found) return;
        const list = listAt(c, found.loc);
        const next = list.filter((b) => b.id !== id);
        // Selection falls to a neighbour, else the parent container, else settings.
        const fallback = next[Math.min(found.index, next.length - 1)]?.id ?? found.loc.parent ?? "settings";
        const sel = get().selected;
        const removedSelected = sel === id || (slotsOf(found.block) ?? []).some((s) => s.blocks.some((b) => b.id === sel));
        set({
          content: normalized(withListAt(c, found.loc, next)),
          selected: removedSelected ? fallback : sel,
        });
      },

      select: (selected) => {
        const c = get().content;
        // Selecting a block on another page shows that page.
        if (c && selected && selected !== "settings" && c.layout === "pages") {
          const found = locate(c, selected);
          if (found?.loc.page && found.loc.page !== get().page) {
            set({ selected, page: found.loc.page });
            return;
          }
        }
        set({ selected });
      },
      setDevice: (device) => set({ device }),
      setPreviewLang: (previewLang) => set({ previewLang }),

      // ─── Pages ───
      setLayout: (layout) => {
        const c = get().content;
        if (!c || (c.layout ?? "sheet") === layout) return;
        if (layout === "pages") {
          // The sheet's blocks become page 1.
          const first: PopupPage = { id: newIid(), kind: "page", blocks: c.blocks ?? [] };
          set({ content: normalized({ ...c, layout: "pages", pages: [first], blocks: [] }), page: first.id });
        } else {
          // Every page's blocks, in order, become the sheet.
          const blocks = (c.pages ?? []).flatMap((p) => p.blocks);
          set({ content: normalized({ ...c, layout: "sheet", blocks, pages: undefined }), page: null });
        }
      },
      setPage: (page) => {
        // Keep the inspector on something that's on the page being shown.
        const c = get().content;
        const sel = get().selected;
        const on = c && sel && sel !== "settings" ? locate(c, sel)?.loc.page === page : true;
        set({ page, selected: on ? sel : "settings" });
      },
      addPage: (kind) => {
        const c = get().content;
        if (!c || c.layout !== "pages") return;
        const pages = c.pages ?? [];
        if (kind !== "page" && pages.some((p) => p.kind === kind)) return;
        const fresh: PopupPage = { id: newIid(), kind, blocks: [] };
        let next: PopupPage[];
        if (kind === "page") {
          // After the page being edited (a cover → first inner page).
          const i = pages.findIndex((p) => p.id === get().page);
          next = [...pages];
          next.splice(i < 0 ? pages.length : i + 1, 0, fresh);
        } else next = [...pages, fresh];
        set({ content: normalized({ ...c, pages: ordered(next) }), page: fresh.id, selected: "settings" });
      },
      movePage: (id, dir) => {
        const c = get().content;
        if (!c || c.layout !== "pages") return;
        const pages = [...(c.pages ?? [])];
        const i = pages.findIndex((p) => p.id === id);
        const j = i + dir;
        // Only inner pages move, and only among inner pages.
        if (i < 0 || j < 0 || j >= pages.length || pages[i].kind !== "page" || pages[j].kind !== "page") return;
        [pages[i], pages[j]] = [pages[j], pages[i]];
        set({ content: normalized({ ...c, pages }) });
      },
      duplicatePage: (id) => {
        const c = get().content;
        if (!c || c.layout !== "pages") return;
        const pages = [...(c.pages ?? [])];
        const i = pages.findIndex((p) => p.id === id);
        if (i < 0) return;
        const copy: PopupPage = { id: newIid(), kind: "page", blocks: pages[i].blocks.map(cloneBlock) };
        pages.splice(i + 1, 0, copy);
        set({ content: normalized({ ...c, pages: ordered(pages) }), page: copy.id });
      },
      applyPreset: (body) => {
        const c = get().content;
        if (!c) return;
        const pages =
          body.layout === "pages"
            ? (body.pages ?? []).map((p) => ({ ...p, id: newIid(), blocks: p.blocks.map(cloneBlock) }))
            : undefined;
        const next: ObjectContent = normalized({
          ...c,
          layout: body.layout ?? "sheet",
          blocks: (body.blocks ?? []).map(cloneBlock),
          pages,
          size: body.size ?? c.size,
          frameIid: body.frameIid ?? c.frameIid,
          title: c.title || body.title || "",
          titleAr: c.titleAr || body.titleAr || "",
        });
        const first = pages ? pages[0]?.blocks[0] : next.blocks?.[0];
        set({ content: next, page: pages?.[0]?.id ?? null, selected: first?.id ?? "settings" });
      },

      removePage: (id) => {
        const c = get().content;
        if (!c || c.layout !== "pages") return;
        const pages = c.pages ?? [];
        if (pages.length <= 1) return;
        const i = pages.findIndex((p) => p.id === id);
        const next = pages.filter((p) => p.id !== id);
        set({
          content: normalized({ ...c, pages: next }),
          page: get().page === id ? next[Math.max(0, i - 1)].id : get().page,
          selected: "settings",
        });
      },
    }),
    {
      limit: 100,
      partialize: (s) => ({ content: s.content }),
      equality: (past, current) => past.content === current.content,
      // Group rapid edits (typing) into one step: record the state from before
      // a burst, skip the rest until a pause.
      handleSet: (handleSet) => {
        let last = 0;
        return (...args: Parameters<typeof handleSet>) => {
          const now = Date.now();
          if (now - last > GROUP_MS) handleSet(...args);
          last = now;
        };
      },
    }
  )
);

function clearHistory(): void {
  usePopupComposerStore.temporal.getState().clear();
}
