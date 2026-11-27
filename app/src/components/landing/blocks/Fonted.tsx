"use client";

// Fonted — a text element that applies its own font pick (the `font` /
// `fontAr` props of the Heading and Text blocks), resolving uploaded fonts
// through CustomFontsContext. No pick = the role's font (its className).

import { useContext } from "react";
import type { FontKey } from "@/data/landingTypes";
import { elementFontFamily } from "@/data/fonts";
import { CustomFontsContext } from "../SiteFonts";

export function Fonted({
  as: Tag,
  font,
  fontAr,
  role,
  language,
  className,
  style,
  children,
}: {
  as: "h2" | "h3" | "h4" | "p";
  font: unknown;
  fontAr: unknown;
  role: "display" | "body";
  language: "en" | "ar";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const customFonts = useContext(CustomFontsContext);
  const fontFamily = elementFontFamily(
    typeof font === "string" ? (font as FontKey) : undefined,
    typeof fontAr === "string" ? (fontAr as FontKey) : undefined,
    language,
    customFonts,
    role
  );
  return (
    <Tag className={className} style={fontFamily ? { ...style, fontFamily } : style}>
      {children}
    </Tag>
  );
}
