// Saved pop-up presets (migration 20261008000002_popup_presets): "Save as
// preset" in the pop-up composer stores a copy of a pop-up's body in
// `popup_presets` (owner-only, reads included); the composer offers them
// next to the built-in presets (components/popup-editor/popupPresets.ts).
//
// Feature-detected: without migration 20261008000002_popup_presets the table is missing (42P01 /
// PGRST205) and `listPopupPresets` reports `missing`, so the composer hides
// "Save as preset". Writes follow the writeGuard rules (0 rows / 42501 are
// honest failures).

import { getSupabaseClient } from "@/lib/supabase/client";
import { rewriteStorageUrls } from "@/lib/storageUrl";
import { noRowsResult, writeErrorFor } from "@/lib/writeGuard";
import type { WriteResult } from "@/lib/editorData";
import type { ObjectContent } from "@/data/contentTypes";
import { migrateObjectContent } from "@/data/contentMigrations";

/** What a preset carries: the pop-up's body, never its object/room. */
export type PresetBody = Pick<ObjectContent, "layout" | "blocks" | "pages" | "size" | "frameIid" | "title" | "titleAr">;

export interface SavedPreset {
  iid: string;
  name: string;
  nameAr: string;
  body: PresetBody;
  updatedAt: string;
}

type Err = { code?: string; message?: string } | null;

function presetsMissing(e: Err): boolean {
  if (!e) return false;
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    (/popup_presets/.test(e.message ?? "") && /not find|does not exist/i.test(e.message ?? ""))
  );
}

/** The body of a pop-up, ready to store (migrated to v2, no ids of its host). */
export function presetBodyOf(content: ObjectContent): PresetBody {
  const c = migrateObjectContent(content) ?? content;
  return {
    layout: c.layout ?? "sheet",
    blocks: c.blocks ?? [],
    ...(c.layout === "pages" ? { pages: c.pages ?? [] } : {}),
    ...(c.size ? { size: c.size } : {}),
    ...(c.frameIid ? { frameIid: c.frameIid } : {}),
    title: c.title ?? "",
    titleAr: c.titleAr ?? "",
  };
}

export async function listPopupPresets(): Promise<{ items: SavedPreset[]; missing: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { items: [], missing: true };
  const { data, error } = await supabase
    .from("popup_presets")
    .select("iid, name, name_ar, content, updated_at")
    .order("updated_at", { ascending: false });
  if (presetsMissing(error)) return { items: [], missing: true };
  if (error) return { items: [], missing: false, error: error.message };
  return {
    missing: false,
    items: (data ?? []).map((r) => ({
      iid: r.iid as string,
      name: (r.name as string) || "Untitled",
      nameAr: (r.name_ar as string) ?? "",
      // Saved URLs follow the current storage origin, like every other read.
      body: rewriteStorageUrls(r.content) as PresetBody,
      updatedAt: r.updated_at as string,
    })),
  };
}

export async function savePopupPreset(name: string, content: ObjectContent): Promise<WriteResult & { iid?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase
    .from("popup_presets")
    .insert({ name: name.trim() || "Untitled", content: presetBodyOf(content) })
    .select("iid")
    .single();
  if (presetsMissing(error)) return { ok: false, error: "Saved presets need migration 20261008000002_popup_presets.sql." };
  if (error) return writeErrorFor(supabase, error);
  return { ok: true, iid: (data as { iid: string }).iid };
}

export async function deletePopupPreset(iid: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase.from("popup_presets").delete().eq("iid", iid).select("iid");
  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "That preset");
  return { ok: true };
}
