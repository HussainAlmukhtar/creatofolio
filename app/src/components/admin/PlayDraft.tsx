"use client";

// Play the draft (/admin/play) — the owner walks the REAL game with their
// unpublished room drafts before publishing. Same production code path
// visitors get (PhaserGame + GameActionLayer), fed through GameHarnessContext
// with every live room, each drafted room replaced by its draft
// (lib/playDraft.ts).
//
// Read-only by construction: nothing here calls a write helper; the harness
// keeps once-only steps in memory (registry `harness`), the avatar is the seed
// default (no saved outfit is read or written) and the language toggle sets
// store state directly (no localStorage). The banner sits ABOVE the game in the
// page flow, so it never covers the game or its controls.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, RefreshCw } from "lucide-react";
import PhaserGame from "@/components/game/PhaserGame";
import { GameHarnessContext } from "@/components/game/gameHarness";
import { EventBridge, EVENTS } from "@/components/game/EventBridge";
import { GameActionLayer } from "@/components/game/GameActionLayer";
import { GAME_WIDTH, GAME_HEIGHT } from "@/components/game/gameDimensions";
import { fetchAvatarCatalog } from "@/lib/avatarAssetCache";
import { resolveEffectiveCatalog } from "@/data/avatarSeedCatalog";
import { buildDefaultAvatarConfig, type AvatarAsset, type AvatarConfig } from "@/data/avatarTypes";
import { withTimeout } from "@/lib/withTimeout";
import { loadPlayDraftData, type PlayDraftData } from "@/lib/playDraft";
import { useLandingStore } from "@/stores/landingStore";
import type { ObjectContent } from "@/data/contentTypes";

type Lang = "en" | "ar";

function queryOf(): { room: string | null; lang: Lang } {
  const q = new URLSearchParams(window.location.search);
  return { room: q.get("room"), lang: q.get("lang") === "ar" ? "ar" : "en" };
}

