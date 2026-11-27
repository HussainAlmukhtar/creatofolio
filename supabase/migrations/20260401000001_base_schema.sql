-- Migration — base schema.
--
-- The tables every later migration builds on. On a fresh Supabase project
-- this runs first (`supabase db push`, or paste the files in
-- supabase/migrations/ into the SQL editor in filename order). Idempotent:
-- every statement is IF NOT EXISTS, so it is a no-op on a database that
-- already has these tables.
--
-- Row Level Security and the owner-only write policies are added by
-- 20260501000001_admin_rls.sql and the migrations after it.

-- Worlds. A world wraps a set of rooms with a spatial
-- layout + metadata. A site can have several worlds (the editor's World view
-- creates, switches and deletes them); the default one is `id="main"`, created
-- by app/src/scripts/migrations/003_worlds.ts.
CREATE TABLE IF NOT EXISTS worlds (
  iid            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id             TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  layout         TEXT NOT NULL DEFAULT 'free'
                   CHECK (layout IN ('free','gridvania','linear')),
  grid_width     INT,
  grid_height    INT,
  schema_version INT NOT NULL DEFAULT 1,
  config         JSONB NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Room configurations
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- World columns on rooms. Indexable + joinable; per-room saves
-- still touch one row. Backfilled by app/src/scripts/migrations/003_worlds.ts.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS iid            UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS world_iid      UUID REFERENCES worlds(iid),
  ADD COLUMN IF NOT EXISTS world_x        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS world_y        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS world_w        INT NOT NULL DEFAULT 1520,
  ADD COLUMN IF NOT EXISTS world_h        INT NOT NULL DEFAULT 960,
  ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS rooms_world_iid_idx ON rooms (world_iid);

-- Rolling per-room backups. saveRoom() inserts one row
-- per save, then prunes to the most recent 20 per room.
CREATE TABLE IF NOT EXISTS room_backups (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_iid  UUID NOT NULL,
  config    JSONB NOT NULL,
  saved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_by  TEXT
);

CREATE INDEX IF NOT EXISTS room_backups_room_iid_idx
  ON room_backups (room_iid, saved_at DESC);

-- Object content (rich text, CV, galleries, etc.)
CREATE TABLE IF NOT EXISTS object_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(object_id, room_id)
);

-- Sprite assets metadata (actual files in Supabase Storage)
CREATE TABLE IF NOT EXISTS sprites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  width INT,
  height INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drawing Studio scenes — one row per editable target.
-- The PNG remains the canonical render shipped to players; the PSD (stored
-- in the `drawing-scenes` Storage bucket and linked here via psd_path) is
-- the editing source so the user can reopen Klecks with layers and history.
-- Legacy `snapshot` (tldraw store) is kept NULL on new writes and abandoned
-- in place on old rows; see migration 20260508000001_drawing_scenes_psd.sql.
-- target_kind = 'object' → target_id is the RoomObject.id
-- target_kind = 'background' → target_id is one of:
--   'background_back'   — the "Behind everything" art layer
--   'background_middle' — the main "The room" art layer
--   'background_front'  — the "Above player" overlay layer
-- (Pre-3-layer DBs used 'room'; 20260425000001_three_layer_backgrounds.sql
-- rewrites it to 'background_middle'.)
CREATE TABLE IF NOT EXISTS drawing_scenes (
  room_id     TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('object', 'background')),
  target_id   TEXT NOT NULL,
  snapshot    JSONB,                           -- legacy (tldraw); NULL on PSD writes
  psd_path    TEXT,                            -- path inside `drawing-scenes` bucket
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS drawing_scenes_room_idx
  ON drawing_scenes (room_id);

-- Reusable object templates (sprite + dimensions + hitbox + labels +
-- interaction settings). Dropping a template onto the canvas creates a
-- fully-formed RoomObject, so users don't have to re-tune every "wooden
-- door" they place.
--
-- Templates point at sprite URLs already in the `sprites` storage bucket;
-- they're a higher-level concept than the sprites/storage rows.
CREATE TABLE IF NOT EXISTS object_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  name_ar            TEXT,
  category           TEXT NOT NULL,                       -- door | furniture | plant | decoration | wall-art | other
  tags               TEXT[] NOT NULL DEFAULT '{}',
  sprite_url         TEXT NOT NULL,
  storage_path       TEXT,                                -- original upload path (if known); used for delete
  default_label      TEXT NOT NULL,
  default_label_ar   TEXT,
  default_width      INT NOT NULL,
  default_height     INT NOT NULL,
  hitbox_polygon     JSONB,                               -- Point[] in local coords; null → axis-aligned bbox
  interaction_type   TEXT NOT NULL DEFAULT 'content',
  external_url       TEXT,                                -- only meaningful when interaction_type = 'external-link'
  is_wall_mounted    BOOLEAN NOT NULL DEFAULT FALSE,
  interaction_radius INT,
  z_index_offset     INT,
  -- Field names that MUST be filled on the dropped instance before save
  -- (e.g. ["targetRoomId","targetEntryPointId"] for door templates). The
  -- editor pops a small inline form when any are empty after drop.
  required_fields    JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS object_templates_category_idx
  ON object_templates (category);
CREATE INDEX IF NOT EXISTS object_templates_tags_gin
  ON object_templates USING gin (tags);

-- ─── Landing-page CMS (see 20260720000001_website_pages_cms.sql) ──────────
-- Backs the landing page (src/components/landing/) with the DrawnPage shape
-- from src/data/landingTypes.ts. website_page_content is deliberately SEPARATE
-- from object_content so game rooms and landing pages can't break each other.

-- One DrawnPage per row, keyed by slug. `status` gates the public loader
-- (draft vs published) — an editorial gate, not a security boundary.
CREATE TABLE IF NOT EXISTS website_pages (
  id             TEXT PRIMARY KEY,
  iid            UUID UNIQUE NOT NULL,
  config         JSONB NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rich content attached to a page's "button" assets. Reuses the ObjectContent
-- JSONB shape; keyed by (page_slug, asset_iid).
CREATE TABLE IF NOT EXISTS website_page_content (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug      TEXT NOT NULL,
  asset_iid      UUID NOT NULL,
  content        JSONB NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_slug, asset_iid)
);
CREATE INDEX IF NOT EXISTS website_page_content_page_idx
  ON website_page_content (page_slug);

-- Reusable DrawnSection presets (object_templates convention, one level up).
CREATE TABLE IF NOT EXISTS website_section_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  name_ar       TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  section       JSONB NOT NULL,
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS website_section_templates_tags_gin
  ON website_section_templates USING gin (tags);

-- Rolling per-page version history + named/pinned versions (room_backups
-- convention). saveLandingPage() inserts one row per save then prunes to the
-- most recent 20 unpinned per page.
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


-- ─── Storage buckets the first editor features use ───────────────────────
-- (The later migrations create the rest: drawing-scenes, avatar-assets,
-- content-videos, site-fonts, content-files.) Owner-only write policies for
-- these are added by 20260509000001_admin_rls_hardening.sql.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('sprites',           'sprites',           true),
  ('content-images',    'content-images',    true),
  ('room-backgrounds',  'room-backgrounds',  true),
  ('room-bg-originals', 'room-bg-originals', false)
ON CONFLICT (id) DO NOTHING;
