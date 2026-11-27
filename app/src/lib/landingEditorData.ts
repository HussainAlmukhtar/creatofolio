// Landing-page CMS editor data access layer — CRUD for pages, page content,
// section templates, and per-page version backups.
//
// Mirrors editorData.ts conventions:
//   - Every write returns { ok, error? } (WriteResult) so the store can surface
//     failures via toasts instead of silently flipping isDirty.
//   - Loaders return a `source` tag ("supabase" | "static" | "missing") so the
//     editor can warn the user when the DB wasn't reached and edits won't
//     persist. (The public runtime loader in landingData.ts falls back silently
//     instead — different audience, different contract.)
//
// Uses the browser anon-key client + RLS (getSupabaseClient), NOT a service-role
// API route. The room editor's real save path works this way; the /api/editor/*
// routes are a parallel, largely-unused path we deliberately don't imitate here.

import type { DrawnPage, DrawnSection, SiteConfig } from "@/data/landingTypes";
import type { ObjectContent } from "@/data/contentTypes";
import { defaultLandingPage } from "@/data/landingConfig";
import { defaultSiteConfig } from "@/data/siteConfig";
import { migrateLandingPage } from "@/data/landingMigrations";
import { migrateSiteConfig } from "@/data/siteConfigMigrations";
import { newIid } from "@/lib/iid";
import { getSupabaseClient } from "./supabase/client";
import { rewriteStorageUrls } from "./storageUrl";
import { migrateContentMap, migrateObjectContent } from "@/data/contentMigrations";
import type { WriteResult, EditorLoadSource } from "./editorData";
import { writeErrorFor, noRowsResult, denialFor } from "./writeGuard";

export type PageStatus = "draft" | "published";

export interface LandingPageRecord {
  /** The version being edited (versioned mode), else the page row's config. */
  page: DrawnPage;
  /** "published" = the page is online (its live version is what visitors see). */
  status: PageStatus;
  updatedAt?: string;
  /** Version currently open in the editor. Undefined = not saved as a version
   *  yet (the unsaved home seed, or the DB predates the versions migration). */
  versionId?: string;
  /** The version last pushed live (website_pages.live_version_id). */
  liveVersionId?: string;
  /** When the live version was last pushed. */
  publishedAt?: string;
}

/** A page version without its config (the switcher list). */
export interface PageVersionMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface SectionTemplateRecord {
  id: string;
  name: string;
  nameAr?: string;
  tags: string[];
  section: DrawnSection;
  thumbnailUrl?: string;
  createdAt?: string;
}

export interface PageBackupRow {
  id: string;
  pageIid: string;
  savedAt: string;
  savedBy?: string;
  label?: string;
  isPinned: boolean;
  /** The page as it was at this backup, migrated to the current schema. */
  config: DrawnPage;
}

// Slugs become public URL segments (/<slug>) and must not collide with real
// route segments or files served out of app/public/. The regex matches the
// world-file route's traversal guard; the reserved list is verified against
// app/ route segments + public/ top-level dirs.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "assets",
  "avatar",
  "klecks",
  "landing",
]);

/** True for slugs claimed by app routes / public dirs (not CMS pages). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Returns an error string if the slug is invalid or reserved, else null. */
export function validateSlug(slug: string): string | null {
  if (!SLUG_RE.test(slug)) {
    return "Slug must be lowercase letters, numbers, hyphens or underscores, and start with a letter or number.";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return `"${slug}" is a reserved slug and can't be used for a page.`;
  }
  return null;
}

// ─── Pages ──────────────────────────────────────────────────

/**
 * `pages` plus the unsaved static home seed when no saved "home" row exists.
 * First Save of it creates the row. Exported for the store's delete path.
 */
export function withSeedHome(pages: LandingPageRecord[]): LandingPageRecord[] {
  if (pages.some((r) => r.page.slug === "home")) return pages;
  return [{ page: defaultLandingPage, status: "draft" }, ...pages];
}

