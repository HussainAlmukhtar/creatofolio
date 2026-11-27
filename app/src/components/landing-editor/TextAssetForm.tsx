"use client";

// TextAssetForm — typography controls for a text asset. Built on the project's
// shadcn/Radix components (Select, Slider, Switch, Input, Label, Button) so it
// matches the rest of the app and behaves properly (keyboard, a11y, theming).

import type { DrawnAsset, DrawnTextStyle } from "@/data/landingTypes";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { FontPairField } from "./FontPicker";

type TextSource = Extract<DrawnAsset["source"], { kind: "text" }>;

const WEIGHTS: { value: number; label: string }[] = [
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extrabold" },
];

const FONTS: { value: DrawnTextStyle["fontFamily"]; label: string }[] = [
  { value: "display", label: "Heading (site display font)" },
  { value: "body", label: "Text (site body font)" },
  { value: "mono", label: "Mono" },
];

export function TextAssetForm({
  source,
  onContent,
  onStyle,
}: {
  source: TextSource;
  onContent: (lang: "en" | "ar", value: string) => void;
  onStyle: (partial: Partial<DrawnTextStyle>) => void;
}) {
  const { text, style } = source;

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Text
      </h3>

      <div className="space-y-1.5">
        <Label>Content (EN)</Label>
        <textarea
          value={text.en}
          onChange={(e) => onContent("en", e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Content (AR)</Label>
        <textarea
          value={text.ar}
          dir="rtl"
          onChange={(e) => onContent("ar", e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Text style</Label>
        <Select
          value={style.fontFamily}
          onValueChange={(v) =>
            onStyle({ fontFamily: v as DrawnTextStyle["fontFamily"] })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONTS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FontPairField
        label="Font"
        latin={style.font}
        arabic={style.fontAr}
        defaultLabel="Site font for this style"
        onChange={(font, fontAr) => onStyle({ font, fontAr })}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Size</Label>
          <span className="text-xs text-muted-foreground">{style.fontSize}</span>
        </div>
        <Slider
          min={1}
          max={14}
          step={0.5}
          value={[style.fontSize]}
          onValueChange={([v]) => onStyle({ fontSize: v })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Line height</Label>
          <span className="text-xs text-muted-foreground">{(style.lineHeight ?? 1.15).toFixed(2)}</span>
        </div>
        <Slider
          min={0.8}
          max={2.2}
          step={0.05}
          value={[style.lineHeight ?? 1.15]}
          onValueChange={([v]) => onStyle({ lineHeight: v })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Weight</Label>
        <Select
          value={String(style.fontWeight)}
          onValueChange={(v) => onStyle({ fontWeight: Number(v) })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEIGHTS.map((w) => (
              <SelectItem key={w.value} value={String(w.value)}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Colour</Label>
        <div className="flex gap-2">
          <input
            type="color"
            value={style.color.startsWith("#") ? style.color : "#2b2b2b"}
            onChange={(e) => onStyle({ color: e.target.value })}
            className="h-9 w-10 shrink-0 rounded-lg border border-input bg-transparent"
          />
          <Input
            value={style.color}
            onChange={(e) => onStyle({ color: e.target.value })}
            placeholder="#2b2b2b or var(--…)"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Alignment</Label>
        <div className="flex gap-1">
          {(
            [
              ["left", AlignLeft],
              ["center", AlignCenter],
              ["right", AlignRight],
            ] as const
          ).map(([val, Icon]) => (
            <Button
              key={val}
              type="button"
              size="icon-sm"
              variant={style.align === val ? "secondary" : "ghost"}
              onClick={() => onStyle({ align: val })}
              aria-label={`Align ${val}`}
            >
              <Icon />
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          size="sm"
          checked={Boolean(style.italic)}
          onCheckedChange={(v) => onStyle({ italic: v })}
          id="text-italic"
        />
        <Label htmlFor="text-italic">Italic</Label>
      </div>
    </div>
  );
}
