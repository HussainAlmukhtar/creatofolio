"use client";

// Big, readable controls for the Nav Studio — choice cards instead of tiny
// switches and dropdowns, so every option is visible at a glance.

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { InfoTip } from "../InfoTip";

export function StudioSection({
  title,
  info,
  children,
}: {
  title: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {title}
        {info && <InfoTip text={info} side="right" />}
      </h3>
      {children}
    </section>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Tiny diagram of the option. */
  sketch?: React.ReactNode;
}

export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 2,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4;
}) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 xl:grid-cols-4" }[columns];
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${cols}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex flex-col items-stretch gap-2 rounded-lg border p-2.5 text-start transition ${
              on
                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                : "border-border hover:border-foreground/30 hover:bg-accent/40"
            }`}
          >
            {o.sketch && (
              <div className="h-12 overflow-hidden rounded-md border border-border bg-muted/60">{o.sketch}</div>
            )}
            <span className="text-[13px] font-medium leading-tight">{o.label}</span>
            {o.description && (
              <span className="text-[11px] leading-snug text-muted-foreground">{o.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function BigToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition ${
        checked ? "border-primary/60 bg-primary/5" : "border-border hover:bg-accent/40"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="scale-125" />
    </label>
  );
}

export function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  onChange,
  zeroLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  /** Shown instead of the number at 0 (e.g. "Full width"). */
  zeroLabel?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex justify-between text-[12px] text-muted-foreground">
        {label}
        <span className="tabular-nums text-foreground">{value === 0 && zeroLabel ? zeroLabel : `${value}${unit}`}</span>
      </span>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} />
    </label>
  );
}

export function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  /** Swatch shown while empty (the theme default). */
  fallback: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        <input
          type="color"
          value={value.startsWith("#") ? value.slice(0, 7) : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent"
        />
        <Input value={value} placeholder="Theme default" onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

export function LocalizedInputs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { en: string; ar: string };
  onChange: (v: { en: string; ar: string }) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {(["en", "ar"] as const).map((lang) => (
        <div key={lang} className="relative">
          <Input
            dir={lang === "ar" ? "rtl" : "ltr"}
            className="pe-10"
            value={value[lang]}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
          />
          <span className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase text-muted-foreground">
            {lang}
          </span>
        </div>
      ))}
    </div>
  );
}
