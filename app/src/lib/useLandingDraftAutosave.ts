"use client";

// Landing-editor draft autosave — mirrors useDraftAutosave.ts. Subscribes to
// the landing editor store and writes the current page to IndexedDB after a
// debounce; clears the draft when isDirty flips back to false (a successful
// save) or on unmount. Keyed by page iid + open version (landingDraftKey).

import { useEffect, useRef } from "react";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import { setLandingDraft, clearLandingDraft } from "@/lib/draftStore";
import type { LandingPageRecord } from "@/lib/landingEditorData";

/** IndexedDB key for a page's draft: per version, so a recovered draft is
 *  only offered on the version it was made in. */
export function landingDraftKey(record: LandingPageRecord | null | undefined): string | null {
  if (!record?.page.iid) return null;
  return record.versionId ? `${record.page.iid}:${record.versionId}` : record.page.iid;
}

const DEBOUNCE_MS = 2000;

export function useLandingDraftAutosave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useLandingEditorStore.subscribe((state, prev) => {
      const slug = state.currentPageSlug;
      const record = slug ? state.allPages[slug] : null;
      const iid = landingDraftKey(record);
      if (!iid) return;

      // Just saved (dirty → clean): drop any pending draft.
      if (prev.isDirty && !state.isDirty) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        // The key the edits were made under (a first save or a version
        // switch changes the open version in the same update).
        const prevKey = prev.currentPageSlug
          ? landingDraftKey(prev.allPages[prev.currentPageSlug])
          : null;
        void clearLandingDraft(prevKey ?? iid);
        return;
      }

      // Dirty: schedule a debounced write of the latest page.
      if (state.isDirty && record) {
        if (timerRef.current) clearTimeout(timerRef.current);
        const snapshot = record.page;
        timerRef.current = setTimeout(() => {
          void setLandingDraft(iid, snapshot);
          timerRef.current = null;
        }, DEBOUNCE_MS);
      }
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsub();
    };
  }, []);
}
