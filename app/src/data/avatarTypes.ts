// Avatar Configuration Types — schema v2 (human, slot-based, DB-backed catalog)
//
// History: v1 was a procedural character (bodyShape "ghost", per-feature enum picks
// for eyes/hat/glasses/outfit, drawn via Canvas2D paths in avatarLayers.ts).
// v2 is a layered human composed of PNG/SVG sprite parts pulled from the
// `avatar_assets` Supabase table — see supabase/migrations/20260515000001_*.
//
// One AvatarAsset row = one wearable variant for one slot. The chosen
// outfit is per-visitor and lives in localStorage; the catalog of available
// items is owner-curated and lives in Supabase.

export type Slot =
  | "body"
  | "eyes"
  | "hair"
  | "shirt"
  | "pants"
  | "shoes"
  | "accessory";

/** Z-order for compositing — bottom to top: skin first, then shoes, pants,
 * shirt, face, hair and anything held or worn on top.
 */
export const SLOT_Z_ORDER: readonly Slot[] = [
  "body",
  "shoes",
  "pants",
  "shirt",
  "eyes",
  "hair",
  "accessory",
] as const;

/** Which slots accept a per-visitor color tint via HSL hue-shift. */
export const TINTABLE_SLOTS: ReadonlySet<Slot> = new Set<Slot>([
  "body",
  "hair",
  "shirt",
  "pants",
  "shoes",
]);

/** A row from the `avatar_assets` table, normalized to camelCase. */
export interface AvatarAsset {
  id: string;
  slot: Slot;
  name: string;
  nameAr: string | null;
  spriteUrl: string;
  /** Optional left-facing variant; null = mirror spriteUrl horizontally. */
  spriteLeftUrl: string | null;
  tintable: boolean;
  zOffset: number;
  enabled: boolean;
  /** Klecks scene snapshot if drawn in-app; null = uploaded PNG (no re-edit). */
  scene: unknown | null;
}

// v5: the seed character is a layered human again (skin, face, hair, shirt,
// pants, shoes), every tintable slot recolourable from its palette. Bumping
// the version auto-discards older saved configs on load (see
// avatarStorage.loadAvatar).
export const AVATAR_SCHEMA_VERSION = 5 as const;

/**
 * The visitor's chosen outfit. Persisted to localStorage. References asset IDs
 * from the live Supabase catalog. If a referenced asset is deleted, the
 * renderer silently skips that slot (no crash, no broken state).
 */
export interface AvatarConfig {
  schemaVersion: typeof AVATAR_SCHEMA_VERSION;

  bodyAssetId: string;
  bodyTint: string | null; // hex; null = no recolor (original art)

  eyesAssetId: string;

  hairAssetId: string | null;
  hairTint: string | null;

  shirtAssetId: string | null;
  shirtTint: string | null;

  pantsAssetId: string | null;
  pantsTint: string | null;

  shoesAssetId: string | null;
  shoesTint: string | null;

  accessoryAssetId: string | null;
}

/** Animation state passed to draw functions each frame. */
export interface AnimState {
  direction: "left" | "right";
  isWalking: boolean;
  frame: number; // 0-3
}

/**
 * Default tint per slot. Used when an asset is tintable but the visitor
 * hasn't picked a color yet, or when resolving a fresh default config.
 * Each default is a member of SLOT_PALETTES for its slot.
 */
export const DEFAULT_TINTS: Record<Slot, string | null> = {
  body: null, // null = the untouched seed raster, no recolor pass
  eyes: null,
  hair: "#6B3E1F", // brown
  shirt: "#C05B3F", // terracotta
  pants: "#5B7290", // denim
  shoes: "#8A6A45", // leather brown
  accessory: null,
};

/**
 * Curated swatch palettes per tintable slot — the wardrobe deliberately
 * offers hand-picked colors (drawn from the site's earth/sunset family)
 * instead of a free color wheel, so every combination reads well in-game.
 * The recolorer remaps hue AND lightness, so pale-to-deep skin tones and
 * blonde-to-black hair all come from the same base sprites.
 */
const CLOTHING_PALETTE: readonly string[] = [
  "#C05B3F", // terracotta
  "#B65A4C", // sunset rose
  "#A34A2A", // rust
  "#C9A227", // gold
  "#7A8450", // olive
  "#4E7D74", // teal
  "#5B7290", // denim
  "#35506B", // navy
  "#7C6A80", // dusk purple
  "#8A4A5E", // plum
  "#4C4036", // charcoal
  "#E8DCC2", // cream
  "#8A6A45", // leather brown
];

