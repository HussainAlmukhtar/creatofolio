// POST /api/admin/storage/delete — owner-only. Body { items: { bucket, path }[] }
// (max 200). Re-runs the reference scan server-side and refuses anything that
// is referenced now or younger than 48 h, so a stale list in the browser can't
// delete a file that has since become used. Returns { deleted, refused }.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/api/owner-auth";
import { deleteUnusedObjects, MAX_DELETE_ITEMS } from "@/lib/storageScan";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    items?: { bucket?: unknown; path?: unknown }[];
  } | null;
  const items = (body?.items ?? []).filter(
    (i): i is { bucket: string; path: string } =>
      typeof i?.bucket === "string" && typeof i?.path === "string"
  );
  if (items.length === 0) {
    return NextResponse.json({ error: "No items" }, { status: 400 });
  }
  if (items.length > MAX_DELETE_ITEMS) {
    return NextResponse.json(
      { error: `At most ${MAX_DELETE_ITEMS} files per request` },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(await deleteUnusedObjects(supabase, items));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
}
