"use client";

// FormFields — the generated-field renderer shared by BlockInspector (a
// block's props) and SiteSettingsPanel (site-wide config). Both are just a
// flat object addressed by FieldDescriptor.key, so one field renderer serves
// both — no block or settings section hand-builds its own form.

import { createContext, useContext, useId, useState } from "react";
import dynamic from "next/dynamic";
import { newIid } from "@/lib/iid";
import { isReservedSlug } from "@/lib/landingEditorData";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import { fieldVisible, type FieldDescriptor, type MediaKind } from "@/data/landingTypes";
import { formatBytes, mediaDisplayName } from "@/lib/landingMedia";
import { urlProblem } from "@/lib/safeUrl";
import type { TipTapDoc } from "@/data/contentTypes";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronUp,
  ChevronDown,
  Plus,
  Trash2,
  ImageIcon,
  ChevronRight,
  FileText,
  Film,
  Music,
  Paintbrush,
} from "lucide-react";
import { MediaLibraryDialog } from "./MediaLibraryDialog";
import type { ImageKind } from "@/lib/imagePrep";
import { PLACEHOLDER_SVG, isPlaceholderSrc } from "@/data/landingPlaceholders";

/**
 * Where the generated inspector is used. The landing editor needs nothing
 * (defaults); the pop-up composer passes `surface: "popup"` (content-sized
 * image uploads, no per-block fonts) and its own page list (null = don't check
 * internal links against landing pages).
 */
export interface InspectorEnv {
  surface: "page" | "popup";
  pages?: { slug: string; status: string }[] | null;
}
export const InspectorContext = createContext<InspectorEnv>({ surface: "page" });

// TipTap only loads where a rich-text field is actually shown.
// The drawing studio (Klecks iframe), only loaded when an image is drawn.
const LandingDrawModal = dynamic(() => import("./LandingDrawModal"), { ssr: false });

const RichTextField = dynamic(() => import("@/components/popup-editor/RichTextField"), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded-md bg-accent/40" />,
});

export function FieldShell({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <Label className="text-muted-foreground">{label}</Label>}
      {children}
    </div>
  );
}

function ImageField({
  value,
  onChange,
  uploadKind,
  sceneId,
  onDrawn,
}: {
  value: string;
  onChange: (url: string) => void;
  uploadKind?: ImageKind;
  /** The kept layered drawing behind this image, if it was drawn here. */
  sceneId?: string;
  /** Present = the field can be drawn in the studio: saves the PNG url and
   *  its layered PSD id (so "Edit drawing" reopens the layers). */
  onDrawn?: (url: string, sceneId: string | undefined) => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [drawing, setDrawing] = useState<null | "new" | "edit">(null);
  const empty = !value || isPlaceholderSrc(value);
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => setLibraryOpen(true)}
        title={empty ? "Choose an image" : "Replace image"}
        className="media-tile grid size-14 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-border hover:ring-foreground/40"
      >
        {empty ? (
          <ImageIcon className="size-5 text-neutral-500" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-full w-full object-cover" />
        )}
      </button>
      <div className="flex flex-col items-start gap-1">
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="secondary" onClick={() => setLibraryOpen(true)}>
            {empty ? "Choose image…" : "Replace…"}
          </Button>
          {onDrawn && (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setDrawing(!empty && sceneId ? "edit" : "new")}
              title={!empty && sceneId ? "Reopen this drawing with its layers" : "Draw it in the studio"}
            >
              <Paintbrush className="size-3" /> {!empty && sceneId ? "Edit drawing" : "Draw…"}
            </Button>
          )}
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => (onDrawn ? onDrawn(PLACEHOLDER_SVG, undefined) : onChange(PLACEHOLDER_SVG))}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Remove
          </button>
        )}
      </div>
      <MediaLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        // A picked or uploaded image replaces the drawing (and forgets its layers).
        onPick={({ url }) => (onDrawn ? onDrawn(url, undefined) : onChange(url))}
        uploadKind={uploadKind}
      />
      {drawing && onDrawn && (
        <LandingDrawModal
          title={drawing === "edit" ? "Edit drawing" : "Draw an image"}
          canvas={IMAGE_DRAW_CANVAS}
          edit={drawing === "edit" && sceneId ? { sceneId, pngUrl: value } : undefined}
          saveLabel="Use this drawing"
          autosaveKey={`image-field:${sceneId ?? "new"}`}
          onClose={() => setDrawing(null)}
          onSaved={(url, _size, newSceneId) => onDrawn(url, newSceneId)}
        />
      )}
    </div>
  );
}

