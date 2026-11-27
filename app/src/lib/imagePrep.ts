// Upload weight budget: every image the owner uploads is scaled down to a
// sensible cap and re-encoded to WebP before it reaches Storage, so a phone
// photo or a full-canvas drawing doesn't ship as 10 MB to every visitor.
//
// The decision logic (planPrep / decide) is pure so it can be exercised from a
// node script; the browser codec (createImageBitmap + canvas) is injected via
// `PrepCodec`, and `browserCodec` is the default.

export type ImageKind =
  | "room-layer"
  | "sprite"
  | "content"
  | "landing"
  | "avatar"
  | "og";

/** Longest-side caps (px). `room-layer` also caps height at 1920. */
export const IMAGE_CAPS: Record<ImageKind, number> = {
  "room-layer": 3040,
  sprite: 2048,
  content: 2400,
  landing: 2400,
  avatar: 1024,
  og: 1200,
};
const ROOM_LAYER_MAX_H = 1920;
const OG_W = 1200;
const OG_H = 630;
const WEBP_QUALITY = 0.86;
const SMALL_PASSTHROUGH_BYTES = 150 * 1024;
const MIN_SAVING = 0.1;
export const WEIGHT_WARNING_BYTES = 1.5 * 1024 * 1024;

export interface PrepResult {
  blob: Blob;
  width: number;
  height: number;
  bytesIn: number;
  bytesOut: number;
  /** True when `blob` is a re-encoded/resized copy rather than the input. */
  changed: boolean;
  /** Human sentence to toast when the result is still heavy. */
  warning?: string;
}

/** What a codec must provide. Browser: bitmap + canvas. Tests: sharp. */
export interface PrepCodec {
  /** Decode just enough to know the pixel size. Throws if not decodable. */
  size(input: Blob): Promise<{ width: number; height: number }>;
  /** Scale (and, for `cover`, crop) to the exact target and encode as WebP. */
  encode(
    input: Blob,
    target: { width: number; height: number; cover: boolean },
    quality: number
  ): Promise<Blob>;
}

export interface PrepPlan {
  /** Output pixel size (equals the input when it already fits). */
  width: number;
  height: number;
  cover: boolean;
  /** The input needs scaling/cropping regardless of the byte saving. */
  mustResize: boolean;
}

/** Types we never touch: vector, possibly-animated, or not images. */
export function isPassthroughType(type: string): boolean {
  const t = type.toLowerCase();
  if (!t.startsWith("image/")) return true; // PSD, fonts, video …
  return t === "image/svg+xml" || t === "image/gif";
}

/** Pure: the target size for an input of w×h under `kind`'s cap. */
export function planPrep(kind: ImageKind, w: number, h: number): PrepPlan {
  if (kind === "og") {
    return {
      width: OG_W,
      height: OG_H,
      cover: true,
      mustResize: w !== OG_W || h !== OG_H,
    };
  }
  const cap = IMAGE_CAPS[kind];
  const maxH = kind === "room-layer" ? ROOM_LAYER_MAX_H : cap;
  // Never scale up: the factor is at most 1.
  const k = Math.min(1, cap / w, maxH / h);
  if (k >= 1) return { width: w, height: h, cover: false, mustResize: false };
  return {
    width: Math.max(1, Math.round(w * k)),
    height: Math.max(1, Math.round(h * k)),
    cover: false,
    mustResize: true,
  };
}

/** Pure: keep the re-encoded copy or fall back to the original? */
export function shouldKeepEncoded(
  plan: PrepPlan,
  bytesIn: number,
  bytesOut: number
): boolean {
  if (plan.mustResize) return true; // over the cap: always use the smaller-pixel copy
  return bytesOut <= bytesIn * (1 - MIN_SAVING);
}

export function heavyWarning(bytes: number): string | undefined {
  if (bytes <= WEIGHT_WARNING_BYTES) return undefined;
  return `This image is ${(bytes / 1024 / 1024).toFixed(1)} MB even after optimising; it may load slowly on phones.`;
}

export interface PrepOptions {
  codec?: PrepCodec;
  /**
   * Re-encode only, never change pixel dimensions. For art whose geometry is
   * fixed by a rig or sprite-sheet layout (wardrobe parts).
   */
  keepSize?: boolean;
}

