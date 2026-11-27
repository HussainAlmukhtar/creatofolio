// Play the draft (/admin/play) — the data half. READ-ONLY.
//
// Builds the in-memory room set the real game boots with: every live room,
// with the unpublished draft overlaid where one exists. The overlay rule is
// the editor loader's own (`loadAllRoomsForEditor`: config from room_drafts,
// placement from the rooms.world_* columns), so what you walk through is what
// the editor shows and what Publish would make live.
//
// Pop-up content follows Publish too: `publish_room_draft` REPLACES a room's
// object_content rows with the draft's content map, so for a drafted room with
// a content map the pop-up for an object is `map[objectId]` (none = the empty
// state); a drafted room with no content map, and every other room, reads the
// live rows through the normal visitor loader.

import type { RoomConfig } from "@/data/roomTypes";
import type { ObjectContent } from "@/data/contentTypes";
import type { GameHarness } from "@/components/game/gameHarness";
import { loadAllRoomConfigs } from "@/lib/gameData";
import { loadAllRoomsForEditor } from "@/lib/editorData";

export interface PlayRoomInfo {
  id: string;
  name: string;
  nameAr: string;
  /** Has an unpublished draft (the room in `harness.roomConfigs` is the draft). */
  hasDraft: boolean;
  /** rooms.updated_at-style token of the draft, for "saved 2 min ago". */
  draftUpdatedAt?: string;
}

export interface PlayDraftData {
  harness: GameHarness;
  rooms: PlayRoomInfo[];
  /** false = the room_drafts table doesn't exist (migration 20261005000001_room_drafts): live rooms only. */
  draftsAvailable: boolean;
  /** Pop-up content of drafted rooms that carry a content map. */
  draftContent: Record<string, Record<string, ObjectContent>>;
  /** Set when the editor/read path reported a problem (rooms still play). */
  error?: string;
}

/** `startRoom` wins when it exists; else the live world's start room. */
export async function loadPlayDraftData(startRoom?: string | null): Promise<PlayDraftData> {
  const [live, editor] = await Promise.all([loadAllRoomConfigs(), loadAllRoomsForEditor()]);

  // Live rooms (the public loader, incl. the optional world-file overlay),
  // then each drafted room replaced by its draft.
  const roomConfigs: Record<string, RoomConfig> = { ...live.roomConfigs };
  const draftContent: PlayDraftData["draftContent"] = {};
  for (const [id, draft] of Object.entries(editor.drafts)) {
    const cfg = editor.rooms[id];
    if (!cfg) continue;
    roomConfigs[id] = structuredClone(cfg);
    if (draft.content) draftContent[id] = structuredClone(draft.content);
  }

  const rooms: PlayRoomInfo[] = Object.values(roomConfigs)
    .map((r) => ({
      id: r.id,
      name: r.name || r.id,
      nameAr: r.nameAr || r.name || r.id,
      hasDraft: !!editor.drafts[r.id],
      draftUpdatedAt: editor.drafts[r.id]?.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const start =
    startRoom && roomConfigs[startRoom]
      ? startRoom
      : roomConfigs[live.defaultRoomId]
        ? live.defaultRoomId
        : (rooms[0]?.id ?? live.defaultRoomId);

  return {
    harness: {
      roomConfigs,
      startRoom: start,
      roomNameTags: live.roomNameTags,
    },
    rooms,
    draftsAvailable: editor.draftsAvailable,
    draftContent,
    error: editor.error,
  };
}
