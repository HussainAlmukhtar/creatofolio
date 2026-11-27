// Media library (landing editor + pop-up composer), one shelf per kind,
// newest first:
//   image → content-images/images/  (uploads, drawing-studio PNGs)
//   video → content-videos/videos/
//   audio → content-files/audio/
//   file  → content-files/files/    (PDFs)
// Listing needs the owner session — each bucket's storage RLS policy
// (storage_owner_write_*, FOR ALL) grants SELECT to the owner only. Images are
// uploaded from the browser after prepareForUpload; video/audio/files go
// through /api/editor/upload, which checks the file type server-side.

import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveStorageUrl } from "@/lib/storageUrl";
import type { MediaKind } from "@/data/landingTypes";

export interface MediaItem {
  name: string;
  url: string;
  createdAt?: string;
  bytes?: number;
}

const BUCKET = "content-images";
const FOLDER = "images";
const PAGE = 100;
const MAX = 1000;

/** Where each kind lives (bucket + folder). */
export const MEDIA_SHELVES: Record<MediaKind, { bucket: string; folder: string }> = {
  image: { bucket: BUCKET, folder: FOLDER },
  video: { bucket: "content-videos", folder: "videos" },
  audio: { bucket: "content-files", folder: "audio" },
  file: { bucket: "content-files", folder: "files" },
};

/** What the file picker and the upload route accept per kind. Mirrors the
 *  server's check (api/editor/upload) and the bucket allowlist in migration
 *  20261007000001_content_files_bucket. */
export const MEDIA_ACCEPT: Record<MediaKind, string> = {
  image: "image/*",
  video: "video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg,.mp4,.webm,.mov,.m4v,.ogv",
  audio: "audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/flac,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.weba,.flac",
  file: "application/pdf,.pdf",
};

/** The display name of an uploaded file ("1712-ab3d-my-cv.pdf" → "my-cv.pdf"). */
export function mediaDisplayName(name: string): string {
  return name.replace(/^\d{10,}-[a-z0-9]{4,12}-/, "");
}

export async function listMediaImages(): Promise<{ items: MediaItem[]; error?: string }> {
  return listMedia("image");
}

export async function listMedia(kind: MediaKind): Promise<{ items: MediaItem[]; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { items: [], error: "Supabase isn't configured." };
  const { bucket, folder } = MEDIA_SHELVES[kind];
  const items: MediaItem[] = [];
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit: PAGE,
      offset,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) return { items, error: error.message };
    for (const f of data ?? []) {
      // Folders come back as entries with no id.
      if (!f.id || f.name.startsWith(".")) continue;
      items.push({
        name: f.name,
        url: resolveStorageUrl(
          supabase.storage.from(bucket).getPublicUrl(`${folder}/${f.name}`).data.publicUrl
        ),
        createdAt: f.created_at ?? undefined,
        bytes: (f.metadata as { size?: number } | null)?.size,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return { items };
}

/**
 * Upload a video / audio / document through the owner-only upload route
 * (which checks the type server-side). Images use uploadContentImage instead
 * (they're resized first).
 */
export async function uploadMediaFile(
  file: File,
  kind: Exclude<MediaKind, "image">
): Promise<{ url?: string; error?: string }> {
  const { bucket, folder } = MEDIA_SHELVES[kind];
  const form = new FormData();
  form.set("file", file);
  form.set("bucket", bucket);
  form.set("folder", folder);
  try {
    const res = await fetch("/api/editor/upload", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !json.url) return { error: json.error ?? `Upload failed (${res.status})` };
    return { url: json.url };
  } catch {
    return { error: "Upload failed: check your connection." };
  }
}

/** "2.4 MB", "820 KB". */
export function formatBytes(n: number | undefined): string {
  if (!n || n < 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Natural pixel size of an image URL or File (undefined if it won't load). */
export function readNaturalSize(src: string | Blob): Promise<{ w: number; h: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const done = (v: { w: number; h: number } | undefined) => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      resolve(v);
    };
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(undefined);
    img.src = url;
  });
}
