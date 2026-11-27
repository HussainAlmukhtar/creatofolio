"use client";

// "When clicked…" / "When the player walks near…" / Hover — the room
// editor's object interactions, shown in the side
// panel's Object Properties.
//
// Steps are compact cards (tap the header to open its fields); ⋯ moves,
// duplicates or deletes (same menu on touch and desktop). Every change goes
// through `commit`, which DUAL-WRITES the legacy interactionType/externalUrl
// (lib/objectActions.ts::withLegacyInteraction) so older code still behaves
// sensibly with the saved room. URLs are checked with lib/safeUrl.ts here
// (inline error) and again at runtime (refused).

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, ArrowUp, ArrowDown, Copy, Trash2, AlertTriangle } from "lucide-react";
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/overflow-menu";
import { MediaLibraryDialog } from "@/components/landing-editor/MediaLibraryDialog";
import { useEditorStore } from "@/stores/editorStore";
import type {
  EasterEggReaction,
  HoverEffect,
  ObjectAction,
  ObjectInteractions,
  RoomConfig,
  RoomObject,
  Trigger,
  TriggerOnce,
} from "@/data/roomTypes";
import type { Localized } from "@/data/landingTypes";
import {
  STEP_SPECS,
  describeStep,
  legacyClickActions,
  stepProblem,
  stepSpec,
  withLegacyInteraction,
  type StepContext,
} from "@/lib/objectActions";
import { InfoTip } from "@/components/editor/EditorTooltip";
import { DialogueEditor } from "./DialogueEditor";

const INPUT = "bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full";

const ONCE_OPTIONS: { value: TriggerOnce; label: string }[] = [
  { value: "never", label: "Every time" },
  { value: "session", label: "Once per visit" },
  { value: "forever", label: "Only the first time ever" },
];

const HOVER_OPTIONS: { value: HoverEffect; label: string }[] = [
  { value: "auto", label: "Auto — lift if clickable" },
  { value: "none", label: "None" },
  { value: "lift", label: "Lift" },
  { value: "grow", label: "Grow" },
  { value: "glow", label: "Glow" },
  { value: "wiggle", label: "Wiggle" },
  { value: "pulse", label: "Pulse" },
];

const REACTIONS: { value: EasterEggReaction; label: string }[] = [
  { value: "sparkle", label: "Sparkles" },
  { value: "confetti", label: "Confetti" },
  { value: "spin", label: "Spin" },
  { value: "jump", label: "Jump" },
  { value: "wiggle", label: "Wiggle" },
  { value: "shake", label: "Shake" },
];

/** The object's steps as the editor shows them (derived when not stored yet). */
export function interactionsOf(obj: RoomObject): ObjectInteractions {
  return obj.interactions ?? { click: { actions: legacyClickActions(obj) } };
}

/** A patch that stores `next` and dual-writes the legacy fields. */
export function interactionsPatch(obj: RoomObject, next: ObjectInteractions, type: RoomObject["type"] = obj.type): Partial<RoomObject> {
  const n = withLegacyInteraction({ ...obj, type, interactions: next });
  return { interactions: next, interactionType: n.interactionType, externalUrl: n.externalUrl };
}

/**
 * Changing Object ↔ Door ↔ Character: a door goes through itself (a fresh
 * door's "show the pop-up" default becomes "go through"); leaving door-hood
 * drops the door step (an empty list falls back to the pop-up).
 */
export function kindChangePatch(obj: RoomObject, type: RoomObject["type"]): Partial<RoomObject> {
  const cur = interactionsOf(obj);
  let actions = cur.click?.actions ?? [];
  if (type === "door") {
    if (!actions.some((a) => a.kind === "door")) {
      actions = actions.length === 1 && actions[0].kind === "popup" ? [{ kind: "door" }] : [...actions, { kind: "door" }];
    }
  } else {
    actions = actions.filter((a) => a.kind !== "door");
    if (obj.type === "door" && !actions.length) actions = [{ kind: "popup" }];
  }
  const next = { ...cur, click: { ...cur.click, actions } };
  return { type, ...interactionsPatch(obj, next, type) };
}

