"use client";

// FontPicker — choose a font, previewed in itself. Opens in place (no
// portal, so it works inside the Nav Studio and dialogs alike): search,
// category chips, a sample line per font in English + Arabic, and "My fonts"
// for uploaded ones (with Upload).
//
// Previews load cheaply: one Google Fonts request with `text=` limited to the
// sample's letters, covering every catalog family at once.

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Upload } from "lucide-react";
import type { CustomFont, FontKey } from "@/data/landingTypes";
import {
  BUILTIN_FONTS,
  GOOGLE_FONTS,
  customFontFaces,
  fontFamilyCss,
  fontLabel,
  type CatalogFont,
  type FontCategory,
} from "@/data/fonts";
import { uploadSiteFont } from "@/lib/landingEditorData";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { newIid } from "@/lib/iid";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SAMPLE_EN = "Creatofolio Sketchbook";
const SAMPLE_AR = "دفتر الرسم";

const CATEGORIES: { id: FontCategory | "all" | "arabic" | "mine"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "handwriting", label: "Hand-drawn" },
  { id: "serif", label: "Serif" },
  { id: "sans", label: "Sans" },
  { id: "display", label: "Display" },
  { id: "arabic", label: "Arabic" },
  { id: "mono", label: "Mono" },
  { id: "mine", label: "My fonts" },
];

/** Google stylesheet subset to the sample letters, for every catalog font. */
const PREVIEW_HREF = (() => {
  const families = GOOGLE_FONTS.map((f) => `family=${encodeURIComponent(f.key.slice(7)).replace(/%20/g, "+")}`).join("&");
  const text = encodeURIComponent(Array.from(new Set(SAMPLE_EN + SAMPLE_AR + "Aa")).join(""));
  return `https://fonts.googleapis.com/css2?${families}&text=${text}&display=swap`;
})();

export function FontPicker({
  value,
  onChange,
  script,
  defaultLabel,
}: {
  value: FontKey | undefined;
  onChange: (key: FontKey | undefined) => void;
  /** Which sample leads, and what "Arabic" filtering means. */
  script: "latin" | "arabic";
  /** Offer a "use the default" row with this label (unset = no row). */
  defaultLabel?: string;
}) {
  const customFonts = useSiteConfigEditorStore((s) => s.config.typography?.customFonts ?? NO_FONTS);
  const updateTypography = useSiteConfigEditorStore((s) => s.updateTypography);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]["id"]>(script === "arabic" ? "arabic" : "all");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const customAsCatalog: CatalogFont[] = customFonts.map((f) => ({
    key: `custom:${f.id}`,
    name: f.name,
    category: "handwriting",
    arabic: f.script !== "latin",
    latin: f.script !== "arabic",
  }));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...customAsCatalog, ...BUILTIN_FONTS, ...GOOGLE_FONTS];
    return all.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      const mine = f.key.startsWith("custom:");
      if (cat === "mine") return mine;
      if (cat === "arabic") return f.arabic;
      if (cat === "all") return true;
      return !mine && f.category === cat;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, cat, customFonts]);

  const current = value ? fontLabel(value, customFonts) : (defaultLabel ?? "Choose a font");
  const sample = script === "arabic" ? SAMPLE_AR : SAMPLE_EN;

  const onUpload = async (file: File) => {
    setUploading(true);
    const res = await uploadSiteFont(file);
    setUploading(false);
    if (!res.url) {
      toast.error(`Upload failed: ${res.error}`);
      return;
    }
    const font: CustomFont = {
      id: newIid().slice(0, 8),
      name: file.name.replace(/\.(woff2?|ttf|otf)$/i, "").replace(/[-_]+/g, " "),
      url: res.url,
      weight: 400,
      style: "normal",
      script: script === "arabic" ? "both" : "latin",
    };
    updateTypography((t) => ({ ...t, customFonts: [...t.customFonts, font] }));
    toast.success(`“${font.name}” added to your fonts`);
    onChange(`custom:${font.id}`);
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-start"
      >
        <span
          className="min-w-0 flex-1 truncate text-[15px]"
          style={{ fontFamily: value ? fontFamilyCss(value, customFonts) : undefined }}
          dir={script === "arabic" ? "rtl" : "ltr"}
        >
          {value ? sample : current}
        </span>
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">{value ? current : ""}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-2 shadow-lg">
          {/* Previews of every catalog font (letters of the samples only). */}
          <link rel="stylesheet" href={PREVIEW_HREF} precedence="default" />
          {customFonts.length > 0 && <style>{customFontFaces(customFonts.map((f) => `custom:${f.id}`), customFonts)}</style>}
          <Input autoFocus placeholder="Search fonts…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  cat === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto" role="listbox">
            {defaultLabel && !query && cat !== "mine" && (
              <Row selected={!value} name={defaultLabel} onPick={() => pick(undefined)} preview={<span className="text-muted-foreground">{sample}</span>} />
            )}
            {list.map((f) => (
              <Row
                key={f.key}
                selected={value === f.key}
                name={f.name}
                badge={f.arabic ? "ع" : undefined}
                onPick={() => pick(f.key)}
                preview={
                  <span style={{ fontFamily: fontFamilyCss(f.key, customFonts) }} dir={script === "arabic" ? "rtl" : "ltr"}>
                    {script === "arabic" && f.arabic ? SAMPLE_AR : SAMPLE_EN}
                  </span>
                }
              />
            ))}
            {list.length === 0 && (
              <li className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                {cat === "mine" ? "No uploaded fonts yet." : "No fonts match."}
              </li>
            )}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-[11px] text-muted-foreground">
              Your own font: .woff2, .woff, .ttf or .otf. Uploaded fonts are site-wide: saved separately with Save &amp; go live.
            </span>
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload /> {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onUpload(f);
            }}
          />
        </div>
      )}
    </div>
  );

  function pick(key: FontKey | undefined) {
    onChange(key);
    setOpen(false);
    setQuery("");
  }
}

const NO_FONTS: CustomFont[] = [];

function Row({
  selected,
  name,
  badge,
  preview,
  onPick,
}: {
  selected: boolean;
  name: string;
  badge?: string;
  preview: React.ReactNode;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onPick}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent ${selected ? "bg-accent" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[18px] leading-tight">{preview}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {name}
            {badge && <span className="ms-1 rounded bg-muted px-1">{badge}</span>}
          </span>
        </span>
        {selected && <Check className="size-4 shrink-0" />}
      </button>
    </li>
  );
}

/** English + Arabic picks for one element / role. */
export function FontPairField({
  label,
  latin,
  arabic,
  onChange,
  defaultLabel,
}: {
  label: string;
  latin: FontKey | undefined;
  arabic: FontKey | undefined;
  onChange: (latin: FontKey | undefined, arabic: FontKey | undefined) => void;
  /** Offer "use the default" with this label. */
  defaultLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="space-y-1">
        <span className="text-[11px] text-muted-foreground">English</span>
        <FontPicker value={latin} onChange={(k) => onChange(k, arabic)} script="latin" defaultLabel={defaultLabel} />
      </div>
      <div className="space-y-1">
        <span className="text-[11px] text-muted-foreground">Arabic</span>
        <FontPicker
          value={arabic}
          onChange={(k) => onChange(latin, k)}
          script="arabic"
          defaultLabel={defaultLabel ? `${defaultLabel} (or the English pick)` : undefined}
        />
      </div>
    </div>
  );
}
