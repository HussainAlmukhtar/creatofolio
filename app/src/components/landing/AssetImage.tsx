"use client";

// AssetImage — the public render path's image: next/image in `fill` mode, so
// hand-drawn PNGs are served resized (per `sizes`) and in modern formats
// instead of the full-resolution upload. The PARENT is the sized, positioned
// box (`.drawn-asset-pos`, a carousel slide), exactly as it was for the raw
// <img>; `fill` stretches the image to it, matching the old
// `h-full w-full` (no object-fit, so freely-resized art still distorts the
// way the editor shows it).
//
// Only sources the optimizer can safely fetch are optimized: same-origin
// paths and this project's public Supabase Storage objects (whitelisted in
// next.config.ts). Anything else — a pasted third-party URL, a data: URI
// placeholder, an SVG — renders `unoptimized` (a plain <img> through the same
// component) rather than throwing next/image's unconfigured-host error and
// taking the page down.

import { useState } from "react";
import Image from "next/image";
import { isPlaceholderSrc } from "@/data/landingPlaceholders";
import { resolveStorageUrl, storageImageHosts } from "@/lib/storageUrl";
import ImagePlaceholder from "./ImagePlaceholder";

const IMAGE_HOSTS = storageImageHosts();

/** Whether next/image may optimize `src` (must match next.config.ts). */
export function canOptimizeImage(src: string): boolean {
  if (/\.svg($|\?)/i.test(src)) return false; // optimizer refuses SVG
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const u = new URL(src);
    return IMAGE_HOSTS.some(
      (h) =>
        u.protocol === `${h.protocol}:` &&
        u.hostname === h.hostname &&
        u.pathname.startsWith(h.pathPrefix)
    );
  } catch {
    return false;
  }
}

export default function AssetImage({
  src,
  sizes,
  alt = "",
  priority,
  eager,
  className,
}: {
  src: string;
  /** Rendered width hint, e.g. "(max-width: 767px) 80vw, 30vw". */
  sizes: string;
  alt?: string;
  priority?: boolean;
  /** Load at once (no lazy-loading) WITHOUT a preload hint: for art that is in
   *  the first viewport but is not the one image worth a head-of-line preload. */
  eager?: boolean;
  className?: string;
}) {
  // The optimizer (/_next/image) fetches the file server-side, which can fail
  // where the browser would succeed — e.g. Next 16 refuses upstreams that
  // resolve to a private IP (self-hosted storage on the same box/network), or
  // the server can't reach its own public domain through Cloudflare. Rather
  // than render blank, fall back to loading the file directly.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src) return null;
  if (isPlaceholderSrc(src)) return <ImagePlaceholder fill className={className} />;
  const url = resolveStorageUrl(src);
  const optimize = canOptimizeImage(url) && failedSrc !== url;
  return (
    <Image
      // Remount on fallback so the browser issues a fresh direct request.
      key={optimize ? "opt" : "raw"}
      src={url}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      loading={eager && !priority ? "eager" : undefined}
      unoptimized={!optimize}
      onError={optimize ? () => setFailedSrc(url) : undefined}
      draggable={false}
      className={className}
    />
  );
}
