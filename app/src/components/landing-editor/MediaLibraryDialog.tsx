"use client";

// MediaLibraryDialog: pick a file that's already uploaded, or upload new ones
// (button or drag-and-drop), like a builder's "Select image" / Shopify Files
// picker. Images by default ("Add image", "Replace image", image fields);
// `kinds` adds tabs for videos, sounds and documents (pop-up media fields).
// Images are resized before upload; videos/sounds/files go through the upload
// route, which checks their type server-side.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, Film, ImagePlus, Loader2, Music, Search, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadContentImage } from "@/lib/editorData";
import type { ImageKind } from "@/lib/imagePrep";
import type { MediaKind } from "@/data/landingTypes";
import {
  MEDIA_ACCEPT,
  formatBytes,
  listMedia,
  mediaDisplayName,
  readNaturalSize,
  uploadMediaFile,
  type MediaItem,
} from "@/lib/landingMedia";

export interface PickedImage {
  url: string;
  naturalSize?: { w: number; h: number };
  /** What was picked (always "image" unless `kinds` offers more). */
  kind?: MediaKind;
  name?: string;
  bytes?: number;
}

const TAB: Record<MediaKind, { label: string; noun: string; icon: typeof Film }> = {
  image: { label: "Images", noun: "images", icon: ImagePlus },
  video: { label: "Videos", noun: "videos", icon: Film },
  audio: { label: "Sounds", noun: "sound files", icon: Music },
  file: { label: "Files", noun: "PDFs", icon: FileText },
};

const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "weba", "flac"];

/** Which tab an upload belongs to (null = not something we take). */
function kindOfFile(f: File, allowed: MediaKind[]): MediaKind | null {
  const ext = (f.name.split(".").pop() ?? "").toLowerCase();
  const k: MediaKind | null = f.type.startsWith("image/")
    ? "image"
    : f.type.startsWith("video/") || VIDEO_EXT.includes(ext)
      ? "video"
      : f.type.startsWith("audio/") || AUDIO_EXT.includes(ext)
        ? "audio"
        : f.type === "application/pdf" || ext === "pdf"
          ? "file"
          : null;
  return k && allowed.includes(k) ? k : null;
}

const IMAGES_ONLY: MediaKind[] = ["image"];

