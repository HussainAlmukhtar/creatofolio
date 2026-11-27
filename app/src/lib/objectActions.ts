// Object actions ("When clicked…" / "When the player walks near…") — pure
// helpers shared by the room schema migration, the game runtime, the editor
// and the integrity check.
//
// The source of truth is `RoomObject.interactions`. Objects without it (the
// static seed, objects dropped from a template, rows not yet migrated) get
// their steps DERIVED from the legacy `interactionType` / `externalUrl`
// fields, reproducing exactly what the legacy runtime did:
//
//   door (any type but "none")  → [door]          (walk, then go through)
//   "none"                      → []              (a click walks there like the floor)
//   "avatar-shop"               → [shop]          (opens the character creator)
//   "external-link" + URL       → [link, no confirm]
//   "external-link", no URL     → [popup]         (the old runtime fell through to the pop-up)
//   "content" / absent / npc    → [popup]
//
// Writers DUAL-WRITE the legacy fields back from the steps
// (`withLegacyInteraction`), so a rollback to older code still behaves
// sensibly with rooms saved by the new editor. Pure: no DOM, no Phaser.

import type {
  Dialogue,
  ObjectAction,
  ObjectActionKind,
  ObjectInteractions,
  RoomConfig,
  RoomObject,
  Trigger,
  NearTrigger,
} from "@/data/roomTypes";
import { safeHref, safeMediaSrc, urlProblem } from "@/lib/safeUrl";

type LegacyType = NonNullable<RoomObject["interactionType"]>;

// ─── Legacy → steps ─────────────────────────────────────────────

/** The click steps the legacy runtime effectively ran for `obj`. */
export function legacyClickActions(obj: Pick<RoomObject, "type" | "interactionType" | "externalUrl">): ObjectAction[] {
  const it: LegacyType = obj.interactionType ?? "content";
  if (it === "none") return [];
  if (obj.type === "door") return [{ kind: "door" }];
  if (it === "avatar-shop") return [{ kind: "shop" }];
  if (it === "external-link") {
    // Old GameWrapper: `if (externalUrl)` — an empty URL opened the pop-up.
    return obj.externalUrl ? [{ kind: "link", url: obj.externalUrl, confirm: false }] : [{ kind: "popup" }];
  }
  return [{ kind: "popup" }];
}

/** The object's click trigger (its own, else derived from the legacy fields). */
export function clickTriggerOf(obj: RoomObject): Trigger {
  if (obj.interactions) return obj.interactions.click ?? { actions: [] };
  return { actions: legacyClickActions(obj) };
}

/** The object's "walks near" trigger, or null when it's off/empty. */
export function nearTriggerOf(obj: RoomObject): NearTrigger | null {
  const n = obj.interactions?.near;
  return n && n.enabled && n.actions.length ? n : null;
}

/** Does a click do something (vs. walking there like the floor)? */
export function isClickable(obj: RoomObject): boolean {
  return clickTriggerOf(obj).actions.length > 0;
}

// ─── Steps → legacy (dual-write) ────────────────────────────────

interface LegacyFields {
  interactionType: LegacyType;
  externalUrl?: string;
}

/** The closest legacy behaviour for a list of steps. */
export function legacyFieldsFor(obj: Pick<RoomObject, "type">, actions: ObjectAction[]): LegacyFields {
  if (obj.type === "door") {
    // Old code teleported any door that wasn't "none".
    return { interactionType: actions.some((a) => a.kind === "door") ? "content" : "none" };
  }
  for (const a of actions) {
    switch (a.kind) {
      case "popup":
      case "open-popup":
      case "dialogue":
        return { interactionType: "content" };
      case "link":
        return { interactionType: "external-link", externalUrl: a.url };
      case "email": {
        const href = mailtoHref(a.address, a.subject?.en);
        if (href) return { interactionType: "external-link", externalUrl: href };
        break;
      }
      case "download":
        if (a.url) return { interactionType: "external-link", externalUrl: a.url };
        break;
      case "shop":
        return { interactionType: "avatar-shop" };
      default:
        // effect / sound / wait / toggle / go-to-room: old code can't do them.
        break;
    }
  }
  return { interactionType: "none" };
}

