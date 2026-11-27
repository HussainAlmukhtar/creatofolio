"use client";

// NavStudio — full-screen editor for the site nav (SiteConfig.header).
//
// Left: big choice cards grouped in tabs (Behaviour · Content · Look ·
// Phone). Right: the REAL SiteNav over a mock page you can scroll, so sticky
// / hide-on-scroll / after-hero / transparent-over-hero behave exactly like
// the site. Desktop / Mobile and EN / عربي are the editor's own switches.
//
// A plain fixed overlay, not a Radix dialog: the Drawing Studio opens on top
// of it, and a modal dialog would trap focus and clicks away from it.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Monitor, Plus, Smartphone, Trash2, X } from "lucide-react";
import type { CustomFont, HeaderConfig, NavLink, NavLook, NavMobile, NavHotspot } from "@/data/landingTypes";
import {
  DEFAULT_LOGO_HOTSPOT,
  defaultHotspot,
  navFontKeys,
  hasArt,
  pickArt,
  NAV_SCROLL_LABEL,
} from "@/data/navConfig";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import SiteNav from "@/components/landing/nav/SiteNav";
import { newIid } from "@/lib/iid";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FieldControl } from "../FormFields";
import {
  BigToggle,
  ChoiceCards,
  ColorRow,
  LocalizedInputs,
  RangeRow,
  StudioSection,
  type Choice,
} from "./StudioControls";
import { NavArtField } from "./NavArtField";
import { HotspotEditor } from "./HotspotEditor";
import { FontPairField } from "../FontPicker";
import SiteFonts, { CustomFontsContext } from "@/components/landing/SiteFonts";
import { typographyVars } from "@/data/fonts";

type Tab = "behaviour" | "content" | "look" | "phone";

const NO_CUSTOM_FONTS: CustomFont[] = [];

const BAR_CANVAS = { w: 2400, h: 200 };
const PHONE_BAR_CANVAS = { w: 1170, h: 180 };
const PIECE_CANVAS = { w: 800, h: 300 };
const BUTTON_CANVAS = { w: 300, h: 300 };
const PANEL_CANVAS = { w: 780, h: 1690 };

// ─── Option sketches ───────────────────────────────────────────

const Bar = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <div className={`flex h-3 items-center gap-1 px-1.5 ${className}`}>{children}</div>
);
const Dot = ({ w = 4, dark = false }: { w?: number; dark?: boolean }) => (
  <span className={`h-1 rounded-full ${dark ? "bg-foreground/70" : "bg-foreground/35"}`} style={{ width: w * 2 }} />
);
const Scribble = () => (
  <svg viewBox="0 0 100 12" className="h-3 w-full" preserveAspectRatio="none" aria-hidden="true">
    <path d="M2 8 C 15 2, 25 11, 40 6 S 70 2, 98 7" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/60" />
  </svg>
);

const STYLE_CHOICES: Choice<HeaderConfig["style"]>[] = [
  {
    value: "standard",
    label: "Standard",
    description: "A clean text bar. Logo text and link labels.",
    sketch: (
      <Bar className="mt-4 bg-background">
        <Dot w={7} dark />
        <span className="flex-1" />
        <Dot /> <Dot /> <Dot />
      </Bar>
    ),
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Standard layout, but any piece (logo, links, background) can be your drawing.",
    sketch: (
      <div className="mt-3 flex h-5 items-center gap-1 bg-background px-1.5">
        <span className="h-3 w-6 rounded-[40%_60%_50%_40%] border border-foreground/60" />
        <span className="flex-1" />
        <Dot /> <span className="h-2.5 w-4 rounded-[50%_40%] border border-foreground/60" /> <Dot />
      </div>
    ),
  },
  {
    value: "drawn",
    label: "Drawn",
    description: "The whole bar is one drawing. You mark where each link is on it.",
    sketch: (
      <div className="mt-3 bg-background px-1">
        <Scribble />
      </div>
    ),
  },
];