// ─── Section ────────────────────────────────────────────────────

export function InteractionsSection({
  obj,
  update,
  renderDoorTarget,
}: {
  obj: RoomObject;
  update: (patch: Partial<RoomObject>) => void;
  /** The door's own target fields (room + entry point), shown in its door step. */
  renderDoorTarget: () => ReactNode;
}) {
  const room = useEditorStore((s) => s.currentRoomConfig);
  const allRooms = useEditorStore((s) => s.allRooms) as Record<string, RoomConfig>;
  if (!room) return null;
  const ctx: StepContext = { rooms: { ...allRooms, [room.id]: room }, room };
  const cur = interactionsOf(obj);
  const commit = (next: ObjectInteractions) => update(interactionsPatch(obj, next));
  const click: Trigger = cur.click ?? { actions: [] };
  const near = cur.near ?? { actions: [] };

  return (
    <div className="space-y-3">
      <TriggerBlock
        title="When clicked…"
        hint="The player walks to the object, then these run in order. No steps = the player just walks there."
        trigger={click}
        obj={obj}
        ctx={ctx}
        renderDoorTarget={renderDoorTarget}
        onChange={(t) => commit({ ...cur, click: t })}
      />

      <div className="rounded border border-neutral-700 bg-neutral-800/40 p-2 space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
          <input
            type="checkbox"
            checked={!!near.enabled}
            onChange={(e) => commit({ ...cur, near: { ...near, enabled: e.target.checked || undefined } })}
          />
          When the player walks near…
          <InfoTip label="Runs when the player comes within the radius of the object's walk-to point (the orange circle on the canvas). Never on arrival in the room, and never while a pop-up, conversation or door change is happening. Fires again only after the player has walked away." />
        </label>
        {near.enabled && (
          <>
            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <span className="shrink-0">Radius</span>
              <input
                type="range"
                min={30}
                max={400}
                step={10}
                value={obj.interactionRadius || 100}
                onChange={(e) => update({ interactionRadius: Number(e.target.value) })}
                className="flex-1"
                aria-label="Walks-near radius"
              />
              <span className="w-12 text-right tabular-nums">{obj.interactionRadius || 100} px</span>
            </label>
            <TriggerBlock
              title="Steps"
              trigger={near}
              obj={obj}
              ctx={ctx}
              nested
              renderDoorTarget={renderDoorTarget}
              onChange={(t) => commit({ ...cur, near: { ...t, enabled: true } })}
            />
          </>
        )}
      </div>

      <HoverBlock obj={obj} update={update} />
    </div>
  );
}

// ─── One trigger's step list ────────────────────────────────────

function TriggerBlock({
  title,
  hint,
  trigger,
  obj,
  ctx,
  nested,
  renderDoorTarget,
  onChange,
}: {
  title: string;
  hint?: string;
  trigger: Trigger;
  obj: RoomObject;
  ctx: StepContext;
  nested?: boolean;
  renderDoorTarget: () => ReactNode;
  onChange: (t: Trigger) => void;
}) {
  const actions = trigger.actions;
  const setActions = (next: ObjectAction[]) => onChange({ ...trigger, actions: next });
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className={`font-medium text-xs ${nested ? "text-neutral-400" : "text-neutral-200"} flex shrink-0 items-center gap-1 whitespace-nowrap`}>
          {title}
          {hint && <InfoTip label={hint} />}
        </h4>
        <select
          value={trigger.once ?? "never"}
          onChange={(e) => onChange({ ...trigger, once: e.target.value === "never" ? undefined : (e.target.value as TriggerOnce) })}
          aria-label={`${title} — how often`}
          className="min-w-0 max-w-[60%] bg-neutral-800 text-neutral-200 rounded px-1.5 py-0.5 text-[11px] border border-neutral-700"
        >
          {ONCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <StepList
        actions={actions}
        obj={obj}
        ctx={ctx}
        openIdx={openIdx}
        setOpenIdx={setOpenIdx}
        renderDoorTarget={renderDoorTarget}
        onChange={setActions}
      />
    </div>
  );
}

