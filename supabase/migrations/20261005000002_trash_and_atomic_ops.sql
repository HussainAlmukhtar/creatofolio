-- Migration — "Recently deleted" (trash) + transactional rename/delete.
--
-- Before: renameRoom / deleteRoom / deleteWorld / renameLandingPage /
-- deleteLandingPage were several separate client requests (a failure halfway
-- left broken doors or orphans), deletes were permanent, and deleting pages /
-- worlds left their backup rows orphaned.
--
-- After: one trash table + transactional RPCs. Readers don't change: trashed
-- rows are MOVED OUT of the live tables into deleted_items.payload (as
-- row-for-row JSON snapshots, so restore is a lossless re-insert) and moved
-- back by restore_deleted_item(). Storage files are never touched, so restored
-- URLs still work.
--
-- Purely additive: a new table + functions. Every function is SECURITY INVOKER
-- with search_path = '' (RLS still applies); the explicit is_owner() check
-- turns "RLS filtered it to 0 rows" into a loud 42501. The editor feature-
-- detects the functions (PGRST202) and keeps its old client-side steps until
-- this is applied.
--
-- Error codes the UI maps:
--   42501 not_owner        P0002 not found        40001 changed (stale token)
--   P0001 start_room / main_world / live_world / invalid_slug
--   23505 slug_taken       (restore or rename onto a slug that is in use)

CREATE TABLE IF NOT EXISTS deleted_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('room','world','page')),
  label      TEXT NOT NULL,              -- what the list shows, e.g. "Gallery (gallery)"
  payload    JSONB NOT NULL,             -- every row needed to restore
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deleted_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deleted_items_owner_all ON deleted_items;
CREATE POLICY deleted_items_owner_all ON deleted_items FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

-- ─────────────────────────────────────────────────────────────────────────
-- Internal helpers (still owner-checked; granted to authenticated only so the
-- SECURITY INVOKER public functions below can call them).
-- ─────────────────────────────────────────────────────────────────────────

-- Snapshot one room (+ everything keyed to it) as JSON and DELETE the live rows.
CREATE OR REPLACE FUNCTION public._trash_room_rows(p_room_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_room    public.rooms;
  v_payload jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_payload := jsonb_build_object(
    'room', to_jsonb(v_room),
    'object_content', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.object_content c WHERE c.room_id = p_room_id), '[]'::jsonb),
    'drawing_scenes', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.drawing_scenes d WHERE d.room_id = p_room_id), '[]'::jsonb),
    'sprites',        COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.sprites s WHERE s.room_id = p_room_id), '[]'::jsonb),
    'room_backups',   COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.saved_at) FROM public.room_backups b WHERE b.room_iid = v_room.iid), '[]'::jsonb),
    'room_draft',     (SELECT to_jsonb(r) FROM public.room_drafts r WHERE r.room_iid = v_room.iid)
  );

  DELETE FROM public.object_content WHERE room_id = p_room_id;
  DELETE FROM public.drawing_scenes WHERE room_id = p_room_id;
  DELETE FROM public.sprites        WHERE room_id = p_room_id;
  IF v_room.iid IS NOT NULL THEN
    DELETE FROM public.room_backups WHERE room_iid = v_room.iid;
    DELETE FROM public.room_drafts  WHERE room_iid = v_room.iid;
  END IF;
  DELETE FROM public.rooms WHERE id = p_room_id;

  RETURN v_payload;
END;
$$;

