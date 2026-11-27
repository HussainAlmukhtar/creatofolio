"use client";

// ReelRenderer — a mixed-media showcase (platform embeds + self-hosted
// uploads) entered via an Instagram-profile-style thumbnail grid; tapping
// an item opens a full-screen viewer you swipe/tap/arrow-key through.
// Grid thumbnails never load a platform's embed script (heavy, slow) —
// only the item open in the full-screen viewer does, via PlatformEmbed.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { ReelItem } from "@/data/contentTypes";
import { PlatformEmbed } from "./PlatformEmbed";
import { safeMediaSrc } from "@/lib/safeUrl";

interface ReelRendererProps {
  items: ReelItem[];
  language: "en" | "ar";
}

function isVideoItem(item: ReelItem): boolean {
  return item.kind === "embed" || item.mediaType === "video";
}

function thumbnailSrc(item: ReelItem): string | null {
  if (item.kind === "upload") {
    return safeMediaSrc(item.mediaType === "image" ? item.url : item.posterUrl, "image");
  }
  return safeMediaSrc(item.thumbnailUrl, "image");
}

export function ReelRenderer({ items, language }: ReelRendererProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (!items.length) {
    return <p className="text-ink-faint italic">No items in this reel yet.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item, i) => {
          const thumb = thumbnailSrc(item);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIndex(i)}
              className="relative aspect-square rounded overflow-hidden bg-paper-2 border border-line"
            >
              {thumb ? (
                <img src={thumb} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-ink-faint uppercase px-1 text-center">
                  {item.kind === "embed" ? item.embedType : item.mediaType}
                </div>
              )}
              {isVideoItem(item) && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                  <Play size={22} className="text-white drop-shadow" fill="white" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {openIndex !== null && (
        <ReelViewer
          items={items}
          startIndex={openIndex}
          language={language}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

function ReelViewer({
  items,
  startIndex,
  language,
  onClose,
}: {
  items: ReelItem[];
  startIndex: number;
  language: "en" | "ar";
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);
  const isAr = language === "ar";

  const goTo = useCallback(
    (next: number) => setIndex(((next % items.length) + items.length) % items.length),
    [items.length]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goTo(index + 1);
      else if (e.key === "ArrowLeft") goTo(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goTo, onClose]);

  const item = items[index];
  const caption = isAr ? item.captionAr : item.caption;

  return (
    <div className="fixed inset-0 bg-black z-[90] flex flex-col" data-nested-overlay="" onClick={onClose}>
      <div
        className="flex items-center justify-between p-4 text-white flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm opacity-70">
          {index + 1} / {items.length}
        </span>
        <button onClick={onClose} className="text-white text-2xl leading-none" aria-label="Close">
          &times;
        </button>
      </div>
      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden px-4"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStartX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if (Math.abs(dx) > 50) goTo(dx < 0 ? index + 1 : index - 1);
          touchStartX.current = null;
        }}
      >
        {items.length > 1 && (
          <button
            onClick={() => goTo(index - 1)}
            className="absolute left-2 z-10 text-white text-3xl px-2 py-4"
            aria-label="Previous"
          >
            ‹
          </button>
        )}
        <div className="max-w-full max-h-full w-full h-full flex items-center justify-center">
          <ReelItemMedia item={item} />
        </div>
        {items.length > 1 && (
          <button
            onClick={() => goTo(index + 1)}
            className="absolute right-2 z-10 text-white text-3xl px-2 py-4"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>
      {caption && (
        <div
          className="p-4 text-white text-sm text-center flex-shrink-0"
          dir={isAr ? "rtl" : "ltr"}
          onClick={(e) => e.stopPropagation()}
        >
          {caption}
        </div>
      )}
    </div>
  );
}

function ReelItemMedia({ item }: { item: ReelItem }) {
  if (item.kind === "upload") {
    const src = safeMediaSrc(item.url, item.mediaType === "video" ? "media" : "image");
    if (!src) return null;
    if (item.mediaType === "video") {
      return <video src={src} controls autoPlay className="max-w-full max-h-full" />;
    }
    return <img src={src} alt="" className="max-w-full max-h-full object-contain" />;
  }
  return (
    <div className="w-full max-w-md">
      <PlatformEmbed url={item.url} embedType={item.embedType} />
    </div>
  );
}
