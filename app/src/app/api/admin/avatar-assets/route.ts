// API: Owner-gated CRUD on the avatar_assets catalog.
//
// Reads are public (anon SELECT via RLS) so the runtime catalog hook works
// for visitors. Writes are owner-only — gated here by getOwnerUser() in
// addition to the table-level is_owner() RLS, since this route uses the
// service-role client which bypasses RLS.
//
// Routes:
//   POST   /api/admin/avatar-assets       — create
//   PATCH  /api/admin/avatar-assets       — update by id
//   DELETE /api/admin/avatar-assets?id=…  — delete by id

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerUser } from "@/lib/api/owner-auth";

const ALLOWED_SLOTS = new Set([
  "body",
  "eyes",
  "hair",
  "shirt",
  "pants",
  "shoes",
  "accessory",
]);

interface CreateBody {
  slot?: string;
  name?: string;
  name_ar?: string | null;
  sprite_url?: string;
  sprite_left_url?: string | null;
  tintable?: boolean;
  z_offset?: number;
  enabled?: boolean;
  scene?: unknown | null;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CreateBody;
  if (!body.slot || !ALLOWED_SLOTS.has(body.slot)) {
    return NextResponse.json(
      { error: "Missing or invalid slot" },
      { status: 400 }
    );
  }
  if (!body.name || !body.sprite_url) {
    return NextResponse.json(
      { error: "name and sprite_url are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("avatar_assets")
    .insert({
      slot: body.slot,
      name: body.name,
      name_ar: body.name_ar ?? null,
      sprite_url: body.sprite_url,
      sprite_left_url: body.sprite_left_url ?? null,
      tintable: !!body.tintable,
      z_offset: body.z_offset ?? 0,
      enabled: body.enabled ?? true,
      scene: body.scene ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ asset: data });
}

interface PatchBody extends CreateBody {
  id?: string;
}

export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as PatchBody;
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (body.slot !== undefined && !ALLOWED_SLOTS.has(body.slot)) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.slot !== undefined) update.slot = body.slot;
  if (body.name !== undefined) update.name = body.name;
  if (body.name_ar !== undefined) update.name_ar = body.name_ar;
  if (body.sprite_url !== undefined) update.sprite_url = body.sprite_url;
  if (body.sprite_left_url !== undefined)
    update.sprite_left_url = body.sprite_left_url;
  if (body.tintable !== undefined) update.tintable = body.tintable;
  if (body.z_offset !== undefined) update.z_offset = body.z_offset;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.scene !== undefined) update.scene = body.scene;

  const { data, error } = await supabase
    .from("avatar_assets")
    .update(update)
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ asset: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("avatar_assets")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// GET — also allow a trivial enumeration so the admin page can avoid
// going through the anon-key client (useful when the admin wants to
// see disabled rows, which the anon SELECT policy filters out).
export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }
  if (!(await getOwnerUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("avatar_assets")
    .select("*")
    .order("slot", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ assets: data ?? [] });
}
