"use client";

// LandingSectionOutline — ordered list of the current page's sections, each of
// which expands (when active) into a LAYERS list of the elements inside it.
// Sections: add / remove / duplicate / select / drag-reorder.
// Elements:  select / layer up-down / duplicate / delete.

import { useState } from "react";
import { toast } from "sonner";
import {
  useLandingEditorStore,
  selectCurrentDrawnPage,
} from "@/stores/landingEditorStore";
import { saveSectionTemplate } from "@/lib/landingEditorData";
import { SectionTemplatePicker } from "./SectionTemplatePicker";
import { getBlockDef } from "@/components/landing/blocks/registry";
import type { DrawnAsset, DrawnSection } from "@/data/landingTypes";
import { sectionHiddenReason, scheduleState } from "@/data/sectionVisibility";
import { useMinuteClock } from "@/lib/useMinuteClock";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  CalendarClock,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Gamepad2,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Unlock,
  Monitor,
  PenTool,
  Plus,
  Smartphone,
  Square,
  Trash2,
  Type as TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { isPlaceholderSrc } from "@/data/landingPlaceholders";
import { ARCADE_MACHINE_IID, resolveArcade } from "@/data/arcadeConfig";
import { sectionLabel } from "@/data/sectionTitles";
import { useTouchMode } from "@/lib/touchMode";
import { isAssetLocked, isMachineLocked } from "@/lib/layerLock";
import { toggleAssetLockWithFeedback, toggleMachineLockWithFeedback } from "@/lib/landingEditorActions";
import { OverflowMenu } from "@/components/ui/overflow-menu";

// Touch (iPad): the hover-only icon rows become a tap-to-open "⋯" menu.
const ROW_MENU_TRIGGER =
  "grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background/70";

function assetLabel(asset: DrawnAsset): string {
  if (asset.source.kind === "text") {
    const t = asset.source.text.en || asset.source.text.ar || "Text";
    return t.length > 22 ? `${t.slice(0, 22)}…` : t;
  }
  if (asset.source.kind === "component") {
    // Name it after the component so the layers list reads "Carousel", not
    // "Image" — components sit in the same list as every other element.
    return (
      asset.label ??
      getBlockDef(asset.source.block.type)?.label ??
      asset.source.block.type
    );
  }
  if (asset.label) return asset.label;
  const type = asset.source.kind === "drawn" ? "Drawing" : "Image";
  const role =
    asset.role.kind === "decoration"
      ? ""
      : asset.role.kind === "link"
        ? "Link · "
        : "Button · ";
  return `${role}${type}`;
}

