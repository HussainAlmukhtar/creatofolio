"use client";

// SiteLoader — the loading screen ("Loading…") over a public page
// until its first load settles, then it opens onto the page.
//
// Live (LandingPage / SubPageView, only on a FRESH document load):
//   - Rendered in the server HTML with a tiny inline script that runs before
//     it paints: picks the caption language from localStorage, locks page
//     scroll (html.site-loading) and skips the screen entirely when it was
//     already shown this tab session (showOn "session"). The animation is
//     pure CSS (siteLoader.css), so it moves before React hydrates.
//   - "Loaded" = the document's load event + web fonts + every eager <img>
//     on the page complete (polled: images mounted after hydration count
//     too). The bar fills by real progress, but never faster than
//     `minMs` (measured from navigation start) so the animation reads.
//     A hard cap (MAX_MS) and a CSS failsafe mean nobody is ever stuck
//     behind it; without JavaScript it never shows (<noscript>).
//   - Client-side navigations never show it (the document is already loaded).
//
// Preview (the /admin/loading-screen editor): positioned inside its box,
// simulated progress, `hold` keeps it on the loading loop, `runKey` replays
// the whole intro including the exit.

import { useEffect, useRef, useState } from "react";
import { exitDurationMs, type LoaderConfig } from "@/data/loaderConfig";
import { LoaderStage, ProgressLine } from "./LoaderArt";
import "./siteLoader.css";

const MAX_MS = 10_000;
const SEEN_KEY = "creatofolio-loader-seen";

/** Set once a loader mounted in this document: later (client-side) mounts skip. */
let bootedThisDocument = false;

type State = "loading" | "leaving" | "done";

export interface LoaderPreviewOptions {
  language: "en" | "ar";
  /** Stay on the loading loop (editing). */
  hold: boolean;
  /** Bump to replay the intro from the start. */
  runKey: number;
  onDone?: () => void;
  /** Just the animation: no caption or progress (thumbnails). */
  bare?: boolean;
}

function bootScript(session: boolean) {
  // data-loader-boot marks a document whose server HTML carried the loader:
  // a loader first mounted by a client-side navigation never shows.
  return `(function(){try{var d=document.documentElement;d.setAttribute("data-loader-boot","");${
    session ? `if(sessionStorage.getItem("${SEEN_KEY}")==="1"){d.setAttribute("data-loader-skip","");return;}` : ""
  }if(localStorage.getItem("creatofolio-language")==="ar")d.setAttribute("data-loader-lang","ar");d.classList.add("site-loading");setTimeout(function(){d.classList.remove("site-loading")},${MAX_MS + 5000});}catch(e){}})();`;
}

/** Real load progress of the page behind the loader (0–1) and whether it's done. */
function measure(fontsReady: boolean): { progress: number; ready: boolean } {
  const imgs = Array.from(document.images).filter(
    (img) => img.loading !== "lazy" && !img.closest(".site-loader")
  );
  const done = imgs.filter((img) => img.complete).length;
  const loaded = document.readyState === "complete";
  const total = imgs.length + 2;
  const progress = (done + (loaded ? 1 : 0) + (fontsReady ? 1 : 0)) / total;
  return { progress, ready: loaded && fontsReady && done === imgs.length };
}

function unlockPage() {
  const html = document.documentElement;
  if (!html.classList.contains("site-loading")) return;
  html.classList.remove("site-loading");
  (window as unknown as { __lenis__?: { start(): void } }).__lenis__?.start();
  // The scrollbar came back: pinned hero / reveals must re-measure.
  void import("gsap/ScrollTrigger").then(({ ScrollTrigger }) => ScrollTrigger.refresh());
}