/** Would old code behave the same with these legacy fields? */
function sameLegacyBehaviour(obj: RoomObject, f: LegacyFields): boolean {
  const a = legacyClickActions(obj);
  const b = legacyClickActions({ type: obj.type, ...f });
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Dual-write: bring `interactionType` / `externalUrl` in line with the
 * object's steps. Leaves the object untouched (same reference) when old code
 * would already behave the same, so untouched rooms don't churn.
 */
export function withLegacyInteraction(obj: RoomObject): RoomObject {
  if (!obj.interactions) return obj;
  const f = legacyFieldsFor(obj, obj.interactions.click?.actions ?? []);
  if (sameLegacyBehaviour(obj, f)) return obj;
  const next: RoomObject = { ...obj, interactionType: f.interactionType };
  if (f.externalUrl !== undefined) next.externalUrl = f.externalUrl;
  return next;
}

/** Dual-write every object of a room (save paths). Same reference if nothing changed. */
export function withLegacyInteractions(room: RoomConfig): RoomConfig {
  let changed = false;
  const objects = room.objects.map((o) => {
    const n = withLegacyInteraction(o);
    if (n !== o) changed = true;
    return n;
  });
  return changed ? { ...room, objects } : room;
}

/**
 * Room schema v5 → v6 step for one object: write the derived steps into
 * `interactions.click`. An object that already has `interactions` keeps them
 * unless its legacy fields say otherwise (it was edited by older code after a
 * rollback: that edit wins).
 */
export function migrateObjectInteractions(obj: RoomObject): RoomObject {
  if (obj.interactions) {
    const f = legacyFieldsFor(obj, obj.interactions.click?.actions ?? []);
    if (sameLegacyBehaviour(obj, f)) return obj;
    return { ...obj, interactions: { ...obj.interactions, click: { actions: legacyClickActions(obj) } } };
  }
  return { ...obj, interactions: { click: { actions: legacyClickActions(obj) } } };
}

/** Where the player stands to use an object (moveTo, else the floor below
 *  it). "Walks near" distances are measured from here. */
export function walkTargetOf(
  obj: Pick<RoomObject, "moveTo" | "x" | "y" | "width" | "height" | "isWallMounted">,
  room: Pick<RoomConfig, "walkableArea">
): { x: number; y: number } {
  return (
    obj.moveTo || {
      x: obj.x + obj.width / 2,
      y: obj.isWallMounted ? (room.walkableArea.polygon[0]?.y ?? obj.y + obj.height) + 40 : obj.y + obj.height,
    }
  );
}

// ─── Step through pop-ups ─────────────────────────────

/** Does a click on this object show its own pop-up? */
export function opensOwnPopup(obj: RoomObject): boolean {
  return clickTriggerOf(obj).actions.some((a) => a.kind === "popup");
}

/**
 * The room's pop-ups in "Step through" order: the author's `order` first,
 * then every other object whose click shows its own pop-up, left to right
 * (top to bottom on a tie). Ignores the `enabled` flag (callers check it).
 */
export function popupSequence(room: Pick<RoomConfig, "objects" | "popupNav">): RoomObject[] {
  const withPopup = room.objects.filter((o) => opensOwnPopup(o));
  const byIid = new Map(withPopup.filter((o) => o.iid).map((o) => [o.iid!, o]));
  const ordered: RoomObject[] = [];
  for (const iid of room.popupNav?.order ?? []) {
    const o = byIid.get(iid);
    if (o && !ordered.includes(o)) ordered.push(o);
  }
  const rest = withPopup
    .filter((o) => !ordered.includes(o))
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2) || a.y - b.y);
  return [...ordered, ...rest];
}

// ─── Copies (templates, duplicates) ─────────────────────────────

