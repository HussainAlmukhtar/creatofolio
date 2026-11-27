"use client";

// SiteNav — the site-wide nav, driven by SiteConfig.header.
//
//   style   standard (text bar) · hybrid (any piece can be a drawing) ·
//           drawn (the whole bar is one drawing, links are hotspots on it)
//   scroll  static · sticky · hide-down/show-up · appear after the hero
//   overHero "transparent" floats it over the top of the page (no flow
//           space) and fades its background in once past the hero
//
// Desktop and phone bars are both rendered; a container query on the header
// (globals.css "Site nav") picks one, so the editor's 390px phone canvas and
// the Nav Studio preview switch exactly like a real phone. The phone bar opens
// a full-screen or drop-down menu.
//
// Positioning never puts a transform/filter on the header itself (only on
// its inner bar + a background layer): either would turn the header into the
// containing block of the fixed full-screen menu.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { HeaderConfig, NavLink, LocalizedArt } from "@/data/landingTypes";
import type { ChromeSkin } from "@/data/chromeSkin";
import {
  DEFAULT_LOGO_HOTSPOT,
  defaultHotspot,
  hasArt,
  pickArt,
} from "@/data/navConfig";
import { useLandingStore } from "@/stores/landingStore";
import ChromeArt from "../ChromeArt";
import { CustomFontsContext } from "../SiteFonts";
import { elementFontFamily } from "@/data/fonts";
import { useIsPhone, useNavScroll } from "./useNavScroll";

type Lang = "en" | "ar";

export interface SiteNavPreview {
  /** Which bar to show (the editor's Desktop / Mobile switch). */
  device: "desktop" | "mobile";
  /** Nav Studio: the preview's scroll container (real scroll behaviour). */
  scrollRoot?: HTMLElement | null;
  /** Editor canvas: show it in place, no scroll behaviour, no clicks. */
  frozen?: boolean;
}

export default function SiteNav({
  config,
  language,
  langSkin,
  preview,
}: {
  config: HeaderConfig;
  language: Lang;
  /** The language switcher's art (SiteConfig.chrome.languagePill). */
  langSkin?: ChromeSkin;
  preview?: SiteNavPreview;
}) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const customFonts = useContext(CustomFontsContext);
  const panelId = useId();
  const phone = useIsPhone(preview?.device);
  const frozen = Boolean(preview?.frozen);

  const scroll = frozen ? "static" : phone && config.mobile.scroll ? config.mobile.scroll : config.scroll;
  const transparent = config.overHero === "transparent" && !frozen;
  // Floating navs take no space in the page flow (they sit over the hero).
  const float = !frozen && (transparent || scroll === "afterHero");

  const hashTargets = useMemo(
    () => [...config.links, config.cta].map((l) => hashOf(l.href)).filter((h): h is string => Boolean(h)),
    [config.links, config.cta]
  );
  const { hidden, solid, activeHash } = useNavScroll({
    mode: scroll,
    transparent,
    frozen,
    scrollRoot: preview?.scrollRoot ?? null,
    header,
    menuOpen,
    hashTargets,
  });
  const pathname = usePathname();
  const isActive = useCallback(
    (href: string) => {
      const hash = hashOf(href);
      if (hash) return activeHash === hash;
      if (!href.startsWith("/")) return false;
      const path = href.split(/[?#]/)[0];
      return path === pathname;
    },
    [activeHash, pathname]
  );

  if (!config.enabled) return null;

  const look = config.look;
  const ownFont = elementFontFamily(look.font, look.fontAr, language, customFonts, "body");
  const art = config.style !== "standard";
  const vars = {
    "--nav-h": `${look.height}px`,
    "--nav-px": `${look.paddingX}px`,
    "--nav-max": look.maxWidth > 0 ? `${look.maxWidth}px` : "none",
    "--nav-link-size": `${look.linkSize}px`,
    "--nav-logo-h": `${look.logoArtHeight}px`,
    "--nav-link-art-h": `${look.linkArtHeight}px`,
    ...(look.bg ? { "--nav-bg": look.bg } : {}),
    ...(look.ink ? { "--nav-ink": look.ink } : {}),
    ...(look.inkHover ? { "--nav-ink-hover": look.inkHover } : {}),
    ...(config.mobile.panelBg ? { "--nav-panel-bg": config.mobile.panelBg } : {}),
    ...(ownFont ? { fontFamily: ownFont } : {}),
  } as React.CSSProperties;

  const closeMenu = () => setMenuOpen(false);
  const scrollRoot = preview?.scrollRoot ?? null;
  // Editor previews never navigate away from the editor: #anchors scroll the
  // mock page, everything else is a no-op.
  const intercept = preview
    ? (href: string) => {
        const hash = hashOf(href);
        const el = hash && scrollRoot?.querySelector<HTMLElement>(`[id="${CSS.escape(hash)}"]`);
        if (el && scrollRoot) scrollRoot.scrollTo({ top: el.offsetTop, behavior: "smooth" });
      }
    : undefined;
  const ctx: PieceCtx = { language, art, isActive, onNavigate: closeMenu, inert: frozen, intercept };
  const barArt = art ? pickArt(config.barArt, language) : null;
  const drawn = config.style === "drawn" && pickArt(config.barArt, language);

  return (
    <header
      ref={setHeader}
      className="site-header site-nav"
      data-style={config.style}
      data-layout={config.layout}
      data-scroll={scroll}
      data-float={float ? "true" : undefined}
      data-hidden={hidden ? "true" : undefined}
      data-solid={solid ? "true" : undefined}
      data-indicator={look.indicator}
      data-divider={look.divider ? "true" : undefined}
      data-mobile-hidden={config.mobile.hidden ? "true" : undefined}
      data-panel={config.mobile.panel}
      data-menu-open={menuOpen ? "true" : undefined}
      data-own-font={ownFont ? "true" : undefined}
      data-preview={preview ? (frozen ? "frozen" : "live") : undefined}
      style={vars}
    >
      <div className="site-nav__inner">
        <div className="site-nav__bg" aria-hidden="true">
          {barArt && !drawn && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={barArt.url} alt="" draggable={false} className="site-nav__bg-art" />
          )}
        </div>

        {/* Desktop bar */}
        <div className="site-nav__desk">
          {drawn ? (
            <DrawnBar config={config} ctx={ctx} langSkin={langSkin} />
          ) : (
            <StandardBar config={config} ctx={ctx} langSkin={langSkin} />
          )}
        </div>

        {/* Phone bar */}
        <div className="site-nav__phone">
          {art && hasArt(config.mobile.barArt) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pickArt(config.mobile.barArt, language)!.url} alt="" aria-hidden="true" draggable={false} className="site-nav__bg-art" />
          )}
          <Logo config={config} ctx={ctx} />
          <div className="site-nav__phone-end">
            {/* Always here on phones: the floating pill would cover the menu button. */}
            <LanguageButton skin={langSkin} language={language} inert={frozen} />
            {(config.links.length > 0 || config.cta.enabled) && (
              <MenuButton
                config={config}
                language={language}
                open={menuOpen}
                panelId={panelId}
                onToggle={() => !frozen && setMenuOpen((o) => !o)}
              />
            )}
          </div>
        </div>
      </div>

      <MobilePanel
        config={config}
        ctx={ctx}
        id={panelId}
        open={menuOpen}
        onClose={closeMenu}
        trapFocus={!preview}
      />
    </header>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────

