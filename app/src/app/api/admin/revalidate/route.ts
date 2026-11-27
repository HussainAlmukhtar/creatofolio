// Owner-only on-demand revalidation, so Publish / "Save & go live" show up on
// the public site at once instead of after the 60 s ISR window (which stays as
// the safety net).
//
// POST { paths: string[], layout?: boolean }
//   paths:  "/", "/<slug>" (landing slug rules) or "/sitemap.xml" — anything
//           else is rejected.
//   layout: also revalidate the root layout (site settings affect every page).

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getOwnerUser } from "@/lib/api/owner-auth";

export const dynamic = "force-dynamic";

const SLUG_PATH_RE = /^\/[a-z0-9][a-z0-9_-]*$/;

function isAllowedPath(p: unknown): p is string {
  return (
    typeof p === "string" &&
    p.length <= 120 &&
    (p === "/" || p === "/sitemap.xml" || SLUG_PATH_RE.test(p))
  );
}

export async function POST(request: NextRequest) {
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    paths?: unknown;
    layout?: unknown;
  } | null;
  const paths = body?.paths;
  if (!Array.isArray(paths) || paths.length > 10 || !paths.every(isAllowedPath)) {
    return NextResponse.json({ error: "Invalid paths" }, { status: 400 });
  }

  for (const p of new Set(paths)) revalidatePath(p);
  if (body?.layout === true) revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}
