// API: File upload to Supabase Storage
//
// POST /api/editor/upload — upload a sprite, image, PSD scene, video, sound or
// document. Body: FormData with "file" + "bucket" + optional "path" (a fixed
// object path, upserted) or "folder" (a generated name inside that folder).
//
// Owner-gated because this route uses the service-role client and would
// otherwise allow anonymous writes to private buckets like `drawing-scenes`.
//
// Type checks (the service-role client still meets each bucket's own
// allowed_mime_types; these run first so the owner gets a clear message):
//   content-videos  video files only (MIME video/* AND a video extension)
//   content-files   PDF + audio only (the same list as the bucket allowlist in
//                   migration 20261007000001_content_files_bucket; never
//                   HTML, SVG or anything executable)
// The stored contentType is the canonical one for the extension, so a browser
// that reports "audio/x-wav" still lands as "audio/wav".

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/api/owner-auth";
import { resolveStorageUrl } from "@/lib/storageUrl";

const ALLOWED_BUCKETS = new Set([
  "sprites",
  "content-images",
  "room-backgrounds",
  "room-bg-originals",
  "drawing-scenes",
  "avatar-assets",
  "content-videos",
  "content-files",
]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** extension → [canonical contentType, MIME types browsers report for it]. */
type TypeRule = Record<string, [string, string[]]>;

const VIDEO_TYPES: TypeRule = {
  mp4: ["video/mp4", ["video/mp4"]],
  m4v: ["video/x-m4v", ["video/x-m4v", "video/mp4"]],
  webm: ["video/webm", ["video/webm"]],
  mov: ["video/quicktime", ["video/quicktime"]],
  ogv: ["video/ogg", ["video/ogg"]],
};

// Same list as the content-files allowed_mime_types in migration
// 20261007000001_content_files_bucket.
const FILE_TYPES: TypeRule = {
  pdf: ["application/pdf", ["application/pdf"]],
  mp3: ["audio/mpeg", ["audio/mpeg", "audio/mp3"]],
  m4a: ["audio/mp4", ["audio/mp4", "audio/x-m4a", "audio/m4a"]],
  aac: ["audio/aac", ["audio/aac", "audio/x-aac"]],
  ogg: ["audio/ogg", ["audio/ogg"]],
  oga: ["audio/ogg", ["audio/ogg"]],
  opus: ["audio/ogg", ["audio/ogg", "audio/opus"]],
  wav: ["audio/wav", ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]],
  weba: ["audio/webm", ["audio/webm"]],
  flac: ["audio/flac", ["audio/flac", "audio/x-flac"]],
};

const TYPE_RULES: Record<string, { rule: TypeRule; refuse: string }> = {
  "content-videos": { rule: VIDEO_TYPES, refuse: "Only video files (MP4, WebM, MOV) can go here." },
  "content-files": { rule: FILE_TYPES, refuse: "Only PDFs and sound files (MP3, M4A, WAV, OGG, FLAC) can go here." },
};

/** Canonical contentType for a checked bucket, or null when refused. */
function checkedType(bucket: string, file: File): string | null | undefined {
  const rules = TYPE_RULES[bucket];
  if (!rules) return undefined; // bucket without a type rule
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const entry = rules.rule[ext];
  if (!entry) return null;
  const reported = (file.type || "").toLowerCase().split(";")[0].trim();
  return entry[1].includes(reported) ? entry[0] : null;
}

/** A custom object path: relative, no traversal, no backslashes. */
function isSafePath(p: string): boolean {
  return !p.includes("..") && !p.startsWith("/") && !p.includes("\\");
}

/** "My CV (final).PDF" → "my-cv-final" (for readable download names). */
function slugBase(name: string): string {
  const base = name.replace(/\.[^.]*$/, "");
  return (
    base
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "file"
  );
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const bucket = (formData.get("bucket") as string) || "sprites";
  const customPath = (formData.get("path") as string | null) || null;
  const folder = (formData.get("folder") as string | null) || null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Unknown bucket" }, { status: 400 });
  }
  if (customPath && !isSafePath(customPath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  if (folder && !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(folder)) {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File too large (25 MB max)" },
      { status: 413 }
    );
  }
  const contentType = checkedType(bucket, file);
  if (contentType === null) {
    return NextResponse.json({ error: TYPE_RULES[bucket].refuse }, { status: 415 });
  }

  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const rand = Math.random().toString(36).slice(2, 10);
  const path =
    customPath ||
    (folder
      ? // Readable names for downloads: "<time>-<rand>-my-cv.pdf".
        `${folder}/${Date.now()}-${rand}-${slugBase(file.name)}.${ext}`
      : `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: contentType ?? file.type,
      // PSD re-saves pass a fixed path and need to replace it; generated
      // names must never silently overwrite an existing object.
      upsert: customPath !== null,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 }
    );
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);

  return NextResponse.json({ url: resolveStorageUrl(publicUrl), path });
}
