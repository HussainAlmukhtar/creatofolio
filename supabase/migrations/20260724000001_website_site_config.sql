-- Migration — site-wide config (announcement bar, header/nav, footer).
--
-- Background: the announcement bar / header nav / footer are chrome that
-- wraps EVERY public page, edited once rather than per-page like
-- website_pages. A singleton row (fixed id) rather than a new column on some
-- existing table, because it isn't scoped to any one page.
--
-- Owner-gated writes (is_owner() from 20260501000001), same shape as
-- website_pages: anon can read (the runtime needs it on every route), only
-- the owner writes.

CREATE TABLE IF NOT EXISTS website_site_config (
  id             TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'), -- singleton row
  config         JSONB NOT NULL,                     -- the SiteConfig
  schema_version INT NOT NULL DEFAULT 1,              -- mirror col; app stamps config.schemaVersion on save
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE website_site_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS website_site_config_anon_read   ON website_site_config;
DROP POLICY IF EXISTS website_site_config_owner_write  ON website_site_config;
CREATE POLICY website_site_config_anon_read   ON website_site_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY website_site_config_owner_write ON website_site_config FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());
