"use client";

// Pop-up lab (/admin/popup-lab) — the owner-only QA bench for visitor
// pop-ups. Everything renders through the REAL visitor components:
//
//   - "game" theme       → PopupModal, exactly what GameWrapper shows;
//   - landing themes     → LandingContentModal with a draft override, exactly
//                          what a landing button pop-up shows;
//   - Game harness       → the real Phaser game on an in-memory zz-test room
//                          (GameHarnessContext), pop-ups from fixtures; or on
//                          a COPY of the live rooms (read-only), with a log of
//                          every step that runs;
//   - Behaviour check    → every live object's click before vs after the
//                          "When clicked…" steps (room schema v6).
//
// Read-only by construction: fixtures live in memory, the live rows are read
// with the public loader, and nothing here calls a write helper. The
// language toggle sets store state directly (no localStorage write).

import { useEffect, useMemo, useState } from "react";
import { PopupModal } from "@/components/popup/PopupModal";
import type { PopupTheme } from "@/components/popup/popupTheme";
import LandingContentModal from "@/components/landing/LandingContentModal";
import { LandingContentOverrideContext } from "@/components/landing/LandingContentOverride";
import PhaserGame from "@/components/game/PhaserGame";
import { GameHarnessContext, type GameHarness } from "@/components/game/gameHarness";
import { EventBridge, EVENTS } from "@/components/game/EventBridge";
import { GameActionLayer } from "@/components/game/GameActionLayer";
import type { ActionStepLog } from "@/components/game/actionUi";
import { resetHarnessOnce } from "@/components/game/systems/onceFlags";
import { checkRooms, legacyMatrixRoom, type CheckRow } from "./behaviourCheck";
import { staticWorld } from "@/data/staticRooms";
import { getPublicAnonClient } from "@/lib/landingData";
import type { ObjectContent } from "@/data/contentTypes";
import { staticContent } from "@/data/staticContent";
import { resolveEffectiveCatalog } from "@/data/avatarSeedCatalog";
import { buildDefaultAvatarConfig } from "@/data/avatarTypes";
import { loadAllRoomConfigs, loadRoomContent } from "@/lib/gameData";
import { useLandingStore } from "@/stores/landingStore";
import { PopupProviders } from "@/components/popup/PopupProviders";
import { PopupStylesOverride } from "@/components/popup/PopupLook";
import { listPopupStyles, loadOwnerPreviewStyles, loadPublicPopupStyles, type PublicPopupStyles } from "@/lib/popupStyles";
import { HARNESS_CONTENT, LAB_FIXTURES, harnessActionsRoom, harnessRoom, makeBeepUrl } from "./popupLabFixtures";

type Item = { key: string; label: string; content: ObjectContent | null };

