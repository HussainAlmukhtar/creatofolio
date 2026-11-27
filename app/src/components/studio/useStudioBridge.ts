"use client";

// Host side of the studio bridge (public/klecks/index.html): iframe ref, ready
// flag, the state the bridge reports, guide-proof exports, restore offers.
//
// The one rule this hook enforces for every host: a PNG is only handed back when
// the bridge says its GUIDE layers were left out. A flattened picture is refused
// with a plain message instead of being uploaded.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  EMPTY_STUDIO_STATE,
  type BridgeMessage,
  type PencilMode,
  type PngPath,
  type StudioExport,
  type StudioState,
} from "./studioProtocol";

export interface StudioSubmit {
  png: Blob;
  psd: Blob;
  path: PngPath;
}

interface Pending {
  resolve: (r: StudioExport) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REFUSED =
  "The picture couldn't be saved without the guide in it, so nothing was saved. Try again; if it keeps happening, reload the page.";

export function useStudioBridge(opts: { onSubmit?: (r: StudioSubmit) => void } = {}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<StudioState>(EMPTY_STUDIO_STATE);
  const [restoreOffer, setRestoreOffer] = useState<{ savedAt: number } | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const idRef = useRef(0);
  const onSubmitRef = useRef(opts.onSubmit);
  useEffect(() => {
    onSubmitRef.current = opts.onSubmit;
  });

  const post = useCallback((msg: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  const requestExport = useCallback(
    (o: { forcePath?: string } = {}): Promise<StudioExport> => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return Promise.resolve({ error: "The drawing studio isn't loaded." });
      return new Promise((resolve) => {
        const id = ++idRef.current;
        const timer = setTimeout(() => {
          if (pendingRef.current.delete(id)) resolve({ error: "Exporting took too long (30 s). Nothing was saved." });
        }, 30_000);
        pendingRef.current.set(id, { resolve, timer });
        post({ type: "requestExport", id, forcePath: o.forcePath });
      });
    },
    [post]
  );

  const ackSubmit = useCallback((ok: boolean) => post({ type: ok ? "submitAck" : "submitError" }), [post]);

  useEffect(() => {
    function handler(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data as BridgeMessage | null | undefined;
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "ready":
          setIsReady(true);
          return;
        case "studioState": {
          const { type, ...rest } = msg;
          void type;
          setState(rest);
          return;
        }
        case "restoreOffer":
          setRestoreOffer({ savedAt: msg.savedAt });
          return;
        case "autosaved":
          setAutosavedAt(msg.at);
          return;
        case "exportResult": {
          const p = pendingRef.current.get(msg.id);
          if (!p) return;
          clearTimeout(p.timer);
          pendingRef.current.delete(msg.id);
          if (msg.error || !msg.png || !msg.psd) {
            p.resolve({ error: msg.error ?? "Export failed." });
          } else if (msg.guideStripped === false || msg.pngPath === "getPNG") {
            p.resolve({ error: REFUSED });
          } else {
            p.resolve({ png: msg.png, psd: msg.psd, path: msg.pngPath ?? "native" });
          }
          return;
        }
        case "submit": {
          // The studio's own OK button. Same rule as an export.
          if (msg.guideStripped === false || msg.pngPath === "getPNG") {
            toast.error("Couldn't save", { description: REFUSED });
            ackSubmit(false);
            return;
          }
          onSubmitRef.current?.({ png: msg.png, psd: msg.psd, path: msg.pngPath ?? "native" });
          return;
        }
        case "error":
          console.error("[studio]", msg.message);
          toast.error("Drawing studio error", { description: msg.message });
          return;
        default:
          return;
      }
    }
    window.addEventListener("message", handler);
    const pending = pendingRef.current;
    return () => {
      window.removeEventListener("message", handler);
      pending.forEach((p) => clearTimeout(p.timer));
      pending.clear();
    };
  }, [ackSubmit]);

  return {
    iframeRef,
    isReady,
    state,
    restoreOffer,
    autosavedAt,
    post,
    requestExport,
    ackSubmit,
    /** Open the project (once). `autosaveKey` makes the bridge keep + offer back unsaved work. */
    open: useCallback((msg: Record<string, unknown>) => post({ type: "open", ...msg }), [post]),
    answerRestore: useCallback(
      (restore: boolean) => {
        setRestoreOffer(null);
        post({ type: "restoreChoice", restore });
      },
      [post]
    ),
    clearAutosave: useCallback(() => post({ type: "clearAutosave" }), [post]),
    setPencilMode: useCallback((mode: PencilMode) => post({ type: "setPencilOnly", mode }), [post]),
    setGuidesVisible: useCallback((visible: boolean) => post({ type: "setGuidesVisible", visible }), [post]),
    setBrushDiameter: useCallback((px: number) => post({ type: "setBrushDiameter", px }), [post]),
  };
}

export type StudioBridge = ReturnType<typeof useStudioBridge>;
