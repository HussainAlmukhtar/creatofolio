"use client";

// Pop-up container blocks: columns, tabs, accordion. Each holds
// `props.slots: { id, label, blocks }[]`; the child blocks render through
// `ctx.renderBlocks` (PopupView's BlockList), so selection and every block's
// own behaviour work inside them. ONE level only: the composer never puts a
// container inside a container.
//
// In the composer, the tab buttons and accordion headers still work (marked
// data-editor-passthrough so the click isn't swallowed by block selection),
// and selecting a child in the outline opens its tab / row.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { L } from "@/components/landing/blocks/shared";
import type { ContentBlock } from "@/data/landingTypes";
import type { AccordionSetProps, ColumnsProps, SlotItem, TabSetProps } from "@/data/popupBlockTypes";

type Lang = "en" | "ar";
export interface ContainerCtx {
  language: Lang;
  editor?: boolean;
  selectedId?: string | null;
  renderBlocks?: (blocks: ContentBlock[]) => ReactNode;
}

/** The slot holding the selected block (composer), else -1. */
function slotOfSelection(slots: SlotItem[], selectedId?: string | null): number {
  if (!selectedId) return -1;
  return slots.findIndex((s) => s.blocks.some((b) => b.id === selectedId));
}

function SlotBody({ slot, ctx, noun }: { slot: SlotItem; ctx: ContainerCtx; noun: string }) {
  if (!slot.blocks.length) {
    return ctx.editor ? <p className="popup-block-hint">Empty {noun}: add blocks to it from the list on the left.</p> : null;
  }
  return <>{ctx.renderBlocks?.(slot.blocks)}</>;
}

// ─── Columns ────────────────────────────────────────────────────

export function ColumnsBlock({ p, ctx }: { p: ColumnsProps; ctx: ContainerCtx }) {
  const slots = p.slots ?? [];
  return (
    <div
      className="popup-columns"
      data-stack={p.stackOnPhones === false ? undefined : ""}
      data-gap={p.gap ?? "m"}
      style={{ "--cols": Math.max(1, slots.length) } as React.CSSProperties}
    >
      {slots.map((s, i) => (
        <div key={s.id} className="popup-columns__col">
          <SlotBody slot={s} ctx={ctx} noun={`column ${i + 1}`} />
        </div>
      ))}
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────

export function TabSetBlock({ p, ctx }: { p: TabSetProps; ctx: ContainerCtx }) {
  const slots = p.slots ?? [];
  const [active, setActive] = useState(0);
  const base = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Composer: show the tab whose block is selected in the outline.
  const sel = slotOfSelection(slots, ctx.selectedId);
  const [lastSel, setLastSel] = useState(-1);
  if (sel !== lastSel) {
    setLastSel(sel);
    if (sel !== -1 && sel !== active) setActive(sel);
  }
  const cur = Math.min(active, Math.max(0, slots.length - 1));
  if (!slots.length) return null;

  const onKey = (e: React.KeyboardEvent) => {
    const rtl = ctx.language === "ar";
    const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    let next = cur + step;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = slots.length - 1;
    else if (!step) return;
    e.preventDefault();
    next = (next + slots.length) % slots.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="popup-tabs">
      <div role="tablist" className="popup-tabs__list" onKeyDown={onKey} data-editor-passthrough="">
        {slots.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-t${i}`}
            aria-selected={i === cur}
            aria-controls={`${base}-p${i}`}
            tabIndex={i === cur ? 0 : -1}
            onClick={() => setActive(i)}
            className="popup-tabs__tab"
          >
            {L(s.label, ctx.language) || `${ctx.language === "ar" ? "تبويب" : "Tab"} ${i + 1}`}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-p${cur}`} aria-labelledby={`${base}-t${cur}`} className="popup-tabs__panel">
        <SlotBody slot={slots[cur]} ctx={ctx} noun="tab" />
      </div>
    </div>
  );
}

// ─── Accordion ──────────────────────────────────────────────────

function AccordionRow({
  slot,
  index,
  ctx,
  initiallyOpen,
  forceOpen,
}: {
  slot: SlotItem;
  index: number;
  ctx: ContainerCtx;
  initiallyOpen: boolean;
  forceOpen: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (forceOpen && ref.current) ref.current.open = true;
  }, [forceOpen]);
  return (
    <details ref={ref} className="popup-accordion__row" open={initiallyOpen || undefined}>
      <summary className="popup-accordion__head" data-editor-passthrough="">
        <span>{L(slot.label, ctx.language) || `${ctx.language === "ar" ? "قسم" : "Section"} ${index + 1}`}</span>
        <ChevronDown size={18} aria-hidden="true" className="popup-accordion__chev" />
      </summary>
      <div className="popup-accordion__body">
        <SlotBody slot={slot} ctx={ctx} noun="row" />
      </div>
    </details>
  );
}

export function AccordionSetBlock({ p, ctx }: { p: AccordionSetProps; ctx: ContainerCtx }) {
  const slots = p.slots ?? [];
  const sel = slotOfSelection(slots, ctx.selectedId);
  return (
    <div className="popup-accordion">
      {slots.map((s, i) => (
        <AccordionRow
          key={s.id}
          slot={s}
          index={i}
          ctx={ctx}
          initiallyOpen={Boolean(p.firstOpen) && i === 0}
          forceOpen={sel === i}
        />
      ))}
    </div>
  );
}
