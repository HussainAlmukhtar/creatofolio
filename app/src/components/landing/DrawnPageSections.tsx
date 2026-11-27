"use client";

// DrawnPageSections — the shared "render a DrawnPage's sections" body used by
// both the home page (LandingPage) and every [slug] sub-page (SubPageView).
// One renderer, so the two surfaces can never drift.
//
// Deliberately just the sections map — no hero/cabinet chrome, no motion
// wiring, no language plumbing. Callers own all of that (the home page has the
// arcade cabinet above these sections; sub-pages don't).
//
// Section visibility is applied HERE, not inside DrawnSection, so a hidden
// section never mounts (and the editor, which renders DrawnSection directly,
// can still show it dimmed). See data/sectionVisibility.ts for the rules.

import { Fragment } from "react";
import DrawnSection from "./DrawnSection";
import type { DrawnPage } from "@/data/landingTypes";
import {
  isSectionPubliclyVisible,
  isHiddenOnDevice,
} from "@/data/sectionVisibility";
import { useMinuteClock } from "@/lib/useMinuteClock";

interface DrawnPageSectionsProps {
  page: DrawnPage;
  /**
   * The instant the server rendered at (ms), so scheduled sections resolve the
   * same way on the server and during hydration. Omit on client-only pages.
   */
  serverNow?: number | null;
}

export default function DrawnPageSections({
  page,
  serverNow = null,
}: DrawnPageSectionsProps) {
  const now = useMinuteClock(serverNow);
  return (
    <>
      {page.sections
        // The "game" section is rendered by HeroSection (with the real cabinet),
        // not as a normal DrawnSection.
        .filter((section) => !section.containsGame)
        .filter((section) => isSectionPubliclyVisible(section, now))
        .map((section) => {
          const hideMobile = isHiddenOnDevice(section, "mobile");
          const hideDesktop = isHiddenOnDevice(section, "desktop");
          const body = <DrawnSection section={section} />;
          if (!hideMobile && !hideDesktop) {
            return <Fragment key={section.iid}>{body}</Fragment>;
          }
          // Per-device hiding is CSS (a media query on this wrapper), because
          // the server can't know the visitor's device — a JS check would
          // mismatch on hydration. `display: contents` keeps the wrapper out of
          // layout/stacking so torn edges still overlap neighbours as before.
          return (
            <div
              key={section.iid}
              className="drawn-section-device"
              data-hide-mobile={hideMobile ? "true" : undefined}
              data-hide-desktop={hideDesktop ? "true" : undefined}
            >
              {body}
            </div>
          );
        })}
    </>
  );
}
