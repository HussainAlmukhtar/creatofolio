"use client";

// GameActionLayer — the React half of object steps:
// answers the scene's EVENTS.ACTION_UI requests (components/game/actionUi.ts).
//
//   popup     → the visitor pop-up (PopupModal), closed → the chain goes on
//   link      → a new tab; with `confirm`, a paper "leave the site?" first
//   email     → the visitor's mail app (mailto:)
//   download  → the file (Supabase serves ?download= as an attachment)
//   dialogue  → the bottom dialogue box (DialogueBox); resolves with the
//               picked answer, whose steps the runner runs next
//
// Mounted by GameWrapper and by the pop-up lab's game harness (which passes
// `contentFor` so fixtures replace the database read). Every URL arriving
// here was checked by the scene; it's checked again before use.

import { useEffect, useId, useRef, useState } from "react";
import { EventBridge, EVENTS } from "./EventBridge";
import type { ActionUiRequest } from "./actionUi";
import type { ObjectContent } from "@/data/contentTypes";
import { PopupModal } from "@/components/popup/PopupModal";
import { getStaticContent } from "@/data/staticContent";
import { loadObjectContent } from "@/lib/gameData";
import { isExternalHref, safeHref } from "@/lib/safeUrl";
import type { DialogueChoice } from "@/data/roomTypes";
import { DialogueBox } from "./DialogueBox";

type PopupRequest = Extract<ActionUiRequest, { type: "popup" }>;
type LinkRequest = Extract<ActionUiRequest, { type: "link" }>;