interface PieceCtx {
  language: Lang;
  /** Art allowed (hybrid / drawn). */
  art: boolean;
  isActive: (href: string) => boolean;
  onNavigate: () => void;
  inert: boolean;
  /** Editor preview: handle the click instead of following the link. */
  intercept?: (href: string) => void;
}

function hashOf(href: string): string | null {
  const i = href.indexOf("#");
  if (i < 0 || i === href.length - 1) return null;
  // "#about" or "/#about" (same page) — not another page's anchor.
  const path = href.slice(0, i);
  if (path && path !== "/") return null;
  return decodeURIComponent(href.slice(i + 1));
}

function label(l: { label: { en: string; ar: string } }, language: Lang) {
  return l.label[language] || l.label.en;
}

/** Base art + optional hover / active swaps. */
function ArtStack({
  art,
  hoverArt,
  activeArt,
  language,
  className,
}: {
  art?: LocalizedArt;
  hoverArt?: LocalizedArt;
  activeArt?: LocalizedArt;
  language: Lang;
  className: string;
}) {
  const base = pickArt(art, language);
  const hover = pickArt(hoverArt, language);
  const active = pickArt(activeArt, language);
  return (
    <span className={`site-nav__art ${className}`} aria-hidden="true">
      {/* eslint-disable @next/next/no-img-element */}
      {base && <img src={base.url} alt="" draggable={false} className="site-nav__art-base" />}
      {hover && <img src={hover.url} alt="" draggable={false} className="site-nav__art-hover" />}
      {active && <img src={active.url} alt="" draggable={false} className="site-nav__art-active" />}
      {/* eslint-enable @next/next/no-img-element */}
    </span>
  );
}

