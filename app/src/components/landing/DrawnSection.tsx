"use client";

// DrawnSection — renders a DrawnSection from the schema as accessible
// HTML. Each asset becomes one of three elements based on its role:
//
//   - decoration → <img alt="" aria-hidden="true">
//   - link       → <a href> wrapping <img>
//   - button     → <button type="button"> wrapping <img>
//
// Focus rings are CSS (not drawn). Touch targets are constrained to a
// 72×72 CSS-px minimum via min-width/height to meet WCAG mobile spec
// even if the artist drew something tiny.
//
// Parallax + reveal animations are wired by useLandingMotion, which
// queries `[data-asset-iid]` and `[data-section-id]` selectors set
// below.

import { useContext } from "react";
import { useLandingStore } from "@/stores/landingStore";
import type { DrawnAsset, DrawnSection } from "@/data/landingTypes";
import SectionSurface, { hasBottomTornEdge } from "./SectionSurface";
import { useLandingActions, parseActionId } from "@/lib/landingActions";
import { getBlockDef } from "./blocks/registry";
import AssetImage from "./AssetImage";
import { useHoverDefault } from "./hoverEffect";
import { CustomFontsContext } from "./SiteFonts";
import { elementFontFamily } from "@/data/fonts";

interface DrawnSectionProps {
  section: DrawnSection;
  /**
   * Editor-only interaction layer, rendered as the last child of the asset
   * canvas box so it shares the exact same percentage coordinate frame as the
   * assets (no measurement needed). Production never passes this — the public
   * render is byte-identical to before.
   */
  editorOverlay?: React.ReactNode;
}

