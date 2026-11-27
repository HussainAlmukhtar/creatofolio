"use client";

// ChromeArt — the inside of a skinned UI control: the author's image for the
// active language (with an optional hover image), or the built-in content
// when there's no art. Sizing/placement come from the slot's CSS vars
// (globals.css `.chrome-slot`).

import type { ChromeSkin } from "@/data/chromeSkin";

export default function ChromeArt({
  skin,
  language,
  children,
}: {
  skin: ChromeSkin | undefined;
  language: "en" | "ar";
  /** Built-in content (label / icon) shown when there's no art. */
  children: React.ReactNode;
}) {
  const art = skin?.art?.[language] ?? skin?.art?.en ?? skin?.art?.ar ?? null;
  if (!art) return <>{children}</>;
  const hover = skin?.hoverArt?.[language] ?? skin?.hoverArt?.en ?? skin?.hoverArt?.ar ?? null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.url} alt="" aria-hidden="true" draggable={false} className="chrome-slot__img chrome-slot__img--base" />
      {hover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={hover.url} alt="" aria-hidden="true" draggable={false} className="chrome-slot__img chrome-slot__img--hover" />
      )}
    </>
  );
}