export async function loadAllLandingPagesForEditor(): Promise<{
  pages: LandingPageRecord[];
  /** Versions per page slug, most recently edited first. */
  versions: Record<string, PageVersionMeta[]>;
  /** False when the versions table isn't there (migration not applied yet):
   *  the editor then keeps the old Save-writes-the-page behaviour. */
  versioning: boolean;
  /** False until the versions.content migration is applied: button pop-up
   *  content is then shared by all versions (website_page_content). */
  versionContent: boolean;
  /** Per page slug: the open version's button content, { assetIid: content }.
   *  Only filled when `versionContent`. */
  contents: Record<string, Record<string, ObjectContent>>;
  source: EditorLoadSource;
  error?: string;
}> {
  const seedOnly = {
    pages: [{ page: defaultLandingPage, status: "draft" as const }],
    versions: {},
    versioning: false,
    versionContent: false,
    contents: {},
  };
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ...seedOnly, source: "static", error: "Supabase not configured — edits will not persist." };
  }

  // select("*") so this works before AND after the versions migration adds
  // live_version_id / published_at.
  const [pagesRes, versionsRes] = await Promise.all([
    supabase.from("website_pages").select("*"),
    supabase
      .from("website_page_versions")
      .select("id, page_iid, name, created_at, updated_at, published_at")
      .order("updated_at", { ascending: false }),
  ]);
  const { data, error } = pagesRes;

  if (error) return { ...seedOnly, source: "static", error: error.message };

  const versioning = !versionsRes.error;

  if (!data || data.length === 0) {
    // No rows yet — seed the editor with the static home page so the user has
    // something to publish. Marked "missing" so the UI can note it's unsaved.
    return { ...seedOnly, versioning, source: "missing" };
  }

  const metaByIid = new Map<string, PageVersionMeta[]>();
  for (const v of versionsRes.data ?? []) {
    const list = metaByIid.get(v.page_iid as string) ?? [];
    list.push(toVersionMeta(v));
    metaByIid.set(v.page_iid as string, list);
  }

  // Which version each page opens on: the one last open in this browser,
  // else the live one, else the most recently edited.
  const openOn = new Map<string, string>();
  for (const row of versioning ? data : []) {
    const list = metaByIid.get(row.iid as string) ?? [];
    const remembered = rememberedVersion(row.iid as string);
    const pick =
      list.find((v) => v.id === remembered) ??
      list.find((v) => v.id === row.live_version_id) ??
      list[0];
    if (pick) openOn.set(row.id as string, pick.id);
  }
  const configs = new Map<string, unknown>();
  const versionContents = new Map<string, unknown>();
  let versionContent = false;
  if (openOn.size) {
    const ids = [...openOn.values()];
    // Feature-detect versions.content: 42703 = column not there yet.
    type VersionRows = {
      data: { id: string; config: unknown; content?: unknown }[] | null;
      error: { code?: string; message: string } | null;
    };
    let res: VersionRows = await supabase.from("website_page_versions").select("id, config, content").in("id", ids);
    if (res.error?.code === "42703") {
      res = await supabase.from("website_page_versions").select("id, config").in("id", ids);
    } else if (!res.error) {
      versionContent = true;
    }
    if (res.error) return { ...seedOnly, source: "static", error: res.error.message };
    for (const r of res.data ?? []) {
      configs.set(r.id as string, r.config);
      versionContents.set(r.id as string, (r as { content?: unknown }).content);
    }
  } else if (versioning) {
    // No versions anywhere yet: ask the column question on its own.
    const probe = await supabase.from("website_page_versions").select("content").limit(1);
    versionContent = !probe.error;
  }

  const versions: Record<string, PageVersionMeta[]> = {};
  const contents: Record<string, Record<string, ObjectContent>> = {};
  const pages: LandingPageRecord[] = data.map((row) => {
    const slug = row.id as string;
    const versionId = openOn.get(slug);
    if (versioning) versions[slug] = metaByIid.get(row.iid as string) ?? [];
    if (versionContent && versionId) {
      const raw = versionContents.get(versionId);
      // null = saved by an older editor: its content is whatever is live.
      if (raw) contents[slug] = migrateContentMap(rewriteStorageUrls(raw as Record<string, ObjectContent>));
    }
    return {
      // The slug lives on the page row; a version's copy may predate a rename.
      page: { ...migrateLandingPage(configs.get(versionId ?? "") ?? row.config), slug },
      status: (row.status as PageStatus) ?? "draft",
      updatedAt: row.updated_at as string | undefined,
      versionId,
      liveVersionId: (row.live_version_id as string | null) ?? undefined,
      publishedAt: (row.published_at as string | null) ?? undefined,
    };
  });

  // The public "/" renders the static seed until a home row exists, so the
  // editor must always offer home too — otherwise creating any other page
  // first made the home page un-editable (it vanished from the list).
  if (versionContent) {
    for (const [slug, versionId] of openOn) {
      if (!contents[slug] && versionContents.get(versionId) == null) {
        contents[slug] = await loadAllPageContent(slug);
      }
    }
  }
  return { pages: withSeedHome(pages), versions, versioning, versionContent, contents, source: "supabase" };
}

/** One version row incl. its content map when the column exists (42703 → without). */
async function selectVersion(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  versionId: string
): Promise<{
  row?: { config: unknown; updated_at?: string; content?: Record<string, ObjectContent> | null };
  hasContentColumn: boolean;
  error?: string;
}> {
  let res = await supabase
    .from("website_page_versions")
    .select("config, content, updated_at")
    .eq("id", versionId)
    .maybeSingle();
  let hasContentColumn = true;
  if (res.error?.code === "42703") {
    hasContentColumn = false;
    res = await supabase
      .from("website_page_versions")
      .select("config, updated_at")
      .eq("id", versionId)
      .maybeSingle();
  }
  if (res.error) return { hasContentColumn, error: res.error.message };
  return {
    row: (res.data ?? undefined) as
      | { config: unknown; updated_at?: string; content?: Record<string, ObjectContent> | null }
      | undefined,
    hasContentColumn,
  };
}