export default function SiteLoader({
  config,
  preview,
}: {
  config: LoaderConfig;
  preview?: LoaderPreviewOptions;
}) {
  const live = !preview;
  const rootRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  // Live and on the client: only the loader that came in the server HTML of
  // this document (boot script ran) shows. A client-side navigation onto a
  // page with a loader (e.g. /about → / when it is set to "home") skips it.
  const [state, setState] = useState<State>(() =>
    live &&
    typeof window !== "undefined" &&
    (bootedThisDocument || !document.documentElement.hasAttribute("data-loader-boot"))
      ? "done"
      : "loading"
  );

  // Written straight to the DOM every frame (no re-render per frame).
  const setProgress = (p: number) => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.js = ""; // stops the pre-hydration creep (siteLoader.css)
    const ink = root.querySelector<SVGPathElement>(".ld-line-ink");
    if (ink) ink.style.strokeDashoffset = String(1 - p);
    if (pctRef.current) pctRef.current.textContent = `${Math.round(p * 100)}%`;
  };

  // ── Live: track the real page load ──
  useEffect(() => {
    if (!live || state !== "loading") return;
    bootedThisDocument = true;
    const html = document.documentElement;
    if (html.hasAttribute("data-loader-skip")) {
      // Already hidden by CSS; unmount once hydration has settled.
      const t = window.setTimeout(() => setState("done"), 0);
      return () => window.clearTimeout(t);
    }
    html.classList.add("site-loading");
    (window as unknown as { __lenis__?: { stop(): void } }).__lenis__?.stop();

    let fontsReady = !("fonts" in document);
    if (!fontsReady) void document.fonts.ready.then(() => (fontsReady = true));

    // A timer, not requestAnimationFrame: frames pause in an occluded or
    // background window, and the screen must still finish on time there.
    // (The line eases between ticks with a CSS transition.)
    let shown = 0;
    let lastPoll = -Infinity;
    let real = { progress: 0, ready: false };
    const tick = () => {
      const now = performance.now();
      if (now - lastPoll > 120) {
        real = measure(fontsReady);
        lastPoll = now;
      }
      // performance.now() counts from navigation start: the time the visitor
      // has already waited counts toward minMs.
      const timeShare = config.minMs > 0 ? Math.min(1, now / config.minMs) : 1;
      const capped = now > MAX_MS;
      const target = capped ? 1 : Math.min(real.ready ? 1 : Math.min(real.progress, 0.96), timeShare);
      shown = Math.min(1, shown + Math.max(0, target - shown) * 0.3);
      if (target >= 1 && shown > 0.97) shown = 1;
      setProgress(shown);
      if (shown >= 1) {
        window.clearInterval(timer);
        setState("leaving");
      }
    };
    const timer = window.setInterval(tick, 50);
    tick();
    return () => window.clearInterval(timer);
  }, [live, state, config.minMs]);

  // Live: the exit animation, then out of the way for good.
  useEffect(() => {
    if (!live || state !== "leaving") return;
    // Let go of the page as the exit starts, so it is ready the moment it shows.
    unlockPage();
    const t = window.setTimeout(() => {
      setState("done");
      if (config.showOn === "session") {
        try {
          sessionStorage.setItem(SEEN_KEY, "1");
        } catch {
          // private mode: shows again next load, harmless
        }
      }
    }, exitDurationMs(config));
    return () => window.clearTimeout(t);
  }, [live, state, config]);

  // Unmounted mid-load (navigation): never leave the page locked.
  useEffect(() => (live ? () => unlockPage() : undefined), [live]);

  // ── Preview: simulated load ──
  const runKey = preview?.runKey;
  const hold = preview?.hold;
  const onDone = preview?.onDone;
  useEffect(() => {
    // (The editor remounts the loader with a new key to replay it.)
    if (live) return;
    const start = performance.now();
    // A believable "slow connection" curve that still respects minMs.
    const loadMs = Math.max(config.minMs, 1800);
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      if (hold) {
        setProgress((t % 3200) / 3200);
      } else {
        const p = Math.min(1, t / loadMs);
        setProgress(1 - Math.pow(1 - p, 1.6));
        if (p >= 1) {
          setState("leaving");
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, runKey, hold, config.minMs]);

  useEffect(() => {
    if (live || state !== "leaving") return;
    const t = window.setTimeout(() => {
      setState("done");
      onDone?.();
    }, exitDurationMs(config));
    return () => window.clearTimeout(t);
  }, [live, state, config, onDone]);

  if (state === "done") return null;

  const lang = preview?.language;
  const caption = (l: "en" | "ar") => config.caption[l] || config.caption.en || config.caption.ar;
  const style = {
    "--loader-speed": config.speed,
    "--loader-size": config.size,
    ...(config.background ? { "--surface-color": config.background } : {}),
    ...(config.ink ? { "--loader-ink": config.ink } : {}),
    "--loader-exit-delay": `${config.preset === "book" ? 550 : 0}ms`,
  } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className="site-loader"
      data-preset={config.preset}
      data-exit={config.exit}
      data-state={state}
      data-preview={preview ? "true" : undefined}
      data-lang={lang}
      data-bare={preview?.bare ? "" : undefined}
      // Lenis ignores wheel/touch inside it (nothing to scroll here).
      data-lenis-prevent=""
      // Thumbnails are decoration inside a button; the real one is a status.
      role={preview?.bare ? undefined : "status"}
      aria-live={preview?.bare ? undefined : "polite"}
      aria-hidden={preview?.bare || undefined}
      style={style}
    >
      {live && (
        <>
          <script dangerouslySetInnerHTML={{ __html: bootScript(config.showOn === "session") }} />
          <noscript>
            <style>{".site-loader{display:none!important}"}</style>
          </noscript>
        </>
      )}
      <div
        className="ld-sheet paper-material"
        data-paper={config.paper === "flat" ? undefined : config.paper}
        data-grain={config.paper === "flat" ? "false" : "true"}
      >
        <div className="ld-center">
          <LoaderStage config={config} />
          {!preview?.bare && (lang ? [lang] : (["en", "ar"] as const)).map((l) => (
            <p key={l} className="ld-caption" lang={l} dir={l === "ar" ? "rtl" : "ltr"} data-caption={l}>
              {caption(l)}
            </p>
          ))}
          {config.progress === "line" && !preview?.bare && <ProgressLine />}
          {config.progress === "dots" && (
            <div className="ld-dots" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          )}
          {/* Visual only: a live region reading out every percent would chatter. */}
          {config.progress === "percent" && (
            <span ref={pctRef} className="ld-pct" aria-hidden>
              0%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
