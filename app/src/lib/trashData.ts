// "Recently deleted": list / restore / purge the trash (deleted_items, migration
// 20261005000002_trash_and_atomic_ops). Rooms, worlds and landing pages are moved here by trash_room /
// trash_world / trash_landing_page instead of being deleted outright.
//
// Everything feature-detects the migration: table missing (42P01 / PGRST205) →
// `available: false`; function missing (PGRST202) → a plain "not set up" error.

import { getSupabaseClient } from "./supabase/client";
import { writeErrorFor } from "./writeGuard";
import type { WriteResult } from "./editorData";

export type DeletedKind = "room" | "world" | "page";

export interface DeletedItem {
  id: string;
  kind: DeletedKind;
  label: string;
  deletedAt: string;
}

export async function listDeletedItems(): Promise<{
  items: DeletedItem[];
  /** false when the trash table doesn't exist (migration 20261005000002_trash_and_atomic_ops not applied). */
  available: boolean;
  error?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) return { items: [], available: false, error: "Supabase not configured." };
  const { data, error } = await supabase
    .from("deleted_items")
    .select("id, kind, label, deleted_at")
    .order("deleted_at", { ascending: false });
  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      (/deleted_items/.test(error.message) && /not find|does not exist/i.test(error.message));
    return { items: [], available: !missing, error: missing ? undefined : error.message };
  }
  return {
    available: true,
    items: (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as DeletedKind,
      label: r.label as string,
      deletedAt: r.deleted_at as string,
    })),
  };
}

export type RestoreResult = WriteResult & {
  /** The restored room id / world id / page slug. */
  slug?: string;
  /** A room/page with that slug exists now: rename it first, then restore. */
  slugTaken?: string;
};

export async function restoreDeletedItem(
  id: string,
  kind?: DeletedKind
): Promise<RestoreResult> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const rpc = await supabase.rpc("restore_deleted_item", { p_id: id });
  if (!rpc.error) return { ok: true, slug: rpc.data as string };
  if (rpc.error.code === "23505") {
    const taken = (rpc.error.details as string | null) ?? "";
    const noun = kind === "page" ? "page" : kind === "world" ? "world" : "room";
    return {
      ok: false,
      slugTaken: taken || undefined,
      error: `A ${noun} called "${taken || "that"}" exists now. Rename it first, then restore.`,
    };
  }
  if (rpc.error.code === "P0002") {
    return { ok: false, code: "not_found", error: "That item is no longer in Recently deleted." };
  }
  if (rpc.error.code === "PGRST202") {
    return { ok: false, error: "Recently deleted isn't set up on this database yet (migration 20261005000002_trash_and_atomic_ops.sql)." };
  }
  return writeErrorFor(supabase, rpc.error);
}

export async function purgeDeletedItems(
  ids: string[]
): Promise<WriteResult & { purged?: number }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Supabase not configured." };
  const rpc = await supabase.rpc("purge_deleted_items", { p_ids: ids });
  if (!rpc.error) return { ok: true, purged: rpc.data as number };
  if (rpc.error.code === "PGRST202") {
    return { ok: false, error: "Recently deleted isn't set up on this database yet (migration 20261005000002_trash_and_atomic_ops.sql)." };
  }
  return writeErrorFor(supabase, rpc.error);
}
