import { create } from "zustand";
import { temporal } from "zundo";
import { newIid } from "@/lib/iid";
import { CURRENT_LANDING_SCHEMA_VERSION } from "@/data/landingTypes";
import type {
  DrawnPage,
  DrawnSection,
  DrawnAsset,
  DrawnAssetRole,
  DrawnTextStyle,
} from "@/data/landingTypes";
import type { ObjectContent } from "@/data/contentTypes";
import {
  ARCADE_MACHINE_IID,
  resolveArcade,
  type ArcadeCamera,
  type StoredArcadeConfig,
} from "@/data/arcadeConfig";
import { findFreeSpot } from "@/lib/landingPlacement";
import { makeComponentAsset } from "@/components/landing/blocks/registry";
import { revalidatePublicPaths, landingPublicPaths } from "@/lib/revalidateSite";
import {
  loadAllLandingPagesForEditor,
  loadAllPageContent,
  saveLandingPage,
  savePageContent,
  renameLandingPage,
  deleteLandingPage,
  duplicateLandingPage,
  setPageStatus,
  withSeedHome,
  reIidSection,
  reIidPage,
  saveLandingVersion,
  duplicateLandingVersion,
  loadLandingVersion,
  renameLandingVersion,
  deleteLandingVersion,
  publishLandingVersion,
  rememberVersion,
  type LandingPageRecord,
  type PageStatus,
  type PageVersionMeta,
} from "@/lib/landingEditorData";
import { clearLandingDraft } from "@/lib/draftStore";
import { isAssetLocked, isMachineLocked } from "@/lib/layerLock";
import { landingDraftKey } from "@/lib/useLandingDraftAutosave";

// ─── Result shapes (mirror editorStore) ─────────────────────

export interface LandingSaveResult {
  ok: boolean;
  pageError?: string;
  contentErrors: string[];
  /** The open version was changed somewhere else since this tab loaded it.
   *  Nothing was written. */
  conflict?: { theirsUpdatedAt?: string };
}

export interface LandingHydrationResult {
  source: "supabase" | "static" | "missing";
  error?: string;
}

// ─── State + actions ────────────────────────────────────────

export interface LandingEditorState {
  allPages: Record<string, LandingPageRecord>; // keyed by slug
  currentPageSlug: string | null;

  /** Each page's versions (keyed by slug), most recently edited first. */
  versions: Record<string, PageVersionMeta[]>;
  /** False until the versions migration is applied: Save then writes the
   *  page row directly (the old save-is-publish behaviour). */
  versioning: boolean;
  /** False until the versions.content migration is applied: button pop-up
   *  content (contentMap) is then shared by every version of a page and Save
   *  writes it straight to website_page_content. */
  versionContent: boolean;
  /** Pages whose shared content rows were pulled (only used while
   *  `versionContent` is false; with it, content arrives with each version). */
  contentLoadedSlugs: string[];

  selectedSectionIid: string | null;
  selectedAssetIid: string | null;

  contentMap: Record<string, ObjectContent>; // key `${pageSlug}:${assetIid}`
  editingContentAssetIid: string | null;

  previewLanguage: "en" | "ar";
  /** Which device layout the editor is editing/previewing. */
  deviceMode: "desktop" | "mobile";

  isDirty: boolean;
  isHydrated: boolean;

  // Panel toggles
  showPagesPanel: boolean;
  showLibrary: boolean;

  // Arcade Studio (transient UI — never saved, never in undo history)
  /** What canvas handles the arcade shows: elements + machine, the machine's
   *  screen rect, or a device camera frame. */
  arcadeTool: "select" | "screen" | "frame";
  /** Which camera the frame tool edits: the rest framing or a keyframe. */
  arcadeCameraTarget: { kind: "rest" } | { kind: "keyframe"; index: number };
  /** Live camera preview on the editor canvas (scrub / click-in preview);
   *  null = show the whole world. */
  arcadePreview: ArcadeCamera | null;
  /** Editor: zoom the canvas out to show everything beyond the drawing area
   *  (a big backdrop's edges, far-zoom frames). Still editable. */
  arcadeOverview: boolean;
}

export interface LandingEditorActions {
  // Page management
  setCurrentPage: (slug: string) => void;
  createPage: (slug: string) => Promise<{ ok: boolean; error?: string }>;
  renamePage: (oldSlug: string, newSlug: string) => Promise<{ ok: boolean; error?: string }>;
  /** `trashId`: the page moved to Recently deleted (pass it to restoreDeletedItem for Undo). */
  deletePage: (slug: string) => Promise<{ ok: boolean; error?: string; trashId?: string }>;
  duplicatePage: (slug: string, newSlug: string) => Promise<{ ok: boolean; error?: string }>;
  setStatus: (slug: string, status: PageStatus) => Promise<{ ok: boolean; error?: string }>;

