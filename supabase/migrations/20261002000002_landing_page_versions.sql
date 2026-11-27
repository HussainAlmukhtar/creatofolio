-- Migration — landing-page versions (Shopify-style draft / live switching).
--
-- Before: one config per page in website_pages. Saving a published page
-- pushed the edit straight to visitors, and the only "versions" were the
-- rolling backups in website_page_backups.
--
-- After: a page owns any number of named versions (website_page_versions).
-- The editor always edits ONE version; Save writes only that version's row.
-- Publish copies a version's config into website_pages.config and points
-- website_pages.live_version_id at it. website_pages.config therefore stays
-- "what visitors see", so the public read path (get_published_landing_page,
-- landing_content_is_public) is unchanged.
--
--   website_pages.live_version_id — the version last pushed live
--   website_pages.published_at    — when it was pushed (a live version whose
--                                   updated_at is newer has unpublished edits)
--   website_page_backups.version_id — which version a backup was taken from
--
-- Owner-only (drafts are editorial data, like website_page_backups).

CREATE TABLE IF NOT EXISTS website_page_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_iid       UUID NOT NULL,
  name           TEXT NOT NULL,
  config         JSONB NOT NULL,                         -- the DrawnPage
  schema_version INT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at   TIMESTAMPTZ                             -- last time this version went live
);

CREATE INDEX IF NOT EXISTS website_page_versions_page_iid_idx
  ON website_page_versions (page_iid, updated_at DESC);

ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS live_version_id UUID
    REFERENCES website_page_versions(id) ON DELETE SET NULL;
ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE website_page_backups
  ADD COLUMN IF NOT EXISTS version_id UUID;

ALTER TABLE website_page_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS website_page_versions_owner_all ON website_page_versions;
CREATE POLICY website_page_versions_owner_all ON website_page_versions FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Backfill: every existing page gets one version holding its current config.
-- Published pages' version becomes the live one.
INSERT INTO website_page_versions (page_iid, name, config, schema_version, created_at, updated_at, published_at)
SELECT
  p.iid,
  CASE WHEN p.status = 'published' THEN 'Live version' ELSE 'Draft' END,
  p.config,
  p.schema_version,
  p.updated_at,
  p.updated_at,
  CASE WHEN p.status = 'published' THEN p.updated_at END
FROM website_pages p
WHERE NOT EXISTS (SELECT 1 FROM website_page_versions v WHERE v.page_iid = p.iid);

UPDATE website_pages p
SET live_version_id = v.id,
    published_at    = p.updated_at
FROM website_page_versions v
WHERE v.page_iid = p.iid
  AND p.status = 'published'
  AND p.live_version_id IS NULL;
