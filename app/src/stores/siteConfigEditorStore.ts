import { create } from "zustand";
import type {
  SiteConfig,
  AnnouncementBarConfig,
  HeaderConfig,
  FooterConfig,
  InteractionsConfig,
  FormsConfig,
  MaintenanceConfig,
  SiteSeo,
  SiteTypography,
} from "@/data/landingTypes";
import { DEFAULT_TYPOGRAPHY } from "@/data/fonts";
import { defaultSiteConfig } from "@/data/siteConfig";
import type { ChromeSkin } from "@/data/chromeSkin";
import { DEFAULT_LOADER, type LoaderConfig } from "@/data/loaderConfig";
import {
  loadSiteConfigForEditor,
  saveSiteConfig,
} from "@/lib/landingEditorData";
import type { EditorLoadSource } from "@/lib/editorData";
import { revalidatePublicPaths } from "@/lib/revalidateSite";

// Site config editor store — separate from landingEditorStore because it's a
// different kind of thing: one singleton row, not per-page CRUD, no
// undo/redo (a settings form with an explicit Save, not canvas manipulation
// where an accidental click needs a quick way back).

interface SiteConfigEditorState {
  config: SiteConfig;
  source: EditorLoadSource | null;
  isHydrated: boolean;
  isDirty: boolean;
  isSaving: boolean;
  /** Nav Studio overlay open (transient UI, never saved). */
  navStudioOpen: boolean;
  /** website_site_config.updated_at as this tab last saw it (null = no row yet).
   *  The optimistic-concurrency token for save(). */
  revision: string | null;
  /** Set when a save found the row changed somewhere else; drives
   *  SiteConflictDialog. */
  conflict: { theirsUpdatedAt?: string } | null;

  setNavStudioOpen: (open: boolean) => void;
  hydrate: () => Promise<void>;
  updateAnnouncementBar: (partial: Partial<AnnouncementBarConfig>) => void;
  updateHeader: (partial: Partial<HeaderConfig>) => void;
  updateFooter: (partial: Partial<FooterConfig>) => void;
  updateInteractions: (partial: Partial<InteractionsConfig>) => void;
  updateForms: (partial: Partial<FormsConfig>) => void;
  updateMaintenance: (partial: Partial<MaintenanceConfig>) => void;
  /** Site-wide SEO defaults (share image, site name, Twitter/X handle). */
  updateSeo: (partial: Partial<SiteSeo>) => void;
  /** Replace one UI chrome skin (e.g. the language switcher). */
  updateChromeSkin: (slot: "languagePill", skin: ChromeSkin | undefined) => void;
  /** Edit the site fonts (starting from the built-in defaults). */
  updateTypography: (fn: (t: SiteTypography) => SiteTypography) => void;
  /** Edit the loading screen (starting from the defaults when absent). */
  updateLoader: (fn: (l: LoaderConfig) => LoaderConfig) => void;
  /** `force`: write over a change made somewhere else (conflict "Overwrite"). */
  save: (opts?: { force?: boolean }) => Promise<{ ok: boolean; error?: string; code?: string }>;
  /** Discard this tab's edits and load what's in the database. */
  reloadFromDb: () => Promise<boolean>;
  dismissConflict: () => void;
}

export const useSiteConfigEditorStore = create<SiteConfigEditorState>(
  (set, get) => ({
    config: defaultSiteConfig,
    source: null,
    isHydrated: false,
    isDirty: false,
    isSaving: false,
    navStudioOpen: false,
    revision: null,
    conflict: null,

    setNavStudioOpen: (navStudioOpen) => set({ navStudioOpen }),

    hydrate: async () => {
      if (get().isHydrated) return;
      const { config, source, updatedAt } = await loadSiteConfigForEditor();
      set({ config, source, revision: updatedAt, isHydrated: true });
    },

    reloadFromDb: async () => {
      const { config, source, updatedAt, error } = await loadSiteConfigForEditor();
      if (source !== "supabase" || error) return false;
      set({ config, source, revision: updatedAt, isDirty: false, conflict: null });
      return true;
    },

    dismissConflict: () => set({ conflict: null }),

    updateAnnouncementBar: (partial) =>
      set((s) => ({
        config: { ...s.config, announcementBar: { ...s.config.announcementBar, ...partial } },
        isDirty: true,
      })),

    // Ignored until the real row has loaded (a Save would otherwise write the
    // defaults over the live nav).
    updateHeader: (partial) =>
      get().isHydrated &&
      set((s) => ({
        config: { ...s.config, header: { ...s.config.header, ...partial } },
        isDirty: true,
      })),

    updateFooter: (partial) =>
      set((s) => ({
        config: { ...s.config, footer: { ...s.config.footer, ...partial } },
        isDirty: true,
      })),

    updateInteractions: (partial) =>
      set((s) => ({
        config: {
          ...s.config,
          interactions: {
            ...(s.config.interactions ?? { hoverEffect: "lift" }),
            ...partial,
          },
        },
        isDirty: true,
      })),

    updateForms: (partial) =>
      set((s) => ({
        config: {
          ...s.config,
          forms: { ...(s.config.forms ?? { destination: "none" }), ...partial },
        },
        isDirty: true,
      })),

    updateMaintenance: (partial) =>
      set((s) => ({
        config: {
          ...s.config,
          maintenance: {
            ...(s.config.maintenance ?? defaultSiteConfig.maintenance!),
            ...partial,
          },
        },
        isDirty: true,
      })),

    updateSeo: (partial) =>
      get().isHydrated &&
      set((s) => ({
        config: { ...s.config, seo: { ...s.config.seo, ...partial } },
        isDirty: true,
      })),

    // Ignored until the real row has loaded — otherwise a Save would write
    // the defaults over the live site settings.
    updateChromeSkin: (slot, skin) =>
      get().isHydrated &&
      set((s) => ({
        config: { ...s.config, chrome: { ...s.config.chrome, [slot]: skin } },
        isDirty: true,
      })),

    updateTypography: (fn) =>
      get().isHydrated &&
      set((s) => ({
        config: { ...s.config, typography: fn(s.config.typography ?? DEFAULT_TYPOGRAPHY) },
        isDirty: true,
      })),

    // Ignored until the real row has loaded (same reason as the header).
    updateLoader: (fn) =>
      get().isHydrated &&
      set((s) => ({
        config: { ...s.config, loader: fn(s.config.loader ?? DEFAULT_LOADER) },
        isDirty: true,
      })),

    save: async (opts) => {
      if (!get().isHydrated) return { ok: false, error: "Site settings not loaded yet" };
      set({ isSaving: true });
      const result = await saveSiteConfig(get().config, get().revision, opts?.force);
      set({ isSaving: false });
      if (result.ok) {
        set({
          isDirty: false,
          source: "supabase",
          revision: result.updatedAt ?? get().revision,
          conflict: null,
        });
        // Site settings touch every page (nav, footer, fonts, maintenance).
        void revalidatePublicPaths(["/", "/sitemap.xml"], { layout: true });
      } else if (result.code === "conflict") {
        set({ conflict: { theirsUpdatedAt: result.theirsUpdatedAt } });
      }
      return result;
    },
  })
);
