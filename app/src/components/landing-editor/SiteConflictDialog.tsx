"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { useChoiceDialog } from "@/components/editor/useChoiceDialog";

/**
 * Shown when saving the site settings finds the row changed somewhere else
 * (another tab or device). Driven by siteConfigEditorStore.conflict so every
 * Save surface (Site settings, Nav Studio, the page editor) gets it for free.
 * Site config has no backup table, so "Overwrite" can't be undone.
 */
export function SiteConflictDialog() {
  const conflict = useSiteConfigEditorStore((s) => s.conflict);
  const { choose, dialog } = useChoiceDialog();

  useEffect(() => {
    if (!conflict) return;
    let cancelled = false;
    void (async () => {
      const when = conflict.theirsUpdatedAt
        ? new Date(conflict.theirsUpdatedAt).toLocaleString()
        : "a moment ago";
      const pick = await choose({
        title: "Site settings were changed somewhere else",
        body: `Another tab or device saved the site settings (${when}) after you loaded them.\n\nReload discards your unsaved changes here and loads theirs. Overwrite puts yours live and replaces the other change for good: there is no backup of site settings.`,
        options: [
          { id: "reload", label: "Reload site settings", primary: true },
          { id: "overwrite", label: "Overwrite (replaces the other change)", danger: true },
          { id: "cancel", label: "Cancel" },
        ],
      });
      if (cancelled) return;
      const store = useSiteConfigEditorStore.getState();
      if (pick === "reload") {
        const ok = await store.reloadFromDb();
        if (ok) toast.success("Loaded the newer site settings.");
        else toast.error("Couldn't reload the site settings. Your changes are still here.");
      } else if (pick === "overwrite") {
        const r = await store.save({ force: true });
        if (r.ok) toast.success("Site-wide changes are live.");
        else toast.error("Couldn't save the site settings", { description: r.error });
      } else {
        store.dismissConflict();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conflict, choose]);

  return dialog;
}
