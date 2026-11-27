// One-shot migration: mint stable iids on every room, object, and entry
// point in the `rooms` table, then resolve `targetRoomIid` /
// `targetEntryPointIid` on every door.
//
// Usage:  npm run db:seed   (from app/; it runs this after seedSupabase.ts)
// Env:    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Idempotent — re-running on an already-migrated DB is a no-op (existing iids
// are preserved). The load-time mint in `data/migrations.ts` covers any rows
// this script misses; this script is for proactive bulk migration + a clean
// per-room report.
//
// IMPORTANT: this mints fresh v4 UUIDs (non-deterministic). If you ever need
// to re-run on a backup and get the same iids, switch to uuidv5 with a
// stable namespace (`uuidv5(`${roomId}/${objectId}`, NAMESPACE_DNS)`).

import { createClient } from "@supabase/supabase-js";
import { migrateRoom } from "../../data/migrations";
import type { RoomConfig } from "../../data/roomTypes";

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

  const { data: rows, error } = await supabase
    .from("rooms")
    .select("id, iid, config");
  if (error) {
    console.error("Failed to read rooms:", error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log("No rooms to migrate.");
    return;
  }

  // Pass 1: mint iids on every room/object/entry-point.
  // migrateRoom() runs the full migration chain — it's how the editor
  // self-heals on read, so applying it server-side just persists what would
  // happen anyway on first load.
  const upgraded: Record<string, RoomConfig> = {};
  for (const row of rows) {
    const before = row.config as RoomConfig;
    // A room that was re-seeded keeps the iid already stored in its column,
    // so doors in other rooms that link to it by iid stay valid.
    if (row.iid && !before.iid) before.iid = row.iid as string;
    const after = migrateRoom(before);
    upgraded[row.id] = after;
    const objCount = after.objects?.length ?? 0;
    const epCount = after.entryPoints?.length ?? 0;
    console.log(
      `  ${row.id}: room iid ${after.iid?.slice(0, 8)}…, ${objCount} objects, ${epCount} entry points`
    );
  }

  // Pass 2: resolve targetRoomId/targetEntryPointId slugs to iids on every
  // door. Skipped (and warned) for any door whose target can't be resolved —
  // the IssuesPanel will surface those.
  let resolved = 0;
  let unresolved = 0;
  for (const cfg of Object.values(upgraded)) {
    if (!cfg.objects?.length) continue;
    for (const obj of cfg.objects) {
      if (obj.type !== "door") continue;
      // Only fill iids that are missing — never overwrite an existing iid.
      if (!obj.targetRoomIid && obj.targetRoomId) {
        const target = upgraded[obj.targetRoomId];
        if (target?.iid) {
          obj.targetRoomIid = target.iid;
          resolved++;
        } else {
          console.warn(
            `  ${cfg.id} → door "${obj.id}" references unknown room "${obj.targetRoomId}"`
          );
          unresolved++;
        }
      }
      if (!obj.targetEntryPointIid && obj.targetEntryPointId) {
        const targetIid = obj.targetRoomIid;
        const target = targetIid
          ? Object.values(upgraded).find((r) => r.iid === targetIid)
          : obj.targetRoomId
            ? upgraded[obj.targetRoomId]
            : null;
        const ep = target?.entryPoints?.find(
          (e) => e.id === obj.targetEntryPointId
        );
        if (ep?.iid) {
          obj.targetEntryPointIid = ep.iid;
        }
      }
    }
  }
  console.log(`\nResolved ${resolved} door target iids; ${unresolved} unresolved.`);

  // Pass 3: write back. Per-row upsert so a single failure doesn't roll back
  // everything else.
  console.log("\nWriting upgraded configs…");
  let writes = 0;
  let writeErrors = 0;
  for (const [id, config] of Object.entries(upgraded)) {
    const { error: writeErr } = await supabase
      .from("rooms")
      .upsert(
        { id, config, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (writeErr) {
      console.error(`  ${id}: ${writeErr.message}`);
      writeErrors++;
    } else {
      writes++;
    }
  }
  console.log(`\nWrote ${writes} rooms; ${writeErrors} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