const scrollSketch = (kind: HeaderConfig["scroll"]) => (
  <div className="relative h-full">
    <div className="absolute inset-x-2 top-1 bottom-0 space-y-1 opacity-50">
      <div className="h-1.5 rounded bg-foreground/20" />
      <div className="h-1.5 rounded bg-foreground/20" />
      <div className="h-1.5 rounded bg-foreground/20" />
    </div>
    <div
      className={`absolute inset-x-0 h-3 border-b border-foreground/30 bg-background ${
        kind === "static" ? "-top-1.5 opacity-60" : kind === "hideOnScroll" ? "top-0 animate-pulse" : kind === "afterHero" ? "top-0 border-dashed opacity-70" : "top-0"
      }`}
    />
    <span className="absolute bottom-0.5 end-1 text-[9px] text-muted-foreground">
      {kind === "static" ? "↑ scrolls away" : kind === "sticky" ? "pinned" : kind === "hideOnScroll" ? "↓ hides · ↑ shows" : "after hero"}
    </span>
  </div>
);

const SCROLL_CHOICES: Choice<HeaderConfig["scroll"]>[] = [
  { value: "static", label: NAV_SCROLL_LABEL.static, description: "At the top of the page; scrolls away with it.", sketch: scrollSketch("static") },
  { value: "sticky", label: NAV_SCROLL_LABEL.sticky, description: "Always pinned to the top of the screen.", sketch: scrollSketch("sticky") },
  { value: "hideOnScroll", label: NAV_SCROLL_LABEL.hideOnScroll, description: "Gets out of the way while reading, back the moment you scroll up.", sketch: scrollSketch("hideOnScroll") },
  { value: "afterHero", label: NAV_SCROLL_LABEL.afterHero, description: "Keeps the hero clean; slides in once you're past it.", sketch: scrollSketch("afterHero") },
];

const LAYOUT_CHOICES: Choice<HeaderConfig["layout"]>[] = [
  {
    value: "logoLeft",
    label: "Logo left",
    sketch: (
      <Bar className="mt-4 bg-background">
        <Dot w={7} dark />
        <span className="flex-1" />
        <Dot /> <Dot /> <Dot />
      </Bar>
    ),
  },
  {
    value: "logoCenterSplit",
    label: "Logo centre, links split",
    sketch: (
      <Bar className="mt-4 bg-background">
        <Dot /> <Dot />
        <span className="flex-1" />
        <Dot w={7} dark />
        <span className="flex-1" />
        <Dot /> <Dot />
      </Bar>
    ),
  },
  {
    value: "logoCenterStacked",
    label: "Logo centre, links below",
    sketch: (
      <div className="mt-2 flex flex-col items-center gap-1 bg-background py-1">
        <Dot w={7} dark />
        <div className="flex gap-1">
          <Dot /> <Dot /> <Dot />
        </div>
      </div>
    ),
  },
];

// ─── Studio ─────────────────────────────────────────────────────

