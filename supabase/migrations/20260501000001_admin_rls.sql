-- Migration — Admin Row Level Security
--
-- After this lands:
--   - anon can READ rooms, worlds, object_content, templates, sprites, scenes
--     (the runtime needs them to render the public site)
--   - anon CANNOT write or read backups
--   - the owner (the email in public.app_owner, below) is the only role
--     allowed to insert/update/delete editor data
--
-- The owner's email lives in the one-row table public.app_owner (created
-- below). To change the owner later, UPDATE that row.

-- ─── owner table ────────────────────────────────────────
-- ONE row: the email address of the account that may edit the site. Set it
-- once after running the migrations (see README "Create the owner account"):
--
--   INSERT INTO public.app_owner (email) VALUES ('you@example.com');
--
-- RLS is on with NO policies, so neither anon nor authenticated can read or
-- change it through the API; only the SQL editor / service role can.
-- is_owner() reads it as SECURITY DEFINER. No row = nobody is the owner =
-- every write is refused.
CREATE TABLE IF NOT EXISTS public.app_owner (
  email      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_owner FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS app_owner_single_row ON public.app_owner ((true));

-- ─── helper: is_owner() ────────────────────────────────────────
-- Returns TRUE when the current authenticated user's email matches the
-- configured owner. SECURITY DEFINER with a pinned search_path so it can
-- read public.app_owner, which no API role may read directly.
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT lower(auth.jwt() ->> 'email') = (SELECT lower(email) FROM public.app_owner LIMIT 1)
$$;

-- ─── enable RLS on every editor table ──────────────────────────
ALTER TABLE rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE worlds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_content    ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_backups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawing_scenes    ENABLE ROW LEVEL SECURITY;

-- ─── public-read tables ────────────────────────────────────────
DROP POLICY IF EXISTS rooms_anon_read           ON rooms;
DROP POLICY IF EXISTS rooms_owner_write         ON rooms;
CREATE POLICY rooms_anon_read   ON rooms   FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rooms_owner_write ON rooms   FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS worlds_anon_read          ON worlds;
DROP POLICY IF EXISTS worlds_owner_write        ON worlds;
CREATE POLICY worlds_anon_read   ON worlds  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY worlds_owner_write ON worlds  FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS content_anon_read         ON object_content;
DROP POLICY IF EXISTS content_owner_write       ON object_content;
CREATE POLICY content_anon_read   ON object_content FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY content_owner_write ON object_content FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS templates_anon_read       ON object_templates;
DROP POLICY IF EXISTS templates_owner_write     ON object_templates;
CREATE POLICY templates_anon_read   ON object_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY templates_owner_write ON object_templates FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS sprites_anon_read         ON sprites;
DROP POLICY IF EXISTS sprites_owner_write       ON sprites;
CREATE POLICY sprites_anon_read   ON sprites FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY sprites_owner_write ON sprites FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS scenes_anon_read          ON drawing_scenes;
DROP POLICY IF EXISTS scenes_owner_write        ON drawing_scenes;
CREATE POLICY scenes_anon_read   ON drawing_scenes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY scenes_owner_write ON drawing_scenes FOR ALL    TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

-- ─── owner-only table ──────────────────────────────────────────
DROP POLICY IF EXISTS backups_owner_all         ON room_backups;
CREATE POLICY backups_owner_all ON room_backups FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());