export function LandingSectionOutline() {
  const page = useLandingEditorStore(selectCurrentDrawnPage);
  const selectedSectionIid = useLandingEditorStore((s) => s.selectedSectionIid);
  const selectedAssetIid = useLandingEditorStore((s) => s.selectedAssetIid);
  const selectSection = useLandingEditorStore((s) => s.selectSection);
  const selectAsset = useLandingEditorStore((s) => s.selectAsset);
  const addSection = useLandingEditorStore((s) => s.addSection);
  const removeSection = useLandingEditorStore((s) => s.removeSection);
  const duplicateSection = useLandingEditorStore((s) => s.duplicateSection);
  const reorderSections = useLandingEditorStore((s) => s.reorderSections);
  const moveAssetLayer = useLandingEditorStore((s) => s.moveAssetLayer);
  const moveArcadeLayer = useLandingEditorStore((s) => s.moveArcadeLayer);
  const duplicateAsset = useLandingEditorStore((s) => s.duplicateAsset);
  const removeAsset = useLandingEditorStore((s) => s.removeAsset);
  const deviceMode = useLandingEditorStore((s) => s.deviceMode);
  const now = useMinuteClock();
  const touch = useTouchMode();

  const [dragIid, setDragIid] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingTemplateIid, setSavingTemplateIid] = useState<string | null>(null);
  // Sections whose layers are expanded by hand (the active one always is).
  const [openIids, setOpenIids] = useState<Set<string>>(new Set());
  const toggleOpen = (iid: string) =>
    setOpenIids((prev) => {
      const next = new Set(prev);
      if (next.has(iid)) next.delete(iid);
      else next.add(iid);
      return next;
    });
  const updateSectionMeta = useLandingEditorStore((s) => s.updateSectionMeta);

  const saveAsTemplate = async (section: DrawnSection) => {
    setSavingTemplateIid(section.iid);
    const res = await saveSectionTemplate(
      sectionLabel(section, "en"),
      section.name?.ar || undefined,
      [],
      section
    );
    setSavingTemplateIid(null);
    if (!res.ok) {
      toast.error("Couldn't save template", { description: res.error });
      return;
    }
    toast.success("Saved as template — find it under “My templates” next time you add a section.");
  };

  if (!page) {
    return (
      <div className="w-56 border-r border-border bg-background p-3 text-sm text-muted-foreground">
        No page loaded.
      </div>
    );
  }

  // Touch has no reliable HTML drag-and-drop: the ⋯ menu moves a section.
  const moveSection = (iid: string, delta: -1 | 1) => {
    const ids = page.sections.map((s) => s.iid);
    const from = ids.indexOf(iid);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, iid);
    reorderSections(ids);
  };

  const onDrop = (targetIid: string) => {
    if (!dragIid || dragIid === targetIid) return;
    const ids = page.sections.map((s) => s.iid);
    const from = ids.indexOf(dragIid);
    const to = ids.indexOf(targetIid);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragIid);
    reorderSections(ids);
    setDragIid(null);
  };

  return (
    <div className="flex w-60 touch:w-72 shrink-0 flex-col border-r border-border bg-background text-foreground">
      <div className="flex h-10 items-center justify-between border-b border-border ps-3 pe-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</span>
        <button
          onClick={() => setPickerOpen(true)}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Add section"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>

      <SectionTemplatePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(section) => addSection(section)}
      />

      <ul className="flex-1 overflow-auto p-1.5">
        {page.sections.map((section, i) => {
          const active = section.iid === selectedSectionIid;
          const holdsSelection =
            selectedAssetIid !== null &&
            (section.assets.some((a) => a.iid === selectedAssetIid) ||
              (Boolean(section.containsGame) && selectedAssetIid === ARCADE_MACHINE_IID));
          const expanded = active || holdsSelection || openIids.has(section.iid);
          const label = sectionLabel(section) || `Section ${i + 1}`;
          // Elements shown front-to-back (highest z first) so top of the list
          // reads as "on top", matching the layer buttons.
          const layered = [...section.assets].sort((a, b) => b.zIndex - a.zIndex);
          // The arcade's machine is a layer too (one shared stack): at equal
          // z it paints first, so it lists BELOW same-z elements.
          const machineZ = section.containsGame ? resolveArcade(section.arcade).machine.zIndex : null;
          const machineAt =
            machineZ === null ? -1 : layered.filter((a) => a.zIndex >= machineZ).length;
          const machineSel = selectedAssetIid === ARCADE_MACHINE_IID;
          const machineLocked = section.containsGame ? isMachineLocked(section.arcade) : false;
          const machineRow =
            machineZ === null ? null : (
              <li
                key="arcade-machine"
                className={`group flex h-7 touch:h-11 items-center gap-1.5 rounded-md ps-1.5 pe-0.5 ${
                  machineSel ? "bg-amber-500/20 text-foreground" : "text-foreground/85 hover:bg-accent/50"
                }`}
              >
                <Gamepad2 className="size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                <button
                  onClick={() => {
                    selectSection(section.iid);
                    selectAsset(ARCADE_MACHINE_IID);
                  }}
                  className="min-w-0 flex-1 truncate text-start text-xs"
                  title="The arcade machine (with the live game)"
                >
                  Machine (game)
                </button>
                {(touch || machineLocked) && (
                  <RowLock
                    locked={machineLocked}
                    name="the machine"
                    onToggle={() => toggleMachineLockWithFeedback(section.iid)}
                  />
                )}
                {touch ? (
                  <OverflowMenu
                    label="Machine actions"
                    triggerClassName={ROW_MENU_TRIGGER}
                    items={[
                      {
                        label: machineLocked ? "Unlock" : "Lock in place",
                        icon: machineLocked ? Unlock : Lock,
                        onSelect: () => toggleMachineLockWithFeedback(section.iid),
                      },
                      { label: "Bring forward", icon: ArrowUp, onSelect: () => moveArcadeLayer(section.iid, ARCADE_MACHINE_IID, "up") },
                      { label: "Send backward", icon: ArrowDown, onSelect: () => moveArcadeLayer(section.iid, ARCADE_MACHINE_IID, "down") },
                    ]}
                  />
                ) : (
                  <span className="hidden items-center group-hover:flex">
                    {!machineLocked && (
                      <RowAction title="Lock in place" onClick={() => toggleMachineLockWithFeedback(section.iid)}>
                        <Unlock />
                      </RowAction>
                    )}
                    <RowAction title="Bring forward" onClick={() => moveArcadeLayer(section.iid, ARCADE_MACHINE_IID, "up")}>
                      <ArrowUp />
                    </RowAction>
                    <RowAction title="Send backward" onClick={() => moveArcadeLayer(section.iid, ARCADE_MACHINE_IID, "down")}>
                      <ArrowDown />
                    </RowAction>
                  </span>
                )}
              </li>
            );
          // Dim rows visitors won't currently see (hidden, out of schedule, or
          // hidden on the previewed device) — still fully editable.
          const hiddenReason = sectionHiddenReason(section, now, deviceMode);
          const scheduled = scheduleState(section, now) !== "none";
          return (
            <li key={section.iid} className="mb-0.5">
              <div
                draggable
                onDragStart={() => setDragIid(section.iid)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(section.iid)}
                className={`group flex h-9 touch:h-12 items-center gap-1.5 rounded-md ps-1 pe-1 ${
                  active ? "bg-accent" : "hover:bg-accent/50"
                } ${dragIid === section.iid ? "opacity-50" : ""}`}
                title={hiddenReason ?? undefined}
              >
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50 touch:hidden" aria-label="Drag to reorder" />
                <button
                  onClick={() => toggleOpen(section.iid)}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background/60"
                  aria-label={expanded ? "Collapse layers" : "Expand layers"}
                >
                  <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
                </button>
                <SurfaceSwatch section={section} />
                <button
                  onClick={() => selectSection(section.iid)}
                  className={`min-w-0 flex-1 truncate text-start text-[13px] ${
                    hiddenReason ? "text-muted-foreground line-through decoration-muted-foreground" : ""
                  }`}
                  title={hiddenReason ? `${label} — ${hiddenReason}` : label}
                >
                  {label}
                </button>
                <span className="flex shrink-0 items-center gap-0.5 group-hover:hidden">
                  {scheduled && (
                    <span title="Shown only within a date window">
                      <CalendarClock className={`size-3 ${hiddenReason && !section.hidden ? "text-amber-400" : "text-muted-foreground"}`} aria-hidden="true" />
                    </span>
                  )}
                  {section.hiddenOn?.mobile && (
                    <span title="Hidden on mobile"><Smartphone className="size-3 text-muted-foreground opacity-70" aria-hidden="true" /></span>
                  )}
                  {section.hiddenOn?.desktop && (
                    <span title="Hidden on desktop"><Monitor className="size-3 text-muted-foreground opacity-70" aria-hidden="true" /></span>
                  )}
                  {section.hidden && (
                    <span title="Hidden from the live site"><EyeOff className="size-3 text-amber-400" aria-hidden="true" /></span>
                  )}
                </span>
                {touch && (
                  <OverflowMenu
                    label={`Actions for ${label}`}
                    triggerClassName={ROW_MENU_TRIGGER}
                    items={[
                      {
                        label: section.hidden ? "Show on the live site" : "Hide from the live site",
                        icon: section.hidden ? Eye : EyeOff,
                        onSelect: () => updateSectionMeta(section.iid, { hidden: !section.hidden }),
                      },
                      { label: "Move up", icon: ArrowUp, disabled: i === 0, onSelect: () => moveSection(section.iid, -1) },
                      { label: "Move down", icon: ArrowDown, disabled: i === page.sections.length - 1, onSelect: () => moveSection(section.iid, 1) },
                      { label: "Duplicate section", icon: Copy, onSelect: () => duplicateSection(section.iid) },
                      {
                        label: "Save as a reusable template",
                        icon: BookmarkPlus,
                        disabled: savingTemplateIid === section.iid,
                        onSelect: () => void saveAsTemplate(section),
                      },
                      { kind: "separator" },
                      { label: "Delete section", icon: Trash2, danger: true, onSelect: () => removeSection(section.iid) },
                    ]}
                  />
                )}
                <span className={`hidden shrink-0 items-center ${touch ? "" : "group-hover:flex"}`}>
                  <RowAction
                    title={section.hidden ? "Show on the live site" : "Hide from the live site"}
                    onClick={() => updateSectionMeta(section.iid, { hidden: !section.hidden })}
                  >
                    {section.hidden ? <Eye /> : <EyeOff />}
                  </RowAction>
                  <RowAction title="Duplicate section" onClick={() => duplicateSection(section.iid)}>
                    <Copy />
                  </RowAction>
                  <RowAction
                    title="Save as a reusable template"
                    onClick={() => saveAsTemplate(section)}
                    disabled={savingTemplateIid === section.iid}
                  >
                    <BookmarkPlus />
                  </RowAction>
                  <RowAction title="Delete section" danger onClick={() => removeSection(section.iid)}>
                    <Trash2 />
                  </RowAction>
                </span>
              </div>

              {/* Layers — every element in the section: drawings, text,
                  images and components, in one list. */}
              {expanded && (
                <ul className="mb-1 ms-[1.625rem] border-s border-border ps-1">
                  {layered.length === 0 && machineZ === null && (
                    <li className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
                      Empty. Add elements from the bar above the canvas.
                    </li>
                  )}
                  {layered.flatMap((asset, idx) => {
                    const row = renderAssetRow(asset);
                    return idx === machineAt - 1 ? [row, machineRow] : idx === 0 && machineAt === 0 ? [machineRow, row] : [row];
                  })}
                  {layered.length === 0 && machineAt === 0 && machineRow}
                </ul>
              )}
            </li>
          );

          function renderAssetRow(asset: DrawnAsset) {
                    const sel = asset.iid === selectedAssetIid;
                    const Icon = assetIcon(asset);
                    const locked = isAssetLocked(asset, section);
                    return (
                      <li
                        key={asset.iid}
                        className={`group flex h-7 touch:h-11 items-center gap-1.5 rounded-md ps-1.5 pe-0.5 ${
                          sel ? "bg-sky-500/20 text-foreground" : "text-foreground/85 hover:bg-accent/50"
                        }`}
                      >
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <button
                          onClick={() => {
                            selectSection(section.iid);
                            selectAsset(asset.iid);
                          }}
                          className="min-w-0 flex-1 truncate text-start text-xs"
                          title={assetLabel(asset)}
                        >
                          {assetLabel(asset)}
                        </button>
                        {asset.mobile?.free && (
                          <span title="Free on phones (not stacked)" className="group-hover:hidden">
                            <Smartphone className="size-3 text-sky-400" aria-hidden="true" />
                          </span>
                        )}
                        {(touch || locked) && (
                          <RowLock
                            locked={locked}
                            name={assetLabel(asset)}
                            onToggle={() => toggleAssetLockWithFeedback(asset.iid)}
                          />
                        )}
                        {touch && (
                          <OverflowMenu
                            label={`Actions for ${assetLabel(asset)}`}
                            triggerClassName={ROW_MENU_TRIGGER}
                            items={[
                              {
                                label: locked ? "Unlock" : "Lock in place",
                                icon: locked ? Unlock : Lock,
                                onSelect: () => toggleAssetLockWithFeedback(asset.iid),
                              },
                              { label: "Bring forward", icon: ArrowUp, onSelect: () => moveAssetLayer(asset.iid, "up") },
                              { label: "Send backward", icon: ArrowDown, onSelect: () => moveAssetLayer(asset.iid, "down") },
                              { label: "Duplicate element", icon: Copy, onSelect: () => duplicateAsset(asset.iid) },
                              { kind: "separator" },
                              { label: "Delete element", icon: Trash2, danger: true, onSelect: () => removeAsset(asset.iid) },
                            ]}
                          />
                        )}
                        <span className={`hidden items-center ${touch ? "" : "group-hover:flex"}`}>
                          {!locked && (
                            <RowAction title="Lock in place" onClick={() => toggleAssetLockWithFeedback(asset.iid)}>
                              <Unlock />
                            </RowAction>
                          )}
                          <RowAction title="Bring forward" onClick={() => moveAssetLayer(asset.iid, "up")}>
                            <ArrowUp />
                          </RowAction>
                          <RowAction title="Send backward" onClick={() => moveAssetLayer(asset.iid, "down")}>
                            <ArrowDown />
                          </RowAction>
                          <RowAction title="Duplicate element" onClick={() => duplicateAsset(asset.iid)}>
                            <Copy />
                          </RowAction>
                          <RowAction title="Delete element" danger onClick={() => removeAsset(asset.iid)}>
                            <Trash2 />
                          </RowAction>
                        </span>
                      </li>
                    );
          }
        })}
        <li className="mt-1.5">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          >
            <Plus className="size-3.5" /> Add section
          </button>
        </li>
      </ul>
    </div>
  );
}