function NavAnchor({
  link,
  ctx,
  className,
  children,
  style,
}: {
  link: NavLink;
  ctx: PieceCtx;
  className: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const active = ctx.isActive(link.href);
  return (
    <a
      href={link.href}
      target={link.newTab ? "_blank" : undefined}
      rel={link.newTab ? "noopener noreferrer" : undefined}
      className={className}
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      tabIndex={ctx.inert ? -1 : undefined}
      onClick={(e) => {
        if (ctx.inert || ctx.intercept) e.preventDefault();
        if (ctx.inert) return;
        ctx.intercept?.(link.href);
        ctx.onNavigate();
      }}
      style={style}
    >
      {children}
    </a>
  );
}

function LinkItem({ link, ctx }: { link: NavLink; ctx: PieceCtx }) {
  const drawn = ctx.art && hasArt(link.art);
  return (
    <NavAnchor link={link} ctx={ctx} className={`site-nav__link ${drawn ? "site-nav__link--art" : ""}`}>
      {drawn ? (
        <>
          <ArtStack art={link.art} hoverArt={link.hoverArt} activeArt={link.activeArt} language={ctx.language} className="site-nav__link-art" />
          <span className="sr-only">{label(link, ctx.language)}</span>
        </>
      ) : (
        label(link, ctx.language)
      )}
    </NavAnchor>
  );
}

function Cta({ config, ctx }: { config: HeaderConfig; ctx: PieceCtx }) {
  const cta = config.cta;
  if (!cta.enabled) return null;
  const drawn = ctx.art && hasArt(cta.art);
  return (
    <NavAnchor
      link={cta}
      ctx={ctx}
      className={`site-nav__cta ${drawn ? "site-nav__cta--art" : `site-nav__cta--${cta.variant}`}`}
    >
      {drawn ? (
        <>
          <ArtStack art={cta.art} hoverArt={cta.hoverArt} activeArt={cta.activeArt} language={ctx.language} className="site-nav__link-art" />
          <span className="sr-only">{label(cta, ctx.language)}</span>
        </>
      ) : (
        label(cta, ctx.language)
      )}
    </NavAnchor>
  );
}

function Logo({ config, ctx }: { config: HeaderConfig; ctx: PieceCtx }) {
  const text = config.logoText[ctx.language] || config.logoText.en;
  const art = ctx.art ? pickArt(config.logoArt, ctx.language) : null;
  return (
    <Link
      href="/"
      className="site-nav__logo"
      tabIndex={ctx.inert ? -1 : undefined}
      onClick={(e) => {
        if (ctx.inert || ctx.intercept) e.preventDefault();
        if (!ctx.inert) ctx.onNavigate();
      }}
    >
      {art ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.url} alt="" draggable={false} className="site-nav__logo-art" />
          <span className="sr-only">{text}</span>
        </>
      ) : (
        text
      )}
    </Link>
  );
}

function LanguageButton({ skin, language, inert }: { skin?: ChromeSkin; language: Lang; inert: boolean }) {
  const setLanguage = useLandingStore((s) => s.setLanguage);
  return (
    <button
      type="button"
      className="site-nav__lang chrome-slot"
      data-has-art={skin?.art?.en || skin?.art?.ar ? "true" : undefined}
      tabIndex={inert ? -1 : undefined}
      onClick={() => !inert && setLanguage(language === "en" ? "ar" : "en")}
      aria-label={language === "en" ? "Switch to Arabic" : "Switch to English"}
    >
      <ChromeArt skin={skin} language={language}>
        {language === "en" ? "العربية" : "English"}
      </ChromeArt>
    </button>
  );
}

function StandardBar({ config, ctx, langSkin }: { config: HeaderConfig; ctx: PieceCtx; langSkin?: ChromeSkin }) {
  const links = config.links.map((l) => <LinkItem key={l.id} link={l} ctx={ctx} />);
  const end = (
    <>
      <Cta config={config} ctx={ctx} />
      {config.languageButton && <LanguageButton skin={langSkin} language={ctx.language} inert={ctx.inert} />}
    </>
  );
  if (config.layout === "logoCenterSplit") {
    const half = Math.ceil(links.length / 2);
    return (
      <div className="site-nav__row site-nav__row--split">
        <nav className="site-nav__links site-nav__links--start" aria-label="Main">
          {links.slice(0, half)}
        </nav>
        <Logo config={config} ctx={ctx} />
        <div className="site-nav__links site-nav__links--end">
          {links.slice(half)}
          {end}
        </div>
      </div>
    );
  }
  if (config.layout === "logoCenterStacked") {
    return (
      <div className="site-nav__row site-nav__row--stacked">
        <Logo config={config} ctx={ctx} />
        <nav className="site-nav__links" aria-label="Main">
          {links}
          {end}
        </nav>
      </div>
    );
  }
  return (
    <div className="site-nav__row">
      <Logo config={config} ctx={ctx} />
      <nav className="site-nav__links site-nav__links--end" aria-label="Main">
        {links}
        {end}
      </nav>
    </div>
  );
}