export default function PlayDraft() {
  const [initial] = useState(queryOf);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [data, setData] = useState<PlayDraftData | null>(null);
  const [loadError, setLoadError] = useState("");
  // Bumped on "Reload drafts": a new game boots with the fresh rooms.
  const [gameKey, setGameKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentRoom, setCurrentRoom] = useState(initial.room ?? "");
  const currentRoomRef = useRef(initial.room ?? "");
  const [uiOpen, setUiOpen] = useState(false);

  // Language: store state only (the pop-up blocks read it); never persisted.
  useEffect(() => {
    useLandingStore.setState({ language: lang });
  }, [lang]);

  // Rooms + drafts (GET only).
  useEffect(() => {
    let alive = true;
    loadPlayDraftData(initial.room)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setCurrentRoom(d.harness.startRoom);
        currentRoomRef.current = d.harness.startRoom;
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : "Couldn't read the rooms.");
      });
    return () => {
      alive = false;
    };
  }, [initial.room]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      // Stay in the room you're in.
      const d = await loadPlayDraftData(currentRoomRef.current);
      setData(d);
      setReady(false);
      setGameKey((k) => k + 1);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't reload the drafts.");
    } finally {
      setReloading(false);
    }
  }, []);

  // Seed wardrobe + the default outfit: no saved outfit is read or written.
  const [catalog, setCatalog] = useState<AvatarAsset[] | null>(null);
  useEffect(() => {
    let alive = true;
    void withTimeout(fetchAvatarCatalog(), 4000, []).then((fetched) => {
      if (alive) setCatalog(resolveEffectiveCatalog(fetched));
    });
    return () => {
      alive = false;
    };
  }, []);
  const avatar = useMemo<AvatarConfig | null>(() => (catalog ? buildDefaultAvatarConfig(catalog) : null), [catalog]);

  // Keep the picker + URL on the room the game is in.
  useEffect(() => {
    const onRoom = (id: unknown) => {
      if (typeof id !== "string") return;
      currentRoomRef.current = id;
      setCurrentRoom(id);
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("room", id);
        window.history.replaceState(window.history.state, "", u);
      } catch {
        // The URL is a convenience only.
      }
    };
    EventBridge.on(EVENTS.ROOM_CHANGED, onRoom);
    return () => EventBridge.off(EVENTS.ROOM_CHANGED, onRoom);
  }, []);

  // Freeze game input while a step's UI is open, as GameWrapper does.
  useEffect(() => {
    EventBridge.emit(EVENTS.UI_MODAL, uiOpen);
    return () => EventBridge.emit(EVENTS.UI_MODAL, false);
  }, [uiOpen]);

  // Pop-ups: a drafted room with a content map shows what Publish would make
  // live; everything else (undefined) reads the live rows like a visitor.
  const contentFor = useMemo(() => {
    const byRoom = data?.draftContent ?? {};
    return (roomId: string, objectId: string): ObjectContent | null | undefined => {
      const map = byRoom[roomId];
      return map ? (map[objectId] ?? null) : undefined;
    };
  }, [data]);

  // Fit the fixed 1520×960 canvas into the space below the banner.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 2 || h < 2) return;
      el.style.setProperty("--game-css-scale", String(Math.min(w / GAME_WIDTH, h / GAME_HEIGHT)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const goTo = (id: string) => {
    if (id && id !== currentRoomRef.current) EventBridge.emit(EVENTS.NAVIGATE_TO_ROOM, id);
  };

  const drafted = data?.rooms.filter((r) => r.hasDraft) ?? [];
  const canPlay = !!data && !!avatar;
  const editorHref = `/admin/editor${currentRoom ? `?room=${encodeURIComponent(currentRoom)}` : ""}`;

  const btn =
    "inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-700 disabled:opacity-50 touch:min-h-11 touch:px-3.5";

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100" data-testid="play-draft">
      <header
        className="shrink-0 border-b border-sky-900/60 bg-sky-950/60 px-3 py-2 text-sm"
        role="region"
        aria-label="Draft preview"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Eye className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
          <p className="min-w-0 flex-1 font-medium text-sky-100" data-testid="play-banner">
            Draft preview: visitors don&apos;t see these changes
          </p>
          <Link href={editorHref} className={btn}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to editor
          </Link>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-sky-200">
            <span className="sr-only sm:not-sr-only">Room</span>
            <select
              value={currentRoom}
              onChange={(e) => goTo(e.target.value)}
              disabled={!canPlay}
              aria-label="Room"
              className="max-w-[12rem] rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-100 touch:min-h-11 touch:text-base"
            >
              {(data?.rooms ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.hasDraft ? " (draft)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="inline-flex overflow-hidden rounded-md border border-neutral-700" role="group" aria-label="Language">
            {(["en", "ar"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1.5 text-xs touch:min-h-11 touch:px-3.5 ${lang === l ? "bg-sky-700 text-white" : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"}`}
              >
                {l === "en" ? "English" : "العربية"}
              </button>
            ))}
          </div>

          <button type="button" className={btn} onClick={() => void reload()} disabled={reloading} data-testid="play-reload">
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} aria-hidden="true" />
            Reload drafts
          </button>

          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto text-xs text-sky-200 [scrollbar-width:none]"
            data-testid="play-drafts"
          >
            {!data ? (
              <span className="text-sky-300/70">Reading the rooms…</span>
            ) : !data.draftsAvailable ? (
              <span className="text-amber-300">Drafts aren&apos;t set up on this site yet, so you&apos;re playing the live rooms.</span>
            ) : drafted.length === 0 ? (
              <span className="text-sky-300/80">No room has unpublished changes. You&apos;re playing the live rooms.</span>
            ) : (
              <>
                <span className="shrink-0 text-sky-300/80">Rooms with drafts:</span>
                {drafted.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => goTo(r.id)}
                    aria-current={r.id === currentRoom ? "true" : undefined}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium touch:min-h-11 touch:px-3.5 touch:text-xs ${
                      r.id === currentRoom ? "bg-sky-600 text-white" : "bg-sky-900/60 text-sky-100 hover:bg-sky-800"
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
        {loadError && <p className="mt-2 text-xs text-red-300" role="alert">{loadError}</p>}
      </header>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[#2A2520]"
        style={{ touchAction: "none" }}
        dir="ltr"
      >
        {canPlay ? (
          <GameHarnessContext.Provider value={data.harness}>
            <PhaserGame
              key={gameKey}
              avatarConfig={avatar}
              avatarCatalog={catalog!}
              language={lang}
              onReady={() => setReady(true)}
            />
          </GameHarnessContext.Provider>
        ) : null}
        {!ready && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-neutral-400">
            {loadError ? "" : "Loading the draft rooms…"}
          </p>
        )}
        <p className="pointer-events-none absolute inset-x-0 bottom-1 hidden text-center text-[11px] text-neutral-500 portrait:block sm:portrait:hidden">
          Rotate your phone for a bigger room.
        </p>
      </div>

      <GameActionLayer language={lang} contentFor={contentFor} onOpenChange={setUiOpen} />
    </div>
  );
}
