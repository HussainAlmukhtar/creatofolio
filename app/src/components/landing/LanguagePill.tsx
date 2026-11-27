"use client";

// LanguagePill — small EN/AR toggle pill in the corner of the landing
// page. Replaces the gating language-picker modal that previously
// blocked the game.
//
// IMPORTANT: this component is ALWAYS rendered. Visibility is toggled
// via CSS on the `[data-landing-mode]` ancestor on LandingPage. We do
// not conditionally unmount this — unmounts inside a GSAP-animated
// ancestor tree collide with React 19 concurrent rendering and throw
// `insertBefore: not a child of this node`.

import { useLandingStore } from "@/stores/landingStore";
import { chromeSlotAttrs, type ChromeSkin } from "@/data/chromeSkin";
import ChromeArt from "./ChromeArt";

export default function LanguagePill({ skin }: { skin?: ChromeSkin }) {
  const language = useLandingStore((s) => s.language);
  const setLanguage = useLandingStore((s) => s.setLanguage);

  const next = language === "en" ? "ar" : "en";
  const label = language === "en" ? "العربية" : "English";

  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      aria-label={
        language === "en" ? "Switch to Arabic" : "Switch to English"
      }
      className="language-pill chrome-slot fixed z-40"
      {...chromeSlotAttrs(skin, "languagePill")}
    >
      <ChromeArt skin={skin} language={language}>
        {label}
      </ChromeArt>
    </button>
  );
}
