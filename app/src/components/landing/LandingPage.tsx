"use client";

// LandingPage — top-level client component rendered by app/page.tsx.
//
// Responsibilities:
//   - Mount hero + drawn sections in order
//   - Initialize language from localStorage on first paint
//   - Drive scroll/zoom animations via useLandingMotion
//   - Render the corner language pill
//
// The page is the published Supabase row (`initialPage`, or `previewPage` in
// the editor); the built-in page in landingConfig.ts is the fallback.

import { preloadPopupStyles } from "@/components/popup/PopupLook";
import { useEffect, useRef, useState } from "react";
import HeroSection from "./HeroSection";
import DrawnPageSections from "./DrawnPageSections";
import LandingActionProvider from "./LandingActionProvider";
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
import { useLandingMotion } from "./useLandingMotion";
import { useSiteConfig } from "@/lib/useSiteConfig";
import { HoverDefaultContext, DEFAULT_HOVER_EFFECT } from "./hoverEffect";
import { FormsContext, NO_FORMS } from "./formsContext";
import { useLandingStore, selectIsPlayMode } from "@/stores/landingStore";
import { defaultLandingPage } from "@/data/landingConfig";
import { loadPublishedLandingPage } from "@/lib/landingData";
import type { DrawnPage, SiteConfig } from "@/data/landingTypes";

const NO_CUSTOM_FONTS: CustomFont[] = [];

interface LandingPageProps {
  /**
   * Render THIS page instead of loading the published one — used by the
   * owner-only draft preview (/admin/landing-editor/preview/home). When set,
   * the published-page fetch is skipped entirely.
   */
  previewPage?: DrawnPage;
  /**
   * The published page, already loaded on the server (app/page.tsx). Start
   * from it, mark the arcade ready and skip the client re-fetch — unlike
   * `previewPage` this changes nothing else about the live page's behaviour.
   */
  initialPage?: DrawnPage;
  /** Published site config loaded on the server (header/footer/fonts), so the
   *  first paint has the real chrome instead of swapping it in. */
  initialSiteConfig?: SiteConfig;
}