/** Canvas for an image drawn from an inspector field (trimmed to the art on save). */
const IMAGE_DRAW_CANVAS = { w: 1600, h: 1200 };

const MEDIA_ICON: Record<MediaKind, typeof Film> = { image: ImageIcon, video: Film, audio: Music, file: FileText };

/** The kind of a stored media URL, from its bucket/extension (for the chip). */
function mediaKindOf(url: string, accept: MediaKind[]): MediaKind {
  if (/\/content-videos\/|\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url)) return "video";
  if (/\.pdf(\?|$)/i.test(url)) return "file";
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|weba|flac)(\?|$)/i.test(url)) return "audio";
  if (/\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(url) || /\/content-images\//.test(url)) return "image";
  return accept[0] ?? "file";
}

/**
 * A file from the media library (video / sound / PDF, or an image where the
 * field also takes one). Writes the URL, plus the picked kind, name and size
 * into the sibling props named by `meta` (via `onPatch`).
 */
function MediaField({
  field,
  value,
  onChange,
  onPatch,
}: {
  field: Extract<FieldDescriptor, { kind: "media" }>;
  value: string;
  onChange: (v: unknown) => void;
  onPatch?: (partial: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const env = useContext(InspectorContext);
  const empty = !value || isPlaceholderSrc(value);
  const kind = empty ? field.accept[0] : mediaKindOf(value, field.accept);
  const Icon = MEDIA_ICON[kind];
  const name = empty ? "" : mediaDisplayName(decodeURIComponent(value.split("/").pop()?.split("?")[0] ?? ""));
  const nouns = field.accept.map((k) => ({ image: "image", video: "video", audio: "sound", file: "PDF" })[k]).join(" or ");
  const problem = empty ? null : urlProblem(value, kind === "image" ? "image" : "media");
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={empty ? `Choose a ${nouns}` : "Replace"}
          className="media-tile grid size-14 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-border hover:ring-foreground/40"
        >
          {!empty && kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon className="size-5 text-neutral-500" />
          )}
        </button>
        <div className="flex min-w-0 flex-col items-start gap-1">
          {name && <span className="max-w-full truncate text-xs text-muted-foreground" title={name}>{name}</span>}
          <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
            {empty ? `Choose ${nouns}…` : "Replace…"}
          </Button>
          {!empty && (
            <button
              type="button"
              onClick={() => {
                const m = field.meta ?? {};
                const patch: Record<string, unknown> = { [field.key]: "" };
                if (m.name) patch[m.name] = "";
                if (m.bytes) patch[m.bytes] = 0;
                if (onPatch) onPatch(patch);
                else onChange("");
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {problem && <p className="text-[11px] text-red-400">{problem}</p>}
      <MediaLibraryDialog
        open={open}
        onOpenChange={setOpen}
        kinds={field.accept}
        uploadKind={env.surface === "popup" ? "content" : "landing"}
        onPick={(picked) => {
          const m = field.meta ?? {};
          const patch: Record<string, unknown> = { [field.key]: picked.url };
          if (m.kind) patch[m.kind] = picked.kind ?? field.accept[0];
          if (m.name) patch[m.name] = picked.name ?? "";
          if (m.bytes) patch[m.bytes] = picked.bytes ?? 0;
          if (onPatch) onPatch(patch);
          else onChange(picked.url);
        }}
      />
    </div>
  );
}

/** "12 MB · my-cv.pdf" for read-only notes. */
export function describeFile(name: string | undefined, bytes: number | undefined): string {
  return [formatBytes(bytes), name].filter(Boolean).join(" · ");
}

/**
 * A link input that knows the site's pages: the dropdown suggests every page
 * (`/` for home, `/<slug>` otherwise — drafts marked), free text still works
 * for external URLs and #anchors, and a hint warns when an internal link
 * points at a page visitors can't open (a draft, or no such page).
 */
function UrlInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const allPages = useLandingEditorStore((s) => s.allPages);
  const env = useContext(InspectorContext);
  const listId = useId();
  const pages = (
    env.pages !== undefined ? (env.pages ?? []) : Object.values(allPages).map((r) => ({ slug: r.page.slug, status: r.status }))
  ).sort((a, b) => (a.slug === "home" ? -1 : b.slug === "home" ? 1 : a.slug.localeCompare(b.slug)));
  // A composer without a page list can't judge internal links.
  const checkPages = env.pages !== null;

  // Only plain internal page paths are checked ("/about", "/about#x",
  // "/about?y"); external links, anchors and reserved routes are left alone.
  let hint: string | null = urlProblem(value, "link");
  const m = hint || !checkPages ? null : value.trim().match(/^\/([a-z0-9][a-z0-9_-]*)?\/?(?:[?#].*)?$/);
  if (m) {
    const slug = m[1] ?? "home";
    const page = pages.find((p) => p.slug === slug);
    // The public "/" always renders (static seed fallback), so home is never
    // "missing"; an unsaved seed home is also fine.
    if (!page && slug !== "home" && !isReservedSlug(slug)) {
      hint = `There's no page called "${slug}" — visitors will get a "not found" page.`;
    } else if (page && page.status !== "published" && slug !== "home") {
      hint = `"${slug}" is still a draft — visitors will get a "not found" page until you publish it.`;
    }
  }

  return (
    <>
      <Input
        value={value}
        list={listId}
        placeholder="Pick a page, or paste https://…"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {pages.map((p) => (
          <option
            key={p.slug}
            value={p.slug === "home" ? "/" : `/${p.slug}`}
            // Home is never marked draft: "/" always renders (the static seed
            // until a published home row exists).
            label={p.slug === "home" ? "Home" : `${p.slug}${p.status === "published" ? "" : " (draft)"}`}
          />
        ))}
      </datalist>
      {hint && (
        <p className={`text-[11px] ${urlProblem(value, "link") ? "text-red-400" : "text-amber-400"}`}>{hint}</p>
      )}
    </>
  );
}

/**
 * Render a single leaf field control (everything except `array`, which is
 * handled by ArrayField). `value` is the current value at the field's key;
 * `onChange` writes the new value back.
 */
export function FieldControl({
  field,
  value,
  onChange,
  onPatch,
  siblings,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Write several props of the same object at once (media fields' `meta`). */
  onPatch?: (partial: Record<string, unknown>) => void;
  /** The other props of the same object (an image field's kept drawing id). */
  siblings?: Record<string, unknown>;
}) {
  const env = useContext(InspectorContext);
  switch (field.kind) {
    case "richtext":
      return (
        <RichTextField
          label={field.label}
          value={value as { en?: TipTapDoc; ar?: TipTapDoc } | undefined}
          onChange={onChange}
        />
      );
    case "heading":
      return <h4 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</h4>;
    case "note":
      return <p className="text-[11px] text-muted-foreground">{field.label}</p>;
    case "text":
    case "textarea": {
      if (field.localized) {
        const v = (value as { en?: string; ar?: string }) ?? { en: "", ar: "" };
        const Comp = field.kind === "textarea" ? "textarea" : "input";
        return (
          <FieldShell label={field.label}>
            {/* EN / AR tags stay visible once filled, so the two lines
                can't be confused. */}
            <div className="space-y-1">
              <div className="relative">
                <Comp
                  className="w-full rounded-md border border-input bg-transparent py-1.5 pe-9 ps-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  rows={field.kind === "textarea" ? 3 : undefined}
                  value={v.en ?? ""}
                  placeholder="English"
                  onChange={(e) => onChange({ ...v, en: e.target.value })}
                />
                <span className="pointer-events-none absolute right-2 top-2 text-[9px] font-semibold tracking-wide text-muted-foreground/70">EN</span>
              </div>
              <div className="relative">
                <Comp
                  dir="rtl"
                  className="w-full rounded-md border border-input bg-transparent py-1.5 pl-9 pr-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  rows={field.kind === "textarea" ? 3 : undefined}
                  value={v.ar ?? ""}
                  placeholder="العربية"
                  onChange={(e) => onChange({ ...v, ar: e.target.value })}
                />
                <span className="pointer-events-none absolute left-2 top-2 text-[9px] font-semibold tracking-wide text-muted-foreground/70">AR</span>
              </div>
            </div>
          </FieldShell>
        );
      }
      const Comp = field.kind === "textarea" ? "textarea" : "input";
      return (
        <FieldShell label={field.label}>
          <Comp
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            rows={field.kind === "textarea" ? 3 : undefined}
            value={(value as string) ?? ""}
            placeholder={field.kind === "text" ? field.placeholder : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        </FieldShell>
      );
    }
    case "url":
      return (
        <FieldShell label={field.label}>
          <UrlInput value={(value as string) ?? ""} onChange={onChange} />
        </FieldShell>
      );
    case "range": {
      // Slider + live value (columns, gap, zoom…): quicker than typing.
      const n = Number.isFinite(value as number) ? (value as number) : field.min;
      return (
        <FieldShell label={field.label}>
          <div className="flex items-center gap-3">
            <Slider
              className="flex-1"
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              value={[n]}
              onValueChange={(v) => onChange(v[0])}
            />
            <span className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
              {n}
              {field.unit ?? ""}
            </span>
          </div>
        </FieldShell>
      );
    }
    case "number":
      return (
        <FieldShell label={field.label}>
          <Input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={Number.isFinite(value as number) ? (value as number) : 0}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!Number.isNaN(n)) onChange(n);
            }}
          />
        </FieldShell>
      );
    case "toggle":
      return (
        <div className="flex items-center gap-2">
          <Switch size="sm" checked={Boolean(value)} onCheckedChange={(v) => onChange(v)} />
          <Label>{field.label}</Label>
        </div>
      );
    case "select":
      return (
        <FieldShell label={field.label}>
          <Select value={(value as string) ?? field.options[0]?.value} onValueChange={onChange}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
      );
    case "color":
      return (
        <FieldShell label={field.label}>
          <div className="flex gap-2">
            <input
              type="color"
              value={typeof value === "string" && value.startsWith("#") ? value : "#2b2420"}
              onChange={(e) => onChange(e.target.value)}
              className="h-9 w-10 shrink-0 rounded-lg border border-input bg-transparent"
            />
            <Input value={(value as string) ?? ""} placeholder="blank = default" onChange={(e) => onChange(e.target.value || "")} />
          </div>
        </FieldShell>
      );
    case "align": {
      const cur = (value as string) ?? "center";
      const opts: { v: string; icon: React.ReactNode }[] = [
        { v: "left", icon: <AlignLeft className="size-4" /> },
        { v: "center", icon: <AlignCenter className="size-4" /> },
        { v: "right", icon: <AlignRight className="size-4" /> },
      ];
      return (
        <FieldShell label={field.label}>
          <div className="flex gap-1">
            {opts.map((o) => (
              <Button
                key={o.v}
                size="icon-sm"
                variant={cur === o.v ? "default" : "secondary"}
                onClick={() => onChange(o.v)}
                type="button"
              >
                {o.icon}
              </Button>
            ))}
          </div>
        </FieldShell>
      );
    }
    case "image":
      return (
        <FieldShell label={field.label}>
          <ImageField
            value={(value as string) ?? ""}
            onChange={onChange}
            // Share images are shown at exactly 1200×630 by link previews.
            uploadKind={/ogimage/i.test(field.key) ? "og" : env.surface === "popup" ? "content" : "landing"}
            // Drawable when the host can write two props at once (blocks and
            // their list items): the PNG plus `<key>SceneId`, the kept PSD
            // (storageRefs counts any `…SceneId` key, so the scan keeps it).
            sceneId={(siblings?.[`${field.key}SceneId`] as string | undefined) || undefined}
            onDrawn={
              onPatch && !/ogimage/i.test(field.key)
                ? (url, sceneId) => onPatch({ [field.key]: url, [`${field.key}SceneId`]: sceneId ?? "" })
                : undefined
            }
          />
        </FieldShell>
      );
    case "media":
      return (
        <FieldShell label={field.label}>
          <MediaField field={field} value={(value as string) ?? ""} onChange={onChange} onPatch={onPatch} />
        </FieldShell>
      );
    default:
      return null;
  }
}

export function ArrayField({
  field,
  items,
  onChange,
}: {
  field: Extract<FieldDescriptor, { kind: "array" }>;
  items: Record<string, unknown>[];
  onChange: (items: Record<string, unknown>[]) => void;
}) {
  const set = (i: number, key: string, v: unknown) => patchItem(i, { [key]: v });
  const patchItem = (i: number, partial: Record<string, unknown>) => {
    const next = items.map((it, idx) => (idx === i ? { ...it, ...partial } : it));
    onChange(next);
  };
  const remove = (i: number) => {
    if (field.min && items.length <= field.min) return;
    onChange(items.filter((_, idx) => idx !== i));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // Label: the item's own text, else a type-aware name ("Image 2", not
  // "Item 2"); thumbnail: the item's image, if it has one.
  const noun = field.label.replace(/s$/i, "") || "Item";
  const itemName = (it: Record<string, unknown>, i: number): string => {
    const raw = field.itemLabelKey ? it[field.itemLabelKey] : undefined;
    const text =
      raw && typeof raw === "object" && "en" in (raw as object)
        ? (raw as { en?: string }).en
        : typeof raw === "string"
          ? raw
          : "";
    return text || `${noun} ${i + 1}`;
  };
  const imageKey = field.itemFields.find((f) => f.kind === "image")?.key;
  // Collapsed rows (Shopify-style); one open at a time. A newly added item
  // opens so it can be filled in straight away.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground">
          {field.label} <span className="font-normal text-muted-foreground/70">· {items.length}</span>
        </Label>
        <Button
          size="xs"
          variant="secondary"
          type="button"
          disabled={Boolean(field.max && items.length >= field.max)}
          onClick={() => {
            const id = newIid();
            if (field.max && items.length >= field.max) return;
            onChange([...items, { ...structuredClone(field.defaultItem), id }]);
            setOpenId(id);
          }}
        >
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {items.map((it, i) => {
          const id = (it.id as string) ?? String(i);
          const isOpen = openId === id;
          const img = imageKey ? (it[imageKey] as string | undefined) : undefined;
          return (
            <div key={id} className="border-b border-border last:border-b-0">
              <div className={`group flex h-10 items-center gap-2 pe-1 ps-2 ${isOpen ? "bg-accent/60" : "hover:bg-accent/40"}`}>
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                  aria-expanded={isOpen}
                >
                  <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  {imageKey && (
                    <span className="media-tile grid size-7 shrink-0 place-items-center overflow-hidden rounded ring-1 ring-border">
                      {img && !isPlaceholderSrc(img) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="size-3.5 text-neutral-500" />
                      )}
                    </span>
                  )}
                  <span className="truncate text-xs font-medium">{itemName(it, i)}</span>
                </button>
                <span className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
                  <Button size="icon-xs" variant="ghost" onClick={() => move(i, -1)} type="button" title="Move up" disabled={i === 0}>
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => move(i, 1)} type="button" title="Move down" disabled={i === items.length - 1}>
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="hover:text-destructive"
                    onClick={() => remove(i)}
                    type="button"
                    title="Remove"
                    disabled={Boolean(field.min && items.length <= field.min)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </span>
              </div>
              {isOpen && (
                <div className="space-y-2.5 border-t border-border bg-background/40 p-2.5">
                  {field.itemFields
                    .filter((f) => fieldVisible(f, it, field.itemFields))
                    .map((f, fi) =>
                      f.kind === "heading" || f.kind === "note" ? (
                        <FieldControl key={f.label} field={f} value={undefined} onChange={() => {}} />
                      ) : f.kind === "array" ? (
                        // One level of nesting (e.g. a CV section's items).
                        <ArrayField
                          key={f.key}
                          field={f}
                          items={(it[f.key] as Record<string, unknown>[]) ?? []}
                          onChange={(v) => set(i, f.key, v)}
                        />
                      ) : (
                        <FieldControl
                          key={`${f.key}:${fi}`}
                          field={f}
                          value={it[f.key]}
                          onChange={(v) => set(i, f.key, v)}
                          onPatch={(partial) => patchItem(i, partial)}
                          siblings={it}
                        />
                      )
                    )}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">None yet.</p>}
      </div>
    </div>
  );
}
