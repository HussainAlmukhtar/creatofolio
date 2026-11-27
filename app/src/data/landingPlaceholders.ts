// Shared placeholder art for editor-inserted elements — a simple hand-drawn-ish
// dashed box so a freshly added element (or archetype slot) is visible and
// obviously "swap me" without needing real art yet.

// preserveAspectRatio='none' so the box stretches to fill when resized without
// Shift (SVGs otherwise keep their own aspect and won't distort).
export const PLACEHOLDER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><rect x='4' y='4' width='92' height='92' rx='8' fill='#e9e3d6' stroke='#2b2b2b' stroke-width='2.5' stroke-dasharray='6 5'/></svg>`
  );

/**
 * Whether `src` is the placeholder (this one, or an older copy saved with
 * different stroke settings). Renderers swap it for <ImagePlaceholder>, a
 * CSS box that looks right at any size. The stretched SVG smeared its
 * dashes into thick bars on wide or tall boxes.
 */
export function isPlaceholderSrc(src: string | undefined | null): boolean {
  return (
    !!src &&
    src.startsWith("data:image/svg+xml") &&
    src.includes("e9e3d6")
  );
}
