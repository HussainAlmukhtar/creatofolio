"use client";

// ComposerInspector — settings for what's selected in the composer:
//   - "Pop-up settings": the bilingual title, desktop width, layout, frame,
//     presets (start from one / save as one) and every half-translated spot
//     (click one to jump to its block);
//   - a block: the generated landing inspector (BlockInspector) in its pop-up
//     flavour (InspectorContext from PopupComposer), plus duplicate / delete.
// Rich text can widen the panel so English and Arabic sit side by side.

import { Copy, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getBlockDef } from "@/components/landing/blocks/registry";
import { BlockInspector } from "@/components/landing-editor/BlockInspector";
import { FieldControl } from "@/components/landing-editor/FormFields";
import { contentTranslation, ownProps, translationState } from "@/lib/localizedChecks";
import { locate } from "@/data/popupTree";
import { usePopupStyles } from "@/components/popup/PopupLook";
import { usePopupComposerStore } from "@/stores/popupComposerStore";
import { PresetsSection } from "./PresetPicker";

const SIZE_FIELD = {
  kind: "select" as const,
  key: "size",
  label: "Width on computers",
  options: [
    { value: "s", label: "Narrow" },
    { value: "m", label: "Medium" },
    { value: "l", label: "Wide" },
  ],
};
const TITLE_FIELD = { kind: "text" as const, key: "title", label: "Title", localized: true };
const LAYOUT_FIELD = {
  kind: "select" as const,
  key: "layout",
  label: "Layout",
  options: [
    { value: "sheet", label: "One scrolling sheet" },
    { value: "pages", label: "Pages you flip (magazine)" },
  ],
};

export function ComposerInspector({ wide, onToggleWide }: { wide: boolean; onToggleWide: () => void }) {
  const content = usePopupComposerStore((s) => s.content);
  const selected = usePopupComposerStore((s) => s.selected);
  const { setMeta, setLayout, updateBlockProps, duplicateBlock, removeBlock, select } = usePopupComposerStore.getState();
  const { styles } = usePopupStyles();
  if (!content) return null;

  if (!selected || selected === "settings") {
    const tr = contentTranslation(content);
    return (
      <div className="space-y-4 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pop-up settings</h3>
        <FieldControl
          field={TITLE_FIELD}
          value={{ en: content.title ?? "", ar: content.titleAr ?? "" }}
          onChange={(v) => {
            const t = v as { en: string; ar: string };
            setMeta({ title: t.en, titleAr: t.ar });
          }}
        />
        <FieldControl field={SIZE_FIELD} value={content.size ?? "m"} onChange={(v) => setMeta({ size: v as "s" | "m" | "l" })} />
        <p className="text-[11px] text-muted-foreground touch:text-[13px]">Phones always show the pop-up as a card from the bottom.</p>
        <FieldControl
          field={LAYOUT_FIELD}
          value={content.layout ?? "sheet"}
          onChange={(v) => {
            const to = v as "sheet" | "pages";
            setLayout(to);
            toast(to === "pages" ? "Your blocks are now page 1. Add pages on the left." : "All pages' blocks now stack in one sheet.", {
              action: { label: "Undo", onClick: () => usePopupComposerStore.temporal.getState().undo() },
            });
          }}
        />
        <FieldControl
          field={{
            kind: "select",
            key: "frameIid",
            label: "Frame",
            options: [
              { value: "none", label: "No frame (the theme's panel)" },
              ...styles.frameList.map((f) => ({ value: f.iid, label: f.name || "Untitled frame" })),
              // A frame that has since been archived stays selectable for this pop-up.
              ...(content.frameIid && !styles.frameList.some((f) => f.iid === content.frameIid)
                ? [{ value: content.frameIid, label: styles.frames[content.frameIid] ? "Archived frame" : "Missing frame" }]
                : []),
            ],
          }}
          value={content.frameIid || "none"}
          onChange={(v) => setMeta({ frameIid: v === "none" ? null : (v as string) })}
        />
        <p className="text-[11px] text-muted-foreground touch:text-[13px]">
          {styles.frameList.length
            ? "Frames are drawn in Pop-up styles (dashboard). Only published frames are listed."
            : "No published frames yet: draw one in Pop-up styles (dashboard)."}
        </p>
        {content.layout === "pages" && (
          <p className="text-[11px] text-muted-foreground touch:text-[13px]">
            Visitors turn pages with the arrows, by swiping, or with the ← → keys (mirrored in Arabic).
          </p>
        )}

        <PresetsSection />

        <div className="space-y-2 border-t border-neutral-800 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Translation · {tr.complete}/{tr.total} complete
          </h4>
          {tr.gaps.length === 0 ? (
            <p className="text-sm text-emerald-300">Everything with text has both English and Arabic.</p>
          ) : (
            <ul className="space-y-1">
              {tr.gaps.map((g, i) => {
                const blockId = g.path[0] === "title" ? null : g.path[0];
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => select(blockId ?? "settings")}
                      className="w-full rounded-md bg-amber-500/10 px-2.5 py-1.5 text-start text-xs text-amber-200 hover:bg-amber-500/20"
                    >
                      {g.filled === "en" ? "Arabic" : "English"} missing: “{g.preview}”
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const block = locate(content, selected)?.block;
  if (!block) return <p className="p-4 text-sm text-muted-foreground">Select a block.</p>;
  const def = getBlockDef(block.type);
  const hasRichText = def?.fields.some((f) => f.kind === "richtext");
  const tr = translationState(ownProps(block.props));

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {def?.label ?? block.type}
          {tr === "half" && <span className="ms-2 normal-case tracking-normal text-amber-300">· half-translated</span>}
        </h3>
        {hasRichText && (
          <button
            type="button"
            onClick={onToggleWide}
            title={wide ? "Narrow panel" : "English and Arabic side by side"}
            aria-pressed={wide}
            className="grid size-7 place-items-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-foreground"
          >
            {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => duplicateBlock(block.id)}
          title="Duplicate"
          aria-label="Duplicate block"
          className="grid size-7 place-items-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            removeBlock(block.id);
            toast(`${def?.label ?? "Block"} deleted`, {
              action: { label: "Undo", onClick: () => usePopupComposerStore.temporal.getState().undo() },
            });
          }}
          title="Delete"
          aria-label="Delete block"
          className="grid size-7 place-items-center rounded-md text-red-400 hover:bg-neutral-800"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <BlockInspector
        key={block.id}
        block={block}
        showHeader={false}
        onChange={(partial) => updateBlockProps(block.id, partial)}
        onDelete={() => removeBlock(block.id)}
        onDuplicate={() => duplicateBlock(block.id)}
      />
    </div>
  );
}
