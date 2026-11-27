"use client";

// DialogueBox — a character's conversation at the bottom of the screen.
// Opened by a "dialogue" step through
// GameActionLayer; also rendered as a still preview by the conversation
// editor and the theme library.
//
// - Every part can be drawn in the active theme (dialogue box, name plate,
//   next mark, answer buttons); drawn boxes are nine-sliced so their corners
//   never stretch. Without a theme: the paper sheet's look.
// - Typewriter text (instant under reduced motion). Click / tap anywhere,
//   Space or Enter: finish the line, then the next one. Esc closes.
// - A line with answers waits for one: picking it ends the conversation and
//   its steps run next (ActionRunner). ↑/↓ move between answers.
// - role="dialog", the speaker names it, the whole line is announced once
//   (aria-live) rather than letter by letter; focus moves in and comes back.
// - RTL follows the language. Game input stays frozen while it's open
//   (the host reports it open, like a pop-up).

import "@/components/popup/popup.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Dialogue, DialogueChoice, DialogueLine } from "@/data/roomTypes";
import type { DrawnArt, PopupThemeConfig } from "@/data/popupStyleTypes";
import { safeMediaSrc } from "@/lib/safeUrl";
import { usePopupStyles } from "@/components/popup/PopupLook";

type Lang = "en" | "ar";

const L = (v: { en?: string; ar?: string } | undefined, lang: Lang) =>
  (lang === "ar" ? v?.ar?.trim() || v?.en?.trim() : v?.en?.trim() || v?.ar?.trim()) ?? "";

/** Milliseconds per letter of the typewriter. */
const TYPE_MS = 28;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Lines worth showing (words, or answers). */
export function dialogueLines(d: Dialogue): DialogueLine[] {
  return (d.lines ?? []).filter((l) => l.text?.en?.trim() || l.text?.ar?.trim() || l.choices?.some((c) => c.label?.en || c.label?.ar));
}

// ─── Drawn parts (nine-slice) ───────────────────────────────────

function src(art: DrawnArt | undefined): string | null {
  return art ? safeMediaSrc(art.url, "image") : null;
}

/** Whole-pixel nine-slice (fractional widths draw hairline seams). */
function nineSlice(url: string, insets: { top: number; right: number; bottom: number; left: number }, k: number): CSSProperties {
  const px = (n: number) => `${Math.max(0, Math.round(n * k))}px`;
  return {
    borderStyle: "solid",
    borderWidth: `${px(insets.top)} ${px(insets.right)} ${px(insets.bottom)} ${px(insets.left)}`,
    borderImageSource: `url("${url}")`,
    borderImageSlice: `${Math.round(insets.top)} ${Math.round(insets.right)} ${Math.round(insets.bottom)} ${Math.round(insets.left)} fill`,
    borderImageRepeat: "stretch",
  };
}

/** A pill-shaped part (name plate, answer): round caps keep their shape at any width. */
function capsStyle(art: DrawnArt | undefined, heightPx: number): CSSProperties | undefined {
  const u = src(art);
  if (!art || !u || !art.h) return undefined;
  const cap = Math.round(art.h * 0.45);
  const tb = Math.round(art.h * 0.28);
  const k = heightPx / art.h;
  return { ...nineSlice(u, { top: tb, right: cap, bottom: tb, left: cap }, k), minHeight: heightPx };
}

interface Props {
  dialogue: Dialogue;
  language: Lang;
  /** The character's label (used when the dialogue names no speaker). */
  fallbackName?: string;
  /** Finished: the picked answer, or null (last line, or Esc). */
  onDone?: (choice: DialogueChoice | null) => void;
  /** Still preview at this line (editor, theme library): no typing, no focus grab, laid out in place. */
  preview?: { line: number };
  /** Theme to draw with (undefined = the active theme). */
  theme?: PopupThemeConfig | null;
}

