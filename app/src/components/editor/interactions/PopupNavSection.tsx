"use client";

// Room Properties → "Step through pop-ups". Off by
// default. When on, a visitor reading one of this room's pop-ups gets arrows
// (and ←/→, mirrored in Arabic) to the previous / next one, in the order
// listed here: left to right across the room unless reordered.

import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import type { RoomConfig } from "@/data/roomTypes";
import { popupSequence } from "@/lib/objectActions";
import { InfoTip } from "@/components/editor/EditorTooltip";

export function PopupNavSection({
  room,
  updateRoom,
}: {
  room: RoomConfig;
  updateRoom: (patch: Partial<RoomConfig>) => void;
}) {
  const nav = room.popupNav ?? { enabled: false };
  const seq = popupSequence(room);
  const custom = !!nav.order?.length;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= seq.length) return;
    const ids = seq.map((o) => o.iid).filter((x): x is string => !!x);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    updateRoom({ popupNav: { ...nav, order: ids } });
  };
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-xs text-neutral-300 mt-2 flex items-center gap-1">
        Pop-ups
        <InfoTip label="While a visitor reads one of this room's pop-ups, arrows (and the ← → keys) go to the previous or next one without walking. In Arabic the arrows swap sides." />
      </h4>
      <label className="flex items-center gap-1.5 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={nav.enabled}
          onChange={(e) => updateRoom({ popupNav: { ...nav, enabled: e.target.checked } })}
        />
        Step through pop-ups
      </label>
      {nav.enabled && (
        <div className="space-y-1 rounded border border-neutral-700 bg-neutral-800/40 p-2">
          {seq.length < 2 ? (
            <p className="text-[11px] text-neutral-400">
              {seq.length === 0
                ? "No object here shows its pop-up when clicked yet."
                : "Only one object here shows a pop-up: arrows appear once there are two."}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-400">
                  Order {custom ? "(your order)" : "(left to right)"}
                </span>
                {custom && (
                  <button
                    type="button"
                    onClick={() => updateRoom({ popupNav: { enabled: true } })}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
                  >
                    <RotateCcw size={11} aria-hidden="true" /> Left to right
                  </button>
                )}
              </div>
              <ol className="space-y-1">
                {seq.map((o, i) => (
                  <li key={o.iid ?? o.id} className="flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-1 text-xs text-neutral-100">
                    <span className="w-5 tabular-nums text-neutral-500">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">{o.label || o.id}</span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Move ${o.label || o.id} earlier`}
                      className="grid place-items-center rounded p-1 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30"
                    >
                      <ArrowUp size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={i === seq.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move ${o.label || o.id} later`}
                      className="grid place-items-center rounded p-1 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30"
                    >
                      <ArrowDown size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
