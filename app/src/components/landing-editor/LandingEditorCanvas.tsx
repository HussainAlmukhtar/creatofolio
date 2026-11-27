"use client";

// LandingEditorCanvas — WYSIWYG editor surface.
//
// Renders the REAL production <DrawnSection> components (pixel-accurate — same
// torn-paper surfaces, fonts, layout as visitors see) and injects an
// AssetOverlay into each section's asset canvas via the editorOverlay prop. The
// overlay provides click-to-select plus react-moveable drag/resize/rotate,
// writing back to the store as percentages so the real assets move live.
//
// A toolbar adds assets (upload an image, or drop a placeholder box) to the
// selected section.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import DrawnSection from "@/components/landing/DrawnSection";
import { AssetOverlay } from "./AssetOverlay";
import { removeAssetWithUndo, toggleAssetLockWithFeedback } from "@/lib/landingEditorActions";
import { isAssetLocked } from "@/lib/layerLock";
import LandingDrawModal from "./LandingDrawModal";
import { BlockPalette } from "./BlockPalette";
import { Button } from "@/components/ui/button";
import { ARCADE_MACHINE_IID, resolveArcade } from "@/data/arcadeConfig";
import { ArcadeEditorStage } from "./ArcadeEditorStage";
import { ZoomSurface } from "./ZoomSurface";
import { ZoomControls } from "./ZoomControls";
import { HoverDefaultContext, DEFAULT_HOVER_EFFECT } from "@/components/landing/hoverEffect";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import SiteNav from "@/components/landing/nav/SiteNav";
import SiteFonts, { CustomFontsContext } from "@/components/landing/SiteFonts";
import { pageFontKeys, typographyVars } from "@/data/fonts";
import { navFontKeys } from "@/data/navConfig";
import { sectionLabel } from "@/data/sectionTitles";
import type { CustomFont } from "@/data/landingTypes";
import { FormsContext, NO_FORMS } from "@/components/landing/formsContext";
import {
  useLandingEditorStore,
  selectCurrentDrawnPage,
} from "@/stores/landingEditorStore";
import type { DrawnAsset, DrawnSection as SectionData } from "@/data/landingTypes";
import { newIid } from "@/lib/iid";
import { PLACEHOLDER_SVG } from "@/data/landingPlaceholders";
import { sectionHiddenReason } from "@/data/sectionVisibility";
import { useMinuteClock } from "@/lib/useMinuteClock";
import { MediaLibraryDialog, type PickedImage } from "./MediaLibraryDialog";
import { Image as ImageIcon, LayoutGrid, PenTool, Plus, Square, Type as TypeIcon } from "lucide-react";
import { findFreeSpot, heightForImage, measureAsset, occupiedRects, planGrowth, rectsOverlap, unionRect } from "@/lib/landingPlacement";

// Given an asset's real pixel size, returns x/y-independent w/h PERCENTAGES
// (relative to the section canvas) that reproduce its true aspect ratio on
// screen — percentages are relative to different axes (w% of canvas width,
// h% of canvas height), so a naive equal w/h would stretch anything whose
// pixel aspect differs from the canvas's. Defaults to a ~20%-wide element,
// shrunk to fit within MAX on either axis (a tall/narrow drawing shouldn't
// default to spanning the whole canvas height).
/** Highest z in a section's stack — in the arcade the machine counts too,
 *  so new things land on top of it. */
function topZ(section: SectionData | undefined): number {
  if (!section) return 0;
  return section.assets.reduce(
    (m, a) => Math.max(m, a.zIndex),
    section.containsGame ? resolveArcade(section.arcade).machine.zIndex : 0
  );
}

function fitAssetSize(
  natural: { w: number; h: number },
  aspectRatio: { w: number; h: number }
): { w: number; h: number } {
  const containerAspect = aspectRatio.w / aspectRatio.h;
  const assetAspect = natural.w / natural.h || 1;
  const MAX = 70;
  const MIN = 4;
  let w = 20;
  let h = (w * containerAspect) / assetAspect;
  if (h > MAX) {
    w *= MAX / h;
    h = MAX;
  }
  if (w > MAX) {
    h *= MAX / w;
    w = MAX;
  }
  return { w: Math.max(MIN, w), h: Math.max(MIN, h) };
}

