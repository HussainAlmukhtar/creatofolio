"use client";

// /admin/loading-screen — edit the loading screen visitors see while the site
// loads ("Loading…"), before it opens onto the page.
//
//   header   back · title · on/off status · Save & go live
//   left     on/off · preset gallery (each card animating) · the preset's
//            drawings (Draw in Klecks over a guide / Upload / back to the
//            placeholder doodle) · words · look · progress · opening · when
//   right    live preview: desktop or phone, EN/AR, loop or play the whole
//            intro including the exit onto a stand-in page
//
// Stored in the site settings (SiteConfig.loader): like the rest of them it
// is live on save, with the usual "changed somewhere else" check
// (SiteConflictDialog). Visitors never see a half-edited screen: nothing
// reaches them before "Save & go live".

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Monitor, Play, Repeat, Rocket, Smartphone } from "lucide-react";
import {
  DEFAULT_LOADER,
  LOADER_EXITS,
  LOADER_PAPERS,
  LOADER_PRESETS,
  presetSpec,
  type LoaderConfig,
  type LoaderProgress,
  type LoaderSlot,
} from "@/data/loaderConfig";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { useBackSwipeGuard } from "@/lib/useBackSwipeGuard";
import { loaderGuide } from "@/lib/loaderGuides";
import { typographyVars } from "@/data/fonts";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { SiteConflictDialog } from "@/components/landing-editor/SiteConflictDialog";
import { ArtPicker } from "@/components/popup-styles/ArtPicker";
import SiteLoader from "@/components/landing/loader/SiteLoader";
import SiteFonts from "@/components/landing/SiteFonts";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type Lang = "en" | "ar";

