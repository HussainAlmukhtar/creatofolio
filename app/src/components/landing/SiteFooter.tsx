"use client";

// SiteFooter — site-wide footer, driven by SiteConfig.footer. Replaces the
// footer block that used to be hand-duplicated, identically, in both
// LandingPage.tsx (home) and SubPageView.tsx (sub-pages). Keeps the
// `landing-footer` class name so the existing play-mode hide rule
// (`.landing-root:not([data-landing-mode="scroll"]) .landing-footer`) and
// fade transition in globals.css keep working unchanged.

import SectionSurface from "./SectionSurface";
import type {
  FooterConfig,
  SectionSurface as SectionSurfaceConfig,
} from "@/data/landingTypes";

const FOOTER_SURFACE: SectionSurfaceConfig = {
  kind: "paper",
  color: "var(--paper-3)",
  grain: true,
  tornEdge: { top: "deckle" },
};

export default function SiteFooter({
  config,
  language,
}: {
  config: FooterConfig;
  language: "en" | "ar";
}) {
  if (!config.enabled) return null;
  const brand = config.brandLine[language] || config.brandLine.en;
  const copyright = config.copyright[language] || config.copyright.en;

  return (
    <footer className="landing-footer relative py-14 text-center text-sm">
      {/* The footer is the last sheet on the pile: a deeper paper tone with a
          deckled top edge laid over the page's final section. */}
      <SectionSurface surface={FOOTER_SURFACE} seed="site-footer" />
      <div className="relative z-10">
        <div className="mx-auto mb-6 h-px w-16 bg-line" aria-hidden="true" />
        {brand && (
          <p className="mb-3 font-display text-base font-semibold text-ink">
            {brand}
          </p>
        )}
        {config.links.length > 0 && (
          <nav aria-label={language === "ar" ? "التذييل" : "Footer"} className="mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {config.links.map((link) => (
              <a
                key={link.id}
                href={link.href}
                target={link.newTab ? "_blank" : undefined}
                rel={link.newTab ? "noopener noreferrer" : undefined}
                className="text-ink-soft transition hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-2"
              >
                {link.label[language] || link.label.en}
              </a>
            ))}
          </nav>
        )}
        <span className="text-ink-soft">{copyright}</span>
      </div>
    </footer>
  );
}
