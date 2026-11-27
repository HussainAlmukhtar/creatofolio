// The Phaser → React half of action steps that need the page: the scene asks
// (EVENTS.ACTION_UI) and React answers by calling `done` once the visitor is
// finished, so the ActionRunner can wait before the next step.
//
// Rendered by components/game/GameActionLayer.tsx (GameWrapper and the pop-up
// lab's game harness). URLs are checked with lib/safeUrl.ts on BOTH sides:
// the scene never asks for an unsafe one, and the layer refuses it again.

import type { Dialogue, DialogueChoice } from "@/data/roomTypes";
import { EventBridge, EVENTS } from "./EventBridge";

export type ActionUiRequest =
  | {
      type: "popup";
      roomId: string;
      objectId: string;
      label: string;
      labelAr: string;
      /** "Step through pop-ups" (the room's setting): every pop-up of the
       *  room in order, this one included. Absent = no arrows. */
      sequence?: PopupStop[];
      done: () => void;
    }
  | { type: "link"; url: string; confirm: boolean; done: () => void }
  | { type: "email"; href: string; done: () => void }
  | { type: "download"; href: string; fileName?: string; done: () => void }
  | {
      type: "dialogue";
      dialogue: Dialogue;
      /** The character's label, used when the dialogue has no speaker. */
      label: string;
      labelAr: string;
      done: (choice: DialogueChoice | null) => void;
    };

/** One pop-up the visitor can step to (same room). */
export interface PopupStop {
  objectId: string;
  label: string;
  labelAr: string;
}

/** What `done` resolves with, by request type. */
type Result<T extends ActionUiRequest["type"]> = T extends "dialogue" ? DialogueChoice | null : void;

/** Distributive Omit, so each request type keeps its own fields. */
type WithoutDone<T> = T extends unknown ? Omit<T, "done"> : never;

/**
 * Ask React for a step's UI and wait for the visitor. Resolves at once when
 * nothing is listening (e.g. a page without the action layer), so a chain
 * can never hang.
 */
export function requestActionUi<R extends WithoutDone<ActionUiRequest>>(req: R): Promise<Result<R["type"]>> {
  return new Promise((resolve) => {
    if (!EventBridge.has(EVENTS.ACTION_UI)) {
      resolve((req.type === "dialogue" ? null : undefined) as Result<R["type"]>);
      return;
    }
    let settled = false;
    const done = (value?: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value as Result<R["type"]>);
    };
    EventBridge.emit(EVENTS.ACTION_UI, { ...req, done } as ActionUiRequest);
  });
}

/** One line of the lab's QA log: every step the runner performs. */
export interface ActionStepLog {
  roomId: string;
  objectId: string;
  trigger: "click" | "near";
  kind: string;
  /** What happened ("opened", "refused: unsafe URL", "no target"…). */
  detail?: string;
}
