"use client";

// PopupModal — the ONE visitor pop-up shell, shared by the game's room
// pop-ups (GameWrapper) and the landing button pop-ups (LandingContentModal).
//
// - Portal to <body>; `role="dialog"`, `aria-modal`, labelled by the title.
// - Focus moves into the sheet on open, Tab/Shift+Tab stay inside it, and focus
//   returns to whatever opened it on close. Esc closes.
// - A nested overlay (gallery lightbox, reel viewer; marked
//   `data-nested-overlay`) owns Esc/Tab while it is open.
// - `dir` follows the language; the page behind can't scroll while open.
// - Phones (< 640px) get a bottom card only as tall as its content (max 92dvh,
//   then the body scrolls). Drag the handle/header down, or tap the backdrop,
//   to close. Wider screens get a centred sheet sized by `content.size`.
// - Loading skeleton and a friendly bilingual empty state.
//
// The sheet markup lives in PopupSheet (shared with the composer preview).

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { safeMediaSrc } from "@/lib/safeUrl";
import { createPortal } from "react-dom";
import type { ObjectContent } from "@/data/contentTypes";
import { isContentEmpty, migrateObjectContent } from "@/data/contentMigrations";
import { PopupView } from "./PopupView";
import { PopupEmpty, PopupSheet, PopupSkeleton, type PopupDevice } from "./PopupSheet";
import type { PopupTheme } from "./popupTheme";
import { resolveLook, usePopupStyles } from "./PopupLook";

interface Props {
  language: "en" | "ar";
  /** Resolved title for the active language ("" = none). */
  title: string;
  content: ObjectContent | null;
  loading?: boolean;
  theme?: PopupTheme;
  onClose: () => void;
  /** Custom body instead of the content (e.g. the game's "leave the site?"
   *  confirm), with the same shell, focus handling and phone card. */
  children?: ReactNode;
  /** Desktop width when `children` is used (default: the content's size). */
  size?: "s" | "m" | "l";
  /** "alertdialog" for confirmations. */
  role?: "dialog" | "alertdialog";
  /** id of the element describing an alertdialog. */
  describedBy?: string;
  /** "Step through pop-ups": arrows + ←/→ (mirrored in Arabic) to the
   *  previous / next pop-up of the room. */
  nav?: PopupNavProps;
}

export interface PopupNavProps {
  index: number;
  count: number;
  prevLabel?: string;
  nextLabel?: string;
  onPrev: () => void;
  onNext: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, video[controls], audio[controls], [tabindex]:not([tabindex="-1"])';

const PHONE_QUERY = "(max-width: 639px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** "phone" below 640px wide, live. */
export function usePopupDevice(): PopupDevice {
  const phone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
  return phone ? "phone" : "desktop";
}

/** Drag distance (px) past which letting go closes the card. */
const CLOSE_DISTANCE = 110;
/** …or a flick faster than this (px/ms). */
const CLOSE_VELOCITY = 0.6;

export function PopupModal({ language, title, content, loading = false, theme = "game", onClose, children, size, role = "dialog", describedBy, nav }: Props) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const navRef = useRef(nav);
  useEffect(() => {
    onCloseRef.current = onClose;
    navRef.current = nav;
  }, [onClose, nav]);
  const device = usePopupDevice();

  const isAr = language === "ar";
  const migrated = migrateObjectContent(content);
  // The drawn theme/frame: until the library has loaded (usually preloaded),
  // show the skeleton rather than flash the built-in look first.
  const { styles, ready } = usePopupStyles();
  const look = resolveLook(styles, migrated?.frameIid);
  const busy = loading || !ready;
  const empty = !busy && !children && isContentEmpty(migrated);