-- Re-insert one room payload (from _trash_room_rows). Refuses a taken slug/iid.
CREATE OR REPLACE FUNCTION public._restore_room_rows(p_payload jsonb, p_world_fallback uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_room public.rooms;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_room := jsonb_populate_record(NULL::public.rooms, p_payload->'room');

  IF EXISTS (SELECT 1 FROM public.rooms WHERE id = v_room.id) THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_room.id;
  END IF;
  IF v_room.iid IS NOT NULL AND EXISTS (SELECT 1 FROM public.rooms WHERE iid = v_room.iid) THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_room.id;
  END IF;

  -- Its world may have been deleted since: fall back to the main world.
  IF v_room.world_iid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.worlds WHERE iid = v_room.world_iid) THEN
    v_room.world_iid := p_world_fallback;
    v_room.config := jsonb_set(v_room.config, '{worldIid}', to_jsonb(p_world_fallback));
  END IF;

  INSERT INTO public.rooms SELECT (v_room).*;

  INSERT INTO public.object_content
    SELECT * FROM jsonb_populate_recordset(NULL::public.object_content, p_payload->'object_content');
  INSERT INTO public.drawing_scenes
    SELECT * FROM jsonb_populate_recordset(NULL::public.drawing_scenes, p_payload->'drawing_scenes');
  INSERT INTO public.sprites
    SELECT * FROM jsonb_populate_recordset(NULL::public.sprites, p_payload->'sprites');
  INSERT INTO public.room_backups
    SELECT * FROM jsonb_populate_recordset(NULL::public.room_backups, p_payload->'room_backups');
  IF jsonb_typeof(p_payload->'room_draft') = 'object' THEN
    INSERT INTO public.room_drafts
      SELECT * FROM jsonb_populate_record(NULL::public.room_drafts, p_payload->'room_draft');
  END IF;

  RETURN v_room.id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Trash
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trash_room(p_room_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_name    text;
  v_payload jsonb;
  v_id      uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  -- The live world's start room can't go (the game would have nowhere to start).
  -- "Live" = config.live, else the main world (see loadDefaultWorld).
  IF EXISTS (
    SELECT 1 FROM public.worlds w
    WHERE w.config->>'defaultRoomId' = p_room_id
      AND (
        COALESCE((w.config->>'live')::boolean, false)
        OR (w.id = 'main' AND NOT EXISTS (
              SELECT 1 FROM public.worlds x WHERE COALESCE((x.config->>'live')::boolean, false)))
      )
  ) THEN
    RAISE EXCEPTION 'start_room' USING ERRCODE = 'P0001';
  END IF;

  v_payload := public._trash_room_rows(p_room_id);
  v_name := v_payload->'room'->'config'->>'name';

  INSERT INTO public.deleted_items (kind, label, payload)
  VALUES ('room', COALESCE(NULLIF(v_name, ''), p_room_id) || ' (' || p_room_id || ')', v_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trash_world(p_world_iid uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_world   public.worlds;
  v_rooms   jsonb := '[]'::jsonb;
  v_room_id text;
  v_live    boolean;
  v_id      uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_world FROM public.worlds WHERE iid = p_world_iid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'world_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_world.id = 'main' THEN
    RAISE EXCEPTION 'main_world' USING ERRCODE = 'P0001';
  END IF;
  v_live := COALESCE((v_world.config->>'live')::boolean, false);
  IF v_live THEN
    RAISE EXCEPTION 'live_world' USING ERRCODE = 'P0001';
  END IF;

  FOR v_room_id IN
    SELECT id FROM public.rooms WHERE world_iid = p_world_iid ORDER BY id
  LOOP
    v_rooms := v_rooms || jsonb_build_array(public._trash_room_rows(v_room_id));
  END LOOP;

  INSERT INTO public.deleted_items (kind, label, payload)
  VALUES (
    'world',
    v_world.name || ' (world, ' || jsonb_array_length(v_rooms) || ' room'
      || CASE WHEN jsonb_array_length(v_rooms) = 1 THEN '' ELSE 's' END || ')',
    jsonb_build_object('world', to_jsonb(v_world), 'rooms', v_rooms)
  )
  RETURNING id INTO v_id;

  DELETE FROM public.worlds WHERE iid = p_world_iid;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trash_landing_page(p_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_page    public.website_pages;
  v_payload jsonb;
  v_id      uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_page FROM public.website_pages WHERE id = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_payload := jsonb_build_object(
    'page', to_jsonb(v_page),
    'versions', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at)
                          FROM public.website_page_versions v WHERE v.page_iid = v_page.iid), '[]'::jsonb),
    'content', COALESCE((SELECT jsonb_agg(to_jsonb(c))
                         FROM public.website_page_content c WHERE c.page_slug = p_slug), '[]'::jsonb),
    'backups', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.saved_at)
                         FROM public.website_page_backups b WHERE b.page_iid = v_page.iid), '[]'::jsonb)
  );

  INSERT INTO public.deleted_items (kind, label, payload)
  VALUES (
    'page',
    COALESCE(NULLIF(v_page.config->'meta'->'title'->>'en', ''), p_slug) || ' (/' || p_slug || ')',
    v_payload
  )
  RETURNING id INTO v_id;

  DELETE FROM public.website_page_content WHERE page_slug = p_slug;
  DELETE FROM public.website_page_backups WHERE page_iid = v_page.iid;
  DELETE FROM public.website_pages WHERE id = p_slug;
  -- After the row: it references its live version.
  DELETE FROM public.website_page_versions WHERE page_iid = v_page.iid;

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Restore / purge
-- ─────────────────────────────────────────────────────────────────────────

