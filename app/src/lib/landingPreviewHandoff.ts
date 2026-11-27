// Editor → preview-tab handoff for UNSAVED page state.
//
// The editor's Preview button opens /admin/landing-editor/preview/<slug> in a
// new tab. To show what's in the editor right now — not just the last save —
// it first stashes the current DrawnPage here, and the preview route reads it
// back when opened with `?source=editor`. localStorage (not sessionStorage)
// because a tab opened with window.open only copies sessionStorage at open
// time in some browsers, and a reload of the preview should keep working.
// One slot per slug, overwritten on every click.
//
// Same-origin + owner-only by construction: the preview route is under
// /admin (proxy-gated), and this never leaves the browser.

import type { DrawnPage } from "@/data/landingTypes";
import type { ObjectContent } from "@/data/contentTypes";

const KEY_PREFIX = "landing-preview:";

export interface PreviewHandoff {
  page: DrawnPage;
  status: "draft" | "published";
  /** ms epoch when the editor handed it off. */
  handedOffAt: number;
  /** The editor's button pop-up content for this page ({ assetIid: content }),
   *  so the preview shows draft content, not what's live. */
  content?: Record<string, ObjectContent>;
}

/** Returns false if storage is unavailable/full (caller falls back). */
export function writePreviewHandoff(slug: string, handoff: PreviewHandoff): boolean {
  try {
    localStorage.setItem(KEY_PREFIX + slug, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function readPreviewHandoff(slug: string): PreviewHandoff | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreviewHandoff;
    return parsed?.page?.sections ? parsed : null;
  } catch {
    return null;
  }
}
