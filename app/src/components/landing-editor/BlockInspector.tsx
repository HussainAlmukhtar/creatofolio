"use client";

// BlockInspector — the settings panel for a component block. It is GENERATED
// from the block's `fields` (see the registry): no block hand-builds its own
// form. Field rendering itself (FieldControl/ArrayField) lives in
// FormFields.tsx, shared with SiteSettingsPanel — both are just a flat object
// addressed by FieldDescriptor.key.

import { getBlockDef } from "@/components/landing/blocks/registry";
import { fieldVisible, type ContentBlock } from "@/data/landingTypes";
import { useContext } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Trash2 } from "lucide-react";
import { FieldControl, ArrayField, InspectorContext } from "./FormFields";
import { FontPairField } from "./FontPicker";

export function BlockInspector({
  block,
  onChange,
  onDelete,
  onDuplicate,
  showHeader = true,
}: {
  /** The side panel shows its own title bar; flow-section use keeps this. */
  showHeader?: boolean;
  block: ContentBlock;
  onChange: (partial: Record<string, unknown>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const def = getBlockDef(block.type);
  const env = useContext(InspectorContext);
  if (!def) {
    return <p className="text-sm text-muted-foreground">Unknown block “{block.type}”.</p>;
  }
  return (
    <div className="space-y-3.5">
      {showHeader && (
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{def.label}</h3>
        <div className="flex gap-1">
          <Button size="icon-sm" variant="ghost" onClick={onDuplicate} title="Duplicate" type="button">
            <Copy />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onDelete} title="Delete" className="text-destructive" type="button">
            <Trash2 />
          </Button>
        </div>
      </div>
      )}

      {def.fields
        // Pop-ups use the theme's fonts, so per-block font picks are hidden there.
        .filter(
          (f) =>
            fieldVisible(f, block.props, def.fields) &&
            (!f.surface || f.surface === env.surface) &&
            !(env.surface === "popup" && f.kind === "font")
        )
        .map((f, fi) =>
        f.kind === "array" ? (
          <ArrayField
            key={f.key}
            field={f}
            items={(block.props[f.key] as Record<string, unknown>[]) ?? []}
            onChange={(items) => onChange({ [f.key]: items })}
          />
        ) : f.kind === "font" ? (
          <FontPairField
            key={f.key}
            label={f.label}
            latin={block.props[f.key] as string | undefined}
            arabic={block.props[`${f.key}Ar`] as string | undefined}
            defaultLabel="Site font"
            onChange={(latin, arabic) => onChange({ [f.key]: latin, [`${f.key}Ar`]: arabic })}
          />
        ) : f.kind === "heading" || f.kind === "note" ? (
          <FieldControl key={f.label} field={f} value={undefined} onChange={() => {}} />
        ) : (
          <FieldControl
            // Two fields may share a key under different `when`s.
            key={`${f.key}:${fi}`}
            field={f}
            value={block.props[f.key]}
            onChange={(v) => onChange({ [f.key]: v })}
            onPatch={(partial) => onChange(partial)}
            siblings={block.props}
          />
        )
      )}
    </div>
  );
}
