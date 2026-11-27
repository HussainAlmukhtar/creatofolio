// Pop-up theme + frame library — data layer (migration 20261008000001_popup_styles).
//
// Two halves:
//   1. PUBLIC: loadPublicPopupStyles() reads every PUBLISHED item with the
//      anon client (the runtime: game + landing pop-ups). Cached per tab;
//      any failure (table missing, offline, 4 s timeout) falls back to the
//      built-in look silently, like every other visitor loader.
//   2. OWNER (editor, /admin/popup-styles): list, create, rename, archive,
//      duplicate, drafts with an `updated_at` token (conflict → the caller
//      asks "keep mine / load theirs"), Publish (publish_popup_style RPC),
//      history, make a theme active (set_active_popup_theme RPC). Writes go
//      through writeGuard so a lapsed session reads as one, not as success.
//
// Feature detection: a missing table (42P01 / PGRST205) or function
// (PGRST202) → `available: false`; the library page then says to apply
// 20261008000001_popup_styles.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getPublicAnonClient } from "@/lib/landingData";
import { withTimeout } from "@/lib/withTimeout";
import { rewriteStorageUrls } from "@/lib/storageUrl";
import { noRowsResult, writeErrorFor } from "@/lib/writeGuard";
import type { WriteResult } from "@/lib/editorData";
import {
  defaultFrameConfig,
  defaultThemeConfig,
  normalizeConfig,
  normalizeFrame,
  normalizeTheme,
  type PopupFrameConfig,
  type PopupStyleRow,
  type PopupThemeConfig,
  type StyleKind,
} from "@/data/popupStyleTypes";

type Err = { code?: string; message?: string } | null | undefined;

/** 42P01 / PGRST205 = table missing; PGRST202 = function missing. */
export function styleTablesMissing(e: Err): boolean {
  if (!e) return false;
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    (/popup_style/.test(e.message ?? "") && /not find|does not exist/i.test(e.message ?? ""))
  );
}

interface DbRow {
  iid: string;
  kind: StyleKind;
  name: string;
  name_ar: string;
  config: unknown;
  is_active: boolean;
  archived_at: string | null;
  published_at: string | null;
  updated_at: string;
  created_at: string;
}

const COLUMNS = "iid, kind, name, name_ar, config, is_active, archived_at, published_at, updated_at, created_at";

function fromDb(r: DbRow): PopupStyleRow {
  return {
    iid: r.iid,
    kind: r.kind,
    name: r.name,
    nameAr: r.name_ar,
    config: normalizeConfig(r.kind, rewriteStorageUrls(r.config)),
    isActive: r.is_active,
    archivedAt: r.archived_at,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  };
}

// ─── Public (visitors) ──────────────────────────────────────────

export interface PublicPopupStyles {
  /** The active theme's live config; null = the built-in look. */
  theme: PopupThemeConfig | null;
  /** Every published frame by iid (archived ones too: pop-ups using an
   *  archived frame keep showing it). */
  frames: Record<string, PopupFrameConfig>;
  /** Frames the composer may offer (published, not archived). */
  frameList: { iid: string; name: string; nameAr: string }[];
}

export const NO_STYLES: PublicPopupStyles = { theme: null, frames: {}, frameList: [] };

let publicCache: Promise<PublicPopupStyles> | null = null;

export function loadPublicPopupStyles(): Promise<PublicPopupStyles> {
  publicCache ??= (async () => {
    const supabase = getPublicAnonClient();
    if (!supabase) return NO_STYLES;
    const read = (async (): Promise<PublicPopupStyles | null> => {
      try {
        const { data, error } = await supabase
          .from("popup_styles")
          .select(COLUMNS)
          .not("published_at", "is", null);
        if (error || !data) return null;
        const rows = (data as DbRow[]).map(fromDb);
        const active = rows.find((r) => r.kind === "theme" && r.isActive);
        const frames: Record<string, PopupFrameConfig> = {};
        const frameList: PublicPopupStyles["frameList"] = [];
        for (const r of rows) {
          if (r.kind !== "frame") continue;
          frames[r.iid] = r.config as PopupFrameConfig;
          if (!r.archivedAt) frameList.push({ iid: r.iid, name: r.name, nameAr: r.nameAr });
        }
        frameList.sort((a, b) => a.name.localeCompare(b.name));
        return { theme: active ? (active.config as PopupThemeConfig) : null, frames, frameList };
      } catch {
        return null;
      }
    })();
    return (await withTimeout(read, 4000, null)) ?? NO_STYLES;
  })();
  return publicCache;
}