interface Props {
  language: "en" | "ar";
  /** Lab only: the pop-up content for an object (undefined = load it live). */
  contentFor?: (roomId: string, objectId: string) => ObjectContent | null | undefined;
  /** True while any step UI is open (the host freezes game input). */
  onOpenChange?: (open: boolean) => void;
}

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Follow a mailto:/download link without leaving the game. */
function clickLink(href: string, download?: string) {
  const a = document.createElement("a");
  a.href = href;
  if (download !== undefined) {
    a.download = download;
    // A file on another site (not our Storage) would replace the page.
    if (isExternalHref(href) && !/[?&]download=/.test(href)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function GameActionLayer({ language, contentFor, onOpenChange }: Props) {
  const [req, setReq] = useState<ActionUiRequest | null>(null);
  const reqRef = useRef<ActionUiRequest | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    const finishOpen = () => {
      // Shouldn't happen (game input is frozen while one is open), but a
      // request must never be left hanging.
      const prev = reqRef.current;
      if (!prev) return;
      reqRef.current = null;
      if (prev.type === "dialogue") prev.done(null);
      else prev.done();
    };
    const onRequest = (data: unknown) => {
      const r = data as ActionUiRequest;
      switch (r.type) {
        case "link": {
          const href = safeHref(r.url);
          if (!href) return r.done();
          if (!r.confirm) {
            openInNewTab(href);
            return r.done();
          }
          break;
        }
        case "email": {
          const href = safeHref(r.href);
          if (href?.startsWith("mailto:")) clickLink(href);
          return r.done();
        }
        case "download": {
          const href = safeHref(r.href);
          if (href) clickLink(href, r.fileName ?? "");
          return r.done();
        }
      }
      finishOpen();
      reqRef.current = r;
      setReq(r);
    };
    EventBridge.on(EVENTS.ACTION_UI, onRequest);
    return () => {
      EventBridge.off(EVENTS.ACTION_UI, onRequest);
      finishOpen();
    };
  }, []);

  const open = req !== null;
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  const close = (choice: DialogueChoice | null = null) => {
    const r = reqRef.current;
    reqRef.current = null;
    setReq(null);
    if (!r) return;
    if (r.type === "dialogue") r.done(choice);
    else r.done();
  };

  if (!req) return null;
  if (req.type === "popup") {
    return (
      <InteractionModal
        key={`${req.roomId}:${req.objectId}`}
        data={req}
        language={language}
        contentFor={contentFor}
        onClose={() => close()}
      />
    );
  }
  if (req.type === "dialogue") {
    return (
      <DialogueBox
        dialogue={req.dialogue}
        language={language}
        fallbackName={language === "ar" ? req.labelAr || req.label : req.label || req.labelAr}
        onDone={close}
      />
    );
  }
  if (req.type === "link") {
    return <LinkConfirm req={req} language={language} onClose={() => close()} />;
  }
  return null;
}

// ─── "Leave the site?" (paper) ───────────────────────────────────

function LinkConfirm({ req, language, onClose }: { req: LinkRequest; language: "en" | "ar"; onClose: () => void }) {
  const ar = language === "ar";
  const textId = useId();
  const href = safeHref(req.url);
  const where = (() => {
    if (!href) return "";
    if (!isExternalHref(href)) return ar ? "صفحة أخرى من هذا الموقع" : "another page of this site";
    try {
      return new URL(href).host;
    } catch {
      return href;
    }
  })();
  return (
    <PopupModal
      language={language}
      title={ar ? "مغادرة الموقع؟" : "Leaving the site?"}
      content={null}
      theme="game"
      size="s"
      role="alertdialog"
      describedBy={textId}
      onClose={onClose}
    >
      <div className="popup-confirm">
        <p id={textId} className="popup-confirm__text">
          {ar ? "سيُفتح هذا الرابط في تبويب جديد:" : "This link opens in a new tab:"}
          <span className="popup-confirm__where" dir="ltr">
            {where}
          </span>
        </p>
        <div className="popup-confirm__actions">
          <button type="button" className="block-button" data-variant="outline" data-size="md" data-hover="lift" onClick={onClose}>
            {ar ? "البقاء هنا" : "Stay here"}
          </button>
          <button
            type="button"
            className="block-button"
            data-variant="solid"
            data-size="md"
            data-hover="lift"
            onClick={() => {
              if (href) openInNewTab(href);
              onClose();
            }}
          >
            {ar ? "افتح الرابط" : "Open the link"}
          </button>
        </div>
      </div>
    </PopupModal>
  );
}

// ─── Pop-up ──────────────────────────────────────────────────────

function InteractionModal({
  data,
  language,
  contentFor,
  onClose,
}: {
  data: PopupRequest;
  language: "en" | "ar";
  contentFor?: Props["contentFor"];
  onClose: () => void;
}) {
  // "Step through pop-ups": the object currently shown (the clicked one at
  // first). The shell stays open while the visitor steps; only the content
  // changes.
  const stops = data.sequence;
  const [objectId, setObjectId] = useState(data.objectId);
  const stopIdx = stops ? stops.findIndex((s) => s.objectId === objectId) : -1;
  const stop = stopIdx >= 0 ? stops![stopIdx] : { objectId: data.objectId, label: data.label, labelAr: data.labelAr };

  const override = contentFor?.(data.roomId, objectId);
  // Pop-ups loaded from the database, by object id. Until one arrives the
  // static seed paints instantly (zero loading flash, matches pre-DB
  // behaviour); `loadObjectContent` races Supabase in the background (see
  // gameData.ts for the timeout-capped fallback chain) and only swaps
  // content in if it actually resolves something.
  const [loaded, setLoaded] = useState<Record<string, ObjectContent | null>>({});
  const seed = getStaticContent(data.roomId, objectId);
  const content = override !== undefined ? override : (loaded[objectId] ?? seed);
  // Only show a loading state when there's nothing to paint yet.
  const loading = override === undefined && !(objectId in loaded) && !seed;

  useEffect(() => {
    if (override !== undefined || objectId in loaded) return;
    let cancelled = false;
    loadObjectContent(data.roomId, objectId).then((c) => {
      if (cancelled) return;
      setLoaded((m) => ({ ...m, [objectId]: c ?? m[objectId] ?? null }));
    });
    return () => {
      cancelled = true;
    };
  }, [data.roomId, objectId, override, loaded]);

  const isAr = language === "ar";
  const name = (s: { label: string; labelAr: string }) => (isAr ? s.labelAr || s.label : s.label || s.labelAr);
  const title = isAr
    ? content?.titleAr || stop.labelAr || content?.title || stop.label
    : content?.title || stop.label || content?.titleAr || stop.labelAr;

  return (
    <PopupModal
      language={language}
      title={title ?? ""}
      content={content}
      loading={loading}
      theme="game"
      onClose={onClose}
      nav={
        stops && stopIdx >= 0
          ? {
              index: stopIdx,
              count: stops.length,
              prevLabel: stopIdx > 0 ? name(stops[stopIdx - 1]) : undefined,
              nextLabel: stopIdx < stops.length - 1 ? name(stops[stopIdx + 1]) : undefined,
              onPrev: () => stopIdx > 0 && setObjectId(stops[stopIdx - 1].objectId),
              onNext: () => stopIdx < stops.length - 1 && setObjectId(stops[stopIdx + 1].objectId),
            }
          : undefined
      }
    />
  );
}
