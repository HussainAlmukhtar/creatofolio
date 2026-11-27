"use client";

// The image block inside a pop-up: sized by the picture itself (a pop-up is a
// vertical flow, there's no canvas box to fill), optional caption, and an
// optional tap-to-zoom lightbox (the gallery's, so both behave the same).

import { useState } from "react";
import type { Localized } from "@/data/landingTypes";
import { L } from "@/components/landing/blocks/shared";
import { Lightbox } from "@/components/landing/blocks/MoreBlocks";
import { isExternalHref } from "@/lib/safeUrl";

export function PopupImage({
  src,
  alt,
  caption,
  rounded,
  lightbox,
  href,
  language,
  editor,
}: {
  src: string;
  alt: Localized | undefined;
  caption: Localized | undefined;
  rounded: boolean;
  lightbox: boolean;
  href: string;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const altText = L(alt, language);
  const cap = L(caption, language);
  // eslint-disable-next-line @next/next/no-img-element -- owner content, any host
  const img = <img src={src} alt={altText} loading="lazy" className={`block h-auto w-full ${rounded ? "rounded-xl" : ""}`} />;
  const body =
    href && !editor ? (
      <a href={href} {...(isExternalHref(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {img}
      </a>
    ) : lightbox && !editor ? (
      <button
        type="button"
        className="block w-full cursor-zoom-in"
        onClick={() => setOpen(true)}
        aria-label={altText ? `${altText} — ${language === "ar" ? "تكبير" : "enlarge"}` : language === "ar" ? "تكبير الصورة" : "Enlarge image"}
      >
        {img}
      </button>
    ) : (
      img
    );
  return (
    <figure className="m-0">
      {body}
      {cap && <figcaption className="mt-1.5 text-center text-sm text-section-ink-soft">{cap}</figcaption>}
      {open && (
        <Lightbox
          images={[{ id: "one", image: src, alt: alt ?? { en: "", ar: "" }, caption: caption ?? { en: "", ar: "" } }]}
          index={0}
          language={language}
          onClose={() => setOpen(false)}
          onIndex={() => {}}
        />
      )}
    </figure>
  );
}
