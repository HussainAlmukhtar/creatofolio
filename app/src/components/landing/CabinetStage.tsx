"use client";

// CabinetStage — the public arcade hero's PLAY CONTROLLER. It renders the
// authored scene (ArcadeScene: stage → camera → world with the machine and
// the scene art) with the live Phaser game in the machine's screen, and runs
// click-to-play.
//
// Geometry: everything (machine, screen, art) lives in ONE world coordinate
// space moved by ONE camera (CSS vars on `.arcade-world`, see globals.css +
// lib/arcadeCamera.ts). The Phaser canvas inside the screen is fixed at
// 1520×960 and fitted with a CSS transform driven by a ResizeObserver —
// Phaser is on Scale.NONE so it never re-fits.
//
// INVARIANT: only the scene lives inside the camera transform. Every UI chrome
// element (✕, hints) is portal'd to document.body — anything inside the
// transform is multiplied by the zoom scale AND has its position:fixed
// captured.
//
// Click-to-play (camera dolly, desktop AND phones):
//
//   On click we capture the camera currently in effect (the rest framing, or
//   wherever the scroll keyframes have it) as BASE, compute the PLAY camera
//   (auto-fit the screen to `screenFill` of the viewport, level any machine
//   tilt, centre it in the viewport — lib/arcadeCamera.ts playCamera) and
//   tween between them. Every visual write goes through one canonical
//   "virtual scale" (1 = base, ZOOM_DEPTH = play), so the wheel/touch drain
//   machine below works in the same units on every device.
//
//   On scroll while zoomed: a non-passive wheel listener hijacks downward
//   wheel/touch events and drains the virtual scale instead of advancing the
//   page. When it reaches 1, the listener detaches and the page scrolls on
//   normally into the sections — one continuous gesture.
//
//   Phones used to break the screen out to fixed-fullscreen. A camera dolly
//   now does the same job (the game ends up the same size — it is
//   letterboxed to 19:12 either way) while keeping the drawn scene around it,
//   and it can't be broken by a transformed/contained ancestor capturing
//   position:fixed.

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { X } from "lucide-react";
import type Lenis from "lenis";
import type { DrawnAsset } from "@/data/landingTypes";
import {
  ARCADE_MOBILE_QUERY,
  machinePlacement,
  machineVariant,
  type ArcadeCamera,
  type ArcadeConfig,
  type ArcadeDeviceKey,
} from "@/data/arcadeConfig";
import {
  applyCamera,
  maxSharpScale,
  mixCamera,
  mixOffset,
  playCamera,
  readCamera,
  type CameraPx,
} from "@/lib/arcadeCamera";
import { useLandingStore, selectIsPlayMode } from "@/stores/landingStore";
import { EventBridge, EVENTS } from "@/components/game/EventBridge";
import { getGameInstance, setSleepReason } from "@/components/game/gameHandle";
import { GAME_WIDTH, GAME_HEIGHT } from "@/components/game/gameDimensions";
import GameBootScreen from "@/components/game/GameBootScreen";
import ArcadeScene from "./ArcadeScene";
import ChromeArt from "./ChromeArt";
import { chromeSlotAttrs } from "@/data/chromeSkin";

// Phaser cannot SSR, and GameWrapper does its own dynamic-import dance
// internally. Importing GameWrapper directly is safe because it's a
// "use client" module — but we still gate the wrapper itself from
// SSR via dynamic() so the heavy avatar/Supabase imports don't end up
// in the server bundle.
const GameWrapper = dynamic(
  () => import("@/components/game/GameWrapper"),
  { ssr: false }
);

/**
 * When to start fetching the game (Phaser ~315 KB + avatar sheets + the rooms
 * query, ~1.3 MB in all). It used to start at hydration, racing the hero art
 * for the visitor's bandwidth: on a phone the cabinet picture arrived seconds
 * late. Now it starts once the page has loaded and the browser is idle, or at
 * once on the first sign of intent (pointer, key, Play). Data-saver visitors
 * only load it when they press Play.
 */
