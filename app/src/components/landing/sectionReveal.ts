"use client";

// Section reveal choreography — ONE implementation used by the live page
// (useLandingMotion, on scroll) and the editor ("Preview animation" button),
// so what the owner previews is exactly what visitors get.
//
// Principles (the old version faded the whole <section>, paper and torn
// edges included, which read as cheap):
//   - The PAPER never moves. Only the content on it is choreographed:
//     heading → subheading → elements, elements in top-to-bottom order.
//   - Tween the individual `translate` / `rotate` / `scale` CSS properties,
//     never `transform`: every element already uses `transform` for its
//     authored rotation (the .drawn-asset-pos rule) and parallax writes
//     transform too — the individual properties compose on top of both.
//   - Everything is cleared when the reveal finishes, so the DOM ends up
//     exactly as authored (and the editor's handles line up again).

import gsap from "gsap";

export type RevealStyle = "fade-up" | "fade" | "parallax" | "ink" | "place" | "none";

// GSAP treats `rotate` / `scale` as ITS transform shorthands (it would write
// `transform` and clobber the element's authored rotation), so those two go
// through CSS variables that feed the individual properties — see
// globals.css `.drawn-asset-pos { rotate: var(--rv-rot) … }`. `translate`
// has no GSAP alias and is tweened directly.
const CLEAR = "opacity,translate,clipPath,visibility,--rv-rot,--rv-scale";

function contentTargets(sec: HTMLElement) {
  // The title elements (titleRole) lead, wherever they were moved to.
  const heading = sec.querySelector<HTMLElement>('.drawn-asset-pos[data-title-role="heading"]');
  const sub = sec.querySelector<HTMLElement>('.drawn-asset-pos[data-title-role="subheading"]');
  // Top-to-bottom reading order (then left-to-right) — the order a visitor's
  // eye meets them, whatever their DOM/z order is.
  const assets = Array.from(sec.querySelectorAll<HTMLElement>(".drawn-asset-pos"))
    .filter((el) => el.offsetParent !== null && el !== heading && el !== sub)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
    .map((x) => x.el);
  return { heading, sub, assets };
}

/**
 * Build (paused) the reveal timeline for one section, putting its content in
 * the hidden start state immediately. Returns null for "none" / nothing to
 * animate. Call `.play()` to run it.
 */
export function buildSectionReveal(
  sec: HTMLElement,
  style: RevealStyle | string | undefined
): gsap.core.Timeline | null {
  if (!style || style === "none") return null;
  const { heading, sub, assets } = contentTargets(sec);
  const text = [heading, sub].filter((x): x is HTMLElement => Boolean(x));
  const all = [...text, ...assets];
  if (all.length === 0) return null;

  const rtl = sec.dir === "rtl";
  const tl = gsap.timeline({
    paused: true,
    defaults: { ease: "power3.out" },
    onComplete: () => {
      gsap.set(all, { clearProps: CLEAR });
    },
  });

  switch (style) {
    case "fade":
    case "parallax": {
      // Quiet: opacity only (parallax sections get their drift separately).
      tl.fromTo(all, { opacity: 0 }, { opacity: 1, duration: 0.9, stagger: 0.08, ease: "power1.out" });
      break;
    }
    case "ink": {
      // Wiped on like ink across the page, in reading direction.
      const hidden = rtl ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
      tl.fromTo(
        all,
        { clipPath: hidden, opacity: 1 },
        { clipPath: "inset(0 0% 0 0%)", duration: 1.05, stagger: 0.12, ease: "power2.inOut" }
      );
      break;
    }
    case "place": {
      // Paper cut-outs set down on the sheet: drop in slightly large and
      // askew, settle with a little overshoot. Text just rises.
      if (text.length) {
        tl.fromTo(text, { opacity: 0, translate: "0 18px" }, { opacity: 1, translate: "0 0px", duration: 0.7, stagger: 0.1 });
      }
      if (assets.length) {
        tl.fromTo(
          assets,
          {
            opacity: 0,
            "--rv-scale": 1.08,
            "--rv-rot": (i: number) => `${i % 2 ? 2.5 : -2.5}deg`,
            translate: "0 -10px",
          },
          {
            opacity: 1,
            "--rv-scale": 1,
            "--rv-rot": "0deg",
            translate: "0 0px",
            duration: 0.75,
            stagger: 0.09,
            ease: "back.out(1.7)",
          },
          text.length ? "-=0.35" : 0
        );
      }
      break;
    }
    case "fade-up":
    default: {
      // Rise (default): the heading lifts out from under its own baseline
      // (clip + rise), the line under it follows, then elements float up in
      // reading order.
      if (heading) {
        tl.fromTo(
          heading,
          { opacity: 0, translate: "0 0.45em", clipPath: "inset(0 0 100% 0)" },
          { opacity: 1, translate: "0 0em", clipPath: "inset(0 0 -25% 0)", duration: 0.85 }
        );
      }
      if (sub) {
        tl.fromTo(sub, { opacity: 0, translate: "0 14px" }, { opacity: 1, translate: "0 0px", duration: 0.7 }, heading ? "-=0.55" : 0);
      }
      if (assets.length) {
        tl.fromTo(
          assets,
          { opacity: 0, translate: "0 28px" },
          { opacity: 1, translate: "0 0px", duration: 0.8, stagger: 0.08 },
          text.length ? "-=0.45" : 0
        );
      }
      break;
    }
  }
  return tl;
}
