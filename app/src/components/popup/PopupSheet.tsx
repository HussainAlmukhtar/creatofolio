"use client";

// PopupSheet — the paper sheet itself (header with title + close mark, body),
// with no behaviour. PopupModal wraps it with the portal, focus handling, Esc
// and swipe-to-close for visitors; the composer's live preview renders it
// inline so authors see exactly the visitor's sheet.
//
// Layout is keyed on `data-device` ("phone" = bottom card), not on a media
// query, so the composer can preview the phone sheet on any screen.
//
// `look` dresses it: the active theme's drawn panel (nine-slice
// border-image), close button and title strip; or the pop-up's frame (a
// drawing with a "screen" window the content sits in). Phones keep the plain
// bottom card unless the frame says "keep the frame".

import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from "react";
import type { PopupLook } from "@/data/popupStyleTypes";
import { safeMediaSrc } from "@/lib/safeUrl";
import { PopupLookContext } from "./PopupLook";
import type { PopupTheme } from "./popupTheme";
import "./popup.css";

export type PopupDevice = "desktop" | "phone";

interface Props {
  title: string;
  titleId?: string;
  language: "en" | "ar";
  theme: PopupTheme;
  size: "s" | "m" | "l";
  device: PopupDevice;
  onClose?: () => void;
  closeRef?: Ref<HTMLButtonElement>;
  /** Pointer handlers for the drag zone (handle + header) on phones. */
  dragZoneProps?: HTMLAttributes<HTMLDivElement>;
  /** Extra attributes for the dialog element (role, aria-*, handlers). */
  dialogProps?: HTMLAttributes<HTMLDivElement>;
  /** Drawn theme / frame (absent = the built-in look). */
  look?: PopupLook;
  children: ReactNode;
}

const NO_LOOK: PopupLook = { theme: null, frame: null };

/** CSS for a drawn panel: the drawing as a nine-slice border image. */
function panelStyle(look: PopupLook): CSSProperties | undefined {
  const t = look.theme;
  const art = t?.parts.panel;
  const src = art && safeMediaSrc(art.url, "image");
  if (!t || !src) return undefined;
  const { top, right, bottom, left } = t.panelSlice;
  const k = t.panelScale;
  // Whole pixels: a fractional edge width leaves a hairline seam between the
  // nine pieces in Chrome.
  const px = (n: number) => `${Math.max(0, Math.round(n * k))}px`;
  return {
    borderStyle: "solid",
    borderWidth: `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`,
    borderImageSource: `url("${src}")`,
    borderImageSlice: `${Math.round(top)} ${Math.round(right)} ${Math.round(bottom)} ${Math.round(left)} fill`,
    borderImageRepeat: t.panelRepeat === "round" ? "round" : "stretch",
  };
}

/** Ink colours a theme sets for text on its panel. */
function inkStyle(look: PopupLook): CSSProperties {
  const t = look.theme;
  const out: Record<string, string> = {};
  if (t?.ink) out["--section-ink"] = t.ink;
  if (t?.inkSoft) out["--section-ink-soft"] = t.inkSoft;
  return out as CSSProperties;
}