function useGameWarmup(): [boolean, () => void] {
  const [warm, setWarm] = useState(false);
  const start = useCallback(() => setWarm(true), []);
  useEffect(() => {
    if (warm) return;
    const onIntent = () => setWarm(true);
    window.addEventListener("pointerdown", onIntent, { once: true, passive: true });
    window.addEventListener("keydown", onIntent, { once: true });
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const afterLoad = () => {
      if (saveData) return;
      if ("requestIdleCallback" in window) idleId = window.requestIdleCallback(onIntent, { timeout: 2500 });
      else timerId = setTimeout(onIntent, 1200);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onIntent);
      window.removeEventListener("keydown", onIntent);
      window.removeEventListener("load", afterLoad);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, [warm]);
  return [warm, start];
}

// ScrollTrigger ids registered by useLandingMotion for the arcade camera.
export const ARCADE_SCROLL_IDS = ["hero-pin", "hero-scrub"] as const;

// How aggressively does wheel-down zoom the camera out? In virtual-scale
// units per pixel of deltaY. Reduced from 0.005 → 0.0015 so the drain feels
// velocity-driven over several wheel notches rather than snapping.
const WHEEL_TO_SCALE = 0.0015;
// Same idea for touch: scale-decrement per pixel of touchmove delta.
// Higher than wheel because trackpad/touch deltas are usually small.
const TOUCH_TO_SCALE = 0.006;

// The virtual zoom depth every click-in is expressed in. The real camera
// scale depends on the art and the viewport; mapping it onto a fixed depth
// keeps the exit gesture the same length everywhere (~1000px of wheel).
const ZOOM_DEPTH = 2.5;

// ── Drain settle tuning ──
// The exit gesture is a state machine (idle → draining → settling): while
// the user scrolls, raw input drives the zoom; the moment they stop, the
// camera SETTLES to the nearest endpoint instead of freezing mid-zoom.
// Progress p runs 0 (fully zoomed in) → 1 (back at rest).
const EXIT_COMMIT_THRESHOLD = 0.35; // settle past this p → complete the exit
const IDLE_SETTLE_MS = 200; //         wheel idle window before settling
const FLICK_VELOCITY = 0.0025; //      p per ms — a fast flick commits regardless of p
const SETTLE_EXIT_DUR = 0.45; //       s, finish the exit
const SETTLE_RETURN_DUR = 0.35; //     s, spring back to full zoom
const VELOCITY_WINDOW_MS = 140; //     how far back samples count toward velocity
const EXIT_DUR = 0.7; //               s, the ✕ exit

type DrainState = "idle" | "draining" | "settling";

/** Write the shared exit-progress custom property. Registered `inherits:
 *  true` on :root so it reaches both the vignette (inside .landing-root)
 *  and the chrome portal'd to document.body. */
function setExitProgress(p: number) {
  document.documentElement.style.setProperty(
    "--exit-progress",
    String(Math.min(1, Math.max(0, p)))
  );
}

/** While true, CSS disables the discrete opacity transitions on the
 *  vignette/HUD/✕ so per-frame progress writes are shown raw. */
function setExitDrainingAttr(on: boolean) {
  if (on) {
    document.body.dataset.exitDraining = "true";
  } else {
    delete document.body.dataset.exitDraining;
  }
}

/** Toggle the arcade ScrollTriggers (desktop pin / phone scrub). Disabling
 *  keeps the camera they left behind; enabling refreshes the pin math.
 *  Synchronous on purpose: they must be off BEFORE the body scroll lock, or
 *  the lock's scroll jump reaches them first (camera snaps to rest, the pin
 *  releases and the scroll position is lost). */
function setScrollTriggersEnabled(on: boolean) {
  for (const id of ARCADE_SCROLL_IDS) {
    const st = ScrollTrigger.getById(id);
    if (!st) continue;
    if (on) st.enable(false);
    else st.disable(false, false);
  }
  // The refresh re-applies the scroll camera (useLandingMotion's "refresh"
  // listener), so the camera lands on the scroll position's framing.
  if (on) ScrollTrigger.refresh();
}

export default function CabinetStage({
  arcade,
  world,
  assets,
}: {
  arcade: ArcadeConfig;
  world: { w: number; h: number };
  assets: DrawnAsset[];
}) {
  const language = useLandingStore((s) => s.language);
  const setLanguage = useLandingStore((s) => s.setLanguage);
  const setMode = useLandingStore((s) => s.setMode);
  const mode = useLandingStore((s) => s.mode);
  const isPlayMode = useLandingStore(selectIsPlayMode);
  const isReducedMotion = useLandingStore((s) => s.isReducedMotion);
  const hasSeenExitHint = useLandingStore((s) => s.hasSeenExitHint);
  const markExitHintSeen = useLandingStore((s) => s.markExitHintSeen);

  const [gameWarm, startGameWarmup] = useGameWarmup();
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const gameMountRef = useRef<HTMLDivElement>(null);
  const stashedScrollY = useRef(0);
  const hijackCleanup = useRef<(() => void) | null>(null);
  // Active gsap tween of the camera proxy, if any. The wheel-hijack must
  // `.kill()` this BEFORE writing new values — otherwise GSAP's per-frame
  // writes keep snapping the camera back toward the tween's target and the
  // user's wheel input is overruled.
  const activeTweenRef = useRef<gsap.core.Tween | null>(null);
  // The two cameras the dolly blends between (captured at enterPlay).
  const camRef = useRef<{
    base: ArcadeCamera;
    baseOff: CameraPx;
    play: ArcadeCamera;
    playOff: CameraPx;
  } | null>(null);
  // Virtual-scale target (fully zoomed in). Always ZOOM_DEPTH once a
  // click-in has started; 1 = nothing to drain.
  const zoomTargetRef = useRef<{ scale: number }>({ scale: 1 });
  // Drain state machine (see constants above).
  const drainStateRef = useRef<DrainState>("idle");
  // Wheel/touch deltas accumulate here and are applied once per rAF —
  // input events fire faster than frames and each write costs style work.
  const pendingDeltaRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Recent {t, p} samples for the flick-velocity estimate.
  const samplesRef = useRef<Array<{ t: number; p: number }>>([]);
  // Cache of the last virtual scale we wrote, so the rAF hot path never
  // needs a style read. Every visual write goes through applyZoomVisual,
  // which keeps this fresh — including settle tweens.
  const lastScaleRef = useRef<number | null>(null);
  const [showExitHint, setShowExitHint] = useState(false);
  // Play was started from the keyboard → manage focus in/out of play mode.
  const keyboardEntryRef = useRef(false);
  // Portal mount gate — document.body is unavailable during SSR; flip
  // after first client render (same pattern as GameWrapper's HUD portal).
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    setPortalMounted(true);
  }, []);

  // The config is read at event time (enterPlay) — keep a ref so the
  // callbacks don't need it as a dep (the editor preview swaps configs).
  const arcadeRef = useRef(arcade);
  const worldSizeRef = useRef(world);
  useEffect(() => {
    arcadeRef.current = arcade;
    worldSizeRef.current = world;
  }, [arcade, world]);

  // Keep `--game-css-scale` updated so the fixed 1520×960 canvas fits the
  // screen rect. clientWidth/Height are LAYOUT pixels — unaffected by any
  // CSS transform on this element or its ancestors — so the camera never
  // pollutes the measurement (and no getComputedStyle is needed). The
  // ResizeObserver fires on real layout changes only (viewport resizes, an
  // edited screen rect).
  //
  // Hardening (the "tiny game stuck top-left" bug): the inner mount reads
  // `scale(var(--game-css-scale, 1))` — if this variable is ever missing
  // or 0, the full 1520×960 box overflows the screen rect and gets
  // clipped. So: useLayoutEffect (write before first paint), never write
  // 0/NaN, and if the screen rect hasn't laid out yet (0×0 on first
  // measure), retry across a few frames until it has real dimensions.
  useLayoutEffect(() => {
    const mount = gameMountRef.current;
    if (!mount) return;

    let rafId: number | null = null;
    let retries = 0;

    const updateScale = () => {
      rafId = null;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w < 2 || h < 2) {
        if (retries++ < 10) rafId = requestAnimationFrame(updateScale);
        return;
      }
      retries = 0;
      const scale = Math.min(w / GAME_WIDTH, h / GAME_HEIGHT);
      if (!Number.isFinite(scale) || scale <= 0) return;
      mount.style.setProperty("--game-css-scale", String(scale));
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(mount);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  // ── Body scroll lock helpers (iOS Safari-safe) ──────────────
  const lockBodyScroll = () => {
    stashedScrollY.current = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${stashedScrollY.current}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    // overscroll-behavior: none while the touch hijack owns gestures
    // (blocks pull-to-refresh); scoped to play mode via this class so
    // normal browsing keeps native overscroll.
    document.body.classList.add("play-lock");
  };
  const unlockBodyScroll = () => {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.classList.remove("play-lock");
    window.scrollTo(0, stashedScrollY.current);
  };

  // ── Compute the dolly (base → play camera) ──────────────────
  const computeDolly = (): boolean => {
    const stage = stageRef.current;
    const worldEl = worldRef.current;
    if (!stage || !worldEl) return false;
    const a = arcadeRef.current;
    const W = worldSizeRef.current;
    const device: ArcadeDeviceKey = window.matchMedia(ARCADE_MOBILE_QUERY).matches
      ? "mobile"
      : "desktop";

    const { cam: base, off: baseOff } = readCamera(worldEl);
    const sr = stage.getBoundingClientRect();
    const worldPxW = worldEl.offsetWidth;

    // Sharpness guard: never zoom the machine art past its drawn pixels.
    let maxScale: number | undefined;
    if (a.guards.sharpness) {
      const p = machinePlacement(a, device);
      const machinePx = (p.w / 100) * worldPxW;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const v = machineVariant(a, device);
      maxScale = Math.min(
        v.back ? maxSharpScale(v.back.naturalW, machinePx, dpr, v.back.url) : Infinity,
        v.front ? maxSharpScale(v.front.naturalW, machinePx, dpr, v.front.url) : Infinity
      );
    }

    const playOpts = {
      arcade: a,
      device,
      world: W,
      worldPxW,
      stageCentre: { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 },
      viewport: {
        w: document.documentElement.clientWidth || window.innerWidth,
        h: window.innerHeight,
      },
    };
    // The sharpness cap trims how far IN the click-in goes, but playability
    // wins over crispness: never below the current zoom, and never below 60%
    // of the full fit (tiny art would otherwise leave a postage-stamp game).
    const full = playCamera(playOpts).cam.scale;
    const { cam: play, off: playOff } = playCamera({
      ...playOpts,
      maxScale:
        maxScale === undefined ? undefined : Math.max(maxScale, base.scale, full * 0.6),
    });
    camRef.current = { base, baseOff, play, playOff };
    return true;
  };

  // ── Zoom visual writer (shared by drain machine, tweens, snaps) ──
  //
  // One canonical virtual scale (ZOOM_DEPTH = fully zoomed in, 1 = rest)
  // drives the camera blend. Also mirrors --exit-progress for the
  // chrome/vignette fades and keeps lastScaleRef fresh for the rAF hot path.
  const applyZoomVisual = useCallback((scale: number) => {
    const worldEl = worldRef.current;
    const cams = camRef.current;
    if (!worldEl || !cams) return;

    const tgt = zoomTargetRef.current;
    const t = tgt.scale > 1 ? (scale - 1) / (tgt.scale - 1) : 0; // 1 = zoomed
    applyCamera(
      worldEl,
      mixCamera(cams.base, cams.play, t),
      mixOffset(cams.baseOff, cams.playOff, t)
    );
    lastScaleRef.current = scale;
    setExitProgress(1 - t);
  }, []);

  // ── Release: detach hijack + restore scroll + reset state ───
  // (Declared BEFORE attachHijack so the latter can include it in deps
  // without hitting a TDZ error.)
  const releaseHijack = useCallback(() => {
    if (hijackCleanup.current) {
      hijackCleanup.current();
      hijackCleanup.current = null;
    }
    // Reset the drain machine.
    drainStateRef.current = "idle";
    pendingDeltaRef.current = 0;
    samplesRef.current = [];
    lastScaleRef.current = null;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    unlockBodyScroll();
    // The camera is back on BASE — exactly what the scroll keyframes had
    // it at (or the rest camera), so re-enabling them can't jump.
    setScrollTriggersEnabled(true);
    const lenis = (window as unknown as { __lenis__?: Lenis }).__lenis__;
    lenis?.start();
    // Sync the DOM attribute BEFORE React commits the store update, so
    // mode-keyed CSS (CTA, scene links) flips in the same frame.
    if (stageRef.current) stageRef.current.dataset.mode = "scroll";
    setMode("scroll");
    worldRef.current?.classList.remove("is-moving");

    EventBridge.emit(EVENTS.UI_MODAL, false);
    EventBridge.emit(EVENTS.PLAY_MODE_EXIT);

    // Keyboard players: hand focus back to the play control they started
    // from (the ✕ that held it is about to become inert).
    // Deferred: the control is re-enabled by the mode re-render first.
    if (keyboardEntryRef.current) {
      keyboardEntryRef.current = false;
      setTimeout(() => {
        stageRef.current
          ?.querySelector<HTMLButtonElement>(".cabinet-stage__cta")
          ?.focus({ preventScroll: true });
      }, 60);
    }

    // Order matters: reset progress only after the mode flip — in scroll
    // mode the vignette/chrome no longer read the calc() rules, so
    // zeroing it here can't cause a one-frame flash.
    setExitDrainingAttr(false);
    setExitProgress(0);

    getGameInstance()?.scale.refresh();
  }, [setMode]);

  // ── Scroll-hijack listener (wheel + touch) ──────────────────
  //
  // State machine: idle → draining (gesture active, raw input maps to
  // zoom per rAF) → settling (gesture stopped, GSAP tween carries the
  // camera to the nearest endpoint). A new gesture during settling
  // kills the tween and resumes draining — the user always wins.
  const attachHijack = useCallback(() => {
    if (!stageRef.current) return;

    let touchStartY: number | null = null;

    // The camera is at full zoom when the hijack attaches — seed the
    // cache so the hot path never needs a style read.
    lastScaleRef.current = zoomTargetRef.current.scale;

    const progressFromScale = (scale: number) => {
      const tgt = zoomTargetRef.current;
      if (tgt.scale <= 1) return 1;
      return 1 - (scale - 1) / (tgt.scale - 1);
    };

    const markMoving = (on: boolean) =>
      worldRef.current?.classList.toggle("is-moving", on);

    // Apply the accumulated wheel/touch delta. Runs at most once per
    // frame (rAF-coalesced) — input events fire faster than frames.
    const flushPendingDelta = () => {
      rafIdRef.current = null;
      const dec = pendingDeltaRef.current;
      pendingDeltaRef.current = 0;
      if (dec <= 0) return;

      // Kill any in-flight settle tween BEFORE writing — its per-frame
      // writes would overrule the user's input.
      if (activeTweenRef.current) {
        activeTweenRef.current.kill();
        activeTweenRef.current = null;
      }

      const tgt = zoomTargetRef.current;
      const cur = lastScaleRef.current ?? tgt.scale;
      if (cur <= 1 || tgt.scale <= 1) {
        releaseHijack();
        return;
      }

      drainStateRef.current = "draining";
      setExitDrainingAttr(true);
      markMoving(true);

      const nextScale = Math.max(1, cur - dec);
      applyZoomVisual(nextScale);

      const now = performance.now();
      const samples = samplesRef.current;
      samples.push({ t: now, p: progressFromScale(nextScale) });
      if (samples.length > 8) samples.shift();

      if (nextScale <= 1.0005) {
        applyZoomVisual(1);
        releaseHijack();
        return;
      }
      restartIdleTimer();
    };

    const scheduleFlush = () => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(flushPendingDelta);
    };

    const restartIdleTimer = () => {
      if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(settle, IDLE_SETTLE_MS);
    };

    /** Flick velocity in p/ms over the recent sample window. */
    const recentVelocity = () => {
      const now = performance.now();
      const samples = samplesRef.current.filter(
        (s) => now - s.t <= VELOCITY_WINDOW_MS
      );
      if (samples.length < 2) return 0;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      return dt > 0 ? (last.p - first.p) / dt : 0;
    };

    // Gesture stopped — tween to the nearest endpoint. Progress past the
    // commit threshold (or a fast flick) completes the exit; anything
    // less springs back to full zoom. Never leaves the camera mid-zoom.
    const settle = () => {
      if (drainStateRef.current !== "draining") return;
      idleTimerRef.current = null;

      const tgt = zoomTargetRef.current;
      const cur = lastScaleRef.current ?? tgt.scale;
      const p = progressFromScale(cur);
      const commit = p >= EXIT_COMMIT_THRESHOLD || recentVelocity() >= FLICK_VELOCITY;

      drainStateRef.current = "settling";
      samplesRef.current = [];

      const proxy = { scale: cur };
      activeTweenRef.current = gsap.to(proxy, {
        scale: commit ? 1 : tgt.scale,
        duration: commit ? SETTLE_EXIT_DUR : SETTLE_RETURN_DUR,
        ease: "power2.out",
        onUpdate: () => applyZoomVisual(proxy.scale),
        onComplete: () => {
          activeTweenRef.current = null;
          if (commit) {
            releaseHijack();
          } else {
            drainStateRef.current = "idle";
            markMoving(false);
            setExitProgress(0);
            setExitDrainingAttr(false);
          }
        },
      });
    };

    // Reduced motion: no drain choreography — the first exit gesture
    // snaps to rest and releases, mirroring enterPlay's snap-in path.
    // Read from the store at event time so a mid-session OS toggle
    // (wired via the matchMedia change listener) takes effect.
    const reducedMotionSnapExit = () => {
      activeTweenRef.current?.kill();
      activeTweenRef.current = null;
      applyZoomVisual(1);
      releaseHijack();
    };

    const onWheel = (e: WheelEvent) => {
      // Pass through when a game-internal modal is open. Otherwise the
      // visitor gets stuck — every wheel-down would drain the zoom
      // behind the modal instead of scrolling the modal naturally.
      if (useLandingStore.getState().isGameModalOpen) return;
      // Upward wheel during zoom: ignore (one-directional for clarity).
      if (e.deltaY <= 0) return;
      e.preventDefault();
      if (useLandingStore.getState().isReducedMotion) {
        reducedMotionSnapExit();
        return;
      }
      pendingDeltaRef.current += e.deltaY * WHEEL_TO_SCALE;
      scheduleFlush();
    };

    const onTouchStart = (e: TouchEvent) => {
      // Same modal guard: don't capture touch starts that belong to
      // the modal's gesture (scrolling its inner content, etc.).
      if (useLandingStore.getState().isGameModalOpen) return;
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (useLandingStore.getState().isGameModalOpen) return;
      if (touchStartY == null) return;
      // preventDefault ALL moves while the hijack is attached — an
      // unhandled downward swipe would reach the browser and can start
      // pull-to-refresh / overscroll glow mid-game.
      e.preventDefault();
      const y = e.touches[0]?.clientY ?? touchStartY;
      const delta = touchStartY - y; // positive = swipe up = exit gesture
      // Continuous drag: measure each move from the previous position.
      touchStartY = y;
      if (delta <= 0) return;
      if (useLandingStore.getState().isReducedMotion) {
        reducedMotionSnapExit();
        return;
      }
      pendingDeltaRef.current += delta * TOUCH_TO_SCALE;
      scheduleFlush();
    };
    const onTouchEnd = () => {
      touchStartY = null;
      // Fingers commit on lift — no idle wait like the wheel.
      if (drainStateRef.current === "draining") {
        if (idleTimerRef.current !== null) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        settle();
      }
    };

    // `passive: false` is required for preventDefault on wheel/touchmove.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    hijackCleanup.current = () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [releaseHijack, applyZoomVisual]);

  // ── Click ripple effect ─────────────────────────────────────
  // Spawn a brief expanding circle at (clientX, clientY) of the CTA
  // click. Confirms the gesture before the dolly-in begins; visible only
  // for ~600ms and self-removes via animationend.
  const spawnClickRipple = (clientX: number, clientY: number) => {
    if (typeof document === "undefined") return;
    const ripple = document.createElement("span");
    ripple.className = "cabinet-stage__click-ripple";
    ripple.style.left = `${clientX}px`;
    ripple.style.top = `${clientY}px`;
    ripple.addEventListener("animationend", () => ripple.remove(), {
      once: true,
    });
    document.body.appendChild(ripple);
    // Safety remove in case animationend doesn't fire.
    setTimeout(() => ripple.remove(), 1000);
  };

  // ── Click-to-zoom-in ────────────────────────────────────────
  const enterPlay = useCallback((clientX?: number, clientY?: number) => {
    if (!stageRef.current || !worldRef.current) return;
    // Ignore clicks mid-transition / while already playing.
    if (useLandingStore.getState().mode !== "scroll") return;
    // Pressing Play is the one moment the game must be loading (no-op if warm).
    startGameWarmup();

    // Premium cue: ripple at the click point.
    if (
      !isReducedMotion &&
      typeof clientX === "number" &&
      typeof clientY === "number"
    ) {
      spawnClickRipple(clientX, clientY);
    }

    // The game must be awake in play mode no matter what the hero
    // IntersectionObserver last decided (it stops updating once the
    // body is scroll-locked).
    setSleepReason("hero-offscreen", false);

    // Fresh entry — chrome/vignette start fully engaged (progress 0).
    // Must happen before the mode flips so the calc() opacity rules
    // don't briefly read a stale 1 from the previous exit.
    setExitProgress(0);
    setExitDrainingAttr(false);

    // Freeze the scroll keyframes FIRST (sync) so the lock below can't
    // drive them. The camera they left behind is BASE; releaseHijack
    // re-enables them.
    setScrollTriggersEnabled(false);

    // Stop smooth scroll + lock body so the page doesn't scroll during
    // the dolly-in tween. The scrolled position is stashed and restored
    // verbatim when the hijack releases (or X tween completes).
    const lenis = (window as unknown as { __lenis__?: Lenis }).__lenis__;
    lenis?.stop();
    lockBodyScroll();

    // Measure AFTER the lock: it keeps the page visually in place but drops
    // the scrollbar, which re-centres the layout by half its width — measured
    // before, the zoomed screen landed that far off-centre.
    if (!computeDolly()) {
      unlockBodyScroll();
      lenis?.start();
      setScrollTriggersEnabled(true);
      return;
    }


    // Freeze Phaser input during the tween — getBoundingClientRect can
    // desync the click-coord math while the parent transform is animating.
    // (Belt-and-braces: the actual fix for the phantom-click bug is
    // BaseRoomScene's isPointerOnCanvas check, since UI_MODAL reacts to
    // `click` which always fires after the `pointerup` Phaser listens on —
    // see BaseRoomScene.ts for the full explanation. This freeze still
    // matters for input that arrives *during* the zoom tween itself.)
    EventBridge.emit(EVENTS.UI_MODAL, true);

    zoomTargetRef.current = { scale: ZOOM_DEPTH };
    if (stageRef.current) stageRef.current.dataset.mode = "transitioning-in";
    setMode("transitioning-in");

    const device: ArcadeDeviceKey = window.matchMedia(ARCADE_MOBILE_QUERY).matches
      ? "mobile"
      : "desktop";
    const play = arcadeRef.current[device].play;

    if (isReducedMotion) {
      applyZoomVisual(ZOOM_DEPTH);
      onZoomInComplete();
    } else {
      worldRef.current.classList.add("is-moving");
      // Per-frame progress writes during the tween — let the vignette
      // fade track the zoom raw instead of chasing via transition.
      setExitDrainingAttr(true);
      const proxy = { scale: 1 };
      // Kill any prior tween (e.g. an in-flight exit) before starting.
      activeTweenRef.current?.kill();
      activeTweenRef.current = gsap.to(proxy, {
        scale: ZOOM_DEPTH,
        duration: play.duration,
        ease: play.ease,
        onUpdate: () => applyZoomVisual(proxy.scale),
        onComplete: () => {
          activeTweenRef.current = null;
          setExitDrainingAttr(false);
          onZoomInComplete();
        },
      });
    }

    function onZoomInComplete() {
      // Keyboard players: the play control is now inert — move focus to ✕.
      if (keyboardEntryRef.current) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLButtonElement>(".cabinet-stage__close")?.focus({ preventScroll: true })
        );
      }
      // Demote the compositor layer so the settled zoom re-rasters crisp.
      worldRef.current?.classList.remove("is-moving");
      if (stageRef.current) stageRef.current.dataset.mode = "play";
      setMode("play");
      EventBridge.emit(EVENTS.UI_MODAL, false);
      EventBridge.emit(EVENTS.PLAY_MODE_ENTER);

      getGameInstance()?.scale.refresh();

      // Attach the wheel/touch hijack so the user can pull the camera
      // back by scrolling.
      attachHijack();

      // First-visit hint.
      if (!hasSeenExitHint) {
        setShowExitHint(true);
        setTimeout(() => {
          setShowExitHint(false);
          markExitHintSeen();
        }, 3500);
      }
    }
  }, [
    setMode,
    isReducedMotion,
    hasSeenExitHint,
    markExitHintSeen,
    attachHijack,
    applyZoomVisual,
    startGameWarmup,
  ]);

  // ── X button: explicit full exit ────────────────────────────
  const exitPlay = useCallback(() => {
    if (!stageRef.current) return;

    // Detach hijack first so it doesn't fight the exit tween.
    if (hijackCleanup.current) {
      hijackCleanup.current();
      hijackCleanup.current = null;
    }

    EventBridge.emit(EVENTS.UI_MODAL, true);

    if (isReducedMotion) {
      setMode("transitioning-out");
      applyZoomVisual(1);
      releaseHijack();
      return;
    }

    setMode("transitioning-out");
    // Per-frame progress writes during the tween — disable the discrete
    // chrome transitions so the fade tracks the zoom exactly.
    setExitDrainingAttr(true);
    worldRef.current?.classList.add("is-moving");
    const proxy = { scale: lastScaleRef.current ?? zoomTargetRef.current.scale };
    activeTweenRef.current?.kill();
    activeTweenRef.current = gsap.to(proxy, {
      scale: 1,
      duration: EXIT_DUR,
      ease: "power2.out",
      onUpdate: () => applyZoomVisual(proxy.scale),
      onComplete: () => {
        activeTweenRef.current = null;
        releaseHijack();
      },
    });
  }, [setMode, isReducedMotion, releaseHijack, applyZoomVisual]);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      if (hijackCleanup.current) {
        hijackCleanup.current();
        hijackCleanup.current = null;
      }
    },
    []
  );

  // ── Render ──────────────────────────────────────────────────
  const closeAttrs = chromeSlotAttrs(arcade.chrome.close, "close");
  return (
    <>
      <ArcadeScene
        arcade={arcade}
        world={world}
        assets={assets}
        language={language}
        mode={mode}
        stageRef={stageRef}
        worldRef={worldRef}
        screenRef={gameMountRef}
        // Phaser mounts in the screen. pointer-events flip with mode (CSS)
        // so the machine can be clicked through to the CTA in scroll mode.
        screen={
          gameWarm ? (
            <GameWrapper
              language={language}
              onLanguageChange={setLanguage}
              posterUrl={arcade.poster?.url}
              chrome={arcade.chrome}
            />
          ) : (
            // Same resting state the game boots from, painted before the game
            // chunk is even requested (see useGameWarmup).
            <div className="relative h-full w-full bg-[#2A2520]">
              <GameBootScreen visible posterUrl={arcade.poster?.url} />
            </div>
          )
        }
        // Click-to-play hit area over the screen — always rendered;
        // visibility toggled via CSS on the stage's data-mode attribute
        // (CSS-only toggle avoids React 19 + concurrent-render insertBefore
        // conflicts mid-tween, as seen during the original build).
        cta={
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // detail 0 = keyboard activation (Enter/Space): no pointer
              // position, so no ripple — and focus follows into play mode.
              const keyboard = e.detail === 0;
              keyboardEntryRef.current = keyboard;
              if (keyboard) enterPlay();
              else enterPlay(e.clientX, e.clientY);
            }}
            aria-label={language === "ar" ? "ابدأ اللعبة" : "Play the game"}
            className="cabinet-stage__cta focus-visible:outline-3 focus-visible:outline-offset-4"
            tabIndex={isPlayMode ? -1 : 0}
            aria-hidden={isPlayMode || undefined}
          />
        }
        // The whole machine is a (pointer-only) play target too — the
        // button above stays the one keyboard/AT control.
        onMachineClick={(e) => {
          if (useLandingStore.getState().mode === "scroll") enterPlay(e.clientX, e.clientY);
        }}
      />

      {/* Play-mode chrome (✕ + exit hint) lives in a document.body
          portal, NOT in the scene — the camera transform both scales
          descendants with the zoom (the "huge ✕" bug) and captures
          their position: fixed. The wrapper stays permanently mounted
          with a data-attribute visibility flip — conditional unmounts
          inside a GSAP-animated ancestor tree crash React 19
          reconciliation (insertBefore). */}
      {portalMounted &&
        createPortal(
          <div data-play-ui={isPlayMode ? "on" : "off"}>
            <button
              type="button"
              onClick={exitPlay}
              aria-label={language === "ar" ? "إغلاق اللعبة" : "Close game"}
              className="cabinet-stage__close chrome-slot"
              tabIndex={isPlayMode ? 0 : -1}
              aria-hidden={!isPlayMode || undefined}
              {...closeAttrs}
              style={{ ...closeAttrs.style }}
            >
              <ChromeArt skin={arcade.chrome.close} language={language}>
                <X size={18} strokeWidth={2.5} aria-hidden="true" />
              </ChromeArt>
            </button>

            <div
              className="cabinet-stage__exit-hint chrome-toast"
              data-visible={isPlayMode && showExitHint ? "true" : "false"}
              aria-hidden={!(isPlayMode && showExitHint) || undefined}
            >
              {(language === "ar"
                ? arcade.chrome.exitHint?.ar
                : arcade.chrome.exitHint?.en) ||
                (language === "ar" ? "اسحب للأسفل للخروج" : "Scroll down to pull back")}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
