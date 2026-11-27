"use client";

// The shared chrome of the Drawing Studio: modal, header tools (Pencil only,
// guides, brush sizes, full screen, draft status), the iframe, the "restore
// unsaved drawing" offer. Hosts (LandingDrawModal, DrawModalInner) supply their
// own title, save buttons and logic through `actions`.
//
// On a touch screen the studio is edge-to-edge by default (it used to be a
// 92dvh × 95vw card with a header: not much canvas on an iPad), and every
// gesture is kept inside it: no Safari page zoom / tab overview, no callout.

import { useEffect, useRef, type ReactNode } from "react";
import { Eye, EyeOff, Maximize2, Minimize2, PenLine, X } from "lucide-react";
import { useTouchMode } from "@/lib/touchMode";
import { BRUSH_PRESETS, maxBrushDiameter } from "./studioProtocol";
import { useStudioFullscreen } from "./useStudioFullscreen";
import type { StudioBridge } from "./useStudioBridge";

interface StudioModalProps {
  bridge: StudioBridge;
  title: string;
  /** Small grey facts next to the title (canvas size, …). */
  meta?: ReactNode;
  /** Save buttons etc., right of the studio tools. */
  actions: ReactNode;
  onClose: () => void;
  /** Shown instead of the save buttons while saving: "Exporting…", "Uploading…". */
  progress?: string | null;
  /** Closing and saving are blocked while true. */
  busy?: boolean;
  /** Remount the iframe when this changes (a new target = a fresh Klecks). */
  iframeKey?: string;
  zIndex?: number;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const chip =
  "inline-flex items-center gap-1 rounded px-2 text-xs font-medium transition-colors disabled:opacity-40";

export function StudioModal({
  bridge,
  title,
  meta,
  actions,
  onClose,
  progress,
  busy,
  iframeKey,
  zIndex = 3000,
}: StudioModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touch = useTouchMode();
  const { full, toggle, exit } = useStudioFullscreen(containerRef);
  const { state, isReady, restoreOffer, autosavedAt, iframeRef } = bridge;
  const edge = full || touch;
  const maxBrush = maxBrushDiameter(state.canvasW || 1600, state.canvasH || 1600);
  const presets = BRUSH_PRESETS.filter((p) => p <= maxBrush);

  // Safari's pinch (page zoom / tab overview) fires gesture events that ignore
  // touch-action: cancel them over the whole studio.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", stop, { passive: false });
    el.addEventListener("gesturechange", stop, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", stop);
      el.removeEventListener("gesturechange", stop);
    };
  }, []);

  const pencilLabel = state.pencilOnly ? (state.pencilMode === "auto" ? "Pencil only (auto)" : "Pencil only") : "Pencil only: off";

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/80 ${edge ? "p-0" : "p-4"}`}
      style={{ zIndex, touchAction: "none", overscrollBehavior: "none", WebkitTouchCallout: "none" }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-label={title}
        data-studio-modal
        className={`flex flex-col overflow-hidden border border-neutral-700 bg-neutral-900 shadow-2xl ${
          edge ? "h-dvh w-screen rounded-none border-0" : "h-[92dvh] w-[95vw] rounded-xl"
        }`}
        style={
          edge
            ? {
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
                paddingLeft: "env(safe-area-inset-left)",
                paddingRight: "env(safe-area-inset-right)",
              }
            : undefined
        }
      >
        <div className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-700 bg-neutral-800 px-3 py-2">
          <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
          {meta && <span className="text-[10px] text-neutral-500">{meta}</span>}

          <div className="flex-1" />

          {!isReady && <span className="text-[10px] italic text-neutral-400">Loading…</span>}
          {progress ? (
            <span role="status" className="text-xs font-medium text-amber-300">
              {progress}
            </span>
          ) : (
            autosavedAt && (
              <span className="hidden text-[10px] text-neutral-500 sm:inline" title="A copy of your drawing is kept on this device while you work. It's offered back if the page closes before you save.">
                Draft kept {clock(autosavedAt)}
              </span>
            )
          )}

          <button
            type="button"
            onClick={() => bridge.setPencilMode(state.pencilOnly ? "off" : "on")}
            aria-pressed={state.pencilOnly}
            className={`${chip} h-8 ${state.pencilOnly ? "bg-sky-600 text-white" : "bg-neutral-700 text-neutral-200 hover:bg-neutral-600"}`}
            title="Pencil only: a finger moves and zooms the canvas, only the Apple Pencil (or a mouse) draws. Turns on by itself the first time the Pencil touches the screen."
          >
            <PenLine size={13} />
            {pencilLabel}
          </button>

          {state.guideCount > 0 && (
            <button
              type="button"
              onClick={() => bridge.setGuidesVisible(!state.guidesVisible)}
              aria-pressed={state.guidesVisible}
              className={`${chip} h-8 ${state.guidesVisible ? "bg-neutral-700 text-neutral-100 hover:bg-neutral-600" : "bg-neutral-900 text-neutral-400 ring-1 ring-neutral-600 hover:bg-neutral-800"}`}
              title="Show or hide the guide (the dashed frames you draw inside). It is never part of the saved picture either way."
            >
              {state.guidesVisible ? <Eye size={13} /> : <EyeOff size={13} />}
              Guides
            </button>
          )}

          <div className="flex items-center gap-0.5" role="group" aria-label="Brush size presets">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => bridge.setBrushDiameter(p)}
                className={`${chip} h-8 min-w-9 justify-center bg-neutral-700 font-mono text-neutral-200 hover:bg-neutral-600`}
                title={`Set the brush to ${p} px wide`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-neutral-600" />

          {actions}

          <div className="h-5 w-px bg-neutral-600" />

          <button
            type="button"
            onClick={toggle}
            className={`${chip} h-8 bg-neutral-700 text-neutral-200 hover:bg-neutral-600`}
            aria-label={full ? "Exit full screen" : "Full screen"}
            title={full ? "Exit full screen (Esc)" : "Full screen"}
          >
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            <span className="hidden md:inline">{full ? "Exit full screen" : "Full screen"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (full) exit();
              onClose();
            }}
            disabled={busy}
            className={`${chip} h-8 bg-neutral-700 text-neutral-200 hover:bg-neutral-600`}
            aria-label="Close drawing studio"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {state.memoryWarning && (
          <div role="alert" className="flex-shrink-0 border-b border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs text-amber-100">
            {state.memoryWarning}
          </div>
        )}

        <div className="relative flex-1 bg-black">
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src="/klecks/index.html"
            className="absolute inset-0 h-full w-full border-0"
            title="Drawing Studio"
            allow="clipboard-write; clipboard-read; fullscreen"
          />
          {restoreOffer && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/70 p-4">
              <div role="alertdialog" aria-label="Restore unsaved drawing" className="w-full max-w-sm rounded-xl border border-neutral-600 bg-neutral-800 p-4 text-neutral-100 shadow-2xl">
                <p className="text-sm font-medium">Restore your unsaved drawing?</p>
                <p className="mt-1 text-xs text-neutral-400">
                  This device kept a copy from {clock(restoreOffer.savedAt)}: the page closed before it was saved.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => bridge.answerRestore(true)}
                    className="h-10 flex-1 rounded-lg bg-sky-600 text-sm font-medium text-white hover:bg-sky-500"
                  >
                    Restore it
                  </button>
                  <button
                    type="button"
                    onClick={() => bridge.answerRestore(false)}
                    className="h-10 flex-1 rounded-lg bg-neutral-700 text-sm font-medium hover:bg-neutral-600"
                  >
                    Start fresh
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
