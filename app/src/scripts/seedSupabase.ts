// Seed script — populates Supabase tables from static data.
//
// Usage: npm run db:seed   (from app/; runs this, then mints ids and
//        creates the main world)
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local, and the SQL migrations in supabase/migrations applied.
// Safe to re-run: it only adds rooms and pop-ups that are missing, and never
// overwrites one that exists (so your edits, and the ids that doors link by,
// are kept). Pass --force to reset the starter rooms and pop-ups to the
// built-in versions.

import { createClient } from "@supabase/supabase-js";
import { staticWorld } from "../data/staticRooms";
import { staticContent } from "../data/staticContent";

async function seed() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
    );
    console.error("Set these in .env.local or environment before running.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);
  console.log("Connected to Supabase:", url);

  // ─── Seed Rooms ───

  // Without --force an existing row is left alone.
  const ignoreDuplicates = !process.argv.includes("--force");
  let failed = 0;
  console.log("\nSeeding rooms...");
  for (const [id, config] of Object.entries(staticWorld.rooms)) {
    const { error } = await supabase.from("rooms").upsert(
      {
        id,
        config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id", ignoreDuplicates }
    );

    if (error) {
      failed++;
      console.error(`  Error seeding room "${id}":`, error.message);
    } else {
      console.log(`  Room: ${id} (${config.name})`);
    }
  }

  // ─── Seed Content ───

  console.log("\nSeeding content...");
  for (const [key, content] of Object.entries(staticContent)) {
    const [roomId, objectId] = key.split(":");
    const { error } = await supabase.from("object_content").upsert(
      {
        object_id: objectId,
        room_id: roomId,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "object_id,room_id", ignoreDuplicates }
    );

    if (error) {
      failed++;
      console.error(`  Error seeding content "${key}":`, error.message);
    } else {
      console.log(`  Pop-up: ${key} (${content.title})`);
    }
  }

  if (failed) {
    console.error(`\n${failed} row(s) failed. Have the migrations in supabase/migrations been applied?`);
    process.exit(1);
  }
  console.log(
    `\nDone: ${Object.keys(staticWorld.rooms).length} rooms and ${Object.keys(staticContent).length} pop-ups ` +
      (ignoreDuplicates ? "checked; any that already existed were left as they are." : "reset to the built-in versions.")
  );
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