export function NavStudio() {
  const open = useSiteConfigEditorStore((s) => s.navStudioOpen);
  const setOpen = useSiteConfigEditorStore((s) => s.setNavStudioOpen);
  const hydrate = useSiteConfigEditorStore((s) => s.hydrate);
  const isHydrated = useSiteConfigEditorStore((s) => s.isHydrated);
  const nav = useSiteConfigEditorStore((s) => s.config.header);
  const langSkin = useSiteConfigEditorStore((s) => s.config.chrome?.languagePill);
  const updateHeader = useSiteConfigEditorStore((s) => s.updateHeader);
  const save = useSiteConfigEditorStore((s) => s.save);
  const isDirty = useSiteConfigEditorStore((s) => s.isDirty);
  const isSaving = useSiteConfigEditorStore((s) => s.isSaving);
  const device = useLandingEditorStore((s) => s.deviceMode);
  const setDevice = useLandingEditorStore((s) => s.setDeviceMode);
  const language = useLandingEditorStore((s) => s.previewLanguage);
  const setLanguage = useLandingEditorStore((s) => s.setPreviewLanguage);
  const [tab, setTab] = useState<Tab>("behaviour");

  useEffect(() => {
    if (open) void hydrate();
  }, [open, hydrate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // The Drawing Studio handles its own Esc.
      if (e.key === "Escape" && !document.querySelector("iframe[src*='klecks']")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const set = (partial: Partial<HeaderConfig>) => updateHeader(partial);
  const setLook = (partial: Partial<NavLook>) => set({ look: { ...nav.look, ...partial } });
  const setMobile = (partial: Partial<NavMobile>) => set({ mobile: { ...nav.mobile, ...partial } });

  const onSave = async () => {
    const r = await save();
    if (r.ok) toast.success("Nav is live");
    else if (r.code !== "conflict") toast.error(`Couldn't save the nav: ${r.error ?? "unknown error"}`);
  };

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Nav Studio">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
        <span className="text-sm font-semibold">Nav Studio</span>
        <span className="hidden text-xs text-muted-foreground md:inline">
          Site-wide · shows on every page. Changes here go live as soon as you save. They aren&apos;t part of page drafts.
        </span>
        <div className="mx-auto flex items-center gap-2">
          <Seg
            value={device}
            onChange={(v) => setDevice(v as "desktop" | "mobile")}
            options={[
              { value: "desktop", label: "Desktop", icon: <Monitor /> },
              { value: "mobile", label: "Mobile", icon: <Smartphone /> },
            ]}
          />
          <Seg
            value={language}
            onChange={(v) => setLanguage(v as "en" | "ar")}
            options={[
              { value: "en", label: "EN" },
              { value: "ar", label: "عربي" },
            ]}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={onSave} disabled={!isHydrated || isSaving || !isDirty}>
          {isSaving ? "Saving…" : isDirty ? "Save & go live" : "Saved"}
        </Button>
        <Button size="icon-sm" variant="ghost" title="Close (Esc)" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </header>

      {!isHydrated ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading site settings…</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Controls */}
          <aside className="flex w-[440px] shrink-0 flex-col border-e border-border bg-muted/30">
            <div className="space-y-3 border-b border-border p-3">
              <BigToggle
                label="Show the nav"
                description="Off = no nav bar on any page."
                checked={nav.enabled}
                onChange={(enabled) => set({ enabled })}
              />
              <div role="tablist" className="grid grid-cols-4 gap-1 rounded-lg bg-background p-1 ring-1 ring-border">
                {(
                  [
                    ["behaviour", "Behaviour"],
                    ["content", "Content"],
                    ["look", "Look"],
                    ["phone", "Phone"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`rounded-md py-1.5 text-[13px] font-medium ${
                      tab === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`flex-1 space-y-3 overflow-y-auto p-3 ${nav.enabled ? "" : "pointer-events-none opacity-50"}`}>
              {tab === "behaviour" && <BehaviourTab nav={nav} set={set} setMobile={setMobile} />}
              {tab === "content" && <ContentTab nav={nav} set={set} />}
              {tab === "look" && <LookTab nav={nav} set={set} setLook={setLook} />}
              {tab === "phone" && <PhoneTab nav={nav} setMobile={setMobile} />}
            </div>
          </aside>

          {/* Preview */}
          <NavPreview nav={nav} device={device} language={language} langSkin={langSkin} />
        </div>
      )}
    </div>
  );
}

function Seg({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div role="radiogroup" className="flex rounded-lg bg-background/70 p-0.5 ring-1 ring-border">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium [&_svg]:size-3.5 ${
            o.value === value ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────

type SetNav = (partial: Partial<HeaderConfig>) => void;

function BehaviourTab({
  nav,
  set,
  setMobile,
}: {
  nav: HeaderConfig;
  set: SetNav;
  setMobile: (p: Partial<NavMobile>) => void;
}) {
  return (
    <>
      <StudioSection title="Style" info="Switch any time: your drawings are kept even while the Standard style is showing.">
        <ChoiceCards label="Nav style" value={nav.style} options={STYLE_CHOICES} onChange={(style) => set({ style })} columns={3} />
        {nav.style === "drawn" && !hasArt(nav.barArt) && (
          <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-900">
            Draw the bar in Content → Bar drawing. Until then visitors see the Standard bar.
          </p>
        )}
      </StudioSection>
      <StudioSection title="While scrolling" info="Scroll inside the preview to try it.">
        <ChoiceCards label="Scroll behaviour" value={nav.scroll} options={SCROLL_CHOICES} onChange={(scroll) => set({ scroll })} />
        <label className="flex items-center justify-between gap-2 pt-1 text-[12px]">
          <span className="text-muted-foreground">On phones</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"
            value={nav.mobile.scroll ?? ""}
            onChange={(e) => setMobile({ scroll: (e.target.value || undefined) as NavMobile["scroll"] })}
          >
            <option value="">Same as desktop</option>
            {SCROLL_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </StudioSection>
      <StudioSection title="At the top of the page">
        <ChoiceCards
          label="Over the hero"
          value={nav.overHero}
          onChange={(overHero) => set({ overHero })}
          options={[
            { value: "solid", label: "Solid bar", description: "Sits above the page with its background." },
            {
              value: "transparent",
              label: "Transparent over the hero",
              description: "Floats over the hero (no background) and gets its background once you scroll past.",
            },
          ]}
        />
      </StudioSection>
      <StudioSection title="Language switch">
        <BigToggle
          label="Put the EN / عربي switch in the nav (desktop)"
          description="Replaces the floating language pill, which otherwise sits over the end of the nav. Phones always show it in the nav bar. Uses the pill's drawing if it has one (select the arcade, then Screen UI)."
          checked={nav.languageButton}
          onChange={(languageButton) => set({ languageButton })}
        />
      </StudioSection>
    </>
  );
}

function ContentTab({ nav, set }: { nav: HeaderConfig; set: SetNav }) {
  const art = nav.style !== "standard";
  const drawn = nav.style === "drawn";
  const setLink = (i: number, partial: Partial<NavLink>) =>
    set({ links: nav.links.map((l, j) => (j === i ? { ...l, ...partial } : l)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...nav.links];
    const [l] = next.splice(i, 1);
    next.splice(i + d, 0, l);
    set({ links: next });
  };
  const [openLink, setOpenLink] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  // Drawn style: hotspots for logo + links + CTA.
  const all = [...nav.links, ...(nav.cta.enabled ? [nav.cta] : [])];
  const bar = pickArt(nav.barArt, "en");
  const hotspotItems = useMemo(
    () => [
      { id: "__logo", label: "Logo", rect: nav.logoHotspot ?? DEFAULT_LOGO_HOTSPOT },
      ...all.map((l, i) => ({
        id: l.id,
        label: l.label.en || "link",
        rect: l.hotspot ?? defaultHotspot(i, all.length),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nav.logoHotspot, nav.links, nav.cta]
  );
  const setHotspot = (id: string, rect: NavHotspot) => {
    if (id === "__logo") set({ logoHotspot: rect });
    else if (id === nav.cta.id) set({ cta: { ...nav.cta, hotspot: rect } });
    else set({ links: nav.links.map((l) => (l.id === id ? { ...l, hotspot: rect } : l)) });
  };

  return (
    <>
      <StudioSection title="Logo">
        <LocalizedInputs label="Logo text (also read by screen readers)" value={nav.logoText} onChange={(logoText) => set({ logoText })} />
        {art && !drawn && (
          <NavArtField
            label="Logo drawing"
            info="Shown instead of the logo text."
            value={nav.logoArt}
            onChange={(logoArt) => set({ logoArt })}
            canvas={PIECE_CANVAS}
          />
        )}
      </StudioSection>

      {art && (
        <StudioSection
          title={drawn ? "Bar drawing" : "Bar background drawing"}
          info={
            drawn
              ? "The whole nav: draw the logo, the link words, everything. It spans the full width; its height follows the drawing's shape. Then mark the clickable areas below."
              : "Optional: a drawn strip behind the logo and links (stretched to fill the bar)."
          }
        >
          <NavArtField
            label={drawn ? "The bar" : "Background"}
            value={nav.barArt}
            onChange={(barArt) => set({ barArt })}
            canvas={BAR_CANVAS}
            trim={false}
          />
          {drawn && bar && (
            <Button size="sm" onClick={() => setPlacing(true)}>
              Place the clickable areas…
            </Button>
          )}
          {placing && bar && (
            <div className="fixed inset-0 z-[2100] flex flex-col items-center justify-center gap-4 bg-black/70 p-6" onClick={() => setPlacing(false)}>
              <div className="w-[min(92vw,1400px)] space-y-3 rounded-xl bg-background p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Clickable areas</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Put a box over the logo and each link in your drawing. Drag a box to move it, its corner to resize.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setPlacing(false)}>
                    Done
                  </Button>
                </div>
                <HotspotEditor bar={bar} items={hotspotItems} onChange={setHotspot} />
              </div>
            </div>
          )}
        </StudioSection>
      )}

      <StudioSection title="Links" info="#about-style links jump to a section on the home page and light up while it's on screen.">
        {nav.links.length === 0 && <p className="text-[12px] text-muted-foreground">No links yet.</p>}
        <ul className="space-y-1.5">
          {nav.links.map((l, i) => {
            const isOpen = openLink === l.id;
            return (
              <li key={l.id} className="rounded-lg border border-border bg-background">
                <div className="flex items-center gap-1 p-1.5">
                  <button className="min-w-0 flex-1 truncate px-1.5 text-start text-[13px] font-medium" onClick={() => setOpenLink(isOpen ? null : l.id)}>
                    {l.label.en || "(no label)"} <span className="text-[11px] font-normal text-muted-foreground">{l.href}</span>
                  </button>
                  <Button size="icon-xs" variant="ghost" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon-xs" variant="ghost" title="Move down" disabled={i === nav.links.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon-xs" variant="ghost" title="Remove link" onClick={() => set({ links: nav.links.filter((x) => x.id !== l.id) })}>
                    <Trash2 />
                  </Button>
                </div>
                {isOpen && (
                  <div className="space-y-3 border-t border-border p-2.5">
                    <LinkFields link={l} onChange={(p) => setLink(i, p)} art={art} drawn={drawn} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const id = newIid();
            set({ links: [...nav.links, { id, label: { en: "New link", ar: "رابط جديد" }, href: "/" }] });
            setOpenLink(id);
          }}
        >
          <Plus /> Add link
        </Button>
      </StudioSection>

      <StudioSection title="Call-to-action button" info="One highlighted button at the end of the nav (e.g. Contact).">
        <BigToggle label="Show a CTA button" checked={nav.cta.enabled} onChange={(enabled) => set({ cta: { ...nav.cta, enabled } })} />
        {nav.cta.enabled && (
          <>
            {!drawn && (
              <ChoiceCards
                label="CTA style"
                value={nav.cta.variant}
                onChange={(variant) => set({ cta: { ...nav.cta, variant } })}
                options={[
                  { value: "solid", label: "Filled" },
                  { value: "outline", label: "Outline" },
                ]}
              />
            )}
            <LinkFields link={nav.cta} onChange={(p) => set({ cta: { ...nav.cta, ...p } })} art={art} drawn={drawn} />
          </>
        )}
      </StudioSection>
    </>
  );
}

function LinkFields({
  link,
  onChange,
  art,
  drawn,
}: {
  link: NavLink;
  onChange: (p: Partial<NavLink>) => void;
  art: boolean;
  drawn: boolean;
}) {
  return (
    <>
      <LocalizedInputs label="Label" value={link.label} onChange={(label) => onChange({ label })} />
      <FieldControl field={{ kind: "url", key: "href", label: "Goes to" }} value={link.href} onChange={(v) => onChange({ href: String(v ?? "") })} />
      <label className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">Open in a new tab</span>
        <Switch checked={Boolean(link.newTab)} onCheckedChange={(newTab) => onChange({ newTab })} />
      </label>
      {art && !drawn && (
        <NavArtField label="Drawing" info="Shown instead of the label." value={link.art} onChange={(a) => onChange({ art: a })} canvas={PIECE_CANVAS} />
      )}
      {art && (
        <>
          <NavArtField
            label="Hover drawing (optional)"
            info={drawn ? "Shown inside this link's area when a mouse is over it, e.g. a scribble underline." : "Swapped in while a mouse is over it."}
            value={link.hoverArt}
            onChange={(a) => onChange({ hoverArt: a })}
            canvas={PIECE_CANVAS}
          />
          <NavArtField
            label="“You are here” drawing (optional)"
            info="Shown while this is the current page, or its section is on screen."
            value={link.activeArt}
            onChange={(a) => onChange({ activeArt: a })}
            canvas={PIECE_CANVAS}
          />
        </>
      )}
    </>
  );
}

function LookTab({ nav, set, setLook }: { nav: HeaderConfig; set: SetNav; setLook: (p: Partial<NavLook>) => void }) {
  const look = nav.look;
  const drawn = nav.style === "drawn";
  return (
    <>
      {!drawn && (
        <StudioSection title="Layout">
          <ChoiceCards label="Layout" value={nav.layout} options={LAYOUT_CHOICES} onChange={(layout) => set({ layout })} columns={3} />
        </StudioSection>
      )}
      <StudioSection title="Size">
        {!drawn && <RangeRow label="Bar height" value={look.height} min={40} max={140} onChange={(height) => setLook({ height })} />}
        {!drawn && <RangeRow label="Side padding" value={look.paddingX} min={0} max={96} onChange={(paddingX) => setLook({ paddingX })} />}
        <RangeRow label="Content width" value={look.maxWidth} min={0} max={1600} step={20} zeroLabel="Full width" onChange={(maxWidth) => setLook({ maxWidth })} />
        {!drawn && <RangeRow label="Link text size" value={look.linkSize} min={11} max={24} onChange={(linkSize) => setLook({ linkSize })} />}
        {nav.style === "hybrid" && (
          <>
            <RangeRow label="Logo drawing height" value={look.logoArtHeight} min={16} max={140} onChange={(logoArtHeight) => setLook({ logoArtHeight })} />
            <RangeRow label="Link drawing height" value={look.linkArtHeight} min={12} max={100} onChange={(linkArtHeight) => setLook({ linkArtHeight })} />
          </>
        )}
        {drawn && <p className="text-[12px] text-muted-foreground">A drawn bar is as tall as its drawing at the content width.</p>}
      </StudioSection>
      {!drawn && (
        <StudioSection title="Hover & current link">
          <ChoiceCards
            label="Indicator"
            value={look.indicator}
            onChange={(indicator) => setLook({ indicator })}
            columns={3}
            options={[
              { value: "none", label: "Colour only" },
              { value: "underline", label: "Underline" },
              { value: "pill", label: "Pill" },
            ]}
          />
        </StudioSection>
      )}
      {!drawn && (
        <StudioSection title="Font" info="For the logo text and the links. Default = the site's fonts (Site settings → Fonts).">
          <FontPairField
            label="Nav font"
            latin={look.font}
            arabic={look.fontAr}
            defaultLabel="Site fonts"
            onChange={(font, fontAr) => setLook({ font, fontAr })}
          />
        </StudioSection>
      )}
      <StudioSection title="Colours">
        <ColorRow label="Bar background" value={look.bg} fallback="#fdfcf8" onChange={(bg) => setLook({ bg })} />
        {!drawn && (
          <>
            <ColorRow label="Links" value={look.ink} fallback="#57493e" onChange={(ink) => setLook({ ink })} />
            <ColorRow label="Logo, hover & current link" value={look.inkHover} fallback="#2b2420" onChange={(inkHover) => setLook({ inkHover })} />
            <BigToggle label="Line under the bar" checked={look.divider} onChange={(divider) => setLook({ divider })} />
          </>
        )}
      </StudioSection>
    </>
  );
}

function PhoneTab({ nav, setMobile }: { nav: HeaderConfig; setMobile: (p: Partial<NavMobile>) => void }) {
  const m = nav.mobile;
  const art = nav.style !== "standard";
  return (
    <>
      <StudioSection title="On phones">
        <BigToggle label="Hide the nav on phones" checked={m.hidden} onChange={(hidden) => setMobile({ hidden })} />
      </StudioSection>
      {!m.hidden && (
        <>
          <StudioSection title="Menu" info="Phones show the logo and a menu button; the links live in the menu.">
            <ChoiceCards
              label="Menu style"
              value={m.panel}
              onChange={(panel) => setMobile({ panel })}
              options={[
                { value: "fullscreen", label: "Full screen", description: "Covers the screen, big links." },
                { value: "dropdown", label: "Drop-down", description: "Opens under the bar." },
              ]}
            />
            <ColorRow label="Menu background" value={m.panelBg} fallback="#fdfcf8" onChange={(panelBg) => setMobile({ panelBg })} />
          </StudioSection>
          {art ? (
            <StudioSection title="Drawings">
              <NavArtField label="Menu button (☰)" value={m.menuButtonArt} onChange={(menuButtonArt) => setMobile({ menuButtonArt })} canvas={BUTTON_CANVAS} />
              {m.panel === "fullscreen" && (
                <NavArtField label="Close button (✕)" value={m.closeButtonArt} onChange={(closeButtonArt) => setMobile({ closeButtonArt })} canvas={BUTTON_CANVAS} />
              )}
              <NavArtField label="Menu background" value={m.panelArt} onChange={(panelArt) => setMobile({ panelArt })} canvas={PANEL_CANVAS} trim={false} />
              <NavArtField label="Phone bar background" value={m.barArt} onChange={(barArt) => setMobile({ barArt })} canvas={PHONE_BAR_CANVAS} trim={false} />
            </StudioSection>
          ) : (
            <p className="px-1 text-[12px] text-muted-foreground">Switch the style to Hybrid or Drawn to draw the menu button and menu.</p>
          )}
        </>
      )}
    </>
  );
}

// ─── Preview ────────────────────────────────────────────────────

function NavPreview({
  nav,
  device,
  language,
  langSkin,
}: {
  nav: HeaderConfig;
  device: "desktop" | "mobile";
  language: "en" | "ar";
  langSkin: Parameters<typeof SiteNav>[0]["langSkin"];
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const typography = useSiteConfigEditorStore((s) => s.config.typography);
  const viewH = device === "mobile" ? 640 : 560;
  // Sections named after the nav's #anchors, so "you are here" lights up.
  const anchors = nav.links
    .map((l) => (l.href.includes("#") ? l.href.split("#")[1] : ""))
    .filter(Boolean);
  const sections = anchors.length ? anchors : ["about", "work", "contact"];

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 overflow-auto bg-muted/50 p-6">
      <p className="text-xs text-muted-foreground">Live preview · scroll inside it to try the behaviour</p>
      <div
        ref={setScroller}
        key={device}
        className="site-fonts-scope relative overflow-y-auto overflow-x-hidden rounded-xl bg-[#f6f1e7] shadow-2xl ring-1 ring-border"
        style={{
          width: device === "mobile" ? 390 : "100%",
          maxWidth: 1280,
          height: viewH,
          ["--nav-preview-h" as string]: `${viewH}px`,
          ...typographyVars(typography, language),
        }}
        dir={language === "ar" ? "rtl" : "ltr"}
        lang={language}
      >
        <SiteFonts typography={typography} extraKeys={navFontKeys(nav)} />
        <CustomFontsContext.Provider value={typography?.customFonts ?? NO_CUSTOM_FONTS}>
          <SiteNav config={nav} language={language} langSkin={langSkin} preview={{ device, scrollRoot: scroller }} />
        </CustomFontsContext.Provider>
        {!nav.enabled && (
          <div className="sticky top-0 z-50 bg-amber-100 px-3 py-1.5 text-center text-xs text-amber-900">The nav is off.</div>
        )}
        <div
          data-nav-hero
          className="grid place-items-center bg-[radial-gradient(circle_at_50%_40%,#e8dcc4,#cdb894)] text-center"
          style={{ height: viewH }}
        >
          <div>
            <div className="font-display text-3xl font-semibold text-[#2b2420]/70">Hero</div>
            <div className="mt-1 text-xs text-[#2b2420]/50">scroll ↓</div>
          </div>
        </div>
        {sections.map((id, i) => (
          <section
            key={id}
            id={id}
            className="flex items-start px-8 py-10"
            style={{ minHeight: viewH * 0.8, background: i % 2 ? "#efe7d8" : "#f8f3ea" }}
          >
            <div className="space-y-3">
              <div className="font-display text-2xl font-semibold text-[#2b2420]/70">#{id}</div>
              <div className="h-2 w-64 max-w-full rounded bg-[#2b2420]/10" />
              <div className="h-2 w-52 max-w-full rounded bg-[#2b2420]/10" />
              <div className="h-2 w-60 max-w-full rounded bg-[#2b2420]/10" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
