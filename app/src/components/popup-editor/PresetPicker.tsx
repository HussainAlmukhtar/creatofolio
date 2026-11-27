"use client";

// Presets in the pop-up composer:
//   - PresetGrid: the built-in presets + "Your presets" (saved with "Save as
//     preset", migration 20261008000002_popup_presets; ⋯ → Delete asks first). Shown in an empty
//     pop-up's outline and in the "Start from a preset" dialog.
//   - PresetsSection: Pop-up settings → "Save as preset…" (hidden until
//     migration 20261008000002_popup_presets is applied) and "Start from a preset…".
// Applying a preset replaces the pop-up's blocks (one undo step).

import { useCallback, useEffect, useState } from "react";
import { BookmarkPlus, LayoutTemplate, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { useDialog } from "@/components/editor/useDialog";
import { usePopupComposerStore } from "@/stores/popupComposerStore";
import { deletePopupPreset, listPopupPresets, savePopupPreset, type PresetBody, type SavedPreset } from "@/lib/popupPresets";
import { BUILT_IN_PRESETS } from "./popupPresets";
import { allBlocks } from "@/data/popupTree";

function useSavedPresets() {
  const [state, setState] = useState<{ items: SavedPreset[]; missing: boolean; loaded: boolean }>({
    items: [],
    missing: false,
    loaded: false,
  });
  const reload = useCallback(async () => {
    const r = await listPopupPresets();
    setState({ items: r.items, missing: r.missing, loaded: true });
  }, []);
  useEffect(() => {
    let alive = true;
    void listPopupPresets().then((r) => alive && setState({ items: r.items, missing: r.missing, loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  return { ...state, reload };
}

const CARD =
  "flex min-h-[3.75rem] w-full flex-col items-start gap-0.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-2 text-start hover:border-neutral-500 hover:bg-neutral-800";

export function PresetGrid({ onPick, compact }: { onPick: (body: PresetBody, name: string) => void; compact?: boolean }) {
  const saved = useSavedPresets();
  const { confirm, dialog } = useDialog();
  const remove = async (p: SavedPreset) => {
    if (!(await confirm(`Delete the preset “${p.name}”? Pop-ups made from it stay as they are.`, { danger: true }))) return;
    const res = await deletePopupPreset(p.iid);
    if (res.ok) {
      toast.success("Preset deleted");
      void saved.reload();
    } else toast.error("Couldn't delete it", { description: res.error });
  };
  return (
    <div className="space-y-3">
      <div className={`grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        {BUILT_IN_PRESETS.map((p) => (
          <button key={p.id} type="button" className={CARD} onClick={() => onPick(p.build(), p.name)} title={p.hint}>
            <span className="text-sm font-medium text-neutral-100">{p.name}</span>
            {!compact && <span className="text-[11px] leading-snug text-neutral-400">{p.hint}</span>}
          </button>
        ))}
      </div>
      {saved.items.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Your presets</p>
          <ul className={`grid gap-1.5 ${compact ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
            {saved.items.map((p) => (
              <li key={p.iid} className="flex items-stretch gap-1">
                <button type="button" className={CARD} onClick={() => onPick(p.body, p.name)}>
                  <span className="text-sm font-medium text-neutral-100">{p.name}</span>
                  <span className="text-[11px] text-neutral-400">
                    {p.body.layout === "pages" ? `${p.body.pages?.length ?? 0} pages` : `${p.body.blocks?.length ?? 0} blocks`}
                  </span>
                </button>
                <OverflowMenu
                  label={`${p.name} actions`}
                  triggerClassName="grid w-8 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                  items={[{ label: "Delete preset…", icon: Trash2, danger: true, onSelect: () => void remove(p) }]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog}
    </div>
  );
}

/** Pop-up settings → Presets. */
export function PresetsSection() {
  const content = usePopupComposerStore((s) => s.content);
  const applyPreset = usePopupComposerStore((s) => s.applyPreset);
  const saved = useSavedPresets();
  const { prompt, confirm, dialog } = useDialog();
  const [picking, setPicking] = useState(false);
  if (!content) return null;
  const hasBlocks = allBlocks(content).length > 0;

  const save = async () => {
    const name = await prompt("Name the preset:", content.title || "My preset");
    if (name === null) return;
    const res = await savePopupPreset(name, content);
    if (res.ok) {
      toast.success("Saved as a preset", { description: "It's offered when you start a new pop-up." });
      void saved.reload();
    } else toast.error("Couldn't save the preset", { description: res.error });
  };

  const pick = async (body: PresetBody, name: string) => {
    if (hasBlocks && !(await confirm(`Replace this pop-up's blocks with “${name}”? You can undo it.`))) return;
    applyPreset(body);
    setPicking(false);
    toast(`Started from “${name}”`, {
      action: { label: "Undo", onClick: () => usePopupComposerStore.temporal.getState().undo() },
    });
  };

  return (
    <div className="space-y-2 border-t border-neutral-800 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Presets</h4>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          <LayoutTemplate className="size-3.5" aria-hidden="true" /> Start from a preset…
        </button>
        {saved.loaded && !saved.missing && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!hasBlocks}
            className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
          >
            <BookmarkPlus className="size-3.5" aria-hidden="true" /> Save as preset…
          </button>
        )}
      </div>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-3xl overflow-y-auto border-neutral-700 bg-neutral-900 text-neutral-100 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-neutral-100">Start from a preset</DialogTitle>
            <DialogDescription className="text-neutral-400">
              Replaces this pop-up&apos;s blocks (the title stays if it has one). You can undo it.
            </DialogDescription>
          </DialogHeader>
          <PresetGrid onPick={(b, n) => void pick(b, n)} />
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
