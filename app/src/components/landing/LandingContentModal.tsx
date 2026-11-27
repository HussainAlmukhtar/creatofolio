"use client";

// LandingContentModal — opens rich content for a landing "button" asset whose
// action is { kind: "open-content" }. A lighter, self-contained cousin of the
// game's InteractionModal: no Phaser, no EventBridge — just a portal that loads
// website_page_content and shows it in the shared PopupModal (the same shell
// and block renderer as the game's room pop-ups).
//
// The pop-up `theme` comes from the hosting section's surface so the sheet's
// typography/colors blend with the paper vs digital look.

import { useContext, useEffect, useState } from "react";
import { PopupModal } from "@/components/popup/PopupModal";
import type { PopupTheme } from "@/components/popup/popupTheme";
import type { ObjectContent } from "@/data/contentTypes";
import { loadPageContentPublic } from "@/lib/landingData";
import { useLandingStore } from "@/stores/landingStore";
import { LandingContentOverrideContext } from "./LandingContentOverride";

interface LandingContentModalProps {
  pageSlug: string;
  assetIid: string;
  /** Section surface kind, so the modal theme matches its origin. */
  theme: PopupTheme;
  onClose: () => void;
}

export default function LandingContentModal({
  pageSlug,
  assetIid,
  theme,
  onClose,
}: LandingContentModalProps) {
  const language = useLandingStore((s) => s.language);
  // Only the owner's draft preview provides this; the public site never does.
  const override = useContext(LandingContentOverrideContext);
  const [fetched, setContent] = useState<ObjectContent | null>(null);
  // Starts true; the modal is keyed by assetIid at the call site, so a fresh
  // asset always remounts with loading=true rather than reusing this instance.
  const [fetchedLoading, setLoading] = useState(true);
  const content = override ? (override[assetIid] ?? null) : fetched;
  const loading = override ? false : fetchedLoading;

  useEffect(() => {
    if (override) return;
    let cancelled = false;
    loadPageContentPublic(pageSlug, assetIid).then((loaded) => {
      if (cancelled) return;
      setContent(loaded);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pageSlug, assetIid, override]);

  const isAr = language === "ar";
  const title = content ? (isAr ? content.titleAr || content.title : content.title || content.titleAr) : "";

  // PopupModal handles Esc, focus, dir, scroll lock and the empty state.
  return (
    <PopupModal
      language={language}
      title={title}
      content={content}
      loading={loading}
      theme={theme}
      onClose={onClose}
    />
  );
}