  // Versions (current page). Switching discards unsaved edits — the UI asks
  // first. Publish publishes the SAVED version.
  switchVersion: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
  /** New draft copied from a saved version; opens it. */
  duplicateVersion: (versionId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  /** Move the editor's current (unsaved) edits into a new draft and open it;
   *  the version they came from keeps its saved state. */
  saveAsNewVersion: (name: string) => Promise<{ ok: boolean; error?: string }>;
  renameVersion: (versionId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  deleteVersion: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
  publishVersion: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
  updatePageMeta: (meta: DrawnPage["meta"]) => void;

  // Selection
  selectSection: (iid: string | null) => void;
  selectAsset: (iid: string | null) => void;

  // Section operations
  addSection: (section?: DrawnSection) => void;
  removeSection: (iid: string) => void;
  duplicateSection: (iid: string) => void;
  reorderSections: (orderedIids: string[]) => void;
  updateSectionMeta: (iid: string, partial: Partial<DrawnSection>) => void;
  /** Edit a section's stored arcade config (one undo step). */
  updateArcade: (
    sectionIid: string,
    fn: (stored: StoredArcadeConfig) => StoredArcadeConfig
  ) => void;
  /** Move an arcade layer (an element or the machine — ARCADE_MACHINE_IID)
   *  one step in the arcade's shared stack. */
  moveArcadeLayer: (sectionIid: string, id: string, dir: "up" | "down") => void;
  setArcadeTool: (tool: LandingEditorState["arcadeTool"]) => void;
  setArcadeCameraTarget: (t: LandingEditorState["arcadeCameraTarget"]) => void;
  setArcadePreview: (cam: ArcadeCamera | null) => void;
  setArcadeOverview: (on: boolean) => void;
  /** Give every torn paper section on the page a new tear (one undo step). */
  rerollAllTears: () => void;

  // Asset operations
  addAsset: (sectionIid: string, asset: DrawnAsset) => void;
  /** Add several assets as ONE undo step (e.g. the 3×2 grid). */
  addAssets: (sectionIid: string, assets: DrawnAsset[]) => void;
  /**
   * Set a section canvas's design height (px at its design width). Every
   * element's y/h (desktop and mobile) is rescaled so it keeps its on-screen
   * position and size — the canvas grows/shrinks below them, like dragging a
   * builder section's bottom edge.
   */
  resizeSectionCanvas: (sectionIid: string, newH: number) => void;
  /** Shift a set of assets by (dx, dy) section-% in the desktop layout. */
  moveAssets: (assetIids: string[], dx: number, dy: number) => void;
  /** Layer lock (stored `locked`; absent = backdrop locked, else free). One
   *  undo step, marks the page dirty. Returns the new state (null = not found). */
  toggleAssetLock: (assetIid: string) => boolean | null;
  /** The Arcade machine's own lock (stored `arcade.machine.locked`). */
  toggleMachineLock: (sectionIid: string) => boolean | null;
  removeAsset: (assetIid: string) => void;
  duplicateAsset: (assetIid: string) => void;
  updateAssetTransform: (
    assetIid: string,
    t: { x?: number; y?: number; w?: number; h?: number; rotation?: number }
  ) => void;
  updateAssetRole: (assetIid: string, role: DrawnAssetRole) => void;
  updateAssetMeta: (assetIid: string, partial: Partial<DrawnAsset>) => void;
  /** Text-asset editing (no-op if the asset isn't a text asset). */
  updateTextContent: (assetIid: string, lang: "en" | "ar", value: string) => void;
  updateTextStyle: (assetIid: string, partial: Partial<DrawnTextStyle>) => void;
  /**
   * Drop a registry component into a section as a normal positioned asset, so
   * it mixes with drawings/text/boxes. Returns the new asset's iid.
   */
  addComponentAsset: (
    sectionIid: string,
    blockType: string,
    /** Measured footprints of what's already there (editor DOM); defaults
     *  to the stored geometry. */
    occupied?: { x: number; y: number; w: number; h: number }[]
  ) => string | null;
  /** Component-asset editing (no-op if the asset isn't a component asset). */
  updateComponentProps: (
    assetIid: string,
    partial: Record<string, unknown>
  ) => void;
  updateComponentAutoHeight: (assetIid: string, autoHeight: boolean) => void;
  /** Mobile layout override for an asset (position/size/hidden). */
  updateAssetMobile: (
    assetIid: string,
    partial: Partial<NonNullable<DrawnAsset["mobile"]>>
  ) => void;
  bringAssetForward: (assetIid: string) => void;
  sendAssetBackward: (assetIid: string) => void;
  /** Swap an asset's z-index with its neighbour in z-order (layers list). */
  moveAssetLayer: (assetIid: string, dir: "up" | "down") => void;

  // Content
  updateContent: (assetIid: string, content: ObjectContent) => void;
  /** Put a button's pop-up back as it was when the composer opened (null = none)
   *  AND the page's unsaved-changes flag as it was then (the composer is modal,
   *  so nothing else on the page changed meanwhile). */
  restoreContent: (assetIid: string, content: ObjectContent | null, wasDirty: boolean) => void;
  openContentEditor: (assetIid: string) => void;
  closeContentEditor: () => void;

  // Misc UI
  setPreviewLanguage: (lang: "en" | "ar") => void;
  setDeviceMode: (m: "desktop" | "mobile") => void;
  togglePagesPanel: () => void;
  toggleLibrary: () => void;

  // Persistence
  markClean: () => void;
  /** `force`: write over a change made somewhere else (conflict "Overwrite"). */
  saveToSupabase: (opts?: { force?: boolean }) => Promise<LandingSaveResult>;
  /** Replace the open version with the DB copy (conflict "Load theirs"):
   *  unlike switchVersion this works for the same id. */
  reloadVersion: () => Promise<{ ok: boolean; error?: string }>;
  hydrateFromSupabase: () => Promise<LandingHydrationResult>;

  // Restore (from version history / draft) — replaces the current page and
  // marks dirty; the user still Saves to persist.
  restorePage: (page: DrawnPage) => void;
}

// ─── Helpers ────────────────────────────────────────────────

/** contentMap with one page's entries replaced ({ assetIid: content } in, "slug:iid" keys out). */
function withPageContent(
  map: Record<string, ObjectContent>,
  slug: string,
  content: Record<string, ObjectContent>
): Record<string, ObjectContent> {
  const next: Record<string, ObjectContent> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!key.startsWith(`${slug}:`)) next[key] = value;
  }
  for (const [assetIid, value] of Object.entries(content)) next[`${slug}:${assetIid}`] = value;
  return next;
}

/** One page's entries out of contentMap, keyed by asset iid (a version's content map). */
function pageContentOf(
  map: Record<string, ObjectContent>,
  slug: string
): Record<string, ObjectContent> {
  const out: Record<string, ObjectContent> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(`${slug}:`)) out[key.slice(slug.length + 1)] = value;
  }
  return out;
}

export function blankSection(): DrawnSection {
  return {
    iid: newIid(),
    id: `section-${Date.now().toString(36)}`,
    blockType: "stack",
    aspectRatio: { w: 1520, h: 960 },
    surface: { kind: "paper", grain: true },
    heading: { en: "New section", ar: "" },
    assets: [],
    revealStyle: "fade-up",
    // Reflow into a readable column on phones by default (as the section
    // templates do); turn off to hand-place the mobile layout.
    autoStackMobile: true,
  };
}

