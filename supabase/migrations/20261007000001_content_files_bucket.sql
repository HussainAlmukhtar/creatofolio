-- Migration — storage bucket for pop-up downloads and sound files.
--
-- The pop-up "File download" and "Audio" blocks link to
-- files the owner uploads from the media library's Audio and Files tabs. Same
-- convention as content-videos / site-fonts: a PUBLIC bucket (visitors fetch by
-- URL), no anon SELECT policy on storage.objects (that would also allow
-- listing), owner-only writes.
--
-- Security:
--   - allowed_mime_types is an explicit allowlist: PDF + common audio types.
--     The bucket list can't say "audio/*", so each is named. Never text/html,
--     image/svg+xml or anything executable. /api/editor/upload checks the same
--     list (by extension AND reported type) before the bucket sees the file.
--   - 25 MB per file (matches the upload route's cap).
--   - The write policy is the usual public.is_owner() (2FA-aware once
--     20261005000004_owner_mfa.sql is applied); no raw email check. is_owner(),
--     owner_mfa_satisfied() and every existing policy are untouched.
--
-- Additive only. Rollback:
--   DROP POLICY IF EXISTS storage_owner_write_content_files ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'content-files';  -- only while empty

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'content-files',
    'content-files',
    true,
    26214400,
    ARRAY[
      'application/pdf',
      'audio/mpeg',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
      'audio/wav',
      'audio/webm',
      'audio/flac'
    ]
  )
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_owner_write_content_files ON storage.objects;
CREATE POLICY storage_owner_write_content_files ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'content-files' AND public.is_owner())
  WITH CHECK (bucket_id = 'content-files' AND public.is_owner());
