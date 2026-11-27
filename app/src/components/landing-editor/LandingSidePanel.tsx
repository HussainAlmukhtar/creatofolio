"use client";

// LandingSidePanel — right rail. Priority: selected asset > selected section >
// page SEO. Built on the project's shadcn/Radix components for consistency.

import { FieldControl } from "./FormFields";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useLandingEditorStore,
  selectCurrentDrawnPage,
} from "@/stores/landingEditorStore";
import { uploadContentImage } from "@/lib/editorData";
import LandingDrawModal from "./LandingDrawModal";
import { buildSectionReveal } from "@/components/landing/sectionReveal";
import { HOVER_EFFECT_OPTIONS, DEFAULT_HOVER_EFFECT } from "@/components/landing/hoverEffect";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { newIid } from "@/lib/iid";
import type {
  DrawnAsset,
  DrawnAssetRole,
  DrawnSection,
  SectionSurface,
  TornEdgeStyle,
  PaperPreset,
  HoverEffect,
} from "@/data/landingTypes";
import { encodeActionId, parseActionId } from "@/lib/landingActions";
import { TextAssetForm } from "./TextAssetForm";
import { BlockInspector } from "./BlockInspector";
import { SectionVisibilityFields } from "./SectionVisibilityFields";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BringToFront, ChevronDown, Copy, Image as ImageIcon, ImagePlus, Pencil, PenTool, Play, SendToBack, Shuffle, Square, Trash2, Type as TypeIcon, type LucideIcon } from "lucide-react";
import { heightForImage, occupiedRects } from "@/lib/landingPlacement";
import { MediaLibraryDialog } from "./MediaLibraryDialog";
import { AssetWeight } from "@/components/admin/AssetWeight";
import { collectAssetUrls } from "@/lib/assetWeight";
import { getBlockDef } from "@/components/landing/blocks/registry";
import { Textarea } from "@/components/ui/textarea";
import { ARCADE_MACHINE_IID } from "@/data/arcadeConfig";
import { ArcadeInspector, AmbientFields } from "./ArcadeInspector";
import { makeTitleAsset, sectionLabel } from "@/data/sectionTitles";
import { InfoTip } from "./InfoTip";
import { LockButton, LockedNote } from "./LockControls";
import { isAssetLocked } from "@/lib/layerLock";
import { toggleAssetLockWithFeedback } from "@/lib/landingEditorActions";

// ─── Shared field helpers ───────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  step = 0.5,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </Field>
  );
}

function ColorField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          type="color"
          value={value && value.startsWith("#") ? value : "#e9e3d6"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 rounded-lg border border-input bg-transparent"
        />
        <Input
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    </Field>
  );
}

// ─── Panel ──────────────────────────────────────────────────

