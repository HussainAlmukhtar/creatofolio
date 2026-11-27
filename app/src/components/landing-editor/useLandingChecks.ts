"use client";

// The pre-publish checks (lib/landingChecks) run against the editor's live
// state. `runLandingChecks()` reads the stores directly (for the publish gate,
// which must see what is on screen right now); `useLandingChecks()` is the
// memoised React view used by the toolbar badge and the panel.

import { useMemo } from "react";
import { checkLandingPage, summarizeIssues, type Issue } from "@/lib/landingChecks";
import { isReservedSlug } from "@/lib/landingEditorData";
import {
  useLandingEditorStore,
  selectCurrentDrawnPage,
} from "@/stores/landingEditorStore";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";

type LandingState = ReturnType<typeof useLandingEditorStore.getState>;

function compute(s: LandingState, siteConfig: ReturnType<typeof useSiteConfigEditorStore.getState>["config"]): Issue[] {
  const page = selectCurrentDrawnPage(s);
  const slug = s.currentPageSlug;
  if (!page || !slug) return [];
  const prefix = `${slug}:`;
  // Pop-up content is only known once it has been loaded for this page.
  const loaded = s.versionContent || s.contentLoadedSlugs.includes(slug);
  const contentMap: Record<string, unknown> | undefined = loaded
    ? Object.fromEntries(
        Object.entries(s.contentMap)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v])
      )
    : undefined;
  return checkLandingPage({
    page,
    siteConfig,
    pages: Object.values(s.allPages).map((r) => ({ slug: r.page.slug, status: r.status })),
    contentMap,
    isReservedSlug,
  });
}

/** Snapshot for imperative callers (the publish gate). */
export function runLandingChecks(): Issue[] {
  return compute(useLandingEditorStore.getState(), useSiteConfigEditorStore.getState().config);
}

export function useLandingChecks(): {
  issues: Issue[];
  errors: number;
  warnings: number;
  infos: number;
} {
  const page = useLandingEditorStore(selectCurrentDrawnPage);
  const slug = useLandingEditorStore((s) => s.currentPageSlug);
  const allPages = useLandingEditorStore((s) => s.allPages);
  const contentMap = useLandingEditorStore((s) => s.contentMap);
  const siteConfig = useSiteConfigEditorStore((s) => s.config);
  return useMemo(() => {
    const issues = compute(useLandingEditorStore.getState(), siteConfig);
    return { issues, ...summarizeIssues(issues) };
    // The store snapshot is re-read inside; these are the change triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, slug, allPages, contentMap, siteConfig]);
}

/** Plain-text checklist for dialogs. */
export function formatIssuesText(issues: Issue[], max = 12): string {
  const icon = { error: "✖", warning: "▲", info: "ℹ" } as const;
  const lines = issues
    .filter((i) => i.severity !== "info")
    .slice(0, max)
    .map((i) => `${icon[i.severity]} ${i.message}`);
  const rest = issues.filter((i) => i.severity !== "info").length - lines.length;
  if (rest > 0) lines.push(`… and ${rest} more (see Checks).`);
  return lines.join("\n");
}
