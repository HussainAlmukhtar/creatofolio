// DynamicRoomScene — concrete instantiation of BaseRoomScene that any room
// loaded at runtime gets registered under. Replaces the old per-slug scene
// classes (HomeScene, GalleryScene, …), all of which were trivial
// pass-throughs to BaseRoomScene's constructor.
//
// BootScene iterates the loaded room configs and does
// `this.scene.add('Room_' + id, new DynamicRoomScene('Room_' + id, config))`
// for each — so adding a room in the editor is a zero-code operation at
// runtime.

import type { RoomConfig } from "@/data/roomTypes";
import BaseRoomScene from "./BaseRoomScene";

export default class DynamicRoomScene extends BaseRoomScene {
  constructor(key: string, roomConfig: RoomConfig) {
    super(key, roomConfig);
  }
}