/** Forget the cached public styles (after a publish / make-active). */
export function invalidatePublicPopupStyles(): void {
  publicCache = null;
}

// ─── Owner (editor) ─────────────────────────────────────────────

function client(): SupabaseClient | null {
  return getSupabaseClient();
}

export interface StyleListResult {
  available: boolean;
  items: (PopupStyleRow & { draftUpdatedAt: string | null })[];
  error?: string;
}

export async function listPopupStyles(): Promise<StyleListResult> {
  const supabase = client();
  if (!supabase) return { available: false, items: [], error: "Supabase isn't configured." };
  const { data, error } = await supabase.from("popup_styles").select(COLUMNS).order("created_at");
  if (error) {
    return styleTablesMissing(error)
      ? { available: false, items: [] }
      : { available: true, items: [], error: error.message };
  }
  const drafts = await supabase.from("popup_style_drafts").select("style_iid, updated_at");
  const draftAt = new Map((drafts.data ?? []).map((d) => [d.style_iid as string, d.updated_at as string]));
  return {
    available: true,
    items: (data as DbRow[]).map((r) => ({ ...fromDb(r), draftUpdatedAt: draftAt.get(r.iid) ?? null })),
  };
}

export async function createPopupStyle(
  kind: StyleKind,
  name: string,
  config?: PopupThemeConfig | PopupFrameConfig
): Promise<WriteResult & { iid?: string }> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase
    .from("popup_styles")
    .insert({ kind, name, config: config ?? (kind === "theme" ? defaultThemeConfig() : defaultFrameConfig()) })
    .select("iid")
    .maybeSingle();
  if (error) return writeErrorFor(supabase, error);
  return { ok: true, iid: (data as { iid: string } | null)?.iid };
}

/** Name changes are metadata: they don't touch `updated_at` (the publish token). */
export async function renamePopupStyle(iid: string, name: string, nameAr: string): Promise<WriteResult> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase.from("popup_styles").update({ name, name_ar: nameAr }).eq("iid", iid).select("iid");
  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "That item");
  return { ok: true };
}

export async function setPopupStyleArchived(iid: string, archived: boolean): Promise<WriteResult> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase
    .from("popup_styles")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("iid", iid)
    .select("iid");
  if (error) {
    // The CHECK constraint: the active theme can't be archived.
    if (error.code === "23514") return { ok: false, error: "This is the active theme. Make another theme active (or none) first." };
    return writeErrorFor(supabase, error);
  }
  if (!data?.length) return noRowsResult(supabase, "That item");
  invalidatePublicPopupStyles();
  return { ok: true };
}

/** A copy of the item as currently edited (draft, else live), unpublished. */
export async function duplicatePopupStyle(
  row: PopupStyleRow,
  config: PopupThemeConfig | PopupFrameConfig
): Promise<WriteResult & { iid?: string }> {
  return createPopupStyle(row.kind, `${row.name || "Untitled"} (copy)`, config);
}

export async function setActivePopupTheme(iid: string | null): Promise<WriteResult> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { error } = await supabase.rpc("set_active_popup_theme", { p_iid: iid });
  if (error) {
    if (error.code === "P0001") return { ok: false, error: "Only a published, unarchived theme can be made active." };
    return writeErrorFor(supabase, error);
  }
  invalidatePublicPopupStyles();
  return { ok: true };
}

export interface StyleForEditor {
  row: PopupStyleRow;
  /** What the editor opens: the draft if there is one, else the live config. */
  config: PopupThemeConfig | PopupFrameConfig;
  /** Draft token (null = no draft yet). */
  draftUpdatedAt: string | null;
}

export async function loadPopupStyleForEditor(iid: string): Promise<{ ok: true; data: StyleForEditor } | { ok: false; error: string }> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase.from("popup_styles").select(COLUMNS).eq("iid", iid).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That item doesn't exist (any more)." };
  const row = fromDb(data as DbRow);
  const { data: draft } = await supabase
    .from("popup_style_drafts")
    .select("config, updated_at")
    .eq("style_iid", iid)
    .maybeSingle();
  return {
    ok: true,
    data: {
      row,
      config: draft ? normalizeConfig(row.kind, rewriteStorageUrls(draft.config)) : row.config,
      draftUpdatedAt: (draft?.updated_at as string | undefined) ?? null,
    },
  };
}

/**
 * Save the draft. `expected` = the draft token the editor last saw (null = it
 * saw no draft). Someone else saved in between → `code: "conflict"`; `force`
 * writes anyway. Returns the new token.
 */
