// Shared helpers for block components + the registry.

import type { Localized } from "@/data/landingTypes";

/** Read a possibly-localized value as a plain string for the active language. */
export function L(value: unknown, lang: "en" | "ar"): string {
  if (value && typeof value === "object" && "en" in (value as Localized)) {
    const o = value as Localized;
    return (lang === "ar" ? o.ar : o.en) || o.en || "";
  }
  return typeof value === "string" ? value : "";
}

/** Map an align string to a CSS text-align / flex alignment. */
export function alignToCss(align: unknown): "left" | "center" | "right" {
  return align === "left" || align === "right" ? align : "center";
}
