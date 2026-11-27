"use client";

// useLandingMotion — owns ScrollTrigger lifecycle for the landing page.
//
// One gsap.matchMedia() block handles three contexts: desktop (pin +
// scrub), mobile (no pin, native scroll), and reduced-motion (no
// animation at all — gsap.set the destination state and bail).
//
// All ScrollTriggers are created inside a gsap.context() bound to the
// rootRef so React 19 strict-mode's throwaway first mount cleans up
// correctly via ctx.revert().
//
// Phaser pause/resume is wired here too: an IntersectionObserver on
// the hero flags the "hero-offscreen" sleep reason (true zero-CPU when
// scrolled away) via gameHandle, which arbitrates it against other
// sleep reasons (tab hidden) and works in production builds.

import { useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLandingStore } from "@/stores/landingStore";
import { setSleepReason } from "@/components/game/gameHandle";
import { buildSectionReveal } from "./sectionReveal";
import type { DrawnPage } from "@/data/landingTypes";
import { resolveArcade, type ArcadeDevice } from "@/data/arcadeConfig";
import { applyCamera, cameraAt, clearCamera } from "@/lib/arcadeCamera";

// Register at module-import time so the hook can be used regardless of
// whether SmoothScrollProvider has mounted yet. registerPlugin is
// idempotent; safe to also call from the provider.
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

// `pageKey` is any value that changes when the rendered sections change (the
// home page passes its DrawnPage). Including it in the effect deps re-wires
// ScrollTriggers against the new DOM after a data swap; ctx.revert() in the
// cleanup tears down the previous wiring first, so re-runs are safe.
export function useLandingMotion(
  rootRef: RefObject<HTMLElement | null>,
  pageKey?: unknown
) {
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const root = rootRef.current;
    if (!root) return;

    // Surface capability flags to the store so other components can read
    // them (e.g. CabinetStage skips the play-mode hint on reduced-motion).
    // Kept live via change listeners — an OS-level reduced-motion toggle
    // or an input-modality switch mid-session must take effect without a
    // reload (CabinetStage reads these flags at event time).
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const touchMq = window.matchMedia("(hover: none), (pointer: coarse)");
    const syncCapabilities = () => {
      useLandingStore.getState().setCapabilities({
        isReducedMotion: reduceMq.matches,
        isTouchOnly: touchMq.matches,
      });
    };
    syncCapabilities();
    reduceMq.addEventListener("change", syncCapabilities);
    touchMq.addEventListener("change", syncCapabilities);

    // Sub-pages have no arcade hero — skip the camera wiring there instead of
    // letting GSAP warn about missing #hero / .arcade-world targets.
    const hasHero = root.querySelector("#hero .arcade-world") !== null;
    // The arcade's authored scroll camera (home page passes its DrawnPage).
    const gameSection = (pageKey as DrawnPage | undefined)?.sections?.find?.(
      (s) => s.containsGame
    );
    const arcade = resolveArcade(gameSection?.arcade);

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          isDesktop:
            "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
          isMobile:
            "(max-width: 1023px) and (prefers-reduced-motion: no-preference)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const conds = context.conditions as {
            isDesktop?: boolean;
            isMobile?: boolean;
            reduceMotion?: boolean;
          };

          if (conds.reduceMotion) {
            // No pin, no scrub: the arcade holds its rest framing (CSS) and
            // the page scrolls natively.
            // Section reveals still happen via plain IntersectionObserver
            // toggling the .is-revealed class (handled below, no transform).
            wireSectionReveals(root, false);
            return;
          }

          // The arcade camera: desktop pins the hero while the keyframes
          // play; phones never pin — the keyframes play as the hero scrolls
          // past. The camera is written as CSS vars on .arcade-world (the
          // same channel CabinetStage's click-in dolly uses).
          let cleanupArcade: (() => void) | undefined;
          if (hasHero) {
            cleanupArcade = wireArcadeScroll(
              root,
              conds.isDesktop ? arcade.desktop : arcade.mobile,
              Boolean(conds.isDesktop)
            );
          }

          // Section reveals run on both isDesktop and isMobile.
          wireSectionReveals(root, true);

          // Run a refresh once fonts settle so pin math is correct.
          if (typeof document !== "undefined" && document.fonts?.ready) {
            document.fonts.ready.then(() => ScrollTrigger.refresh());
          }
          return cleanupArcade;
        }
      );

      // ── Phaser pause/resume on hero offscreen ────────────────
      const heroEl = root.querySelector<HTMLElement>("#hero");
      if (heroEl) {
        const io = new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            if (!entry) return;
            // In play mode the cabinet is fullscreen — offscreen-from-hero
            // doesn't mean offscreen-from-viewport, so the game must be
            // awake regardless of what the observer last saw.
            const mode = useLandingStore.getState().mode;
            if (mode !== "scroll") {
              setSleepReason("hero-offscreen", false);
              return;
            }
            setSleepReason("hero-offscreen", entry.intersectionRatio < 0.15);
          },
          { threshold: [0, 0.15, 0.5, 1] }
        );
        io.observe(heroEl);
        return () => {
          io.disconnect();
          // Don't leave a stale sleep request behind if the landing page
          // unmounts while the hero is offscreen.
          setSleepReason("hero-offscreen", false);
        };
      }
    }, rootRef);

    return () => {
      reduceMq.removeEventListener("change", syncCapabilities);
      touchMq.removeEventListener("change", syncCapabilities);
      ctx.revert();
    };
  }, [rootRef, pageKey]);
}