export default function DrawnSection({ section, editorOverlay }: DrawnSectionProps) {
  const language = useLandingStore((s) => s.language);


  // `background` (image/drawn only — `color` is deprecated in favour of
  // `surface.color`) is an art layer painted ON TOP of the surface, e.g.
  // a full-bleed illustration. Rendered between the surface and the text.
  const bg = section.background;
  const bgImageStyle: React.CSSProperties | undefined =
    bg?.kind === "image" || bg?.kind === "drawn"
      ? {
          backgroundImage: `url(${bg.kind === "image" ? bg.src : bg.pngUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : undefined;

  return (
    <section
      data-section-id={section.id}
      data-reveal={section.revealStyle ?? "fade-up"}
      data-surface={section.surface?.kind ?? "paper"}
      data-paper={section.surface?.kind === "paper" ? (section.surface.paper ?? "sketchbook") : undefined}
      data-has-bottom-edge={hasBottomTornEdge(section.surface) ? "true" : undefined}
      className="drawn-section relative w-full"
      style={{ minHeight: `${section.minHeightVh ?? 100}svh` }}
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      <SectionSurface surface={section.surface} seed={section.iid} />
      {bgImageStyle && (
        <div className="absolute inset-0 z-[1]" style={bgImageStyle} aria-hidden="true" />
      )}

      {/* Asset canvas — drawings, text and components positioned by percentage. */}
      <DrawnAssetLayer
        assets={section.assets}
        aspectRatio={section.aspectRatio}
        language={language}
        editorOverlay={editorOverlay}
        mode={section.horizontalScroll ? "hscroll" : "normal"}
        heightVh={section.minHeightVh}
        autoStack={section.autoStackMobile}
      />
    </section>
  );
}

// ─── Reusable asset layer ───────────────────────────────────────
//
// The percentage-positioned asset canvas. Shared by DrawnSection (normal +
// horizontal-scroll) and HeroSection (the "hero" overlay around the cabinet),
// so all three share one asset-rendering + coordinate-frame implementation.

/**
 * Reading order for the auto-stacked phone column. Plain desktop-Y order
 * interleaves side-by-side columns (a 3-up feature grid became image, image,
 * image, title, title, title…). Instead: wide elements (≥ 55% of the width —
 * headings, banners) act as dividers that stay where they are vertically,
 * and the narrower elements between two dividers are grouped into columns
 * (by horizontal overlap), read column by column, top to bottom inside each.
 */
function autoStackOrder(assets: DrawnAsset[]): Map<string, number> {
  const byY = [...assets].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: DrawnAsset[] = [];
  let run: DrawnAsset[] = [];
  const flush = () => {
    const cols: { x0: number; x1: number; items: DrawnAsset[] }[] = [];
    for (const a of run) {
      const col = cols.find((c) => a.x < c.x1 && a.x + a.w > c.x0);
      if (col) {
        col.items.push(a);
        col.x0 = Math.min(col.x0, a.x);
        col.x1 = Math.max(col.x1, a.x + a.w);
      } else cols.push({ x0: a.x, x1: a.x + a.w, items: [a] });
    }
    cols.sort((a, b) => a.x0 - b.x0);
    for (const c of cols) out.push(...c.items.sort((a, b) => a.y - b.y));
    run = [];
  };
  for (const a of byY) {
    if (a.w >= 55) {
      flush();
      out.push(a);
    } else run.push(a);
  }
  flush();
  return new Map(out.map((a, i) => [a.iid, i]));
}

/**
 * How wide the asset canvas renders, for next/image `sizes` (so the browser
 * picks a sensibly-sized variant instead of the full-res upload) and the
 * canvas aspect (for auto-stack image boxes). Normal sections are
 * `min(100%, 90rem)` wide; hscroll/hero canvases are sized by HEIGHT
 * (`heightVh` svh × aspect), so their vw width depends on the viewport's
 * shape — estimated with a typical landscape desktop (h/w ≈ 0.625) and
 * portrait phone (h/w ≈ 2.2). An estimate is fine: `sizes` only steers
 * variant choice, it never affects layout.
 */
export interface CanvasSizing {
  /** Canvas width in vw on desktop / on phones. */
  desktopVw: number;
  mobileVw: number;
  /** Max canvas width in px on desktop (normal sections cap at 90rem). */
  desktopMaxPx?: number;
  /** Canvas width / height. */
  aspect: number;
  /** Auto-stack widens elements on phones (normal sections that opt in). */
  autoStack: boolean;
}

function canvasSizing(
  mode: "normal" | "hscroll" | "hero" | "arcade",
  aspectRatio: { w: number; h: number },
  heightVh?: number,
  autoStack?: boolean,
  zoom = 1
): CanvasSizing {
  const aspect = aspectRatio.w / aspectRatio.h;
  if (mode === "arcade") {
    // The arcade world is at most the viewport wide, but the camera can zoom
    // it — `zoom` (the largest camera scale it will be shown at) widens the
    // `sizes` hint so next/image serves a file sharp enough for the zoom.
    return {
      desktopVw: 100 * zoom,
      mobileVw: 100 * zoom,
      aspect,
      autoStack: false,
    };
  }
  if (mode === "normal") {
    return {
      desktopVw: 100,
      mobileVw: 100,
      desktopMaxPx: 1440,
      aspect,
      autoStack: Boolean(autoStack),
    };
  }
  const h = heightVh ?? (mode === "hscroll" ? 80 : 100);
  return {
    desktopVw: h * aspect * 0.625,
    mobileVw: h * aspect * 2.2,
    aspect,
    autoStack: false,
  };
}

/** `sizes` for an asset `wPct` % of the canvas wide (mobile: `wMobilePct`). */
function assetSizes(canvas: CanvasSizing, wPct: number, wMobilePct: number): string {
  const round = (n: number) => Math.max(1, Math.ceil(n));
  // Auto-stack widens elements to min(w × 2.2, 86%) on phones — cover it.
  const mobilePct = canvas.autoStack
    ? Math.max(wMobilePct, Math.min(wPct * 2.2, 86))
    : wMobilePct;
  const mobileVw = round((mobilePct / 100) * canvas.mobileVw);
  const desktopVw = round((wPct / 100) * canvas.desktopVw);
  const desktop = canvas.desktopMaxPx
    ? `min(${desktopVw}vw, ${round((wPct / 100) * canvas.desktopMaxPx)}px)`
    : `${desktopVw}vw`;
  return `(max-width: 767px) ${mobileVw}vw, ${desktop}`;
}

export function DrawnAssetLayer({
  assets,
  aspectRatio,
  language,
  editorOverlay,
  reference,
  mode = "normal",
  heightVh,
  autoStack,
  arcade,
}: {
  assets: DrawnAsset[];
  aspectRatio: { w: number; h: number };
  language: "en" | "ar";
  editorOverlay?: React.ReactNode;
  /** Behind-the-assets reference layer (e.g. the editor's cabinet outline). */
  reference?: React.ReactNode;
  mode?: "normal" | "hscroll" | "hero" | "arcade";
  heightVh?: number;
  /** Reflow into a vertical column on mobile (see globals.css auto-stack). */
  autoStack?: boolean;
  /** mode="arcade" only: the world box (camera target) — see ArcadeScene. */
  arcade?: {
    boxRef?: React.Ref<HTMLDivElement>;
    boxStyle?: React.CSSProperties;
    boxAttrs?: Record<string, string | undefined>;
    /** Largest camera scale the world is shown at (image `sizes`). */
    zoom?: number;
    /** Extra data-* attributes per asset (play-mode fade flags). */
    assetAttrs?: (asset: DrawnAsset) => Record<string, string | undefined>;
  };
}) {
  const aspectVar = `${aspectRatio.w} / ${aspectRatio.h}`;
  const canvas = canvasSizing(mode, aspectRatio, heightVh, autoStack, arcade?.zoom);
  const stackOrder = autoStackOrder(assets);
  const children = (
    <>
      {reference}
      {assets.map((asset) => (
        <DrawnAssetView
          key={asset.iid}
          asset={asset}
          language={language}
          canvas={canvas}
          stackOrder={stackOrder.get(asset.iid)}
          extraAttrs={arcade?.assetAttrs?.(asset)}
          // The arcade scene IS the first viewport: its backdrop was the desktop
          // LCP element and sat behind loading="lazy".
          eager={mode === "arcade"}
          // Only the editor passes an overlay — lets components show authoring
          // hints (empty slots, placeholders) that visitors never see.
          editor={editorOverlay !== undefined}
        />
      ))}
      {editorOverlay}
    </>
  );

  // Normal mode: the CSS CONTAINER is an OUTER wrapper (not the canvas) so a
  // @container query can style the canvas ITSELF (a container can't query its
  // own size to style itself) — needed for auto-stack, which turns the canvas
  // into a flex column on mobile. Assets + text cqw key off the same wrapper.
  if (mode === "normal") {
    return (
      <div
        className="drawn-section__container relative z-10 mx-auto"
        style={{ containerType: "inline-size", width: "min(100%, 90rem)" }}
        data-autostack={autoStack ? "true" : undefined}
      >
        <div
          className="drawn-section__canvas relative w-full"
          style={{ "--canvas-aspect": aspectVar } as React.CSSProperties}
        >
          {children}
        </div>
      </div>
    );
  }

  // Arcade: the world box — sized/positioned by the stage (globals.css
  // `.arcade-world`), moved by the camera. Still the CSS container, so text
  // cqw and the per-asset @container rules key off the world's width.
  if (mode === "arcade") {
    return (
      <div
        ref={arcade?.boxRef}
        className="arcade-world drawn-section__canvas"
        style={
          {
            "--canvas-aspect": aspectVar,
            "--world-a": aspectRatio.w / aspectRatio.h,
            containerType: "inline-size",
            ...arcade?.boxStyle,
          } as React.CSSProperties
        }
        {...arcade?.boxAttrs}
      >
        {children}
      </div>
    );
  }

  // hscroll / hero: no auto-stack; container-type stays on the canvas.
  const boxStyle = {
    "--canvas-aspect": aspectVar,
    containerType: "inline-size",
    height: `${heightVh ?? (mode === "hscroll" ? 80 : 100)}svh`,
  } as React.CSSProperties;
  const box = (
    <div className="drawn-section__canvas relative z-10" style={boxStyle}>
      {children}
    </div>
  );
  if (mode === "hscroll") {
    return (
      <div className="drawn-section__hscroll relative z-10 w-full overflow-x-auto">
        {box}
      </div>
    );
  }
  return box;
}

// ─── Asset renderer ─────────────────────────────────────────────

function DrawnAssetView({
  asset,
  language,
  canvas,
  editor,
  stackOrder,
  extraAttrs,
  eager,
}: {
  asset: DrawnAsset;
  language: "en" | "ar";
  canvas: CanvasSizing;
  editor?: boolean;
  /** Position in the auto-stack column (see autoStackOrder). */
  stackOrder?: number;
  /** Extra data-* attributes (arcade play-mode flags). */
  extraAttrs?: Record<string, string | undefined>;
  /** First-viewport art (the arcade scene): never lazy-load it. */
  eager?: boolean;
}) {
  // Hook must run unconditionally, before the role-based early returns below.
  // Null outside a provider (e.g. the editor canvas) → buttons stay inert.
  const actions = useLandingActions();
  const hoverDefault = useHoverDefault();
  const hover = asset.hoverEffect ?? hoverDefault;

  const isText = asset.source.kind === "text";
  const isComponent = asset.source.kind === "component";
  const src =
    asset.source.kind === "drawn"
      ? asset.source.pngUrl
      : asset.source.kind === "upload"
        ? asset.source.url
        : "";

  // Position via CSS variables + the `.drawn-asset-pos` class (see globals.css).
  // Desktop values feed left/top/w/h/rotation directly; a `@container` rule
  // swaps in the mobile (--*-m) values below the breakpoint — works on real
  // phones AND in the editor's narrow phone view (the canvas is a container).
  const m = asset.mobile ?? {};
  const posStyle = {
    "--x-d": `${asset.x}%`,
    "--y-d": `${asset.y}%`,
    "--w-d": `${asset.w}%`,
    "--h-d": `${asset.h}%`,
    "--rot-d": `${asset.rotation ?? 0}deg`,
    "--x-m": `${m.x ?? asset.x}%`,
    "--y-m": `${m.y ?? asset.y}%`,
    "--w-m": `${m.w ?? asset.w}%`,
    "--h-m": `${m.h ?? asset.h}%`,
    "--rot-m": `${m.rotation ?? asset.rotation ?? 0}deg`,
    zIndex: asset.zIndex,
    // Stack order for auto-stack mobile (flex column) — reading order from
    // autoStackOrder(). Ignored in the default absolute layout.
    order: stackOrder ?? Math.round(asset.y),
    // Pixel aspect of the authored desktop box (% of width vs % of height of
    // a canvas with its own aspect). Auto-stack gives image boxes this
    // aspect-ratio, since a `fill` image has no intrinsic height to flow by.
    "--img-aspect": `${(asset.w * canvas.aspect) / Math.max(asset.h, 0.01)}`,
  } as React.CSSProperties;

  // Common dataset for useLandingMotion's parallax + reveal selectors, plus the
  // per-device visibility flags consumed by the @container rules.
  const dataAttrs = {
    "data-asset-iid": asset.iid,
    "data-asset-role": asset.role.kind,
    "data-parallax": asset.parallax?.factor ?? 0,
    "data-hide-mobile": m.hidden ? "true" : undefined,
    "data-free-mobile": m.free ? "true" : undefined,
    "data-title-role": asset.titleRole,
    "data-hide-desktop": asset.hiddenOnDesktop ? "true" : undefined,
    ...extraAttrs,
  } as Record<string, unknown>;

  // Inner visual — a component, the text content, or the drawn/uploaded image.
  const content =
    asset.source.kind === "component" ? (
      <ComponentAssetInner source={asset.source} language={language} editor={editor} />
    ) : asset.source.kind === "text" ? (
      <TextAssetInner source={asset.source} language={language} titleRole={asset.titleRole} />
    ) : (
      <AssetImage
        src={src}
        sizes={assetSizes(canvas, asset.w, m.w ?? asset.w)}
        eager={eager}
      />
    );
  // Idle motion loop (sway/float/flicker/pulse) on an inner wrapper, so it
  // never fights the positioning transform or the reveal channels.
  const autoHeight = asset.source.kind === "component" && Boolean(asset.source.autoHeight);
  const inner = asset.ambient ? (
    <AmbientWrap preset={asset.ambient} fill={!autoHeight}>
      {content}
    </AmbientWrap>
  ) : (
    content
  );

  // Image-backed boxes get `--img` so auto-stack can give them an aspect-ratio.
  const imgMarker = isText || isComponent ? "" : " drawn-asset-pos--img";

  // Components own their interactivity (carousel arrows, accordion rows), so
  // they are never wrapped in a link/button asset — that would nest interactive
  // elements and break both behaviour and a11y. `makeComponentAsset` always
  // assigns role `decoration`; this guard keeps that true for hand-edited data.
  if (isComponent) {
    const autoH =
      asset.source.kind === "component" && asset.source.autoHeight
        ? " drawn-asset-pos--auto-h"
        : " drawn-asset-pos--box";
    return (
      <div className={`drawn-asset-pos${autoH}`} style={posStyle} {...dataAttrs}>
        {inner}
      </div>
    );
  }

  // Public site: a button with no action would be a dead click, so it renders
  // like a decoration (no pointer, no hover lift, no button role). The editor
  // keeps the real button so it stays selectable.
  const deadButton =
    !editor &&
    asset.role.kind === "button" &&
    !(asset.role.actionId ?? "").trim();

  if (asset.role.kind === "decoration" || deadButton) {
    // Text decoration is real, readable content; image decoration is aria-hidden.
    return isText ? (
      <div className="drawn-asset-pos" style={posStyle} {...dataAttrs}>
        {inner}
      </div>
    ) : (
      <div
        aria-hidden="true"
        className="drawn-asset-pos drawn-asset-pos--img"
        style={posStyle}
        {...dataAttrs}
      >
        {inner}
      </div>
    );
  }

  if (asset.role.kind === "link") {
    const label = (language === "ar" ? asset.labelAr : asset.label) ?? "Link";
    const description =
      language === "ar" ? asset.descriptionAr : asset.description;
    return (
      <a
        href={asset.role.href}
        target={asset.role.newTab ? "_blank" : undefined}
        rel={asset.role.newTab ? "noopener noreferrer" : undefined}
        aria-label={label}
        title={description ?? label}
        className={`drawn-asset drawn-asset--interactive drawn-asset-pos${imgMarker} focus-visible:outline-3 focus-visible:outline-offset-4`}
        style={{ ...posStyle, minWidth: 72, minHeight: 72 }}
        data-hover={hover}
        {...dataAttrs}
      >
        {inner}
      </a>
    );
  }

  // role === "button"
  const label = (language === "ar" ? asset.labelAr : asset.label) ?? "Button";
  const actionId = asset.role.actionId;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        // Decode the stored actionId and dispatch to the page's action
        // handler. No provider (e.g. editor canvas) or unparseable id → inert.
        if (!actions) return;
        const action = parseActionId(actionId);
        if (action) actions.dispatch(action);
      }}
      className={`drawn-asset drawn-asset--interactive drawn-asset-pos${imgMarker} focus-visible:outline-3 focus-visible:outline-offset-4`}
      style={{ ...posStyle, minWidth: 72, minHeight: 72, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      data-hover={hover}
      {...dataAttrs}
    >
      {inner}
    </button>
  );
}

// ─── Ambient motion ─────────────────────────────────────────────

/** Wraps content in an idle animation loop (globals.css `.ambient`). Shared by
 *  scene assets and the arcade machine. Off under reduced motion (CSS). */
export function AmbientWrap({
  preset,
  fill = true,
  children,
}: {
  preset: NonNullable<DrawnAsset["ambient"]>;
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={fill ? "ambient ambient--fill" : "ambient"}
      data-ambient={preset.kind}
      data-ambient-devices={preset.devices && preset.devices !== "both" ? preset.devices : undefined}
      style={
        {
          "--amb-k": Math.min(1, Math.max(0, preset.strength)),
          "--amb-dur": `${Math.max(0.3, preset.speed)}s`,
          transformOrigin: `${preset.pivotX}% ${preset.pivotY}%`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

// ─── Component asset ────────────────────────────────────────────
//
// A registry component placed as a normal canvas element. The asset box gives
// position + width; height either fills the box or is left to the content
// (`autoHeight`). This is what lets a carousel or accordion sit alongside
// hand-drawn art in the same section.

function ComponentAssetInner({
  source,
  language,
  editor,
}: {
  source: Extract<DrawnAsset["source"], { kind: "component" }>;
  language: "en" | "ar";
  editor?: boolean;
}) {
  const hoverDefault = useHoverDefault();
  const def = getBlockDef(source.block.type);
  if (!def) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-destructive/50 p-2 text-center text-xs text-destructive">
        Unknown component: {source.block.type}
      </div>
    );
  }
  return (
    <div className={source.autoHeight ? "w-full" : "h-full w-full overflow-hidden"}>
      {def.render(source.block.props, { language, editor, hoverDefault })}
    </div>
  );
}

// ─── Text asset ─────────────────────────────────────────────────

const FONT_CLASS: Record<string, string> = {
  display: "font-display",
  body: "font-sans",
  mono: "font-mono",
};
/** Smallest phone size for free text (cqw shrinks with the canvas). Section
 *  titles keep the old fixed title block's phone sizes (36px / 18px). */
function phoneFloor(fontSize: number, titleRole?: "heading" | "subheading") {
  if (titleRole === "heading" && fontSize >= 3.5) return "36px";
  if (titleRole === "subheading" && fontSize >= 1.2) return "18px";
  return fontSize >= 3.5 ? "22px" : "13px";
}
const ROLE_OF: Record<string, "display" | "body" | "mono"> = { display: "display", body: "body", mono: "mono" };

function TextAssetInner({
  source,
  language,
  titleRole,
}: {
  source: Extract<DrawnAsset["source"], { kind: "text" }>;
  language: "en" | "ar";
  /** The section's title → a real <h2> (subtitle → <p>) for a11y + SEO. */
  titleRole?: "heading" | "subheading";
}) {
  const { text, style } = source;
  const content = (language === "ar" ? text.ar : text.en) || text.en || "";
  const customFonts = useContext(CustomFontsContext);
  const ownFont = elementFontFamily(style.font, style.fontAr, language, customFonts, ROLE_OF[style.fontFamily] ?? "body");
  const Tag = titleRole === "heading" ? "h2" : titleRole === "subheading" ? "p" : "div";
  return (
    <Tag
      className={`drawn-text ${FONT_CLASS[style.fontFamily] ?? "font-sans"}`}
      style={
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          // Size + overflow live in CSS (.drawn-text) so the phone
          // container query can floor the size: cqw scales with the canvas,
          // which made body text ~4px on a 390px phone. Display-size text
          // gets a larger floor than body text.
          "--fs": `${style.fontSize}cqw`,
          "--fs-min": phoneFloor(style.fontSize, titleRole),
          fontWeight: style.fontWeight,
          color: style.color,
          textAlign: style.align,
          lineHeight: style.lineHeight ?? 1.15,
          fontStyle: style.italic ? "italic" : undefined,
          fontFamily: ownFont,
        } as React.CSSProperties
      }
    >
      {content}
    </Tag>
  );
}
