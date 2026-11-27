-- Migration — Landing-page CMS tables (website_pages + friends).
--
-- Background: the landing page (src/components/landing/) has been rendering
-- from a hardcoded defaultLandingPage (src/data/landingConfig.ts). This
-- migration backs it with Supabase using the DrawnPage shape already defined
-- in src/data/landingTypes.ts, so the owner can edit pages from a new admin
-- surface (/admin/landing-editor) instead of hand-editing TypeScript.
--
-- Four tables, all owner-gated writes (is_owner() from 20260501000001):
--   website_pages           — one DrawnPage per row, keyed by slug; a status
--                             column gates draft-vs-published for the public
--                             loader (editorial gate, not a security boundary —
--                             anon can still SELECT drafts, only the owner writes)
--   website_page_content    — rich content attached to a page's "button" assets,
--                             reusing the ObjectContent JSONB shape. A SEPARATE
--                             table from object_content by design, so game rooms
--                             and landing pages can never break each other.
--   website_section_templates — reusable DrawnSection presets (mirrors the
--                             object_templates convention one level up), so
--                             building page N+1 doesn't start from scratch.
--   website_page_backups    — rolling per-page version history + named/pinned
--                             versions (mirrors room_backups exactly). Pruned in
--                             application code (saveLandingPage), not a trigger.
--
-- No new storage buckets: landing art reuses sprites/content-images and the
-- existing drawing-scenes (Klecks) flow.

-- ─── tables ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_pages (
  id             TEXT PRIMARY KEY,                       -- slug: "home", "about", ...
  iid            UUID UNIQUE NOT NULL,
  config         JSONB NOT NULL,                         -- the DrawnPage
  schema_version INT NOT NULL DEFAULT 1,                 -- mirror col; app stamps config.schemaVersion on save
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS website_page_content (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug      TEXT NOT NULL,
  asset_iid      UUID NOT NULL,
  content        JSONB NOT NULL,                         -- ObjectContent shape reused as-is
  schema_version INT NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_slug, asset_iid)
);

CREATE INDEX IF NOT EXISTS website_page_content_page_idx
  ON website_page_content (page_slug);

CREATE TABLE IF NOT EXISTS website_section_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  name_ar       TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  section       JSONB NOT NULL,                          -- full DrawnSection; iids re-minted on drop
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS website_section_templates_tags_gin
  ON website_section_templates USING gin (tags);

CREATE TABLE IF NOT EXISTS website_page_backups (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_iid  UUID NOT NULL,
  config    JSONB NOT NULL,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_by  TEXT,
  label     TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS website_page_backups_page_iid_idx
  ON website_page_backups (page_iid, saved_at DESC);
CREATE INDEX IF NOT EXISTS website_page_backups_pinned_idx
  ON website_page_backups (page_iid, is_pinned, saved_at DESC);

-- ─── RLS ───────────────────────────────────────────────────────
ALTER TABLE website_pages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_page_content      ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_section_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_page_backups      ENABLE ROW LEVEL SECURITY;

-- public-read / owner-write (runtime renders published pages + their content)
DROP POLICY IF EXISTS website_pages_anon_read   ON website_pages;
DROP POLICY IF EXISTS website_pages_owner_write  ON website_pages;
CREATE POLICY website_pages_anon_read   ON website_pages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY website_pages_owner_write ON website_pages FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS website_page_content_anon_read   ON website_page_content;
DROP POLICY IF EXISTS website_page_content_owner_write  ON website_page_content;
CREATE POLICY website_page_content_anon_read   ON website_page_content FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY website_page_content_owner_write ON website_page_content FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS website_section_templates_anon_read   ON website_section_templates;
DROP POLICY IF EXISTS website_section_templates_owner_write  ON website_section_templates;
CREATE POLICY website_section_templates_anon_read   ON website_section_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY website_section_templates_owner_write ON website_section_templates FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

-- owner-only both (editorial history, not public runtime data — like room_backups)
DROP POLICY IF EXISTS website_page_backups_owner_all ON website_page_backups;
CREATE POLICY website_page_backups_owner_all ON website_page_backups FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());
