// POST /api/admin/storage/sizes — owner-only. Body { urls: string[] } (max 200).
// Returns { sizes: { [url]: bytes | null } }.
//
// The browser can't read Content-Length / Content-Range from the storage
// origin (no CORS exposure), so the weight indicator asks here. Each URL is
// mapped to bucket/path with the storageRefs normaliser; anything that isn't
// one of OUR buckets is answered null WITHOUT any outbound request. Sizes come
// from Storage metadata through the service-role client.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/api/owner-auth";
import { lookupSizes } from "@/lib/storageSizes";

export const dynamic = "force-dynamic";
const MAX_URLS = 200;

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { urls?: unknown } | null;
  const urls = Array.isArray(body?.urls)
    ? body.urls.filter((u): u is string => typeof u === "string")
    : [];
  if (urls.length === 0 || urls.length > MAX_URLS) {
    return NextResponse.json({ error: `Send 1-${MAX_URLS} urls` }, { status: 400 });
  }
  return NextResponse.json({ sizes: await lookupSizes(supabase, urls) });
}