export default function PopupLab() {
  const language = useLandingStore((s) => s.language);
  const setLang = (l: "en" | "ar") => useLandingStore.setState({ language: l });
  const [theme, setTheme] = useState<PopupTheme>("game");
  const [open, setOpen] = useState<Item | null>(null);
  const [live, setLive] = useState<Item[]>([]);
  const [tab, setTab] = useState<"fixtures" | "harness" | "check">("fixtures");
  // Try a theme / frame from the style library (drafts included) on these
  // pop-ups and the game harness, for this tab only: nothing is activated.
  const [library, setLibrary] = useState<{ iid: string; kind: "theme" | "frame"; name: string }[]>([]);
  const [tryTheme, setTryTheme] = useState("live");
  const [tryFrame, setTryFrame] = useState("");
  // The loaded try-out styles, tagged with the choice they were loaded for.
  const [loadedLook, setLoadedLook] = useState<{ key: string; styles: PublicPopupStyles } | null>(null);
  const lookKey = `${tryTheme}|${tryFrame}`;
  const tryingSomething = tryTheme !== "live" || !!tryFrame;
  const override = tryingSomething && loadedLook?.key === lookKey ? loadedLook.styles : null;
  useEffect(() => {
    void listPopupStyles().then((r) => setLibrary(r.items.map((i) => ({ iid: i.iid, kind: i.kind, name: i.name || "Untitled" }))));
  }, []);
  useEffect(() => {
    if (!tryingSomething) return;
    let alive = true;
    void loadOwnerPreviewStyles(tryTheme === "live" || tryTheme === "none" ? null : tryTheme).then(async (s) => {
      // "live" + a frame: the published theme with a try-out frame.
      if (tryTheme === "live") {
        s = { ...s, theme: (await loadPublicPopupStyles()).theme };
      }
      if (alive) setLoadedLook({ key: lookKey, styles: s });
    });
    return () => {
      alive = false;
    };
  }, [tryTheme, tryingSomething, lookKey]);
  const withFrame = (c: ObjectContent | null): ObjectContent | null => (c && tryFrame ? { ...c, frameIid: tryFrame } : c);

  // The live home pop-ups, read through the visitor loader (GET only).
  useEffect(() => {
    loadRoomContent("home").then((map) =>
      setLive(Object.entries(map).map(([id, c]) => ({ key: `live:home:${id}`, label: `home:${id}`, content: c })))
    );
  }, []);

  const groups = useMemo(
    () => [
      { title: "Live (home room, read-only)", items: live },
      {
        title: "zz-test fixtures",
        items: LAB_FIXTURES.map((c) => ({ key: `fx:${c.objectId}`, label: c.objectId, content: c })),
      },
      {
        title: "Static seed (legacy v1 shapes)",
        items: Object.entries(staticContent).map(([k, c]) => ({ key: `seed:${k}`, label: k, content: c })),
      },
    ],
    [live]
  );

  return (
    // Forms destination for the Contact block (the lab isn't inside a landing page).
    <PopupProviders>
    <PopupStylesOverride.Provider value={override}>
    <main className="min-h-dvh bg-paper-0 p-6 text-ink">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl">Pop-up lab</h1>
        <span className="text-sm text-ink-faint">Read-only. Nothing here saves.</span>
        <div className="ms-auto flex flex-wrap gap-2" role="group" aria-label="Lab options">
          <Seg value={tab} onChange={setTab} options={[["fixtures", "Pop-ups"], ["harness", "Game harness"], ["check", "Behaviour check"]]} />
          <Seg value={language} onChange={setLang} options={[["en", "English"], ["ar", "العربية"]]} />
          <select
            value={tryTheme}
            onChange={(e) => setTryTheme(e.target.value)}
            aria-label="Try a theme"
            className="rounded-lg border border-line bg-paper-1 px-2 py-1.5 text-sm"
          >
            <option value="live">Look: what visitors see</option>
            <option value="none">Look: built-in (no theme)</option>
            {library
              .filter((i) => i.kind === "theme")
              .map((i) => (
                <option key={i.iid} value={i.iid}>
                  Try theme: {i.name} (draft)
                </option>
              ))}
          </select>
          {tab === "fixtures" && (
            <select
              value={tryFrame}
              onChange={(e) => setTryFrame(e.target.value)}
              aria-label="Try a frame"
              className="rounded-lg border border-line bg-paper-1 px-2 py-1.5 text-sm"
            >
              <option value="">Frame: as saved</option>
              {library
                .filter((i) => i.kind === "frame")
                .map((i) => (
                  <option key={i.iid} value={i.iid}>
                    Try frame: {i.name} (draft)
                  </option>
                ))}
            </select>
          )}
          {tab === "fixtures" && (
            <Seg
              value={theme}
              onChange={setTheme}
              options={[
                ["game", "Game"],
                ["landing-paper", "Landing paper"],
                ["landing-digital", "Landing digital"],
              ]}
            />
          )}
        </div>
      </header>

      {tab === "fixtures" ? (
        groups.map((g) => (
          <section key={g.title} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">{g.title}</h2>
            <ul className="flex flex-wrap gap-2">
              {g.items.map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    className="rounded-lg border border-line bg-paper-1 px-3 py-2 text-sm hover:bg-paper-2"
                    onClick={() => setOpen(it)}
                  >
                    {it.label}
                  </button>
                </li>
              ))}
              {!g.items.length && <li className="text-sm text-ink-faint">None.</li>}
            </ul>
          </section>
        ))
      ) : tab === "harness" ? (
        <Harness language={language} />
      ) : (
        <BehaviourCheck />
      )}

      {open && theme === "game" && (
        <PopupModal
          key={open.key}
          language={language}
          title={(language === "ar" ? open.content?.titleAr || open.content?.title : open.content?.title) ?? ""}
          content={withFrame(open.content)}
          theme="game"
          onClose={() => setOpen(null)}
        />
      )}
      {open && theme !== "game" && (
        <LandingContentOverrideContext.Provider value={open.content ? { [open.key]: withFrame(open.content)! } : {}}>
          <LandingContentModal
            key={open.key}
            pageSlug="zz-test-lab"
            assetIid={open.key}
            theme={theme}
            onClose={() => setOpen(null)}
          />
        </LandingContentOverrideContext.Provider>
      )}
    </main>
    </PopupStylesOverride.Provider>
    </PopupProviders>
  );
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-sm ${value === v ? "bg-ink text-paper-0" : "bg-paper-1 hover:bg-paper-2"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Game harness ───────────────────────────────────────────────

const HARNESS_WIDTH = 760;

type HarnessSource = "fixture" | "actions" | "live";

const SOURCE_NOTES: Record<HarnessSource, string> = {
  fixture: "The real game on an in-memory room (zz-test-lab). Board = every block, couch = a magazine (pages), plant = empty state, with “Step through pop-ups” on (arrows, ←/→). Doors lead nowhere here.",
  actions:
    "zz-test-actions: one object per kind of step. Board = sparkle, wait, pop-up · couch = link with “leave the site?” (once per visit) · plant = shows/hides the zz lamp · archive door = email · professional door = spin then door · stairs = go to a room · music box = sound · unsafe box = refused steps · chest = shop (inert) · mat (where you spawn) and sign = “walks near” · guide = a conversation with answers, then a jump.",
  live: "A COPY of every live room, in memory (read with the public loader; pop-ups load read-only). Doors work between rooms. Nothing is saved.",
};

function Harness({ language }: { language: "en" | "ar" }) {
  const [source, setSource] = useState<HarnessSource>("actions");
  const [live, setLive] = useState<GameHarness | null>(null);
  const [log, setLog] = useState<(ActionStepLog & { at: number })[]>([]);
  // A short beep for the music box (a blob: URL, nothing uploaded).
  const [beep] = useState(() => (typeof window === "undefined" ? "" : makeBeepUrl()));
  useEffect(() => () => URL.revokeObjectURL(beep), [beep]);

  const fixture = useMemo<GameHarness>(() => {
    const room = harnessRoom();
    return { roomConfigs: { [room.id]: room }, startRoom: room.id };
  }, []);
  const actions = useMemo<GameHarness>(() => {
    const room = harnessActionsRoom(beep);
    return { roomConfigs: { [room.id]: room }, startRoom: room.id };
  }, [beep]);
  useEffect(() => {
    if (source !== "live" || live) return;
    let alive = true;
    // GET only: the visitor loader (anon), then a deep copy.
    void loadAllRoomConfigs().then(({ roomConfigs, defaultRoomId }) => {
      if (alive) setLive({ roomConfigs: structuredClone(roomConfigs), startRoom: defaultRoomId });
    });
    return () => {
      alive = false;
    };
  }, [source, live]);
  const harness = source === "fixture" ? fixture : source === "actions" ? actions : live;

  // Seed wardrobe only: no saved outfit is read or written.
  const catalog = useMemo(() => resolveEffectiveCatalog([]), []);
  const avatar = useMemo(() => buildDefaultAvatarConfig(catalog)!, [catalog]);

  // Freeze game input while a step's UI is open, as GameWrapper does.
  const [uiOpen, setUiOpen] = useState(false);
  useEffect(() => {
    EventBridge.emit(EVENTS.UI_MODAL, uiOpen);
    return () => EventBridge.emit(EVENTS.UI_MODAL, false);
  }, [uiOpen]);

  useEffect(() => {
    const onStep = (data: unknown) => setLog((l) => [{ ...(data as ActionStepLog), at: Date.now() }, ...l].slice(0, 40));
    EventBridge.on(EVENTS.ACTION_STEP, onStep);
    return () => EventBridge.off(EVENTS.ACTION_STEP, onStep);
  }, []);

  // Fixture rooms: pop-ups from fixtures (unknown objects = empty state);
  // the live copy loads the real pop-ups read-only.
  const contentFor = useMemo(
    () => (source === "live" ? undefined : (_room: string, objectId: string) => HARNESS_CONTENT[objectId] ?? null),
    [source]
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Seg
          value={source}
          onChange={(v) => {
            setSource(v);
            setLog([]);
          }}
          options={[
            ["actions", "zz-test actions"],
            ["fixture", "zz-test pop-ups"],
            ["live", "Live rooms (copy)"],
          ]}
        />
        <button
          type="button"
          className="rounded-lg border border-line bg-paper-1 px-3 py-1.5 text-sm hover:bg-paper-2"
          onClick={() => {
            resetHarnessOnce();
            setLog([]);
          }}
        >
          Reset once-only steps
        </button>
      </div>
      <p className="mb-3 max-w-3xl text-sm text-ink-soft">{SOURCE_NOTES[source]}</p>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="overflow-hidden rounded-xl border border-line"
          style={
            {
              width: HARNESS_WIDTH,
              maxWidth: "100%",
              aspectRatio: "1520 / 960",
              "--game-css-scale": HARNESS_WIDTH / 1520,
            } as React.CSSProperties
          }
        >
          {harness ? (
            <GameHarnessContext.Provider value={harness}>
              <PhaserGame key={source} avatarConfig={avatar} avatarCatalog={catalog} language={language} />
            </GameHarnessContext.Provider>
          ) : (
            <p className="p-4 text-sm text-ink-faint">Loading the live rooms…</p>
          )}
        </div>
        <ol className="min-w-[16rem] max-w-sm flex-1 space-y-1 text-xs" aria-label="Steps run" data-testid="step-log">
          <li className="font-semibold uppercase tracking-wide text-ink-soft">Steps run (newest first)</li>
          {log.map((l, i) => (
            <li key={`${l.at}-${i}`} className="rounded border border-line bg-paper-1 px-2 py-1 font-mono">
              {l.trigger === "near" ? "near" : "click"} {l.roomId}:{l.objectId} → <b>{l.kind}</b>
              {l.detail ? ` ${l.detail}` : ""}
            </li>
          ))}
          {!log.length && <li className="text-ink-faint">Nothing yet: click an object.</li>}
        </ol>
      </div>
      <GameActionLayer language={language} contentFor={contentFor} onOpenChange={setUiOpen} />
    </section>
  );
}

// ─── Behaviour check ──────────────────────────────────

function BehaviourCheck() {
  const [rows, setRows] = useState<{ title: string; rows: CheckRow[] }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      // The RAW live rows (read-only GET, before any migration), compared
      // with what the new runtime does after room schema v6.
      const client = getPublicAnonClient();
      const raw: Record<string, unknown> = {};
      if (client) {
        const { data, error: e } = await client.from("rooms").select("id, config");
        if (e) setError(e.message);
        for (const r of data ?? []) raw[r.id as string] = r.config;
      }
      const seed: Record<string, unknown> = structuredClone(staticWorld.rooms);
      if (!alive) return;
      setRows([
        { title: `Live rooms (${Object.keys(raw).length}, raw rows)`, rows: checkRooms(raw) },
        { title: "Static seed", rows: checkRooms(seed) },
        { title: "Every legacy shape (kind × interaction × URL)", rows: checkRooms(legacyMatrixRoom()) },
      ]);
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <p className="text-sm text-red-700">Couldn&apos;t read the live rooms: {error}</p>;
  if (!rows) return <p className="text-sm text-ink-faint">Reading the live rooms…</p>;
  return (
    <div className="space-y-6" data-testid="behaviour-check">
      {rows.map((g) => {
        const same = g.rows.filter((r) => r.same).length;
        return (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              {g.title}: {same}/{g.rows.length} behave the same {same === g.rows.length ? "✓" : "✗"}
            </h2>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-paper-1">
                  <tr>
                    {["Room", "Object", "Kind", "Legacy fields", "Before", "After (steps)", "Hover", "Same"].map((h) => (
                      <th key={h} className="px-2 py-1.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={`${r.room}:${r.object}`} className={`border-t border-line ${r.same ? "" : "bg-red-50"}`}>
                      <td className="px-2 py-1">{r.room}</td>
                      <td className="px-2 py-1 font-mono">{r.object}</td>
                      <td className="px-2 py-1">{r.kind}</td>
                      <td className="px-2 py-1 font-mono">{r.legacy}</td>
                      <td className="px-2 py-1">{r.before}</td>
                      <td className="px-2 py-1">{r.after}</td>
                      <td className="px-2 py-1">{r.hoverSame ? "same" : "differs"}</td>
                      <td className="px-2 py-1">{r.same ? "✓" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
