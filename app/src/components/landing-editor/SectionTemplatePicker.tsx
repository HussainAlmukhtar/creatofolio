"use client";

// SectionTemplatePicker — the dialog opened by the "+" button in the section
// outline. Offers ready-made archetypes (built into the codebase) plus any
// sections the author has saved as reusable templates (stored in Supabase via
// website_section_templates — the data layer already existed; this is its
// first UI). Picking either mints a fresh section (fresh iids throughout) and
// hands it back to the caller, which adds it to the page.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { SECTION_ARCHETYPES } from "@/data/landingSectionArchetypes";
import { blankSection } from "@/stores/landingEditorStore";
import {
  listSectionTemplates,
  deleteSectionTemplate,
  reIidSection,
  type SectionTemplateRecord,
} from "@/lib/landingEditorData";
import type { DrawnSection } from "@/data/landingTypes";
import { SectionThumb } from "./SectionThumb";


interface SectionTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (section: DrawnSection) => void;
}

export function SectionTemplatePicker({
  open,
  onOpenChange,
  onPick,
}: SectionTemplatePickerProps) {
  const [templates, setTemplates] = useState<SectionTemplateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Built once: each archetype's real layout, for its preview thumbnail.
  const previews = useMemo(
    () => Object.fromEntries(SECTION_ARCHETYPES.map((a) => [a.id, a.build()])) as Record<string, DrawnSection>,
    []
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!open) return;
      setConfirmDeleteId(null);
      setLoading(true);
      const rows = await listSectionTemplates();
      if (!cancelled) {
        setTemplates(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const pick = (section: DrawnSection) => {
    onPick(section);
    onOpenChange(false);
  };

  const deleteTemplate = async (id: string) => {
    const res = await deleteSectionTemplate(id);
    if (!res.ok) {
      toast.error("Couldn't delete template", { description: res.error });
      return;
    }
    setTemplates((rows) => rows.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] max-w-3xl flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add a section</DialogTitle>
          <DialogDescription>
            Start from a layout or a blank sheet. Everything in it is a placeholder:
            swap the art, text and links once it&apos;s on the page.
          </DialogDescription>
        </DialogHeader>

        <div className="-me-2 min-h-0 flex-1 space-y-5 overflow-y-auto pe-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Every section is a canvas. Components are elements you add from
                the insert bar, mixed in with drawings and text. */}
            <TemplateCard
              name="Blank canvas"
              description="A clean sheet. Place drawings, text and components freely."
              onClick={() => pick(blankSection())}
              highlight
            >
              <SectionThumb section={null} className="h-full w-full" />
            </TemplateCard>
            {SECTION_ARCHETYPES.map((a) => (
              <TemplateCard key={a.id} name={a.name} description={a.description} onClick={() => pick(a.build())}>
                <SectionThumb section={previews[a.id] ?? null} className="h-full w-full" />
              </TemplateCard>
            ))}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              My templates
            </h3>
            {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!loading && templates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                None yet. Build a section the way you like it, then use the bookmark
                icon on it in the Sections panel to reuse it here.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {templates.map((t) => (
                <div key={t.id} className="relative">
                  <TemplateCard name={t.name} description="Saved from your pages" onClick={() => pick(reIidSection(t.section))}>
                    <SectionThumb section={t.section} className="h-full w-full" />
                  </TemplateCard>
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    className={`absolute end-2 top-2 ${confirmDeleteId === t.id ? "text-destructive" : ""}`}
                    title={confirmDeleteId === t.id ? "Click again to delete" : "Delete template"}
                    onClick={() => (confirmDeleteId === t.id ? deleteTemplate(t.id) : setConfirmDeleteId(t.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  name,
  description,
  onClick,
  highlight,
  children,
}: {
  name: string;
  description: string;
  onClick: () => void;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full flex-col overflow-hidden rounded-lg border text-start transition-colors hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-ring ${
        highlight ? "border-primary/50" : "border-border"
      }`}
    >
      <span className="block aspect-[16/10] overflow-hidden border-b border-border bg-background">{children}</span>
      <span className="block p-2.5">
        <span className="block text-sm font-medium leading-tight">{name}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
