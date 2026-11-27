"use client";

// TabsBlock — real tabbed panels built on Radix Tabs (shadcn wrapper).

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Localized } from "@/data/landingTypes";
import { L } from "./shared";
import { EditorHint } from "./EditorHint";

export interface TabItemData {
  id: string;
  label: Localized;
  body: Localized;
}
export interface TabsProps {
  tabs: TabItemData[];
}

export function TabsBlock({
  props,
  language,
  editor,
}: {
  props: TabsProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const { tabs } = props;
  if (!tabs?.length) {
    return (
      <EditorHint editor={editor}>Tabs — add tabs in the settings panel.</EditorHint>
    );
  }
  return (
    <Tabs
      defaultValue={tabs[0].id}
      className="w-full items-center"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      {/* `line` variant + section ink tokens: the default pill variant paints a
          `bg-muted` chrome-coloured slab with `foreground` text, which lands as
          a dark box with white text on a cream paper section. An underlined tab
          bar in the section's own ink sits on any surface. */}
      <TabsList variant="line" className="border-line bg-transparent">
        {tabs.map((t) => (
          // The `dark:` variants below are required, not redundant: the
          // primitive ships `dark:data-active:text-foreground`, which outranks
          // a plain `data-active:` class and would otherwise repaint the active
          // tab white whenever the surrounding app is in dark mode.
          <TabsTrigger
            key={t.id}
            value={t.id}
            className="text-section-ink-soft! after:bg-section-ink data-active:bg-transparent data-active:text-section-ink! dark:data-active:bg-transparent dark:data-active:text-section-ink!"
          >
            {L(t.label, language)}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="pt-4">
          <p className="whitespace-pre-wrap text-center text-base leading-relaxed text-section-ink-soft">
            {L(t.body, language)}
          </p>
        </TabsContent>
      ))}
    </Tabs>
  );
}
