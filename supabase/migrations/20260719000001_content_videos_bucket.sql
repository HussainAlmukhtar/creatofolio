-- Migration — storage bucket for self-hosted reel uploads (video/image).
--
-- applies).
--
-- Background: the "reel" ObjectContent type (contentTypes.ts) lets the
-- owner mix platform embeds (Instagram/TikTok/YouTube) with self-hosted
-- clips/images in the same showcase. Embeds point at the platform's own
-- URL; self-hosted items need somewhere to live. No metadata table is
-- needed — the uploaded file's public URL is stored directly on the
-- ReelItem inside object_content's JSONB, same as sprite_url elsewhere.
--
-- Follows the avatar-assets bucket convention (20260515000001_avatar_assets.sql):
-- public bucket for anonymous GET-by-URL, no explicit anon SELECT policy on
-- storage.objects (that would additionally permit *listing* the bucket,
-- flagged by the Supabase linter — see get_advisors "public_bucket_allows_listing"
-- on the older content-images/room-backgrounds/sprites buckets). Owner
-- uploads via the existing /api/editor/upload route (already owner-gated).

INSERT INTO storage.buckets (id, name, public)
  VALUES ('content-videos', 'content-videos', true)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_owner_write_content_videos ON storage.objects;
CREATE POLICY storage_owner_write_content_videos ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'content-videos' AND public.is_owner())
  WITH CHECK (bucket_id = 'content-videos' AND public.is_owner());
