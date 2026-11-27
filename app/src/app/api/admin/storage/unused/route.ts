// GET /api/admin/storage/unused — owner-only. Lists every Storage object that
// no row references (and is older than 48 h), with per-bucket totals. Read-only.

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/api/owner-auth";
import { scanStorage } from "@/lib/storageScan";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await scanStorage(supabase));
  } catch (e) {
    // A failed read must never look like "nothing is used": report and stop.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Scan failed" },
      { status: 500 }
    );
  }
}
