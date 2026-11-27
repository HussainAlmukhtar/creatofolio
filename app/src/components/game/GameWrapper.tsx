"use client";

// GameWrapper — replaces GameWorld.tsx.
//
// Manages:
//  - Loading the avatar catalog from Supabase (single source of truth for the
//    wardrobe) and resolving the visitor's saved or default config against it.
//  - Mounting the Phaser game (dynamic import, ssr: false)
//  - Object steps that need the page (pop-ups, links, dialogue) via
//    GameActionLayer
//  - HUD overlay (room name, mini-map, language toggle, avatar button)
//  - Interaction modal display
//  - Avatar creator modal

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import ChromeArt from "@/components/landing/ChromeArt";
import { chromeSlotAttrs, isDetached, type ArcadeChrome } from "@/data/chromeSkin";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Map as MapIcon, DoorOpen, Shirt } from "lucide-react";
import type { AvatarConfig, AvatarAsset } from "@/data/avatarTypes";
import { buildDefaultAvatarConfig } from "@/data/avatarTypes";
import { loadAvatar, saveAvatar } from "@/lib/avatarStorage";
import { fetchAvatarCatalog } from "@/lib/avatarAssetCache";
import { resolveEffectiveCatalog } from "@/data/avatarSeedCatalog";
import { withTimeout } from "@/lib/withTimeout";
import AvatarCreator from "@/components/avatar/AvatarCreator";
import { EventBridge, EVENTS } from "./EventBridge";
import { staticWorld } from "@/data/staticRooms";
import type { RoomConfig, RoomId } from "@/data/roomTypes";
import { loadAllRoomConfigs, LOAD_ALL_ROOMS_TIMEOUT_MS } from "@/lib/gameData";
import { GameActionLayer } from "./GameActionLayer";
import GameBootScreen from "./GameBootScreen";
import { useLandingStore, selectIsPlayMode } from "@/stores/landingStore";

// Dynamic import — Phaser cannot run during SSR. No loading fallback:
// the persistent boot-screen overlay below covers every pre-ready state.
const PhaserGame = dynamic(() => import("./PhaserGame"), {
  ssr: false,
  loading: () => null,
});

interface GameWrapperProps {
  language: "en" | "ar";
  onLanguageChange: (lang: "en" | "ar") => void;
  /** Still image shown in the screen until the game has booted. */
  posterUrl?: string;
  /** Skins for the in-game controls + hint text (Arcade Studio). */
  chrome?: ArcadeChrome;
}

