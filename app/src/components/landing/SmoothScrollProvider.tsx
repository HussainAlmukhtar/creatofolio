"use client";

// SmoothScrollProvider — global Lenis + GSAP plugin registration.
//
// Mounted once in app/layout.tsx, but BYPASSED on /admin/* routes (the
// editor needs predictable native scroll). The Lenis instance is created
// only when `prefers-reduced-motion: no-preference`; reduced-motion
// users get native browser scrolling.
//
// The RAF loop is driven by GSAP's ticker, not Lenis's autoRaf — this
// keeps Lenis and ScrollTrigger frame-locked (preventing the double-RAF
// jitter you get with autoRaf), and is the canonical pattern used by
// darkroomengineering/satus, the Lenis authors' own starter.

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let pluginsRegistered = false;
function registerPluginsOnce() {
  if (pluginsRegistered || typeof window === "undefined") return;
  // NOTE: the GSAP Flip plugin is intentionally NOT used anywhere — the
  // cabinet zoom is CSS-variable tweens and the mobile breakout is a
  // hand-rolled FLIP. Flip's absolute-position reparenting is what
  // collided with React 19 reconciliation (insertBefore crashes).
  gsap.registerPlugin(ScrollTrigger);
  // Avoid ScrollTrigger refreshes on iOS address-bar show/hide — these
  // refreshes break pin spacers and produce visible jumps.
  ScrollTrigger.config({ ignoreMobileResize: true });
  pluginsRegistered = true;
}

export default function SmoothScrollProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // The admin editor relies on predictable, deterministic scroll (Konva
  // hit-testing, Phaser preview, drag-drop). Lenis intercepts wheel
  // events globally, so we skip mounting it on any /admin/* route.
  const bypass = pathname?.startsWith("/admin") ?? false;

  useLayoutEffect(() => {
    if (bypass) return;
    if (typeof window === "undefined") return;

    registerPluginsOnce();

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) return;

    const lenis = new Lenis({
      duration: 1.2,
      smoothWheel: true,
      // syncTouch:false leaves native momentum on touch; setting it true is
      // what causes the iOS lag everyone complains about. Wheel still gets
      // the smooth catch-up.
      syncTouch: false,
    });

    // Expose Lenis to other modules (CabinetStage needs lenis.stop()/start()
    // around the play-mode zoom). Globals are the cheapest cross-component
    // handle; a context provider would force a render cascade.
    (window as unknown as { __lenis__?: Lenis }).__lenis__ = lenis;

    // Drive Lenis's RAF from GSAP's ticker so ScrollTrigger updates are
    // frame-locked with the smooth scroll. lenis.on("scroll") nudges
    // ScrollTrigger to recompute on the same frame.
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    // Critical: GSAP's ticker auto-sleeps after ~2s of no active
    // tweens. `.add(raf)` does NOT force-wake the engine, and our
    // ScrollTrigger scrubs are scroll-driven (not ticker-driven), so
    // they never wake it either. Without this call, the first
    // `gsap.to(...)` we create from CabinetStage never gets a tick and
    // the tween is stuck at start. Confirmed via the GSAP forum.
    gsap.ticker.wake();

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      delete (window as unknown as { __lenis__?: Lenis }).__lenis__;
    };
  }, [bypass]);

  return <>{children}</>;
}