export function LandingSidePanel() {
  const page = useLandingEditorStore(selectCurrentDrawnPage);
  const selectedSectionIid = useLandingEditorStore((s) => s.selectedSectionIid);
  const selectedAssetIid = useLandingEditorStore((s) => s.selectedAssetIid);
  const updateSectionMeta = useLandingEditorStore((s) => s.updateSectionMeta);
  const updatePageMeta = useLandingEditorStore((s) => s.updatePageMeta);
  const updateAssetTransform = useLandingEditorStore((s) => s.updateAssetTransform);
  const updateAssetRole = useLandingEditorStore((s) => s.updateAssetRole);
  const updateAssetMeta = useLandingEditorStore((s) => s.updateAssetMeta);
  const removeAsset = useLandingEditorStore((s) => s.removeAsset);
  const duplicateAsset = useLandingEditorStore((s) => s.duplicateAsset);
  const bringAssetForward = useLandingEditorStore((s) => s.bringAssetForward);
  const sendAssetBackward = useLandingEditorStore((s) => s.sendAssetBackward);
  const openContentEditor = useLandingEditorStore((s) => s.openContentEditor);
  const updateTextContent = useLandingEditorStore((s) => s.updateTextContent);
  const updateTextStyle = useLandingEditorStore((s) => s.updateTextStyle);
  const updateAssetMobile = useLandingEditorStore((s) => s.updateAssetMobile);
  const deviceMode = useLandingEditorStore((s) => s.deviceMode);
  const updateComponentProps = useLandingEditorStore((s) => s.updateComponentProps);
  const updateComponentAutoHeight = useLandingEditorStore(
    (s) => s.updateComponentAutoHeight
  );

  const contentMap = useLandingEditorStore((s) => s.contentMap);
  const weightUrls = useMemo(() => {
    if (!page) return [];
    const prefix = `${page.slug}:`;
    const popups = Object.entries(contentMap)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
    return collectAssetUrls(page, popups);
  }, [page, contentMap]);

  if (!page) {
    return (
      <aside className="w-72 border-l border-border bg-card p-3 text-sm text-muted-foreground">
        No page loaded.
      </aside>
    );
  }

  const selectedAsset: DrawnAsset | null = selectedAssetIid
    ? page.sections.flatMap((s) => s.assets).find((a) => a.iid === selectedAssetIid) ??
      null
    : null;

  const section = selectedSectionIid
    ? page.sections.find((s) => s.iid === selectedSectionIid) ?? null
    : null;

  // Position is automatic when the selected asset's section auto-stacks on
  // mobile and we're in mobile mode.
  const assetSection = selectedAsset
    ? page.sections.find((s) => s.assets.some((a) => a.iid === selectedAsset.iid))
    : null;
  const sectionAutoStack = Boolean(assetSection?.autoStackMobile);
  // An element marked "free on phones" keeps hand-placed mobile geometry.
  const mobileAuto =
    deviceMode === "mobile" && sectionAutoStack && !selectedAsset?.mobile?.free;

  const arcadeSection = page.sections.find((s) => s.containsGame) ?? null;

  return (
    <aside className="w-[19rem] shrink-0 overflow-auto border-l border-border bg-card p-2.5 text-foreground">
      {selectedAssetIid === ARCADE_MACHINE_IID && arcadeSection ? (
        <ArcadeInspector key="arcade-machine" section={arcadeSection} />
      ) : selectedAsset ? (
        <AssetForm
          key={selectedAsset.iid}
          asset={selectedAsset}
          sections={page.sections}
          deviceMode={deviceMode}
          mobileAuto={mobileAuto}
          sectionAutoStack={sectionAutoStack}
          locked={assetSection ? isAssetLocked(selectedAsset, assetSection) : false}
          onToggleLock={() => toggleAssetLockWithFeedback(selectedAsset.iid)}
          onTransform={(t) =>
            deviceMode === "mobile"
              ? updateAssetMobile(selectedAsset.iid, t)
              : updateAssetTransform(selectedAsset.iid, t)
          }
          onRole={(role) => updateAssetRole(selectedAsset.iid, role)}
          onMeta={(partial) => updateAssetMeta(selectedAsset.iid, partial)}
          onMobile={(partial) => updateAssetMobile(selectedAsset.iid, partial)}
          onDelete={() => removeAsset(selectedAsset.iid)}
          onDuplicate={() => duplicateAsset(selectedAsset.iid)}
          onForward={() => bringAssetForward(selectedAsset.iid)}
          onBackward={() => sendAssetBackward(selectedAsset.iid)}
          onEditContent={() => openContentEditor(selectedAsset.iid)}
          sizeExtra={
            selectedAsset.source.kind === "component" ? (
              <label className="flex items-center justify-between gap-2 text-[13px]">
                <span>
                  Fit height to content
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Grow with its content instead of filling the box.
                  </span>
                </span>
                <Switch
                  size="sm"
                  checked={Boolean(selectedAsset.source.autoHeight)}
                  onCheckedChange={(v) => updateComponentAutoHeight(selectedAsset.iid, v)}
                />
              </label>
            ) : null
          }
        >
          {selectedAsset.source.kind === "text" && (
            <TextAssetForm
              source={selectedAsset.source}
              onContent={(lang, v) => updateTextContent(selectedAsset.iid, lang, v)}
              onStyle={(partial) => updateTextStyle(selectedAsset.iid, partial)}
            />
          )}
          {/* Idle motion for any element; arcade elements can also fade
              out while the game is played. */}
          <div className="space-y-3 rounded-lg border border-border bg-background/30 px-3 pb-3 pt-3">
            <AmbientFields
              value={selectedAsset.ambient}
              onChange={(ambient) => updateAssetMeta(selectedAsset.iid, { ambient: ambient ?? undefined })}
            />
            {assetSection?.containsGame && (
              <label className="flex items-start justify-between gap-3 text-[13px]">
                <span>
                  <span className="inline-flex items-center gap-1.5">
                    Fade while playing
                    <InfoTip text="Hides this element while someone is playing the game (it fades with the zoom and comes back after). Useful for big props near the screen. Independent of the foreground guardrail." />
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    Hide this element while the game is zoomed in.
                  </span>
                </span>
                <Switch
                  size="sm"
                  checked={Boolean(selectedAsset.fadeInPlay)}
                  onCheckedChange={(v) => updateAssetMeta(selectedAsset.iid, { fadeInPlay: v || undefined })}
                />
              </label>
            )}
          </div>
          {selectedAsset.source.kind === "component" && (
            <BlockInspector
              block={selectedAsset.source.block}
              showHeader={false}
              onChange={(partial) => updateComponentProps(selectedAsset.iid, partial)}
              onDelete={() => removeAsset(selectedAsset.iid)}
              onDuplicate={() => duplicateAsset(selectedAsset.iid)}
            />
          )}
        </AssetForm>
      ) : section?.containsGame ? (
        <div className="space-y-2.5">
          <ArcadeInspector key={section.iid} section={section} />
          <SectionForm
            key={`${section.iid}-meta`}
            section={section}
            onChange={(partial) => updateSectionMeta(section.iid, partial)}
          />
        </div>
      ) : section ? (
        <SectionForm
          key={section.iid}
          section={section}
          onChange={(partial) => updateSectionMeta(section.iid, partial)}
        />
      ) : (
        <div className="space-y-3">
          <AssetWeight label="Page weight" urls={weightUrls} />
          <PageMetaForm
            key={page.slug}
            title={page.meta?.title ?? { en: "", ar: "" }}
            description={page.meta?.description ?? { en: "", ar: "" }}
            ogImage={page.meta?.ogImage}
            onChange={(meta) => updatePageMeta(meta)}
          />
        </div>
      )}
    </aside>
  );
}

// ─── Asset form ─────────────────────────────────────────────

/**
 * A collapsible inspector group (Shopify / Figma style). Open state is
 * remembered per group in this browser, so the panel keeps the shape the
 * owner likes. Storage is a convenience: failures are ignored.
 */
