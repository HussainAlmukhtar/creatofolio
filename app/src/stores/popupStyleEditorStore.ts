// Pop-up style editor store — the working copy of ONE theme or frame while
// /admin/popup-styles?item=<iid> is open. Undo/redo (zundo) covers the config
// only. Same gotchas as the composer store: `equality` on the config
// reference (UI-only sets never become no-op Undo steps) and `settle()`
// clears history after loading, so the first Undo never "undoes" the load.

import { create } from "zustand";
import { temporal } from "zundo";
import type {
  DrawnArt,
  PopupFrameConfig,
  PopupStyleRow,
  PopupThemeConfig,
  ScreenRect,
  SliceInsets,
  ThemePartKey,
} from "@/data/popupStyleTypes";

type Config = PopupThemeConfig | PopupFrameConfig;

interface StyleEditorState {
  row: PopupStyleRow | null;
  config: Config | null;
  /** The config as last saved (draft) or loaded: "unsaved changes?" baseline. */
  savedConfig: Config | null;
  /** Draft token (null = no draft yet). */
  draftUpdatedAt: string | null;

  load: (row: PopupStyleRow, config: Config, draftUpdatedAt: string | null) => void;
  settle: () => void;
  markSaved: (draftUpdatedAt: string | null, config?: Config) => void;
  setRow: (row: PopupStyleRow) => void;
  /** Replace the whole config (history "Load into draft"). */
  replaceConfig: (config: Config) => void;

  // Theme
  setPart: (key: ThemePartKey, art: DrawnArt | null) => void;
  setSlice: (slice: SliceInsets) => void;
  setDialogueSlice: (slice: SliceInsets) => void;
  setThemeField: (partial: Partial<Pick<PopupThemeConfig, "panelScale" | "panelRepeat" | "ink" | "inkSoft">>) => void;

  // Frame
  setFrameArt: (art: DrawnArt | null) => void;
  setScreen: (screen: ScreenRect) => void;
  setFrameField: (
    partial: Partial<Pick<PopupFrameConfig, "phone" | "background" | "ink" | "artOver" | "radius" | "glass" | "screen">>
  ) => void;
}

const GROUP_MS = 600;

export const usePopupStyleEditorStore = create<StyleEditorState>()(
  temporal(
    (set, get) => ({
      row: null,
      config: null,
      savedConfig: null,
      draftUpdatedAt: null,

      load: (row, config, draftUpdatedAt) => {
        set({ row, config, savedConfig: config, draftUpdatedAt });
        clearHistory();
      },
      settle: () => clearHistory(),
      markSaved: (draftUpdatedAt, config) => set({ draftUpdatedAt, savedConfig: config ?? get().config }),
      setRow: (row) => set({ row }),
      replaceConfig: (config) => set({ config }),

      setPart: (key, art) => {
        const c = get().config as PopupThemeConfig | null;
        if (!c || !("parts" in c)) return;
        const parts = { ...c.parts };
        if (art) parts[key] = art;
        else delete parts[key];
        set({ config: { ...c, parts } });
      },
      setSlice: (panelSlice) => {
        const c = get().config as PopupThemeConfig | null;
        if (c && "parts" in c) set({ config: { ...c, panelSlice } });
      },
      setDialogueSlice: (dialogueSlice) => {
        const c = get().config as PopupThemeConfig | null;
        if (c && "parts" in c) set({ config: { ...c, dialogueSlice } });
      },
      setThemeField: (partial) => {
        const c = get().config as PopupThemeConfig | null;
        if (c && "parts" in c) set({ config: { ...c, ...partial } });
      },

      setFrameArt: (art) => {
        const c = get().config as PopupFrameConfig | null;
        if (c && "screen" in c) set({ config: { ...c, art } });
      },
      setScreen: (screen) => {
        const c = get().config as PopupFrameConfig | null;
        if (c && "screen" in c) set({ config: { ...c, screen } });
      },
      setFrameField: (partial) => {
        const c = get().config as PopupFrameConfig | null;
        if (c && "screen" in c) set({ config: { ...c, ...partial } });
      },
    }),
    {
      limit: 100,
      partialize: (s) => ({ config: s.config }),
      equality: (past, current) => past.config === current.config,
      // Dragging a guide or the screen window = one Undo step per pause.
      handleSet: (handleSet) => {
        let last = 0;
        return (...args: Parameters<typeof handleSet>) => {
          const now = Date.now();
          if (now - last > GROUP_MS) handleSet(...args);
          last = now;
        };
      },
    }
  )
);

function clearHistory(): void {
  usePopupStyleEditorStore.temporal.getState().clear();
}
