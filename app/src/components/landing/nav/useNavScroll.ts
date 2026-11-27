"use client";

// useNavScroll — the nav's scroll-driven state:
//   hidden  hideOnScroll: slid away while scrolling down; afterHero: until
//           the hero has scrolled past
//   solid   the bar background is showing (a transparent-over-hero nav gains
//           it once it's past the hero)
//   activeHash  the `#anchor` nav link whose section is on screen now
//
// Works against the window (the real site) or a scroll container (the Nav
// Studio's preview), so the studio shows the real behaviour.

import { useEffect, useState } from "react";
import type { NavScroll } from "@/data/landingTypes";

/** The hero, or its GSAP pin spacer (which is as tall as the pinned scroll). */
function heroEl(scope: ParentNode): HTMLElement | null {
  const hero = scope.querySelector<HTMLElement>("#hero, [data-nav-hero]");
  if (!hero) return null;
  const parent = hero.parentElement;
  return parent?.classList.contains("pin-spacer") ? parent : hero;
}

export function useNavScroll({
  mode,
  transparent,
  frozen,
  scrollRoot,
  header,
  menuOpen,
  hashTargets,
}: {
  mode: NavScroll;
  /** overHero: "transparent" — no background until past the hero. */
  transparent: boolean;
  /** Editor canvas: no scroll behaviour, always shown. */
  frozen: boolean;
  /** Preview scroll container; null = the window. */
  scrollRoot: HTMLElement | null;
  header: HTMLElement | null;
  menuOpen: boolean;
  /** Ids targeted by `#anchor` links. */
  hashTargets: string[];
}) {
  const [hidden, setHidden] = useState(mode === "afterHero" && !frozen);
  const [solid, setSolid] = useState(!transparent || mode === "afterHero");
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const hashKey = hashTargets.join("|");

  useEffect(() => {
    if (frozen) return;
    const target: HTMLElement | Window = scrollRoot ?? window;
    const scope: ParentNode = scrollRoot ?? document;
    const ids = hashKey ? hashKey.split("|") : [];
    let lastY = scrollRoot ? scrollRoot.scrollTop : window.scrollY;
    let hiddenNow = mode === "afterHero";
    let raf = 0;

    const update = () => {
      raf = 0;
      const y = scrollRoot ? scrollRoot.scrollTop : window.scrollY;
      const viewH = scrollRoot ? scrollRoot.clientHeight : window.innerHeight;
      const topEdge = scrollRoot ? scrollRoot.getBoundingClientRect().top : 0;
      const navH = header?.querySelector<HTMLElement>(".site-nav__inner")?.offsetHeight || 64;

      const hero = heroEl(scope);
      const pastHero = hero
        ? hero.getBoundingClientRect().bottom - topEdge <= navH
        : y > viewH * 0.6;

      if (mode === "afterHero") hiddenNow = !pastHero;
      else if (mode === "hideOnScroll") {
        const dy = y - lastY;
        if (y <= navH) hiddenNow = false;
        else if (dy > 4) hiddenNow = true;
        else if (dy < -4) hiddenNow = false;
      } else hiddenNow = false;
      lastY = y;

      setHidden(hiddenNow);
      setSolid(!transparent || mode === "afterHero" || (hero ? pastHero : y > 24));

      if (ids.length) {
        // The last anchored section whose top has passed 40% of the screen.
        let current: string | null = null;
        for (const id of ids) {
          const el =
            scope.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ??
            scope.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
          if (el && el.getBoundingClientRect().top - topEdge <= viewH * 0.4) current = id;
        }
        setActiveHash(current);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mode, transparent, frozen, scrollRoot, header, hashKey]);

  if (frozen) return { hidden: false, solid: true, activeHash: null };
  return { hidden: hidden && !menuOpen, solid: solid || menuOpen, activeHash };
}

/** True below the nav's phone breakpoint (768px, same as sections). */
export function useIsPhone(force?: "desktop" | "mobile"): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (force) return;
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [force]);
  return force ? force === "mobile" : phone;
}
