"use client";

// The builder staples the registry was missing, modelled on Shopify's
// section/block set: Gallery (collage / logo list, with a lightbox), Quote /
// testimonial, Feature list (icon + title + text columns) and Map. Newsletter
// signup reuses FormBlock (see registry.tsx).

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Award,
  BookOpen,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Gift,
  Globe,
  Heart,
  Leaf,
  Lightbulb,
  Mail,
  MapPin,
  Music,
  Palette,
  PenTool,
  Phone,
  Rocket,
  Shield,
  Smile,
  Sparkles,
  Star,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Localized } from "@/data/landingTypes";
import { isPlaceholderSrc } from "@/data/landingPlaceholders";
import ImagePlaceholder from "../ImagePlaceholder";
import { EditorHint } from "./EditorHint";
import { L, alignToCss } from "./shared";
import { safeMediaSrc } from "@/lib/safeUrl";

// ─── Gallery ────────────────────────────────────────────────────

export interface GalleryImage {
  id: string;
  image: string;
  alt: Localized;
  caption: Localized;
}
export interface GalleryProps {
  images: GalleryImage[];
  columns: number;
  /** Mobile columns (phones get fewer). */
  mobileColumns: number;
  gapPx: number;
  aspect: "1 / 1" | "4 / 3" | "3 / 4" | "16 / 9" | "3 / 2";
  fit: "cover" | "contain";
  rounded: boolean;
  /** Logo-list look: greyscale until hovered. */
  muted: boolean;
  lightbox: boolean;
}

export function GalleryBlock({
  props,
  language,
  editor,
}: {
  props: GalleryProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  // Unsafe sources (javascript:, data:text/html…) are dropped like empty tiles.
  const images = (props.images ?? [])
    .map((i) => (isPlaceholderSrc(i.image) ? i : { ...i, image: safeMediaSrc(i.image, "image") ?? "" }))
    .filter((i) => editor || (i.image && !isPlaceholderSrc(i.image)));
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) {
    return <EditorHint editor={editor}>Gallery — add images in the settings panel.</EditorHint>;
  }
  const cols = Math.min(Math.max(props.columns || 3, 1), 6);
  const mcols = Math.min(Math.max(props.mobileColumns || 2, 1), 3);
  const canZoom = props.lightbox && !editor;
  return (
    <>
      <ul
        className="gallery-block m-0 grid list-none p-0"
        style={
          {
            "--cols": cols,
            "--mcols": mcols,
            gap: `${props.gapPx ?? 12}px`,
          } as React.CSSProperties
        }
        data-muted={props.muted ? "true" : undefined}
      >
        {images.map((img, i) => {
          const alt = L(img.alt, language);
          const caption = L(img.caption, language);
          const empty = !img.image || isPlaceholderSrc(img.image);
          const tile = (
            <span
              className={`gallery-block__tile relative block overflow-hidden ${props.rounded ? "rounded-lg" : ""}`}
              style={{ aspectRatio: props.aspect || "1 / 1" }}
            >
              {empty ? (
                <ImagePlaceholder fill />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.image}
                  alt={alt}
                  loading="lazy"
                  draggable={false}
                  className={`absolute inset-0 h-full w-full ${props.fit === "contain" ? "object-contain" : "object-cover"}`}
                />
              )}
            </span>
          );
          return (
            <li key={img.id} className="m-0">
              {canZoom && !empty ? (
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={alt ? `Open image: ${alt}` : `Open image ${i + 1}`}
                  className="block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {tile}
                </button>
              ) : (
                tile
              )}
              {caption && <p className="mt-1.5 text-center text-sm text-section-ink-soft">{caption}</p>}
            </li>
          );
        })}
      </ul>
      {open !== null && (
        <Lightbox images={images} index={open} language={language} onClose={() => setOpen(null)} onIndex={setOpen} />
      )}
    </>
  );
}

