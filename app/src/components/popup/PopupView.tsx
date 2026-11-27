"use client";

// PopupView — the visitor view of one pop-up's content: a vertical flow of
// shared registry blocks (landing/blocks/registry.tsx), or, in pages layout,
// one page at a time with page-turn arrows, swipe and ←/→ keys (mirrored in
// Arabic). Used by the game's room pop-up, the landing button pop-up, the
// pop-up lab and the composer's live preview, so all four can never drift.
//
// Accepts ANY stored shape: content is passed through migrateObjectContent
// (idempotent), so v1 rows, draft previews and static seed entries render the
// same way as saved v2 content.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { ObjectContent, PopupPage } from "@/data/contentTypes";
import { migrateObjectContent } from "@/data/contentMigrations";
import type { ContentBlock } from "@/data/landingTypes";
import { getBlockDef } from "@/components/landing/blocks/registry";
import { safeMediaSrc } from "@/lib/safeUrl";
import { usePopupLook } from "./PopupLook";

interface Props {
  content: ObjectContent;
  language: "en" | "ar";
  /** Composer preview: blocks may show authoring hints. */
  editor?: boolean;
  selectedId?: string | null;
  onSelect?: (blockId: string) => void;
  /** Pages layout, composer: the page shown (controlled) and page changes. */
  page?: string | null;
  onPageChange?: (pageId: string) => void;
}

