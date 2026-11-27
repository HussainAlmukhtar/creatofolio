"use client";

// LandingActionProvider — supplies the LandingActionContext to a page's drawn
// sections and owns the content-modal state that "open-content" buttons drive.
//
// Wraps the section body on both the home page and sub-pages. The editor canvas
// deliberately does NOT use this (it renders sections without a provider, so
// buttons are inert there).

import { useCallback, useMemo, useState } from "react";
import {
  LandingActionContext,
  type LandingAction,
} from "@/lib/landingActions";
import type { PopupTheme } from "@/components/popup/popupTheme";
import type { DrawnPage, SectionSurface } from "@/data/landingTypes";
import LandingContentModal from "./LandingContentModal";

/** Map a section surface to the pop-up theme its modal should use. */
export function themeForSurface(surface?: SectionSurface): PopupTheme {
  return surface?.kind === "digital" ? "landing-digital" : "landing-paper";
}

interface LandingActionProviderProps {
  page: DrawnPage;
  children: React.ReactNode;
}

export default function LandingActionProvider({
  page,
  children,
}: LandingActionProviderProps) {
  const [openContent, setOpenContent] = useState<{
    assetIid: string;
    theme: PopupTheme;
  } | null>(null);

  const dispatch = useCallback(
    (action: LandingAction) => {
      switch (action.kind) {
        case "scroll-to-section": {
          const el = document.querySelector(
            `[data-section-id="${CSS.escape(action.sectionId)}"]`
          );
          el?.scrollIntoView({ behavior: "smooth" });
          break;
        }
        case "open-content": {
          // Derive the modal theme from the section that hosts the asset.
          const host = page.sections.find((s) =>
            s.assets.some((a) => a.iid === action.assetIid)
          );
          setOpenContent({
            assetIid: action.assetIid,
            theme: themeForSurface(host?.surface),
          });
          break;
        }
      }
    },
    [page]
  );

  const value = useMemo(
    () => ({ pageSlug: page.slug, dispatch }),
    [page.slug, dispatch]
  );

  return (
    <LandingActionContext.Provider value={value}>
      {children}
      {openContent && (
        <LandingContentModal
          key={openContent.assetIid}
          pageSlug={page.slug}
          assetIid={openContent.assetIid}
          theme={openContent.theme}
          onClose={() => setOpenContent(null)}
        />
      )}
    </LandingActionContext.Provider>
  );
}