  // Focus in on open, restore on close; lock the page scroll meanwhile.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  // Esc closes; Tab cycles inside the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[data-nested-overlay]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      // ←/→ step through the room's pop-ups (a magazine turns its own pages
      // first and marks the key handled). Mirrored in Arabic.
      const n = navRef.current;
      if (n && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.defaultPrevented && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        const fwd = isAr ? "ArrowLeft" : "ArrowRight";
        if (e.key === fwd ? n.index < n.count - 1 : n.index > 0) {
          e.preventDefault();
          if (e.key === fwd) n.onNext();
          else n.onPrev();
        }
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = sheetRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAr]);

  // Swipe-down to close (phones). Moves the sheet with the finger via its
  // style (no re-render per frame); releasing past the threshold slides it
  // out, otherwise it springs back.
  const drag = useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null);
  const dragZoneProps =
    device === "phone"
      ? {
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            if ((e.target as HTMLElement).closest("button")) return;
            drag.current = { y0: e.clientY, t0: performance.now(), dy: 0, id: e.pointerId };
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // An inactive pointer can't be captured; the drag still works.
            }
            if (sheetRef.current) sheetRef.current.style.transition = "none";
          },
          onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId || !sheetRef.current) return;
            d.dy = Math.max(0, e.clientY - d.y0);
            sheetRef.current.style.transform = `translateY(${d.dy}px)`;
          },
          onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = drag.current;
            drag.current = null;
            const el = sheetRef.current;
            if (!d || d.id !== e.pointerId || !el) return;
            const v = d.dy / Math.max(1, performance.now() - d.t0);
            el.style.transition = "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)";
            if (d.dy > CLOSE_DISTANCE || (d.dy > 24 && v > CLOSE_VELOCITY)) {
              el.style.transform = "translateY(100%)";
              window.setTimeout(() => onCloseRef.current(), 180);
            } else {
              el.style.transform = "";
            }
          },
          onPointerCancel: () => {
            drag.current = null;
            if (sheetRef.current) sheetRef.current.style.transform = "";
          },
        }
      : undefined;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="popup-backdrop" data-device={device} onClick={onClose} dir={isAr ? "rtl" : "ltr"}>
      <PopupSheet
        ref={sheetRef}
        title={title}
        titleId={titleId}
        language={language}
        theme={theme}
        size={size ?? migrated?.size ?? "m"}
        device={device}
        onClose={onClose}
        closeRef={closeRef}
        dragZoneProps={dragZoneProps}
        look={look}
        dialogProps={{
          role,
          "aria-modal": true,
          "aria-describedby": describedBy,
          "aria-labelledby": title ? titleId : undefined,
          "aria-label": title ? undefined : isAr ? "نافذة" : "Pop-up",
          "aria-busy": busy || undefined,
          onClick: (e) => e.stopPropagation(),
        }}
      >
        {busy ? (
          <PopupSkeleton label={isAr ? "جارٍ التحميل…" : "Loading…"} />
        ) : children ? (
          children
        ) : empty || !migrated ? (
          <PopupEmpty language={language} />
        ) : (
          <PopupView content={migrated} language={language} />
        )}
      </PopupSheet>
      {nav && <PopupStepper nav={nav} language={language} title={title} prevArt={look.theme?.parts.prev?.url} nextArt={look.theme?.parts.next?.url} device={device} />}
    </div>,
    document.body
  );
}

/** The room's previous / next pop-up arrows (beside the sheet; above the
 *  card on phones), drawn by the theme when it has page arrows. */
function PopupStepper({
  nav,
  language,
  title,
  prevArt,
  nextArt,
  device,
}: {
  nav: PopupNavProps;
  language: "en" | "ar";
  title: string;
  prevArt?: string;
  nextArt?: string;
  device: PopupDevice;
}) {
  const ar = language === "ar";
  const prevSrc = prevArt ? safeMediaSrc(prevArt, "image") : null;
  const nextOwn = nextArt ? safeMediaSrc(nextArt, "image") : null;
  const nextSrc = nextOwn ?? prevSrc;
  const where = ar ? `${nav.index + 1} من ${nav.count}` : `${nav.index + 1} of ${nav.count}`;
  const arrow = (dir: "prev" | "next") => {
    const isPrev = dir === "prev";
    const disabled = isPrev ? nav.index === 0 : nav.index === nav.count - 1;
    const label = isPrev
      ? `${ar ? "النافذة السابقة" : "Previous pop-up"}${nav.prevLabel ? `: ${nav.prevLabel}` : ""}`
      : `${ar ? "النافذة التالية" : "Next pop-up"}${nav.nextLabel ? `: ${nav.nextLabel}` : ""}`;
    const src = isPrev ? prevSrc : nextSrc;
    // The "next" drawing is the "prev" one flipped when only one was drawn.
    const flip = !isPrev && !nextOwn;
    return (
      <button
        type="button"
        className="popup-step__arrow"
        data-dir={dir}
        data-drawn={src ? "" : undefined}
        disabled={disabled}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          if (isPrev) nav.onPrev();
          else nav.onNext();
        }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a drawn theme part
          <img src={src} alt="" draggable={false} className={flip ? "popup-step__icon popup-step__icon--flip" : "popup-step__icon"} />
        ) : (
          <ChevronLeft size={26} aria-hidden="true" className={isPrev ? "popup-step__icon" : "popup-step__icon popup-step__icon--flip"} />
        )}
      </button>
    );
  };
  return (
    <div className="popup-step" data-device={device} onClick={(e) => e.stopPropagation()}>
      {arrow("prev")}
      <p className="popup-step__where" aria-live="polite">
        <span className="popup-step__sr">{title}, </span>
        {where}
      </p>
      {arrow("next")}
    </div>
  );
}
