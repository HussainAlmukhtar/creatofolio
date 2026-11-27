-- Migration — storage bucket for uploaded site fonts.
--
-- SiteConfig.typography.customFonts lets the owner upload their own font
-- files (.woff2/.woff/.ttf/.otf, e.g. a handwriting font made from their own
-- lettering). The landing page loads them with @font-face by public URL, so
-- the bucket is public-read; no metadata table — the URL lives in the site
-- config JSONB. Same convention as content-videos: public bucket, no anon
-- SELECT policy on storage.objects (that would also allow listing), owner-
-- only writes. The editor uploads with the browser client
-- (lib/landingEditorData.ts uploadSiteFont), so the owner policy is what
-- gates it.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'site-fonts',
    'site-fonts',
    true,
    8388608,
    ARRAY['font/woff2', 'font/woff', 'font/ttf', 'font/otf']
  )
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_owner_write_site_fonts ON storage.objects;
CREATE POLICY storage_owner_write_site_fonts ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'site-fonts' AND public.is_owner())
  WITH CHECK (bucket_id = 'site-fonts' AND public.is_owner());
