// Pop-up block tree helpers (pure, no React).
//
// A v2 pop-up keeps its blocks in up to three places:
//   - `content.blocks`                       sheet layout
//   - `content.pages[i].blocks`              pages (magazine) layout
//   - `block.props.slots[j].blocks`          container blocks (columns, tabs,
//                                            accordion), ONE level deep
//
// A `ListLoc` names one of those lists so the composer store can add, move and
// remove blocks without caring where the list lives.

import type { ObjectContent, PopupPage } from "./contentTypes";
import type { ContentBlock } from "./landingTypes";

/** A container slot (column, tab, accordion row). */
export interface BlockSlot {
  id: string;
  label?: { en: string; ar: string };
  blocks: ContentBlock[];
}

/** Where a list of blocks lives: a page (pages layout) or the sheet, and
 *  optionally a container slot inside it. */
export interface ListLoc {
  page?: string | null;
  parent?: string | null;
  slot?: string | null;
}

/** Shared empty list: selectors reading listAt() must get a stable value. */
const EMPTY: ContentBlock[] = [];

/** Container blocks hold `props.slots`. */
export function slotsOf(b: ContentBlock | undefined | null): BlockSlot[] | null {
  const s = b?.props?.slots;
  return Array.isArray(s) ? (s as BlockSlot[]) : null;
}

export function isContainer(b: ContentBlock | undefined | null): boolean {
  return slotsOf(b) !== null;
}

/** The top-level list for a page (or the sheet). */
function rootBlocks(c: ObjectContent, page?: string | null): ContentBlock[] {
  if (c.layout === "pages") return c.pages?.find((p) => p.id === page)?.blocks ?? c.pages?.[0]?.blocks ?? EMPTY;
  return c.blocks ?? EMPTY;
}

function withRoot(c: ObjectContent, page: string | null | undefined, blocks: ContentBlock[]): ObjectContent {
  if (c.layout === "pages") {
    const pages = c.pages ?? [];
    const target = pages.find((p) => p.id === page) ?? pages[0];
    if (!target) return c;
    return { ...c, pages: pages.map((p) => (p === target ? { ...p, blocks } : p)) };
  }
  return { ...c, blocks };
}

/** The blocks at `loc` ([] when it doesn't exist). */
export function listAt(c: ObjectContent, loc: ListLoc): ContentBlock[] {
  const root = rootBlocks(c, loc.page);
  if (!loc.parent) return root;
  const parent = root.find((b) => b.id === loc.parent);
  return slotsOf(parent)?.find((s) => s.id === loc.slot)?.blocks ?? EMPTY;
}

/** Replace the blocks at `loc`. */
export function withListAt(c: ObjectContent, loc: ListLoc, blocks: ContentBlock[]): ObjectContent {
  const root = rootBlocks(c, loc.page);
  if (!loc.parent) return withRoot(c, loc.page, blocks);
  const next = root.map((b) => {
    if (b.id !== loc.parent) return b;
    const slots = (slotsOf(b) ?? []).map((s) => (s.id === loc.slot ? { ...s, blocks } : s));
    return { ...b, props: { ...b.props, slots } };
  });
  return withRoot(c, loc.page, next);
}

/** Every block of the pop-up (all pages, containers and their children). */
export function allBlocks(c: ObjectContent | null | undefined): ContentBlock[] {
  if (!c) return [];
  const roots = c.layout === "pages" ? (c.pages ?? []).flatMap((p) => p.blocks) : (c.blocks ?? []);
  return roots.flatMap((b) => [b, ...(slotsOf(b) ?? []).flatMap((s) => s.blocks)]);
}

/** Find a block anywhere, with the list it sits in. */
export function locate(c: ObjectContent, id: string): { block: ContentBlock; loc: ListLoc; index: number } | null {
  const pages: (PopupPage | null)[] = c.layout === "pages" ? (c.pages ?? []) : [null];
  for (const p of pages) {
    const root = p ? p.blocks : (c.blocks ?? []);
    for (let i = 0; i < root.length; i++) {
      const b = root[i];
      if (b.id === id) return { block: b, loc: { page: p?.id ?? null }, index: i };
      for (const s of slotsOf(b) ?? []) {
        const j = s.blocks.findIndex((x) => x.id === id);
        if (j !== -1) return { block: s.blocks[j], loc: { page: p?.id ?? null, parent: b.id, slot: s.id }, index: j };
      }
    }
  }
  return null;
}

/** Apply `fn` to the block with `id`, wherever it is. */
export function updateBlock(c: ObjectContent, id: string, fn: (b: ContentBlock) => ContentBlock): ObjectContent {
  const at = locate(c, id);
  if (!at) return c;
  const list = listAt(c, at.loc);
  return withListAt(c, at.loc, list.map((b) => (b.id === id ? fn(b) : b)));
}