export function DialogueBox({ dialogue, language, fallbackName = "", onDone, preview, theme }: Props) {
  const { styles } = usePopupStyles();
  const t = theme === undefined ? styles.theme : theme;
  const lines = useMemo(() => dialogueLines(dialogue), [dialogue]);
  const ar = language === "ar";
  const nameId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const [stateIndex, setIndex] = useState(0);
  const index = preview ? Math.min(Math.max(0, preview.line), Math.max(0, lines.length - 1)) : stateIndex;
  const line = lines[index];
  const text = line ? L(line.text, language) : "";
  const instant = !!preview || prefersReducedMotion();
  // Letters shown, tagged with the line they belong to (a new line restarts).
  const [typed, setTyped] = useState<{ index: number; n: number }>({ index, n: instant ? text.length : 0 });
  const shown = typed.index === index ? typed.n : instant ? text.length : 0;
  const typing = shown < text.length;
  const choices = (line?.choices ?? []).filter((c) => L(c.label, language));
  const last = index >= lines.length - 1;

  // Nothing to say: done at once.
  useEffect(() => {
    if (!preview && !lines.length) onDoneRef.current?.(null);
  }, [preview, lines.length]);

  // Typewriter.
  useEffect(() => {
    if (instant || !text) return;
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      // Never backwards: a click may already have finished the line.
      setTyped((p) => (p.index === index && p.n >= n ? p : { index, n }));
      if (n >= text.length) window.clearInterval(id);
    }, TYPE_MS);
    return () => window.clearInterval(id);
  }, [index, text, instant]);

  const advance = useCallback(() => {
    if (typing) {
      setTyped({ index, n: text.length });
      return;
    }
    if (choices.length) {
      choicesRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    if (last) onDoneRef.current?.(null);
    else setIndex((i) => i + 1);
  }, [typing, choices.length, last, index, text.length]);

  // Focus in on open (and back out on close).
  useEffect(() => {
    if (preview) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [preview]);

  // Answers appear once the line is typed: put focus on the first.
  useEffect(() => {
    if (preview || typing || !choices.length) return;
    choicesRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [preview, typing, choices.length, index]);

  // Keys: Space/Enter advance (buttons handle their own), Esc closes, ↑/↓ answers.
  useEffect(() => {
    if (preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDoneRef.current?.(null);
        return;
      }
      const onButton = (e.target as HTMLElement | null)?.closest?.("button");
      if ((e.key === " " || e.key === "Enter") && !onButton) {
        e.preventDefault();
        advance();
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && choicesRef.current) {
        const items = Array.from(choicesRef.current.querySelectorAll<HTMLButtonElement>("button"));
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      }
      if (e.key === "Tab" && rootRef.current) {
        // Keep Tab inside the conversation.
        const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>("button"));
        if (!items.length) return;
        const first = items[0];
        const lastEl = items[items.length - 1];
        const inside = rootRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, advance]);

  if (!line) return null;

  const name = L(dialogue.speaker, language) || fallbackName;
  const parts = t?.parts ?? {};
  const boxUrl = src(parts.dialogueBox);
  // Drawn box: the border IS the drawing's edge, so the name plate and the
  // next mark are placed against it through --dlg-* (its widths in px).
  const boxStyle: CSSProperties | undefined =
    t && boxUrl
      ? ({
          ...nineSlice(boxUrl, t.dialogueSlice, t.panelScale),
          "--dlg-bt": `${Math.round(t.dialogueSlice.top * t.panelScale)}px`,
          "--dlg-bs": `${Math.round((ar ? t.dialogueSlice.right : t.dialogueSlice.left) * t.panelScale)}px`,
        } as CSSProperties)
      : undefined;
  const plateStyle = capsStyle(parts.namePlate, 34);
  const choiceStyle = capsStyle(parts.choiceButton, 46);
  const nextUrl = src(parts.dialogueNext);
  const ink: Record<string, string> = {};
  if (t?.ink) ink["--section-ink"] = t.ink;
  if (t?.inkSoft) ink["--section-ink-soft"] = t.inkSoft;

  return (
    <div
      className="dialogue"
      data-preview={preview ? "" : undefined}
      dir={ar ? "rtl" : "ltr"}
      style={ink as CSSProperties}
    >
      {/* Click / tap anywhere on the screen moves the conversation on. */}
      {!preview && <div className="dialogue__catch" aria-hidden="true" onClick={advance} />}
      <div
        ref={rootRef}
        className="dialogue__stack"
        role={preview ? undefined : "dialog"}
        aria-modal={preview ? undefined : true}
        aria-labelledby={name ? nameId : undefined}
        aria-label={name ? undefined : ar ? "محادثة" : "Conversation"}
        tabIndex={preview ? undefined : -1}
      >
        {choices.length > 0 && !typing && (
          <div ref={choicesRef} className="dialogue__choices" role="group" aria-label={ar ? "اختر إجابة" : "Pick an answer"}>
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className="dialogue__choice"
                data-drawn={choiceStyle ? "" : undefined}
                style={choiceStyle}
                onClick={() => onDoneRef.current?.(c)}
                tabIndex={preview ? -1 : undefined}
              >
                {L(c.label, language)}
              </button>
            ))}
          </div>
        )}
        <div
          className={boxStyle ? "dialogue__box" : "dialogue__box paper-material"}
          data-paper={boxStyle ? undefined : "sketchbook"}
          data-grain={boxStyle ? "false" : "true"}
          data-drawn={boxStyle ? "" : undefined}
          style={boxStyle}
          onClick={preview ? undefined : advance}
        >
          {name && (
            <span id={nameId} className="dialogue__name" data-drawn={plateStyle ? "" : undefined} style={plateStyle}>
              {name}
            </span>
          )}
          <p className="dialogue__text" aria-hidden="true">
            {text.slice(0, shown)}
            {/* Reserve the full line's height so the box doesn't grow as it types. */}
            <span className="dialogue__rest">{text.slice(shown)}</span>
          </p>
          {!typing && !choices.length && (
            <button
              type="button"
              className="dialogue__next"
              data-drawn={nextUrl ? "" : undefined}
              aria-label={last ? (ar ? "إنهاء المحادثة" : "End the conversation") : ar ? "التالي" : "Next"}
              onClick={(e) => {
                e.stopPropagation();
                advance();
              }}
              tabIndex={preview ? -1 : undefined}
            >
              {nextUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a drawn theme part
                <img src={nextUrl} alt="" draggable={false} />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 8.5c2.4 1.2 4.6 4.6 7 7.4 2.3-2.8 4.6-6.2 7-7.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )}
        </div>
        {!preview && (
          <p className="dialogue__sr" aria-live="polite">
            {name ? `${name}: ` : ""}
            {text}
          </p>
        )}
      </div>
    </div>
  );
}