// ─── Arcade scroll camera ───────────────────────────────────────

/** Height (px) of a sticky site header covering the top of the viewport. */
function headerOverlay(root: HTMLElement): number {
  const v = parseFloat(getComputedStyle(root).getPropertyValue("--site-header-overlay"));
  return Number.isFinite(v) ? v : 0;
}

/**
 * Scrub the arcade camera through a device's keyframes. One proxy tween
 * (t: 0 → 1) is mapped through cameraAt(), which applies each segment's ease
 * and interpolates scale in log space. Returns a cleanup that drops the
 * inline camera so the next device's rest framing (CSS) shows through.
 */
function wireArcadeScroll(
  root: HTMLElement,
  device: ArcadeDevice,
  pin: boolean
): (() => void) | undefined {
  const world = root.querySelector<HTMLElement>("#hero .arcade-world");
  if (!world || !device.scroll.enabled || device.scroll.keyframes.length === 0) {
    return undefined;
  }

  // .is-moving scopes will-change: transform to the moments the camera is
  // actually moving — dropped ~150ms after it stops so the settled frame
  // re-rasters crisp (see globals.css).
  let idle: ReturnType<typeof setTimeout> | null = null;
  const markMoving = () => {
    world.classList.add("is-moving");
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => world.classList.remove("is-moving"), 150);
  };

  const proxy = { t: 0 };
  const tl = gsap
    .timeline({
      scrollTrigger: {
        id: pin ? "hero-pin" : "hero-scrub",
        trigger: "#hero",
        // Pin just below a sticky site header (it stays on screen) —
        // --site-header-overlay is measured by LandingPage (0 otherwise).
        start: () => `top top+=${headerOverlay(root)}`,
        end: `+=${device.scroll.lengthVh}%`,
        scrub: device.scroll.smoothing > 0 ? device.scroll.smoothing : true,
        pin,
        pinSpacing: pin,
        anticipatePin: pin ? 1 : 0,
        invalidateOnRefresh: true,
      },
    })
    .to(proxy, {
      t: 1,
      ease: "none",
      duration: 1,
      onUpdate: () => {
        applyCamera(world, cameraAt(device, proxy.t));
        markMoving();
      },
    });

  // A ScrollTrigger refresh (resize, fonts, CabinetStage re-enabling after
  // play) re-renders the timeline WITHOUT firing onUpdate, and outside the
  // trigger's range (scrolled past the zoom) nothing renders it again — the
  // camera would sit at whatever the refresh's internal reset left. Re-apply
  // the camera from the timeline's settled progress after every refresh.
  const onRefresh = () => applyCamera(world, cameraAt(device, tl.progress()));
  ScrollTrigger.addEventListener("refresh", onRefresh);

  return () => {
    ScrollTrigger.removeEventListener("refresh", onRefresh);
    if (idle) clearTimeout(idle);
    world.classList.remove("is-moving");
    clearCamera(world);
  };
}

// ─── Section reveals ────────────────────────────────────────────

function wireSectionReveals(root: HTMLElement, allowTransforms: boolean) {
  const sections = root.querySelectorAll<HTMLElement>(".drawn-section");
  sections.forEach((sec) => {
    const reveal = sec.dataset.reveal ?? "fade-up";

    if (!allowTransforms) {
      // Reduced motion: content is simply there — no hide, no movement.
      sec.classList.add("is-revealed");
      return;
    }

    // The paper stays put; only the content is choreographed (see
    // sectionReveal.ts). Reveal ONCE — re-hiding on scroll-back made the
    // page feel like it was un-drawing itself.
    const tl = buildSectionReveal(sec, reveal);
    if (tl) {
      ScrollTrigger.create({
        trigger: sec,
        start: "top 82%",
        once: true,
        onEnter: () => {
          tl.play();
        },
      });
    }

    // Parallax on individual decorative assets.
    sec.querySelectorAll<HTMLElement>('[data-parallax]').forEach((asset) => {
      const factor = parseFloat(asset.dataset.parallax ?? "0");
      if (factor === 0) return;
      gsap.to(asset, {
        yPercent: -factor * 60,
        ease: "none",
        scrollTrigger: {
          trigger: sec,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });
    });
  });
}