export function MediaLibraryDialog({
  open,
  onOpenChange,
  onPick,
  title,
  confirmLabel,
  uploadKind = "landing",
  kinds = IMAGES_ONLY,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (img: PickedImage) => void;
  title?: string;
  confirmLabel?: string;
  uploadKind?: ImageKind;
  /** Tabs, in order; the first opens. Default: images only. */
  kinds?: MediaKind[];
}) {
  const [tab, setTab] = useState<MediaKind>(kinds[0] ?? "image");
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (k: MediaKind) => {
    const res = await listMedia(k);
    setItems(res.items);
    setError(res.error ?? null);
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listMedia(tab).then((res) => {
      if (!live) return;
      setItems(res.items);
      setError(res.error ?? null);
    });
    return () => {
      live = false;
    };
  }, [open, tab]);

  // Closing (any way) clears the selection, filter and tab for next time.
  const setOpen = (o: boolean) => {
    if (!o) {
      setSelected(null);
      setQuery("");
      setTab(kinds[0] ?? "image");
    }
    onOpenChange(o);
  };

  const switchTab = (k: MediaKind) => {
    if (k === tab) return;
    setItems(null);
    setSelected(null);
    setTab(k);
  };

  const pick = async (url: string) => {
    const it = items?.find((i) => i.url === url);
    onPick({
      url,
      kind: tab,
      name: it ? mediaDisplayName(it.name) : undefined,
      bytes: it?.bytes,
      naturalSize: tab === "image" ? await readNaturalSize(url) : undefined,
    });
    setOpen(false);
  };

  const upload = async (files: FileList | File[]) => {
    const all = Array.from(files);
    const list = all.filter((f) => kindOfFile(f, kinds) !== null);
    if (list.length < all.length) {
      toast.error(`Only ${kinds.map((k) => TAB[k].noun).join(", ")} can be added here.`);
    }
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    const done: { url: string; kind: MediaKind }[] = [];
    for (const f of list) {
      const k = kindOfFile(f, kinds)!;
      let url: string | null = null;
      if (k === "image") {
        url = await uploadContentImage(f, uploadKind);
        if (!url) toast.error(`Couldn't upload ${f.name}`);
      } else {
        const res = await uploadMediaFile(f, k);
        url = res.url ?? null;
        if (!url) toast.error(`Couldn't upload ${f.name}: ${res.error}`);
      }
      setUploading((n) => n - 1);
      if (url) done.push({ url, kind: k });
    }
    // Show the shelf the upload went to; one file → select it, ready to use.
    const shelf = done[done.length - 1]?.kind ?? tab;
    if (shelf !== tab) setTab(shelf);
    else await refresh(shelf);
    if (done.length === 1) setSelected(done[0].url);
  };

  const visible = (items ?? []).filter((i) => !query || i.name.toLowerCase().includes(query.toLowerCase()));
  const noun = TAB[tab].noun;
  const heading =
    title ??
    (kinds.length > 1
      ? "Choose a file"
      : ({ image: "Choose an image", video: "Choose a video", audio: "Choose a sound", file: "Choose a PDF" } as const)[
          kinds[0] ?? "image"
        ]);
  const useLabel = confirmLabel ?? (tab === "image" ? "Use image" : "Use this");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex max-h-[85dvh] max-w-3xl flex-col sm:max-w-3xl"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            {tab === "image"
              ? "Everything you've uploaded or drawn. Drop image files anywhere here to upload."
              : `Your uploaded ${noun} (25 MB each at most). Drop files anywhere here to upload.`}
          </DialogDescription>
        </DialogHeader>

        {kinds.length > 1 && (
          <div role="tablist" aria-label="Kind of file" className="flex gap-1 border-b border-border">
            {kinds.map((k) => {
              const Icon = TAB[k].icon;
              const on = k === tab;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => switchTab(k)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm ${
                    on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" /> {TAB[k].label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <Upload /> Upload
          </Button>
          {uploading > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Uploading {uploading}…
            </span>
          )}
          <div className="relative ms-auto w-48">
            <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name"
              className="h-8 ps-7 text-xs"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={kinds.map((k) => MEDIA_ACCEPT[k]).join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div
          className={`min-h-64 flex-1 overflow-y-auto rounded-lg border p-2 transition-colors ${
            dragOver ? "border-primary bg-primary/10" : "border-border"
          }`}
        >
          {items === null ? (
            <div className="flex h-60 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : error && items.length === 0 ? (
            <p className="p-6 text-center text-sm text-destructive">
              Couldn&apos;t load your {noun}: {error}
            </p>
          ) : visible.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-60 w-full flex-col items-center justify-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50"
            >
              <Upload className="size-6" />
              {query ? `No ${noun} match.` : `No ${noun} yet. Upload or drop some here.`}
            </button>
          ) : tab !== "image" ? (
            <ul className="flex flex-col gap-1">
              {visible.map((it) => {
                const on = selected === it.url;
                const Icon = TAB[tab].icon;
                return (
                  <li key={it.url}>
                    <button
                      type="button"
                      onClick={() => setSelected(it.url)}
                      onDoubleClick={() => void pick(it.url)}
                      aria-pressed={on}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-start text-sm ${
                        on ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-accent/50"
                      }`}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{mediaDisplayName(it.name)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(it.bytes)}</span>
                      {on && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {visible.map((it) => {
                const on = selected === it.url;
                return (
                  <button
                    key={it.url}
                    type="button"
                    title={it.name}
                    onClick={() => setSelected(it.url)}
                    onDoubleClick={() => void pick(it.url)}
                    className={`media-tile group relative aspect-square overflow-hidden rounded-md ring-offset-2 ring-offset-popover transition ${
                      on ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-foreground/40"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt="" loading="lazy" className="h-full w-full object-contain" />
                    {on && (
                      <span className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!selected} onClick={() => selected && void pick(selected)}>
            {useLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
