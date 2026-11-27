-- Migration — close legacy permissive RLS holes left over from before
-- 20260501000001_admin_rls.sql ran.
--
-- Background: admin_rls.sql added owner-gated `<table>_owner_write` policies
-- to every editor table, intending to replace the permissive policies that
-- pre-dated it. It never `DROP`-ped the older ones, so PostgreSQL's permissive
-- policy OR-merge means the legacy `USING(true)` policies still win — any
-- authenticated (or, for `rooms`/`sprites`/`object_content`, any anonymous)
-- caller can write all editor data despite the apparent owner gate.
--
-- This migration drops the legacy policies, replaces the storage role-only
-- writes with owner-gated equivalents, removes the redundant broad SELECT
-- on public buckets (their objects are still served by direct public URL,
-- which needs no SELECT policy), and pins is_owner()'s search_path.

-- ─── Tables: drop legacy "Allow all for authenticated" ─────
DROP POLICY IF EXISTS "Allow all for authenticated" ON rooms;
DROP POLICY IF EXISTS "Allow all for authenticated" ON object_content;
DROP POLICY IF EXISTS "Allow all for authenticated" ON object_templates;
DROP POLICY IF EXISTS "Allow all for authenticated" ON room_backups;
DROP POLICY IF EXISTS "Allow all for authenticated" ON sprites;
DROP POLICY IF EXISTS "Allow all for authenticated" ON drawing_scenes;
DROP POLICY IF EXISTS "Allow all for authenticated" ON worlds;

-- ─── Tables: drop CRITICAL anon-write policies ─────────────
DROP POLICY IF EXISTS "anon_write_rooms"   ON rooms;
DROP POLICY IF EXISTS "anon_write_content" ON object_content;
DROP POLICY IF EXISTS "anon_write_sprites" ON sprites;

-- ─── Tables: drop redundant "Allow anon read" ──────────────
-- Already covered by the *_anon_read policies admin_rls.sql created.
DROP POLICY IF EXISTS "Allow anon read" ON rooms;
DROP POLICY IF EXISTS "Allow anon read" ON object_content;
DROP POLICY IF EXISTS "Allow anon read" ON object_templates;
DROP POLICY IF EXISTS "Allow anon read" ON worlds;

-- ─── Storage: drop role-only writes + broad list policy ────
DROP POLICY IF EXISTS "Auth write sprites"           ON storage.objects;
DROP POLICY IF EXISTS "Auth write content-images"    ON storage.objects;
DROP POLICY IF EXISTS "Auth write room-backgrounds"  ON storage.objects;
DROP POLICY IF EXISTS "Auth write room-bg-originals" ON storage.objects;
DROP POLICY IF EXISTS "Public read editor assets"    ON storage.objects;

-- ─── Storage: owner-gated writes per bucket ────────────────
-- Mirrors the table-level <name>_owner_write pattern in admin_rls.sql.
-- Public-URL access for the public buckets is unaffected — Supabase serves
-- their objects directly when bucket.public = true, no SELECT policy needed.
-- No anon SELECT policy is added on purpose: it would only add the ability to
-- LIST a bucket. The owner's own reads are covered by these FOR ALL policies.
CREATE POLICY storage_owner_write_sprites ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'sprites' AND public.is_owner())
  WITH CHECK (bucket_id = 'sprites' AND public.is_owner());

CREATE POLICY storage_owner_write_content_images ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'content-images' AND public.is_owner())
  WITH CHECK (bucket_id = 'content-images' AND public.is_owner());

CREATE POLICY storage_owner_write_room_backgrounds ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'room-backgrounds' AND public.is_owner())
  WITH CHECK (bucket_id = 'room-backgrounds' AND public.is_owner());

CREATE POLICY storage_owner_write_room_bg_originals ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'room-bg-originals' AND public.is_owner())
  WITH CHECK (bucket_id = 'room-bg-originals' AND public.is_owner());

-- ─── is_owner(): pin search_path ───────────────────────────
-- Closes the function_search_path_mutable advisor warning. Doesn't change
-- semantics — auth.jwt() is fully qualified and the function only does a
-- string equality.
CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT lower(auth.jwt() ->> 'email') = (SELECT lower(email) FROM public.app_owner LIMIT 1)
$$;
