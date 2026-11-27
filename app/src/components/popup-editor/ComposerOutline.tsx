"use client";

// ComposerOutline — the pop-up's blocks as a list: select, add, reorder,
// duplicate, delete. Desktop: drag a top-level row by its grip. Touch (and
// blocks inside containers): every action is in the row's ⋯ menu (incl. Move
// up / Move down), no hover needed.
//
// Pages layout: a page strip on top (cover / pages / back cover; add,
// reorder, duplicate, delete); the list below shows the page being edited.
// Container blocks (columns, tabs, accordion) list their slots underneath,
// each with its own blocks and an "Add" button.

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Copy,
  GripVertical,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { getBlockDef } from "@/components/landing/blocks/registry";
import { BlockPalette } from "@/components/landing-editor/BlockPalette";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PresetGrid } from "./PresetPicker";
import { L } from "@/components/landing/blocks/shared";
import { ownProps, translationState, walkLocalized } from "@/lib/localizedChecks";
import { POPUP_PALETTE, SLOT_PALETTE, usePopupComposerStore } from "@/stores/popupComposerStore";
import { listAt, slotsOf, type ListLoc } from "@/data/popupTree";
import type { ContentBlock } from "@/data/landingTypes";
import type { PopupPage } from "@/data/contentTypes";

/** A short line of the block's own text, for recognising it in the list. */
function summary(b: ContentBlock): string {
  let out = "";
  walkLocalized(ownProps(b.props), [], ({ en, ar }) => {
    if (!out) out = (en || ar).trim();
  });
  return out.length > 48 ? `${out.slice(0, 45)}…` : out;
}

/** Stable empty list (a fresh [] per selector call would loop renders). */
const NO_BLOCKS: ContentBlock[] = [];
const NO_PAGES: PopupPage[] = [];

