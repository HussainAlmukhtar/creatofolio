// Game harness — lets the owner-only pop-up lab (/admin/popup-lab) run the
// real Phaser game on IN-MEMORY fixture rooms, so runtime work is verified
// without publishing anything.
//
// Deliberately a context, not a PhaserGame prop: GameWrapper/CabinetStage
// can't pass it by accident, and only components/admin/PopupLab.tsx renders
// the provider. With a harness, PhaserGame skips the database room load and
// starts in `startRoom`; everything else (scenes, input, EventBridge) is the
// production code path.

import { createContext } from "react";
import type { RoomConfig } from "@/data/roomTypes";

export interface GameHarness {
  roomConfigs: Record<string, RoomConfig>;
  startRoom: string;
  /** The live world's "show room name tags" default (Play the draft passes it). */
  roomNameTags?: boolean;
}

export const GameHarnessContext = createContext<GameHarness | null>(null);
