// ActionRunner — runs an object's steps ("When clicked…" / "When the player
// walks near…") in order, one chain at a time per scene.
//
// The scene supplies `perform(step)`; steps that open React UI (pop-up,
// link confirm, dialogue) resolve only when the visitor closes it, so the
// next step waits. A dialogue answer's steps run next, before the rest of
// the chain. Starting a new chain (or the scene shutting down) cancels the
// old one between steps. Pure TypeScript: no Phaser import.

import type { ObjectAction } from "@/data/roomTypes";

export type PerformStep = (
  step: ObjectAction,
  /** False once this chain was cancelled (a new chain, a room change). */
  alive: () => boolean
) => Promise<ObjectAction[] | void>;

/** Safety net against a dialogue answer that loops back on itself forever. */
const MAX_STEPS = 200;

export class ActionRunner {
  private token = 0;
  private running = false;

  /** A chain is in progress (waits, effects, an open pop-up…). */
  get busy(): boolean {
    return this.running;
  }

  /** Stop the current chain before its next step. */
  cancel() {
    this.token++;
    this.running = false;
  }

  async run(actions: ObjectAction[], perform: PerformStep): Promise<void> {
    const mine = ++this.token;
    const alive = () => mine === this.token;
    this.running = true;
    const queue = [...actions];
    let count = 0;
    try {
      while (queue.length && alive() && count++ < MAX_STEPS) {
        const step = queue.shift()!;
        try {
          const next = await perform(step, alive);
          if (next?.length && alive()) queue.unshift(...next);
        } catch (err) {
          // One broken step never strands the visitor: skip it, keep going.
          console.warn("[ActionRunner] step failed", step.kind, err);
        }
      }
    } finally {
      if (alive()) this.running = false;
    }
  }
}

/** Steps that take over the screen (a near trigger stops the walk for them). */
export function chainTakesOver(actions: ObjectAction[]): boolean {
  return actions.some((a) =>
    ["popup", "open-popup", "dialogue", "link", "door", "go-to-room"].includes(a.kind)
  );
}
