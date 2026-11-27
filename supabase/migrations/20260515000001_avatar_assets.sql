-- Migration — avatar_assets catalog + storage bucket for the human character builder.
--
-- Background: the original character builder hardcoded its preset
-- catalog in TypeScript (avatarPresets.ts) and its drawing functions in
-- avatarLayers.ts, so the owner could not add a new hairstyle / shirt / etc.
-- without a code change + redeploy. This rework moves the catalog to the
-- database so the owner can manage wardrobe items from /admin/wardrobe.
--
-- A row in avatar_assets is one wearable variant for one slot. The PNG lives
-- in the public `avatar-assets` storage bucket; sprite_url is the public URL.
-- If the item was drawn inside the in-app Klecks studio, the editor scene
-- snapshot is preserved on `scene` so the owner can re-open and refine it.

-- ─── Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.avatar_assets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slot        text        NOT NULL CHECK (slot IN
                ('body','eyes','hair','shirt','pants','shoes','accessory')),
  name        text        NOT NULL,
  name_ar     text,
  sprite_url  text        NOT NULL,
  sprite_left_url text,                -- optional left-facing variant; null = mirror sprite_url
  tintable    boolean     NOT NULL DEFAULT false,
  z_offset    integer     NOT NULL DEFAULT 0,
  enabled     boolean     NOT NULL DEFAULT true,
  scene       jsonb,                   -- Klecks scene snapshot for re-edit; null = uploaded PNG
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_assets_slot_idx
  ON public.avatar_assets (slot)
  WHERE enabled = true;

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.avatar_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avatar_assets_anon_read   ON public.avatar_assets;
DROP POLICY IF EXISTS avatar_assets_owner_write ON public.avatar_assets;

-- Anyone (including unauthenticated visitors) reads enabled rows so the
-- runtime catalog hook works without auth.
CREATE POLICY avatar_assets_anon_read ON public.avatar_assets
  FOR SELECT TO anon, authenticated
  USING (enabled = true);

-- Only the owner can insert/update/delete (matches the is_owner() pattern
-- used by every other editor table).
CREATE POLICY avatar_assets_owner_write ON public.avatar_assets
  FOR ALL TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- ─── Storage bucket: avatar-assets (public, owner-write) ─────
-- Players fetch PNGs directly via public URLs. Owner uploads via the same
-- /api/editor/upload route used for room sprites (already owner-gated by
-- requireOwner() in lib/api/owner-auth.ts).
INSERT INTO storage.buckets (id, name, public)
  VALUES ('avatar-assets', 'avatar-assets', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_owner_write_avatar_assets ON storage.objects;
CREATE POLICY storage_owner_write_avatar_assets ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'avatar-assets' AND public.is_owner())
  WITH CHECK (bucket_id = 'avatar-assets' AND public.is_owner());