export function blankPage(slug: string): DrawnPage {
  return {
    schemaVersion: CURRENT_LANDING_SCHEMA_VERSION,
    iid: newIid(),
    slug,
    sections: [blankSection()],
  };
}

/** Strip the arcade flag + scene config (copies and templates). */
function mutateArcadeFlags(s: DrawnSection): DrawnSection {
  if (!s.containsGame && !s.arcade) return s;
  const copy = { ...s, containsGame: false };
  delete copy.arcade;
  return copy;
}

/**
 * One step of the arcade's shared layer stack: elements AND the machine,
 * bottom → top (at equal z the machine paints first — it's the first child of
 * the world — so it sorts below). Swaps `id` with its neighbour and renumbers
 * the whole stack 0…n so every step is visible and z stays integral.
 */
export function arcadeRestack(
  s: DrawnSection,
  id: string,
  dir: "up" | "down"
): DrawnSection {
  const machineZ = resolveArcade(s.arcade).machine.zIndex;
  const stack = [
    { id: ARCADE_MACHINE_IID, z: machineZ, m: 0 },
    ...s.assets.map((a) => ({ id: a.iid, z: a.zIndex, m: 1 })),
  ].sort((a, b) => a.z - b.z || a.m - b.m);
  const i = stack.findIndex((e) => e.id === id);
  const j = dir === "up" ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= stack.length) return s;
  [stack[i], stack[j]] = [stack[j], stack[i]];
  const z = new Map(stack.map((e, k) => [e.id, k]));
  return {
    ...s,
    assets: s.assets.map((a) => ({ ...a, zIndex: z.get(a.iid) ?? a.zIndex })),
    arcade: {
      ...s.arcade,
      machine: { ...s.arcade?.machine, zIndex: z.get(ARCADE_MACHINE_IID) ?? machineZ },
    },
  };
}

// ─── Store ──────────────────────────────────────────────────

export const useLandingEditorStore = create<
  LandingEditorState & LandingEditorActions