/** Steps + "Add a step" (also used for dialogue answers). */
export function StepList({
  actions,
  obj,
  ctx,
  openIdx,
  setOpenIdx,
  renderDoorTarget,
  exclude = [],
  emptyText = "No steps: clicking just walks there.",
  onChange,
}: {
  actions: ObjectAction[];
  obj: RoomObject;
  ctx: StepContext;
  openIdx: number | null;
  setOpenIdx: (i: number | null) => void;
  renderDoorTarget?: () => ReactNode;
  /** Step kinds not offered here (e.g. a dialogue inside a dialogue answer). */
  exclude?: ObjectAction["kind"][];
  /** Shown while the list is empty. */
  emptyText?: string;
  onChange: (next: ObjectAction[]) => void;
}) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= actions.length) return;
    const next = [...actions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (openIdx === i) setOpenIdx(j);
  };
  const specs = STEP_SPECS.filter((s) => (!s.only || s.only.includes(obj.type)) && !exclude.includes(s.kind));
  const groups = [...new Set(specs.map((s) => s.group))];
  const addItems: OverflowMenuItem[] = groups.flatMap((g) => [
    { kind: "label" as const, label: g },
    ...specs
      .filter((s) => s.group === g)
      .map((s) => ({
        label: s.label,
        onSelect: () => {
          onChange([...actions, s.make()]);
          setOpenIdx(actions.length);
        },
      })),
  ]);
  return (
    <div className="space-y-1">
      {actions.length === 0 && (
        <p className="text-[11px] text-neutral-500 italic px-1">{emptyText}</p>
      )}
      <ol className="space-y-1">
        {actions.map((a, i) => (
          <StepCard
            key={i}
            index={i}
            count={actions.length}
            action={a}
            obj={obj}
            ctx={ctx}
            open={openIdx === i}
            onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            renderDoorTarget={renderDoorTarget}
            onChange={(n) => onChange(actions.map((x, k) => (k === i ? n : x)))}
            onMove={(d) => move(i, d)}
            onDuplicate={() => {
              const next = [...actions];
              next.splice(i + 1, 0, structuredClone(a));
              onChange(next);
            }}
            onDelete={() => {
              onChange(actions.filter((_, k) => k !== i));
              setOpenIdx(null);
            }}
          />
        ))}
      </ol>
      <OverflowMenu
        label="Add a step"
        align="start"
        items={addItems}
        trigger={
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-neutral-600 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            <Plus size={12} aria-hidden="true" /> Add a step
          </button>
        }
      />
    </div>
  );
}

function StepCard({
  index,
  count,
  action,
  obj,
  ctx,
  open,
  onToggle,
  renderDoorTarget,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  index: number;
  count: number;
  action: ObjectAction;
  obj: RoomObject;
  ctx: StepContext;
  open: boolean;
  onToggle: () => void;
  renderDoorTarget?: () => ReactNode;
  onChange: (a: ObjectAction) => void;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const problem =
    action.kind === "door"
      ? obj.targetRoomIid || obj.targetRoomId
        ? null
        : ({ severity: "error", message: "Pick the room this door leads to." } as const)
      : stepProblem(action, ctx);
  const spec = stepSpec(action.kind);
  return (
    <li
      className={`rounded border ${
        problem?.severity === "error" ? "border-red-700/70" : "border-neutral-700"
      } bg-neutral-800`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-xs text-neutral-100"
        >
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <span className="tabular-nums text-neutral-500">{index + 1}.</span>
          <span className="truncate">{describeStep(action, ctx, obj)}</span>
          {problem && (
            <AlertTriangle
              size={12}
              className={problem.severity === "error" ? "shrink-0 text-red-400" : "shrink-0 text-amber-400"}
              aria-label={problem.message}
            />
          )}
        </button>
        <OverflowMenu
          label={`Step ${index + 1} actions`}
          triggerClassName="grid place-items-center rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
          items={[
            { label: "Move up", icon: ArrowUp, onSelect: () => onMove(-1), disabled: index === 0 },
            { label: "Move down", icon: ArrowDown, onSelect: () => onMove(1), disabled: index === count - 1 },
            { label: "Duplicate", icon: Copy, onSelect: onDuplicate },
            { kind: "separator" },
            { label: "Delete step", icon: Trash2, onSelect: onDelete, danger: true },
          ]}
        />
      </div>
      {problem && (
        <p className={`px-2 pb-1 text-[11px] touch:text-[13px] ${problem.severity === "error" ? "text-red-400" : "text-amber-300"}`}>
          {problem.message}
        </p>
      )}
      {open && (
        <div className="space-y-2 border-t border-neutral-700 p-2">
          <p className="text-[11px] text-neutral-400 leading-snug">{spec.hint}</p>
          <StepFields action={action} obj={obj} ctx={ctx} renderDoorTarget={renderDoorTarget} onChange={onChange} />
        </div>
      )}
    </li>
  );
}

// ─── Per-kind fields ────────────────────────────────────────────

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-neutral-400 text-xs">{label}</span>
      {children}
    </label>
  );
}

function LocalizedFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Localized | undefined;
  onChange: (v: Localized | undefined) => void;
}) {
  const v = value ?? { en: "", ar: "" };
  const set = (patch: Partial<Localized>) => {
    const n = { ...v, ...patch };
    onChange(n.en || n.ar ? n : undefined);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={`${label} (EN)`}>
        <input type="text" value={v.en} onChange={(e) => set({ en: e.target.value })} className={INPUT} />
      </Field>
      <Field label={`${label} (AR)`}>
        <input type="text" dir="rtl" value={v.ar} onChange={(e) => set({ ar: e.target.value })} className={INPUT} />
      </Field>
    </div>
  );
}

function roomsByName(ctx: StepContext): RoomConfig[] {
  return Object.values(ctx.rooms)
    .filter((r): r is RoomConfig => !!r?.iid)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

function StepFields({
  action,
  obj,
  ctx,
  renderDoorTarget,
  onChange,
}: {
  action: ObjectAction;
  obj: RoomObject;
  ctx: StepContext;
  renderDoorTarget?: () => ReactNode;
  onChange: (a: ObjectAction) => void;
}) {
  const [library, setLibrary] = useState(false);
  switch (action.kind) {
    case "popup":
      return (
        <button
          type="button"
          onClick={() => useEditorStore.getState().openContentEditor(obj.id)}
          className="w-full py-1 rounded text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600"
        >
          Edit pop-up
        </button>
      );
    case "open-popup": {
      const roomIid = action.roomIid ?? ctx.room.iid;
      const r = roomsByName(ctx).find((x) => x.iid === roomIid) ?? ctx.room;
      return (
        <>
          <Field label="Room">
            <select
              value={roomIid ?? ""}
              onChange={(e) =>
                onChange({ ...action, roomIid: e.target.value === ctx.room.iid ? undefined : e.target.value, objectIid: "" })
              }
              className={INPUT}
            >
              {roomsByName(ctx).map((x) => (
                <option key={x.iid} value={x.iid}>
                  {x.iid === ctx.room.iid ? `This room (${x.name || x.id})` : x.name || x.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Object">
            <select value={action.objectIid} onChange={(e) => onChange({ ...action, objectIid: e.target.value })} className={INPUT}>
              <option value="">Pick…</option>
              {r.objects
                .filter((o) => o.iid && o.type !== "door")
                .map((o) => (
                  <option key={o.iid} value={o.iid}>
                    {o.label || o.id}
                  </option>
                ))}
            </select>
          </Field>
        </>
      );
    }
    case "door":
      return <>{renderDoorTarget?.()}</>;
    case "go-to-room": {
      const r = roomsByName(ctx).find((x) => x.iid === action.roomIid);
      return (
        <>
          <Field label="Room">
            <select
              value={action.roomIid}
              onChange={(e) => onChange({ ...action, roomIid: e.target.value, entryPointIid: undefined })}
              className={INPUT}
            >
              <option value="">Pick…</option>
              {roomsByName(ctx).map((x) => (
                <option key={x.iid} value={x.iid}>
                  {x.name || x.id}
                </option>
              ))}
            </select>
          </Field>
          {r && (
            <Field label="Arrive at">
              <select
                value={action.entryPointIid ?? ""}
                onChange={(e) => onChange({ ...action, entryPointIid: e.target.value || undefined })}
                className={INPUT}
              >
                <option value="">The room’s default spot</option>
                {r.entryPoints
                  .filter((ep) => ep.iid)
                  .map((ep) => (
                    <option key={ep.iid} value={ep.iid}>
                      {ep.id}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </>
      );
    }
    case "link":
      return (
        <>
          <Field label="Link">
            <input
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={action.url}
              onChange={(e) => onChange({ ...action, url: e.target.value })}
              className={INPUT}
            />
          </Field>
          <label className="flex items-start gap-1.5 text-xs text-neutral-300">
            <input type="checkbox" checked={action.confirm} onChange={(e) => onChange({ ...action, confirm: e.target.checked })} />
            <span>
              Ask “leave the site?” first
              <span className="block text-[11px] text-neutral-500">
                Recommended: without it, some browsers block a tab opened after the walk.
              </span>
            </span>
          </label>
        </>
      );
    case "email":
      return (
        <>
          <Field label="Email address">
            <input
              type="email"
              inputMode="email"
              value={action.address}
              onChange={(e) => onChange({ ...action, address: e.target.value })}
              className={INPUT}
            />
          </Field>
          <LocalizedFields label="Subject" value={action.subject} onChange={(subject) => onChange({ ...action, subject })} />
        </>
      );
    case "download":
    case "sound": {
      const isSound = action.kind === "sound";
      return (
        <>
          <Field label={isSound ? "Sound" : "File"}>
            <div className="flex gap-1">
              <input
                type="url"
                inputMode="url"
                value={action.url}
                placeholder="https://…"
                onChange={(e) => onChange({ ...action, url: e.target.value })}
                className={INPUT}
              />
              <button
                type="button"
                onClick={() => setLibrary(true)}
                className="shrink-0 rounded bg-neutral-600 px-2 text-xs text-white hover:bg-neutral-500"
              >
                Choose…
              </button>
            </div>
          </Field>
          {action.kind === "download" ? (
            <Field label="File name visitors get (optional)">
              <input
                type="text"
                value={action.fileName ?? ""}
                onChange={(e) => onChange({ ...action, fileName: e.target.value || undefined })}
                className={INPUT}
              />
            </Field>
          ) : (
            <label className="flex items-center gap-2 text-xs text-neutral-300">
              <span className="shrink-0">Volume</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.1}
                value={action.volume ?? 0.8}
                onChange={(e) => onChange({ ...action, volume: Number(e.target.value) })}
                className="flex-1"
                aria-label="Volume"
              />
              <span className="w-9 text-right tabular-nums">{Math.round((action.volume ?? 0.8) * 100)}%</span>
            </label>
          )}
          <MediaLibraryDialog
            open={library}
            onOpenChange={setLibrary}
            uploadKind="content"
            title={isSound ? "Choose a sound" : "Choose a file"}
            kinds={isSound ? ["audio"] : ["file", "audio"]}
            onPick={(m) =>
              onChange(
                action.kind === "download"
                  ? { ...action, url: m.url, fileName: action.fileName || m.name || undefined }
                  : { ...action, url: m.url }
              )
            }
          />
        </>
      );
    }
    case "effect":
      return (
        <>
          <Field label="Effect">
            <select
              value={action.reaction}
              onChange={(e) => onChange({ ...action, reaction: e.target.value as EasterEggReaction })}
              className={INPUT}
            >
              {REACTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <LocalizedFields label="Speech bubble" value={action.message} onChange={(message) => onChange({ ...action, message })} />
        </>
      );
    case "toggle-object":
      return (
        <>
          <Field label="Object (this room)">
            <select value={action.objectIid} onChange={(e) => onChange({ ...action, objectIid: e.target.value })} className={INPUT}>
              <option value="">Pick…</option>
              {ctx.room.objects
                .filter((o) => o.iid)
                .map((o) => (
                  <option key={o.iid} value={o.iid}>
                    {o.label || o.id}
                    {o.hiddenAtStart ? " (starts hidden)" : ""}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Do">
            <select
              value={action.mode}
              onChange={(e) => onChange({ ...action, mode: e.target.value as typeof action.mode })}
              className={INPUT}
            >
              <option value="toggle">Show it if hidden, hide it if shown</option>
              <option value="show">Show it</option>
              <option value="hide">Hide it</option>
            </select>
          </Field>
        </>
      );
    case "wait":
      return (
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <span className="shrink-0">Seconds</span>
          <input
            type="range"
            min={100}
            max={5000}
            step={100}
            value={Math.min(5000, action.ms)}
            onChange={(e) => onChange({ ...action, ms: Number(e.target.value) })}
            className="flex-1"
            aria-label="Wait (seconds)"
          />
          <span className="w-10 text-right tabular-nums">{(action.ms / 1000).toFixed(1)} s</span>
        </label>
      );
    case "shop":
      return null;
    case "dialogue": {
      const first = action.dialogue.lines?.find((l) => l.text.en || l.text.ar);
      return (
        <>
          {first && (
            <p className="rounded bg-neutral-900/70 px-2 py-1 text-[11px] italic text-neutral-300 line-clamp-2">
              “{first.text.en || first.text.ar}”
            </p>
          )}
          <button
            type="button"
            onClick={() => setLibrary(true)}
            className="w-full py-1 rounded text-xs font-medium bg-sky-700 text-white hover:bg-sky-600"
          >
            Edit conversation…
          </button>
          <DialogueEditor
            open={library}
            onOpenChange={setLibrary}
            dialogue={action.dialogue}
            obj={obj}
            ctx={ctx}
            onChange={(dialogue) => onChange({ ...action, dialogue })}
          />
        </>
      );
    }
  }
}

// ─── Hover ──────────────────────────────────────────────────────

function HoverBlock({ obj, update }: { obj: RoomObject; update: (patch: Partial<RoomObject>) => void }) {
  const k = obj.hoverIntensity ?? 1;
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-xs text-neutral-200 flex items-center gap-1">
        Hover
        <InfoTip label="Try these in the Live Preview (P) — hover the object's sprite." />
      </h4>
      <select
        value={obj.hoverEffect ?? "auto"}
        onChange={(e) => update({ hoverEffect: e.target.value === "auto" ? undefined : (e.target.value as HoverEffect) })}
        aria-label="On hover"
        className={INPUT}
      >
        {HOVER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-xs text-neutral-300">
        <span className="shrink-0">Intensity</span>
        <input
          type="range"
          min={0.25}
          max={2}
          step={0.25}
          value={k}
          onChange={(e) => {
            const v = Number(e.target.value);
            update({ hoverIntensity: v === 1 ? undefined : v });
          }}
          className="flex-1"
          aria-label="Hover intensity"
          aria-valuetext={`${k}×`}
        />
        <span className="w-9 text-right tabular-nums">{k}×</span>
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-300">
        <input type="checkbox" checked={obj.hoverLabel ?? false} onChange={(e) => update({ hoverLabel: e.target.checked || undefined })} />
        Show name tag on hover
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-300">
        <input type="checkbox" checked={obj.revealOnHover ?? false} onChange={(e) => update({ revealOnHover: e.target.checked || undefined })} />
        Secret — invisible until hovered
        <InfoTip label="The object is hidden in the game until a player's cursor finds it. Once its Easter egg fires it stays visible." />
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-300">
        <input type="checkbox" checked={obj.hiddenAtStart ?? false} onChange={(e) => update({ hiddenAtStart: e.target.checked || undefined })} />
        Starts hidden
        <InfoTip label="Not there when the player arrives, until another object's “Show / hide an object” step shows it (this visit only)." />
      </label>
    </div>
  );
}