/**
 * Load ONE page by slug regardless of status — the draft-preview route's
 * loader. Unlike the public loadPublishedLandingPage (landingData.ts) this does
 * NOT filter `status = 'published'`, and it reports why it failed instead of
 * silently falling back, because only the owner sees it (the route lives under
 * the proxy-gated /admin). Returns `record: null` when there's no such row.
 */
export async function loadLandingPageForPreview(
  slug: string,
  /** A specific saved version instead of the page row (the live config). */
  versionId?: string
): Promise<{
  record: LandingPageRecord | null;
  /** The version's own button pop-up content, when the DB has it. */
  content?: Record<string, ObjectContent>;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { record: null, error: "Supabase not configured." };
  }

  if (versionId) {
    const withContent = await selectVersion(supabase, versionId);
    if (withContent.error) return { record: null, error: withContent.error };
    const v = withContent.row;
    if (!v?.config) return { record: null };
    return {
      record: {
        page: { ...migrateLandingPage(v.config), slug },
        status: "draft",
        updatedAt: v.updated_at,
        versionId,
      },
      content: v.content ? migrateContentMap(rewriteStorageUrls(v.content)) : undefined,
    };
  }

  const { data, error } = await supabase
    .from("website_pages")
    .select("config, status, updated_at")
    .eq("id", slug)
    .maybeSingle();

  if (error) return { record: null, error: error.message };
  if (!data?.config) return { record: null };

  return {
    record: {
      page: migrateLandingPage(data.config),
      status: (data.status as PageStatus) ?? "draft",
      updatedAt: data.updated_at as string | undefined,
    },
  };
}