const NO_CUSTOM_FONTS: CustomFont[] = [];

export function LandingEditorCanvas() {
  const page = useLandingEditorStore(selectCurrentDrawnPage);
  const selectedSectionIid = useLandingEditorStore((s) => s.selectedSectionIid);
  const selectedAssetIid = useLandingEditorStore((s) => s.selectedAssetIid);
  const selectSection = useLandingEditorStore((s) => s.selectSection);
  const selectAsset = useLandingEditorStore((s) => s.selectAsset);
  const updateAssetTransform = useLandingEditorStore((s) => s.updateAssetTransform);
  const addAsset = useLandingEditorStore((s) => s.addAsset);
  const previewLanguage = useLandingEditorStore((s) => s.previewLanguage);
  const updateTextContent = useLandingEditorStore((s) => s.updateTextContent);
  const deviceMode = useLandingEditorStore((s) => s.deviceMode);
  // Site default hover effect for the canvas (data-hover on elements) and
  // the element form's "Site default (…)" label — hydrate the site config
  // once so both reflect the saved setting, not just the built-in default.
  const siteHoverDefault = useSiteConfigEditorStore(
    (st) => st.config.interactions?.hoverEffect ?? DEFAULT_HOVER_EFFECT
  );
  const siteForms = useSiteConfigEditorStore((st) => st.config.forms ?? NO_FORMS);
  const hydrateSiteConfig = useSiteConfigEditorStore((st) => st.hydrate);
  const siteNav = useSiteConfigEditorStore((st) => st.config.header);
  const siteTypography = useSiteConfigEditorStore((st) => st.config.typography);
  const siteLangSkin = useSiteConfigEditorStore((st) => st.config.chrome?.languagePill);
  const openNavStudio = useSiteConfigEditorStore((st) => st.setNavStudioOpen);
  useEffect(() => {
    void hydrateSiteConfig();
  }, [hydrateSiteConfig]);
  const now = useMinuteClock();
  const updateAssetMobile = useLandingEditorStore((s) => s.updateAssetMobile);
  const addComponentAsset = useLandingEditorStore((s) => s.addComponentAsset);
  const addAssets = useLandingEditorStore((s) => s.addAssets);
  const resizeSectionCanvas = useLandingEditorStore((s) => s.resizeSectionCanvas);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [replaceIid, setReplaceIid] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [blockPaletteOpen, setBlockPaletteOpen] = useState(false);

  // Selecting a section (in the Sections panel, or by adding into it) brings
  // it into view, as in any builder, unless it's already on screen.
  useEffect(() => {
    if (!selectedSectionIid) return;
    const el = document.querySelector<HTMLElement>(`[data-editor-section="${CSS.escape(selectedSectionIid)}"]`);
    const scroller = el?.closest<HTMLElement>("[data-editor-canvas]");
    if (!el || !scroller) return;
    const r = el.getBoundingClientRect();
    const v = scroller.getBoundingClientRect();
    const visible = Math.min(r.bottom, v.bottom) - Math.max(r.top, v.top);
    if (visible < Math.min(160, r.height / 2)) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedSectionIid]);

  if (!page) {
    return (
      <div className="flex flex-1 items-center justify-center bg-neutral-900 text-neutral-500">
        No page loaded.
      </div>
    );
  }

  // Which section receives new elements: the selected one, else the first.
  const targetSectionIid = selectedSectionIid ?? page.sections[0]?.iid ?? null;

  // What's already in a section, as it's actually rendered (auto-height
  // components are taller than their stored h). Desktop only: placement
  // writes desktop coordinates.
  const occupied = (section: SectionData | undefined) =>
    !section ? [] : deviceMode === "desktop" ? occupiedRects(section.id, section.assets) : section.assets;
  // Initial spot from what's on screen; `settle` then corrects it once the
  // new element has rendered at its real size.
  const placeIn = (section: SectionData | undefined, asset: DrawnAsset): DrawnAsset => {
    const { x, y } = findFreeSpot(occupied(section), asset.w, asset.h);
    return { ...asset, x, y };
  };
  // After an add renders: if the new element(s) overlap anything (auto-height
  // components are taller than their stored h), move them to free space; if
  // the section has no free space left, GROW the section below its content
  // and put them there — the way a builder section extends. Done with history
  // paused, so one Undo still removes the whole add (and the growth).
  const settle = (sectionIid: string, allIids: string[]) => {
    if (deviceMode !== "desktop" || allIids.length === 0) return;
    window.setTimeout(() => {
      const st = useLandingEditorStore.getState();
      const sec = st.currentPageSlug
        ? st.allPages[st.currentPageSlug]?.page.sections.find((x) => x.iid === sectionIid)
        : undefined;
      if (!sec) return;
      // A new backdrop-sized (locked) element stays exactly where it was put.
      const iids = allIids.filter((iid) => {
        const a = sec.assets.find((x) => x.iid === iid);
        return a ? !isAssetLocked(a, sec) : false;
      });
      if (iids.length === 0) return;
      const mine = iids
        .map((iid) => measureAsset(sec.id, iid))
        .filter((r): r is NonNullable<typeof r> => !!r);
      if (mine.length === 0) return;
      const group = unionRect(mine);
      const others = occupiedRects(sec.id, sec.assets.filter((a) => !iids.includes(a.iid)));
      if (!others.some((o) => rectsOverlap(group, o))) return;
      const temporal = useLandingEditorStore.temporal.getState();
      temporal.pause();
      try {
        const spot = findFreeSpot(others, group.w, group.h);
        if (!spot.full) {
          st.moveAssets(iids, spot.x - group.x, spot.y - group.y);
          return;
        }
        const plan = planGrowth(others, group);
        st.resizeSectionCanvas(sec.iid, sec.aspectRatio.h * plan.factor);
        // After the rescale the group sits at y/f; move it under the content.
        st.moveAssets(iids, plan.x - group.x, plan.y - group.y / plan.factor);
        toast("Section extended to fit the new element", { duration: 2500 });
      } finally {
        temporal.resume();
      }
    }, 250);
  };

  const makeAsset = (
    url: string,
    naturalSize?: { w: number; h: number },
    // Drawn in the studio with its layered PSD kept → re-editable later.
    sceneId?: string
  ): DrawnAsset => {
    const section = page.sections.find((s) => s.iid === targetSectionIid);
    const maxZ = topZ(section);
    const size =
      naturalSize && section ? fitAssetSize(naturalSize, section.aspectRatio) : { w: 20, h: 20 };
    return placeIn(section, {
      iid: newIid(),
      source: sceneId ? { kind: "drawn", sceneId, pngUrl: url } : { kind: "upload", url },
      x: 40,
      y: 40,
      w: size.w,
      h: size.h,
      zIndex: maxZ + 1,
      role: { kind: "decoration" },
      // Pixel size → the arcade's sharpness budget.
      naturalW: naturalSize?.w,
      naturalH: naturalSize?.h,
    });
  };

  const addBox = () => {
    if (!targetSectionIid) return toast.error("Add a section first.");
    const box = makeAsset(PLACEHOLDER_SVG);
    addAsset(targetSectionIid, box);
    settle(targetSectionIid, [box.iid]);
  };

  const addText = () => {
    if (!targetSectionIid) return toast.error("Add a section first.");
    const section = page.sections.find((s) => s.iid === targetSectionIid);
    const maxZ = topZ(section);
    const text = placeIn(section, {
      iid: newIid(),
      source: {
        kind: "text",
        text: { en: "Your text", ar: "نص" },
        style: {
          fontFamily: "display",
          fontSize: 4,
          fontWeight: 600,
          color: "#2b2b2b",
          align: "center",
          lineHeight: 1.15,
        },
      },
      x: 30,
      y: 35,
      w: 40,
      h: 12,
      zIndex: maxZ + 1,
      role: { kind: "decoration" },
    });
    addAsset(targetSectionIid, text);
    settle(targetSectionIid, [text.iid]);
  };

  // Batch-add a 3x2 grid of image placeholders — a "grid" is just several
  // assets at computed percentages, no new schema or rendering primitive
  // needed. The whole grid is placed as one block in the first free space.
  const addGrid = () => {
    if (!targetSectionIid) return toast.error("Add a section first.");
    const section = page.sections.find((s) => s.iid === targetSectionIid);
    if (!section) return;
    const cols = 3;
    const rows = 2;
    const gap = 2.5;
    const gridW = 72;
    const gridH = 56;
    const cellW = (gridW - gap * (cols - 1)) / cols;
    const cellH = (gridH - gap * (rows - 1)) / rows;
    const origin = findFreeSpot(occupied(section), gridW, gridH);
    const maxZ = topZ(section);
    const cells: DrawnAsset[] = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          iid: newIid(),
          source: { kind: "upload", url: PLACEHOLDER_SVG },
          x: origin.x + c * (cellW + gap),
          y: origin.y + r * (cellH + gap),
          w: cellW,
          h: cellH,
          zIndex: maxZ + 1 + i,
          role: { kind: "decoration" },
        });
        i++;
      }
    }
    // One undo step for the whole grid, settled as one block.
    addAssets(section.iid, cells);
    settle(section.iid, cells.map((c) => c.iid));
  };

  // Floating element toolbar on the canvas.
  const elementActions = {
    duplicate: (iid: string) => useLandingEditorStore.getState().duplicateAsset(iid),
    remove: (iid: string) => removeAssetWithUndo(iid),
    forward: (iid: string) => useLandingEditorStore.getState().bringAssetForward(iid),
    backward: (iid: string) => useLandingEditorStore.getState().sendAssetBackward(iid),
    replace: (iid: string) => setReplaceIid(iid),
    toggleLock: (iid: string) => void toggleAssetLockWithFeedback(iid),
  };
  const onReplacePick = ({ url, naturalSize }: PickedImage) => {
    const iid = replaceIid;
    if (!iid) return;
    const host = page.sections.find((s) => s.assets.some((a) => a.iid === iid));
    const asset = host?.assets.find((a) => a.iid === iid);
    if (!host || !asset) return;
    // Image BLOCK: swap its url prop; the block crops/fits into its frame.
    if (asset.source.kind === "component") {
      useLandingEditorStore.getState().updateComponentProps(iid, { url });
      return;
    }
    useLandingEditorStore.getState().updateAssetMeta(iid, {
      source: { kind: "upload", url },
      h: heightForImage(asset.w, host.aspectRatio, naturalSize, asset.h),
    });
  };

  // "Add image" opens the media library (pick an existing upload or upload new).
  const onPickImage = () => setLibraryOpen(true);
  const onLibraryPick = ({ url, naturalSize }: PickedImage) => {
    if (!targetSectionIid) return;
    const img = makeAsset(url, naturalSize);
    addAsset(targetSectionIid, img);
    settle(targetSectionIid, [img.iid]);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-muted/40">
      {/* Insert bar. One bar for every section: a component is just another
          element, so it sits beside text / image / shape. */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
        <InsertButton icon={<TypeIcon />} label="Text" onClick={addText} disabled={!targetSectionIid} title="Add free text (double-click it on the canvas to type)" />
        <InsertButton icon={<ImageIcon />} label="Image" onClick={onPickImage} disabled={!targetSectionIid} title="Add an image from your library, or upload one" />
        <InsertButton icon={<Square />} label="Shape" onClick={addBox} disabled={!targetSectionIid} title="Add an image frame (swap the picture with Replace)" />
        <InsertButton icon={<LayoutGrid />} label="Grid" onClick={addGrid} disabled={!targetSectionIid} title="Add a 3×2 grid of image frames" />
        <InsertButton
          icon={<PenTool />}
          label="Draw"
          onClick={() => (targetSectionIid ? setDrawing(true) : toast.error("Add a section first."))}
          disabled={!targetSectionIid}
          title="Draw a custom element in the drawing studio"
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          size="sm"
          onClick={() => setBlockPaletteOpen(true)}
          disabled={!targetSectionIid}
          title="Add a component: button, carousel, gallery, form, map…"
        >
          <Plus /> Component
        </Button>
        <ZoomControls />
        {targetSectionIid && (
          <span className="ms-auto hidden min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground md:flex" title="New elements go into the selected section">
            Adding to
            <span className="truncate rounded-md bg-background/70 px-1.5 py-0.5 font-medium text-foreground ring-1 ring-border">
              {(() => {
                const t = page.sections.find((x) => x.iid === targetSectionIid);
                return t ? sectionLabel(t) : "section";
              })()}
            </span>
          </span>
        )}
      </div>

      <MediaLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        title="Add an image"
        confirmLabel="Add to section"
        onPick={onLibraryPick}
      />
      <MediaLibraryDialog
        open={replaceIid !== null}
        onOpenChange={(o) => !o && setReplaceIid(null)}
        title="Replace image"
        confirmLabel="Replace"
        onPick={onReplacePick}
      />

      <BlockPalette
        open={blockPaletteOpen}
        onOpenChange={setBlockPaletteOpen}
        onPick={(blockType) => {
          // Drops in as a positioned asset, so it can be moved, resized and
          // layered with everything else in the section.
          if (!targetSectionIid) return;
          const section = page.sections.find((x) => x.iid === targetSectionIid);
          const iid = addComponentAsset(targetSectionIid, blockType, occupied(section));
          if (iid) settle(targetSectionIid, [iid]);
        }}
      />

      {drawing && targetSectionIid && (
        <LandingDrawModal
          // Big enough to stay crisp when the arcade camera zooms in; the
          // export is trimmed to the drawn pixels anyway.
          canvas={{ w: 1600, h: 1600 }}
          onClose={() => setDrawing(false)}
          onSaved={(url, naturalSize, sceneId) => {
            const drawn = makeAsset(url, naturalSize, sceneId);
            addAsset(targetSectionIid, drawn);
            settle(targetSectionIid, [drawn.iid]);
          }}
        />
      )}

      {/* Canvas. In mobile mode the page is constrained to a phone width so the
          section canvases (CSS containers) trigger their @container mobile
          rules — the same switch real phones use. */}
      <FormsContext.Provider value={siteForms}>
      <HoverDefaultContext.Provider value={siteHoverDefault}>
      <CustomFontsContext.Provider value={siteTypography?.customFonts ?? NO_CUSTOM_FONTS}>
      <SiteFonts typography={siteTypography} extraKeys={[...pageFontKeys(page), ...navFontKeys(siteNav)]} />
      <ZoomSurface
        deviceMode={deviceMode}
        pageStyle={typographyVars(siteTypography, previewLanguage) as React.CSSProperties | undefined}
        pageClassName={`site-fonts-scope mx-auto my-6 w-full bg-white shadow-2xl ${
          // Desktop keeps the canvas ≥ 820px so its section containers stay
          // above the 768px mobile breakpoint — on a 1280–1440px laptop the
          // panels left it 544–704px wide and the "Desktop" view silently
          // rendered the MOBILE layout. The canvas area scrolls instead.
          deviceMode === "mobile" ? "max-w-[390px]" : "min-w-[820px] max-w-5xl"
        }`}
      >
          {/* The site nav (shown on every page) — frozen in place; click it
              to open the Nav Studio. */}
          {siteNav.enabled && (
            // A div, not a <button>: the nav inside has its own links/buttons.
            <div
              role="button"
              tabIndex={0}
              onClick={() => openNavStudio(true)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openNavStudio(true))}
              title="Site nav (every page): click to edit in the Nav Studio"
              className="group relative block w-full text-start outline-offset-[-2px] hover:outline hover:outline-2 hover:outline-sky-500"
              dir={previewLanguage === "ar" ? "rtl" : "ltr"}
            >
              <SiteNav config={siteNav} language={previewLanguage} langSkin={siteLangSkin} preview={{ device: deviceMode, frozen: true }} />
              <span className="pointer-events-none absolute end-1 top-1 z-50 hidden rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-medium text-white group-hover:block touch:block">
                Nav · edit in Nav Studio
              </span>
            </div>
          )}
          {page.sections.map((section) => {
            // Active = the selected section, or the one holding the selected
            // element (an element can be selected from the layers list or
            // right after being added, with no section clicked first).
            const active =
              section.iid === selectedSectionIid ||
              (selectedAssetIid !== null && section.assets.some((a) => a.iid === selectedAssetIid));
            // Why (if at all) visitors on the previewed device won't see this
            // section right now — same rules as the public renderer.
            const hiddenReason = sectionHiddenReason(section, now, deviceMode);
            // Auto-stack sections lay out automatically on mobile — no manual
            // per-element positioning, so skip the drag overlay and show a hint.
            const autoStackedMobile =
              Boolean(section.autoStackMobile) && deviceMode === "mobile";
            const freeOnPhones = section.assets.filter((a) => a.mobile?.free);
            const renderOverlay = (
              sec: SectionData,
              stacked: boolean,
              extra?: React.ReactNode,
              machineLock?: React.ComponentProps<typeof AssetOverlay>["machineLock"]
            ) => (
              <AssetOverlay
                section={sec}
                selectedAssetIid={active ? selectedAssetIid : null}
                deviceMode={deviceMode}
                passThrough={stacked}
                machineLock={machineLock}
                isLocked={(iid) => {
                  const a = section.assets.find((x) => x.iid === iid);
                  return a ? isAssetLocked(a, section) : false;
                }}
                onSelectAsset={(iid) => {
                  if (!active) selectSection(section.iid);
                  selectAsset(iid);
                }}
                onBackgroundClick={() => selectSection(section.iid)}
                onTransform={(iid, t) =>
                  deviceMode === "mobile"
                    ? updateAssetMobile(iid, t)
                    : updateAssetTransform(iid, t)
                }
                actions={elementActions}
                onResizeCanvas={
                  stacked || section.horizontalScroll || section.blockType === "hero"
                    ? undefined
                    : (h) => resizeSectionCanvas(section.iid, h)
                }
                language={previewLanguage}
                onEditText={(iid, value) =>
                  updateTextContent(iid, previewLanguage, value)
                }
              >
                {extra}
              </AssetOverlay>
            );
            const overlay = autoStackedMobile ? (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center p-2">
                  <span className="select-none rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">
                    Auto-stacked on phones: order follows the desktop layout, top to
                    bottom. Click an element to edit it.
                  </span>
                  {active && selectedAssetIid && (
                    <style>{`[data-editor-canvas] .drawn-asset-pos[data-asset-iid="${CSS.escape(selectedAssetIid)}"]:not([data-free-mobile]){outline:2px solid #0ea5e9;outline-offset:3px}`}</style>
                  )}
                </div>
                {/* "Free on phones" elements stay hand-placed: normal handles. */}
                {freeOnPhones.length > 0 && renderOverlay({ ...section, assets: freeOnPhones }, true)}
              </>
            ) : (
              renderOverlay(section, false)
            );
            return (
              <div
                key={section.iid}
                data-editor-section={section.iid}
                data-active={active || undefined}
                className={`relative ${
                  active
                    ? "outline outline-2 outline-sky-500/70 outline-offset-[-2px]"
                    : ""
                }`}
                // Auto-stacked phone view has no drag overlay (the layout is
                // automatic), but elements are still click-to-select.
                onClickCapture={
                  autoStackedMobile
                    ? (e) => {
                        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-asset-iid]");
                        if (!el?.dataset.assetIid) return;
                        // Locked: click-through (it stays selectable from the layers list).
                        const hit = section.assets.find((x) => x.iid === el.dataset.assetIid);
                        if (hit && isAssetLocked(hit, section)) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        if (!active) selectSection(section.iid);
                        selectAsset(el.dataset.assetIid);
                      }
                    : undefined
                }
              >
                {deviceMode === "mobile" && !section.autoStackMobile && !section.containsGame && (
                  <MobileOverlapHint
                    section={section}
                    onAutoStack={() =>
                      useLandingEditorStore.getState().updateSectionMeta(section.iid, { autoStackMobile: true })
                    }
                  />
                )}
                {section.containsGame ? (
                  // Arcade section: the real scene (machine + art in one
                  // world) with the Arcade Studio handles on top.
                  <ArcadeEditorStage
                    section={section}
                    language={previewLanguage}
                    device={deviceMode}
                    active={active || selectedAssetIid === ARCADE_MACHINE_IID}
                    renderOverlay={(extra, machineLock) => renderOverlay(section, false, extra, machineLock)}
                  />
                ) : (
                  <DrawnSection section={section} editorOverlay={overlay} />
                )}
                {hiddenReason && (
                  // Dim, don't hide: the author must still be able to edit a
                  // hidden section. z-999 sits above every real asset but below
                  // AssetOverlay's z-1000 hitboxes (Gotcha №32), and
                  // pointer-events:none lets clicks through to them.
                  <div
                    className="pointer-events-none absolute inset-0 z-[999] bg-neutral-900/45 [background-image:repeating-linear-gradient(135deg,transparent_0_14px,rgba(255,255,255,0.06)_14px_28px)]"
                    aria-hidden="true"
                  >
                    <span className="absolute right-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-[11px] font-medium text-black">
                      {hiddenReason}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {page.sections.length === 0 && (
            <div className="p-16 text-center text-neutral-400">
              This page has no sections. Add one from the outline on the left.
            </div>
          )}
      </ZoomSurface>
      </CustomFontsContext.Provider>
      </HoverDefaultContext.Provider>
      </FormsContext.Provider>
    </div>
  );
}

// In Mobile mode, a hand-placed (not auto-stacked) section whose elements
// overlap on the phone canvas gets a one-click fix. Auto-height components
// grow taller on a narrow screen, so a desktop layout that fits often
// collides on phones; builders flag this instead of leaving it to be found
// on a real phone.
function MobileOverlapHint({
  section,
  onAutoStack,
}: {
  section: SectionData;
  onAutoStack: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overlaps, setOverlaps] = useState(0);
  // Overlap can be deliberate (collage): the hint can be dismissed.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const host = ref.current?.parentElement;
    const box = host?.querySelector<HTMLElement>(".drawn-section__container");
    if (!box) return;
    const measure = () => {
      const rs = Array.from(box.querySelectorAll<HTMLElement>(".drawn-asset-pos"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < rs.length; i++)
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i];
          const b = rs[j];
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 8 && oy > 8) n++;
        }
      setOverlaps(n);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    box.querySelectorAll(".drawn-asset-pos").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [section.assets]);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center p-2">
      {overlaps > 0 && !dismissed && (
        <span className="pointer-events-auto flex items-center gap-2 rounded bg-amber-500/90 px-2 py-1 text-[11px] text-black shadow">
          {overlaps === 1 ? "2 elements overlap" : `${overlaps} overlaps`} on phones.
          <button
            type="button"
            onClick={onAutoStack}
            className="rounded bg-black/80 px-1.5 py-0.5 font-medium text-white hover:bg-black"
          >
            Auto-stack this section
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            title="Overlap is intentional — hide this"
            className="rounded px-1 font-medium hover:bg-black/10"
          >
            Keep overlap
          </button>
        </span>
      )}
    </div>
  );
}

function InsertButton({
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
    >
      {icon}
      {label}
    </button>
  );
}
