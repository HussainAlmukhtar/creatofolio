// Avatar persistence — visitor's chosen outfit lives in localStorage so
// anonymous visitors can customize without auth. The catalog of available
// wardrobe items lives in Supabase (`avatar_assets` table).

import type { AvatarConfig } from "@/data/avatarTypes";
import { AVATAR_SCHEMA_VERSION } from "@/data/avatarTypes";

const STORAGE_KEY = "creatofolio-avatar";

export function saveAvatar(config: AvatarConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable (SSR, private mode, quota) — silently skip.
  }
}

/**
 * Load a previously saved avatar config. Returns null when:
 *  - Nothing is stored yet (first-time visitor)
 *  - The stored value is a legacy v1 config (older schema).
 *    These are intentionally discarded — there's no meaningful migration
 *    from the v1 shape to the layered wardrobe; falling back to
 *    the catalog-resolved default gives the visitor a clean slate.
 *  - The stored value is corrupt JSON.
 *
 * The caller is expected to fall back to `buildDefaultAvatarConfig(catalog)`
 * when this returns null.
 */
export function loadAvatar(): AvatarConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;

    // Legacy v1 config — discard. v1 had no schemaVersion field and
    // a top-level `bodyShape: "ghost"` enum.
    if (parsed.schemaVersion !== AVATAR_SCHEMA_VERSION) return null;

    return parsed as unknown as AvatarConfig;
  } catch {
    return null;
  }
}

export function deleteAvatar(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
