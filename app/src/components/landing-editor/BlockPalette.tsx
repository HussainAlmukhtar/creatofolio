"use client";

// BlockPalette — the "add a component" picker, available on EVERY section.
// Lists every registered block grouped by category and hands the chosen block
// TYPE back; the caller decides what to build from it — a positioned canvas
// asset (the normal case, so components mix with drawings/text) or a flow
// section's stacked block.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { listBlockDefs } from "@/components/landing/blocks/registry";
import type { BlockCategory } from "@/data/landingTypes";

const CATEGORY_LABEL: Record<BlockCategory, string> = {
  text: "Text",
  media: "Media",
  interactive: "Interactive",
  layout: "Layout",
  conversion: "Buttons & forms",
  embed: "Embed",
  social: "Social",
};
const CATEGORY_ORDER: BlockCategory[] = [
  "text",
  "media",
  "interactive",
  "conversion",
  "layout",
  "embed",
  "social",
];

/** One line per block, shown under its name (what it's FOR, not how). */
const BLOCK_BLURB: Record<string, string> = {
  heading: "A title in the display font",
  text: "A paragraph of body text",
  quote: "A pull-quote or testimonial",
  "feature-list": "Icons with a title and a line each",
  image: "One picture in a frame",
  gallery: "A grid of pictures, click to enlarge",
  carousel: "Slides that swipe or autoplay",
  accordion: "Questions that open to answers",
  tabs: "Switch between panels of text",
  button: "A link styled as a button",
  form: "Contact form to your CRM / inbox",
  newsletter: "One-line email sign-up",
  embed: "YouTube, Vimeo or a video file",
  map: "A map of an address",
  "social-links": "Icons linking to your profiles",
  divider: "A line between ideas",
  spacer: "Breathing room on phones",
  "rich-text": "Formatted text: headings, lists, links, pictures",
  links: "A list of links (email, socials, sites)",
  "cv-timeline": "Experience, education, skills…",
  "platform-embed": "An Instagram, TikTok, X or YouTube post",
  video: "YouTube, Vimeo or your own clip (loads when played)",
  audio: "A sound file with a player",
  screen: "A picture or clip with words on top, like a TV",
  "project-card": "Cover, role, year, tags and links",
  "file-download": "A PDF or sound to download, with its size",
  contact: "Email, phone, links and an optional form",
  columns: "Two or three columns of blocks",
  "tab-set": "Blocks behind tabs",
  "accordion-set": "Rows that open to show blocks",
  reel: "A grid of clips that opens a viewer",
};

export function BlockPalette({
  open,
  onOpenChange,
  onPick,
  surface = "page",
  only,
  title = "Add a component",
  description = "Drops into the section as an element: move, resize and layer it like anything else, then set it up in the panel on the right.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registry key of the chosen component (e.g. "carousel"). */
  onPick: (blockType: string) => void;
  surface?: "page" | "popup";
  /** Limit (and order) the offer to these block types. */
  only?: string[];
  title?: string;
  description?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const offered = listBlockDefs(surface).filter((d) => !only || only.includes(d.type));
  if (only) offered.sort((a, b) => only.indexOf(a.type) - only.indexOf(b.type));
  const defs = offered.filter(
    (d) =>
      !q ||
      d.label.toLowerCase().includes(q) ||
      d.type.includes(q) ||
      (BLOCK_BLURB[d.type] ?? "").toLowerCase().includes(q) ||
      (d.labelAr ?? "").includes(query.trim())
  );
  const byCat = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: defs.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);
  const choose = (type: string) => {
    onPick(type);
    setOpen(false);
  };
  const setOpen = (o: boolean) => {
    if (!o) setQuery("");
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85dvh] max-w-2xl flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && defs[0]) choose(defs[0].type);
            }}
            placeholder="Search components (e.g. gallery, form, map)"
            className="h-9 ps-8"
          />
        </div>
        <div className="-me-2 min-h-0 flex-1 space-y-4 overflow-y-auto pe-2">
          {byCat.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p>
          )}
          {byCat.map((g) => (
            <div key={g.cat} className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABEL[g.cat]}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.items.map((d) => {
                  const Icon = d.icon;
                  return (
                    <button
                      key={d.type}
                      onClick={() => choose(d.type)}
                      className="group flex items-start gap-2.5 rounded-lg border border-border p-2.5 text-start transition-colors hover:border-foreground/30 hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-foreground/80 group-hover:bg-background">
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">{d.label}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {BLOCK_BLURB[d.type] ?? ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