-- Reinsert everything from the payload; returns the restored slug.
-- A slug that's in use now raises 23505 'slug_taken' (DETAIL = the slug): the
-- UI says "a room/page called X exists, rename it first". Restored pages come
-- back OFFLINE (status = 'draft') so nothing goes public by surprise.
CREATE OR REPLACE FUNCTION public.restore_deleted_item(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item     public.deleted_items;
  v_main     uuid;
  v_world    public.worlds;
  v_page     public.website_pages;
  v_backup   public.website_page_backups;
  v_room     jsonb;
  v_slug     text;
  v_version  uuid;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.deleted_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT iid INTO v_main FROM public.worlds WHERE id = 'main';

  IF v_item.kind = 'room' THEN
    v_slug := public._restore_room_rows(v_item.payload, v_main);

  ELSIF v_item.kind = 'world' THEN
    v_world := jsonb_populate_record(NULL::public.worlds, v_item.payload->'world');
    IF EXISTS (SELECT 1 FROM public.worlds WHERE id = v_world.id OR iid = v_world.iid) THEN
      RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_world.id;
    END IF;
    -- Never comes back as the live world.
    v_world.config := COALESCE(v_world.config, '{}'::jsonb) - 'live';
    INSERT INTO public.worlds SELECT (v_world).*;
    FOR v_room IN SELECT * FROM jsonb_array_elements(v_item.payload->'rooms') LOOP
      PERFORM public._restore_room_rows(v_room, v_world.iid);
    END LOOP;
    v_slug := v_world.id;

  ELSIF v_item.kind = 'page' THEN
    IF jsonb_typeof(v_item.payload->'page') = 'object' THEN
      v_page := jsonb_populate_record(NULL::public.website_pages, v_item.payload->'page');
      IF EXISTS (SELECT 1 FROM public.website_pages WHERE id = v_page.id OR iid = v_page.iid) THEN
        RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_page.id;
      END IF;
      -- Versions first (the page row references its live version).
      INSERT INTO public.website_page_versions
        SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_versions, v_item.payload->'versions');
      -- Offline: published fields stay on the rows, but nothing is served.
      v_page.status := 'draft';
      INSERT INTO public.website_pages SELECT (v_page).*;
      INSERT INTO public.website_page_content
        SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_content, v_item.payload->'content');
      INSERT INTO public.website_page_backups
        SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_backups, v_item.payload->'backups');
      v_slug := v_page.id;
    ELSE
      -- "History only": a page that was deleted before the trash existed left
      -- just its backups. Recreate it offline from the newest one.
      SELECT * INTO v_backup
      FROM jsonb_populate_recordset(NULL::public.website_page_backups, v_item.payload->'backups')
      ORDER BY saved_at DESC LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'nothing_to_restore' USING ERRCODE = 'P0002';
      END IF;
      v_slug := v_backup.config->>'slug';
      IF v_slug IS NULL OR EXISTS (
        SELECT 1 FROM public.website_pages WHERE id = v_slug OR iid = v_backup.page_iid
      ) THEN
        RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = COALESCE(v_slug, '?');
      END IF;
      v_version := gen_random_uuid();
      INSERT INTO public.website_page_versions (id, page_iid, name, config, schema_version)
      VALUES (v_version, v_backup.page_iid, 'Restored from history', v_backup.config,
              COALESCE((v_backup.config->>'schemaVersion')::int, 1));
      INSERT INTO public.website_pages (id, iid, config, schema_version, status)
      VALUES (v_slug, v_backup.page_iid, v_backup.config,
              COALESCE((v_backup.config->>'schemaVersion')::int, 1), 'draft');
      INSERT INTO public.website_page_backups
        SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_backups, v_item.payload->'backups');
    END IF;
  END IF;

  DELETE FROM public.deleted_items WHERE id = p_id;
  RETURN v_slug;
END;
$$;