export const SLOT_PALETTES: Partial<Record<Slot, readonly string[]>> = {
  // Skin tones (the first is the seed art's own colour).
  body: [
    "#F5D29D",
    "#FFE0B1",
    "#E7C38C",
    "#D9AE7A",
    "#BF9C66",
    "#AA8956",
    "#957544",
    "#836538",
    "#6B4F2C",
  ],
  hair: [
    "#33241B", // near-black
    "#4A2E1C", // dark brown
    "#6B3E1F", // brown
    "#8C5A2B", // chestnut
    "#B07A3C", // caramel
    "#C99A55", // dark blonde
    "#D9B36B", // blonde
    "#A34A2A", // auburn
    "#B65A4C", // copper rose
    "#7C6A80", // silver lavender
  ],
  shirt: CLOTHING_PALETTE,
  pants: CLOTHING_PALETTE,
  shoes: CLOTHING_PALETTE,
};

/**
 * Build a default AvatarConfig from the current catalog. Only body and eyes are
 * required — returns null if either is missing
 * (caller should treat that as "catalog not seeded yet"). Every optional
 * slot auto-equips its first enabled asset, which is how the shoes and
 * the default accessory go on by default.
 */
export function buildDefaultAvatarConfig(
  catalog: readonly AvatarAsset[]
): AvatarConfig | null {
  const firstOf = (slot: Slot): AvatarAsset | undefined =>
    catalog.find((a) => a.slot === slot && a.enabled);

  const body = firstOf("body");
  const eyes = firstOf("eyes");
  if (!body || !eyes) return null;

  const hair = firstOf("hair");
  const shirt = firstOf("shirt");
  const pants = firstOf("pants");
  const shoes = firstOf("shoes");
  const accessory = firstOf("accessory");

  return {
    schemaVersion: AVATAR_SCHEMA_VERSION,
    bodyAssetId: body.id,
    bodyTint: DEFAULT_TINTS.body,
    eyesAssetId: eyes.id,
    hairAssetId: hair?.id ?? null,
    hairTint: hair ? DEFAULT_TINTS.hair : null,
    shirtAssetId: shirt?.id ?? null,
    shirtTint: shirt ? DEFAULT_TINTS.shirt : null,
    pantsAssetId: pants?.id ?? null,
    pantsTint: pants ? DEFAULT_TINTS.pants : null,
    shoesAssetId: shoes?.id ?? null,
    shoesTint: shoes ? DEFAULT_TINTS.shoes : null,
    accessoryAssetId: accessory?.id ?? null,
  };
}

/** Resolve the asset ID stored in a config for a given slot. */
export function getSlotAssetId(
  config: AvatarConfig,
  slot: Slot
): string | null {
  switch (slot) {
    case "body":
      return config.bodyAssetId;
    case "eyes":
      return config.eyesAssetId;
    case "hair":
      return config.hairAssetId;
    case "shirt":
      return config.shirtAssetId;
    case "pants":
      return config.pantsAssetId;
    case "shoes":
      return config.shoesAssetId;
    case "accessory":
      return config.accessoryAssetId;
  }
}

/** Resolve the tint stored in a config for a given slot. */
export function getSlotTint(
  config: AvatarConfig,
  slot: Slot
): string | null {
  switch (slot) {
    case "body":
      return config.bodyTint;
    case "hair":
      return config.hairTint;
    case "shirt":
      return config.shirtTint;
    case "pants":
      return config.pantsTint;
    case "shoes":
      return config.shoesTint;
    default:
      return null;
  }
}

/** Immutable update of a single slot's asset ID. */
export function withSlotAssetId(
  config: AvatarConfig,
  slot: Slot,
  assetId: string | null
): AvatarConfig {
  switch (slot) {
    // body and eyes are required — a null pick is ignored.
    case "body":
      return assetId === null ? config : { ...config, bodyAssetId: assetId };
    case "eyes":
      return assetId === null ? config : { ...config, eyesAssetId: assetId };
    case "hair":
      return { ...config, hairAssetId: assetId };
    case "shirt":
      return { ...config, shirtAssetId: assetId };
    case "pants":
      return { ...config, pantsAssetId: assetId };
    case "shoes":
      return { ...config, shoesAssetId: assetId };
    case "accessory":
      return { ...config, accessoryAssetId: assetId };
  }
}

/** Immutable update of a single slot's tint. */
export function withSlotTint(
  config: AvatarConfig,
  slot: Slot,
  tint: string
): AvatarConfig {
  switch (slot) {
    case "body":
      return { ...config, bodyTint: tint };
    case "hair":
      return { ...config, hairTint: tint };
    case "shirt":
      return { ...config, shirtTint: tint };
    case "pants":
      return { ...config, pantsTint: tint };
    case "shoes":
      return { ...config, shoesTint: tint };
    default:
      return config;
  }
}