const STARTERS: { type: string; label: string }[] = [
  { type: "rich-text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "video", label: "Video" },
  { type: "project-card", label: "Project" },
  { type: "links", label: "Links" },
  { type: "contact", label: "Contact" },
];

const SLOT_NOUN: Record<string, string> = { columns: "Column", "tab-set": "Tab", "accordion-set": "Row" };

function pageLabel(p: PopupPage, pages: PopupPage[]): string {
  if (p.kind === "cover") return "Cover";
  if (p.kind === "back") return "Back cover";
  return `Page ${pages.filter((x) => x.kind === "page").indexOf(p) + 1}`;
}

export function ComposerOutline({
  onPicked,
  onSelectedRow,
}: {
  /** A block was added (drawer layouts jump to its settings). */
  onPicked?: () => void;
  onSelectedRow?: () => void;
}) {
  const layout = usePopupComposerStore((s) => s.content?.layout ?? "sheet");
  const pages = usePopupComposerStore((s) => (s.content?.layout === "pages" ? (s.content.pages ?? NO_PAGES) : NO_PAGES));
  const page = usePopupComposerStore((s) => s.page);
  const blocks = usePopupComposerStore((s) => (s.content ? listAt(s.content, { page: s.page }) : NO_BLOCKS));
  const selected = usePopupComposerStore((s) => s.selected);
  const { select, addBlock } = usePopupComposerStore.getState();
  // Where "Add block" puts the new block: after the selection, or into a slot.
  const [palette, setPalette] = useState<{ into?: ListLoc } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const add = (type: string) => {
    if (palette?.into) addBlock(type, { into: palette.into });
    else addBlock(type, { afterId: selected && selected !== "settings" ? selected : null });
    onPicked?.();
  };
  const curPage = pages.find((p) => p.id === page) ?? pages[0];

  return (
    <div className="flex flex-col gap-1 p-2">
      <button
        type="button"
        onClick={() => {
          select("settings");
          onSelectedRow?.();
        }}
        className={`flex items-center gap-2 rounded-md px-2 py-2 text-start text-sm ${
          selected === "settings" ? "bg-neutral-700/80 text-foreground" : "text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        <Settings2 className="size-4 shrink-0 opacity-70" />
        <span className="font-medium">Pop-up settings</span>
      </button>

      {layout === "pages" && <PageStrip pages={pages} current={curPage?.id ?? null} />}

      <p className="mt-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {layout === "pages" && curPage ? `Blocks on ${pageLabel(curPage, pages).toLowerCase()}` : "Blocks"}
      </p>

      {/* A brand-new pop-up: start from a preset. */}
      {layout === "sheet" && blocks.length === 0 && (
        <div className="space-y-2 rounded-lg border border-neutral-700 p-2">
          <p className="px-1 text-xs font-medium text-neutral-200">Start from a preset</p>
          <PresetGrid
            compact
            onPick={(body, name) => {
              usePopupComposerStore.getState().applyPreset(body);
              onPicked?.();
              toast(`Started from “${name}”`, {
                action: { label: "Undo", onClick: () => usePopupComposerStore.temporal.getState().undo() },
              });
            }}
          />
        </div>
      )}

      {blocks.length === 0 && (
        <div className="space-y-2 rounded-lg border border-dashed border-neutral-700 p-3 text-center">
          <p className="text-xs text-muted-foreground">{layout === "pages" ? "Empty page. Start with:" : "Or a single block:"}</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {STARTERS.map((st) => (
              <button
                key={st.type}
                type="button"
                onClick={() => {
                  addBlock(st.type);
                  onPicked?.();
                }}
                className="rounded-md bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-0.5" onDragOver={(e) => dragId && e.preventDefault()}>
        {blocks.map((b, i) => (
          <li
            key={b.id}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) usePopupComposerStore.getState().moveBlock(dragId, i);
              setDragId(null);
              setOverIndex(null);
            }}
            className={overIndex === i && dragId && dragId !== b.id ? "rounded-md ring-1 ring-blue-500" : ""}
          >
            <BlockRow
              block={b}
              index={i}
              count={blocks.length}
              depth={0}
              onSelectedRow={onSelectedRow}
              drag={{
                start: () => setDragId(b.id),
                end: () => {
                  setDragId(null);
                  setOverIndex(null);
                },
              }}
            />
            {slotsOf(b) && (
              <SlotList
                block={b}
                page={curPage?.id ?? null}
                onAdd={(into) => setPalette({ into })}
                onSelectedRow={onSelectedRow}
              />
            )}
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setPalette({})}
        className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-700 py-2 text-sm text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
      >
        <Plus className="size-4" /> Add block
      </button>

      <BlockPalette
        open={palette !== null}
        onOpenChange={(o) => !o && setPalette(null)}
        onPick={add}
        surface="popup"
        only={palette?.into ? SLOT_PALETTE : POPUP_PALETTE}
        title={palette?.into ? "Add a block inside" : "Add a block"}
        description={
          palette?.into
            ? "It goes at the end of this column / tab / row."
            : "Blocks stack top to bottom in the pop-up. It goes below the selected block; set it up on the right."
        }
      />
    </div>
  );
}

/** One block row: select, ⋯ menu (move/duplicate/delete), drag grip at top level. */
function BlockRow({
  block: b,
  index: i,
  count,
  depth,
  onSelectedRow,
  drag,
}: {
  block: ContentBlock;
  index: number;
  count: number;
  depth: 0 | 1;
  onSelectedRow?: () => void;
  drag?: { start: () => void; end: () => void };
}) {
  const selected = usePopupComposerStore((s) => s.selected);
  const { select, moveBlock, duplicateBlock, removeBlock } = usePopupComposerStore.getState();
  const def = getBlockDef(b.type);
  const Icon = def?.icon;
  const tr = translationState(ownProps(b.props));
  const isSel = selected === b.id;
  const text = summary(b);

  const remove = () => {
    removeBlock(b.id);
    toast(`${def?.label ?? "Block"} deleted`, {
      action: { label: "Undo", onClick: () => usePopupComposerStore.temporal.getState().undo() },
    });
  };

  return (
    <div
      className={`group relative flex items-center gap-1 rounded-md pe-1 ${depth ? "ms-5" : ""} ${
        isSel ? "bg-neutral-700/80" : "hover:bg-neutral-800"
      }`}
    >
      {drag ? (
        <span
          draggable
          onDragStart={(e) => {
            drag.start();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", b.id);
          }}
          onDragEnd={drag.end}
          title="Drag to reorder"
          className="grid w-5 cursor-grab place-items-center self-stretch text-neutral-500 touch:hidden"
        >
          <GripVertical className="size-3.5" />
        </span>
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => {
          select(b.id);
          onSelectedRow?.();
        }}
        aria-current={isSel || undefined}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start touch:ps-2"
      >
        {Icon && <Icon className="size-4 shrink-0 opacity-70" />}
        <span className="min-w-0">
          <span className="block truncate text-sm">{def?.label ?? b.type}</span>
          {text && <span className="block truncate text-[11px] text-muted-foreground">{text}</span>}
        </span>
      </button>
      {tr === "half" && (
        <span
          className="size-2 shrink-0 rounded-full bg-amber-400"
          title="Half-translated: one language is missing somewhere in this block"
          aria-label="Half-translated"
        />
      )}
      <OverflowMenu
        label={`${def?.label ?? "Block"} actions`}
        triggerClassName="grid size-7 place-items-center rounded-md text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 touch:opacity-100"
        align="end"
        items={[
          { label: "Move up", icon: ArrowUp, disabled: i === 0, onSelect: () => moveBlock(b.id, i - 1) },
          { label: "Move down", icon: ArrowDown, disabled: i === count - 1, onSelect: () => moveBlock(b.id, i + 1) },
          { label: "Duplicate", icon: Copy, onSelect: () => duplicateBlock(b.id) },
          { kind: "separator" },
          { label: "Delete", icon: Trash2, danger: true, onSelect: remove },
        ]}
      />
    </div>
  );
}

/** A container's slots, each with its child blocks and an Add button. */
function SlotList({
  block,
  page,
  onAdd,
  onSelectedRow,
}: {
  block: ContentBlock;
  page: string | null;
  onAdd: (into: ListLoc) => void;
  onSelectedRow?: () => void;
}) {
  const noun = SLOT_NOUN[block.type] ?? "Slot";
  return (
    <div className="mb-1 ms-4 border-s border-neutral-800 ps-1">
      {(slotsOf(block) ?? []).map((s, si) => (
        <div key={s.id} className="py-0.5">
          <div className="flex items-center gap-1 ps-2">
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
              {noun} {si + 1}
              {L(s.label, "en") && block.type !== "columns" ? ` · ${L(s.label, "en")}` : ""}
            </span>
            <button
              type="button"
              onClick={() => onAdd({ page, parent: block.id, slot: s.id })}
              title={`Add a block to ${noun.toLowerCase()} ${si + 1}`}
              aria-label={`Add a block to ${noun.toLowerCase()} ${si + 1}`}
              className="grid size-6 place-items-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-foreground touch:size-9"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {s.blocks.map((child, ci) => (
            <BlockRow
              key={child.id}
              block={child}
              index={ci}
              count={s.blocks.length}
              depth={1}
              onSelectedRow={onSelectedRow}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Pages layout: cover / pages / back cover chips with their own actions. */
function PageStrip({ pages, current }: { pages: PopupPage[]; current: string | null }) {
  const { setPage, addPage, movePage, duplicatePage, removePage } = usePopupComposerStore.getState();
  const hasCover = pages.some((p) => p.kind === "cover");
  const hasBack = pages.some((p) => p.kind === "back");
  const inner = pages.filter((p) => p.kind === "page");
  return (
    <div className="mt-2 space-y-1.5">
      <p className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BookOpen className="size-3.5" /> Pages
      </p>
      <ol className="flex flex-col gap-0.5">
        {pages.map((p) => {
          const on = p.id === current;
          const ii = inner.indexOf(p);
          return (
            <li
              key={p.id}
              className={`group flex items-center gap-1 rounded-md pe-1 ${on ? "bg-neutral-700/80" : "hover:bg-neutral-800"}`}
            >
              <button
                type="button"
                onClick={() => setPage(p.id)}
                aria-current={on || undefined}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-start text-sm"
              >
                <span className="truncate">{pageLabel(p, pages)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {p.blocks.length} block{p.blocks.length === 1 ? "" : "s"}
                </span>
              </button>
              <OverflowMenu
                label={`${pageLabel(p, pages)} actions`}
                triggerClassName="grid size-7 place-items-center rounded-md text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 touch:opacity-100"
                align="end"
                items={[
                  ...(p.kind === "page"
                    ? [
                        { label: "Move up", icon: ArrowUp, disabled: ii <= 0, onSelect: () => movePage(p.id, -1) },
                        {
                          label: "Move down",
                          icon: ArrowDown,
                          disabled: ii === inner.length - 1,
                          onSelect: () => movePage(p.id, 1),
                        },
                        { label: "Duplicate", icon: Copy, onSelect: () => duplicatePage(p.id) },
                      ]
                    : []),
                  { kind: "separator" as const },
                  {
                    label: "Delete page",
                    icon: Trash2,
                    danger: true,
                    disabled: pages.length <= 1,
                    onSelect: () => {
                      removePage(p.id);
                      toast(`${pageLabel(p, pages)} deleted`, {
                        action: { label: "Undo", onClick: () => usePopupComposerStore.temporal.getState().undo() },
                      });
                    },
                  },
                ]}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-1 px-1">
        <PageAdd onClick={() => addPage("page")}>Page</PageAdd>
        {!hasCover && <PageAdd onClick={() => addPage("cover")}>Cover</PageAdd>}
        {!hasBack && <PageAdd onClick={() => addPage("back")}>Back cover</PageAdd>}
      </div>
    </div>
  );
}

function PageAdd({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
    >
      <Plus className="size-3" /> {children}
    </button>
  );
}