export default function GameWrapper({
  language,
  onLanguageChange,
  posterUrl,
  chrome,
}: GameWrapperProps) {
  // Avatar catalog + chosen config are gated together: PhaserGame is only
  // rendered once both are populated. This prevents an early render with
  // a synthetic-default config that points at asset IDs the catalog
  // doesn't know about.
  const [avatarCatalog, setAvatarCatalog] = useState<AvatarAsset[] | null>(
    null
  );
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig | null>(null);
  // Flipped by PhaserGame once the first scene has started — drives the
  // boot-screen overlay fade.
  const [gameReady, setGameReady] = useState(false);
  const [showAvatarCreator, setShowAvatarCreator] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState<RoomId>("home");
  // A step's UI is open (pop-up, link confirm, dialogue): GameActionLayer.
  const [actionOpen, setActionOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  // Loaded room map drives the minimap and current-room name lookup so
  // they stay in sync with whatever `loadAllRoomConfigs()` returns
  // (DB + external-file overlay). Fallback = static seed.
  const [roomConfigs, setRoomConfigs] = useState<Record<string, RoomConfig>>(
    () => ({ ...staticWorld.rooms })
  );
  // Live world's rooms (mini-map list). Undefined = show every room.
  const [worldRoomIds, setWorldRoomIds] = useState<string[] | undefined>();

  // One-shot: pull the catalog, then resolve the visitor's outfit
  // (saved in localStorage → otherwise derive the default from the
  // catalog). resolveEffectiveCatalog merges the seed wardrobe in when
  // the DB catalog can't cover a full outfit, and withTimeout caps a
  // hanging Supabase at 4s — so the game ALWAYS boots (the July 2026
  // DB pause bricked it at "Loading..." without these).
  useEffect(() => {
    let cancelled = false;
    withTimeout(fetchAvatarCatalog(), 4000, []).then((fetched) => {
      if (cancelled) return;
      const catalog = resolveEffectiveCatalog(fetched);
      setAvatarCatalog(catalog);

      // buildDefaultAvatarConfig is non-null by construction on the
      // effective catalog (seed items cover every required slot).
      const defaults = buildDefaultAvatarConfig(catalog)!;

      // A saved outfit whose body asset no longer exists in the catalog
      // would render an invisible avatar (the renderer skips missing
      // slots) — fall back to defaults instead.
      const saved = loadAvatar();
      const savedIsRenderable =
        saved && catalog.some((a) => a.id === saved.bodyAssetId);
      setAvatarConfig(savedIsRenderable ? saved : defaults);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load live room configs once on mount (PhaserGame loads them too;
  // the duplicate is cheap and keeps this React tree decoupled from
  // the Phaser registry). Timeout-capped: a hung fetch keeps the
  // static-seed rooms already in state.
  useEffect(() => {
    let cancelled = false;
    withTimeout(loadAllRoomConfigs(), LOAD_ALL_ROOMS_TIMEOUT_MS, {
      roomConfigs: { ...staticWorld.rooms },
      defaultRoomId: "home",
    }).then(({ roomConfigs: cfgs, worldRoomIds: ids }) => {
      if (cancelled) return;
      setRoomConfigs(cfgs);
      setWorldRoomIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Single source of truth for "a game-internal modal is open": one
  // effect fans the flag out to BOTH consumers — Phaser scenes freeze
  // input via EVENTS.UI_MODAL, and CabinetStage's wheel hijack defers
  // via landingStore.isGameModalOpen. (These used to be two hand-synced
  // effects; keeping them in one place removes the desync risk.)
  const modalOpen = showAvatarCreator || actionOpen;

  // Lets the stylesheet hide the game's close button while the creator is open.
  useEffect(() => {
    document.body.toggleAttribute("data-character-creator", showAvatarCreator);
    return () => document.body.removeAttribute("data-character-creator");
  }, [showAvatarCreator]);
  const setGameModalOpen = useLandingStore((s) => s.setGameModalOpen);
  useEffect(() => {
    EventBridge.emit(EVENTS.UI_MODAL, modalOpen);
    setGameModalOpen(modalOpen);
    return () => {
      // Release both signals on unmount so neither Phaser input nor the
      // wheel hijack stays frozen behind a modal that no longer exists.
      EventBridge.emit(EVENTS.UI_MODAL, false);
      setGameModalOpen(false);
    };
  }, [modalOpen, setGameModalOpen]);

  // Listen for Phaser events
  useEffect(() => {
    const onRoomChanged = (roomId: unknown) => {
      setCurrentRoomId(roomId as RoomId);
      // Walking through a door must not leave the room list hanging open.
      setShowMiniMap(false);
    };

    // A wardrobe rack (a "shop" step) opens the character creator.
    const onOpenCreator = () => setShowAvatarCreator(true);

    EventBridge.on(EVENTS.ROOM_CHANGED, onRoomChanged);
    EventBridge.on(EVENTS.OPEN_CHARACTER_CREATOR, onOpenCreator);

    return () => {
      EventBridge.off(EVENTS.ROOM_CHANGED, onRoomChanged);
      EventBridge.off(EVENTS.OPEN_CHARACTER_CREATOR, onOpenCreator);
    };
  }, []);

  const handleAvatarSave = useCallback((config: AvatarConfig) => {
    saveAvatar(config);
    setAvatarConfig(config);
    setShowAvatarCreator(false);
    EventBridge.emit(EVENTS.AVATAR_UPDATED, config);
  }, []);

  // The Map button, so closing the list (Esc, picking a room) hands focus
  // back to it instead of dropping it on <body> when the list unmounts.
  const mapButtonRef = useRef<HTMLButtonElement>(null);
  const closeMiniMap = useCallback((restoreFocus: boolean) => {
    setShowMiniMap(false);
    if (restoreFocus) mapButtonRef.current?.focus();
  }, []);
  const handleMiniMapNavigate = useCallback(
    (roomId: string) => {
      closeMiniMap(true);
      EventBridge.emit(EVENTS.NAVIGATE_TO_ROOM, roomId);
    },
    [closeMiniMap],
  );

  // Mini-map: only the live world's rooms.
  const mapRooms = useMemo(() => {
    if (!worldRoomIds) return roomConfigs;
    const out: Record<string, RoomConfig> = {};
    for (const id of worldRoomIds) if (roomConfigs[id]) out[id] = roomConfigs[id];
    return out;
  }, [roomConfigs, worldRoomIds]);
  const mapRoomCount = Object.keys(mapRooms).length;

  const currentRoom = useMemo(
    () => roomConfigs[currentRoomId] ?? staticWorld.rooms[currentRoomId],
    [roomConfigs, currentRoomId]
  );
  // Suppress unused-variable warning if currentRoom isn't read below; it's
  // kept for HUD extensions (room-name display, badges, etc.).
  void currentRoom;

  // HUD + controls-hint visibility is gated by landing mode: in scroll
  // mode the cabinet is a small preview and the HUD would clutter it; in
  // play mode (fullscreen takeover) the HUD becomes functional UI.
  //
  // The HUD wrapper is ALWAYS rendered and uses a data attribute that
  // CSS toggles visibility on — never conditionally unmounted. React 19
  // concurrent rendering plus GSAP tweens on an ancestor make
  // conditional unmount/remount throw `insertBefore: not a child of
  // this node`. Same fix applied elsewhere on the landing page.
  const isPlayMode = useLandingStore(selectIsPlayMode);
  const isTouchOnly = useLandingStore((s) => s.isTouchOnly);

  // REVISION 2: HUD lives in a Portal to document.body so it is NOT
  // inside the cabinet's transformed ancestor. CSS `transform` on the
  // `.cabinet-stage` wrapper creates a containing block that traps
  // `position: fixed` descendants — without the portal, the HUD would
  // scale with the cabinet's --play-scale and look huge in play mode.
  // The portal mounts to document.body which sits outside all transform
  // contexts, so HUD elements stay at true viewport coordinates.
  //
  // Mount the portal only on the client after first render to avoid
  // hydration mismatches (document.body is unavailable during SSR).
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => {
    // Canonical "did we hydrate yet" flag for portals — only after first
    // client render is `document.body` accessible.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal hydration probe
    setPortalMounted(true);
  }, []);

  // Skinnable in-game controls (Arcade Studio → Screen UI).
  const langSkin = chrome?.hudLanguage;
  const mapSkin = chrome?.map;
  // The two in-game buttons leave their row TOGETHER: one left behind would
  // re-centre alone and land on the other's default spot.
  const hudDetached = isDetached(langSkin) || isDetached(mapSkin);
  const langDetached = hudDetached;
  const mapDetached = hudDetached;
  const langAttrs = chromeSlotAttrs(langSkin, "hudLanguage", langDetached);
  const mapAttrs = chromeSlotAttrs(mapSkin, "map", mapDetached);
  const langButton = (
    <button
      onClick={() => onLanguageChange(language === "en" ? "ar" : "en")}
      // The HUD is invisible until play mode: keep it out of the tab order
      // and the accessibility tree until then.
      inert={!isPlayMode}
      className={`chrome-btn chrome-slot${langDetached ? " chrome-slot--hud" : ""}`}
      aria-label={language === "en" ? "Switch to Arabic" : "Switch to English"}
      {...langAttrs}
    >
      <ChromeArt skin={langSkin} language={language}>
        {language === "en" ? "العربية" : "English"}
      </ChromeArt>
    </button>
  );
  const mapControl = (
    <div
      className={`relative chrome-slot${mapDetached ? " chrome-slot--hud" : ""}`}
      {...mapAttrs}
      data-has-art={undefined}
    >
      <button
        ref={mapButtonRef}
        onClick={() => setShowMiniMap(!showMiniMap)}
        inert={!isPlayMode}
        className="chrome-btn chrome-slot"
        aria-label={language === "ar" ? "الخريطة" : "Map"}
        aria-expanded={showMiniMap}
        data-has-art={mapAttrs["data-has-art"]}
        style={mapAttrs.style}
      >
        <ChromeArt skin={mapSkin} language={language}>
          <MapIcon size={16} aria-hidden="true" />
          <span>{language === "ar" ? "الخريطة" : "Map"}</span>
        </ChromeArt>
      </button>

      {showMiniMap && (
        <MiniMapDropdown
          currentRoom={currentRoomId}
          language={language}
          roomConfigs={mapRooms}
          onNavigate={handleMiniMapNavigate}
          onClose={closeMiniMap}
        />
      )}
    </div>
  );

  const hudJsx = (
    // The wrapping div carries data-game-hud so the existing CSS
    // visibility rules (in globals.css `[data-game-hud="off"] .game-hud`)
    // still match. Without this wrapper the portal'd HUD would have no
    // ancestor carrying the attribute (the GameWrapper root that did
    // before is no longer a parent in the portal tree).
    <div
      // The HUD steps aside while the character creator is open, so its
      // buttons don't sit on top of the dialog.
      data-game-hud={isPlayMode && !showAvatarCreator ? "on" : "off"}
      // Once the game is open its controls are a landmark of their own (they
      // live in a portal outside <main>); at rest there is nothing to announce.
      role={isPlayMode ? "region" : undefined}
      aria-label={isPlayMode ? (language === "ar" ? "عناصر التحكم في اللعبة" : "Game controls") : undefined}
    >
      {/* HUD Overlay — top-right buttons. Always rendered into the
          portal so opacity transitions still apply when going from
          scroll → play; we don't conditionally mount/unmount. */}
      <div
        className="game-hud fixed flex gap-2 z-[60]"
        dir={language === "ar" ? "rtl" : "ltr"}
        inert={!isPlayMode}
      >
        {/* Character creator: shown once the wardrobe catalogue has loaded. */}
        {!hudDetached && avatarConfig && avatarCatalog && (
          <button
            onClick={() => setShowAvatarCreator(true)}
            inert={!isPlayMode}
            className="chrome-btn"
            aria-label={language === "ar" ? "غيّر شخصيتك" : "Change your character"}
          >
            <Shirt size={16} aria-hidden="true" />
            <span>{language === "ar" ? "الشخصية" : "Character"}</span>
          </button>
        )}

        {/* Controls with a custom position leave this row (a transformed
            row would capture their position:fixed) — rendered below. */}
        {!langDetached && langButton}

        {/* A one-room world is a room, not a map — hide the button. */}
        {mapRoomCount > 1 && !mapDetached && mapControl}
      </div>
      {langDetached && langButton}
      {mapRoomCount > 1 && mapDetached && mapControl}

      <div className="game-controls-hint chrome-toast" aria-hidden={isPlayMode ? undefined : true}>
        {(language === "ar" ? chrome?.controlsHint?.ar : chrome?.controlsHint?.en) ||
          (isTouchOnly
            ? language === "ar"
              ? "المس للمشي • المس الأشياء للتفاعل"
              : "Tap to walk • Tap objects to interact"
            : language === "ar"
              ? "انقر للمشي • انقر على الأشياء للتفاعل"
              : "Click to walk • Click objects to interact")}
      </div>

      {/* In-game modals live in the portal too — REVISION 3. The modals
          already use `position: fixed inset-0` styling, so they're
          designed to be viewport-relative. They just can't escape the
          cabinet's CSS-transform containing block when rendered inline.
          Portal'ing them to document.body lets the fixed positioning
          actually be viewport-relative. */}
      <GameActionLayer language={language} onOpenChange={setActionOpen} />

      {showAvatarCreator && avatarConfig && avatarCatalog && (
        <AvatarCreator
          initialConfig={avatarConfig}
          catalog={avatarCatalog}
          language={language}
          onSave={handleAvatarSave}
          onClose={() => setShowAvatarCreator(false)}
        />
      )}
    </div>
  );

  return (
    <div className="relative w-full h-full bg-[#2A2520]" data-game-hud={isPlayMode ? "on" : "off"}>
      {/* Phaser game canvas — gated on resolved avatar config + catalog
          (both guaranteed to resolve within the boot timeout thanks to
          the seed-catalog fallback). */}
      {avatarConfig && avatarCatalog && (
        <PhaserGame
          avatarConfig={avatarConfig}
          avatarCatalog={avatarCatalog}
          language={language}
          onReady={() => setGameReady(true)}
        />
      )}

      {/* Boot screen overlays the canvas until the first scene runs.
          Always mounted — visibility flips via the data attribute. */}
      <GameBootScreen visible={!gameReady} posterUrl={posterUrl} />

      {/* HUD + game-internal modals are rendered through a Portal to
          document.body to escape the cabinet's CSS-transform containing
          block. Without the portal, the modals would scale with the
          cabinet's --play-scale and look comically huge in play mode. */}
      {portalMounted && createPortal(hudJsx, document.body)}
    </div>
  );
}

// ─── Mini Map Dropdown ───────────────────────────────────────

function MiniMapDropdown({
  currentRoom,
  language,
  roomConfigs,
  onNavigate,
  onClose,
}: {
  currentRoom: RoomId;
  language: "en" | "ar";
  roomConfigs: Record<string, RoomConfig>;
  onNavigate: (roomId: string) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  // The minimap derives its room list from the loaded
  // configs instead of a hardcoded array. New rooms appear without code
  // changes. `config.minimapEmoji` is a data field kept for a later
  // CMS to read, but the UI renders a uniform lucide icon per the
  // no-emoji policy — not the per-room emoji string.
  const rooms = useMemo(
    () =>
      Object.values(roomConfigs)
        .map((r) => ({ id: r.id, name: r.name, nameAr: r.nameAr }))
        // Stable order: alphabetic by id keeps the dropdown predictable
        // as rooms are added/removed.
        .sort((a, b) => a.id.localeCompare(b.id)),
    [roomConfigs]
  );

  const ref = useRef<HTMLDivElement>(null);
  // On phones the HUD sits at the BOTTOM of the screen, so a list that always
  // opens below its button is entirely off-screen. Measure before paint and
  // open upward / nudge sideways when it wouldn't fit. (The button can also
  // be placed anywhere by the arcade's chrome skin, so this can't be a plain
  // media query.)
  const [placement, setPlacement] = useState<{ up: boolean; dx: number }>({ up: false, dx: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      // Measure the natural position: below the button, not shifted.
      const saved = { top: el.style.top, bottom: el.style.bottom, transform: el.style.transform, mt: el.style.marginTop, mb: el.style.marginBottom };
      el.style.top = "100%";
      el.style.bottom = "auto";
      el.style.marginTop = "0.5rem";
      el.style.marginBottom = "0";
      el.style.transform = "none";
      const r = el.getBoundingClientRect();
      el.style.top = saved.top;
      el.style.bottom = saved.bottom;
      el.style.transform = saved.transform;
      el.style.marginTop = saved.mt;
      el.style.marginBottom = saved.mb;
      const gap = 8;
      const spaceBelow = window.innerHeight - r.top;
      const up = r.height + gap > spaceBelow && r.top > spaceBelow;
      let dx = 0;
      if (r.right > window.innerWidth - gap) dx = window.innerWidth - gap - r.right;
      if (r.left + dx < gap) dx = gap - r.left;
      setPlacement((p) => (p.up === up && p.dx === dx ? p : { up, dx }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  // Esc and a click/tap anywhere else close it, like any other popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      const host = ref.current?.parentElement;
      if (t && host && host.contains(t)) return; // the Map button toggles it itself
      onClose(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label={language === "ar" ? "اذهب إلى" : "Go to"}
      className="kui-panel absolute z-50"
      style={{
        insetInlineEnd: 0,
        ...(placement.up
          ? { bottom: "100%", marginBottom: "0.5rem" }
          : { top: "100%", marginTop: "0.5rem" }),
        width: "min(19rem, calc(100vw - 1rem))",
        maxHeight: "min(24rem, calc(100dvh - 5rem))",
        overflowY: "auto",
        transform: placement.dx ? `translateX(${placement.dx}px)` : undefined,
      }}
    >
      <h3 className="font-semibold mb-2.5">
        {language === "ar" ? "اذهب إلى" : "Go to"}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {rooms.map(({ id, name, nameAr }) => {
          const isActive = id === currentRoom;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              aria-current={isActive ? "true" : undefined}
              className="kui-btn min-w-0 !justify-start text-start !whitespace-normal leading-tight"
              data-size="sm"
            >
              <DoorOpen size={14} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 break-words">{language === "ar" ? nameAr : name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
