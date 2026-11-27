"use client";

// AnnouncementBar — thin site-wide strip above the header, driven by
// SiteConfig.announcementBar. Dismissible per-visitor via localStorage,
// keyed by the announcement's own text so editing the copy re-shows it for
// everyone (a stale dismiss shouldn't hide a NEW announcement).

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { AnnouncementBarConfig } from "@/data/landingTypes";

const STORAGE_KEY = "creatofolio-announcement-dismissed";
const subscribeNever = () => () => {};

export default function AnnouncementBar({
  config,
  language,
}: {
  config: AnnouncementBarConfig;
  language: "en" | "ar";
}) {
  const text = config.text[language] || config.text.en;

  // The real config now arrives with the server render, so the stored dismiss
  // can't be read during the first client render (the server HTML had no
  // localStorage and would mismatch). useSyncExternalStore renders the server
  // snapshot (not dismissed) during hydration, then re-renders with the real
  // value; a visitor who dismissed it sees the bar for a frame at most.
  const storedDismissed = useSyncExternalStore(
    subscribeNever,
    () => {
      if (!config.dismissible) return false;
      try {
        return localStorage.getItem(STORAGE_KEY) === text;
      } catch {
        return false;
      }
    },
    () => false
  );
  // The click itself is real state, not derived — a plain useState is right here.
  const [manuallyDismissed, setManuallyDismissed] = useState(false);
  const dismissed = storedDismissed || manuallyDismissed;

  if (!config.enabled || !text || dismissed) return null;

  const dismiss = () => {
    setManuallyDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {
      // ignore (private mode, etc.)
    }
  };

  const inner = (
    <span className="mx-auto max-w-3xl px-8 text-center">{text}</span>
  );

  return (
    <div
      role="region"
      aria-label={language === "ar" ? "إعلان" : "Announcement"}
      className="site-announcement-bar relative z-30 flex items-center justify-center px-4 py-2 text-sm font-medium"
      style={{ background: config.bg, color: config.color }}
    >
      {config.href ? (
        <a href={config.href} className="hover:underline">
          {inner}
        </a>
      ) : (
        inner
      )}
      {config.dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={language === "ar" ? "إغلاق" : "Dismiss"}
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-3 opacity-80 hover:opacity-100 focus-visible:outline-3 focus-visible:outline-offset-2"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
