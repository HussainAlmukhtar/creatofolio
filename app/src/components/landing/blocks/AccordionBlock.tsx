"use client";

// AccordionBlock — a real collapsible FAQ built on Radix Accordion (via the
// shadcn wrapper). Single- or multi-open. Author settings arrive as props.

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { Localized } from "@/data/landingTypes";
import { L } from "./shared";
import { EditorHint } from "./EditorHint";

export interface AccordionItemData {
  id: string;
  title: Localized;
  body: Localized;
}
export interface AccordionProps {
  items: AccordionItemData[];
  mode: "single" | "multiple";
  collapsible: boolean;
}

export function AccordionBlock({
  props,
  language,
  editor,
}: {
  props: AccordionProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const { items, mode, collapsible } = props;
  if (!items?.length) {
    return (
      <EditorHint editor={editor}>Accordion — add rows in the settings panel.</EditorHint>
    );
  }
  // Radix requires the `type` discriminant to pick single vs multiple.
  const common = {
    className: "accordion-block w-full",
    dir: language === "ar" ? ("rtl" as const) : ("ltr" as const),
  };
  // Colours come from the SECTION ink tokens, not the ambient `foreground` —
  // a block renders on a paper/digital section surface, not on the editor's
  // dark chrome, so inheriting `foreground` would render near-white on cream.
  const rows = items.map((it) => (
    <AccordionItem key={it.id} value={it.id} className="accordion-block__item">
      <AccordionTrigger className="accordion-block__trigger">
        {L(it.title, language)}
      </AccordionTrigger>
      <AccordionContent>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-section-ink-soft">{L(it.body, language)}</p>
      </AccordionContent>
    </AccordionItem>
  ));
  return mode === "multiple" ? (
    <Accordion type="multiple" {...common}>
      {rows}
    </Accordion>
  ) : (
    <Accordion type="single" collapsible={collapsible} {...common}>
      {rows}
    </Accordion>
  );
}