function mapSteps(list: ObjectAction[], fn: (a: ObjectAction) => ObjectAction): ObjectAction[] {
  return list.map((a) => {
    const b = fn(a);
    if (b.kind !== "dialogue") return b;
    return {
      ...b,
      dialogue: {
        ...b.dialogue,
        lines: (b.dialogue.lines ?? []).map((l) => ({
          ...l,
          id: shortId(),
          choices: l.choices?.map((c) => ({ ...c, id: shortId(), actions: mapSteps(c.actions, fn) })),
        })),
      },
    };
  });
}

/**
 * A copy's steps: references to the ORIGINAL object (`fromIid`, e.g. "show /
 * hide this object" or "show this object's pop-up" by iid) now point at the
 * copy (`toIid`); dialogue line/answer ids are fresh. Other references are
 * kept (the integrity check flags any that dangle in the new room).
 */
export function remapInteractions(
  interactions: ObjectInteractions | undefined,
  fromIid: string | undefined,
  toIid: string
): ObjectInteractions | undefined {
  if (!interactions) return undefined;
  const fix = (a: ObjectAction): ObjectAction =>
    fromIid && (a.kind === "open-popup" || a.kind === "toggle-object") && a.objectIid === fromIid
      ? { ...a, objectIid: toIid }
      : a;
  const trig = <T extends Trigger | undefined>(t: T): T => (t ? ({ ...t, actions: mapSteps(t.actions, fix) } as T) : t);
  return { click: trig(interactions.click), near: trig(interactions.near) };
}

// ─── Templates ────────────────────────────────────────

/** What a template remembers of how its object behaves
 *  (`object_templates.behaviour`, migration 20261008000002_popup_presets). */
export interface TemplateBehaviour {
  /** Object / Door / Character (the category alone can't say Character). */
  type?: RoomObject["type"];
  interactions?: ObjectInteractions;
  hoverEffect?: RoomObject["hoverEffect"];
  hoverIntensity?: number;
  hoverLabel?: boolean;
  revealOnHover?: boolean;
  hiddenAtStart?: boolean;
  easterEgg?: RoomObject["easterEgg"];
  /** The saved object's iid: steps that pointed at it point at each new copy. */
  sourceIid?: string;
}

/** The behaviour to store when an object becomes a template. */
export function templateBehaviourOf(obj: RoomObject): TemplateBehaviour {
  const b: TemplateBehaviour = {
    type: obj.type,
    // Stored even when derived, so the template keeps today's steps.
    interactions: obj.interactions ?? { click: clickTriggerOf(obj) },
    sourceIid: obj.iid,
  };
  if (obj.hoverEffect) b.hoverEffect = obj.hoverEffect;
  if (obj.hoverIntensity != null) b.hoverIntensity = obj.hoverIntensity;
  if (obj.hoverLabel) b.hoverLabel = true;
  if (obj.revealOnHover) b.revealOnHover = true;
  if (obj.hiddenAtStart) b.hiddenAtStart = true;
  if (obj.easterEgg) b.easterEgg = structuredClone(obj.easterEgg);
  return b;
}

/** The fields a dropped template's new object gets (its new iid given). */
export function objectFieldsFromBehaviour(b: TemplateBehaviour | null | undefined, newObjectIid: string): Partial<RoomObject> {
  if (!b) return {};
  const out: Partial<RoomObject> = {};
  if (b.type) out.type = b.type;
  if (b.interactions) out.interactions = remapInteractions(structuredClone(b.interactions), b.sourceIid, newObjectIid);
  if (b.hoverEffect) out.hoverEffect = b.hoverEffect;
  if (b.hoverIntensity != null) out.hoverIntensity = b.hoverIntensity;
  if (b.hoverLabel) out.hoverLabel = true;
  if (b.revealOnHover) out.revealOnHover = true;
  if (b.hiddenAtStart) out.hiddenAtStart = true;
  if (b.easterEgg) out.easterEgg = structuredClone(b.easterEgg);
  return out;
}

// ─── URLs ───────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;

export function isEmailAddress(v: string | undefined): boolean {
  return !!v && EMAIL_RE.test(v.trim());
}

/** mailto: with an optional subject; null for an invalid address. */
export function mailtoHref(address: string | undefined, subject?: string): string | null {
  const addr = address?.trim() ?? "";
  if (!EMAIL_RE.test(addr)) return null;
  return safeHref(`mailto:${addr}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`);
}

