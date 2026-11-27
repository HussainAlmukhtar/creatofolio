// BootScene — first scene that runs. Builds avatar texture, registers a
// DynamicRoomScene for every room loaded into the registry by PhaserGame,
// then transitions into the start room.
//
// Scenes are no longer hardcoded in PhaserGame's
// `scene: [...]` array. The full set of rooms comes from
// `loadAllRoomConfigs()` (DB + file overlay when external files are on)
// and is added to the Scene Manager here, which means a room created in
// the editor renders at runtime with no code change.

import Phaser from "phaser";
import type { AvatarConfig } from "@/data/avatarTypes";
import type { RoomConfig } from "@/data/roomTypes";
import { registerAvatarTexture } from "../systems/AvatarTexture";
import DynamicRoomScene from "./DynamicRoomScene";

export default class BootScene extends Phaser.Scene {
  private avatarConfig: AvatarConfig | null = null;

  constructor() {
    super({ key: "BootScene" });
  }

  init(data: { avatarConfig?: AvatarConfig; startRoom?: string }) {
    if (data.avatarConfig) {
      this.avatarConfig = data.avatarConfig;
    }
  }

  create() {
    // Register one DynamicRoomScene per loaded room. PhaserGame stuffed the
    // full config map into the registry under "roomConfigs" before calling
    // `scene.start("BootScene")`. If the registry is empty (e.g. Supabase
    // unreachable AND no static fallback), we still try the static start
    // room key — falling back to a blank screen rather than crashing.
    const liveConfigs = this.registry.get("roomConfigs") as
      | Record<string, RoomConfig>
      | undefined;

    if (liveConfigs) {
      for (const [id, config] of Object.entries(liveConfigs)) {
        const key = `Room_${id}`;
        if (!this.scene.manager.keys[key]) {
          this.scene.manager.add(key, new DynamicRoomScene(key, config));
        }
      }
    }

    // Build the avatar sprite sheet, THEN start the room. Awaiting the
    // texture before scene.start() guarantees the player spawn in the
    // first room finds `player-avatar` already registered — no missing
    // -texture flash on first paint.
    void this.bootAvatarAndStart();
  }

  private async bootAvatarAndStart(): Promise<void> {
    if (this.avatarConfig) {
      try {
        await registerAvatarTexture(this, this.avatarConfig);
      } catch (err) {
        console.warn("Avatar texture build failed; spawning with default", err);
      }
    }

    // The world's configured start room can point at a slug that no longer
    // exists (renamed/deleted in the editor). Starting an unregistered key is
    // a silent no-op in Phaser — the arcade would sit on a blank canvas — so
    // fall back to "home", then to any loaded room.
    const requested =
      (this.scene.settings.data as { startRoom?: string })?.startRoom ||
      "home";
    const keys = this.scene.manager.keys as Record<string, unknown>;
    const startKey = [`Room_${requested}`, "Room_home"].find((k) => keys[k]) ??
      Object.keys(keys).find((k) => k.startsWith("Room_"));
    if (!startKey) {
      console.warn("[BootScene] No rooms loaded — nothing to start.");
      return;
    }
    if (startKey !== `Room_${requested}`) {
      console.warn(
        `[BootScene] Start room "${requested}" isn't loaded; starting ${startKey} instead.`
      );
    }
    this.scene.start(startKey, { entryFrom: "default" });
  }
}
