// Landing-page store.
//
// Mirrors the structural pattern of editorStore.ts but smaller — no undo,
// no DB sync, just runtime mode + language + capability flags. Multiple
// unrelated components subscribe (CabinetStage transforms, GameWrapper HUD
// visibility, useLandingMotion lenis/scrolltrigger lifecycle, wheel
// listeners), so a Zustand store beats React Context (which would render-
// cascade).

import { create } from "zustand";

export type LandingMode =
  | "scroll"            // default — page scrolls, hero pins, Phaser ambient
  | "transitioning-in"  // zoom tween: cabinet → fullscreen (CSS-var tween on desktop, screen FLIP on mobile)
  | "play"              // body locked, Phaser has input
  | "transitioning-out"; // reverse zoom back to the pinned slot

export type Language = "en" | "ar";

interface LandingState {
  mode: LandingMode;
  language: Language;
  /** True if `(prefers-reduced-motion: reduce)` is set. */
  isReducedMotion: boolean;
  /** True if `(hover: none)` / `(pointer: coarse)` — i.e. touch only. */
  isTouchOnly: boolean;
  /** True once we've already shown the "scroll down to exit" hint. */
  hasSeenExitHint: boolean;
  /**
   * True while a game-internal modal (InteractionModal, AvatarCreator)
   * is open. CabinetStage reads this in its wheel/touch hijack so it
   * doesn't intercept input meant for the modal — without this flag,
   * scrolling while a modal is up would drain --play-scale behind the
   * modal and leave the user stuck. GameWrapper writes to it whenever
   * one of those modals mounts / unmounts.
   */
  isGameModalOpen: boolean;

  setMode: (mode: LandingMode) => void;
  setLanguage: (lang: Language) => void;
  setCapabilities: (caps: { isReducedMotion?: boolean; isTouchOnly?: boolean }) => void;
  markExitHintSeen: () => void;
  setGameModalOpen: (v: boolean) => void;
}

export const useLandingStore = create<LandingState>((set) => ({
  mode: "scroll",
  language: "en",
  isReducedMotion: false,
  isTouchOnly: false,
  hasSeenExitHint: false,
  isGameModalOpen: false,

  setMode: (mode) => set({ mode }),
  setLanguage: (language) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("creatofolio-language", language);
      } catch {
        // ignore (private mode, etc.)
      }
    }
    // Keep <html lang/dir> in step for the public site (screen readers, SEO).
    // The admin UI stays LTR English whatever its previews show.
    if (typeof document !== "undefined" && !window.location.pathname.startsWith("/admin")) {
      document.documentElement.lang = language;
      document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    }
    set({ language });
  },
  setCapabilities: (caps) => set((s) => ({ ...s, ...caps })),
  markExitHintSeen: () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("creatofolio-seen-exit-hint", "1");
      } catch {
        // ignore
      }
    }
    set({ hasSeenExitHint: true });
  },
  setGameModalOpen: (v) => set({ isGameModalOpen: v }),
}));

// ─── Selectors (convenience) ────────────────────────────────────

/**
 * True for any non-scroll mode (play + both transitions). Components
 * read this to decide between "scroll-mode UI" (language pill, CTA on
 * the cabinet) and "play-mode UI" (HUD, close button, hint).
 *
 * Why both transitions: the cabinet wrapper (and on mobile, the screen
 * div) is being GSAP-animated during them. If conditional children
 * inside an animated ancestor unmount/remount mid-tween, React 19's DOM
 * reconciliation collides with the style mutations and throws
 * `insertBefore: not a child of this node`. Keeping the same children
 * mounted across both transitioning-in and transitioning-out avoids
 * that — UI swaps happen via CSS attribute flips, never via mount
 * changes mid-tween.
 */
export const selectIsPlayMode = (s: LandingState) => s.mode !== "scroll";
