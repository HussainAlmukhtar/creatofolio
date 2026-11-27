// Re-editable landing drawings — Klecks PSD persistence for the landing CMS.
//
// Port of the room editor's drawing-scene pattern (editorData.ts "Drawing
// Scenes"): the flattened PNG stays the thing visitors see (public
// `content-images` bucket), and the layered PSD is kept as the editing source
// in the PRIVATE `drawing-scenes` bucket, read back through a short-lived
// signed URL. Same bucket, same owner-gated /api/editor/upload and
// /api/editor/signed-url routes — no new routes, bucket or policies.
//
// One deliberate difference: rooms key PSDs by a `drawing_scenes` row per
// (room, target). Landing drawings don't need a table — the schema already
// carries the reference on the asset itself
// (`{ kind: "drawn"; sceneId; pngUrl }`, and the same shape for a drawn
// section background). Every save mints a NEW sceneId, so each saved page
// version points at the PSD that produced its PNG: restoring an old version
// from history and reopening the drawing gives you THAT version's layers,
// not the latest ones. Old PSDs are left in place (like old PNGs in
// content-images).

import { newIid } from "@/lib/iid";

const DRAWING_SCENES_BUCKET = "drawing-scenes";

/** Storage path of a landing drawing's PSD inside `drawing-scenes`. */
export function landingScenePath(sceneId: string): string {
  return `landing/${sceneId}.psd`;
}

export function newLandingSceneId(): string {
  return newIid();
}

/** Upload the PSD for `sceneId`. Returns false on any failure. */
export async function uploadLandingScenePsd(
  sceneId: string,
  psd: Blob
): Promise<boolean> {
  const form = new FormData();
  form.append("file", psd, `${sceneId}.psd`);
  form.append("bucket", DRAWING_SCENES_BUCKET);
  form.append("path", landingScenePath(sceneId));
  try {
    const res = await fetch("/api/editor/upload", { method: "POST", body: form });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The PSD bytes for `sceneId`, ready for Klecks's `readPSD()` — or null when
 * there's none (drawings made before PSDs were kept, a failed upload, or a
 * deleted object). Callers fall back to opening the flattened PNG.
 */
export async function loadLandingScenePsd(
  sceneId: string
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch("/api/editor/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: DRAWING_SCENES_BUCKET,
        path: landingScenePath(sceneId),
      }),
    });
    if (!res.ok) return null;
    const { signedUrl } = (await res.json()) as { signedUrl?: string };
    if (!signedUrl) return null;
    const psd = await fetch(signedUrl);
    return psd.ok ? await psd.arrayBuffer() : null;
  } catch {
    return null;
  }
}
