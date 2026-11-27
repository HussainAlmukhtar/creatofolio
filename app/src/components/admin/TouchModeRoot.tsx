"use client";

// Mounted once by app/admin/layout.tsx. Keeps <html data-touch> in sync with
// the input mode (see lib/touchMode.ts) and, in touch mode, gives every
// hover-only hint a finger equivalent:
//
// - Long-press (≈0.5 s, finger or Apple Pencil) on anything with `data-tip`,
//   `title` or `aria-label` shows that text in a bubble. The click that would
//   follow the hold is swallowed, so peeking at a label never fires it.
// - A plain tap on `[data-tip-tap]` (pure "what is this?" buttons) shows the
//   bubble instead of doing anything else.
//
// `title=` tooltips and Radix tooltips never open on touch, so without this
// ~250 icon-button labels would be unreachable on an iPad.

import { useEffect, useRef, useState } from "react";
import { isTouchMode, syncTouchAttribute } from "@/lib/touchMode";

const HOLD_MS = 480;
const SLOP_PX = 10;
const SHOW_AFTER_RELEASE_MS = 2200;

// Text fields keep their own long-press (select / paste); canvas surfaces keep
// theirs (drag, the room canvas's own long-press menu).
const NO_TIP =
  "[data-touch-exempt],[data-no-tip],input,textarea,select,[contenteditable=true],canvas,.asset-hitbox,.moveable-control-box";

const HOSTS =
  "[data-tip],[title],button,a[href],[role=button],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=option]";

function tipFor(target: EventTarget | null): { rect: DOMRect; text: string } | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(NO_TIP)) return null;
  const host = target.closest<HTMLElement>(HOSTS);
  if (!host) return null;
  const text = (
    host.dataset.tip ||
    host.getAttribute("title") ||
    host.getAttribute("aria-label") ||
    ""
  ).trim();
  return text ? { rect: host.getBoundingClientRect(), text } : null;
}

export function TouchModeRoot() {
  const [tip, setTip] = useState<{ rect: DOMRect; text: string } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => syncTouchAttribute(), []);

  // Dev only (the branch is dead code in production builds): window.__touchSim
  // drives the editors with synthetic pointer / touch / gesture events.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    void import("@/lib/dev/touchSim").then((m) => {
      (window as unknown as { __touchSim?: unknown }).__touchSim = m.touchSim;
    });
  }, []);

  // The iPad on-screen keyboard shrinks only the VISUAL viewport (100dvh stays
  // the same), so a centred modal can end up under the keys. Publish the
  // visible area as --app-vvh / --app-vv-top and flag <html data-keyboard>;
  // the touch CSS layer fits open modals and dialogs into it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--app-vvh", `${Math.round(vv.height)}px`);
      root.style.setProperty("--app-vv-top", `${Math.round(vv.offsetTop)}px`);
      if (isTouchMode() && window.innerHeight - vv.height > 120) root.setAttribute("data-keyboard", "");
      else root.removeAttribute("data-keyboard");
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.removeAttribute("data-keyboard");
      root.style.removeProperty("--app-vvh");
      root.style.removeProperty("--app-vv-top");
    };
  }, []);

  useEffect(() => {
    let hold: ReturnType<typeof setTimeout> | null = null;
    let start: { x: number; y: number } | null = null;
    // Set when a hold showed a bubble: the click/contextmenu that follows the
    // release belongs to the peek, not to the control.
    let swallowUntil = 0;
    let shownThisPress = false;

    const clearHold = () => {
      if (hold) clearTimeout(hold);
      hold = null;
    };
    const show = (next: { rect: DOMRect; text: string }, stay = false) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setTip(next);
      if (!stay) hideTimer.current = setTimeout(() => setTip(null), SHOW_AFTER_RELEASE_MS);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !isTouchMode()) return;
      setTip(null);
      shownThisPress = false;
      clearHold();
      const found = tipFor(e.target);
      if (!found) return;
      start = { x: e.clientX, y: e.clientY };
      hold = setTimeout(() => {
        hold = null;
        shownThisPress = true;
        navigator.vibrate?.(8);
        show(found, true);
      }, HOLD_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) {
        clearHold();
        start = null;
        if (shownThisPress) setTip(null);
      }
    };
    const onUp = () => {
      clearHold();
      start = null;
      if (shownThisPress) {
        swallowUntil = Date.now() + 450;
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setTip(null), SHOW_AFTER_RELEASE_MS);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (Date.now() < swallowUntil) {
        swallowUntil = 0;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!isTouchMode()) return;
      const tapHost = (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip-tap]");
      if (!tapHost) return;
      const found = tipFor(tapHost);
      if (!found) return;
      e.preventDefault();
      e.stopPropagation();
      show(found);
    };
    const onContextMenu = (e: MouseEvent) => {
      // Android fires contextmenu on a long-press; iOS shows its own callout.
      if (shownThisPress || Date.now() < swallowUntil) e.preventDefault();
    };
    const hide = () => setTip(null);

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      clearHold();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip) return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const cx = Math.min(Math.max(tip.rect.left + tip.rect.width / 2, 150), vw - 150);
  const above = tip.rect.top > 72;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[2000] max-w-[280px] rounded-lg bg-neutral-950/95 px-3 py-2 text-[14px] leading-snug text-white shadow-xl ring-1 ring-white/15"
      style={{
        left: cx,
        top: above ? tip.rect.top - 10 : tip.rect.bottom + 10,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
      }}
    >
      {tip.text}
    </div>
  );
}
