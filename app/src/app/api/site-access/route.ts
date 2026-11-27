// Unlock for the maintenance / password page (see src/lib/siteAccess.ts).
//
// POST { password } → if it matches SITE_PASSWORD, sets the httpOnly
// site-access cookie (a hash derived from the password, not the password)
// for 30 days. Wrong answers are rate-limited per IP (in-memory, per server
// instance: a speed bump against guessing scripts).
// GET → { passwordConfigured } for the editor's Site settings.

import { NextResponse, type NextRequest } from "next/server";
import { SITE_ACCESS_COOKIE, accessToken, safeEqual, sitePasswordConfigured } from "@/lib/siteAccess";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 8;
const tries = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  tries.set(ip, recent);
  if (tries.size > 5000) for (const k of Array.from(tries.keys()).slice(0, 1000)) tries.delete(k);
  return recent.length > MAX_TRIES;
}

export async function GET() {
  return NextResponse.json({ passwordConfigured: sitePasswordConfigured() });
}

export async function POST(req: NextRequest) {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return NextResponse.json({ error: "This site has no password set." }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (limited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const given = typeof (body as { password?: unknown })?.password === "string" ? (body as { password: string }).password : "";
  if (!given || given.length > 200 || !safeEqual(given, pw)) {
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_ACCESS_COOKIE, (await accessToken())!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