export async function saveLandingPage(
  page: DrawnPage,
  status: PageStatus = "draft"
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { error } = await supabase.from("website_pages").upsert(
    {
      id: page.slug,
      iid: page.iid,
      config: page,
      schema_version: page.schemaVersion,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) return writeErrorFor(supabase, error);

  // Best-effort backup — failure here doesn't fail the save.
  await recordPageBackup(page);

  return { ok: true };
}

// ─── Versions (drafts + the live one) ───────────────────────
//
// Shopify-style: a page owns named versions; the editor edits one at a time
// and Save writes only that version. Publish copies a version into
// website_pages.config (what the public loader reads) — see
// supabase/migrations/20261002000002_landing_page_versions.sql.

const VERSION_COLS = "id, name, created_at, updated_at, published_at";
const VERSION_PICK_KEY = "landing-editor:version:";

function toVersionMeta(v: Record<string, unknown>): PageVersionMeta {
  return {
    id: v.id as string,
    name: v.name as string,
    createdAt: v.created_at as string,
    updatedAt: v.updated_at as string,
    publishedAt: (v.published_at as string | null) ?? undefined,
  };
}

/** The version this browser last had open for a page (null if none). */
function rememberedVersion(pageIid: string): string | null {
  try {
    return localStorage.getItem(VERSION_PICK_KEY + pageIid);
  } catch {
    return null;
  }
}

export function rememberVersion(pageIid: string, versionId: string): void {
  try {
    localStorage.setItem(VERSION_PICK_KEY + pageIid, versionId);
  } catch {
    // Blocked storage: the editor just reopens on the live version.
  }
}

export interface SaveVersionOptions {
  /** versions.updated_at when this tab loaded/last saved the version (the
   *  optimistic-concurrency token). */
  expectedUpdatedAt?: string;
  /** Write even if someone else changed the version ("Overwrite"). */
  force?: boolean;
  /** Per-version button pop-up content ({ assetIid: ObjectContent }); only
   *  sent when given (needs the versions.content column). */
  content?: Record<string, ObjectContent>;
}

/**
 * Save the editor's page into a version. Never touches what visitors see.
 * With no `versionId` a new version named `name` is created — and the page
 * row too (offline) if it doesn't exist yet, e.g. the unsaved home seed.
 * With one, the update only lands if the version is unchanged since
 * `opts.expectedUpdatedAt` (else `code: "conflict"`).
 */
export async function saveLandingVersion(
  page: DrawnPage,
  versionId: string | undefined,
  name = "Draft",
  opts: SaveVersionOptions = {}
): Promise<WriteResult & { version?: PageVersionMeta; theirsUpdatedAt?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const now = new Date().toISOString();
  const contentCol = opts.content ? { content: opts.content } : {};

  if (!versionId) {
    const { data: existing, error: exErr } = await supabase
      .from("website_pages")
      .select("id")
      .eq("id", page.slug)
      .maybeSingle();
    if (exErr) return { ok: false, error: exErr.message };
    if (!existing) {
      const { error: pageErr } = await supabase.from("website_pages").insert({
        id: page.slug,
        iid: page.iid,
        config: page,
        schema_version: page.schemaVersion,
        status: "draft",
        updated_at: now,
      });
      if (pageErr) return writeErrorFor(supabase, pageErr);
    }
    const { data, error } = await supabase
      .from("website_page_versions")
      .insert({ page_iid: page.iid, name, config: page, schema_version: page.schemaVersion, created_at: now, updated_at: now, ...contentCol })
      .select(VERSION_COLS)
      .single();
    if (error) return writeErrorFor(supabase, error);
    const version = toVersionMeta(data);
    await recordPageBackup(page, version.id);
    return { ok: true, version };
  }

  let q = supabase
    .from("website_page_versions")
    .update({ config: page, schema_version: page.schemaVersion, updated_at: now, ...contentCol })
    .eq("id", versionId);
  if (!opts.force && opts.expectedUpdatedAt) q = q.eq("updated_at", opts.expectedUpdatedAt);
  const { data, error } = await q.select(VERSION_COLS);
  if (error) return writeErrorFor(supabase, error);

  if (!data?.length) {
    // 0 rows: session lapsed, version deleted, or someone else saved first.
    const denial = await denialFor(supabase);
    if (denial) return denial;
    const { data: cur, error: curErr } = await supabase
      .from("website_page_versions")
      .select("updated_at")
      .eq("id", versionId)
      .maybeSingle();
    if (curErr) return writeErrorFor(supabase, curErr);
    if (!cur) {
      return {
        ok: false,
        code: "not_found",
        error: "This draft was deleted somewhere else. Reload and try again.",
      };
    }
    return {
      ok: false,
      code: "conflict",
      theirsUpdatedAt: cur.updated_at as string,
      error: "This draft was changed somewhere else.",
    };
  }

  // Best-effort backup — failure here doesn't fail the save.
  await recordPageBackup(page, versionId);
  return { ok: true, version: toVersionMeta(data[0]) };
}

/**
 * New draft copied from a saved version, or from `config` (e.g. the editor's
 * unsaved state). Iids are kept, so button content stays attached.
 */
export async function duplicateLandingVersion(
  pageIid: string,
  name: string,
  from: { versionId: string } | { config: DrawnPage; content?: Record<string, ObjectContent> }
): Promise<
  WriteResult & { version?: PageVersionMeta; page?: DrawnPage; content?: Record<string, ObjectContent> }
> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  let source: DrawnPage;
  // Button pop-up content travels with the copy (undefined = column not there).
  let content: Record<string, ObjectContent> | undefined;
  if ("config" in from) {
    source = from.config;
    content = from.content;
  } else {
    const { row, error } = await selectVersion(supabase, from.versionId);
    if (error) return { ok: false, error };
    if (!row) return { ok: false, error: "That version no longer exists." };
    source = migrateLandingPage(row.config);
    content = row.content ?? undefined;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("website_page_versions")
    .insert({
      page_iid: pageIid,
      name,
      config: source,
      schema_version: source.schemaVersion,
      created_at: now,
      updated_at: now,
      ...(content ? { content } : {}),
    })
    .select(VERSION_COLS)
    .single();
  if (error) return writeErrorFor(supabase, error);
  return { ok: true, version: toVersionMeta(data), page: source, content };
}

/** One version's page (switching versions in the editor). */
export async function loadLandingVersion(
  versionId: string,
  slug: string
): Promise<{
  page?: DrawnPage;
  updatedAt?: string;
  /** The version's button content ({ assetIid: content }); undefined when the
   *  column doesn't exist yet or this version predates it (never saved with it). */
  content?: Record<string, ObjectContent>;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: "Supabase not configured." };
  const { row, error } = await selectVersion(supabase, versionId);
  if (error) return { error };
  if (!row) return { error: "That version no longer exists." };
  return {
    page: { ...migrateLandingPage(row.config), slug },
    updatedAt: row.updated_at,
    content: row.content ? migrateContentMap(rewriteStorageUrls(row.content)) : undefined,
  };
}

export async function renameLandingVersion(versionId: string, name: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const { data, error } = await supabase
    .from("website_page_versions")
    .update({ name })
    .eq("id", versionId)
    .select("id");
  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "This version");
  return { ok: true };
}

export async function deleteLandingVersion(versionId: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const { data, error } = await supabase
    .from("website_page_versions")
    .delete()
    .eq("id", versionId)
    .select("id");
  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "This version");
  // Its save history goes with it (best-effort; orphans are just invisible).
  const { error: histErr } = await supabase
    .from("website_page_backups")
    .delete()
    .eq("version_id", versionId);
  if (histErr) console.warn("[deleteLandingVersion] history cleanup failed", histErr.message);
  return { ok: true };
}

