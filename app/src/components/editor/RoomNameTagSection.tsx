"use client";

// Room Properties → "Room name tag": the paper tag with the room's name in
// the game's top corner (components/game/systems/RoomNameTag.ts). Follows the
// world's default (Project settings) unless shown/hidden here; optional icon:
// none, a pin, or the owner's own drawing/upload.

import type { RoomConfig, RoomNameTag } from "@/data/roomTypes";
import { InfoTip } from "@/components/editor/EditorTooltip";
import { ArtPicker } from "@/components/popup-styles/ArtPicker";
import { iconGuide } from "@/lib/popupStyleGuides";

const ICON_CANVAS = { w: 256, h: 256 };

export function RoomNameTagSection({
  room,
  updateRoom,
}: {
  room: RoomConfig;
  updateRoom: (patch: Partial<RoomConfig>) => void;
}) {
  const tag: RoomNameTag = room.nameTag ?? {};
  const set = (patch: Partial<RoomNameTag>) => updateRoom({ nameTag: { ...tag, ...patch } });
  const show = tag.show ?? "world";
  const icon = tag.icon ?? "none";

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-xs text-neutral-300 mt-2 flex items-center gap-1">
        Room name tag
        <InfoTip label="The small paper tag with the room's name in the game's top corner (top-right in Arabic). The world's default is in Project settings." />
      </h4>
      <label className="block text-xs text-neutral-300">
        <span className="mb-1 block text-[11px] text-neutral-400">Show</span>
        <select
          value={show}
          onChange={(e) => set({ show: e.target.value as RoomNameTag["show"] })}
          className="bg-neutral-700 text-white rounded px-2 py-1 text-xs border border-neutral-600 w-full"
        >
          <option value="world">Like the rest of the world</option>
          <option value="show">Always show here</option>
          <option value="hide">Hide in this room</option>
        </select>
      </label>
      {show !== "hide" && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-[11px] text-neutral-400">Icon</legend>
          <div className="flex flex-wrap gap-3 text-xs text-neutral-300">
            {(
              [
                ["none", "None"],
                ["pin", "Pin"],
                ["art", "My drawing"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`name-tag-icon-${room.id}`}
                  checked={icon === value}
                  onChange={() => set({ icon: value })}
                />
                {label}
              </label>
            ))}
          </div>
          {icon === "art" && (
            <ArtPicker
              label="Name tag icon"
              hint="Square works best; it shows about as tall as the text."
              art={tag.art ?? null}
              canvas={ICON_CANVAS}
              guide={() => iconGuide(ICON_CANVAS)}
              onChange={(art) => set({ art })}
              defaultLabel="None yet"
              thumbClass="size-12"
            />
          )}
          {icon === "art" && !tag.art && (
            <p className="text-[11px] text-amber-300">No drawing yet: the tag shows without an icon.</p>
          )}
        </fieldset>
      )}
    </div>
  );
}