export default function LandingPage({ previewPage, initialPage, initialSiteConfig }: LandingPageProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const language = useLandingStore((s) => s.language);
  const setLanguage = useLandingStore((s) => s.setLanguage);

  // Seed synchronously from the static config for instant paint, then swap in
  // the published DB row once it loads (same pattern as InteractionModal's
  // content load). Falls back to the seed silently on any miss/timeout — the
  // public page must never break.
  const [page, setPage] = useState<DrawnPage>(
    previewPage ?? initialPage ?? defaultLandingPage,
  );
  // The arcade is authored art: showing the seed's default cabinet for a
  // beat before the published one swaps in reads as a glitch. Hold the hero
  // invisible until the load settles (it always settles: the loader falls
  // back on any miss/timeout), then fade it in.
  const [arcadeReady, setArcadeReady] = useState(Boolean(previewPage ?? initialPage));
  useEffect(() => {
    if (previewPage || initialPage) return;
    let cancelled = false;
    loadPublishedLandingPage("home").then((loaded) => {
      if (!cancelled) setArcadeReady(true);
      // Skip the swap when the DB row is absent or identical to the seed —
      // re-setting state would re-run useLandingMotion needlessly (its deps
      // include `page`). JSON compare is cheap relative to a ScrollTrigger
      // rebuild and avoids a flash on the common "DB == seed" case.
      if (cancelled || !loaded) return;
      if (JSON.stringify(loaded) === JSON.stringify(page)) return;
      setPage(loaded);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore saved language on first paint.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("creatofolio-language");
      if (saved === "en" || saved === "ar") {
        setLanguage(saved);
      }
    } catch {
      // ignore
    }
    try {
      if (localStorage.getItem("creatofolio-seen-exit-hint") === "1") {
        useLandingStore.getState().markExitHintSeen();
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire ScrollTrigger + IntersectionObserver. Bound to rootRef so the
  // gsap.context cleanup catches everything on unmount. `page` is a dep so a
  // swapped-in DB page re-wires reveals/parallax against the new section DOM
  // (ctx.revert() in the hook's cleanup makes the re-run safe).
  useLandingMotion(rootRef, page);

  // `data-landing-mode` lets CSS toggle visibility of mode-specific UI
  // (LanguagePill, footer, controls hint, vignette, etc.) WITHOUT ever
  // unmounting/remounting them. We render the FULL mode string here
  // (scroll / transitioning-in / play / transitioning-out) so CSS rules
  // can apply to in-flight states — e.g. the vignette fade should
  // engage during transitioning-in, not just after play is reached.
  const mode = useLandingStore((s) => s.mode);
  // Kept for sibling components that only care about the binary scroll-
  // vs-play distinction (e.g. hiding the language pill).
  void selectIsPlayMode;

  // The section (if any) that hosts the arcade — its assets are drawn around
  // the cabinet by HeroSection.
  const gameSection = page.sections.find((s) => s.containsGame);

  const siteConfig = useSiteConfig(initialSiteConfig);
  // Loading screen: only on the real page with server-loaded settings (it is
  // in the first HTML), never in the owner's draft preview.
  const loader = !previewPage && initialSiteConfig?.loader?.enabled ? initialSiteConfig.loader : null;

  // Fetch the drawn pop-up look early so the first pop-up opens dressed.
  useEffect(() => preloadPopupStyles(), []);

  // The hero frames the arcade in the space BELOW the site nav (desktop), so
  // on wide screens the whole frame is visible at rest. Track the nav's real
  // height (it can wrap, float, be sticky, or be off) as CSS variables:
  //   --site-header-h        flow space it takes above the hero (0 floating)
  //   --site-header-overlay  space it covers over the pinned hero (only an
  //                          always-sticky, non-floating nav stays there)
  const header = siteConfig.header;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nav = root.querySelector<HTMLElement>(".site-header");
    const write = () => {
      const float = nav?.dataset.float === "true";
      const h = nav && !float ? nav.offsetHeight : 0;
      root.style.setProperty("--site-header-h", `${h}px`);
      const overlay = `${nav?.dataset.scroll === "sticky" ? h : 0}px`;
      const changed = root.style.getPropertyValue("--site-header-overlay") !== overlay;
      root.style.setProperty("--site-header-overlay", overlay);
      // The hero pin starts below the header — re-measure when it changes.
      if (changed) {
        import("gsap/ScrollTrigger").then(({ ScrollTrigger }) => ScrollTrigger.refresh());
      }
    };
    write();
    if (!nav) return;
    const ro = new ResizeObserver(write);
    ro.observe(nav);
    // The phone scroll override / float flag change the nav's attributes
    // without necessarily changing its size.
    const mo = new MutationObserver(write);
    mo.observe(nav, { attributes: true, attributeFilter: ["data-scroll", "data-float"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [header.enabled, header.scroll, header.overHero, header.mobile.scroll]);


  return (
    <div
      ref={rootRef}
      className="landing-root"
      data-landing-mode={mode}
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
            {/* The hero renders the game section's assets around the cabinet;
            DrawnPageSections skips that section and renders the rest. Both are
            inside the action provider so hero buttons can dispatch actions. */}
            <main id={MAIN_ID} tabIndex={-1} className="outline-none">
              <PageH1 page={page} site={siteConfig} language={language} />
              <HeroSection section={gameSection} ready={arcadeReady} />
              <DrawnPageSections page={page} />
            </main>
          </LandingActionProvider>
        </HoverDefaultContext.Provider>
      </FormsContext.Provider>
      </CustomFontsContext.Provider>
      <SiteFooter config={siteConfig.footer} language={language} />
    </div>
  );
}