function Group({
  id,
  title,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `landing-inspector-group:${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(key, o ? "0" : "1");
      } catch {
        /* per-viewer convenience only */
      }
      return !o;
    });
  };
  return (
    <section className="rounded-lg border border-border bg-background/30">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between px-3 text-[13px] font-medium hover:bg-accent/40"
      >
        {title}
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="space-y-3.5 border-t border-border px-3 pb-3.5 pt-3">{children}</div>}
    </section>
  );
}

/** Inspector header: what's selected, in words. */
function PanelTitle({
  kicker,
  title,
  icon: Icon,
  actions,
}: {
  kicker: string;
  title: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-0.5 pb-1.5 pt-0.5">
      {Icon && (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent">
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kicker}</div>
        <div className="truncate text-sm font-semibold">{title}</div>
      </div>
      {actions}
    </div>
  );
}

function AssetForm({
  asset,
  sections,
  deviceMode,
  mobileAuto,
  sectionAutoStack,
  locked,
  onToggleLock,
  onTransform,
  onRole,
  onMeta,
  onMobile,
  onDelete,
  onDuplicate,
  onForward,
  onBackward,
  onEditContent,
  sizeExtra,
  children,
}: {
  children?: React.ReactNode;
  sizeExtra?: React.ReactNode;
  asset: DrawnAsset;
  sections: DrawnSection[];
  deviceMode: "desktop" | "mobile";
  mobileAuto: boolean;
  sectionAutoStack: boolean;
  /** Layer lock: the position fields are read-only and a note offers Unlock. */
  locked: boolean;
  onToggleLock: () => void;
  onTransform: (t: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    rotation?: number;
  }) => void;
  onRole: (role: DrawnAssetRole) => void;
  onMeta: (partial: Partial<DrawnAsset>) => void;
  onMobile: (partial: { hidden?: boolean; free?: boolean }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onForward: () => void;
  onBackward: () => void;
  onEditContent: () => void;
}) {
  const parsedAction =
    asset.role.kind === "button" ? parseActionId(asset.role.actionId) : null;
  const imageUrl =
    asset.source.kind === "drawn"
      ? asset.source.pngUrl
      : asset.source.kind === "upload"
        ? asset.source.url
        : null;
  const [editingDrawing, setEditingDrawing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // Keep the element's width; derive height from an image's aspect. % of
  // width vs % of height of a canvas with its own aspect (see fitAssetSize).
  const heightForAspect = (naturalSize?: { w: number; h: number }) => {
    const host = sections.find((sec) => sec.assets.some((a) => a.iid === asset.iid));
    return host ? heightForImage(asset.w, host.aspectRatio, naturalSize, asset.h) : asset.h;
  };
  const linkRole = asset.role.kind === "link" ? asset.role : null;
  const siteHoverDefault = useSiteConfigEditorStore(
    (st) => st.config.interactions?.hoverEffect ?? DEFAULT_HOVER_EFFECT
  );

  // In mobile mode the position fields show + edit the mobile override (falling
  // back to the desktop value); onTransform is already routed to the right one.
  const g =
    deviceMode === "mobile"
      ? {
          x: asset.mobile?.x ?? asset.x,
          y: asset.mobile?.y ?? asset.y,
          w: asset.mobile?.w ?? asset.w,
          h: asset.mobile?.h ?? asset.h,
          rotation: asset.mobile?.rotation ?? asset.rotation ?? 0,
        }
      : { x: asset.x, y: asset.y, w: asset.w, h: asset.h, rotation: asset.rotation ?? 0 };

  const isComponent = asset.source.kind === "component";
  const Icon: LucideIcon =
    asset.source.kind === "component"
      ? (getBlockDef(asset.source.block.type)?.icon ?? Square)
      : asset.source.kind === "text"
        ? TypeIcon
        : asset.source.kind === "drawn"
          ? PenTool
          : ImageIcon;
  const kicker =
    asset.source.kind === "component"
      ? (getBlockDef(asset.source.block.type)?.label ?? "Component")
      : asset.source.kind === "text"
        ? "Text"
        : asset.source.kind === "drawn"
          ? "Drawing"
          : "Image";

  return (
    <div className="space-y-2">
      <PanelTitle
        kicker={kicker}
        title={asset.label || (asset.source.kind === "text" ? asset.source.text.en || "Text" : kicker)}
        icon={Icon}
        actions={
          <div className="flex">
            <LockButton locked={locked} onToggle={onToggleLock} />
            <Button size="icon-sm" variant="ghost" onClick={onDuplicate} title="Duplicate (Ctrl+D)">
              <Copy />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={onDelete} title="Delete (Del)" className="hover:text-destructive">
              <Trash2 />
            </Button>
          </div>
        }
      />

      {(children || imageUrl) && (
        <Group id={`el-content-${isComponent ? "component" : asset.source.kind}`} title={isComponent ? "Settings" : "Content"}>
          {children}
          {imageUrl && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="secondary" onClick={() => setReplacing(true)}>
                  <ImagePlus /> Replace image…
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setEditingDrawing(true)}>
                  <Pencil /> Edit in drawing studio
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {asset.source.kind === "drawn"
                  ? "Re-opens the drawing with its layers."
                  : "Opens this image as a layer you can draw over."}
              </p>
            </div>
          )}
          <MediaLibraryDialog
            open={replacing}
            onOpenChange={setReplacing}
            title="Replace image"
            confirmLabel="Replace"
            onPick={({ url, naturalSize }) =>
              // Same frame position and width; height follows the new image's
              // aspect so it isn't stretched.
              onMeta({ source: { kind: "upload", url }, h: heightForAspect(naturalSize) })
            }
          />
          {editingDrawing && imageUrl && (
            <LandingDrawModal
              title="Edit drawing"
              edit={{
                sceneId: asset.source.kind === "drawn" ? asset.source.sceneId : undefined,
                pngUrl: imageUrl,
              }}
              saveLabel="Update element"
              onClose={() => setEditingDrawing(false)}
              onSaved={(url, naturalSize, sceneId) => {
                // Keep position + width; re-derive height from the new art's
                // aspect so a re-cropped drawing isn't stretched. % of width vs %
                // of height of a canvas with its own aspect (see fitAssetSize).
                const h = heightForAspect(naturalSize);
                onMeta({
                  source: sceneId
                    ? { kind: "drawn", sceneId, pngUrl: url }
                    : { kind: "upload", url },
                  h,
                });
              }}
            />
          )}
        </Group>
      )}
      <MediaLibraryDialog
        open={replacing}
        onOpenChange={setReplacing}
        title="Replace image"
        confirmLabel="Replace"
        onPick={({ url, naturalSize }) =>
          // Same frame position and width; height follows the new image's
          // aspect so it isn't stretched.
          onMeta({ source: { kind: "upload", url }, h: heightForAspect(naturalSize) })
        }
      />
      {editingDrawing && imageUrl && (
        <LandingDrawModal
          title="Edit drawing"
          edit={{
            sceneId: asset.source.kind === "drawn" ? asset.source.sceneId : undefined,
            pngUrl: imageUrl,
          }}
          saveLabel="Update element"
          onClose={() => setEditingDrawing(false)}
          onSaved={(url, naturalSize, sceneId) => {
            // Keep position + width; re-derive height from the new art's aspect.
            onMeta({
              source: sceneId ? { kind: "drawn", sceneId, pngUrl: url } : { kind: "upload", url },
              h: heightForAspect(naturalSize),
            });
          }}
        />
      )}

      <Group id="el-layout" title={deviceMode === "mobile" ? "Position & size · phone" : "Position & size"}>
        {mobileAuto ? (
          <p className="rounded-md bg-sky-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-sky-300">
            This section <strong>stacks</strong> on phones, so position and size are automatic here.
            Turn on <strong>Free on phones</strong> (Visibility) to place this one by hand.
          </p>
        ) : (
          <>
            {deviceMode === "mobile" && (
              <p className="rounded-md bg-sky-500/10 px-2.5 py-2 text-[11px] text-sky-300">
                Changes here only affect the <strong>phone</strong> layout.
              </p>
            )}
            {locked && <LockedNote onUnlock={onToggleLock} />}
            <div className="grid grid-cols-2 gap-1.5">
              <MiniNum label="X" suffix="%" value={g.x} readOnly={locked} onChange={(v) => onTransform({ x: v })} />
              <MiniNum label="Y" suffix="%" value={g.y} readOnly={locked} onChange={(v) => onTransform({ y: v })} />
              <MiniNum label="W" suffix="%" value={g.w} readOnly={locked} onChange={(v) => onTransform({ w: v })} />
              <MiniNum label="H" suffix="%" value={g.h} readOnly={locked} onChange={(v) => onTransform({ h: v })} />
              <MiniNum label="↻" suffix="°" value={g.rotation} step={1} readOnly={locked} onChange={(v) => onTransform({ rotation: v })} title="Rotation" />
              <div className="flex gap-1">
                <Button size="icon-sm" variant="secondary" className="flex-1" onClick={onBackward} title="Send backward ( [ )">
                  <SendToBack />
                </Button>
                <Button size="icon-sm" variant="secondary" className="flex-1" onClick={onForward} title="Bring forward ( ] )">
                  <BringToFront />
                </Button>
              </div>
            </div>
          </>
        )}
        {sizeExtra}
      </Group>

      {!isComponent && (
        <Group id="el-link" title="Link & behaviour" defaultOpen={asset.role.kind !== "decoration"}>
          <Field label="Role">
            <Select
              value={asset.role.kind}
              onValueChange={(kind) => {
                if (kind === "decoration") onRole({ kind: "decoration" });
                else if (kind === "link") onRole({ kind: "link", href: "" });
                else onRole({ kind: "button", actionId: "" });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decoration">Decoration (not clickable)</SelectItem>
                <SelectItem value="link">Link (opens a URL)</SelectItem>
                <SelectItem value="button">Button (runs an action)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {asset.role.kind !== "decoration" && (
            <Field label="Hover effect">
              <Select
                value={asset.hoverEffect ?? "inherit"}
                onValueChange={(v) =>
                  onMeta({ hoverEffect: v === "inherit" ? undefined : (v as HoverEffect) })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Site default ({siteHoverDefault})</SelectItem>
                  {HOVER_EFFECT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {linkRole && (
            <>
              <Field label="Link URL">
                <Input
                  value={linkRole.href}
                  onChange={(e) => onRole({ ...linkRole, href: e.target.value })}
                  placeholder="https://…  or  /about"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  id="link-newtab"
                  checked={Boolean(linkRole.newTab)}
                  onCheckedChange={(v) => onRole({ ...linkRole, newTab: v })}
                />
                <Label htmlFor="link-newtab">Open in new tab</Label>
              </div>
            </>
          )}

          {asset.role.kind === "button" && (
            <div className="space-y-2">
              <Field label="Action">
                <Select
                  value={parsedAction?.kind ?? "open-content"}
                  onValueChange={(kind) => {
                    if (kind === "open-content")
                      onRole({ kind: "button", actionId: encodeActionId({ kind: "open-content", assetIid: asset.iid }) });
                    else
                      onRole({ kind: "button", actionId: encodeActionId({ kind: "scroll-to-section", sectionId: sections[0]?.id ?? "" }) });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open-content">Open a pop-up</SelectItem>
                    <SelectItem value="scroll-to-section">Scroll to a section</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {parsedAction?.kind === "scroll-to-section" && (
                <Field label="Target section">
                  <Select
                    value={parsedAction.sectionId}
                    onValueChange={(v) =>
                      onRole({ kind: "button", actionId: encodeActionId({ kind: "scroll-to-section", sectionId: v }) })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.iid} value={s.id}>
                          {s.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {(parsedAction?.kind === "open-content" || !parsedAction) && (
                <Button className="w-full" onClick={onEditContent}>
                  Edit pop-up…
                </Button>
              )}
            </div>
          )}
          {asset.role.kind === "decoration" ? (
            <Field label="Name — to identify this element in the layers list">
              <Input
                value={asset.label ?? ""}
                onChange={(e) => onMeta({ label: e.target.value })}
                placeholder="e.g. Hero mascot"
              />
            </Field>
          ) : (
            <>
              <Field label="Label (EN) — name + screen-reader text">
                <Input value={asset.label ?? ""} onChange={(e) => onMeta({ label: e.target.value })} />
              </Field>
              <Field label="Label (AR)">
                <Input value={asset.labelAr ?? ""} dir="rtl" onChange={(e) => onMeta({ labelAr: e.target.value })} />
              </Field>
            </>
          )}
        </Group>
      )}

      <Group id="el-visibility" title="Visibility" defaultOpen={false}>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="hide-mobile"
              checked={Boolean(asset.mobile?.hidden)}
              onCheckedChange={(v) => onMobile({ hidden: v })}
            />
            <Label htmlFor="hide-mobile">Hide on mobile</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="hide-desktop"
              checked={Boolean(asset.hiddenOnDesktop)}
              onCheckedChange={(v) => onMeta({ hiddenOnDesktop: v })}
            />
            <Label htmlFor="hide-desktop">Hide on desktop</Label>
          </div>
          {sectionAutoStack && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  id="free-mobile"
                  checked={Boolean(asset.mobile?.free)}
                  onCheckedChange={(v) => onMobile({ free: v })}
                />
                <Label htmlFor="free-mobile">Free on phones (don&apos;t stack)</Label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                This section stacks its elements into a column on phones. Turn this on to keep this one
                exactly where you place it in Mobile view: it floats and can overlap anything.
              </p>
            </div>
          )}
      </Group>

      <Group id="el-advanced" title="Motion & advanced" defaultOpen={false}>
        <div>
          <NumberField
            label="Parallax depth"
            value={asset.parallax?.factor ?? 0}
            step={0.05}
            onChange={(v) => onMeta({ parallax: { factor: v } })}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            How much it drifts as the page scrolls. 0 = pinned; try 0.1–0.3.
          </p>
        </div>
        <NumberField label="Layer (z-index)" value={asset.zIndex} step={1} onChange={(v) => onMeta({ zIndex: Math.round(v) })} />
        {isComponent && (
          <Field label="Name in the layers list">
            <Input value={asset.label ?? ""} onChange={(e) => onMeta({ label: e.target.value })} placeholder="e.g. Contact form" />
          </Field>
        )}
      </Group>
    </div>
  );
}

/** Figma-style compact number input: a short label inside the field. */
function MiniNum({
  label,
  suffix,
  value,
  step = 0.5,
  title,
  readOnly,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: number;
  step?: number;
  title?: string;
  /** Layer lock: shown, not editable. */
  readOnly?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="relative block" title={title ?? label}>
      <span className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        readOnly={readOnly}
        aria-readonly={readOnly || undefined}
        onChange={(e) => {
          if (readOnly) return;
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className={`h-8 ps-7 pe-6 text-xs tabular-nums ${readOnly ? "opacity-60" : ""}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </label>
  );
}