/** Supabase Storage serves `?download=<name>` as an attachment (the HTML
 *  `download` attribute is ignored for another origin). null = refused. */
export function downloadHref(url: string | undefined, name?: string): string | null {
  const safe = safeHref(url);
  if (!safe) return null;
  if (!/\/storage\/v1\/object\/public\//.test(safe)) return safe;
  try {
    const u = new URL(safe);
    u.searchParams.set("download", name || u.pathname.split("/").pop() || "file");
    return u.toString();
  } catch {
    return safe;
  }
}

/** A sound step's source (null = refused). */
export function soundSrc(url: string | undefined): string | null {
  return safeMediaSrc(url, "media");
}

// ─── Once ───────────────────────────────────────────────────────

export type TriggerName = "click" | "near";

/** Storage key of a once-only trigger (localStorage / sessionStorage). */
export function onceKey(room: Pick<RoomConfig, "iid" | "id">, obj: Pick<RoomObject, "iid" | "id">, trigger: TriggerName): string {
  return `once:${room.iid ?? room.id}:${obj.iid ?? obj.id}:${trigger}`;
}

// ─── Step catalogue (editor) ────────────────────────────────────

export interface StepSpec {
  kind: ObjectActionKind;
  label: string;
  hint: string;
  group: "Show" | "Go" | "Reach out" | "Fun" | "Flow";
  /** Only for these object kinds (absent = all). */
  only?: RoomObject["type"][];
  make: () => ObjectAction;
}

export const STEP_SPECS: StepSpec[] = [
  { kind: "popup", label: "Show this object's pop-up", hint: "The pop-up you build with Edit pop-up.", group: "Show", make: () => ({ kind: "popup" }) },
  { kind: "open-popup", label: "Show another object's pop-up", hint: "Any object's pop-up, in this room or another.", group: "Show", make: () => ({ kind: "open-popup", objectIid: "" }) },
  { kind: "dialogue", label: "Talk (dialogue box)", hint: "Lines of speech at the bottom of the screen, with answers to pick.", group: "Show", make: () => ({ kind: "dialogue", dialogue: { lines: [{ id: shortId(), text: { en: "", ar: "" } }] } }) },
  { kind: "door", label: "Go through this door", hint: "To the room and entry point set on the step.", group: "Go", only: ["door"], make: () => ({ kind: "door" }) },
  { kind: "go-to-room", label: "Go to a room", hint: "Send the player to any room (and entry point).", group: "Go", make: () => ({ kind: "go-to-room", roomIid: "" }) },
  { kind: "link", label: "Open a link", hint: "Opens in a new tab. Can ask first.", group: "Reach out", make: () => ({ kind: "link", url: "", confirm: true }) },
  { kind: "email", label: "Write an email", hint: "Opens the visitor's email app.", group: "Reach out", make: () => ({ kind: "email", address: "" }) },
  { kind: "download", label: "Download a file", hint: "A PDF or sound file from the media library.", group: "Reach out", make: () => ({ kind: "download", url: "" }) },
  { kind: "effect", label: "Play an effect", hint: "Sparkles, confetti, a spin… with an optional speech bubble.", group: "Fun", make: () => ({ kind: "effect", reaction: "sparkle" }) },
  { kind: "sound", label: "Play a sound", hint: "A sound file from the media library.", group: "Fun", make: () => ({ kind: "sound", url: "", volume: 0.8 }) },
  { kind: "toggle-object", label: "Show / hide an object", hint: "For this visit only.", group: "Fun", make: () => ({ kind: "toggle-object", objectIid: "", mode: "toggle" }) },
  { kind: "shop", label: "Open the character creator", hint: "Lets the visitor change how their character looks.", group: "Flow", make: () => ({ kind: "shop" }) },
  { kind: "wait", label: "Wait", hint: "Pause before the next step.", group: "Flow", make: () => ({ kind: "wait", ms: 1000 }) },
];

export function stepSpec(kind: ObjectActionKind): StepSpec {
  return STEP_SPECS.find((s) => s.kind === kind)!;
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Problems (editor inline + integrity check) ─────────────────

export interface StepContext {
  /** Every loaded room by slug. */
  rooms: Record<string, RoomConfig>;
  /** The room the object is in. */
  room: RoomConfig;
}

export interface StepProblem {
  severity: "error" | "warning";
  message: string;
}

export function roomByIid(rooms: Record<string, RoomConfig>, iid: string | undefined): RoomConfig | null {
  if (!iid) return null;
  for (const r of Object.values(rooms)) if (r?.iid === iid) return r;
  return null;
}

export function objectByIid(room: RoomConfig | null, iid: string | undefined): RoomObject | null {
  if (!room || !iid) return null;
  return room.objects.find((o) => o.iid === iid) ?? null;
}

const filled = (l?: { en?: string; ar?: string }) => !!(l?.en?.trim() || l?.ar?.trim());
const halfFilled = (l?: { en?: string; ar?: string }) => !!l?.en?.trim() !== !!l?.ar?.trim();

/** The first problem with one step (nested dialogue choices included). */
export function stepProblem(a: ObjectAction, ctx: StepContext): StepProblem | null {
  switch (a.kind) {
    case "link":
      if (!a.url?.trim()) return { severity: "error", message: "Add the link." };
      return problem(urlProblem(a.url, "link"));
    case "email":
      if (!a.address?.trim()) return { severity: "error", message: "Add the email address." };
      return isEmailAddress(a.address) ? null : { severity: "error", message: "That doesn't look like an email address." };
    case "download":
      if (!a.url?.trim()) return { severity: "error", message: "Choose the file." };
      return problem(urlProblem(a.url, "link"));
    case "sound":
      if (!a.url?.trim()) return { severity: "error", message: "Choose the sound." };
      return problem(urlProblem(a.url, "media"));
    case "go-to-room": {
      const r = roomByIid(ctx.rooms, a.roomIid);
      if (!r) return { severity: "error", message: a.roomIid ? "That room no longer exists." : "Pick the room." };
      if (a.entryPointIid && !r.entryPoints.some((e) => e.iid === a.entryPointIid)) {
        return { severity: "error", message: "That entry point no longer exists." };
      }
      return null;
    }
    case "open-popup": {
      const r = a.roomIid ? roomByIid(ctx.rooms, a.roomIid) : ctx.room;
      if (!r) return { severity: "error", message: "That room no longer exists." };
      if (!objectByIid(r, a.objectIid)) return { severity: "error", message: a.objectIid ? "That object no longer exists." : "Pick the object." };
      return null;
    }
    case "toggle-object":
      if (!objectByIid(ctx.room, a.objectIid)) return { severity: "error", message: a.objectIid ? "That object no longer exists." : "Pick the object." };
      return null;
    case "dialogue":
      return dialogueProblem(a.dialogue, ctx);
    case "wait":
      return a.ms > 10000 ? { severity: "warning", message: "Waits longer than 10 seconds feel broken." } : null;
    default:
      return null;
  }
}

function problem(msg: string | null): StepProblem | null {
  return msg ? { severity: "error", message: msg } : null;
}

export function dialogueProblem(d: Dialogue, ctx: StepContext): StepProblem | null {
  const lines = d.lines ?? [];
  if (!lines.some((l) => filled(l.text))) return { severity: "error", message: "The conversation has no lines yet." };
  for (const l of lines) {
    for (const c of l.choices ?? []) {
      if (!filled(c.label)) return { severity: "error", message: "An answer has no words." };
      for (const s of c.actions) {
        const p = stepProblem(s, ctx);
        if (p) return { severity: p.severity, message: `Answer “${c.label.en || c.label.ar}”: ${p.message}` };
      }
    }
  }
  return null;
}

/** Bilingual gaps in a conversation (speaker, lines, answers, bubbles). */
export function dialogueTranslationGaps(d: Dialogue): number {
  let n = 0;
  if (halfFilled(d.speaker)) n++;
  for (const l of d.lines ?? []) {
    if (halfFilled(l.text)) n++;
    for (const c of l.choices ?? []) {
      if (halfFilled(c.label)) n++;
      for (const s of c.actions) n += stepTranslationGaps(s);
    }
  }
  return n;
}

export function stepTranslationGaps(a: ObjectAction): number {
  if (a.kind === "dialogue") return dialogueTranslationGaps(a.dialogue);
  if (a.kind === "effect" && halfFilled(a.message)) return 1;
  if (a.kind === "email" && halfFilled(a.subject)) return 1;
  return 0;
}

/** Every step of an object's triggers (dialogue answers included). */
export function allSteps(interactions: ObjectInteractions | undefined): ObjectAction[] {
  const out: ObjectAction[] = [];
  const walk = (list: ObjectAction[]) => {
    for (const a of list) {
      out.push(a);
      if (a.kind === "dialogue") for (const l of a.dialogue.lines ?? []) for (const c of l.choices ?? []) walk(c.actions);
    }
  };
  walk(interactions?.click?.actions ?? []);
  walk(interactions?.near?.actions ?? []);
  return out;
}

// ─── Summaries (compact step cards, issues panel) ───────────────

const REACTION_LABEL: Record<string, string> = {
  sparkle: "Sparkles",
  confetti: "Confetti",
  spin: "Spin",
  jump: "Jump",
  wiggle: "Wiggle",
  shake: "Shake",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function describeStep(a: ObjectAction, ctx: StepContext, self?: RoomObject): string {
  switch (a.kind) {
    case "popup":
      return "Show this object's pop-up";
    case "open-popup": {
      const r = a.roomIid ? roomByIid(ctx.rooms, a.roomIid) : ctx.room;
      const o = objectByIid(r, a.objectIid);
      if (!o) return "Show a pop-up (pick the object)";
      return `Show “${o.label || o.id}” pop-up${r && r !== ctx.room ? ` (${r.name || r.id})` : ""}`;
    }
    case "door": {
      const r = self ? roomByIid(ctx.rooms, self.targetRoomIid) ?? (self.targetRoomId ? ctx.rooms[self.targetRoomId] : null) : null;
      return r ? `Go through to ${r.name || r.id}` : "Go through this door (pick the room)";
    }
    case "go-to-room": {
      const r = roomByIid(ctx.rooms, a.roomIid);
      return r ? `Go to ${r.name || r.id}` : "Go to a room (pick it)";
    }
    case "link":
      return a.url ? `Open ${hostOf(a.url)}${a.confirm ? " (asks first)" : ""}` : "Open a link (add it)";
    case "email":
      return a.address ? `Email ${a.address}` : "Write an email (add the address)";
    case "download":
      return a.url ? `Download ${a.fileName || decodeURIComponent(a.url.split("/").pop()?.split("?")[0] ?? "file")}` : "Download a file (choose it)";
    case "dialogue": {
      const lines = a.dialogue.lines?.length ?? 0;
      const answers = (a.dialogue.lines ?? []).reduce((n, l) => n + (l.choices?.length ?? 0), 0);
      const who = a.dialogue.speaker?.en || a.dialogue.speaker?.ar;
      return `${who ? `${who} says` : "Talk"}: ${lines} line${lines === 1 ? "" : "s"}${answers ? `, ${answers} answer${answers === 1 ? "" : "s"}` : ""}`;
    }
    case "effect":
      return `${REACTION_LABEL[a.reaction] ?? a.reaction}${a.message?.en || a.message?.ar ? " + bubble" : ""}`;
    case "sound":
      return a.url ? `Play ${decodeURIComponent(a.url.split("/").pop()?.split("?")[0] ?? "sound")}` : "Play a sound (choose it)";
    case "toggle-object": {
      const o = objectByIid(ctx.room, a.objectIid);
      const verb = a.mode === "show" ? "Show" : a.mode === "hide" ? "Hide" : "Show/hide";
      return o ? `${verb} “${o.label || o.id}”` : `${verb} an object (pick it)`;
    }
    case "shop":
      return "Open the character creator";
    case "wait":
      return `Wait ${Math.round(a.ms / 100) / 10} s`;
  }
}