export const PopupSheet = forwardRef<HTMLDivElement, Props>(function PopupSheet(
  { title, titleId, language, theme, size, device, onClose, closeRef, dragZoneProps, dialogProps, look = NO_LOOK, children },
  ref
) {
  const isAr = language === "ar";
  const digital = theme === "landing-digital";
  const frame = look.frame;
  const frameSrc = frame?.art ? safeMediaSrc(frame.art.url, "image") : null;
  const useFrame = !!(frame && frameSrc && (device === "desktop" || frame.phone === "keep"));

  const closeArt = look.theme?.parts.close ? safeMediaSrc(look.theme.parts.close.url, "image") : null;
  const stripArt = look.theme?.parts.titleStrip ? safeMediaSrc(look.theme.parts.titleStrip.url, "image") : null;
  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      className="popup-sheet__close"
      data-drawn={closeArt ? "" : undefined}
      onClick={onClose}
      aria-label={isAr ? "إغلاق" : "Close"}
    >
      {closeArt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={closeArt} alt="" draggable={false} />
      ) : (
        <SketchCloseMark />
      )}
    </button>
  );
  const heading = title ? (
    <h2
      id={titleId}
      className="popup-sheet__title font-display"
      data-strip={stripArt ? "" : undefined}
      style={stripArt ? { backgroundImage: `url("${stripArt}")` } : undefined}
    >
      {title}
    </h2>
  ) : (
    <span />
  );

  if (useFrame && frame?.art) {
    const { x, y, w, h } = frame.screen;
    const artW = frame.art.w || 4;
    const artH = frame.art.h || 3;
    // Paper sheet unless the frame picked a colour (or see-through).
    const paper = !frame.background;
    return (
      <PopupLookContext.Provider value={look}>
        <div
          ref={ref}
          {...dialogProps}
          className="popup-frame"
          data-popup-theme={theme}
          data-size={size}
          data-device={device}
          data-art-over={frame.artOver ? "" : undefined}
          style={
            {
              ...inkStyle(look),
              "--frame-ratio": `${artW} / ${artH}`,
              "--frame-ratio-n": artW / artH,
              "--frame-sw": w / 100,
              // Corner rounding drawn in art pixels → % of the frame's width.
              "--screen-r": `${(frame.radius / artW) * 100}cqw`,
              "--scr-left": `${x}%`,
              "--scr-right": `${100 - x - w}%`,
              "--scr-top": `${y}%`,
            } as CSSProperties
          }
        >
          <div
            className={paper ? "popup-frame__screen paper-material" : "popup-frame__screen"}
            data-paper={paper ? "sketchbook" : undefined}
            data-grain={paper ? "true" : undefined}
            data-ink={frame.ink}
            data-glass={frame.glass ? "" : undefined}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: `${w}%`,
              height: `${h}%`,
              background: frame.background && frame.background !== "transparent" ? frame.background : undefined,
            }}
          >
            <header className="popup-sheet__head popup-frame__head">{heading}</header>
            <div className="popup-sheet__body">{children}</div>
          </div>
          {/* Drawn ON TOP when it has a see-through screen: its own edges
              frame the content, like a picture frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="popup-frame__art" src={frameSrc!} alt="" draggable={false} />
          <div className="popup-frame__close">{closeButton}</div>
        </div>
      </PopupLookContext.Provider>
    );
  }

  const drawnPanel = panelStyle(look);
  return (
    <PopupLookContext.Provider value={look}>
      <div
        ref={ref}
        {...dialogProps}
        className={drawnPanel ? "popup-surface" : "popup-surface paper-material"}
        data-popup-theme={theme}
        data-paper={digital || drawnPanel ? undefined : "sketchbook"}
        data-grain={digital || drawnPanel ? "false" : "true"}
        data-drawn-panel={drawnPanel ? "" : undefined}
        data-size={size}
        data-device={device}
        style={{ ...inkStyle(look), ...drawnPanel }}
      >
        <div className="popup-sheet__drag" {...dragZoneProps}>
          {/* The grab bar: decoration only (the whole header is draggable). */}
          <span className="popup-sheet__handle" aria-hidden="true" />
          <header className="popup-sheet__head">
            {heading}
            {closeButton}
          </header>
        </div>
        <div className="popup-sheet__body">{children}</div>
      </div>
    </PopupLookContext.Provider>
  );
});

/** Two wobbly pencil strokes inside a hand-drawn ring. */
function SketchCloseMark() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
      <path
        d="M16.4 3.1c6.9-.3 12.6 5 12.5 12.4-.1 7.2-5.6 12.9-12.7 12.8C9 28.2 3.2 22.6 3.4 15.6 3.6 8.9 8.6 3.6 15 3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path d="M10.6 10.2c3.4 3.6 7.3 7.7 10.9 11.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M21.7 10.6c-3.8 3.4-7.6 7.4-11.2 11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function PopupSkeleton({ label }: { label: string }) {
  return (
    <div className="popup-skeleton" role="status">
      <span className="sr-only">{label}</span>
      <span style={{ width: "92%" }} />
      <span style={{ width: "78%" }} />
      <span style={{ width: "85%" }} />
      <span style={{ width: "40%" }} />
    </div>
  );
}

export function PopupEmpty({ language }: { language: "en" | "ar" }) {
  const isAr = language === "ar";
  return (
    <div className="popup-empty">
      <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" focusable="false">
        {/* a pencil mid-scribble */}
        <path d="M14 50c6-2 11-5 16-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <path d="M40.5 12.5l9 9-22 22-11.5 3 3-11.5z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M36.5 16.5l9 9M19 35l9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="popup-empty__title font-display">
        {isAr ? "لم تُكتب هذه الصفحة بعد" : "This page hasn’t been filled in yet"}
      </p>
      <p className="popup-empty__hint">{isAr ? "عُد قريباً، ما زالت قيد الرسم." : "Check back soon, it’s still being drawn."}</p>
    </div>
  );
}
