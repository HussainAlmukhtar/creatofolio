// Messages between a studio host (LandingDrawModal, DrawModalInner) and the
// iframe bridge at public/klecks/index.html. Keep both sides aligned.

export type PencilMode = "on" | "off" | "auto";

/** Which guide-proof export path produced the PNG ("plain" = the drawing has
 *  no guide and the Klecks build can't strip one; "getPNG" = dev-only baseline). */
export type PngPath = "native" | "project" | "hide" | "plain" | "getPNG";

/** What the bridge reports about the open drawing (posted whenever it changes). */
export interface StudioState {
  apiOk: boolean;
  guideCount: number;
  guidesVisible: boolean;
  layerCount: number;
  pencilMode: PencilMode;
  /** Effective: finger pans, only the Pencil / mouse draws. */
  pencilOnly: boolean;
  penSeen: boolean;
  canvasW: number;
  canvasH: number;
  /** A plain-language warning about iPad memory, or null. */
  memoryWarning: string | null;
}

export const EMPTY_STUDIO_STATE: StudioState = {
  apiOk: false,
  guideCount: 0,
  guidesVisible: true,
  layerCount: 0,
  pencilMode: "auto",
  pencilOnly: false,
  penSeen: false,
  canvasW: 0,
  canvasH: 0,
  memoryWarning: null,
};

export type BridgeMessage =
  | { type: "ready" }
  | ({ type: "studioState" } & StudioState)
  | { type: "exportResult"; id: number; png?: Blob; psd?: Blob; pngPath?: PngPath; guideStripped?: boolean; error?: string }
  | { type: "submit"; png: Blob; psd: Blob; pngPath?: PngPath; guideStripped?: boolean }
  | { type: "restoreOffer"; savedAt: number; width: number; height: number }
  | { type: "autosaved"; at: number }
  | { type: "autosaveFailed"; message: string }
  | { type: "layers"; id: number; names: string[] }
  | { type: "error"; message: string };

export type StudioExport =
  | { png: Blob; psd: Blob; path: PngPath }
  | { error: string };

/** Quick brush sizes (diameter px), capped by what the canvas allows. */
export const BRUSH_PRESETS = [8, 24, 64, 160, 400] as const;

export function maxBrushDiameter(w: number, h: number): number {
  return Math.min(1000, Math.max(500, Math.round(Math.max(w, h) / 8)));
}