>()(
  temporal(
    (set, get) => {
      // Clone the current page, run `fn` to mutate it, write it back into
      // allPages, and flag dirty. No-op when no page is loaded.
      const mutateCurrentPage = (fn: (page: DrawnPage) => DrawnPage) => {
        const { currentPageSlug, allPages } = get();
        if (!currentPageSlug) return;
        const record = allPages[currentPageSlug];
        if (!record) return;
        const nextPage = fn(structuredClone(record.page));
        set({
          allPages: {
            ...allPages,
            [currentPageSlug]: { ...record, page: nextPage },
          },
          isDirty: true,
        });
      };

      const mutateSection = (
        sectionIid: string,
        fn: (section: DrawnSection) => DrawnSection
      ) => {
        mutateCurrentPage((page) => ({
          ...page,
          sections: page.sections.map((s) =>
            s.iid === sectionIid ? fn(s) : s
          ),
        }));
      };

      // Find which section holds an asset, then mutate that asset.
      const mutateAsset = (
        assetIid: string,
        fn: (asset: DrawnAsset) => DrawnAsset
      ) => {
        mutateCurrentPage((page) => ({
          ...page,
          sections: page.sections.map((s) =>
            s.assets.some((a) => a.iid === assetIid)
              ? { ...s, assets: s.assets.map((a) => (a.iid === assetIid ? fn(a) : a)) }
              : s
          ),
        }));
      };

      return {
        // ─── State ───
        allPages: {},
        currentPageSlug: null,
        versions: {},
        versioning: false,
        versionContent: false,
        contentLoadedSlugs: [],
        selectedSectionIid: null,
        selectedAssetIid: null,
        contentMap: {},
        editingContentAssetIid: null,
        previewLanguage: "en",
        deviceMode: "desktop",
        isDirty: false,
        isHydrated: false,
        showPagesPanel: true,
        showLibrary: true,
        arcadeTool: "select",
        arcadeCameraTarget: { kind: "rest" },
        arcadePreview: null,
        arcadeOverview: false,

        // ─── Page management ───
        setCurrentPage: (slug) => {
          set({
            currentPageSlug: slug,
            selectedSectionIid: null,
            selectedAssetIid: null,
          });
          // Shared-content mode: a page's content rows were only ever pulled
          // for the page open at load, so editing another page's buttons
          // started from an empty form. Pull them when the page opens.
          const { versionContent, contentLoadedSlugs } = get();
          if (!versionContent && !contentLoadedSlugs.includes(slug)) {
            set({ contentLoadedSlugs: [...contentLoadedSlugs, slug] });
            void loadAllPageContent(slug).then((content) => {
              if (Object.keys(content).length === 0) return;
              const prefixed: Record<string, ObjectContent> = {};
              for (const [assetIid, c] of Object.entries(content)) prefixed[`${slug}:${assetIid}`] = c;
              // Edits already made in this session win over the DB copy.
              set({ contentMap: { ...prefixed, ...get().contentMap } });
            });
          }
        },

        createPage: async (slug) => {
          const page = blankPage(slug);
          let versionId: string | undefined;
          if (get().versioning) {
            const res = await saveLandingVersion(page, undefined, "Draft", {
              content: get().versionContent ? {} : undefined,
            });
            if (!res.ok || !res.version) return { ok: false, error: res.error };
            const v = res.version;
            versionId = v.id;
            set((s) => ({ versions: { ...s.versions, [slug]: [v] } }));
          } else {
            const res = await saveLandingPage(page, "draft");
            if (!res.ok) return res;
          }
          set((s) => ({
            allPages: {
              ...s.allPages,
              [slug]: { page, status: "draft", versionId },
            },
            currentPageSlug: slug,
            selectedSectionIid: null,
            selectedAssetIid: null,
            isDirty: false,
          }));
          return { ok: true };
        },

        renamePage: async (oldSlug, newSlug) => {
          const res = await renameLandingPage(oldSlug, newSlug);
          if (!res.ok) return res;
          set((s) => {
            const record = s.allPages[oldSlug];
            const nextPages = { ...s.allPages };
            delete nextPages[oldSlug];
            if (record) {
              nextPages[newSlug] = {
                ...record,
                page: { ...record.page, slug: newSlug },
              };
            }
            const nextVersions = { ...s.versions };
            if (nextVersions[oldSlug]) {
              nextVersions[newSlug] = nextVersions[oldSlug];
              delete nextVersions[oldSlug];
            }
            return {
              allPages: nextPages,
              versions: nextVersions,
              currentPageSlug:
                s.currentPageSlug === oldSlug ? newSlug : s.currentPageSlug,
            };
          });
          return { ok: true };
        },

        deletePage: async (slug) => {
          const res = await deleteLandingPage(slug);
          if (!res.ok) return res;
          set((s) => {
            const rest = { ...s.allPages };
            delete rest[slug];
            // Same rule as hydration: with no saved home row the public "/"
            // shows the static seed, so the editor keeps offering it (this
            // also fixes "No page loaded" after deleting the last page).
            const nextPages: Record<string, LandingPageRecord> = {};
            for (const rec of withSeedHome(Object.values(rest))) {
              nextPages[rec.page.slug] = rec;
            }
            const remaining = Object.keys(nextPages);
            const nextVersions = { ...s.versions };
            delete nextVersions[slug];
            return {
              allPages: nextPages,
              versions: nextVersions,
              currentPageSlug:
                s.currentPageSlug === slug
                  ? remaining[0] ?? null
                  : s.currentPageSlug,
              selectedSectionIid: null,
              selectedAssetIid: null,
            };
          });
          return { ok: true, trashId: res.trashId };
        },

        duplicatePage: async (slug, newSlug) => {
          if (get().versioning) {
            // Copy the version open for that page (what you see) as the new
            // page's first draft.
            const source = get().allPages[slug]?.page;
            if (!source) return { ok: false, error: `Page "${slug}" not found.` };
            const page = reIidPage({ ...structuredClone(source), slug: newSlug });
            const res = await saveLandingVersion(page, undefined);
            if (!res.ok || !res.version) return { ok: false, error: res.error };
            const v = res.version;
            set((s) => ({
              allPages: { ...s.allPages, [newSlug]: { page, status: "draft", versionId: v.id } },
              versions: { ...s.versions, [newSlug]: [v] },
              currentPageSlug: newSlug,
            }));
            return { ok: true };
          }
          const res = await duplicateLandingPage(
            slug,
            newSlug,
            get().allPages[slug]?.page
          );
          if (!res.ok || !res.page) return { ok: res.ok, error: res.error };
          const page = res.page;
          set((s) => ({
            allPages: {
              ...s.allPages,
              [newSlug]: { page, status: "draft" },
            },
            currentPageSlug: newSlug,
          }));
          return { ok: true };
        },

        setStatus: async (slug, status) => {
          const res = await setPageStatus(slug, status);
          if (!res.ok) return res;
          void revalidatePublicPaths(landingPublicPaths(slug));
          set((s) => {
            const record = s.allPages[slug];
            if (!record) return {};
            return {
              allPages: { ...s.allPages, [slug]: { ...record, status } },
            };
          });
          return { ok: true };
        },

        switchVersion: async (versionId) => {
          const { currentPageSlug: slug, allPages } = get();
          const record = slug ? allPages[slug] : null;
          if (!slug || !record) return { ok: false, error: "No page loaded." };
          if (record.versionId === versionId) return { ok: true };
          const res = await loadLandingVersion(versionId, slug);
          if (!res.page) return { ok: false, error: res.error };
          const page = res.page;
          rememberVersion(page.iid, versionId);
          // Each version carries its own button content; one saved before the
          // column existed (null) shows what's live.
          const content = get().versionContent
            ? (res.content ?? (await loadAllPageContent(slug)))
            : null;
          set((s) => ({
            allPages: { ...s.allPages, [slug]: { ...s.allPages[slug], page, versionId } },
            ...(content ? { contentMap: withPageContent(s.contentMap, slug, content) } : {}),
            isDirty: false,
            selectedSectionIid: null,
            selectedAssetIid: null,
          }));
          // Undo must not step back into the other version's edits.
          useLandingEditorStore.temporal.getState().clear();
          return { ok: true };
        },

        duplicateVersion: async (versionId, name) => {
          const slug = get().currentPageSlug;
          const record = slug ? get().allPages[slug] : null;
          if (!slug || !record) return { ok: false, error: "No page loaded." };
          const res = await duplicateLandingVersion(record.page.iid, name, { versionId });
          if (!res.ok || !res.version) return { ok: false, error: res.error };
          const v = res.version;
          set((s) => ({ versions: { ...s.versions, [slug]: [v, ...(s.versions[slug] ?? [])] } }));
          return get().switchVersion(v.id);
        },

        saveAsNewVersion: async (name) => {
          const { currentPageSlug: slug, allPages } = get();
          const record = slug ? allPages[slug] : null;
          if (!slug || !record) return { ok: false, error: "No page loaded." };
          // The copy carries this page's button content with it.
          const res = await saveLandingVersion(record.page, undefined, name, {
            content: get().versionContent ? pageContentOf(get().contentMap, slug) : undefined,
          });
          if (!res.ok || !res.version) return { ok: false, error: res.error };
          const v = res.version;
          rememberVersion(record.page.iid, v.id);
          set((s) => ({
            allPages: { ...s.allPages, [slug]: { ...s.allPages[slug], versionId: v.id } },
            versions: { ...s.versions, [slug]: [v, ...(s.versions[slug] ?? [])] },
            isDirty: false,
          }));
          useLandingEditorStore.temporal.getState().clear();
          return { ok: true };
        },

        renameVersion: async (versionId, name) => {
          const slug = get().currentPageSlug;
          if (!slug) return { ok: false, error: "No page loaded." };
          const res = await renameLandingVersion(versionId, name);
          if (!res.ok) return res;
          set((s) => ({
            versions: {
              ...s.versions,
              [slug]: (s.versions[slug] ?? []).map((v) => (v.id === versionId ? { ...v, name } : v)),
            },
          }));
          return { ok: true };
        },

        deleteVersion: async (versionId) => {
          const slug = get().currentPageSlug;
          const record = slug ? get().allPages[slug] : null;
          if (!slug || !record) return { ok: false, error: "No page loaded." };
          const list = get().versions[slug] ?? [];
          if (versionId === record.liveVersionId && record.status === "published") {
            return { ok: false, error: "That's the live version. Publish another one first." };
          }
          if (list.length <= 1) return { ok: false, error: "A page needs at least one version." };
          // Deleting the open version: open the live one (or the newest
          // other) first, so the editor never points at a deleted row.
          if (versionId === record.versionId) {
            const next =
              list.find((v) => v.id === record.liveVersionId && v.id !== versionId) ??
              list.find((v) => v.id !== versionId)!;
            const sw = await get().switchVersion(next.id);
            if (!sw.ok) return sw;
          }
          const res = await deleteLandingVersion(versionId);
          if (!res.ok) return res;
          set((s) => ({
            versions: { ...s.versions, [slug]: (s.versions[slug] ?? []).filter((v) => v.id !== versionId) },
          }));
          return { ok: true };
        },

        publishVersion: async (versionId) => {
          const slug = get().currentPageSlug;
          if (!slug) return { ok: false, error: "No page loaded." };
          const res = await publishLandingVersion(slug, versionId);
          if (!res.ok) return res;
          // Best-effort: show it on the public site now, not in ≤60 s.
          void revalidatePublicPaths(landingPublicPaths(slug));
          const at = res.publishedAt;
          set((s) => ({
            allPages: {
              ...s.allPages,
              [slug]: { ...s.allPages[slug], status: "published", liveVersionId: versionId, publishedAt: at },
            },
            versions: {
              ...s.versions,
              [slug]: (s.versions[slug] ?? []).map((v) => (v.id === versionId ? { ...v, publishedAt: at } : v)),
            },
          }));
          return { ok: true };
        },

        updatePageMeta: (meta) =>
          mutateCurrentPage((page) => ({ ...page, meta })),

        // ─── Selection ───
        selectSection: (iid) =>
          set({ selectedSectionIid: iid, selectedAssetIid: null }),
        selectAsset: (iid) => set({ selectedAssetIid: iid }),

        // ─── Sections ───
        addSection: (section) => {
          const raw = section ?? blankSection();
          // Never a second arcade: a section added from a template saved off
          // the arcade comes in as a plain section (one game per page).
          const s = mutateArcadeFlags(raw);
          mutateCurrentPage((page) => ({
            ...page,
            sections: [...page.sections, s],
          }));
          set({ selectedSectionIid: s.iid, selectedAssetIid: null });
        },

        removeSection: (iid) => {
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.filter((s) => s.iid !== iid),
          }));
          set((st) => ({
            selectedSectionIid:
              st.selectedSectionIid === iid ? null : st.selectedSectionIid,
          }));
        },

        duplicateSection: (iid) => {
          mutateCurrentPage((page) => {
            const idx = page.sections.findIndex((s) => s.iid === iid);
            if (idx === -1) return page;
            // Strip the game flag on a copy — only one arcade section per page.
            const copy = mutateArcadeFlags(reIidSection(page.sections[idx]));
            const sections = [...page.sections];
            sections.splice(idx + 1, 0, copy);
            return { ...page, sections };
          });
        },

        reorderSections: (orderedIids) => {
          mutateCurrentPage((page) => {
            const byIid = new Map(page.sections.map((s) => [s.iid, s]));
            const sections = orderedIids
              .map((id) => byIid.get(id))
              .filter((s): s is DrawnSection => Boolean(s));
            // Keep any sections not in the ordered list (safety) at the end.
            for (const s of page.sections) {
              if (!orderedIids.includes(s.iid)) sections.push(s);
            }
            return { ...page, sections };
          });
        },

        updateSectionMeta: (iid, partial) =>
          mutateSection(iid, (s) => ({ ...s, ...partial })),

        updateArcade: (sectionIid, fn) =>
          mutateSection(sectionIid, (s) =>
            s.containsGame ? { ...s, arcade: fn(structuredClone(s.arcade ?? {})) } : s
          ),

        moveArcadeLayer: (sectionIid, id, dir) =>
          mutateSection(sectionIid, (s) => arcadeRestack(s, id, dir)),

        setArcadeTool: (tool) => set({ arcadeTool: tool }),
        setArcadeCameraTarget: (t) => set({ arcadeCameraTarget: t }),
        setArcadePreview: (cam) => set({ arcadePreview: cam }),
        setArcadeOverview: (on) => set({ arcadeOverview: on }),

        rerollAllTears: () =>
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((sec) =>
              sec.surface?.kind === "paper" && sec.surface.tornEdge
                ? {
                    ...sec,
                    surface: {
                      ...sec.surface,
                      tornEdge: { ...sec.surface.tornEdge, seed: newIid().slice(0, 8) },
                    },
                  }
                : sec
            ),
          })),

        // ─── Assets ───
        addAssets: (sectionIid, assets) => {
          if (!assets.length) return;
          mutateSection(sectionIid, (s) => ({ ...s, assets: [...s.assets, ...assets] }));
          set({ selectedSectionIid: sectionIid, selectedAssetIid: assets[assets.length - 1].iid });
        },

        resizeSectionCanvas: (sectionIid, newH) =>
          mutateSection(sectionIid, (s) => {
            const H = s.aspectRatio.h;
            const h2 = Math.round(Math.min(Math.max(newH, 240), 12000));
            if (h2 === H) return s;
            const k = H / h2;
            const r2 = (n: number) => Math.round(n * 100) / 100;
            return {
              ...s,
              aspectRatio: { w: s.aspectRatio.w, h: h2 },
              assets: s.assets.map((a) => ({
                ...a,
                y: r2(a.y * k),
                h: r2(a.h * k),
                mobile: a.mobile
                  ? {
                      ...a.mobile,
                      y: a.mobile.y !== undefined ? r2(a.mobile.y * k) : undefined,
                      h: a.mobile.h !== undefined ? r2(a.mobile.h * k) : undefined,
                    }
                  : undefined,
              })),
            };
          }),

        // A locked element never moves (a nudge, an auto-placement).
        moveAssets: (assetIids, dx, dy) => {
          const ids = new Set(assetIids);
          const r2 = (n: number) => Math.round(n * 100) / 100;
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) =>
              s.assets.some((a) => ids.has(a.iid))
                ? {
                    ...s,
                    assets: s.assets.map((a) =>
                      ids.has(a.iid) && !isAssetLocked(a, s)
                        ? { ...a, x: r2(a.x + dx), y: r2(a.y + dy) }
                        : a
                    ),
                  }
                : s
            ),
          }));
        },

        toggleAssetLock: (assetIid) => {
          let now: boolean | null = null;
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) =>
              s.assets.some((a) => a.iid === assetIid)
                ? {
                    ...s,
                    assets: s.assets.map((a) => {
                      if (a.iid !== assetIid) return a;
                      now = !isAssetLocked(a, s);
                      return { ...a, locked: now };
                    }),
                  }
                : s
            ),
          }));
          return now;
        },

        toggleMachineLock: (sectionIid) => {
          let now: boolean | null = null;
          mutateSection(sectionIid, (s) => {
            if (!s.containsGame) return s;
            now = !isMachineLocked(s.arcade);
            return {
              ...s,
              arcade: { ...s.arcade, machine: { ...s.arcade?.machine, locked: now } },
            };
          });
          return now;
        },

        addAsset: (sectionIid, asset) => {
          mutateSection(sectionIid, (s) => ({
            ...s,
            assets: [...s.assets, asset],
          }));
          set({ selectedSectionIid: sectionIid, selectedAssetIid: asset.iid });
        },

        removeAsset: (assetIid) => {
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) => ({
              ...s,
              assets: s.assets.filter((a) => a.iid !== assetIid),
            })),
          }));
          set((st) => ({
            selectedAssetIid:
              st.selectedAssetIid === assetIid ? null : st.selectedAssetIid,
          }));
        },

        duplicateAsset: (assetIid) => {
          let newIidVal: string | null = null;
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) => {
              const idx = s.assets.findIndex((a) => a.iid === assetIid);
              if (idx === -1) return s;
              const src = s.assets[idx];
              // Deep copy (nested source/mobile objects must not be shared),
              // stepped down-right but kept on the canvas, in both layouts.
              const clone = structuredClone(src);
              const step = (v: number, size: number) =>
                Math.round(Math.min(v + 3, Math.max(0, 100 - size)) * 100) / 100;
              const copy: DrawnAsset = {
                ...clone,
                // A copy keeps the lock state, even a default one (stepping it
                // off the edge would stop it counting as a backdrop).
                ...(isAssetLocked(src, s) ? { locked: true } : {}),
                iid: newIid(),
                x: step(src.x, src.w),
                y: step(src.y, src.h),
                zIndex: src.zIndex + 1,
                mobile: clone.mobile
                  ? {
                      ...clone.mobile,
                      x: clone.mobile.x !== undefined ? step(clone.mobile.x, clone.mobile.w ?? src.w) : undefined,
                      y: clone.mobile.y !== undefined ? step(clone.mobile.y, clone.mobile.h ?? src.h) : undefined,
                    }
                  : undefined,
              };
              newIidVal = copy.iid;
              const assets = [...s.assets];
              assets.splice(idx + 1, 0, copy);
              return { ...s, assets };
            }),
          }));
          if (newIidVal) set({ selectedAssetIid: newIidVal });
        },

        updateAssetTransform: (assetIid, t) =>
          mutateAsset(assetIid, (a) => {
            const round = (n: number) => Math.round(n * 100) / 100;
            return {
              ...a,
              x: t.x !== undefined ? round(t.x) : a.x,
              y: t.y !== undefined ? round(t.y) : a.y,
              w: t.w !== undefined ? round(t.w) : a.w,
              h: t.h !== undefined ? round(t.h) : a.h,
              rotation:
                t.rotation !== undefined ? round(t.rotation) : a.rotation,
            };
          }),

        updateAssetRole: (assetIid, role) =>
          mutateAsset(assetIid, (a) => ({ ...a, role })),

        updateAssetMeta: (assetIid, partial) =>
          mutateAsset(assetIid, (a) => ({ ...a, ...partial })),

        updateTextContent: (assetIid, lang, value) =>
          mutateAsset(assetIid, (a) =>
            a.source.kind === "text"
              ? {
                  ...a,
                  source: {
                    ...a.source,
                    text: { ...a.source.text, [lang]: value },
                  },
                }
              : a
          ),

        updateTextStyle: (assetIid, partial) =>
          mutateAsset(assetIid, (a) =>
            a.source.kind === "text"
              ? { ...a, source: { ...a.source, style: { ...a.source.style, ...partial } } }
              : a
          ),

        addComponentAsset: (sectionIid, blockType, occupied) => {
          const asset = makeComponentAsset(blockType);
          if (!asset) return null;
          // Land above whatever is already in the section so a freshly added
          // component is visible rather than buried under existing art.
          const { currentPageSlug, allPages } = get();
          const section = currentPageSlug
            ? allPages[currentPageSlug]?.page.sections.find(
                (s) => s.iid === sectionIid
              )
            : undefined;
          const topZ = Math.max(0, ...(section?.assets ?? []).map((a) => a.zIndex));
          // …and in the first free space, not on top of the last one added.
          const spot = findFreeSpot(occupied ?? section?.assets ?? [], asset.w, asset.h);
          const placed = { ...asset, x: spot.x, y: spot.y, zIndex: topZ + 1 };
          mutateSection(sectionIid, (s) => ({ ...s, assets: [...s.assets, placed] }));
          set({ selectedSectionIid: sectionIid, selectedAssetIid: placed.iid });
          return placed.iid;
        },

        updateComponentProps: (assetIid, partial) =>
          mutateAsset(assetIid, (a) =>
            a.source.kind === "component"
              ? {
                  ...a,
                  source: {
                    ...a.source,
                    block: {
                      ...a.source.block,
                      props: { ...a.source.block.props, ...partial },
                    },
                  },
                }
              : a
          ),

        updateComponentAutoHeight: (assetIid, autoHeight) =>
          mutateAsset(assetIid, (a) =>
            a.source.kind === "component"
              ? { ...a, source: { ...a.source, autoHeight } }
              : a
          ),

        updateAssetMobile: (assetIid, partial) =>
          mutateAsset(assetIid, (a) => {
            const round = (n: number) => Math.round(n * 100) / 100;
            const next = { ...a.mobile };
            for (const [k, v] of Object.entries(partial)) {
              if (v === undefined) continue;
              (next as Record<string, unknown>)[k] =
                typeof v === "number" ? round(v) : v;
            }
            return { ...a, mobile: next };
          }),

        // In the arcade, z-order is one stack shared with the machine, so
        // "forward/back" step past the machine too (behind it = backdrop,
        // in front = over the screen).
        bringAssetForward: (assetIid) =>
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) =>
              !s.assets.some((a) => a.iid === assetIid)
                ? s
                : s.containsGame
                  ? arcadeRestack(s, assetIid, "up")
                  : {
                      ...s,
                      assets: s.assets.map((a) =>
                        a.iid === assetIid ? { ...a, zIndex: a.zIndex + 1 } : a
                      ),
                    }
            ),
          })),

        sendAssetBackward: (assetIid) =>
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) =>
              !s.assets.some((a) => a.iid === assetIid)
                ? s
                : s.containsGame
                  ? arcadeRestack(s, assetIid, "down")
                  : {
                      ...s,
                      assets: s.assets.map((a) =>
                        a.iid === assetIid ? { ...a, zIndex: Math.max(0, a.zIndex - 1) } : a
                      ),
                    }
            ),
          })),

        moveAssetLayer: (assetIid, dir) =>
          mutateCurrentPage((page) => ({
            ...page,
            sections: page.sections.map((s) => {
              if (!s.assets.some((a) => a.iid === assetIid)) return s;
              if (s.containsGame) return arcadeRestack(s, assetIid, dir);
              // Sort by z ascending; "up" (bring forward) swaps with the next
              // higher, "down" (send back) with the next lower.
              const sorted = [...s.assets].sort((a, b) => a.zIndex - b.zIndex);
              const i = sorted.findIndex((a) => a.iid === assetIid);
              const j = dir === "up" ? i + 1 : i - 1;
              if (j < 0 || j >= sorted.length) return s;
              const zi = sorted[i].zIndex;
              const zj = sorted[j].zIndex;
              // Swap the two z values (nudge if equal so the swap is visible).
              const newZi = zi === zj ? (dir === "up" ? zj + 1 : zj - 1) : zj;
              const assets = s.assets.map((a) => {
                if (a.iid === sorted[i].iid) return { ...a, zIndex: newZi };
                if (a.iid === sorted[j].iid) return { ...a, zIndex: zi };
                return a;
              });
              return { ...s, assets };
            }),
          })),

        // ─── Content ───
        updateContent: (assetIid, content) => {
          const { currentPageSlug, contentMap } = get();
          if (!currentPageSlug) return;
          set({
            contentMap: {
              ...contentMap,
              [`${currentPageSlug}:${assetIid}`]: content,
            },
            isDirty: true,
          });
        },
        restoreContent: (assetIid, content, wasDirty) => {
          const { currentPageSlug, contentMap } = get();
          if (!currentPageSlug) return;
          const next = { ...contentMap };
          const key = `${currentPageSlug}:${assetIid}`;
          if (content) next[key] = content;
          else delete next[key];
          set({ contentMap: next, isDirty: wasDirty });
        },
        openContentEditor: (assetIid) =>
          set({ editingContentAssetIid: assetIid }),
        closeContentEditor: () => set({ editingContentAssetIid: null }),

        // ─── Misc UI ───
        setPreviewLanguage: (lang) => set({ previewLanguage: lang }),
        setDeviceMode: (m) => set({ deviceMode: m }),
        togglePagesPanel: () =>
          set((s) => ({ showPagesPanel: !s.showPagesPanel })),
        toggleLibrary: () => set((s) => ({ showLibrary: !s.showLibrary })),

        // ─── Persistence ───
        markClean: () => set({ isDirty: false }),

        reloadVersion: async () => {
          const { currentPageSlug: slug, allPages } = get();
          const record = slug ? allPages[slug] : null;
          if (!slug || !record?.versionId) return { ok: false, error: "No saved version is open." };
          const versionId = record.versionId;
          const res = await loadLandingVersion(versionId, slug);
          if (!res.page) return { ok: false, error: res.error };
          const page = res.page;
          const content = get().versionContent
            ? (res.content ?? (await loadAllPageContent(slug)))
            : null;
          set((s) => ({
            allPages: { ...s.allPages, [slug]: { ...s.allPages[slug], page } },
            ...(content ? { contentMap: withPageContent(s.contentMap, slug, content) } : {}),
            versions: {
              ...s.versions,
              [slug]: (s.versions[slug] ?? []).map((v) =>
                v.id === versionId && res.updatedAt ? { ...v, updatedAt: res.updatedAt } : v
              ),
            },
            isDirty: false,
            selectedSectionIid: null,
            selectedAssetIid: null,
          }));
          // Undo must not step back into the discarded local edits.
          useLandingEditorStore.temporal.getState().clear();
          await clearLandingDraft(landingDraftKey({ ...get().allPages[slug], versionId }) ?? page.iid).catch(() => undefined);
          return { ok: true };
        },

        saveToSupabase: async (opts) => {
          const { currentPageSlug, allPages, contentMap } = get();
          if (!currentPageSlug) return { ok: false, contentErrors: [] };
          const record = allPages[currentPageSlug];
          if (!record) return { ok: false, contentErrors: [] };

          let pageResult: { ok: boolean; error?: string; code?: string; theirsUpdatedAt?: string };
          if (get().versioning) {
            // Writes only the open version; the live page is untouched until
            // Publish. The version's updated_at (as this tab last saw it) is
            // the concurrency token: a newer one elsewhere means a conflict.
            const token = get().versions[currentPageSlug]?.find((x) => x.id === record.versionId)?.updatedAt;
            const res = await saveLandingVersion(record.page, record.versionId, undefined, {
              expectedUpdatedAt: token,
              force: opts?.force,
              // With the content column, button content is saved INTO the
              // version (so a draft's pop-ups stay off the live site until
              // Publish). Without it, the shared rows below keep the old path.
              content: get().versionContent ? pageContentOf(contentMap, currentPageSlug) : undefined,
            });
            pageResult = res;
            if (res.ok && res.version) {
              const v = res.version;
              rememberVersion(record.page.iid, v.id);
              set((s) => {
                const rest = (s.versions[currentPageSlug] ?? []).filter((x) => x.id !== v.id);
                return {
                  allPages: { ...s.allPages, [currentPageSlug]: { ...s.allPages[currentPageSlug], versionId: v.id } },
                  versions: { ...s.versions, [currentPageSlug]: [v, ...rest] },
                };
              });
            }
          } else {
            pageResult = await saveLandingPage(record.page, record.status);
          }

          if (pageResult.code === "conflict") {
            // Nothing was written; button content (shared across versions)
            // waits for the user's choice too.
            return {
              ok: false,
              pageError: pageResult.error,
              contentErrors: [],
              conflict: { theirsUpdatedAt: pageResult.theirsUpdatedAt },
            };
          }

          const contentEntries =
            get().versioning && get().versionContent
              ? []
              : Object.entries(contentMap).filter(([key]) =>
                  key.startsWith(`${currentPageSlug}:`)
                );
          const contentErrors: string[] = [];
          for (const [key, content] of contentEntries) {
            const assetIid = key.slice(currentPageSlug.length + 1);
            const res = await savePageContent(currentPageSlug, assetIid, content);
            if (!res.ok && res.error) contentErrors.push(res.error);
          }

          const ok = pageResult.ok && contentErrors.length === 0;
          if (ok) set({ isDirty: false });
          return { ok, pageError: pageResult.error, contentErrors };
        },

        hydrateFromSupabase: async () => {
          const result = await loadAllLandingPagesForEditor();
          const allPages: Record<string, LandingPageRecord> = {};
          for (const rec of result.pages) {
            allPages[rec.page.slug] = rec;
          }

          const { currentPageSlug } = get();
          const nextSlug =
            currentPageSlug && allPages[currentPageSlug]
              ? currentPageSlug
              : allPages["home"]
                ? "home"
                : Object.keys(allPages)[0] ?? null;

          set({
            allPages,
            versions: result.versions,
            versioning: result.versioning,
            versionContent: result.versioning && result.versionContent,
            contentLoadedSlugs: nextSlug ? [nextSlug] : [],
            currentPageSlug: nextSlug,
            isHydrated: true,
          });

          if (result.versioning && result.versionContent) {
            // Content rides with each page's open version.
            let map = get().contentMap;
            for (const [slug, content] of Object.entries(result.contents)) {
              map = withPageContent(map, slug, content);
            }
            set({ contentMap: map });
          } else if (nextSlug) {
            // Shared-content mode: pull content for the active page.
            const content = await loadAllPageContent(nextSlug);
            const prefixed: Record<string, ObjectContent> = {};
            for (const [assetIid, c] of Object.entries(content)) {
              prefixed[`${nextSlug}:${assetIid}`] = c;
            }
            if (Object.keys(prefixed).length > 0) {
              set({ contentMap: { ...get().contentMap, ...prefixed } });
            }
          }

          return { source: result.source, error: result.error };
        },

        restorePage: (page) => {
          const { currentPageSlug, allPages } = get();
          if (!currentPageSlug) return;
          const record = allPages[currentPageSlug];
          if (!record) return;
          set({
            allPages: {
              ...allPages,
              [currentPageSlug]: { ...record, page },
            },
            isDirty: true,
            selectedSectionIid: null,
            selectedAssetIid: null,
          });
        },
      };
    },
    {
      limit: 100,
      // Only track page-data changes for undo/redo, not UI/selection state.
      partialize: (state) => ({
        allPages: state.allPages,
        currentPageSlug: state.currentPageSlug,
      }),
      // Without this, zundo pushes a history entry on EVERY set() call, even
      // ones that only touch untracked state (selection). Every "add" action
      // here does a mutate-then-select as two separate set() calls, so the
      // second (selection-only) call was pushing a spurious snapshot of the
      // ALREADY-mutated state — making the first Undo a no-op and requiring two
      // clicks to undo one logical action. Reference equality on the two
      // partialized keys is enough: every mutation replaces `allPages` (or
      // `currentPageSlug`) with a new object, so a real change always compares
      // unequal, while a selection-only set() leaves the same reference in
      // place and gets correctly skipped.
      equality: (a, b) =>
        a.allPages === b.allPages && a.currentPageSlug === b.currentPageSlug,
    }
  )
);

// Convenience selector: the current page record ({ page, status }), or null.
export function selectCurrentPage(
  state: LandingEditorState
): LandingPageRecord | null {
  if (!state.currentPageSlug) return null;
  return state.allPages[state.currentPageSlug] ?? null;
}

// Convenience selector: the current DrawnPage itself, or null.
export function selectCurrentDrawnPage(
  state: LandingEditorState
): DrawnPage | null {
  if (!state.currentPageSlug) return null;
  return state.allPages[state.currentPageSlug]?.page ?? null;
}

/**
 * A version is live when it's the page's live version AND the page is online;
 * `edited` = saved since it was last pushed live (needs "Update live").
 */
export function versionState(
  record: LandingPageRecord | null,
  v: PageVersionMeta | undefined
): { live: boolean; edited: boolean } {
  if (!record || !v) return { live: false, edited: false };
  const live = record.status === "published" && record.liveVersionId === v.id;
  const edited =
    live && !!record.publishedAt && Date.parse(v.updatedAt) > Date.parse(record.publishedAt);
  return { live, edited };
}