export async function savePopupStyleDraft(
  iid: string,
  config: PopupThemeConfig | PopupFrameConfig,
  opts: { expected: string | null; force?: boolean }
): Promise<WriteResult & { updatedAt?: string }> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const now = new Date().toISOString();
  if (opts.force) {
    const { error } = await supabase
      .from("popup_style_drafts")
      .upsert({ style_iid: iid, config, updated_at: now }, { onConflict: "style_iid" });
    if (error) return writeErrorFor(supabase, error);
    return { ok: true, updatedAt: now };
  }
  if (opts.expected === null) {
    const { error } = await supabase.from("popup_style_drafts").insert({ style_iid: iid, config, updated_at: now });
    if (error) {
      if (error.code === "23505") return { ok: false, code: "conflict", error: "A draft was saved somewhere else meanwhile." };
      return writeErrorFor(supabase, error);
    }
    return { ok: true, updatedAt: now };
  }
  const { data, error } = await supabase
    .from("popup_style_drafts")
    .update({ config, updated_at: now })
    .eq("style_iid", iid)
    .eq("updated_at", opts.expected)
    .select("style_iid");
  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) {
    // Session lapsed, or the draft moved on (or was published/discarded).
    const denial = await noRowsResult(supabase, "The draft");
    return denial.code === "not_found"
      ? { ok: false, code: "conflict", error: "This draft was changed somewhere else (another tab?)." }
      : denial;
  }
  return { ok: true, updatedAt: now };
}

export async function discardPopupStyleDraft(iid: string): Promise<WriteResult> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { error } = await supabase.from("popup_style_drafts").delete().eq("style_iid", iid);
  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

/** Draft → live. `expected` = the live row's updated_at as last seen. */
export async function publishPopupStyle(iid: string, expected: string | null): Promise<WriteResult & { publishedAt?: string }> {
  const supabase = client();
  if (!supabase) return { ok: false, error: "Supabase isn't configured." };
  const { data, error } = await supabase.rpc("publish_popup_style", { p_iid: iid, p_expected_updated_at: expected });
  if (error) {
    if (error.code === "40001") return { ok: false, code: "conflict", error: "The live version changed somewhere else since you opened this." };
    if (error.code === "P0002") return { ok: false, code: "not_found", error: "There's no draft to publish (save first)." };
    return writeErrorFor(supabase, error);
  }
  invalidatePublicPopupStyles();
  return { ok: true, publishedAt: data as string };
}

export interface StyleBackup {
  id: string;
  label: string;
  savedAt: string;
  config: PopupThemeConfig | PopupFrameConfig;
}

export async function listPopupStyleBackups(iid: string, kind: StyleKind): Promise<StyleBackup[]> {
  const supabase = client();
  if (!supabase) return [];
  const { data } = await supabase
    .from("popup_style_backups")
    .select("id, label, saved_at, config")
    .eq("style_iid", iid)
    .order("saved_at", { ascending: false });
  return (data ?? []).map((b) => ({
    id: b.id as string,
    label: b.label as string,
    savedAt: b.saved_at as string,
    config: kind === "theme" ? normalizeTheme(rewriteStorageUrls(b.config)) : normalizeFrame(rewriteStorageUrls(b.config)),
  }));
}

/**
 * Owner previews (the pop-up lab): the library as it would look with
 * `themeIid` active, using each item's DRAFT where it has one. Nothing is
 * activated or published; only this tab sees it.
 */
export async function loadOwnerPreviewStyles(themeIid: string | null): Promise<PublicPopupStyles> {
  const supabase = client();
  if (!supabase) return NO_STYLES;
  const [{ data: rows }, { data: drafts }] = await Promise.all([
    supabase.from("popup_styles").select(COLUMNS),
    supabase.from("popup_style_drafts").select("style_iid, config"),
  ]);
  const draftOf = new Map((drafts ?? []).map((d) => [d.style_iid as string, d.config]));
  const frames: Record<string, PopupFrameConfig> = {};
  const frameList: PublicPopupStyles["frameList"] = [];
  let theme: PopupThemeConfig | null = null;
  for (const raw of (rows ?? []) as DbRow[]) {
    const r = fromDb(raw);
    const cfg = draftOf.has(r.iid) ? normalizeConfig(r.kind, rewriteStorageUrls(draftOf.get(r.iid))) : r.config;
    if (r.kind === "theme" && r.iid === themeIid) theme = cfg as PopupThemeConfig;
    if (r.kind === "frame") {
      frames[r.iid] = cfg as PopupFrameConfig;
      if (!r.archivedAt) frameList.push({ iid: r.iid, name: r.name, nameAr: r.nameAr });
    }
  }
  return { theme, frames, frameList };
}
