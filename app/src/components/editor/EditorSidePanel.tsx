"use client";

import { useState, useRef, useEffect, useMemo, type CSSProperties } from "react";
import { AssetWeight } from "@/components/admin/AssetWeight";
import { collectAssetUrls } from "@/lib/assetWeight";
import {
  Crosshair,
  GripVertical,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Lock as LockIcon,
  LockOpen,
} from "lucide-react";
import { HexColorPicker } from "react-colorful";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTouchMode } from "@/lib/touchMode";
import { useEditorStore } from "@/stores/editorStore";
import { isRoomObjectLocked } from "@/lib/layerLock";
import { toggleObjectsLockWithFeedback } from "@/lib/editorActions";
import type {
  RoomId,
  RoomObject,
  RoomConfig,
  BgLayer,
  BgCrop,
  ForegroundEffect,
  HoverEffect,
  EasterEgg,
  EasterEggReaction,
} from "@/data/roomTypes";
import {
  uploadRoomBackgroundOriginal,
  uploadRoomBackgroundCrop,
  getOriginalSignedUrl,
} from "@/lib/editorData";
import BackgroundCropModal from "./BackgroundCropModal";
import { SaveAsTemplateModal } from "./SaveAsTemplateModal";
import { Tooltip, InfoTip } from "@/components/editor/EditorTooltip";
import { toast } from "sonner";
import {
  deleteObjectWithUndo,
  deleteObjectsWithUndo,
  deleteEntryPointWithFeedback,
} from "@/lib/editorActions";
import { announce } from "@/lib/a11yAnnounce";
import { STARTER_ELEMENTS, defaultArtFor } from "@/data/starterElements";
import { InteractionsSection, kindChangePatch } from "./interactions/InteractionsSection";
import { PopupNavSection } from "./interactions/PopupNavSection";
import { RoomNameTagSection } from "./RoomNameTagSection";

// ─── Background Layer Plumbing ────────────────────────────────
//
// Three art layers compose around the gameplay layer (player + objects).
// The schema field names stay internal; the UI uses RPG-Maker-style labels
// that tell the user where the layer sits relative to the player.

const LAYER_FIELDS: Record<
  BgLayer,
  {
    url: keyof RoomConfig;
    origPath: keyof RoomConfig;
    crop: keyof RoomConfig;
    label: string;
    hint: string;
  }
> = {
  back: {
    url: "bgBackUrl",
    origPath: "bgBackOriginalPath",
    crop: "bgBackCrop",
    label: "Behind everything",
    hint: "Sky, sea, distant scenery",
  },
  middle: {
    url: "bgMiddleUrl",
    origPath: "bgMiddleOriginalPath",
    crop: "bgMiddleCrop",
    label: "The room",
    hint: "Walls, floor, fixtures",
  },
  front: {
    url: "bgFrontUrl",
    origPath: "bgFrontOriginalPath",
    crop: "bgFrontCrop",
    label: "Above player",
    hint: "CCTV frame, vignette, hanging plants",
  },
};

const LAYER_ORDER: ReadonlyArray<BgLayer> = ["back", "middle", "front"];

const FOREGROUND_EFFECTS: ReadonlyArray<{
  value: NonNullable<ForegroundEffect> | "";
  label: string;
}> = [
  { value: "", label: "None" },
  { value: "rain", label: "Rain" },
  { value: "snow", label: "Snow" },
  { value: "cctv", label: "CCTV (tinted scanlines)" },
];

// ROOM_IDS was a hardcoded list of the original 8 rooms. It was removed:
// the door target dropdown now reads from the live `allRooms`
// store slice so newly created rooms appear immediately without a code change.

const HOVER_OPTIONS: ReadonlyArray<{ value: HoverEffect; label: string }> = [
  { value: "auto", label: "Auto — lift if clickable" },
  { value: "none", label: "None" },
  { value: "lift", label: "Lift" },
  { value: "grow", label: "Grow" },
  { value: "glow", label: "Glow" },
  { value: "wiggle", label: "Wiggle" },
  { value: "pulse", label: "Pulse" },
];

const REACTION_OPTIONS: ReadonlyArray<{ value: EasterEggReaction; label: string }> = [
  { value: "sparkle", label: "Sparkles" },
  { value: "confetti", label: "Confetti" },
  { value: "spin", label: "Spin" },
  { value: "jump", label: "Jump" },
  { value: "wiggle", label: "Wiggle" },
  { value: "shake", label: "Shake" },
];

// ─── Shared Input Components ──────────────────────────────────

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-neutral-400 text-xs">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  readOnly,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Layer lock: shown, not editable. */
  readOnly?: boolean;
}) {
  // Keep a text draft so clearing the field or typing "-" doesn't snap the
  // value to 0 mid-edit. Valid numbers commit live; Enter/blur settle it,
  // Escape reverts. ↑/↓ step (Shift = ×10).
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const [lastValue, setLastValue] = useState(value);
  if (!focused && value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  const clamp = (n: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) {
      const c = clamp(n);
      setLastValue(c);
      if (c !== value) onChange(c);
    }
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      readOnly={readOnly}
      aria-readonly={readOnly || undefined}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        if (readOnly) return;
        setDraft(e.target.value);
        commit(e.target.value);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseFloat(draft);
        const c = Number.isFinite(n) ? clamp(n) : value;
        setDraft(String(c));
        if (c !== value) onChange(c);
      }}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setDraft(String(value));
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = Number.isFinite(parseFloat(draft)) ? parseFloat(draft) : value;
          const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          const c = clamp(Math.round((base + delta) * 1000) / 1000);
          setDraft(String(c));
          setLastValue(c);
          onChange(c);
        }
      }}
      role="spinbutton"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      className={`bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full tabular-nums ${
        readOnly ? "opacity-60" : ""
      }`}
    />
  );
}

function TextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
    />
  );
}

/**
 * Slug field that commits on Enter / blur instead of on every keystroke.
 * Renaming an id per keystroke used to orphan the selection (the panel
 * vanished after the first letter) and leave half-typed ids behind.
 */
function SlugInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => { ok: boolean; error?: string };
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // External change (undo, selection switch) — resync the draft.
    setLastValue(value);
    setDraft(value);
    setError(null);
  }
  const commit = () => {
    if (draft === value) {
      setError(null);
      return;
    }
    const res = onCommit(draft);
    if (res.ok) setError(null);
    else setError(res.error ?? "Invalid id");
  };
  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setError(null);
          }
        }}
        className={`bg-neutral-700 text-white rounded px-2 py-1 text-xs border w-full font-mono ${
          error ? "border-red-500" : "border-neutral-600"
        }`}
      />
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        swatchRef.current &&
        !swatchRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  const normalized = value.startsWith("#") ? value : `#${value}`;

  return (
    <div className="relative flex gap-1 items-center">
      <button
        ref={swatchRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-8 h-8 rounded border border-neutral-600 cursor-pointer flex-shrink-0"
        style={{ backgroundColor: normalized }}
        aria-label="Open color picker"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 flex-1 font-mono"
      />
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-2 z-50 p-2 bg-neutral-800 border border-neutral-600 rounded shadow-xl"
        >
          <HexColorPicker
            color={normalized}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
}

// ─── Room Properties Panel ────────────────────────────────────

function RoomPropertiesPanel() {
  const { currentRoomConfig, updateRoom } = useEditorStore();
  const contentMap = useEditorStore((s) => s.contentMap);
  // Per-layer upload spinner — keyed by layer so back/middle/front uploads
  // don't fight over a single shared boolean.
  const [uploadingLayer, setUploadingLayer] = useState<BgLayer | null>(null);
  // Crop modal targets one layer at a time. `cropLayer` doubles as the
  // open-state flag — null means closed.
  const [cropLayer, setCropLayer] = useState<BgLayer | null>(null);
  const [originalSignedUrl, setOriginalSignedUrl] = useState<string | null>(null);
  const fileInputRefs = {
    back: useRef<HTMLInputElement>(null),
    middle: useRef<HTMLInputElement>(null),
    front: useRef<HTMLInputElement>(null),
  } as const;

  const weightUrls = useMemo(() => {
    if (!currentRoomConfig) return [];
    const prefix = `${currentRoomConfig.id}:`;
    const popups = Object.entries(contentMap)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
    return collectAssetUrls(currentRoomConfig, popups);
  }, [currentRoomConfig, contentMap]);

  if (!currentRoomConfig) return null;

  const config = currentRoomConfig;

  const getLayerUrl = (layer: BgLayer) =>
    config[LAYER_FIELDS[layer].url] as string | undefined;
  const getLayerOrigPath = (layer: BgLayer) =>
    config[LAYER_FIELDS[layer].origPath] as string | undefined;
  const getLayerCrop = (layer: BgLayer) =>
    config[LAYER_FIELDS[layer].crop] as BgCrop | undefined;

  const handleBgUpload = async (
    layer: BgLayer,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLayer(layer);
    try {
      const path = await uploadRoomBackgroundOriginal(file, config.id, layer);
      if (!path) {
        toast.error("Background upload failed", {
          description: "Check you're signed in and the storage bucket is reachable.",
        });
        return;
      }
      updateRoom({ [LAYER_FIELDS[layer].origPath]: path } as Partial<RoomConfig>);
      const signedUrl = await getOriginalSignedUrl(path);
      if (signedUrl) {
        setOriginalSignedUrl(signedUrl);
        setCropLayer(layer);
      } else {
        toast.error("Uploaded, but couldn't open the cropper", {
          description: "Try the Crop button again in a moment.",
        });
      }
    } finally {
      setUploadingLayer(null);
      e.target.value = "";
    }
  };

  const handleOpenCrop = async (layer: BgLayer) => {
    const origPath = getLayerOrigPath(layer);
    if (!origPath) return;
    const signedUrl = await getOriginalSignedUrl(origPath);
    if (signedUrl) {
      setOriginalSignedUrl(signedUrl);
      setCropLayer(layer);
    } else {
      toast.error("Couldn't load the original image for cropping.");
    }
  };

  const handleCropApply = async (
    layer: BgLayer,
    blob: Blob,
    cropRegion: BgCrop
  ) => {
    const url = await uploadRoomBackgroundCrop(blob, config.id, layer);
    if (url) {
      updateRoom({
        [LAYER_FIELDS[layer].url]: url,
        [LAYER_FIELDS[layer].crop]: cropRegion,
      } as Partial<RoomConfig>);
    } else {
      toast.error("Couldn't save the cropped background.");
    }
    setCropLayer(null);
    setOriginalSignedUrl(null);
  };

  const handleRemoveBg = (layer: BgLayer) => {
    updateRoom({
      [LAYER_FIELDS[layer].url]: undefined,
      [LAYER_FIELDS[layer].origPath]: undefined,
      [LAYER_FIELDS[layer].crop]: undefined,
    } as Partial<RoomConfig>);
  };

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-sm text-neutral-200">Room Properties</h3>

      <AssetWeight label="Room weight" urls={weightUrls} />

      <Field label="Room ID">
        <span className="text-neutral-400 text-xs font-mono">{config.id}</span>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Name (EN)">
          <TextInput
            value={config.name}
            onChange={(v) => updateRoom({ name: v })}
          />
        </Field>
        <Field label="Name (AR)">
          <TextInput
            value={config.nameAr}
            onChange={(v) => updateRoom({ nameAr: v })}
          />
        </Field>
      </div>

      <Field label="Description (EN)">
        <TextInput
          value={config.description}
          onChange={(v) => updateRoom({ description: v })}
        />
      </Field>
      <Field label="Description (AR)">
        <TextInput
          value={config.descriptionAr}
          onChange={(v) => updateRoom({ descriptionAr: v })}
        />
      </Field>

      {/*
        Canvas size is locked globally — every room renders at the canonical
        ROOM_WIDTH × ROOM_HEIGHT. We expose it read-only here so the user
        knows what to draw against, but editing it would just get coerced
        back on the next hydrate.
      */}
      <Field label="Canvas">
        <div className="text-xs text-neutral-400 px-2 py-1 bg-neutral-800 rounded border border-neutral-700">
          {config.width} × {config.height}{" "}
          <span className="text-neutral-500">(locked)</span>
        </div>
      </Field>

      <h4 className="font-medium text-xs text-neutral-300 mt-2">Colours</h4>
      <Field label="Background">
        <ColorInput
          value={config.backgroundColor}
          onChange={(v) => updateRoom({ backgroundColor: v })}
        />
      </Field>

      {/* Background Layers — three art layers compose around the player.
          Order matters here, but the player only sees the RPG-Maker-style
          relative-to-player labels (Behind / The room / Above player). */}
      <h4 className="font-medium text-xs text-neutral-300 mt-2">Background Layers</h4>
      {LAYER_ORDER.map((layer) => {
        const fields = LAYER_FIELDS[layer];
        const url = getLayerUrl(layer);
        const origPath = getLayerOrigPath(layer);
        const isUploading = uploadingLayer === layer;
        return (
          <div
            key={layer}
            className="rounded border border-neutral-700 bg-neutral-850/40 p-2 space-y-1.5"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-neutral-200">
                {fields.label}
              </span>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wide">
                {layer}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 leading-snug -mt-0.5">
              {fields.hint}
            </p>
            {url && (
              <div className="bg-neutral-900 rounded p-1 border border-neutral-700">
                <img
                  src={url}
                  alt={`${fields.label} layer`}
                  className="max-w-full max-h-20 mx-auto rounded"
                />
              </div>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => fileInputRefs[layer].current?.click()}
                disabled={isUploading}
                className="flex-1 py-1 rounded text-[11px] font-medium bg-indigo-700 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
              >
                {isUploading ? "Uploading..." : url ? "Replace" : "Upload"}
              </button>
              {origPath && (
                <button
                  onClick={() => handleOpenCrop(layer)}
                  className="px-2 py-1 rounded text-[11px] bg-neutral-600 text-white hover:bg-neutral-500"
                >
                  Crop
                </button>
              )}
              {url && (
                <button
                  onClick={() => handleRemoveBg(layer)}
                  className="px-2 py-1 rounded text-[11px] bg-red-800 text-white hover:bg-red-700"
                >
                  Remove
                </button>
              )}
            </div>
            <button
              onClick={() =>
                // Always pass a background target with the specific layer so
                // the studio opens that layer's per-room canvas, not the
                // shared scratchpad.
                window.dispatchEvent(
                  new CustomEvent("editor:open-draw-modal", {
                    detail: { editTarget: { kind: "background", layer } },
                  })
                )
              }
              className="w-full py-1 rounded text-[11px] font-medium bg-amber-600 text-white hover:bg-amber-500 transition-colors"
            >
              {url ? "Edit in Studio" : "Draw in Studio"}
            </button>
            <input
              ref={fileInputRefs[layer]}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => handleBgUpload(layer, e)}
            />
          </div>
        );
      })}

      {/* Foreground Effect — particle/shader overlay that sits on top of the
          front layer. Independent of the front-layer art so a CCTV frame PNG
          can coexist with rain particles, etc. */}
      <h4 className="font-medium text-xs text-neutral-300 mt-2">Foreground Effect</h4>
      <Field label="Effect">
        <select
          value={config.foregroundEffect ?? ""}
          onChange={(e) =>
            updateRoom({
              foregroundEffect: (e.target.value || null) as ForegroundEffect,
            })
          }
          className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
        >
          {FOREGROUND_EFFECTS.map((opt) => (
            <option key={opt.value || "none"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>
      {config.foregroundEffect && (
        <label className="flex items-center gap-1 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={config.foregroundEffectAboveUI ?? false}
            onChange={(e) =>
              updateRoom({ foregroundEffectAboveUI: e.target.checked })
            }
          />
          Render above HUD
          <InfoTip label="When on, the effect (rain, snow, scanlines) draws on top of menus and dialog boxes too. Default keeps the HUD readable." />
        </label>
      )}

      {/* "Step through pop-ups". */}
      <PopupNavSection room={config} updateRoom={updateRoom} />

      <RoomNameTagSection room={config} updateRoom={updateRoom} />

      {cropLayer && originalSignedUrl && (
        <BackgroundCropModal
          originalUrl={originalSignedUrl}
          roomWidth={config.width}
          roomHeight={config.height}
          existingCrop={getLayerCrop(cropLayer)}
          onApply={(blob, cropRegion) =>
            handleCropApply(cropLayer, blob, cropRegion)
          }
          onClose={() => {
            setCropLayer(null);
            setOriginalSignedUrl(null);
          }}
        />
      )}

    </div>
  );
}

// ─── Object Properties Panel ──────────────────────────────────

function ObjectPropertiesPanel() {
  const {
    currentRoomConfig,
    selectedObjectId,
    updateObject,
    duplicateObject,
    setObjectRotation,
    seedObjectHitboxFromRect,
    resetObjectHitbox,
    lockLayer,
    bringToFront,
    bringForward,
    sendBackward,
    sendToBack,
    resetLayer,
    setTool,
    activeTool,
    allRooms,
    pendingRequiredFields,
    clearPendingRequiredFields,
    pendingMoveToPickFor,
    setPendingMoveToPickFor,
    renameObject,
    resizeObject,
  } = useEditorStore();
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const touch = useTouchMode();
  // 7e: focus the label input when the user lands on a freshly-spawned
  // placeholder ("New door", "New object", "New npc"). Saves them from
  // hunting for the field — they almost always want to rename it first.
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Effect ordering rule: must run unconditionally even when the panel has
  // no selected object, so we declare it before the early returns.
  const obj = currentRoomConfig?.objects.find(
    (o) => o.id === selectedObjectId
  );
  const labelForFocus = obj?.label;
  useEffect(() => {
    if (!labelForFocus) return;
    if (!/^New (object|door|npc)$/i.test(labelForFocus)) return;
    // Defer one tick so the input is in the DOM before we try to focus it
    // (selecting an object remounts the panel contents on first render).
    const t = setTimeout(() => {
      const el = labelInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
    return () => clearTimeout(t);
    // We re-focus only when the *selected object* changes — typing in the
    // label would otherwise keep yanking selection back to the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObjectId]);

  if (!currentRoomConfig || !selectedObjectId) return null;
  if (!obj) return null;

  const locked = isRoomObjectLocked(obj);
  const toggleLock = () => toggleObjectsLockWithFeedback([selectedObjectId]);
  const update = (partial: Partial<RoomObject>) =>
    updateObject(selectedObjectId, partial);

  // Resolve the target room by iid first (stable, slug-rename-proof), falling
  // back to the legacy slug for rows that haven't been written since iids
  // landed. Same prefer-iid pattern the runtime uses.
  const targetRoom = (() => {
    if (obj.targetRoomIid) {
      const byIid = Object.values(allRooms).find(
        (r) => r?.iid === obj.targetRoomIid
      );
      if (byIid) return byIid;
    }
    return obj.targetRoomId ? allRooms[obj.targetRoomId] : null;
  })();
  const targetEntryPoints = targetRoom?.entryPoints ?? [];

  // Required-fields prompt: surfaces only when this object was just dropped
  // from a template that declared required_fields and at least one of them
  // is still empty. Auto-clears once all are filled.
  const required = pendingRequiredFields[selectedObjectId] ?? [];
  const stillMissing = required.filter((f) => {
    const value = (obj as unknown as Record<string, unknown>)[f.name];
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    ) {
      return true;
    }
    // Type-aware validation: URL fields must look like URLs. Wrong format =
    // still "missing" so the nag stays put until it's fixed.
    if (f.type === "url" && typeof value === "string") {
      try {
        new URL(value);
      } catch {
        return true;
      }
    }
    return false;
  });
  if (required.length > 0 && stillMissing.length === 0) {
    // All filled — fire-and-forget clear (next render will skip the banner).
    setTimeout(() => clearPendingRequiredFields(selectedObjectId), 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-neutral-200">
          Object Properties
        </h3>
        <div className="flex gap-1">
          <Tooltip
            label={locked ? "Unlock — it can be moved again" : "Lock in place — can't be moved by accident"}
            shortcut="Ctrl+Shift+L"
          >
            <button
              onClick={toggleLock}
              aria-label={locked ? "Unlock object" : "Lock object in place"}
              aria-pressed={locked}
              className={`px-2 py-0.5 text-xs rounded hover:bg-neutral-600 ${
                locked ? "bg-sky-800 text-sky-100" : "bg-neutral-700"
              }`}
            >
              {locked ? <LockIcon size={13} aria-hidden="true" /> : <LockOpen size={13} aria-hidden="true" />}
            </button>
          </Tooltip>
          <Tooltip label="Duplicate" shortcut="Ctrl+D">
            <button
              onClick={() => duplicateObject(selectedObjectId)}
              aria-label="Duplicate object"
              className="px-2 py-0.5 text-xs bg-neutral-700 rounded hover:bg-neutral-600"
            >
              Dup
            </button>
          </Tooltip>
          <Tooltip label="Delete" shortcut="Del">
            <button
              onClick={() => deleteObjectWithUndo(selectedObjectId)}
              aria-label="Delete object"
              className="px-2 py-0.5 text-xs bg-red-800 rounded hover:bg-red-700"
            >
              Del
            </button>
          </Tooltip>
        </div>
      </div>

      {stillMissing.length > 0 && (
        <div className="text-xs bg-amber-900/30 border border-amber-700 rounded p-2 leading-snug text-amber-200">
          <div className="font-medium text-amber-100 mb-0.5">
            Template needs:{" "}
            {stillMissing
              .map((f) => (f.type === "url" ? `${f.name} (URL)` : f.name))
              .join(", ")}
          </div>
          <div className="text-amber-300/80 text-[11px]">
            Fill the highlighted field{stillMissing.length === 1 ? "" : "s"}{" "}
            below to finish placing this template.
          </div>
        </div>
      )}

      <Field
        label={
          <span className="inline-flex items-center gap-1">
            ID
            <InfoTip label="Unique within this room. Press Enter to rename — content and drawing layers move with it." />
          </span>
        }
      >
        <SlugInput
          value={obj.id}
          onCommit={(v) => renameObject(selectedObjectId, v)}
        />
      </Field>

      <Field label="Kind">
        <select
          value={obj.type}
          onChange={(e) =>
            update(kindChangePatch(obj, e.target.value as RoomObject["type"]))
          }
          className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
        >
          <option value="object">Object</option>
          <option value="door">Door</option>
          <option value="npc">Character</option>
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Label (EN)">
          {/* Raw input (not TextInput) so we can hand it a ref for 7e's
              auto-focus on freshly-spawned placeholders. */}
          <input
            ref={labelInputRef}
            type="text"
            value={obj.label}
            onChange={(e) => update({ label: e.target.value })}
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
          />
        </Field>
        <Field label="Label (AR)">
          <TextInput
            value={obj.labelAr}
            onChange={(v) => update({ labelAr: v })}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={obj.showLabel ?? false}
            onChange={(e) => update({ showLabel: e.target.checked })}
          />
          Show label in game
        </label>
      </div>

      <h4 className="font-medium text-xs text-neutral-300 mt-1">Position & Size</h4>
      {locked && (
        <div
          role="note"
          className="flex items-center gap-2 rounded border border-sky-700/50 bg-sky-900/30 px-2 py-1.5 text-[11px] leading-snug text-sky-200"
        >
          <LockIcon size={13} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>Locked.</strong> It can&rsquo;t be moved, resized or rotated on the canvas.
          </span>
          <button
            onClick={toggleLock}
            className="rounded bg-sky-800 px-2 py-0.5 text-xs text-sky-50 hover:bg-sky-700"
          >
            Unlock
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberInput value={obj.x} readOnly={locked} onChange={(v) => update({ x: v })} />
        </Field>
        <Field label="Y">
          <NumberInput value={obj.y} readOnly={locked} onChange={(v) => update({ y: v })} />
        </Field>
        <Field label="Width">
          <NumberInput
            value={obj.width}
            readOnly={locked}
            onChange={(v) => resizeObject(selectedObjectId, v, obj.height)}
            min={10}
          />
        </Field>
        <Field label="Height">
          <NumberInput
            value={obj.height}
            readOnly={locked}
            onChange={(v) => resizeObject(selectedObjectId, obj.width, v)}
            min={10}
          />
        </Field>
      </div>
      {/* 7f: rescue path for objects whose handles landed off-screen
          (typically a huge sprite drop pre-7d or a manual width/height
          fat-finger). Caps the longest side to 40% of the narrower room
          dimension, preserving aspect, centered on the object's current
          position. Only meaningful when the current size already exceeds
          that cap. */}
      {(() => {
        const maxLong = Math.round(
          Math.min(currentRoomConfig.width, currentRoomConfig.height) * 0.4
        );
        const long = Math.max(obj.width, obj.height);
        if (long <= maxLong || locked) return null;
        return (
          <Tooltip
            label={`Rescale to ≤${maxLong}px on the longest side, keeping aspect ratio.`}
          >
            <button
              onClick={() => {
                const scale = maxLong / long;
                const newW = Math.max(16, Math.round(obj.width * scale));
                const newH = Math.max(16, Math.round(obj.height * scale));
                const cx = obj.x + obj.width / 2;
                const cy = obj.y + obj.height / 2;
                update({
                  width: newW,
                  height: newH,
                  x: Math.round(cx - newW / 2),
                  y: Math.round(cy - newH / 2),
                });
              }}
              className="w-full py-1 rounded text-xs font-medium bg-neutral-700 text-neutral-100 hover:bg-neutral-600 transition-colors"
            >
              Fit to room
            </button>
          </Tooltip>
        );
      })()}

      <Field label="Rotation (°)">
        <NumberInput
          value={obj.rotation ?? 0}
          readOnly={locked}
          onChange={(v) => setObjectRotation(selectedObjectId, v)}
          min={-360}
          max={360}
          step={5}
        />
      </Field>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={obj.isWallMounted}
            onChange={(e) => update({ isWallMounted: e.target.checked })}
          />
          Wall Mounted
        </label>
        <InfoTip label="For things on the back wall (frames, posters, sconces): when clicked, the player walks to the floor just below instead of trying to walk into the wall." />
      </div>

      <h4 className="font-medium text-xs text-neutral-300 mt-1">Hitbox</h4>
      <p className="text-[11px] text-neutral-400 -mt-1">
        Custom click + collision shape. Defaults to the bounding rect; refine below.
      </p>
      {activeTool === "edit-hitbox" && (
        <div className="rounded border border-cyan-700 bg-cyan-900/30 px-2 py-1 text-[11px] text-cyan-100">
          <strong>Hitbox edit mode</strong> — drag handles to reshape, click
          midpoints to add a vertex, {touch ? "long-press" : "right-click"} a handle to delete. {touch ? "Tap" : "Click"}{" "}
          <strong>Done</strong> to move the object again.
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {activeTool === "edit-hitbox" ? (
          <Tooltip label="Exit hitbox edit mode and return to Select">
            <button
              onClick={() => setTool("select")}
              className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-500 font-medium"
            >
              Done
            </button>
          </Tooltip>
        ) : (
          <Tooltip label="Edit custom hitbox polygon" shortcut="H">
            <button
              onClick={() => {
                seedObjectHitboxFromRect(selectedObjectId);
                setTool("edit-hitbox");
              }}
              className="px-2 py-1 text-xs bg-cyan-800 rounded hover:bg-cyan-700"
            >
              {obj.hitboxPolygon ? "Edit Hitbox" : "Add Hitbox"}
            </button>
          </Tooltip>
        )}
        {obj.hitboxPolygon && (
          <Tooltip label="Remove custom polygon, revert to rectangle">
            <button
              onClick={() => resetObjectHitbox(selectedObjectId)}
              className="px-2 py-1 text-xs bg-neutral-700 rounded hover:bg-neutral-600"
            >
              Reset
            </button>
          </Tooltip>
        )}
      </div>
      {obj.hitboxPolygon && (
        <div className="text-xs text-neutral-400">
          {obj.hitboxPolygon.length} vertices · drag handles in canvas, {touch ? "long-press" : "right-click"} to delete
        </div>
      )}

      {/* "When clicked…" / "When the player walks near…" / Hover.
          A door's target lives in its "Go through this door" step. */}
      <div className="border-t border-neutral-700 mt-2 pt-2" />
      <InteractionsSection
        obj={obj}
        update={update}
        renderDoorTarget={() => (
        <>
          <Field label="Target Room">
            <select
              value={obj.targetRoomId ?? ""}
              onChange={(e) => {
                const slug = e.target.value || undefined;
                // Dual-write: store the slug for backwards-compat AND the
                // iid (resolved from `allRooms`) so renames don't break the
                // link. Readers prefer iid; slug is the fallback.
                const iid = slug ? allRooms[slug]?.iid : undefined;
                update({
                  targetRoomId: slug as RoomId | undefined,
                  targetRoomIid: iid,
                  // Clearing the room clears the entry point too — otherwise
                  // we'd hold a stale entry-point reference into a different
                  // room.
                  targetEntryPointId: undefined,
                  targetEntryPointIid: undefined,
                });
              }}
              className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
            >
              <option value="">None</option>
              {Object.entries(allRooms)
                .sort(([, a], [, b]) =>
                  (a?.name ?? "").localeCompare(b?.name ?? "")
                )
                .map(([id, cfg]) => (
                  <option key={id} value={id}>
                    {cfg?.name ?? id}
                  </option>
                ))}
            </select>
          </Field>
          {obj.targetRoomId && targetRoom && targetEntryPoints.length === 0 && (
            <div className="text-[10px] text-amber-400 px-1 -mt-1">
              ⚠ {targetRoom.name ?? obj.targetRoomId} has no entry points —
              the player will spawn at the room&rsquo;s default position.
            </div>
          )}
          {obj.targetRoomId && !targetRoom && (
            <div className="text-[10px] text-red-400 px-1 -mt-1">
              ⚠ Unknown target room &ldquo;{obj.targetRoomId}&rdquo;. Pick one
              from the list.
            </div>
          )}
          {obj.targetRoomId && targetRoom && (
            <Field label="Target Entry Point">
              <select
                value={obj.targetEntryPointId ?? ""}
                onChange={(e) => {
                  const slug = e.target.value || undefined;
                  // Dual-write: slug + iid, same as room target above.
                  const iid = slug
                    ? targetEntryPoints.find((ep) => ep.id === slug)?.iid
                    : undefined;
                  update({
                    targetEntryPointId: slug,
                    targetEntryPointIid: iid,
                  });
                }}
                className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
              >
                <option value="">Default</option>
                {targetEntryPoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.id}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {obj.targetRoomId &&
            targetRoom &&
            obj.targetEntryPointId &&
            !targetEntryPoints.some((ep) => ep.id === obj.targetEntryPointId) && (
              <div className="text-[10px] text-red-400 px-1 -mt-1">
                ⚠ Entry point &ldquo;{obj.targetEntryPointId}&rdquo; doesn&apos;t
                exist in {targetRoom.name ?? obj.targetRoomId}.
              </div>
            )}
        </>
        )}
      />

      <div className="flex items-center justify-between mt-1">
        <h4 className="font-medium text-xs text-neutral-300 flex items-center gap-1">
          Walk-To Point
          <InfoTip label="Where the player stops before triggering this object's interaction. Defaults to the bottom-center of the object." />
        </h4>
        {/* Pick-on-canvas button. Toggling it sets
            pendingMoveToPickFor; the canvas then commits on the next
            stage click. Re-clicking (or pressing Esc) cancels. */}
        <Tooltip
          label={
            pendingMoveToPickFor === selectedObjectId
              ? "Click on the canvas to set walk-to (Esc to cancel)"
              : "Pick walk-to point by clicking on the canvas"
          }
        >
          <button
            onClick={() =>
              setPendingMoveToPickFor(
                pendingMoveToPickFor === selectedObjectId
                  ? null
                  : selectedObjectId
              )
            }
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
              pendingMoveToPickFor === selectedObjectId
                ? "bg-yellow-500 text-black"
                : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
            }`}
          >
            <Crosshair size={10} />
            {pendingMoveToPickFor === selectedObjectId ? "Picking…" : "Pick"}
          </button>
        </Tooltip>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Walk-to X">
          <NumberInput
            value={obj.moveTo?.x ?? 0}
            onChange={(v) =>
              update({ moveTo: { x: v, y: obj.moveTo?.y ?? obj.y + obj.height } })
            }
          />
        </Field>
        <Field label="Walk-to Y">
          <NumberInput
            value={obj.moveTo?.y ?? 0}
            onChange={(v) =>
              update({ moveTo: { x: obj.moveTo?.x ?? obj.x + obj.width / 2, y: v } })
            }
          />
        </Field>
      </div>

      <Field
        label={
          <span className="inline-flex items-center gap-1">
            Layer
            <InfoTip label="By default, objects auto-sort by their Y position so the avatar walks behind objects that are above it. Use these buttons to pin an object to a specific layer." />
          </span>
        }
      >
        <div className="flex flex-col gap-1">
          <div
            className={
              obj.zIndex != null
                ? "text-[11px] px-2 py-1 rounded bg-amber-900/40 text-amber-200 border border-amber-700/40"
                : "text-[11px] px-2 py-1 rounded bg-neutral-800 text-neutral-400 border border-neutral-700"
            }
          >
            {obj.zIndex != null
              ? `Depth pinned (${obj.zIndex})`
              : "Auto (Y-sorted)"}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => bringToFront(selectedObjectId)}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700"
            >
              Bring to Front
            </button>
            <button
              type="button"
              onClick={() => bringForward(selectedObjectId)}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700"
            >
              Bring Forward
            </button>
            <button
              type="button"
              onClick={() => sendBackward(selectedObjectId)}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700"
            >
              Send Backward
            </button>
            <button
              type="button"
              onClick={() => sendToBack(selectedObjectId)}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700"
            >
              Send to Back
            </button>
          </div>
          {obj.zIndex == null ? (
            <button
              type="button"
              onClick={() => lockLayer(selectedObjectId)}
              className="text-xs px-2 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700"
              title="Pin this object's layer at its current depth (so a future Y change won't restack it)"
            >
              Pin depth at current layer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => resetLayer(selectedObjectId)}
              className="text-xs px-2 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700"
            >
              Reset to Auto
            </button>
          )}
        </div>
      </Field>

      {/* Easter egg — a playful reaction (hover lives in the section above). */}
      <div className="border-t border-neutral-700 mt-2 pt-2" />
      <h4 className="font-medium text-xs text-neutral-300 flex items-center gap-1">
        Easter egg
        <InfoTip label="Try it in the Live Preview (P) — click the object's sprite." />
      </h4>
      <label className="flex items-center gap-1 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={!!obj.easterEgg}
          onChange={(e) =>
            update({
              easterEgg: e.target.checked
                ? { trigger: "click", reaction: "sparkle" }
                : undefined,
            })
          }
        />
        Easter egg
      </label>
      {obj.easterEgg && (
        <EasterEggFields
          egg={obj.easterEgg}
          onChange={(egg) => update({ easterEgg: egg })}
        />
      )}

      {/* Sprite */}
      <div className="border-t border-neutral-700 mt-2 pt-2" />
      <h4 className="font-medium text-xs text-neutral-300">Sprite</h4>
      {!obj.spriteUrl && (
        <p className="text-[11px] text-neutral-400 -mt-1 leading-snug">
          {obj.invisible
            ? "Hotspot only — nothing is drawn in the game."
            : "No sprite yet — the game shows the starter drawing below."}
        </p>
      )}
      {!obj.spriteUrl && !obj.invisible && defaultArtFor(obj) && (
        <div className="bg-neutral-800 rounded p-2 flex items-center justify-center border border-dashed border-neutral-600">
          {/* eslint-disable-next-line @next/next/no-img-element -- local starter drawing */}
          <img src={defaultArtFor(obj)!} alt="" className="max-h-16" />
        </div>
      )}
      {obj.spriteUrl && (
        <div className="bg-neutral-800 rounded p-2 flex items-center justify-center border border-neutral-600">
          <img
            src={obj.spriteUrl}
            alt="Object sprite"
            className="max-w-full max-h-16"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      )}
      <button
        onClick={() =>
          // Always pass a sprite target keyed by this object's id — even on
          // first draw — so the studio opens this object's own canvas
          // instead of dumping us into the shared scratchpad.
          window.dispatchEvent(
            new CustomEvent("editor:open-draw-modal", {
              detail: {
                editTarget: {
                  kind: "sprite",
                  objectId: selectedObjectId,
                },
              },
            })
          )
        }
        className="w-full py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-500 transition-colors"
      >
        {obj.spriteUrl ? "Edit Sprite in Studio" : "Draw Sprite in Studio"}
      </button>
      <div className="grid grid-cols-2 gap-1">
        <Field label="Use a starter drawing">
          <select
            value={STARTER_ELEMENTS.find((e) => e.url === obj.spriteUrl)?.id ?? ""}
            onChange={(e) => {
              const el = STARTER_ELEMENTS.find((x) => x.id === e.target.value);
              if (!el) return;
              // Keep the object's width; match the drawing's proportions.
              const h = Math.round((obj.width * el.h) / el.w);
              update({ spriteUrl: el.url, height: h, invisible: undefined });
            }}
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
          >
            <option value="" disabled>
              Pick…
            </option>
            {STARTER_ELEMENTS.map((el) => (
              <option key={el.id} value={el.id}>
                {el.name}
              </option>
            ))}
          </select>
        </Field>
        {obj.spriteUrl ? (
          <button
            onClick={() => update({ spriteUrl: undefined })}
            className="self-end py-1 rounded text-xs bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
          >
            Remove sprite
          </button>
        ) : (
          <label className="self-end flex items-center gap-1 text-[11px] text-neutral-300 pb-1">
            <input
              type="checkbox"
              checked={obj.invisible ?? false}
              onChange={(e) => update({ invisible: e.target.checked || undefined })}
            />
            Hotspot only
            <InfoTip label="Nothing is drawn in the game — use for doors or objects already painted into the background. Shown as a dashed box in the editor." />
          </label>
        )}
      </div>

      {/* Content editing — doors don't render content; they teleport. */}
      {obj.type !== "door" && (
        <button
          onClick={() =>
            useEditorStore.getState().openContentEditor(selectedObjectId)
          }
          className="w-full py-1.5 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600 transition-colors"
        >
          Edit pop-up
        </button>
      )}

      {/* Save as Template — promote this configured object into a reusable
          preset so the same hitbox/labels/interaction can be dropped into
          another room with one drag. */}
      <Tooltip label="Save this object's sprite + dimensions + hitbox + interaction as a reusable template you can drop into other rooms.">
        <button
          onClick={() => setShowSaveAsTemplate(true)}
          className="w-full py-1.5 rounded text-xs font-medium bg-neutral-700 text-neutral-100 hover:bg-neutral-600 transition-colors"
        >
          Save as Template
        </button>
      </Tooltip>

      {showSaveAsTemplate && (
        <SaveAsTemplateModal
          objectId={selectedObjectId}
          onClose={() => setShowSaveAsTemplate(false)}
        />
      )}
    </div>
  );
}

function EasterEggFields({
  egg,
  onChange,
}: {
  egg: EasterEgg;
  onChange: (egg: EasterEgg) => void;
}) {
  const set = (patch: Partial<EasterEgg>) => onChange({ ...egg, ...patch });
  return (
    <div className="space-y-2 rounded border border-amber-700/50 bg-amber-900/10 p-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label="When">
          <select
            value={egg.trigger}
            onChange={(e) => set({ trigger: e.target.value as EasterEgg["trigger"] })}
            className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
          >
            <option value="click">Clicked</option>
            <option value="clicks">Clicked N times</option>
            <option value="hover">Hovered</option>
          </select>
        </Field>
        {egg.trigger === "clicks" ? (
          <Field label="Clicks">
            <NumberInput
              value={egg.count ?? 5}
              min={2}
              max={50}
              onChange={(v) => set({ count: Math.max(2, Math.round(v)) })}
            />
          </Field>
        ) : (
          <div />
        )}
      </div>
      <Field label="Reaction">
        <select
          value={egg.reaction}
          onChange={(e) => set({ reaction: e.target.value as EasterEggReaction })}
          className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
        >
          {REACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Message (EN, optional)">
        <TextInput
          value={egg.message ?? ""}
          onChange={(v) => set({ message: v || undefined })}
        />
      </Field>
      <Field label="Message (AR, optional)">
        <TextInput
          value={egg.messageAr ?? ""}
          onChange={(v) => set({ messageAr: v || undefined })}
        />
      </Field>
      <label className="flex items-center gap-1 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={egg.once ?? false}
          onChange={(e) => set({ once: e.target.checked || undefined })}
        />
        Only the first time per visit
      </label>
    </div>
  );
}

// ─── Multi-selection Panel ───────────────────────────────────

const ALIGN_BUTTONS = [
  { mode: "left", label: "Align left edges", Icon: AlignStartVertical },
  { mode: "hcenter", label: "Align horizontal centres", Icon: AlignCenterVertical },
  { mode: "right", label: "Align right edges", Icon: AlignEndVertical },
  { mode: "top", label: "Align top edges", Icon: AlignStartHorizontal },
  { mode: "vcenter", label: "Align vertical centres", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Align bottom edges", Icon: AlignEndHorizontal },
] as const;

function MultiSelectionPanel() {
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);
  const ids = useEditorStore((s) => s.selectedObjectIds);
  const alignObjects = useEditorStore((s) => s.alignObjects);
  const distributeObjects = useEditorStore((s) => s.distributeObjects);
  const duplicateObjects = useEditorStore((s) => s.duplicateObjects);
  const updateObject = useEditorStore((s) => s.updateObject);
  const selectObject = useEditorStore((s) => s.selectObject);
  if (!currentRoomConfig) return null;
  const objs = currentRoomConfig.objects.filter((o) => ids.includes(o.id));
  const hoverValues = new Set(objs.map((o) => o.hoverEffect ?? "auto"));
  const sharedHover = hoverValues.size === 1 ? [...hoverValues][0] : "";

  const btn =
    "flex items-center justify-center rounded bg-neutral-700 p-1.5 text-neutral-200 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-neutral-200">
          {objs.length} objects selected
        </h3>
        <div className="flex gap-1">
          <Tooltip label="Duplicate all" shortcut="Ctrl+D">
            <button
              onClick={() => duplicateObjects(ids)}
              className="px-2 py-0.5 text-xs bg-neutral-700 rounded hover:bg-neutral-600"
            >
              Dup
            </button>
          </Tooltip>
          <Tooltip label="Delete all" shortcut="Del">
            <button
              onClick={() => deleteObjectsWithUndo(ids)}
              className="px-2 py-0.5 text-xs bg-red-800 rounded hover:bg-red-700"
            >
              Del
            </button>
          </Tooltip>
        </div>
      </div>

      <div>
        <div className="text-neutral-400 text-xs mb-1">Align</div>
        <div className="grid grid-cols-6 gap-1" role="group" aria-label="Align selected objects">
          {ALIGN_BUTTONS.map(({ mode, label, Icon }) => (
            <Tooltip key={mode} label={label}>
              <button
                onClick={() => {
                  alignObjects(ids, mode);
                  announce(label);
                }}
                className={btn}
                aria-label={label}
              >
                <Icon size={14} />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      <div>
        <div className="text-neutral-400 text-xs mb-1">
          Distribute {objs.length < 3 && <span className="text-neutral-500">(needs 3+)</span>}
        </div>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label="Distribute selected objects">
          <button
            onClick={() => {
              distributeObjects(ids, "x");
              announce("Spaced evenly horizontally");
            }}
            disabled={objs.length < 3}
            className={`${btn} gap-1 text-xs`}
          >
            <AlignHorizontalSpaceAround size={14} /> Horizontally
          </button>
          <button
            onClick={() => {
              distributeObjects(ids, "y");
              announce("Spaced evenly vertically");
            }}
            disabled={objs.length < 3}
            className={`${btn} gap-1 text-xs`}
          >
            <AlignVerticalSpaceAround size={14} /> Vertically
          </button>
        </div>
      </div>

      <Field label="On hover (all)">
        <select
          value={sharedHover}
          onChange={(e) => {
            const v = e.target.value as HoverEffect;
            for (const o of objs) {
              updateObject(o.id, { hoverEffect: v === "auto" ? undefined : v });
            }
          }}
          className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
        >
          {sharedHover === "" && <option value="">Mixed</option>}
          {HOVER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <div className="text-neutral-400 text-xs mb-1">In selection</div>
        <ul className="space-y-0.5 max-h-40 overflow-y-auto">
          {objs.map((o) => (
            <li key={o.id}>
              <button
                onClick={() => selectObject(o.id)}
                className="w-full truncate rounded px-1.5 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-700"
                title="Select only this object"
              >
                {o.label || o.id} <span className="text-neutral-500">· {o.type}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-neutral-500 leading-snug">
        Shift/Ctrl-click to add or remove objects, drag on empty canvas to
        box-select. Drag any selected object to move them all.
      </p>
    </div>
  );
}

// ─── Entry Point Properties Panel ─────────────────────────────

function EntryPointPropertiesPanel() {
  const {
    currentRoomConfig,
    selectedEntryPointId,
    updateEntryPoint,
    renameEntryPoint,
  } = useEditorStore();

  if (!currentRoomConfig || !selectedEntryPointId) return null;

  const ep = currentRoomConfig.entryPoints.find(
    (e) => e.id === selectedEntryPointId
  );
  if (!ep) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-neutral-200 flex items-center gap-1">
          Entry Point
          <InfoTip label="A named spawn position. Doors in other rooms can target this entry by ID — the player arrives here and faces Direction." />
        </h3>
        <Tooltip label="Delete this entry point" shortcut="Del">
          <button
            onClick={() => deleteEntryPointWithFeedback(selectedEntryPointId)}
            className="px-2 py-0.5 text-xs bg-red-800 rounded hover:bg-red-700"
          >
            Delete
          </button>
        </Tooltip>
      </div>

      <Field label="ID">
        <SlugInput
          value={ep.id}
          onCommit={(v) => renameEntryPoint(selectedEntryPointId, v)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberInput
            value={ep.x}
            onChange={(v) => updateEntryPoint(selectedEntryPointId, { x: v })}
          />
        </Field>
        <Field label="Y">
          <NumberInput
            value={ep.y}
            onChange={(v) => updateEntryPoint(selectedEntryPointId, { y: v })}
          />
        </Field>
      </div>

      <Field
        label={
          <span className="inline-flex items-center gap-1">
            Direction
            <InfoTip label="Which way the player faces when they spawn here." />
          </span>
        }
      >
        <select
          value={ep.direction}
          onChange={(e) =>
            updateEntryPoint(selectedEntryPointId, {
              direction: e.target.value as "left" | "right",
            })
          }
          className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
        >
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select>
      </Field>
    </div>
  );
}

// ─── Objects List ─────────────────────────────────────────────

function ObjectsListRow({
  obj,
  isSelected,
  onSelect,
}: {
  obj: RoomObject;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: obj.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => onSelect(e.shiftKey || e.ctrlKey || e.metaKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(e.shiftKey || e.ctrlKey || e.metaKey);
        }
      }}
      aria-selected={isSelected}
      className={`group/objrow w-full text-left px-1 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer ${
        isSelected
          ? "bg-blue-700 text-white"
          : "bg-neutral-750 text-neutral-300 hover:bg-neutral-700"
      }`}
      {...attributes}
    >
      <button
        type="button"
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="p-0.5 -ml-0.5 text-neutral-500 opacity-0 group-hover/objrow:opacity-100 touch:opacity-100 touch:touch-none hover:text-neutral-200 cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder layer"
      >
        <GripVertical size={10} />
      </button>
      <span
        className="w-2 h-2 rounded-sm flex-shrink-0"
        style={{ backgroundColor: getObjectFill(obj.type) }}
      />
      <span className="truncate flex-1">{obj.label}</span>
      {obj.zIndex != null && (
        <span
          className="text-[8px] text-amber-400/70"
          title={`Layer locked at ${obj.zIndex}`}
        >
          ●
        </span>
      )}
      <span className="text-neutral-500">{obj.type}</span>
    </div>
  );
}

function ObjectsListPanel() {
  const { currentRoomConfig, selectedObjectIds, selectObject, toggleObjectSelection, reorderObjects } =
    useEditorStore();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );
  if (!currentRoomConfig) return null;

  // Top of list = highest effective depth = renders on top, matching the
  // Photoshop layers convention. Drag-to-reorder mirrors the OutlinePanel
  // behaviour and writes zIndex via reorderObjects.
  const sorted = [...currentRoomConfig.objects].sort(
    (a, b) => (b.zIndex ?? b.y) - (a.zIndex ?? a.y)
  );
  const ids = sorted.map((o) => o.id);

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = ids.indexOf(e.active.id as string);
    const newIndex = ids.indexOf(e.over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    reorderObjects(arrayMove(ids, oldIndex, newIndex));
  };

  return (
    <div className="space-y-1 mt-4">
      <h4 className="font-medium text-xs text-neutral-300">
        Objects ({currentRoomConfig.objects.length})
      </h4>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {sorted.map((obj) => (
              <ObjectsListRow
                key={obj.id}
                obj={obj}
                isSelected={selectedObjectIds.includes(obj.id)}
                onSelect={(additive) =>
                  additive ? toggleObjectSelection(obj.id) : selectObject(obj.id)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function getObjectFill(type: RoomObject["type"]): string {
  switch (type) {
    case "door":
      return "#6b4226";
    case "npc":
      return "#8b5cf6";
    default:
      return "#5f9ea0";
  }
}

// ─── Main Panel ───────────────────────────────────────────────

// ─── Validation Warnings ─────────────────────────────────────

function ValidationPanel() {
  const { currentRoomConfig } = useEditorStore();
  if (!currentRoomConfig) return null;

  const warnings: string[] = [];
  const { objects, entryPoints, walkableArea, width, height } = currentRoomConfig;

  // Check for objects outside room bounds
  for (const obj of objects) {
    if (obj.x < 0 || obj.y < 0 || obj.x + obj.width > width || obj.y + obj.height > height) {
      warnings.push(`"${obj.label}" is outside room bounds`);
    }
  }

  // Check for doors without targets (7c collapsed stairs into doors)
  for (const obj of objects) {
    if (obj.type === "door" && !obj.targetRoomId) {
      warnings.push(`"${obj.label}" (door) has no target room`);
    }
  }

  // Check if room has entry points
  if (entryPoints.length === 0) {
    warnings.push("Room has no entry points");
  }

  // Check if walkable area is too small
  if (walkableArea.polygon.length < 3) {
    warnings.push("Walkable area needs at least 3 vertices");
  }

  // Check for entry points outside walkable area (simple bounds check)
  const polyMinX = Math.min(...walkableArea.polygon.map((p) => p.x));
  const polyMaxX = Math.max(...walkableArea.polygon.map((p) => p.x));
  const polyMinY = Math.min(...walkableArea.polygon.map((p) => p.y));
  const polyMaxY = Math.max(...walkableArea.polygon.map((p) => p.y));
  for (const ep of entryPoints) {
    if (ep.x < polyMinX || ep.x > polyMaxX || ep.y < polyMinY || ep.y > polyMaxY) {
      warnings.push(`Entry point "${ep.id}" may be outside walkable area`);
    }
  }

  if (warnings.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-neutral-700">
      <h3 className="font-medium text-xs text-yellow-400 mb-2">
        Warnings ({warnings.length})
      </h3>
      <div className="space-y-1">
        {warnings.map((w, i) => (
          <div
            key={i}
            className="text-xs text-yellow-300 bg-yellow-900/20 rounded px-2 py-1"
          >
            {w}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditorSidePanel() {
  const { selectedObjectId, selectedObjectIds, selectedEntryPointId } = useEditorStore();

  return (
    <div className="w-80 bg-neutral-800 border-l border-neutral-700 overflow-y-auto p-3 flex-shrink-0">
      {selectedObjectIds.length > 1 ? (
        <MultiSelectionPanel />
      ) : selectedObjectId ? (
        <ObjectPropertiesPanel />
      ) : selectedEntryPointId ? (
        <EntryPointPropertiesPanel />
      ) : (
        <RoomPropertiesPanel />
      )}
      <ObjectsListPanel />
      <ValidationPanel />
    </div>
  );
}
