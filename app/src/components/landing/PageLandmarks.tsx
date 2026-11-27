"use client";

// Page-level landmarks for the public landing pages (home and /<slug>):
//   - SkipLink  — first focusable element; jumps past the header to <main>.
//   - PageH1    — the page's one <h1>, visually hidden. The drawn sections are
//                 pictures and h2 titles; without it the page has no heading
//                 outline root for screen readers or search engines.
//
// Both only add semantics: nothing here is visible until the skip link gets
// keyboard focus, so the drawn design is untouched.

import type { DrawnPage, SiteConfig } from "@/data/landingTypes";

export const MAIN_ID = "main-content";

export function SkipLink({ language }: { language: "en" | "ar" }) {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-paper-0 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg focus:outline-3 focus:outline-offset-2"
      onClick={(e) => {
        // The hero is pinned/scroll-driven, so a bare #hash jump is unreliable:
        // move focus explicitly and let the browser scroll it into view.
        const main = document.getElementById(MAIN_ID);
        if (!main) return;
        e.preventDefault();
        main.focus({ preventScroll: false });
      }}
    >
      {language === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}
    </a>
  );
}

/** The visually-hidden page title (<h1>). Falls back to the site name. */
export function PageH1({
  page,
  site,
  language,
}: {
  page: DrawnPage;
  site: SiteConfig;
  language: "en" | "ar";
}) {
  const text =
    page.meta?.title?.[language]?.trim() ||
    page.meta?.title?.en?.trim() ||
    site.header.logoText?.[language]?.trim() ||
    site.header.logoText?.en?.trim() ||
    "Creatofolio";
  return <h1 className="sr-only">{text}</h1>;
}