/**
 * Make a SAVED version what visitors see: copy its config into the page row,
 * mark the page published and point live_version_id at it. Callers save
 * unsaved edits first.
 */
export async function publishLandingVersion(
  slug: string,
  versionId: string
): Promise<WriteResult & { publishedAt?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Preferred: one transaction swaps the page row AND the live button content
  // (supabase/migrations/20261004000001_landing_version_content.sql).
  const rpc = await supabase.rpc("publish_landing_version", {
    p_slug: slug,
    p_version_id: versionId,
  });
  if (!rpc.error) return { ok: true, publishedAt: rpc.data as string };
  if (rpc.error.code === "P0002") {
    return { ok: false, code: "not_found", error: "That version or page no longer exists." };
  }
  if (rpc.error.code !== "PGRST202") return writeErrorFor(supabase, rpc.error);

  // PGRST202 = the function isn't there yet (migration not applied): the
  // client-side steps, with the row checks.
  const { data: v, error: vErr } = await supabase
    .from("website_page_versions")
    .select("config")
    .eq("id", versionId)
    .maybeSingle();
  if (vErr) return { ok: false, error: vErr.message };
  if (!v) return { ok: false, error: "That version no longer exists." };

  const config: DrawnPage = { ...migrateLandingPage(v.config), slug };
  const now = new Date().toISOString();
  const { data: published, error } = await supabase
    .from("website_pages")
    .update({
      config,
      schema_version: config.schemaVersion,
      status: "published",
      live_version_id: versionId,
      published_at: now,
      updated_at: now,
    })
    .eq("id", slug)
    .select("id");
  if (error) return writeErrorFor(supabase, error);
  // Checked BEFORE stamping the version: a lapsed session filters this update
  // to 0 rows with no error, and "is live" must never be reported for that.
  if (!published?.length) return noRowsResult(supabase, `Page "${slug}"`);

  // Stamp the version ("published …" in the list). Its updated_at is left
  // alone so "live version has unpublished edits" stays exact.
  const { error: stampErr } = await supabase
    .from("website_page_versions")
    .update({ published_at: now })
    .eq("id", versionId);
  if (stampErr) console.warn("[publishLandingVersion] stamp failed", stampErr.message);
  return { ok: true, publishedAt: now };
}

export async function setPageStatus(
  slug: string,
  status: PageStatus
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data, error } = await supabase
    .from("website_pages")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", slug)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, `Page "${slug}"`);
  return { ok: true };
}

