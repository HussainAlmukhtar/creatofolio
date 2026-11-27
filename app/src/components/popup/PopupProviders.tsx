"use client";

// PopupProviders — what pop-up blocks need from the site when a pop-up shows
// OUTSIDE a landing page's provider tree (the composer in the room editor, the
// pop-up lab). Today that is the forms destination: the Contact block's form
// is hidden from visitors until Site settings → Forms has one, and the
// composer should say so truthfully.
//
// Game pop-ups don't need this: the game runs inside the landing page
// (CabinetStage), whose FormsContext reaches the pop-up through the portal.
// Fonts need nothing either: pop-up blocks use the theme's fonts (per-block
// font fields are hidden in pop-ups).

import { useContext, useEffect, useState, type ReactNode } from "react";
import type { FormsConfig } from "@/data/landingTypes";
import { FormsContext, NO_FORMS } from "@/components/landing/formsContext";
import { loadPublishedSiteConfig } from "@/lib/landingData";

let cached: Promise<FormsConfig> | null = null;
/** The live site's forms destination (one read per tab). */
function loadLiveForms(): Promise<FormsConfig> {
  cached ??= loadPublishedSiteConfig().then((c) => c.forms ?? NO_FORMS);
  return cached;
}

export function PopupProviders({
  forms,
  children,
}: {
  /** The host's own (possibly unsaved) forms config; absent = use the
   *  surrounding provider, else read the live site config. */
  forms?: FormsConfig;
  children: ReactNode;
}) {
  const ambient = useContext(FormsContext);
  const need = !forms && ambient === NO_FORMS;
  const [loaded, setLoaded] = useState<FormsConfig | null>(null);
  useEffect(() => {
    if (!need) return;
    let live = true;
    void loadLiveForms().then((f) => live && setLoaded(f));
    return () => {
      live = false;
    };
  }, [need]);
  const value = forms ?? (ambient !== NO_FORMS ? ambient : (loaded ?? NO_FORMS));
  return <FormsContext.Provider value={value}>{children}</FormsContext.Provider>;
}
