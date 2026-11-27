"use client";

// CarouselBlock — a REAL carousel (not a row of boxes): Embla-powered, with
// optional autoplay, loop, drag/swipe, arrows, and dot pagination. This is the
// component the "carousel" registry entry renders. Author settings come in as
// props (see registry.tsx). Respects prefers-reduced-motion (autoplay off).

import { useCallback, useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Localized } from "@/data/landingTypes";
import { L } from "./shared";
import Image from "next/image";
import { canOptimizeImage } from "../AssetImage";
import { isPlaceholderSrc } from "@/data/landingPlaceholders";
import ImagePlaceholder from "../ImagePlaceholder";
import { EditorHint } from "./EditorHint";

export interface CarouselSlide {
  id: string;
  image: string;
  caption: Localized;
}
export interface CarouselProps {
  slides: CarouselSlide[];
  autoplay: boolean;
  intervalMs: number;
  loop: boolean;
  draggable: boolean;
  showArrows: boolean;
  showDots: boolean;
  slidesPerView: number;
  gapPx: number;
  /** How each image fills its slide: crop to fill (default) or fit whole. */
  fit?: "cover" | "contain";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function CarouselBlock({
  props,
  language,
  editor,
}: {
  props: CarouselProps;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const {
    slides,
    autoplay,
    intervalMs,
    loop,
    draggable,
    showArrows,
    showDots,
    slidesPerView,
    gapPx,
    fit = "cover",
  } = props;

  const autoplayRef = useRef(
    Autoplay({ delay: Math.max(1000, intervalMs || 4000), stopOnInteraction: false, stopOnMouseEnter: true })
  );
  const useAutoplay = autoplay && !prefersReducedMotion();

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop, align: "start", watchDrag: draggable, direction: language === "ar" ? "rtl" : "ltr" },
    useAutoplay ? [autoplayRef.current] : []
  );

  const [snaps, setSnaps] = useState<number[]>([]);
  const [selected, setSelected] = useState(0);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    setSnaps(emblaApi.scrollSnapList());
    emblaApi.on("select", onSelect).on("reInit", () => {
      setSnaps(emblaApi.scrollSnapList());
      onSelect();
    });
    onSelect();
  }, [emblaApi]);

  const perView = Math.max(1, Math.min(slidesPerView || 1, 6));
  const basis = `calc(${100 / perView}% - ${(gapPx * (perView - 1)) / perView}px)`;

  if (!slides?.length) {
    return (
      <EditorHint editor={editor} className="h-full">
        Carousel — add slides in the settings panel.
      </EditorHint>
    );
  }

  // The carousel FILLS its element box (the author sizes it on the canvas,
  // like a Shopify slideshow height): slides share one height and each image
  // is cropped (or fitted) into it, so mixed-aspect photos still read as one
  // tidy strip. Captions sit on the image, over a soft scrim.
  return (
    <div className="carousel-block group/carousel relative flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-hidden rounded-[10px]" ref={emblaRef}>
          <div className="flex h-full" style={{ gap: `${gapPx}px` }}>
            {slides.map((s) => {
              const caption = L(s.caption, language);
              return (
                <figure
                  key={s.id}
                  className="relative m-0 h-full min-w-0 shrink-0 grow-0 overflow-hidden rounded-[10px]"
                  style={{ flexBasis: basis }}
                >
                  {!s.image || isPlaceholderSrc(s.image) ? (
                    <ImagePlaceholder fill />
                  ) : (
                    <Image
                      src={s.image}
                      alt={caption}
                      fill
                      sizes={`${Math.ceil(100 / perView)}vw`}
                      unoptimized={!canOptimizeImage(s.image)}
                      draggable={false}
                      className={fit === "contain" ? "object-contain" : "object-cover"}
                    />
                  )}
                  {caption && (
                    <figcaption className="carousel-block__caption">{caption}</figcaption>
                  )}
                </figure>
              );
            })}
          </div>
        </div>

        {showArrows && slides.length > 1 && (
          <>
            <button
              type="button"
              onClick={scrollPrev}
              aria-label="Previous slide"
              className="carousel-block__arrow start-3"
            >
              <ChevronLeft className="size-5 rtl:rotate-180" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={scrollNext}
              aria-label="Next slide"
              className="carousel-block__arrow end-3"
            >
              <ChevronRight className="size-5 rtl:rotate-180" strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      {showDots && snaps.length > 1 && (
        <div className="flex h-7 shrink-0 items-end justify-center gap-1.5">
          {snaps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => scrollTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === selected ? "true" : undefined}
              className="carousel-block__dot"
            />
          ))}
        </div>
      )}
    </div>
  );
}