export async function renameLandingPage(
  oldSlug: string,
  newSlug: string
): Promise<WriteResult> {
  const slugErr = validateSlug(newSlug);
  if (slugErr) return { ok: false, error: slugErr };

  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Preferred: the row id, config.slug and the content rows' page_slug change
  // in ONE transaction (migration 20261005000002_trash_and_atomic_ops, rename_landing_page_atomic).
  const rpc = await supabase.rpc("rename_landing_page_atomic", {
    p_old: oldSlug,
    p_new: newSlug,
  });
  if (!rpc.error) return { ok: true };
  if (rpc.error.code === "23505") {
    return { ok: false, error: `A page called "${newSlug}" already exists.` };
  }
  if (rpc.error.code === "P0002") return noRowsResult(supabase, `Page "${oldSlug}"`);
  if (rpc.error.code === "P0001") return { ok: false, error: validateSlug(newSlug) ?? "Invalid slug." };
  if (rpc.error.code !== "PGRST202") return writeErrorFor(supabase, rpc.error);

  // PGRST202: the function isn't there yet — the old separate requests.
  // The slug lives in three places: the row PK (id), config.slug, and the
  // page_slug column on content rows. Update the PK IN PLACE rather than
  // insert-new-then-delete-old — the latter would momentarily have two rows
  // sharing one iid and trip the `iid UNIQUE` constraint. In-place update also
  // keeps the iid stable so backup history (keyed by page_iid) stays linked.
  const { data: row, error: loadErr } = await supabase
    .from("website_pages")
    .select("config")
    .eq("id", oldSlug)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!row) return { ok: false, error: `Page "${oldSlug}" not found.` };

  const renamed: DrawnPage = { ...migrateLandingPage(row.config), slug: newSlug };

  const { data: renamedRows, error: updErr } = await supabase
    .from("website_pages")
    .update({
      id: newSlug,
      config: renamed,
      schema_version: renamed.schemaVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", oldSlug)
    .select("id");
  if (updErr) return writeErrorFor(supabase, updErr);
  if (!renamedRows?.length) return noRowsResult(supabase, `Page "${oldSlug}"`);

  // Re-key content rows to the new slug (0 rows is fine: a page may have none).
  const { error: moveErr } = await supabase
    .from("website_page_content")
    .update({ page_slug: newSlug })
    .eq("page_slug", oldSlug);
  if (moveErr) console.warn("[renameLandingPage] moving content failed", moveErr.message);

  return { ok: true };
}

export async function deleteLandingPage(
  slug: string
): Promise<WriteResult & { trashId?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Preferred: move the page + its versions, content and history into
  // "Recently deleted" in ONE transaction (migration 20261005000002_trash_and_atomic_ops, trash_landing_page).
  const rpc = await supabase.rpc("trash_landing_page", { p_slug: slug });
  if (!rpc.error) return { ok: true, trashId: rpc.data as string };
  if (rpc.error.code === "P0002") return noRowsResult(supabase, `Page "${slug}"`);
  if (rpc.error.code !== "PGRST202") return writeErrorFor(supabase, rpc.error);

  // PGRST202: no trash functions yet — the old permanent steps.

  const { data: row } = await supabase
    .from("website_pages")
    .select("iid")
    .eq("id", slug)
    .maybeSingle();

  // Cascade-delete this page's content rows first (mirror deleteRoom's posture).
  const { error: contentErr } = await supabase
    .from("website_page_content")
    .delete()
    .eq("page_slug", slug);
  if (contentErr) console.warn("[deleteLandingPage] content cleanup failed", contentErr.message);

  const { data: gone, error } = await supabase
    .from("website_pages")
    .delete()
    .eq("id", slug)
    .select("id");
  if (error) return writeErrorFor(supabase, error);
  if (!gone?.length) return noRowsResult(supabase, `Page "${slug}"`);

  // Then its versions (after the row, which references the live one).
  // Best-effort: an orphaned version is invisible, not harmful.
  if (row?.iid) {
    const { error: verErr } = await supabase
      .from("website_page_versions")
      .delete()
      .eq("page_iid", row.iid);
    if (verErr) console.warn("[deleteLandingPage] version cleanup failed", verErr.message);
  }
  return { ok: true };
}

/**
 * Copy a page under a new slug (fresh iids, saved as a draft). Copies the SAVED
 * row; `unsavedSource` is used only when the page has never been saved — e.g.
 * the static home seed the editor shows before its first Save, which has no
 * row to read (duplicating it used to fail with "Page not found").
 */
export async function duplicateLandingPage(
  slug: string,
  newSlug: string,
  unsavedSource?: DrawnPage
): Promise<WriteResult & { page?: DrawnPage }> {
  const slugErr = validateSlug(newSlug);
  if (slugErr) return { ok: false, error: slugErr };

  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data: row, error: loadErr } = await supabase
    .from("website_pages")
    .select("config")
    .eq("id", slug)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!row && !unsavedSource) {
    return { ok: false, error: `Page "${slug}" not found.` };
  }

  const source = row ? migrateLandingPage(row.config) : unsavedSource!;
  const copy = reIidPage({ ...source, slug: newSlug });

  const res = await saveLandingPage(copy, "draft");
  if (!res.ok) return res;
  return { ok: true, page: copy };
}

// ─── Page content (button-asset rich content) ───────────────

export async function loadAllPageContent(
  pageSlug: string
): Promise<Record<string, ObjectContent>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};

  const { data, error } = await supabase
    .from("website_page_content")
    .select("asset_iid, content")
    .eq("page_slug", pageSlug);

  if (error || !data) return {};

  const out: Record<string, ObjectContent> = {};
  for (const row of data) {
    const migrated = migrateObjectContent(rewriteStorageUrls(row.content as ObjectContent));
    if (migrated) out[row.asset_iid as string] = migrated;
  }
  return out;
}

export async function savePageContent(
  pageSlug: string,
  assetIid: string,
  content: ObjectContent
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { error } = await supabase.from("website_page_content").upsert(
    {
      page_slug: pageSlug,
      asset_iid: assetIid,
      content,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_slug,asset_iid" }
  );

  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

export async function deletePageContent(
  pageSlug: string,
  assetIid: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { error } = await supabase
    .from("website_page_content")
    .delete()
    .eq("page_slug", pageSlug)
    .eq("asset_iid", assetIid);

  // Orphan cleanup: 0 rows is legitimate, a real error is not.
  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

// ─── Section templates ──────────────────────────────────────

export async function listSectionTemplates(): Promise<SectionTemplateRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("website_section_templates")
    .select("id, name, name_ar, tags, section, thumbnail_url, created_at")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    nameAr: (row.name_ar as string | null) ?? undefined,
    tags: (row.tags as string[]) ?? [],
    section: row.section as DrawnSection,
    thumbnailUrl: (row.thumbnail_url as string | null) ?? undefined,
    createdAt: row.created_at as string | undefined,
  }));
}

