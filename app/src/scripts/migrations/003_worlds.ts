// One-shot migration: create the default "main" world and assign every
// existing room to it. The starter rooms are placed the way their doors
// connect; any other room is appended in a row below. Subsequent tweaks
// happen in the WorldView (drag rooms around).
//
// Usage:  npm run db:seed   (from app/; it runs this after seedSupabase.ts)
// Env:    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Idempotent — re-running is a no-op for rooms already assigned to the
// default world (we only update rows whose world_iid is null).
//
// Prerequisites:
//   - the SQL migrations in supabase/migrations/ have been applied (worlds + rooms.world_iid columns exist)
//   - 002_mint_iids.ts has been run (every room has an iid)
//
// IMPORTANT: this also mirrors `iid`, `worldX/Y/W/H` from `rooms.config`
// JSONB into the top-level columns so the WorldView's column-based query
// returns up-to-date values without re-parsing the blob.

import { createClient } from "@supabase/supabase-js";
import { ROOM_WIDTH, ROOM_HEIGHT } from "../../data/roomTypes";
import type { RoomConfig } from "../../data/roomTypes";

const DEFAULT_WORLD_SLUG = "main";
const DEFAULT_WORLD_NAME = "Main World";
const ROOM_GUTTER = 100; // px between rooms on the world map

// Where the starter rooms sit on the world map, as [column, row]. It mirrors
// the door plan in data/staticRooms.ts:
//   Shop, Gallery, Living Room, Professional Hub, The Lab
//                  The Archive, The Blog,         Memory Lane
const STARTER_GRID: Record<string, [number, number]> = {
  shop: [0, 0],
  gallery: [1, 0],
  home: [2, 0],
  professional: [3, 0],
  lab: [4, 0],
  archive: [2, 1],
  content: [3, 1],
  "memory-lane": [4, 1],
};
const OTHER_ROOMS_ROW = 2;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);
  console.log("Connected to Supabase:", url);

  // ── 1. Ensure the default world row exists ─────────────────
  const { data: existingWorld, error: worldQueryErr } = await supabase
    .from("worlds")
    .select("iid, id, name")
    .eq("id", DEFAULT_WORLD_SLUG)
    .maybeSingle();
  if (worldQueryErr) {
    console.error("Failed to query worlds:", worldQueryErr.message);
    process.exit(1);
  }

  let worldIid: string;
  if (existingWorld) {
    worldIid = existingWorld.iid as string;
    console.log(
      `Default world already exists: id="${existingWorld.id}", iid=${worldIid.slice(0, 8)}…`
    );
  } else {
    const { data: created, error: insertErr } = await supabase
      .from("worlds")
      .insert({
        id: DEFAULT_WORLD_SLUG,
        name: DEFAULT_WORLD_NAME,
        layout: "free",
        schema_version: 1,
      })
      .select("iid")
      .single();
    if (insertErr || !created) {
      console.error("Failed to create default world:", insertErr?.message);
      process.exit(1);
    }
    worldIid = created.iid as string;
    console.log(`Created default world: iid=${worldIid.slice(0, 8)}…`);
  }

  // ── 2. Read every room row ─────────────────────────────────
  const { data: rooms, error: roomsErr } = await supabase
    .from("rooms")
    .select("id, iid, world_iid, world_x, world_y, world_w, world_h, config")
    .order("id", { ascending: true });
  if (roomsErr) {
    console.error("Failed to read rooms:", roomsErr.message);
    process.exit(1);
  }
  if (!rooms?.length) {
    console.log("No rooms to migrate.");
    return;
  }

  // ── 3. Backfill columns + JSONB ────────────────────────────
  // Skips rooms already placed (world_iid set and coordinates present).
  let assignedNow = 0;
  let alreadyAssigned = 0;
  let columnIdx = 0;

  for (const row of rooms) {
    const cfg = row.config as RoomConfig | null;
    const roomIid = (row.iid as string | null) ?? cfg?.iid ?? null;
    if (!roomIid) {
      console.warn(
        `  ${row.id}: skipping — no iid (run 002_mint_iids.ts first)`
      );
      continue;
    }

    const alreadyInWorld =
      row.world_iid && row.world_iid !== null && row.world_x !== null;

    if (alreadyInWorld) {
      alreadyAssigned++;
    }

    // Default position for newly-assigned rooms: the starter grid, else the
    // next free cell of the row below it.
    const starterCell = STARTER_GRID[row.id as string];
    const cell: [number, number] = starterCell ?? [columnIdx, OTHER_ROOMS_ROW];
    const worldX = alreadyInWorld
      ? (row.world_x as number)
      : cell[0] * (ROOM_WIDTH + ROOM_GUTTER);
    const worldY = alreadyInWorld
      ? (row.world_y as number)
      : cell[1] * (ROOM_HEIGHT + ROOM_GUTTER);
    const worldW = (row.world_w as number) ?? ROOM_WIDTH;
    const worldH = (row.world_h as number) ?? ROOM_HEIGHT;

    if (!alreadyInWorld && !starterCell) columnIdx++;

    // Mirror everything into both columns AND JSONB so the WorldView's
    // column query and the editor's JSONB read agree.
    const updatedConfig: RoomConfig = {
      ...(cfg as RoomConfig),
      iid: roomIid,
      worldIid,
      worldX,
      worldY,
      worldW,
      worldH,
    };

    const { error: updateErr } = await supabase
      .from("rooms")
      .update({
        iid: roomIid,
        world_iid: worldIid,
        world_x: worldX,
        world_y: worldY,
        world_w: worldW,
        world_h: worldH,
        config: updatedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateErr) {
      console.error(`  ${row.id}: ${updateErr.message}`);
      continue;
    }

    if (!alreadyInWorld) assignedNow++;
    console.log(
      `  ${row.id}: pos=(${worldX}, ${worldY}) iid=${roomIid.slice(0, 8)}…${
        alreadyInWorld ? " (kept)" : " (assigned)"
      }`
    );
  }

  console.log(
    `\nDone. Assigned ${assignedNow} rooms; ${alreadyAssigned} already in world.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