export function Lightbox({
  images,
  index,
  language,
  onClose,
  onIndex,
}: {
  images: GalleryImage[];
  index: number;
  language: "en" | "ar";
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const n = images.length;
  const step = useCallback((d: number) => onIndex((index + d + n) % n), [index, n, onIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(language === "ar" ? -1 : 1);
      else if (e.key === "ArrowLeft") step(language === "ar" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, step, language]);
  const img = images[index];
  const caption = L(img.caption, language);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={L(img.alt, language) || "Image"}
      className="lightbox"
      // Tells a hosting pop-up to leave Esc/Tab to this overlay.
      data-nested-overlay=""
      onClick={onClose}
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.image} alt={L(img.alt, language)} className="lightbox__img" onClick={(e) => e.stopPropagation()} />
      {caption && <p className="lightbox__caption">{caption}</p>}
      <button type="button" className="lightbox__btn lightbox__close" onClick={onClose} aria-label="Close">
        <X className="size-5" />
      </button>
      {n > 1 && (
        <>
          <button
            type="button"
            className="lightbox__btn lightbox__prev"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
          >
            <ChevronLeft className="size-6 rtl:rotate-180" />
          </button>
          <button
            type="button"
            className="lightbox__btn lightbox__next"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
          >
            <ChevronRight className="size-6 rtl:rotate-180" />
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

// ─── Quote / testimonial ────────────────────────────────────────

export interface QuoteProps {
  quote: Localized;
  author: Localized;
  role: Localized;
  avatar: string;
  style: "classic" | "card" | "large";
  align: "left" | "center" | "right";
}

export function QuoteBlock({ props, language }: { props: QuoteProps; language: "en" | "ar" }) {
  const quote = L(props.quote, language);
  const author = L(props.author, language);
  const role = L(props.role, language);
  const align = alignToCss(props.align);
  const hasAvatar = props.avatar && !isPlaceholderSrc(props.avatar);
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  return (
    <figure className="quote-block m-0" data-style={props.style || "classic"} style={{ textAlign: align }}>
      <span aria-hidden="true" className="quote-block__mark font-display">
        {language === "ar" ? "”" : "“"}
      </span>
      <blockquote className="quote-block__text m-0 font-display">{quote}</blockquote>
      {(author || role || hasAvatar) && (
        <figcaption className="quote-block__by" style={{ justifyContent: justify }}>
          {hasAvatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={safeMediaSrc(props.avatar, "image") ?? undefined} alt="" className="quote-block__avatar" />
          )}
          <span className="flex flex-col" style={{ alignItems: hasAvatar ? "flex-start" : justify }}>
            {author && <span className="quote-block__author">{author}</span>}
            {role && <span className="quote-block__role">{role}</span>}
          </span>
        </figcaption>
      )}
    </figure>
  );
}

// ─── Feature list ───────────────────────────────────────────────

export const FEATURE_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  heart: Heart,
  star: Star,
  pen: PenTool,
  palette: Palette,
  book: BookOpen,
  camera: Camera,
  music: Music,
  globe: Globe,
  mail: Mail,
  phone: Phone,
  pin: MapPin,
  clock: Clock,
  check: Check,
  zap: Zap,
  leaf: Leaf,
  coffee: Coffee,
  gift: Gift,
  users: Users,
  award: Award,
  idea: Lightbulb,
  rocket: Rocket,
  shield: Shield,
  smile: Smile,
};
export const FEATURE_ICON_OPTIONS = [
  { value: "none", label: "No icon" },
  ...Object.keys(FEATURE_ICONS).map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
];

export interface FeatureItem {
  id: string;
  icon: string;
  title: Localized;
  body: Localized;
}
export interface FeatureListProps {
  items: FeatureItem[];
  columns: number;
  iconStyle: "plain" | "circle";
  align: "left" | "center";
}

export function FeatureListBlock({
  props,
  language,
  editor,
}: {
  props: FeatureListProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const items = props.items ?? [];
  if (items.length === 0) {
    return <EditorHint editor={editor}>Feature list — add items in the settings panel.</EditorHint>;
  }
  const cols = Math.min(Math.max(props.columns || 3, 1), 4);
  const center = props.align !== "left";
  return (
    <ul className="feature-list m-0 grid list-none p-0" style={{ "--cols": cols } as React.CSSProperties}>
      {items.map((it) => {
        const Icon = FEATURE_ICONS[it.icon];
        return (
          <li key={it.id} className={`flex flex-col gap-2 ${center ? "items-center text-center" : "items-start text-start"}`}>
            {Icon && (
              <span className="feature-list__icon" data-style={props.iconStyle || "circle"}>
                <Icon strokeWidth={1.6} />
              </span>
            )}
            {L(it.title, language) && <h3 className="feature-list__title font-display">{L(it.title, language)}</h3>}
            {L(it.body, language) && (
              <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-section-ink-soft">
                {L(it.body, language)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Map ────────────────────────────────────────────────────────

export interface MapProps {
  address: string;
  zoom: number;
  rounded: boolean;
  muted: boolean;
}

/** Keyless Google Maps embed URL for an address / place name. */
export function mapEmbedUrl(address: string, zoom: number): string | null {
  const q = address.trim();
  if (!q) return null;
  const z = Math.min(Math.max(Math.round(zoom) || 14, 3), 20);
  return `https://www.google.com/maps?q=${encodeURIComponent(q.slice(0, 200))}&z=${z}&output=embed`;
}

export function MapBlock({ props, editor }: { props: MapProps; editor?: boolean }) {
  const src = mapEmbedUrl(props.address ?? "", props.zoom);
  if (!src) {
    return (
      <EditorHint editor={editor} className="h-full">
        Map — type an address or place name in the settings panel.
      </EditorHint>
    );
  }
  return (
    <div className={`relative h-full min-h-40 w-full overflow-hidden ${props.rounded ? "rounded-xl" : ""}`}>
      <iframe
        src={src}
        title={`Map: ${props.address}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="absolute inset-0 h-full w-full border-0"
        style={{
          filter: props.muted ? "grayscale(1) contrast(0.95)" : undefined,
          // In the editor the canvas overlay handles clicks.
          pointerEvents: editor ? "none" : undefined,
        }}
        tabIndex={editor ? -1 : undefined}
      />
    </div>
  );
}