export async function saveSectionTemplate(
  name: string,
  nameAr: string | undefined,
  tags: string[],
  section: DrawnSection
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  // Strip iids before storing — they're re-minted fresh when the template is
  // dropped onto a page, so a template must not carry a live section's ids.
  const stripped = stripSectionIids(section);

  const { error } = await supabase.from("website_section_templates").insert({
    name,
    name_ar: nameAr ?? null,
    tags,
    section: stripped,
  });

  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

export async function deleteSectionTemplate(id: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data, error } = await supabase
    .from("website_section_templates")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "This template");
  return { ok: true };
}

// ─── Version backups ────────────────────────────────────────

const BACKUPS_KEEP_PER_PAGE = 20;

/** Insert a backup row for a page and prune to the most recent N unpinned. */
export async function recordPageBackup(
  page: DrawnPage,
  versionId?: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  if (!page.iid) return { ok: true }; // No iid yet — first save mints one.

  const row = { page_iid: page.iid, config: page };
  const { error: insertErr } = await supabase
    .from("website_page_backups")
    .insert(versionId ? { ...row, version_id: versionId } : row);
  if (insertErr) return writeErrorFor(supabase, insertErr);

  const { data: all } = await supabase
    .from("website_page_backups")
    .select("id, saved_at, is_pinned")
    .eq("page_iid", page.iid)
    .order("saved_at", { ascending: false });

  if (all && all.length > BACKUPS_KEEP_PER_PAGE) {
    const unpinned = all.filter((r) => !r.is_pinned);
    const toDrop = unpinned
      .slice(BACKUPS_KEEP_PER_PAGE)
      .map((r) => r.id as string);
    if (toDrop.length) {
      const { error: pruneErr } = await supabase
        .from("website_page_backups")
        .delete()
        .in("id", toDrop);
      if (pruneErr) console.warn("[recordPageBackup] prune failed", pruneErr.message);
    }
  }

  return { ok: true };
}

/**
 * List a page's backups, newest first, WITH their configs (migrated to the
 * current shape) so the history UI can preview and diff without a second
 * round-trip per row. Bounded by the prune window (20 auto + pinned), so the
 * payload stays small. Editor-side contract: errors are surfaced, not
 * swallowed, so the history dialog can say why it's empty.
 */
export async function listPageBackups(
  pageIid: string,
  /** Only this version's history (plus backups from before versions existed). */
  versionId?: string
): Promise<{
  rows: PageBackupRow[];
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { rows: [], error: "Supabase not configured — no history available." };
  }

  let query = supabase
    .from("website_page_backups")
    .select("id, page_iid, saved_at, saved_by, label, is_pinned, config")
    .eq("page_iid", pageIid);
  if (versionId) query = query.or(`version_id.eq.${versionId},version_id.is.null`);
  const { data, error } = await query.order("saved_at", { ascending: false });

  if (error) return { rows: [], error: error.message };

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id as string,
      pageIid: row.page_iid as string,
      savedAt: row.saved_at as string,
      savedBy: (row.saved_by as string | null) ?? undefined,
      label: (row.label as string | null) ?? undefined,
      isPinned: Boolean(row.is_pinned),
      config: migrateLandingPage(row.config),
    })),
  };
}

/** Fetch the stored config for a single backup, migrated to current shape. */
export async function restorePageBackup(
  backupId: string
): Promise<DrawnPage | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("website_page_backups")
    .select("config")
    .eq("id", backupId)
    .maybeSingle();

  if (error || !data) return null;
  return migrateLandingPage(data.config);
}

/** Create a pinned (named) version — exempt from the auto-prune window. */
export async function createNamedVersion(
  page: DrawnPage,
  label: string,
  versionId?: string
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  if (!page.iid) {
    return { ok: false, error: "Page has no iid yet — save once first." };
  }

  const row = { page_iid: page.iid, config: page, label, is_pinned: true };
  const { error } = await supabase
    .from("website_page_backups")
    .insert(versionId ? { ...row, version_id: versionId } : row);

  if (error) return writeErrorFor(supabase, error);
  return { ok: true };
}

/** Rename a backup or change its pinned status. Pass label=null to clear. */
export async function updateBackupLabel(
  backupId: string,
  label: string | null,
  isPinned: boolean
): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data, error } = await supabase
    .from("website_page_backups")
    .update({ label, is_pinned: isPinned })
    .eq("id", backupId)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "This version");
  return { ok: true };
}

export async function deleteBackup(backupId: string): Promise<WriteResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const { data, error } = await supabase
    .from("website_page_backups")
    .delete()
    .eq("id", backupId)
    .select("id");

  if (error) return writeErrorFor(supabase, error);
  if (!data?.length) return noRowsResult(supabase, "This version");
  return { ok: true };
}

// ─── Site config (announcement bar / header / footer) ────────
//
// One singleton row (id = 'default'), not per-page — see landingTypes.ts's
// SiteConfig header comment. Same source-tagged-loader / WriteResult shape as
// the page CRUD above.

