// Client-side glue between imagePrep (pure) and the upload helpers: optimise,
// toast when the result is still heavy, and hand back what to upload.

import { toast } from "sonner";
import { prepareImage, prepareOriginal, extForType, type ImageKind, type PrepOptions } from "./imagePrep";

export interface PreparedUpload {
  blob: Blob;
  /** MIME type to upload with; matches `blob` (and `ext`). */
  type: string;
  ext: string;
  changed: boolean;
}

/** Optimise `file` for `kind`, never throwing: on any failure the original goes up. */
export async function prepareForUpload(
  file: Blob,
  kind: ImageKind,
  opts: Pick<PrepOptions, "keepSize"> = {}
): Promise<PreparedUpload> {
  try {
    const r = await prepareImage(file, kind, opts);
    if (r.warning) toast.warning(r.warning);
    return {
      blob: r.blob,
      type: r.blob.type || file.type || "image/png",
      ext: extForType(r.blob.type || file.type),
      changed: r.changed,
    };
  } catch {
    return {
      blob: file,
      type: file.type || "image/png",
      ext: extForType(file.type),
      changed: false,
    };
  }
}

/** `name.ext` with the extension swapped to `ext` (adds one if missing). */
export function withExt(name: string, ext: string): string {
  return /\.[a-z0-9]+$/i.test(name)
    ? name.replace(/\.[a-z0-9]+$/i, `.${ext}`)
    : `${name}.${ext}`;
}

/** A room-background original: untouched unless over 20 MB (then q0.95 WebP, max 6080 px). */
export async function prepareOriginalForUpload(file: Blob): Promise<PreparedUpload> {
  const r = await prepareOriginal(file);
  if (r.changed) {
    toast.info(
      `The original was ${(r.bytesIn / 1048576).toFixed(0)} MB, so it was saved as a high-quality WebP (${(r.bytesOut / 1048576).toFixed(1)} MB).`
    );
  }
  const type = r.blob.type || file.type || "image/png";
  return { blob: r.blob, type, ext: extForType(type), changed: r.changed };
}
