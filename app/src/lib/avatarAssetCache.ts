// Avatar Asset Cache
//
// Browser-side helpers for the v2 (human) avatar pipeline:
//   - fetchAvatarCatalog()  — reads the live `avatar_assets` table
//   - loadAvatarImage(url)  — memoized HTMLImageElement loader
//   - preloadAvatarImages() — kick off parallel fetches for a config's slots
//
// The compositor calls loadAvatarImage() for every layer on every sheet
// rebuild; memoization keeps re-tinting cheap (no network on color picker
// drag — the source PNG is already in memory, only the off-screen canvas is
// recomputed).

import { getSupabaseClient } from "@/lib/supabase/client";
import { resolveStorageUrl } from "@/lib/storageUrl";
import type {
  AvatarAsset,
  AvatarConfig,
  Slot,
} from "@/data/avatarTypes";
import { SLOT_Z_ORDER, getSlotAssetId } from "@/data/avatarTypes";

// ─── Image cache ─────────────────────────────────────────────────────

const imgCache = new Map<string, Promise<HTMLImageElement>>();

/**
 * Load and cache an HTMLImageElement for the given URL. Subsequent calls
 * with the same URL return the same Image instance (or its in-flight load
 * promise) — drawImage on the same Image is fine, browsers cache the
 * decoded bitmap.
 *
 * Sets `crossOrigin = "anonymous"` so the loaded image can be drawn into a
 * canvas and read via getImageData() (required for HSL hue-shift tinting).
 * Same-origin URLs (/avatar/seed/*) and Supabase public buckets both reply
 * with `Access-Control-Allow-Origin: *`.
 */
export function loadAvatarImage(url: string): Promise<HTMLImageElement> {
  const cached = imgCache.get(url);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load avatar asset: ${url}`));
    img.src = url;
  });

  imgCache.set(url, promise);
  return promise;
}

/** Drop a URL from the cache — used after the owner replaces an asset. */
export function invalidateAvatarImage(url: string): void {
  imgCache.delete(url);
}

// ─── Catalog fetch ───────────────────────────────────────────────────

/**
 * Pull every enabled `avatar_assets` row from Supabase, normalized to the
 * AvatarAsset shape. Returns [] when Supabase isn't configured or the
 * query fails — callers should treat that as "no wardrobe available".
 */
export async function fetchAvatarCatalog(): Promise<AvatarAsset[]> {
  // Dev-only escape hatch: `?simulate-empty-catalog` forces the empty-DB
  // code path so the seed-wardrobe fallback boot stays verifiable in the
  // browser (no test framework in this repo) without touching the live DB.
  if (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("simulate-empty-catalog")
  ) {
    return [];
  }

  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("avatar_assets")
    .select(
      "id, slot, name, name_ar, sprite_url, sprite_left_url, tintable, z_offset, enabled, scene"
    )
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map(
    (r): AvatarAsset => ({
      id: r.id as string,
      slot: r.slot as Slot,
      name: r.name as string,
      nameAr: (r.name_ar as string | null) ?? null,
      spriteUrl: resolveStorageUrl(r.sprite_url as string),
      spriteLeftUrl: (r.sprite_left_url as string | null) ?? null,
      tintable: !!r.tintable,
      zOffset: (r.z_offset as number | null) ?? 0,
      enabled: !!r.enabled,
      scene: r.scene ?? null,
    })
  );
}

// ─── Preload helper ──────────────────────────────────────────────────

/**
 * Kick off parallel image loads for every asset referenced by `config`.
 * Resolves once all are in cache (or rejects if any fail). The compositor
 * also lazy-loads via loadAvatarImage(); this function exists so the scene
 * can `await` once at boot rather than racing the first render.
 */
export async function preloadAvatarImages(
  config: AvatarConfig,
  catalog: readonly AvatarAsset[]
): Promise<void> {
  const byId = new Map(catalog.map((a) => [a.id, a]));
  const urls = new Set<string>();

  for (const slot of SLOT_Z_ORDER) {
    const id = getSlotAssetId(config, slot);
    if (!id) continue;
    const asset = byId.get(id);
    if (!asset) continue;
    urls.add(asset.spriteUrl);
    if (asset.spriteLeftUrl) urls.add(asset.spriteLeftUrl);
  }

  await Promise.all(
    Array.from(urls).map((url) =>
      loadAvatarImage(url).catch(() => null /* don't block on one bad URL */)
    )
  );
}
