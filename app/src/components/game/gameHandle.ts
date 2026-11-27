// gameHandle — production-safe registry for the running Phaser.Game.
//
// The landing page needs to reach the game instance (loop sleep/wake,
// scale.refresh) from outside the Phaser tree. The old mechanism was a
// dev-only `window.__creatofolioGame__` global, which made every consumer a
// silent no-op in production builds. This module is the replacement:
// PhaserGame registers the instance on boot, everyone else reads it here.
//
// The import below is type-only, so importing this module from landing
// components does NOT pull Phaser into the initial page chunk.

import type Phaser from "phaser";

/**
 * Why the game loop should be asleep right now. Multiple independent
 * sources can request sleep (hero scrolled offscreen, tab hidden); the
 * loop wakes only when *no* reason remains. A plain boolean would let
 * one source's "wake" stomp another's "sleep".
 */
export type SleepReason = "hero-offscreen" | "tab-hidden";

let game: Phaser.Game | null = null;
const sleepReasons = new Set<SleepReason>();

function applySleepState(): void {
  if (!game?.loop) return;
  if (sleepReasons.size > 0) {
    game.loop.sleep();
  } else {
    game.loop.wake();
  }
}

/** Called by PhaserGame after `new Phaser.Game(...)` and with null on destroy. */
export function setGameInstance(g: Phaser.Game | null): void {
  game = g;
  // A new instance must honor sleep requests made before it booted
  // (e.g. the visitor already scrolled past the hero while hydrating).
  if (game) applySleepState();
}

export function getGameInstance(): Phaser.Game | null {
  return game;
}

export function setSleepReason(reason: SleepReason, on: boolean): void {
  if (on) {
    sleepReasons.add(reason);
  } else {
    sleepReasons.delete(reason);
  }
  applySleepState();
}
