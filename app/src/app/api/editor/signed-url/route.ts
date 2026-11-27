// API: short-lived signed URLs for private Storage buckets.
//
// Two layers of gating:
//   1. Bucket allowlist — only private editor buckets we actually serve via
//      signed URL. Unknown buckets are rejected with 400 so a bad request
//      can't trigger an unintended download path.
//   2. Owner check — `/api/editor/*` routes aren't gated by `proxy.ts` (the
//      proxy only redirects `/admin/*`), so we check the cookie session
//      against OWNER_EMAIL here before issuing a URL. Service-role client is
//      used only for the actual `createSignedUrl` call after the check.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/api/owner-auth";

const ALLOWED_BUCKETS = new Set([
  "room-bg-originals",
  "drawing-scenes",
]);

export async function POST(request: NextRequest) {
  const adminClient = getSupabaseServerClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { bucket, path } = await request.json();

  if (!bucket || !path) {
    return NextResponse.json(
      { error: "bucket and path are required" },
      { status: 400 }
    );
  }

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json(
      { error: `bucket '${bucket}' not allowed` },
      { status: 400 }
    );
  }

  const { data, error } = await adminClient.storage
    .from(bucket)
    .createSignedUrl(path, 600);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create signed URL" },
      { status: 500 }
    );
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