export async function loadSiteConfigForEditor(): Promise<{
  config: SiteConfig;
  /** website_site_config.updated_at (the saveSiteConfig token); null = no row yet. */
  updatedAt: string | null;
  source: EditorLoadSource;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      config: defaultSiteConfig,
      updatedAt: null,
      source: "static",
      error: "Supabase not configured — edits will not persist.",
    };
  }

  const { data, error } = await supabase
    .from("website_site_config")
    .select("config, updated_at")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    return { config: defaultSiteConfig, updatedAt: null, source: "static", error: error.message };
  }
  if (!data?.config) {
    // No row yet — seed the editor with the static default so the user has
    // something to publish. Marked "missing" so the UI can note it's unsaved.
    return { config: defaultSiteConfig, updatedAt: null, source: "missing" };
  }

  return {
    config: migrateSiteConfig(data.config),
    updatedAt: (data.updated_at as string | null) ?? null,
    source: "supabase",
  };
}

/**
 * Save the singleton site config. `expected` is the row's updated_at as this
 * tab last saw it (null = no row yet, so insert). Without `force` the write
 * only lands if the row is unchanged since; else `code: "conflict"`.
 */
export async function saveSiteConfig(
  config: SiteConfig,
  expected: string | null,
  force = false
): Promise<WriteResult & { updatedAt?: string; theirsUpdatedAt?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };

  const now = new Date().toISOString();
  const body = { config, schema_version: config.schemaVersion, updated_at: now };
  const insertRow = () =>
    supabase
      .from("website_site_config")
      .insert({ id: "default", ...body })
      .select("updated_at");

  if (expected === null && !force) {
    const { data, error } = await insertRow();
    if (error) {
      if (error.code === "23505") {
        return { ok: false, code: "conflict", error: "Site settings were created somewhere else." };
      }
      return writeErrorFor(supabase, error);
    }
    return { ok: true, updatedAt: data?.[0]?.updated_at as string | undefined };
  }

  let q = supabase.from("website_site_config").update(body).eq("id", "default");
  if (!force && expected) q = q.eq("updated_at", expected);
  const { data, error } = await q.select("updated_at");
  if (error) return writeErrorFor(supabase, error);
  if (data?.length) return { ok: true, updatedAt: data[0].updated_at as string };

  if (force) {
    // Overwrite with no row to overwrite: create it.
    const ins = await insertRow();
    if (ins.error) return writeErrorFor(supabase, ins.error);
    return { ok: true, updatedAt: ins.data?.[0]?.updated_at as string | undefined };
  }

  const denial = await denialFor(supabase);
  if (denial) return denial;
  const { data: cur, error: curErr } = await supabase
    .from("website_site_config")
    .select("updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (curErr) return writeErrorFor(supabase, curErr);
  if (!cur) {
    return { ok: false, code: "not_found", error: "Site settings were deleted somewhere else. Reload and try again." };
  }
  return {
    ok: false,
    code: "conflict",
    theirsUpdatedAt: cur.updated_at as string,
    error: "Site settings were changed somewhere else.",
  };
}

// ─── iid helpers ────────────────────────────────────────────

/** Deep-clone a page with fresh iids for the page, its sections, and assets. */
export function reIidPage(page: DrawnPage): DrawnPage {
  return {
    ...page,
    iid: newIid(),
    sections: page.sections.map(reIidSection),
  };
}

/** Deep-clone a section with a fresh iid for it and every asset it contains. */
export function reIidSection(section: DrawnSection): DrawnSection {
  return {
    ...section,
    iid: newIid(),
    assets: section.assets.map((a) => ({ ...a, iid: newIid() })),
  };
}

/** Blank out iids so a stored template never carries a live section's ids. */
function stripSectionIids(section: DrawnSection): DrawnSection {
  return {
    ...section,
    iid: "",
    assets: section.assets.map((a) => ({ ...a, iid: "" })),
  };
}

// ─── Site fonts ──────────────────────────────────────────────

const FONT_TYPES: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/**
 * Upload a font file (.woff2 / .woff / .ttf / .otf) to the public
 * `site-fonts` bucket (owner-only writes — see the site_fonts_bucket
 * migration). Returns its public URL.
 */
export async function uploadSiteFont(file: File): Promise<{ url?: string; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: "Supabase is not configured" };
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = FONT_TYPES[ext];
  if (!contentType) return { error: "Use a .woff2, .woff, .ttf or .otf file" };
  if (file.size > 8 * 1024 * 1024) return { error: "Font files must be under 8 MB" };
  const path = `fonts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from("site-fonts").upload(path, file, { contentType, upsert: false });
  if (error) return { error: (await writeErrorFor(supabase, error)).error };
  const {
    data: { publicUrl },
  } = supabase.storage.from("site-fonts").getPublicUrl(path);
  return { url: rewriteStorageUrls(publicUrl) };
}
