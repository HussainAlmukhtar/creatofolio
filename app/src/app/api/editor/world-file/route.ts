// API: External per-room JSON files.
//
// GET  ?worldSlug=main                 → read every room file for a world.
// POST { worldSlug, roomSlug, config } → write one room file (pretty-printed).
//
// Files live at: <repo>/app/world/<worldSlug>/rooms/<roomSlug>.json
//
// Slug validation guards against path traversal — only [a-z0-9_-]+ allowed.
// File writes are atomic-ish (mkdir -p the dir; writeFile; let fs handle the
// rename). No git interaction — the user commits manually.

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getOwnerUser } from "@/lib/api/owner-auth";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Files written inside the container are wiped on every deploy, so writing is
 *  a local-dev feature unless explicitly allowed. */
function filesWritable(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_WORLD_FILES === "1";
}

function filesReadOnlyResponse() {
  return NextResponse.json(
    { error: "External room files only work in local development." },
    { status: 501 }
  );
}

function isValidSlug(s: unknown): s is string {
  return typeof s === "string" && SLUG_RE.test(s);
}

/**
 * Resolve the on-disk directory for a world's room files. Always lives under
 * the project's `app/world/` so we can confidently reject anything that
 * tries to escape it. `process.cwd()` during `next dev` / `next start` is
 * the `app/` folder, so `app/world/` resolves correctly here.
 */
function worldDir(worldSlug: string): string {
  // path.resolve normalises any sneaky `..` even though we already block them
  // with SLUG_RE — defense in depth.
  return path.resolve(process.cwd(), "world", worldSlug, "rooms");
}

export async function GET(request: NextRequest) {
  const worldSlug = request.nextUrl.searchParams.get("worldSlug");
  if (!isValidSlug(worldSlug)) {
    return NextResponse.json({ error: "Invalid worldSlug" }, { status: 400 });
  }

  const dir = worldDir(worldSlug);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Directory doesn't exist yet — empty world.
    return NextResponse.json({ rooms: {} });
  }

  const rooms: Record<string, unknown> = {};
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const slug = entry.slice(0, -5);
    if (!isValidSlug(slug)) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf8");
      rooms[slug] = JSON.parse(raw);
    } catch {
      // Skip unreadable / malformed files — don't fail the whole batch.
    }
  }

  return NextResponse.json({ rooms });
}

/**
 * PATCH — atomically rename a room file from `<oldSlug>.json` to
 * `<newSlug>.json`. Used for slug rename safety.
 *
 * Body: { worldSlug, oldRoomSlug, newRoomSlug }
 *
 * Returns 200 with `{ ok: true }` on success, 404 if the source file
 * doesn't exist (treated as success — the rename is idempotent and the
 * caller may have created the room without ever flushing it to disk).
 */
export async function PATCH(request: NextRequest) {
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!filesWritable()) return filesReadOnlyResponse();

  const body = (await request.json().catch(() => null)) as {
    worldSlug?: unknown;
    oldRoomSlug?: unknown;
    newRoomSlug?: unknown;
  } | null;

  if (
    !body ||
    !isValidSlug(body.worldSlug) ||
    !isValidSlug(body.oldRoomSlug) ||
    !isValidSlug(body.newRoomSlug)
  ) {
    return NextResponse.json(
      { error: "Invalid worldSlug or roomSlug" },
      { status: 400 }
    );
  }

  const dir = worldDir(body.worldSlug);
  const oldPath = path.join(dir, `${body.oldRoomSlug}.json`);
  const newPath = path.join(dir, `${body.newRoomSlug}.json`);

  // Source missing — treat as success (no file to move).
  try {
    await fs.access(oldPath);
  } catch {
    return NextResponse.json({ ok: true, skipped: "source-missing" });
  }

  // Refuse to clobber an existing destination — that would silently lose data.
  try {
    await fs.access(newPath);
    return NextResponse.json(
      { error: `Destination ${body.newRoomSlug}.json already exists` },
      { status: 409 }
    );
  } catch {
    /* good — destination is free */
  }

  await fs.rename(oldPath, newPath);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!filesWritable()) return filesReadOnlyResponse();

  const body = (await request.json().catch(() => null)) as {
    worldSlug?: unknown;
    roomSlug?: unknown;
    config?: unknown;
  } | null;

  if (!body || !isValidSlug(body.worldSlug) || !isValidSlug(body.roomSlug)) {
    return NextResponse.json(
      { error: "Invalid worldSlug or roomSlug" },
      { status: 400 }
    );
  }
  if (!body.config || typeof body.config !== "object") {
    return NextResponse.json({ error: "Missing config" }, { status: 400 });
  }

  const dir = worldDir(body.worldSlug);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${body.roomSlug}.json`);
  const json = JSON.stringify(body.config, null, 2);
  await fs.writeFile(filePath, json + "\n", "utf8");

  return NextResponse.json({ ok: true, path: filePath });
}