// ─── Section form ───────────────────────────────────────────

function SectionForm({
  section,
  onChange,
}: {
  section: DrawnSection;
  onChange: (partial: Partial<DrawnSection>) => void;
}) {
  const surface = section.surface ?? { kind: "paper" };
  const setSurface = (next: SectionSurface) => onChange({ surface: next });
  const rerollAllTears = useLandingEditorStore((s) => s.rerollAllTears);
  const resizeSectionCanvas = useLandingEditorStore((s) => s.resizeSectionCanvas);

  // Section background art (drawn or uploaded — over the surface color).
  const bgFileRef = useRef<HTMLInputElement>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [drawingBg, setDrawingBg] = useState(false);
  const bg = section.background;
  const bgUrl =
    bg?.kind === "image" ? bg.src : bg?.kind === "drawn" ? bg.pngUrl : null;
  const onBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBgUploading(true);
    const url = await uploadContentImage(file, "landing");
    setBgUploading(false);
    if (!url) return toast.error("Upload failed.");
    onChange({ background: { kind: "image", src: url } });
  };

  return (
    <div className="space-y-2">
      <PanelTitle title={sectionLabel(section)} kicker="Section" />
      <Group id="section-content" title="Content">
        <Field label="Section name (only shown in the editor)">
          <Input
            value={section.name?.en ?? ""}
            placeholder={sectionLabel(section)}
            onChange={(e) => onChange({ name: { en: e.target.value, ar: section.name?.ar ?? "" } })}
          />
        </Field>
        <SectionTitleButtons section={section} />
      </Group>
      <Group id="section-background" title="Background">
        <Field label="Surface (material)">
          <Select
            value={surface.kind}
            onValueChange={(kind) => {
              if (kind === "paper") setSurface({ kind: "paper", grain: true });
              else if (kind === "digital") setSurface({ kind: "digital" });
              else setSurface({ kind: "plain" });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paper">paper (grain + torn edges)</SelectItem>
              <SelectItem value="digital">digital (flat / textured)</SelectItem>
              <SelectItem value="plain">plain (solid color)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ColorField
          label="Background colour"
          value={surface.color}
          placeholder="theme default (blank)"
          onChange={(v) => setSurface({ ...surface, color: v } as SectionSurface)}
        />

        {surface.kind === "paper" && (
          <>
            <Field label="Paper stock">
              <Select
                value={surface.paper ?? "sketchbook"}
                onValueChange={(v) => setSurface({ ...surface, paper: v as PaperPreset })}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sketchbook">Sketchbook — smooth, warm white</SelectItem>
                  <SelectItem value="coldpress">Cold-press — textured watercolour</SelectItem>
                  <SelectItem value="kraft">Kraft — brown, fibrous</SelectItem>
                  <SelectItem value="newsprint">Newsprint — grey, flecked</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-center gap-2">
              <Switch
                size="sm"
                id="paper-grain"
                checked={surface.grain !== false}
                onCheckedChange={(v) => setSurface({ ...surface, grain: v })}
              />
              <Label htmlFor="paper-grain">Paper texture</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TornEdgeSelect
                label="Torn edge — top"
                value={surface.tornEdge?.top ?? "none"}
                onChange={(v) => setSurface({ ...surface, tornEdge: { ...surface.tornEdge, top: v } })}
              />
              <TornEdgeSelect
                label="Torn edge — bottom"
                value={surface.tornEdge?.bottom ?? "none"}
                onChange={(v) => setSurface({ ...surface, tornEdge: { ...surface.tornEdge, bottom: v } })}
              />
            </div>
            {((surface.tornEdge?.top ?? "none") !== "none" ||
              (surface.tornEdge?.bottom ?? "none") !== "none") && (
              <div className="space-y-2 rounded-lg border border-border p-2.5">
                <Field label="Tear intensity">
                  <Select
                    value={surface.tornEdge?.intensity ?? "natural"}
                    onValueChange={(v) =>
                      setSurface({
                        ...surface,
                        tornEdge: {
                          ...surface.tornEdge,
                          intensity: v as "subtle" | "natural" | "dramatic",
                        },
                      })
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subtle">Subtle — a gentle, shallow tear</SelectItem>
                      <SelectItem value="natural">Natural</SelectItem>
                      <SelectItem value="dramatic">Dramatic — deep, ragged rip</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <p className="text-[11px] text-muted-foreground">
                  Every tear has its own shape and character (depth, bite size,
                  slant, how much torn core shows). Re-roll until it feels right.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      setSurface({
                        ...surface,
                        tornEdge: { ...surface.tornEdge, seed: newIid().slice(0, 8) },
                      })
                    }
                  >
                    <Shuffle /> Re-roll this tear
                  </Button>
                  <Button size="xs" variant="ghost" onClick={rerollAllTears}>
                    <Shuffle /> Re-roll every tear on the page
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {surface.kind === "digital" && (
          <Field label="Digital texture">
            <Select
              value={surface.texture ?? "none"}
              onValueChange={(v) =>
                setSurface({ ...surface, texture: v as "none" | "grid" | "scanlines" })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="grid">grid</SelectItem>
                <SelectItem value="scanlines">scanlines</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {/* Background art — a drawing/image painted over the surface color. */}
        <Field label="Background art">
          {bgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bgUrl}
              alt=""
              className="mb-2 h-16 w-full rounded border border-border object-cover"
            />
          )}
          <div className="flex flex-wrap gap-1">
            <Button
              size="xs"
              variant="secondary"
              disabled={bgUploading}
              onClick={() => bgFileRef.current?.click()}
            >
              {bgUploading ? "Uploading…" : "Upload image"}
            </Button>
            <Button size="xs" variant="secondary" onClick={() => setDrawingBg(true)}>
              {bgUrl ? "Edit in drawing studio" : "Draw background"}
            </Button>
            {section.background && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onChange({ background: undefined })}
              >
                Remove
              </Button>
            )}
          </div>
          <input
            ref={bgFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onBgFile}
          />
        </Field>

        {drawingBg && (
          <LandingDrawModal
            title="Draw section background"
            canvas={{ w: section.aspectRatio.w, h: section.aspectRatio.h }}
            trimToContent={false}
            edit={
              bgUrl
                ? { sceneId: bg?.kind === "drawn" ? bg.sceneId : undefined, pngUrl: bgUrl }
                : undefined
            }
            saveLabel={bgUrl ? "Update background" : "Set as background"}
            onClose={() => setDrawingBg(false)}
            onSaved={(url, _size, sceneId) =>
              onChange({
                background: sceneId
                  ? { kind: "drawn", sceneId, pngUrl: url }
                  : { kind: "image", src: url },
              })
            }
          />
        )}
      </Group>
      <Group id="section-layout" title="Layout & size">
        <Field label="Block type (layout)">
          <Select
            value={section.blockType}
            onValueChange={(v) => onChange({ blockType: v as DrawnSection["blockType"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hero">hero</SelectItem>
              <SelectItem value="stack">stack</SelectItem>
              <SelectItem value="split">split</SelectItem>
              <SelectItem value="full-bleed">full-bleed</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div>
          <NumberField
            label="Section height (% of screen)"
            value={section.minHeightVh ?? 100}
            step={5}
            onChange={(v) =>
              onChange({ minHeightVh: Math.max(20, Math.min(300, v)) })
            }
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            100 = one full screen. Lower for a short band, higher for a tall
            scrolling section.
          </p>
        </div>

        {!section.horizontalScroll && section.blockType !== "hero" && (
          <div>
            <NumberField
              label="Element area height (px at 1520 wide)"
              value={section.aspectRatio.h}
              step={40}
              onChange={(v) => resizeSectionCanvas(section.iid, v)}
            />
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => resizeSectionCanvas(section.iid, section.aspectRatio.h + 240)}
              >
                Taller
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => resizeSectionCanvas(section.iid, section.aspectRatio.h - 240)}
              >
                Shorter
              </Button>
              <Button
                size="xs"
                variant="secondary"
                title="Shrink or grow the area to just below the lowest element"
                onClick={() => {
                  const rects = occupiedRects(section.id, section.assets);
                  if (!rects.length) return;
                  const bottom = Math.max(...rects.map((r) => r.y + r.h));
                  resizeSectionCanvas(section.iid, (section.aspectRatio.h * (bottom + 5)) / 100);
                }}
              >
                Fit to content
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Where elements can go. Elements keep their place and size; you can
              also drag the handle at the bottom edge of the section.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            id="hscroll"
            checked={Boolean(section.horizontalScroll)}
            onCheckedChange={(v) =>
              onChange({
                horizontalScroll: v,
                // Widen the canvas when turning it on (so there's something to
                // scroll); leave the author's width alone if already wide.
                aspectRatio:
                  v && section.aspectRatio.w <= 1520
                    ? { w: 3000, h: section.aspectRatio.h }
                    : section.aspectRatio,
              })
            }
          />
          <Label htmlFor="hscroll">Horizontal scroll</Label>
        </div>
        {section.horizontalScroll && (
          <div>
            <NumberField
              label="Canvas width (px)"
              value={section.aspectRatio.w}
              step={100}
              onChange={(v) =>
                onChange({
                  aspectRatio: { w: Math.max(1520, v), h: section.aspectRatio.h },
                })
              }
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Wider = more sideways scrolling room. Place elements left-to-right.
            </p>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id="autostack"
              checked={Boolean(section.autoStackMobile)}
              onCheckedChange={(v) => onChange({ autoStackMobile: v })}
            />
            <Label htmlFor="autostack">Auto-stack on mobile</Label>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            On phones, elements reflow into a centered vertical column
            automatically (top-to-bottom) — no manual mobile layout needed. Turn
            off to position mobile by hand instead.
          </p>
        </div>
      </Group>
      <Group id="section-visibility" title="Visibility & schedule" defaultOpen={false}>
        <SectionVisibilityFields section={section} onChange={onChange} />
      </Group>
      <Group id="section-animation" title="Animation" defaultOpen={false}>
        <div>
          <Field label="Scroll animation">
            <Select
              value={section.revealStyle ?? "fade-up"}
              onValueChange={(v) => onChange({ revealStyle: v as DrawnSection["revealStyle"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fade-up">Rise — heading lifts in, then elements</SelectItem>
                <SelectItem value="place">Place — elements set down like cut-outs</SelectItem>
                <SelectItem value="ink">Ink — wiped on in reading direction</SelectItem>
                <SelectItem value="fade">Fade — quiet fade in order</SelectItem>
                <SelectItem value="parallax">Parallax — fade + depth drift</SelectItem>
                <SelectItem value="none">None — always visible</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            size="xs"
            variant="secondary"
            className="mt-1.5"
            disabled={(section.revealStyle ?? "fade-up") === "none"}
            onClick={() => previewReveal(section)}
          >
            <Play /> Preview animation
          </Button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            How this section animates as the visitor scrolls it into view.
          </p>
        </div>
      </Group>
      <Group id="section-advanced" title="Advanced" defaultOpen={false}>
        <Field label="Slug id">
          <Input value={section.id} onChange={(e) => onChange({ id: e.target.value })} />
        </Field>
        <p className="text-[11px] text-muted-foreground">
          The section&apos;s id: used for in-page links (#{section.id}) and analytics.
        </p>
      </Group>
    </div>
  );
}

function TornEdgeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TornEdgeStyle;
  onChange: (v: TornEdgeStyle) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as TornEdgeStyle)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Straight</SelectItem>
          <SelectItem value="rough">Torn — ripped edge</SelectItem>
          <SelectItem value="deckle">Deckle — soft handmade</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

// ─── Page meta ──────────────────────────────────────────────

// Host shown in the search / share previews: the configured site domain
// (NEXT_PUBLIC_SITE_URL), else a placeholder.
const SEO_PREVIEW_HOST = (() => {
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_URL;
    return raw ? new URL(raw).host || "example.com" : "example.com";
  } catch {
    return "example.com";
  }
})();

function PageMetaForm({
  title,
  description,
  ogImage,
  onChange,
}: {
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  ogImage?: string;
  onChange: (meta: {
    title: { en: string; ar: string };
    description?: { en: string; ar: string };
    ogImage?: string;
  }) => void;
}) {
  const slug = useLandingEditorStore((st) => st.currentPageSlug) ?? "home";
  const shownTitle = title.en || (slug === "home" ? "Creatofolio" : slug);
  return (
    <div className="space-y-2">
      <PanelTitle kicker="Page" title={slug === "home" ? "Home" : `/${slug}`} />
      <p className="px-0.5 pb-1 text-xs text-muted-foreground">
        Click a section or element on the canvas to edit it. Page-wide settings are below.
      </p>
      <Group id="page-seo" title="Search & sharing">
        {/* How the page reads in a Google result. */}
        <div className="rounded-md bg-white p-2.5 text-start" aria-label="Search result preview">
          <div className="truncate text-[11px] text-[#4d5156]">{SEO_PREVIEW_HOST}{slug === "home" ? "" : ` › ${slug}`}</div>
          <div className="truncate text-[15px] leading-snug text-[#1a0dab]">{shownTitle}</div>
          <div className="line-clamp-2 text-[12px] leading-snug text-[#4d5156]">
            {description.en || "Add a description so search results show your words, not a random snippet."}
          </div>
        </div>
        <Field label="Title (EN)">
          <Input value={title.en} maxLength={70} onChange={(e) => onChange({ title: { ...title, en: e.target.value }, description, ogImage })} />
        </Field>
        <Field label="Title (AR)">
          <Input value={title.ar} dir="rtl" maxLength={70} onChange={(e) => onChange({ title: { ...title, ar: e.target.value }, description, ogImage })} />
        </Field>
        <Field label={`Description (EN) · ${description.en.length}/160`}>
          <Textarea
            rows={3}
            value={description.en}
            maxLength={200}
            onChange={(e) => onChange({ title, description: { ...description, en: e.target.value }, ogImage })}
          />
        </Field>
        <Field label={`Description (AR) · ${description.ar.length}/160`}>
          <Textarea
            rows={3}
            dir="rtl"
            value={description.ar}
            maxLength={200}
            onChange={(e) => onChange({ title, description: { ...description, ar: e.target.value }, ogImage })}
          />
        </Field>
        <FieldControl
          field={{ kind: "image", key: "ogImage", label: "Share image (link previews)" }}
          value={ogImage}
          onChange={(v) =>
            onChange({ title, description, ogImage: (v as string) || undefined })
          }
        />
        {/* How it looks when the link is pasted into LinkedIn / WhatsApp / X. */}
        <div
          className="overflow-hidden rounded-md border border-border bg-card text-start"
          aria-label="Share card preview"
        >
          <div className="aspect-[1.91/1] w-full bg-muted">
            {ogImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ogImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center px-3 text-center text-[11px] text-muted-foreground">
                No share image: the site default is used (Site settings → SEO defaults).
              </div>
            )}
          </div>
          <div className="space-y-0.5 px-2.5 py-2">
            <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {SEO_PREVIEW_HOST}
            </div>
            <div className="truncate text-[13px] font-medium">{shownTitle}</div>
          </div>
        </div>
      </Group>
    </div>
  );
}

/**
 * Replay a section's scroll reveal on the editor canvas — the same timeline
 * the live page runs (sectionReveal.ts), scrolled into view first. The
 * timeline clears its inline styles when done, so the canvas returns to the
 * exact authored state (and the editing handles line up again).
 */
function previewReveal(section: DrawnSection) {
  const canvas = document.querySelector("[data-editor-canvas]");
  const el = canvas?.querySelector<HTMLElement>(
    `.drawn-section[data-section-id="${CSS.escape(section.id)}"]`
  );
  if (!el) return;
  el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  buildSectionReveal(el, section.revealStyle ?? "fade-up")?.play();
}

/** Section title + subtitle: real canvas text elements. Add one (pre-styled,
 *  at the top) or jump to the existing one to move / restyle it. */
function SectionTitleButtons({ section }: { section: DrawnSection }) {
  const addAsset = useLandingEditorStore((s) => s.addAsset);
  const selectAsset = useLandingEditorStore((s) => s.selectAsset);
  const row = (role: "heading" | "subheading", label: string) => {
    const existing = section.assets.find((a) => a.titleRole === role);
    return (
      <Button
        key={role}
        size="sm"
        variant={existing ? "secondary" : "outline"}
        className="w-full justify-start"
        onClick={() => {
          if (existing) {
            selectAsset(existing.iid);
            return;
          }
          const z = section.assets.reduce((m, a) => Math.max(m, a.zIndex), 0) + 1;
          const asset = makeTitleAsset(
            role,
            role === "heading" ? { en: "Section title", ar: "عنوان القسم" } : { en: "A line that supports the title.", ar: "سطر يدعم العنوان." },
            role === "heading" ? { x: 20, y: 6, w: 60, h: 12 } : { x: 20, y: 19, w: 60, h: 8 },
            newIid(),
            z
          );
          addAsset(section.iid, asset);
          selectAsset(asset.iid);
        }}
      >
        {existing ? `Edit the ${label}` : `Add a ${label}`}
      </Button>
    );
  };
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        Titles are normal text on the canvas: drag, resize, pick a font, place them per device.
      </p>
      {row("heading", "title")}
      {row("subheading", "subtitle")}
    </div>
  );
}
