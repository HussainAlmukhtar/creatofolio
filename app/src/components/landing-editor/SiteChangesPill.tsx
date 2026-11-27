"use client";

import { useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";

/**
 * Top-bar reminder that site-wide settings (nav, footer, fonts, language
 * switch, maintenance…) have unsaved edits. Those are NOT part of page drafts:
 * they go live on every page the moment they're saved, so saving them is its
 * own, explicit step. Hidden when there's nothing to save.
 */
export function SiteChangesPill() {
  const isDirty = useSiteConfigEditorStore((s) => s.isDirty);
  const isSaving = useSiteConfigEditorStore((s) => s.isSaving);
  const save = useSiteConfigEditorStore((s) => s.save);
  const [confirming, setConfirming] = useState(false);

  if (!isDirty) return null;

  const goLive = async () => {
    setConfirming(false);
    const r = await save();
    if (r.ok) toast.success("Site-wide changes are live.");
    else if (r.code !== "conflict") toast.error("Couldn't save the site-wide changes", { description: r.error });
    // A conflict opens SiteConflictDialog on its own.
  };

  return (
    <PopoverPrimitive.Root open={confirming} onOpenChange={setConfirming}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={isSaving}
          title="Nav, footer, fonts, language switch… are site-wide and not part of page drafts"
          className="border-amber-500/60 text-amber-300 hover:text-amber-200"
        >
          <Globe /> Site-wide changes
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <p className="text-xs leading-snug">
            These are site-wide (nav, footer, fonts, language switch, maintenance…). They go live on every page as
            soon as you save; page drafts don&apos;t include them.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={goLive}>
              Save &amp; go live
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
