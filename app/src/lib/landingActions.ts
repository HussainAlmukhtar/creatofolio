"use client";

// Landing-page action registry.
//
// A DrawnAsset with role { kind: "button", actionId } fires an action when
// clicked. `actionId` stays a plain string on the schema (stable, migration-
// free) and encodes the action as a prefixed string — "content:<assetIid>" or
// "scroll:<sectionId>". parseActionId decodes it; encodeActionId (used by the
// editor's action picker) produces it. Extending = add a variant + a prefix
// case here; nothing else in the schema changes.
//
// Kept a plain switch, not a plugin system — consistent with how the codebase
// already treats content.type in the pop-up renderer (components/popup).

import { createContext, useContext } from "react";

export type LandingAction =
  | { kind: "open-content"; assetIid: string }
  | { kind: "scroll-to-section"; sectionId: string };

/** Decode a stored actionId into a typed action, or null if unrecognized. */
export function parseActionId(actionId: string): LandingAction | null {
  const idx = actionId.indexOf(":");
  if (idx === -1) return null;
  const prefix = actionId.slice(0, idx);
  const value = actionId.slice(idx + 1);
  if (!value) return null;

  switch (prefix) {
    case "content":
      return { kind: "open-content", assetIid: value };
    case "scroll":
      return { kind: "scroll-to-section", sectionId: value };
    default:
      console.warn(`[landingActions] unknown actionId prefix: "${prefix}"`);
      return null;
  }
}

/** Encode a typed action into the stored actionId string. */
export function encodeActionId(action: LandingAction): string {
  switch (action.kind) {
    case "open-content":
      return `content:${action.assetIid}`;
    case "scroll-to-section":
      return `scroll:${action.sectionId}`;
  }
}

// ─── Dispatch context ───────────────────────────────────────
//
// Provided by whatever renders a page's sections (home + sub-pages). A null
// context (e.g. the editor canvas, which renders sections but shouldn't fire
// actions) makes buttons inert.

export interface LandingActionContextValue {
  pageSlug: string;
  dispatch: (action: LandingAction) => void;
}

export const LandingActionContext =
  createContext<LandingActionContextValue | null>(null);

export function useLandingActions(): LandingActionContextValue | null {
  return useContext(LandingActionContext);
}
