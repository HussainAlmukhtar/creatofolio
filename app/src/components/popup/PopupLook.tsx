"use client";

// Which drawn look a pop-up wears:
//   - the ACTIVE theme (panel, close, title strip, page arrows/corner…), or
//     the built-in paper look when there is none;
//   - the pop-up's own frame (`ObjectContent.frameIid`), if it picked one.
//
// Visitors get the published library (lib/popupStyles.ts, loaded once per
// tab). Previews pass a PopupStylesOverride instead: the theme/frame editor
// shows the draft being edited, and the pop-up lab tries a theme on the real
// game WITHOUT making it active for anyone.
//
// PopupLookContext carries the resolved look down to blocks inside the sheet
// (the pages view draws its arrows/corner from the theme).

import { createContext, useContext, useEffect, useState } from "react";
import type { PopupLook } from "@/data/popupStyleTypes";
import { NO_STYLES, loadPublicPopupStyles, type PublicPopupStyles } from "@/lib/popupStyles";

/** Previews: use these styles instead of the published library. */
export const PopupStylesOverride = createContext<PublicPopupStyles | null>(null);

/** The look of the sheet being rendered (set by PopupSheet). */
export const PopupLookContext = createContext<PopupLook>({ theme: null, frame: null });
export const usePopupLook = () => useContext(PopupLookContext);

let loaded: PublicPopupStyles | null = null;

/** Start loading the published styles early (game / landing page mount), so
 *  the first pop-up opens already dressed. */
export function preloadPopupStyles(): void {
  void loadPublicPopupStyles().then((s) => {
    loaded = s;
  });
}

/** The styles to render with, and whether they're ready yet. */
export function usePopupStyles(): { styles: PublicPopupStyles; ready: boolean } {
  const override = useContext(PopupStylesOverride);
  const [state, setState] = useState<PublicPopupStyles | null>(loaded);
  useEffect(() => {
    if (override || state) return;
    let live = true;
    void loadPublicPopupStyles().then((s) => {
      loaded = s;
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, [override, state]);
  if (override) return { styles: override, ready: true };
  return { styles: state ?? NO_STYLES, ready: state !== null };
}

/** Theme + this pop-up's frame (an unknown/unpublished frame = no frame). */
export function resolveLook(styles: PublicPopupStyles, frameIid?: string | null): PopupLook {
  return { theme: styles.theme, frame: (frameIid && styles.frames[frameIid]) || null };
}