/** The padlock on a layers row: closed + always visible while locked; on touch
 *  it is always there too (no hover), with a 44 px hit area. */
function RowLock({ locked, name, onToggle }: { locked: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={locked}
      aria-label={locked ? `Unlock ${name}` : `Lock ${name} in place`}
      title={locked ? "Locked: click to unlock" : "Lock in place"}
      className={`grid size-6 shrink-0 place-items-center rounded hover:bg-background/70 touch:size-11 [&_svg]:size-3.5 ${
        locked ? "text-sky-400" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {locked ? <Lock /> : <Unlock />}
    </button>
  );
}

function RowAction({
  title,
  onClick,
  danger,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`grid size-6 place-items-center rounded text-muted-foreground hover:bg-background/70 disabled:opacity-40 [&_svg]:size-3.5 ${
        danger ? "hover:text-red-400" : "hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** A tiny chip in the section's surface colour: paper tone or dark digital. */
function SurfaceSwatch({ section }: { section: DrawnSection }) {
  const kind = section.surface?.kind ?? "paper";
  const bg =
    kind === "digital"
      ? "#14181A"
      : kind === "paper"
        ? section.surface && "color" in section.surface && section.surface.color
          ? section.surface.color
          : "var(--paper-1, #f3efe6)"
        : "#ffffff";
  return (
    <span
      className="size-3.5 shrink-0 rounded-[3px] ring-1 ring-white/15"
      style={{ background: bg }}
      title={`Surface: ${kind}`}
      aria-hidden="true"
    />
  );
}

function assetIcon(asset: DrawnAsset): LucideIcon {
  if (asset.source.kind === "text") return TypeIcon;
  if (asset.source.kind === "component") return getBlockDef(asset.source.block.type)?.icon ?? Square;
  if (asset.source.kind === "drawn") return PenTool;
  if (asset.source.kind === "upload" && isPlaceholderSrc(asset.source.url)) return Square;
  return ImageIcon;
}
