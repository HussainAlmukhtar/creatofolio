// Trim transparent padding off an exported drawing (Drawing Studio PNGs are
// always canvas-sized). Shared by the room editor's and landing editor's
// studios. `x`/`y` are where the trimmed box sat inside the original canvas,
// so a drawing made on a room-sized canvas can be placed exactly where it
// was drawn.

export interface TrimResult {
  blob: Blob;
  w: number;
  h: number;
  /** Offset of the trimmed box inside the original image. */
  x: number;
  y: number;
  /** False when nothing was cut (blank canvas / unreadable pixels). */
  trimmed: boolean;
}

/**
 * Crops `blob` to the bounding box of its non-transparent pixels. Returns the
 * original blob (and its full dimensions) if nothing was drawn or the canvas
 * can't be read back (e.g. a tainted canvas).
 */
export async function trimTransparentPadding(
  blob: Blob
): Promise<TrimResult> {
  const bitmap = await createImageBitmap(blob);
  const full = document.createElement("canvas");
  full.width = bitmap.width;
  full.height = bitmap.height;
  const ctx = full.getContext("2d");
  if (!ctx) return { blob, w: bitmap.width, h: bitmap.height, x: 0, y: 0, trimmed: false };
  ctx.drawImage(bitmap, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, full.width, full.height).data;
  } catch {
    return { blob, w: full.width, h: full.height, x: 0, y: 0, trimmed: false };
  }

  const w = full.width;
  const h = full.height;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const alphaThreshold = 10; // ignores near-invisible antialiasing dust
  for (let y = 0; y < h; y++) {
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[rowBase + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { blob, w, h, x: 0, y: 0, trimmed: false }; // blank canvas — nothing to trim
  }

  const pad = 2; // small breathing room so soft/antialiased edges aren't clipped
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  cropped.getContext("2d")!.drawImage(full, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  const croppedBlob = await new Promise<Blob | null>((resolve) =>
    cropped.toBlob(resolve, "image/png")
  );
  return croppedBlob
    ? { blob: croppedBlob, w: cropW, h: cropH, x: minX, y: minY, trimmed: true }
    : { blob, w, h, x: 0, y: 0, trimmed: false };
}