/** The whole bar is one drawing; the logo + links are hotspots on it. */
function DrawnBar({ config, ctx, langSkin }: { config: HeaderConfig; ctx: PieceCtx; langSkin?: ChromeSkin }) {
  const bar = pickArt(config.barArt, ctx.language)!;
  const pos = (h: { x: number; y: number; w: number; h: number }): React.CSSProperties => ({
    left: `${h.x}%`,
    top: `${h.y}%`,
    width: `${h.w}%`,
    height: `${h.h}%`,
  });
  const linksAndCta = [...config.links, ...(config.cta.enabled ? [config.cta] : [])];
  const logo = config.logoHotspot ?? DEFAULT_LOGO_HOTSPOT;
  const logoText = config.logoText[ctx.language] || config.logoText.en;
  return (
    // The drawing isn't mirrored for Arabic, so hotspots stay left-anchored.
    <div className="site-nav__drawn" dir="ltr" style={{ aspectRatio: `${bar.naturalW} / ${bar.naturalH}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bar.url} alt="" aria-hidden="true" draggable={false} className="site-nav__drawn-img" />
      <Link
        href="/"
        className="site-nav__hotspot"
        style={pos(logo)}
        aria-label={logoText}
        tabIndex={ctx.inert ? -1 : undefined}
        onClick={(e) => (ctx.inert || ctx.intercept) && e.preventDefault()}
      />
      <nav aria-label="Main" className="contents">
        {linksAndCta.map((l, i) => (
          <NavAnchor
            key={l.id}
            link={l}
            ctx={ctx}
            className="site-nav__hotspot"
            style={pos(l.hotspot ?? defaultHotspot(i, linksAndCta.length))}
          >
            <ArtStack art={undefined} hoverArt={l.hoverArt} activeArt={l.activeArt} language={ctx.language} className="site-nav__hotspot-art" />
            <span className="sr-only">{label(l, ctx.language)}</span>
          </NavAnchor>
        ))}
      </nav>
      {config.languageButton && (
        <div className="site-nav__drawn-lang">
          <LanguageButton skin={langSkin} language={ctx.language} inert={ctx.inert} />
        </div>
      )}
    </div>
  );
}

function MenuButton({
  config,
  language,
  open,
  panelId,
  onToggle,
}: {
  config: HeaderConfig;
  language: Lang;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const art = config.style !== "standard" ? pickArt(config.mobile.menuButtonArt, language) : null;
  return (
    <button
      type="button"
      className="site-nav__menu-btn"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={language === "ar" ? "القائمة" : "Menu"}
      onClick={onToggle}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art.url} alt="" draggable={false} className="site-nav__btn-art" />
      ) : (
        <span className="site-nav__burger" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
    </button>
  );
}

function MobilePanel({
  config,
  ctx,
  id,
  open,
  onClose,
  trapFocus,
}: {
  config: HeaderConfig;
  ctx: PieceCtx;
  id: string;
  open: boolean;
  onClose: () => void;
  trapFocus: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const language = ctx.language;
  const panelArt = ctx.art ? pickArt(config.mobile.panelArt, language) : null;
  const closeArt = ctx.art ? pickArt(config.mobile.closeButtonArt, language) : null;

  // Real site: focus into the menu, Esc / Tab trap, lock the page scroll
  // behind a full-screen menu.
  useEffect(() => {
    if (!open || !trapFocus) return;
    const el = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>("a[href], button") ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const fullscreen = config.mobile.panel === "fullscreen";
    const prevOverflow = document.documentElement.style.overflow;
    if (fullscreen) document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (fullscreen) document.documentElement.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, trapFocus, onClose, config.mobile.panel]);

  return (
    <div
      ref={ref}
      id={id}
      className="site-nav__panel"
      data-open={open ? "true" : undefined}
      role="dialog"
      aria-modal={config.mobile.panel === "fullscreen" ? true : undefined}
      aria-label={language === "ar" ? "القائمة" : "Menu"}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      {panelArt && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={panelArt.url} alt="" aria-hidden="true" draggable={false} className="site-nav__panel-art" />
      )}
      {config.mobile.panel === "fullscreen" && (
        <button
          type="button"
          className="site-nav__close-btn"
          aria-label={language === "ar" ? "إغلاق" : "Close menu"}
          onClick={onClose}
        >
          {closeArt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={closeArt.url} alt="" draggable={false} className="site-nav__btn-art" />
          ) : (
            <span aria-hidden="true">✕</span>
          )}
        </button>
      )}
      <nav className="site-nav__panel-links" aria-label="Main">
        {config.links.map((l) => (
          <LinkItem key={l.id} link={l} ctx={ctx} />
        ))}
        <Cta config={config} ctx={ctx} />
      </nav>
    </div>
  );
}