export function PopupView({ content, language, editor, selectedId, onSelect, page, onPageChange }: Props) {
  const migrated = useMemo(() => migrateObjectContent(content), [content]);
  if (!migrated) return null;
  if (migrated.layout === "pages" && (migrated.pages ?? []).length > 0) {
    return (
      <PopupPages
        pages={migrated.pages ?? []}
        language={language}
        editor={editor}
        selectedId={selectedId}
        onSelect={onSelect}
        page={page}
        onPageChange={onPageChange}
      />
    );
  }
  return (
    <BlockList
      blocks={migrated.blocks ?? []}
      language={language}
      editor={editor}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}

export function BlockList({
  blocks,
  language,
  editor,
  selectedId,
  onSelect,
}: {
  blocks: ContentBlock[];
  language: "en" | "ar";
  editor?: boolean;
  /** Composer: the highlighted block, and click-to-select. The outline sits on
   *  the block's own wrapper (no positioned overlay), so the container query
   *  on .popup-blocks can't throw a selection frame off. */
  selectedId?: string | null;
  onSelect?: (blockId: string) => void;
}) {
  // Container blocks (columns, tabs, accordion) render their slots with this.
  const renderBlocks = useCallback(
    (children: ContentBlock[]): ReactNode => (
      <BlockList blocks={children} language={language} editor={editor} selectedId={selectedId} onSelect={onSelect} />
    ),
    [language, editor, selectedId, onSelect]
  );
  return (
    // container-type lets blocks with @container breakpoints (gallery, feature
    // list, columns) respond to the sheet's width, not the window's.
    <div className="popup-blocks" dir={language === "ar" ? "rtl" : "ltr"}>
      {blocks.map((block) => {
        const def = getBlockDef(block.type);
        if (!def) {
          return editor ? (
            <p key={block.id} className="popup-block popup-block--unknown">
              Unknown block “{block.type}”
            </p>
          ) : null;
        }
        return (
          <div
            key={block.id}
            className="popup-block"
            data-block-type={block.type}
            data-block-id={block.id}
            data-selected={selectedId === block.id ? "" : undefined}
            // Authoring: a click selects the innermost block under it instead
            // of following links or opening lightboxes. Capture runs outermost
            // first, so this wrapper picks the deepest block and stops there;
            // a container's own controls (tab buttons, accordion headers) are
            // marked data-editor-passthrough and keep working.
            onClickCapture={
              onSelect
                ? (e) => {
                    const t = e.target as HTMLElement;
                    const host = t.closest<HTMLElement>("[data-block-id]");
                    onSelect(host?.dataset.blockId ?? block.id);
                    if (t.closest("[data-editor-passthrough]")) return;
                    e.preventDefault();
                    e.stopPropagation();
                  }
                : undefined
            }
          >
            {def.render(block.props, { language, editor, surface: "popup", renderBlocks, selectedId })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Pages (magazine) ───────────────────────────────────────────

const SWIPE_PX = 50;

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function pageName(p: PopupPage, i: number, lang: "en" | "ar"): string {
  if (p.kind === "cover") return lang === "ar" ? "الغلاف" : "Cover";
  if (p.kind === "back") return lang === "ar" ? "الغلاف الخلفي" : "Back cover";
  return lang === "ar" ? `صفحة ${i + 1}` : `Page ${i + 1}`;
}

function PopupPages({
  pages,
  language,
  editor,
  selectedId,
  onSelect,
  page,
  onPageChange,
}: {
  pages: PopupPage[];
  language: "en" | "ar";
  editor?: boolean;
  selectedId?: string | null;
  onSelect?: (blockId: string) => void;
  page?: string | null;
  onPageChange?: (pageId: string) => void;
}) {
  const rtl = language === "ar";
  const [own, setOwn] = useState(0);
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const controlled = page !== undefined && onPageChange !== undefined;
  const found = controlled ? pages.findIndex((p) => p.id === page) : -1;
  const index = Math.min(controlled ? Math.max(0, found) : own, pages.length - 1);
  const rootRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // Drawn arrows / page corner from the active theme. A missing "next" arrow
  // reuses the "prev" drawing, flipped.
  const parts = usePopupLook().theme?.parts;
  const prevArt = parts?.prev ? safeMediaSrc(parts.prev.url, "image") : null;
  const nextOwn = parts?.next ? safeMediaSrc(parts.next.url, "image") : null;
  const nextArt = nextOwn ?? prevArt;
  const cornerArt = parts?.pageTurn ? safeMediaSrc(parts.pageTurn.url, "image") : null;

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= pages.length || to === index) return;
      setTurn(to > index ? "next" : "prev");
      if (controlled) onPageChange!(pages[to].id);
      else setOwn(to);
      // A new page starts at its top.
      rootRef.current?.closest(".popup-sheet__body")?.scrollTo({ top: 0 });
    },
    [pages, index, controlled, onPageChange]
  );

  // ←/→ turn pages (mirrored in Arabic). Visitors only: the composer keeps
  // its own keys. Never while typing or while a nested viewer is open.
  useEffect(() => {
    if (editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[data-nested-overlay]")) return;
      const fwd = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      // At the first/last page the key falls through, so "Step through
      // pop-ups" (PopupModal) can move to the neighbouring pop-up.
      if (e.key === fwd && index + 1 < pages.length) go(index + 1);
      else if (e.key === back && index > 0) go(index - 1);
      else return;
      e.preventDefault();
    };
    // Capture: runs before the pop-up shell's own ←/→ (bubble) handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, rtl, index, go, pages.length]);

  const cur = pages[index];
  const label = pageName(cur, pages.slice(0, index).filter((p) => p.kind === "page").length, language);
  const total = pages.length;

  return (
    <div
      ref={rootRef}
      className="popup-pages"
      data-kind={cur.kind}
      dir={rtl ? "rtl" : "ltr"}
      // Horizontal swipes turn pages; vertical ones still scroll the sheet.
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // Finger moves toward the start edge = forward (left in English,
        // right in Arabic, like turning a page in each).
        const forward = rtl ? dx > 0 : dx < 0;
        go(forward ? index + 1 : index - 1);
      }}
      onPointerCancel={() => {
        swipe.current = null;
      }}
    >
      <div key={cur.id} className="popup-pages__page" data-turn={turn ?? undefined}>
        {cur.blocks.length ? (
          <BlockList blocks={cur.blocks} language={language} editor={editor} selectedId={selectedId} onSelect={onSelect} />
        ) : editor ? (
          <p className="popup-block-hint">This page is empty: add blocks to it from the list on the left.</p>
        ) : null}
        {cornerArt && index < total - 1 && (
          <button
            type="button"
            className="popup-pages__corner"
            onClick={() => go(index + 1)}
            aria-label={rtl ? "اقلب الصفحة" : "Turn the page"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cornerArt} alt="" draggable={false} />
          </button>
        )}
      </div>

      {total > 1 && (
        <nav className="popup-pages__nav" aria-label={rtl ? "الصفحات" : "Pages"}>
          <button
            type="button"
            className="popup-pages__arrow"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label={rtl ? "الصفحة السابقة" : "Previous page"}
            data-drawn={prevArt ? "" : undefined}
          >
            {prevArt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={prevArt} alt="" draggable={false} className="popup-pages__icon" />
            ) : (
              <ChevronLeft size={22} className="popup-pages__icon" aria-hidden="true" />
            )}
          </button>
          <p className="popup-pages__where" aria-live="polite">
            <span>{label}</span>
            <span className="popup-pages__count" aria-hidden="true" dir="ltr">
              {index + 1} / {total}
            </span>
            <span className="sr-only">{rtl ? `، ${index + 1} من ${total}` : `, ${index + 1} of ${total}`}</span>
          </p>
          <button
            type="button"
            className="popup-pages__arrow"
            onClick={() => go(index + 1)}
            disabled={index === total - 1}
            aria-label={rtl ? "الصفحة التالية" : "Next page"}
            data-drawn={nextArt ? "" : undefined}
          >
            {nextArt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={nextArt}
                alt=""
                draggable={false}
                // Its own drawing points forward already; a borrowed "prev" is flipped.
                className={nextOwn ? "popup-pages__icon" : "popup-pages__icon popup-pages__icon--next"}
              />
            ) : (
              <ChevronLeft size={22} className="popup-pages__icon popup-pages__icon--next" aria-hidden="true" />
            )}
          </button>
        </nav>
      )}
    </div>
  );
}