export async function prepareImage(
  file: Blob,
  kind: ImageKind,
  opts: PrepOptions = {}
): Promise<PrepResult> {
  const codec = opts.codec ?? browserCodec;
  const bytesIn = file.size;
  const untouched = (w = 0, h = 0): PrepResult => ({
    blob: file,
    width: w,
    height: h,
    bytesIn,
    bytesOut: bytesIn,
    changed: false,
    warning: heavyWarning(bytesIn),
  });

  if (isPassthroughType(file.type)) return untouched();

  let dims: { width: number; height: number };
  try {
    dims = await codec.size(file);
  } catch {
    return untouched(); // undecodable here: let Storage have the original
  }
  const plan = opts.keepSize
    ? { width: dims.width, height: dims.height, cover: false, mustResize: false }
    : planPrep(kind, dims.width, dims.height);

  // Already small and within the cap: nothing to gain.
  if (!plan.mustResize && bytesIn <= SMALL_PASSTHROUGH_BYTES) {
    return untouched(dims.width, dims.height);
  }

  let out: Blob;
  try {
    out = await codec.encode(file, plan, WEBP_QUALITY);
  } catch {
    return untouched(dims.width, dims.height);
  }

  if (!shouldKeepEncoded(plan, bytesIn, out.size)) {
    return untouched(dims.width, dims.height);
  }
  return {
    blob: out,
    width: plan.width,
    height: plan.height,
    bytesIn,
    bytesOut: out.size,
    changed: true,
    warning: heavyWarning(out.size),
  };
}

// ─── Browser codec ────────────────────────────────────────────

function canvasToBlob(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) =>
        b && b.type === "image/webp"
          ? resolve(b)
          : reject(new Error("WebP encoding unavailable")),
      "image/webp",
      quality
    );
  });
}

export const browserCodec: PrepCodec = {
  async size(input) {
    const bmp = await createImageBitmap(input);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  },
  async encode(input, target, quality) {
    const bmp = await createImageBitmap(input);
    try {
      const c = document.createElement("canvas");
      c.width = target.width;
      c.height = target.height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      ctx.imageSmoothingQuality = "high";
      if (target.cover) {
        // Centre-crop to the target aspect, then scale.
        const s = Math.max(target.width / bmp.width, target.height / bmp.height);
        const sw = target.width / s;
        const sh = target.height / s;
        ctx.drawImage(
          bmp,
          (bmp.width - sw) / 2,
          (bmp.height - sh) / 2,
          sw,
          sh,
          0,
          0,
          target.width,
          target.height
        );
      } else {
        ctx.drawImage(bmp, 0, 0, target.width, target.height);
      }
      return await canvasToBlob(c, quality);
    } finally {
      bmp.close();
    }
  },
};

// ─── Helpers for callers ──────────────────────────────────────

/** File extension matching a (possibly re-encoded) blob's type. */
export function extForType(type: string): string {
  return (
    (
      {
        "image/webp": "webp",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/avif": "avif",
        "image/svg+xml": "svg",
      } as Record<string, string>
    )[type.toLowerCase()] ?? "png"
  );
}

// ─── Oversized originals ──────────────────────────────────────

/** Originals above this are re-encoded so they fit the 25 MB upload limit. */
export const ORIGINAL_REENCODE_OVER_BYTES = 20 * 1024 * 1024;
const ORIGINAL_MAX_SIDE = 6080;
const ORIGINAL_QUALITY = 0.95;

/**
 * A room-background ORIGINAL is kept as uploaded (it's the re-crop source),
 * except when it is over 20 MB: then high-quality WebP (q 0.95) with the
 * longest side capped at 6080 px. Falls back to the input if it can't help.
 */
export async function prepareOriginal(
  file: Blob,
  codec: PrepCodec = browserCodec
): Promise<PrepResult> {
  const unchanged = (): PrepResult => ({
    blob: file, width: 0, height: 0, bytesIn: file.size, bytesOut: file.size, changed: false,
  });
  if (file.size <= ORIGINAL_REENCODE_OVER_BYTES || isPassthroughType(file.type)) return unchanged();
  try {
    const { width, height } = await codec.size(file);
    const k = Math.min(1, ORIGINAL_MAX_SIDE / Math.max(width, height));
    const target = {
      width: Math.max(1, Math.round(width * k)),
      height: Math.max(1, Math.round(height * k)),
      cover: false,
    };
    const out = await codec.encode(file, target, ORIGINAL_QUALITY);
    if (out.size >= file.size) return unchanged();
    return { blob: out, width: target.width, height: target.height, bytesIn: file.size, bytesOut: out.size, changed: true };
  } catch {
    return unchanged();
  }
}