-- Permanently delete trash rows (the UI's "Delete forever" / "Empty").
-- There is no automatic purge in v1; the UI shows each item's age.
CREATE OR REPLACE FUNCTION public.purge_deleted_items(p_ids uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.deleted_items WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Atomic renames
-- ─────────────────────────────────────────────────────────────────────────

-- Rename a room in ONE transaction. The client still works out the door
-- rewrites; it sends p_updates = [{ id, expected_updated_at, config }] for every
-- touched room (the renamed room itself included, with the new config). Every
-- expected_updated_at is checked first (40001 'changed' on a mismatch, nothing
-- applied), then: config updates, the id change, the re-key of object_content /
-- drawing_scenes / sprites, the draft's config.id and the worlds' start room.
CREATE OR REPLACE FUNCTION public.rename_room_atomic(
  p_room_iid uuid,
  p_new_slug text,
  p_updates  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_old text;
  v_now timestamptz := now();
  e     jsonb;
  v_cur timestamptz;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_new_slug !~ '^[a-z0-9][a-z0-9_-]*$' THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_old FROM public.rooms WHERE iid = p_room_iid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old = p_new_slug THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rooms WHERE id = p_new_slug)
     OR EXISTS (SELECT 1 FROM public.object_content WHERE room_id = p_new_slug)
     OR EXISTS (SELECT 1 FROM public.drawing_scenes WHERE room_id = p_new_slug)
     OR EXISTS (SELECT 1 FROM public.sprites WHERE room_id = p_new_slug) THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = p_new_slug;
  END IF;

  -- 1. Every token first: nothing is applied if any room changed.
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
    SELECT updated_at INTO v_cur FROM public.rooms WHERE id = e->>'id' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'room_missing' USING ERRCODE = 'P0002', DETAIL = e->>'id';
    END IF;
    IF e->>'expected_updated_at' IS NOT NULL
       AND v_cur IS DISTINCT FROM (e->>'expected_updated_at')::timestamptz THEN
      RAISE EXCEPTION 'changed' USING ERRCODE = '40001', DETAIL = e->>'id';
    END IF;
  END LOOP;

  -- 2. Config updates (neighbour doors + the renamed room's own config).
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
    UPDATE public.rooms SET config = e->'config', updated_at = v_now WHERE id = e->>'id';
  END LOOP;

  -- 3. The id change (config.id follows).
  UPDATE public.rooms
  SET id         = p_new_slug,
      config     = jsonb_set(config, '{id}', to_jsonb(p_new_slug)),
      updated_at = v_now
  WHERE iid = p_room_iid;

  -- 4. Rows keyed by the room SLUG follow the rename.
  UPDATE public.object_content SET room_id = p_new_slug WHERE room_id = v_old;
  UPDATE public.drawing_scenes SET room_id = p_new_slug WHERE room_id = v_old;
  UPDATE public.sprites        SET room_id = p_new_slug WHERE room_id = v_old;

  -- 5. The draft keeps its slug in sync (its updated_at token is left alone).
  UPDATE public.room_drafts
  SET config = jsonb_set(config, '{id}', to_jsonb(p_new_slug))
  WHERE room_iid = p_room_iid;

  -- 6. Any world whose start room was this one.
  UPDATE public.worlds
  SET config = jsonb_set(config, '{defaultRoomId}', to_jsonb(p_new_slug)),
      updated_at = v_now
  WHERE config->>'defaultRoomId' = v_old;
END;
$$;

-- Rename a landing page: the row id, config.slug and the content rows'
-- page_slug in ONE transaction (the iid stays, so backups/versions stay linked).
CREATE OR REPLACE FUNCTION public.rename_landing_page_atomic(p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_new !~ '^[a-z0-9][a-z0-9_-]*$' THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = 'P0001';
  END IF;
  IF p_old = p_new THEN
    RETURN;
  END IF;

  PERFORM 1 FROM public.website_pages WHERE id = p_old FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.website_pages WHERE id = p_new)
     OR EXISTS (SELECT 1 FROM public.website_page_content WHERE page_slug = p_new) THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = p_new;
  END IF;

  UPDATE public.website_pages
  SET id         = p_new,
      config     = jsonb_set(config, '{slug}', to_jsonb(p_new)),
      updated_at = now()
  WHERE id = p_old;

  UPDATE public.website_page_content SET page_slug = p_new WHERE page_slug = p_old;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Grants: authenticated only (the helpers too, so the functions above can call
-- them as the invoker; each re-checks is_owner()).
-- ─────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._trash_room_rows(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._restore_room_rows(jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trash_room(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trash_world(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trash_landing_page(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_deleted_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purge_deleted_items(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_room_atomic(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_landing_page_atomic(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._trash_room_rows(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._restore_room_rows(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trash_room(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trash_world(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trash_landing_page(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_deleted_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_deleted_items(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_room_atomic(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_landing_page_atomic(text, text) TO authenticated;
