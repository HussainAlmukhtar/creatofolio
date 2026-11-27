"use client";

// SubPageView — client shell for a non-home landing page (/[slug]).
//
// Same drawn-section rendering as the home page, but WITHOUT the arcade-cabinet
// hero, the Phaser game, or the play-mode machinery — those are home-only. Just
// the language pill, RTL/dir plumbing, motion (section reveals + parallax), and
// the shared DrawnPageSections body.

import { preloadPopupStyles } from "@/components/popup/PopupLook";
import { useEffect, useRef } from "react";
import LanguagePill from "./LanguagePill";
import AnnouncementBar from "./AnnouncementBar";
import SiteNav from "./nav/SiteNav";
import { navFontKeys, navLangAttr } from "@/data/navConfig";
import SiteFonts, { CustomFontsContext } from "./SiteFonts";
import { pageFontKeys, typographyVars } from "@/data/fonts";
import type { CustomFont } from "@/data/landingTypes";
import SiteFooter from "./SiteFooter";
import SiteLoader from "./loader/SiteLoader";
import { MAIN_ID, PageH1, SkipLink } from "./PageLandmarks";
import DrawnPageSections from "./DrawnPageSections";
import LandingActionProvider from "./LandingActionProvider";
import { useLandingMotion } from "./useLandingMotion";
import { useSiteConfig } from "@/lib/useSiteConfig";
import { HoverDefaultContext, DEFAULT_HOVER_EFFECT } from "./hoverEffect";
import { FormsContext, NO_FORMS } from "./formsContext";
import { useLandingStore } from "@/stores/landingStore";
import type { DrawnPage, SiteConfig } from "@/data/landingTypes";

const NO_CUSTOM_FONTS: CustomFont[] = [];

interface SubPageViewProps {
  page: DrawnPage;
  /** Server render instant — forwarded to DrawnPageSections for scheduling. */
  serverNow?: number | null;
  /** Published site config loaded on the server (see useSiteConfig). */
  initialSiteConfig?: SiteConfig;
}

export default function SubPageView({
  page,
  serverNow = null,
  initialSiteConfig,
}: SubPageViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const language = useLandingStore((s) => s.language);
  const setLanguage = useLandingStore((s) => s.setLanguage);

  // Restore saved language on first paint (mirrors LandingPage).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("creatofolio-language");
      if (saved === "en" || saved === "ar") setLanguage(saved);
    } catch {
      // ignore (private mode, etc.)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Section reveals + parallax. The hero-pin branch inside the hook is a no-op
  // here (no `#hero` element), so only the reveal/parallax wiring runs.
  useLandingMotion(rootRef, page);

  const siteConfig = useSiteConfig(initialSiteConfig);
  // Loading screen, when it is set to show on every page (not just home).
  const loader =
    initialSiteConfig?.loader?.enabled && initialSiteConfig.loader.pages === "all"
      ? initialSiteConfig.loader
      : null;

  // Fetch the drawn pop-up look early so the first pop-up opens dressed.
  useEffect(() => preloadPopupStyles(), []);

  return (
    <div
      ref={rootRef}
      className="landing-root"
      data-landing-mode="scroll"
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      data-nav-lang={navLangAttr(siteConfig.header)}
      style={typographyVars(siteConfig.typography, language) as React.CSSProperties | undefined}
    >
      {loader && <SiteLoader config={loader} />}
      <SkipLink language={language} />
      <SiteFonts typography={siteConfig.typography} extraKeys={[...pageFontKeys(page), ...navFontKeys(siteConfig.header)]} />
      <AnnouncementBar
        config={siteConfig.announcementBar}
        language={language}
      />
      <SiteNav config={siteConfig.header} language={language} langSkin={siteConfig.chrome?.languagePill} />
      <LanguagePill skin={siteConfig.chrome?.languagePill} />
      <CustomFontsContext.Provider value={siteConfig.typography?.customFonts ?? NO_CUSTOM_FONTS}>
      <FormsContext.Provider value={siteConfig.forms ?? NO_FORMS}>
        <HoverDefaultContext.Provider
          value={siteConfig.interactions?.hoverEffect ?? DEFAULT_HOVER_EFFECT}
        >
          <LandingActionProvider page={page}>
            <main id={MAIN_ID} tabIndex={-1} className="outline-none">
              <PageH1 page={page} site={siteConfig} language={language} />
              <DrawnPageSections page={page} serverNow={serverNow} />
            </main>
          </LandingActionProvider>
        </HoverDefaultContext.Provider>
      </FormsContext.Provider>
      </CustomFontsContext.Provider>
      <SiteFooter config={siteConfig.footer} language={language} />
    </div>
  );
}
