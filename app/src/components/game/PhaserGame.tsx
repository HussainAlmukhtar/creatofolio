"use client";

// PhaserGame — mounts a Phaser.Game instance into a DOM element.
//
// This component handles:
//  - Hydrating room configs from Supabase BEFORE Phaser boots (so the
//    static seed only shows when Supabase is unreachable)
//  - Creating the Phaser game with all room scenes registered
//  - Responsive scaling: fixed 1520×960 design, scales to fit container
//  - Cleanup on unmount
//
// Must be dynamically imported with ssr: false in Next.js.

import { useContext, useEffect, useRef } from "react";
import Phaser from "phaser";
import type { AvatarConfig, AvatarAsset } from "@/data/avatarTypes";
import { loadAllRoomConfigs, LOAD_ALL_ROOMS_TIMEOUT_MS, type GameBootData } from "@/lib/gameData";
import { fetchAvatarCatalog } from "@/lib/avatarAssetCache";
import { resolveEffectiveCatalog } from "@/data/avatarSeedCatalog";
import { withTimeout } from "@/lib/withTimeout";
import { staticWorld } from "@/data/staticRooms";
import { setGameInstance, setSleepReason } from "./gameHandle";
import { GameHarnessContext } from "./gameHarness";

// Scenes are no longer hardcoded here. Only
// BootScene is registered up-front; it iterates the loaded room configs
// in the registry and adds one DynamicRoomScene per room. Adding a room
// in the editor → renders at runtime with no code change.
import BootScene from "./scenes/BootScene";
import { GAME_WIDTH, GAME_HEIGHT, GAME_ASPECT } from "./gameDimensions";

// Hi-DPI over-sample factor for the WebGL backing store, so the canvas
// still reads crisply when the cabinet zoom CSS-scales it up. Computed
// at game-boot time (not module scope) so it reads the DPR of the
// monitor the page actually opened on.
//
// Budget = the largest CSS size the canvas is ever DISPLAYED at, times
// the device pixel ratio, plus 15% headroom:
//   desktop play zoom — canvas width tops out at min(85vw, 60vh × aspect)
//     (these 0.85 / 0.6 factors mirror computeZoomState in
//     CabinetStage.tsx — change them together);
//   mobile breakout   — the canvas fills the viewport in either
//     orientation, so budget for the longer edge.
// Caps unchanged (2× touch / 3× desktop ≈ 50MB worst case): phone GPUs
// can't afford more, and past 3× the gain is invisible.
function computeHiDpiScale(): number {
  const dpr = window.devicePixelRatio || 1;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cap = coarse ? 2 : 3;
  const maxCssWidth = coarse
    ? Math.max(window.innerWidth, window.innerHeight)
    : // The arcade's click-in can fill up to ~95% of the view (Arcade
      // Studio → "Screen fills"); budget for the largest it can be.
      Math.min(window.innerWidth * 0.95, window.innerHeight * 0.95 * GAME_ASPECT);
  const needed = (maxCssWidth * dpr) / GAME_WIDTH;
  return Math.min(cap, Math.max(1, needed * 1.15));
}

interface PhaserGameProps {
  avatarConfig: AvatarConfig;
  avatarCatalog: AvatarAsset[];
  language: "en" | "ar";
  /** Fired once the game instance is created and the boot scene has been
   *  started — GameWrapper fades its boot-screen overlay on this. */
  onReady?: () => void;
}

