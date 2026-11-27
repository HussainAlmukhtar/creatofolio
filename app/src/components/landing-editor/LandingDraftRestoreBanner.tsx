"use client";

// Landing-editor draft restore banner — mirrors DraftRestoreBanner.tsx. Shows
// when an IndexedDB draft exists for the currently-loaded page; offers Restore
// (replace the page + flip isDirty) or Discard.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import { getLandingDraft, clearLandingDraft } from "@/lib/draftStore";
import { landingDraftKey } from "@/lib/useLandingDraftAutosave";

interface PendingDraft {
  pageIid: string;
  savedAt: number;
}

function formatRelative(savedAt: number): string {
  const diff = Date.now() - savedAt;
  const m = Math.round(diff / 60000);
  if (m < 1) return "moments";
  if (m === 1) return "1 minute";
  if (m < 60) return `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function LandingDraftRestoreBanner() {
  const currentPageSlug = useLandingEditorStore((s) => s.currentPageSlug);
  const pageIid = useLandingEditorStore((s) =>
    s.currentPageSlug ? landingDraftKey(s.allPages[s.currentPageSlug]) : null
  );
  const restorePage = useLandingEditorStore((s) => s.restorePage);
  const [pending, setPending] = useState<PendingDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!pageIid) {
        if (!cancelled) setPending(null);
        return;
      }
      const draft = await getLandingDraft(pageIid);
      if (cancelled) return;
      setPending(draft ? { pageIid, savedAt: draft.savedAt } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pageIid, currentPageSlug]);

  if (!pending) return null;

  const restore = async () => {
    const draft = await getLandingDraft(pending.pageIid);
    if (!draft) {
      setPending(null);
      return;
    }
    restorePage(draft.page);
    await clearLandingDraft(pending.pageIid);
    setPending(null);
    toast.success("Draft restored — remember to save.");
  };

  const discard = async () => {
    await clearLandingDraft(pending.pageIid);
    setPending(null);
    toast("Draft discarded.");
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-700 bg-amber-900/40 px-4 py-2 text-sm text-amber-100">
      <div>Unsaved changes from {formatRelative(pending.savedAt)} ago.</div>
      <div className="flex gap-2">
        <button
          onClick={restore}
          className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500"
        >
          Restore
        </button>
        <button
          onClick={discard}
          className="rounded px-3 py-1 text-xs hover:bg-amber-800"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
