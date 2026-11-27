"use client";

// LandingPreview — body of the owner-only draft preview route
// (/admin/landing-editor/preview/<slug>). Renders the page through the real
// public shells: LandingPage (with the arcade hero) for "home", SubPageView for
// everything else — so it's pixel-identical to the live site, unlike the
// editor canvas (no editor chrome, real scroll animations, real language pill).
//
// Two sources:
//   - `?source=editor` — the unsaved editor state the Preview button stashed
//     in localStorage (landingPreviewHandoff.ts). Falls back to the saved row
//     if there's no handoff (e.g. the link was opened in another browser).
//   - `?version=<id>` — that saved version (drafts, from the version switcher).
//   - default — the SAVED row from website_pages, draft or published
//     (loadLandingPageForPreview: no status filter, unlike the public loader).

import { useEffect, useState } from "react";
import Link from "next/link";
import LandingPage from "@/components/landing/LandingPage";
import SubPageView from "@/components/landing/SubPageView";
import { loadLandingPageForPreview } from "@/lib/landingEditorData";
import { readPreviewHandoff } from "@/lib/landingPreviewHandoff";
import type { DrawnPage } from "@/data/landingTypes";
import type { ObjectContent } from "@/data/contentTypes";
import { LandingContentOverrideContext } from "@/components/landing/LandingContentOverride";

type PreviewState =
  | { kind: "loading" }
  | {
      kind: "ready";
      page: DrawnPage;
      status: "draft" | "published";
      source: "editor" | "saved";
      /** ms epoch (editor hand-off) or ISO string (row updated_at). */
      at?: number | string;
      /** Draft button content to show in pop-ups (null = read what's live). */
      content: Record<string, ObjectContent> | null;
    }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function initialState(slug: string): PreviewState {
  const wantsEditor =
    new URLSearchParams(window.location.search).get("source") === "editor";
  if (wantsEditor) {
    const handoff = readPreviewHandoff(slug);
    if (handoff) {
      return {
        kind: "ready",
        page: handoff.page,
        status: handoff.status,
        source: "editor",
        at: handoff.handedOffAt,
        content: handoff.content ?? null,
      };
    }
  }
  return { kind: "loading" };
}

export default function LandingPreview({ slug }: { slug: string }) {
  // Resolved in the initializer (this component is ssr:false, so `window` is
  // there) — no setState-in-effect for the synchronous hand-off path.
  const [state, setState] = useState<PreviewState>(() => initialState(slug));
  const needsFetch = state.kind === "loading";

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    void (async () => {
      // ?version=<id>: a specific saved version (the version switcher's
      // Preview); otherwise the page row, i.e. what's live.
      const version = new URLSearchParams(window.location.search).get("version") ?? undefined;
      const res = await loadLandingPageForPreview(slug, version);
      if (cancelled) return;
      if (res.error) setState({ kind: "error", message: res.error });
      else if (!res.record) setState({ kind: "missing" });
      else
        setState({
          kind: "ready",
          page: res.record.page,
          status: res.record.status,
          source: "saved",
          at: res.record.updatedAt,
          content: res.content ?? null,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, needsFetch]);

  if (state.kind !== "ready") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-center text-neutral-200">
        {state.kind === "loading" && <p>Loading preview…</p>}
        {state.kind === "missing" && (
          <p>
            No saved page called <code className="text-amber-300">{slug}</code>.
            Save it in the editor first, or use the editor&apos;s Preview button
            to see unsaved changes.
          </p>
        )}
        {state.kind === "error" && (
          <p>Couldn&apos;t load the page: {state.message}</p>
        )}
        <Link href="/admin/landing-editor" className="text-sm text-sky-400 hover:underline">
          ← Back to the editor
        </Link>
      </div>
    );
  }

  return (
    <LandingContentOverrideContext.Provider value={state.content}>
      {slug === "home" ? (
        <LandingPage previewPage={state.page} />
      ) : (
        <SubPageView page={state.page} />
      )}
      <PreviewBanner state={state} />
    </LandingContentOverrideContext.Provider>
  );
}

function PreviewBanner({ state }: { state: Extract<PreviewState, { kind: "ready" }> }) {
  const [collapsed, setCollapsed] = useState(false);
  const when =
    state.at !== undefined
      ? new Date(state.at).toLocaleTimeString(undefined, { timeStyle: "short" })
      : null;
  const sourceText =
    state.source === "editor"
      ? `Editor state${when ? ` at ${when}` : ""} (may include unsaved changes)`
      : `Last saved version${when ? ` (${when})` : ""}`;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-[10000] rounded-full bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black shadow-lg"
      >
        Preview
      </button>
    );
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[10000] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-neutral-950/95 px-4 py-2 text-xs text-neutral-200 shadow-2xl ring-1 ring-amber-400/60"
      dir="ltr"
    >
      <span className="rounded bg-amber-400 px-1.5 py-0.5 font-semibold uppercase text-black">
        {state.status === "published" ? "Preview" : "Draft preview"}
      </span>
      <span>
        <code>/{state.page.slug === "home" ? "" : state.page.slug}</code> ·{" "}
        {state.status === "published" ? "published" : "not published — visitors can't see this"}
      </span>
      <span className="text-neutral-400">{sourceText}</span>
      <Link href="/admin/landing-editor" className="text-sky-400 hover:underline">
        Back to editor
      </Link>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        className="text-neutral-400 hover:text-neutral-100"
        aria-label="Minimise preview banner"
      >
        Hide
      </button>
    </div>
  );
}