export default function LoadingScreenEditor() {
  useOwnerSessionWatch();
  const isHydrated = useSiteConfigEditorStore((s) => s.isHydrated);
  const source = useSiteConfigEditorStore((s) => s.source);
  const isDirty = useSiteConfigEditorStore((s) => s.isDirty);
  const isSaving = useSiteConfigEditorStore((s) => s.isSaving);
  const stored = useSiteConfigEditorStore((s) => s.config.loader);
  const typography = useSiteConfigEditorStore((s) => s.config.typography);
  const config = stored ?? DEFAULT_LOADER;
  const update = useSiteConfigEditorStore((s) => s.updateLoader);
  const set = useCallback((patch: Partial<LoaderConfig>) => update((l) => ({ ...l, ...patch })), [update]);

  // Dark chrome for Radix portals (selects, dialogs) on this page.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    void useSiteConfigEditorStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  useBackSwipeGuard(isDirty);

  const save = useCallback(async () => {
    const r = await useSiteConfigEditorStore.getState().save();
    if (r.ok) {
      const l = useSiteConfigEditorStore.getState().config.loader;
      toast.success(l?.enabled ? "Live. Visitors see the new loading screen." : "Saved. The loading screen is off.");
    } else if (r.code !== "conflict") {
      toast.error("Couldn't save", { description: r.error });
    }
  }, []);

  // Ctrl+S = Save & go live (this page only edits the loading screen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (useSiteConfigEditorStore.getState().isDirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <SessionLostBanner />
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
        <Link
          href="/admin"
          aria-label="Back to dashboard"
          className="grid size-8 place-items-center rounded-md text-neutral-300 hover:bg-neutral-800 touch:size-11"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">Loading screen</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            config.enabled ? "bg-emerald-950 text-emerald-300" : "bg-neutral-800 text-neutral-300"
          }`}
        >
          {config.enabled ? "On" : "Off"}
        </span>
        {isDirty && <span className="text-[11px] text-amber-300">Unsaved changes</span>}
        <span className="ms-auto" />
        <button
          type="button"
          disabled={!isHydrated || isSaving || !isDirty}
          onClick={() => void save()}
          title="Save & go live (Ctrl+S)"
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          <Rocket className="size-4" /> {isSaving ? "Saving…" : "Save & go live"}
        </button>
      </header>

      {!isHydrated ? (
        <p className="p-6 text-sm text-neutral-400">Loading the site settings…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="max-h-[50dvh] shrink-0 space-y-5 overflow-y-auto border-neutral-800 bg-neutral-900/40 p-3 lg:max-h-none lg:w-[27rem] lg:border-e">
            {source !== "supabase" && (
              <p className="rounded-md border border-amber-900 bg-amber-950/40 p-2 text-xs text-amber-200">
                The site settings couldn&apos;t be loaded from the database, so saving won&apos;t reach the live site.
              </p>
            )}
            <Settings config={config} set={set} />
          </aside>
          <main className="relative min-h-[26rem] min-w-0 flex-1">
            <PreviewPane config={config} typography={typography} />
          </main>
        </div>
      )}
      <SiteConflictDialog />
    </div>
  );
}

// ─── Settings column ────────────────────────────────────────────

function Settings({ config, set }: { config: LoaderConfig; set: (p: Partial<LoaderConfig>) => void }) {
  const update = useSiteConfigEditorStore((s) => s.updateLoader);
  const spec = presetSpec(config.preset);
  const setArt = (slot: LoaderSlot, art: LoaderConfig["art"][LoaderSlot] | null) =>
    update((l) => {
      const next = { ...l.art };
      if (art) next[slot] = art;
      else delete next[slot];
      return { ...l, art: next };
    });

  return (
    <>
      <label className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <Switch checked={config.enabled} onCheckedChange={(v) => set({ enabled: v })} className="mt-0.5" />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium">Show a loading screen</span>
          <span className="block text-xs text-neutral-400">
            Visitors see it while the page loads, then it opens onto the site. It never shows when moving between
            pages inside the site, and never for more than 10 seconds.
          </span>
        </span>
      </label>

      <Group title="Animation">
        <div className="grid grid-cols-2 gap-2">
          {LOADER_PRESETS.map((p) => {
            const active = p.id === config.preset;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => !active && set({ preset: p.id, exit: p.exit })}
                className={`overflow-hidden rounded-lg border text-start transition ${
                  active ? "border-blue-500 ring-2 ring-blue-500/40" : "border-neutral-800 hover:border-neutral-600"
                }`}
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  <SiteLoader
                    config={{ ...config, preset: p.id, progress: "none", size: p.id === "orbit" ? 1.45 : 1.75 }}
                    preview={{ language: "en", hold: true, runKey: 0, bare: true }}
                  />
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium">{p.name}</p>
                  <p className="text-[11px] leading-snug text-neutral-400">{p.description}</p>
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-neutral-500">Picking an animation also picks the opening that suits it (change it below).</p>
      </Group>

      <Group title="Your drawings">
        <p className="text-[11px] text-neutral-400">
          Until you draw or upload one, each spot shows a doodle placeholder. Transparent backgrounds look best.
        </p>
        {spec.slots.map((s) => (
          <ArtPicker
            key={`${config.preset}-${s.key}`}
            label={s.label}
            hint={s.hint}
            art={config.art[s.key]}
            canvas={s.canvas}
            guide={() => loaderGuide(config.preset, s.key, s.canvas)}
            onChange={(art) => setArt(s.key, art)}
            defaultLabel="Placeholder"
          />
        ))}
      </Group>

      <Group title="Words">
        <TextField label="Caption (English)" value={config.caption.en} onChange={(en) => set({ caption: { ...config.caption, en } })} />
        <TextField
          label="Caption (Arabic)"
          dir="rtl"
          value={config.caption.ar}
          onChange={(ar) => set({ caption: { ...config.caption, ar } })}
        />
        <p className="text-[11px] text-neutral-500">Visitors who picked Arabic see the Arabic one. Leave it empty to show the English.</p>
      </Group>

      <Group title="Look">
        <Field label="Paper">
          <Segmented
            value={config.paper}
            options={LOADER_PAPERS.map((p) => ({ id: p.id, label: p.name }))}
            onChange={(paper) => set({ paper })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Paper colour" value={config.background} onChange={(background) => set({ background })} fallback="#f8f5ee" />
          <ColorField label="Ink colour" value={config.ink} onChange={(ink) => set({ ink })} fallback="#2b2420" />
        </div>
        <SliderField label="Drawing size" value={config.size} min={0.6} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(size) => set({ size })} />
        <SliderField label="Speed" value={config.speed} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => set({ speed })} />
      </Group>

      <Group title="Progress">
        <Segmented<LoaderProgress>
          value={config.progress}
          options={[
            { id: "line", label: "Ink line" },
            { id: "dots", label: "Dots" },
            { id: "percent", label: "Percent" },
            { id: "none", label: "None" },
          ]}
          onChange={(progress) => set({ progress })}
        />
        <p className="text-[11px] text-neutral-500">The line and percent follow what has really loaded (pictures, fonts, the page).</p>
      </Group>

      <Group title="Opening onto the site">
        <div className="grid grid-cols-2 gap-2">
          {LOADER_EXITS.map((e) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={config.exit === e.id}
              onClick={() => set({ exit: e.id })}
              className={`rounded-lg border p-2 text-start ${
                config.exit === e.id ? "border-blue-500 bg-blue-950/30" : "border-neutral-800 hover:border-neutral-600"
              }`}
            >
              <p className="text-xs font-medium">{e.name}</p>
              <p className="text-[11px] leading-snug text-neutral-400">{e.description}</p>
            </button>
          ))}
        </div>
        {config.preset === "book" && (
          <p className="text-[11px] text-neutral-500">With the book, its cover swings open first, then this plays.</p>
        )}
      </Group>

      <Group title="When">
        <Field label="Show it">
          <Segmented
            value={config.showOn}
            options={[
              { id: "every", label: "Every visit" },
              { id: "session", label: "Once per visit" },
            ]}
            onChange={(showOn) => set({ showOn })}
          />
        </Field>
        <p className="-mt-1 text-[11px] text-neutral-500">
          &quot;Once per visit&quot;: a reload in the same browser tab skips it.
        </p>
        <Field label="On">
          <Segmented
            value={config.pages}
            options={[
              { id: "home", label: "Home page" },
              { id: "all", label: "Every page" },
            ]}
            onChange={(pages) => set({ pages })}
          />
        </Field>
        <SliderField
          label="Stay at least"
          value={config.minMs}
          min={0}
          max={4000}
          step={100}
          format={(v) => `${(v / 1000).toFixed(1)} s`}
          onChange={(minMs) => set({ minMs })}
        />
        <p className="text-[11px] text-neutral-500">
          Counted from when the visitor opened the page. On a slow connection it stays until the page is ready.
        </p>
      </Group>
    </>
  );
}

// ─── Preview ────────────────────────────────────────────────────

function PreviewPane({ config, typography }: { config: LoaderConfig; typography: Parameters<typeof typographyVars>[0] }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [lang, setLang] = useState<Lang>("en");
  const [mode, setMode] = useState<"loop" | "intro">("loop");
  const [runKey, setRunKey] = useState(0);
  // The preset whose intro just ended (picking another one plays its intro).
  const [finishedPreset, setFinishedPreset] = useState<string | null>(null);
  const finished = finishedPreset === config.preset;

  const play = () => {
    setMode("intro");
    setFinishedPreset(null);
    setRunKey((k) => k + 1);
  };
  const preset = config.preset;
  const onDone = useCallback(() => setFinishedPreset(preset), [preset]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <Segmented
          value={device}
          options={[
            { id: "desktop", label: "Desktop", icon: <Monitor className="size-3.5" /> },
            { id: "phone", label: "Phone", icon: <Smartphone className="size-3.5" /> },
          ]}
          onChange={setDevice}
        />
        <Segmented
          value={lang}
          options={[
            { id: "en", label: "EN" },
            { id: "ar", label: "عربي" },
          ]}
          onChange={setLang}
        />
        <span className="ms-auto" />
        <button
          type="button"
          onClick={() => {
            setMode("loop");
            setFinishedPreset(null);
          }}
          aria-pressed={mode === "loop"}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${
            mode === "loop" ? "bg-neutral-700 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          <Repeat className="size-3.5" /> Loop
        </button>
        <button
          type="button"
          onClick={play}
          className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
        >
          <Play className="size-3.5" /> Play the intro
        </button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-neutral-950 p-4">
        <div
          className={`relative overflow-hidden rounded-xl shadow-2xl ring-1 ring-neutral-700 ${
            device === "desktop" ? "aspect-[16/10] w-full max-w-[1100px]" : "aspect-[390/800] h-full max-h-[760px]"
          }`}
          style={typographyVars(typography, lang) as React.CSSProperties | undefined}
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <SiteFonts typography={typography} />
          <StandInPage lang={lang} />
          {!finished && (
            <SiteLoader
              key={`${mode}-${runKey}-${mode === "intro" ? config.preset : ""}`}
              config={config}
              preview={{ language: lang, hold: mode === "loop", runKey, onDone }}
            />
          )}
          {finished && (
            <button
              type="button"
              onClick={play}
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-neutral-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg hover:bg-neutral-800"
            >
              <Play className="size-3.5" /> Replay
            </button>
          )}
        </div>
      </div>
      {!config.enabled && (
        <p className="shrink-0 border-t border-neutral-800 px-3 py-2 text-[11px] text-amber-300">
          The loading screen is off: visitors don&apos;t see it. Turn it on in the left column, then Save &amp; go live.
        </p>
      )}
    </div>
  );
}

/** What the visitor lands on after the intro (a sketch, not the real page). */
function StandInPage({ lang }: { lang: Lang }) {
  return (
    <div className="paper-material absolute inset-0 flex flex-col gap-[4cqh] p-[5cqw] text-[#2b2420]" data-paper="sketchbook" data-grain="true" style={{ containerType: "size" }}>
      <div className="flex items-center justify-between">
        <div className="h-[3cqh] w-[18cqw] rounded bg-[#2b2420]/15" />
        <div className="flex gap-[2cqw]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[2cqh] w-[8cqw] rounded bg-[#2b2420]/10" />
          ))}
        </div>
      </div>
      <div className="grid flex-1 place-items-center rounded-lg border-2 border-dashed border-[#2b2420]/20">
        <p className="font-[family-name:var(--font-display)] text-[clamp(14px,4cqmin,28px)] opacity-60">
          {lang === "ar" ? "صفحتك تظهر هنا" : "Your page appears here"}
        </p>
      </div>
    </div>
  );
}

// ─── Small controls ─────────────────────────────────────────────

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-neutral-300">{label}</p>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-neutral-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
            value === o.id ? "bg-neutral-600 text-white" : "text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  dir?: "rtl";
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-300">{label}</span>
      <input
        value={value}
        dir={dir}
        maxLength={80}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-neutral-300">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-neutral-700 bg-transparent"
        />
        {value ? (
          <button type="button" onClick={() => onChange("")} className="text-[11px] text-neutral-400 underline hover:text-white">
            Default
          </button>
        ) : (
          <span className="text-[11px] text-neutral-500">Default</span>
        )}
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex justify-between text-xs text-neutral-300">
        {label} <span className="tabular-nums text-neutral-400">{format(value)}</span>
      </span>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} />
    </label>
  );
}