export default function PhaserGameComponent({
  avatarConfig,
  avatarCatalog,
  language,
  onReady,
}: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // Latest-callback ref so the mount effect (deps: []) never sees a stale
  // onReady prop.
  // Only the owner-only pop-up lab and Play the draft provide this (see gameHarness.ts).
  const harness = useContext(GameHarnessContext);
  const harnessRef = useRef(harness);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    // Track cancellation across the async boundary. If the component
    // unmounts mid-fetch (route change, Strict-Mode double-invoke, etc.)
    // we must not call `new Phaser.Game(...)` after cleanup has already run.
    let cancelled = false;

    (async () => {
      // Pull the latest room configs from Supabase BEFORE instantiating
      // Phaser. The function falls back to staticRooms on network failure,
      // so the game always boots with something — but when Supabase is
      // reachable, edits made in the admin editor (backgrounds, sprites,
      // objects, walkable areas) immediately take effect here.
      //
      // Avatar catalog is freshened once per game boot. The runtime
      // catalog passed in via props (used for the initial config resolve)
      // may be slightly stale by the time Phaser is up; refetching here
      // costs one extra query but keeps the in-game wardrobe in sync.
      // Both fetches are timeout-capped so a hung Supabase can't block
      // the boot forever — the static rooms / prop catalog take over.
      // loadAllRoomConfigs budgets its own steps (rooms vs. the optional
      // world-file overlay) so a slow extra can't discard loaded rooms;
      // the cap here is only a backstop above those budgets.
      const h = harnessRef.current;
      const [boot, freshCatalog] = await Promise.all([
        h
          ? Promise.resolve({
              roomConfigs: h.roomConfigs,
              defaultRoomId: h.startRoom,
              roomNameTags: h.roomNameTags,
            } as GameBootData)
          : withTimeout(loadAllRoomConfigs(), LOAD_ALL_ROOMS_TIMEOUT_MS, {
              roomConfigs: { ...staticWorld.rooms },
              defaultRoomId: "home",
            }),
        withTimeout(fetchAvatarCatalog(), 4000, avatarCatalog),
      ]);
      const { roomConfigs, defaultRoomId } = boot;
      if (cancelled || !containerRef.current) return;

      const hiDpiScale = computeHiDpiScale();

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        // Backing-store dimensions, multiplied by hiDpiScale so the
        // canvas's WebGL buffer is dense enough to stay crisp when the
        // cabinet zoom CSS-scales it up. Game logic still runs in the
        // logical 1520×960 space because of the inverse `zoom` below.
        width: GAME_WIDTH * hiDpiScale,
        height: GAME_HEIGHT * hiDpiScale,
        parent: containerRef.current,
        backgroundColor: "#2A2520",
        // Scale.NONE + zoom = 1 / hiDpiScale: Phaser doesn't touch the
        // canvas size at runtime; `zoom` makes the displayed canvas
        // shrink back to logical 1520×960 CSS pixels (so it fits the
        // cabinet's screen rect div), while the backing store stays at
        // (1520 × hiDpiScale) wide for crispness. This is the modern
        // replacement for the deprecated `resolution` config option
        // (canonical pattern, ~community consensus 2025). When the
        // cabinet then CSS-scales the canvas up to ~2.5×, the effective
        // backing-pixel-per-display-pixel ratio is hiDpiScale / 2.5
        // ≈ 0.9 on a 2× DPR display — close to crisp.
        scale: {
          mode: Phaser.Scale.NONE,
          zoom: 1 / hiDpiScale,
        },
        scene: [BootScene],
        // No physics engine needed — we use point-in-polygon for collision
        physics: {
          default: "arcade",
          arcade: { debug: false, gravity: { x: 0, y: 0 } },
        },
        // Crisp scaling: roundPixels avoids sub-pixel artefacts when the
        // canvas is CSS-scaled by GSAP. antialias stays on since the game
        // isn't pixel-art aesthetic.
        render: {
          pixelArt: false,
          antialias: true,
          roundPixels: true,
        },
        input: {
          touch: true,
        },
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

      // Register with the prod-safe handle — the landing page's
      // sleep/wake + scale.refresh consumers read the instance from
      // gameHandle, never from a window global.
      setGameInstance(game);

      // Dev-mode global so the running game is reachable from devtools.
      // Tree-shaken out of production bundles by the env check.
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __creatofolioGame__?: Phaser.Game }).__creatofolioGame__ =
          game;
      }

      // Store language + live room configs + avatar catalog in the Phaser
      // registry. Scenes read these in create(): roomConfigs hot-overrides
      // each scene's static default, and avatarCatalog is consumed by
      // AvatarTexture.registerAvatarTexture() to know which PNGs to layer.
      // The effective catalog merges the seed wardrobe when the fresh
      // fetch can't cover a full outfit — a PARTIAL catalog must still
      // keep the seed entries the visitor's config may reference.
      game.registry.set("language", language);
      game.registry.set("roomConfigs", roomConfigs);
      game.registry.set("avatarCatalog", resolveEffectiveCatalog(freshCatalog));
      // The lab harness keeps once-only flags in memory (no visitor storage).
      game.registry.set("harness", !!h);
      // The live world's "show room name tags" default (rooms can override).
      game.registry.set("roomNameTags", boot.roomNameTags !== false);

      // Start BootScene with the avatar config and configured default room
      game.scene.start("BootScene", { avatarConfig, startRoom: defaultRoomId });

      onReadyRef.current?.();
    })();

    // Sleep the loop while the tab is hidden. Phaser's own rAF already
    // throttles in background tabs, but an explicit sleep also stops
    // timers/tweens from accumulating and composes with the landing
    // page's hero-offscreen reason via gameHandle.
    const onVisibilityChange = () =>
      setSleepReason("tab-hidden", document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      setSleepReason("tab-hidden", false);
      if (gameRef.current) {
        setGameInstance(null);
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
    // Only run on mount/unmount — avatarConfig and language changes
    // are handled via EventBridge, not by recreating the game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync language changes into Phaser registry
  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.registry.set("language", language);
    }
  }, [language]);

  // Phaser mounts a canvas inside containerRef at exactly GAME_WIDTH ×
  // GAME_HEIGHT (Scale.NONE). The wrapper outside us sets `--game-css-scale`
  // via a ResizeObserver so this fixed-size box visually fits whatever
  // space is available. `transform-origin: center` keeps the canvas centred
  // even if the parent is larger than 1520×960 × scale.
  return (
    <div className="game-mount-outer">
      {/* No loading UI in here — this box lives in 1520×960 design
          space scaled by --game-css-scale, so rem-sized text would
          render microscopic. GameWrapper's boot-screen overlay (screen-
          rect scale) covers the entire hydration window instead. */}
      <div
        ref={containerRef}
        className="game-mount-inner"
        style={{
          width: `${GAME_WIDTH}px`,
          height: `${GAME_HEIGHT}px`,
          position: "relative",
          transform: "scale(var(--game-css-scale, 1))",
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
