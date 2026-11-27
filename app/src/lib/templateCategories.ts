// Visual identity for object/template categories. One source of truth used by:
//   - the editor side panel (chips, save-as-template defaults)
//   - the editor canvas (selection outline tint)
//   - the in-game procedural placeholder fill (BaseRoomScene)
//   - the template library panel (category filter chips)
//
// Colors come from the LDtk school of "give every entity kind a color so a
// busy room is scannable at a glance". Plant=green, door=brown, etc.
//
// Procedural fallback runs in Phaser, which expects a number; CSS callers
// get a hex string. Both stay in sync because they're computed from the
// same hex-string source.

import type { TemplateCategory } from "./editorData";

interface CategoryStyle {
  hex: string;
  label: string;
  emoji: string;
}

const CATEGORY_STYLES: Record<TemplateCategory, CategoryStyle> = {
  door:       { hex: "#8B5A2B", label: "Doors",       emoji: "🚪" },
  furniture:  { hex: "#C8A06B", label: "Furniture",   emoji: "🪑" },
  plant:      { hex: "#4A7C59", label: "Plants",      emoji: "🪴" },
  decoration: { hex: "#9B6BBF", label: "Decoration",  emoji: "✨" },
  "wall-art": { hex: "#3F8F8E", label: "Wall Art",    emoji: "🖼️" },
  other:      { hex: "#7A7A7A", label: "Other",       emoji: "📦" },
};

const FALLBACK_HEX = "#7A7A7A";

export function categoryHex(category: string | undefined | null): string {
  if (!category) return FALLBACK_HEX;
  return CATEGORY_STYLES[category as TemplateCategory]?.hex ?? FALLBACK_HEX;
}

export function categoryLabel(category: string | undefined | null): string {
  if (!category) return "Uncategorized";
  return (
    CATEGORY_STYLES[category as TemplateCategory]?.label ?? "Uncategorized"
  );
}

export function categoryEmoji(category: string | undefined | null): string {
  if (!category) return "📦";
  return CATEGORY_STYLES[category as TemplateCategory]?.emoji ?? "📦";
}

/** Convert a "#rrggbb" hex into the 0xrrggbb integer Phaser expects. */
export function categoryNumber(category: string | undefined | null): number {
  const hex = categoryHex(category);
  // Strip leading "#"
  return parseInt(hex.slice(1), 16);
}
