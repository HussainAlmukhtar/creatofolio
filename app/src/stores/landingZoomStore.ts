import { create } from "zustand";

// Zoom of the landing editor's canvas (touch only: pinch, or the −/+/Fit/100%
// buttons). Not part of the page, never saved, not in undo.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

interface LandingZoomState {
  /** 1 = the page at its real size (identical to the desktop editor). */
  zoom: number;
  /** True while two fingers are on the canvas: element drags ignore input. */
  pinching: boolean;
  /** Bumped when "Fit" is tapped; ZoomSurface turns it into a zoom level. */
  fitTick: number;
  setZoom: (z: number) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
  fit: () => void;
  setPinching: (p: boolean) => void;
}

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const useLandingZoomStore = create<LandingZoomState>((set) => ({
  zoom: 1,
  pinching: false,
  fitTick: 0,
  setZoom: (z) => set({ zoom: Math.round(clamp(z) * 1000) / 1000 }),
  zoomBy: (f) => set((s) => ({ zoom: Math.round(clamp(s.zoom * f) * 1000) / 1000 })),
  reset: () => set({ zoom: 1 }),
  fit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  setPinching: (p) => set({ pinching: p }),
}));
