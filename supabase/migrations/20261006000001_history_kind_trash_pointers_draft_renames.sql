-- Migration — History kinds, trash start-room pointers, draft renames:
--   1. room_backups.kind        History says WHY a snapshot exists
--   2. publish_room_draft       writes the previous live as 'before_publish'
--   3. _trash_room_rows /       the trash remembers which worlds had a trashed
--      _restore_room_rows       room as their start room; restore puts the
--                               pointer back
--   4. rename_room_atomic       also rewrites old door slugs inside the
--                               neighbours' DRAFTS (kind = 'draft' entries)
--
-- Additive + CREATE OR REPLACE of functions that came with
-- 20261005000001_room_drafts.sql and
-- 20261005000002_trash_and_atomic_ops.sql (same signatures, so their grants
-- stay). is_owner(), owner_mfa_satisfied()
-- and every RLS policy are untouched.
--
-- Old payloads/rows stay valid: backups without `kind` read as "Saved"; trash
-- items without `start_for_worlds` simply restore without a pointer.
--
-- ROLLBACK: restore the previous definitions of the 4 functions (the originals
-- are in 20261005000001_room_drafts.sql and
-- 20261005000002_trash_and_atomic_ops.sql) and, if wanted,
--   ALTER TABLE public.room_backups DROP COLUMN IF EXISTS kind;

BEGIN;

-- ─── 1. History kind ────────────────────────────────────────────────────
-- NULL (rows from before this migration) is displayed as "Saved".
-- Values written: 'saved' (direct live save), 'named' (pinned version),
-- 'before_publish' (the live config a Publish replaced).
ALTER TABLE public.room_backups ADD COLUMN IF NOT EXISTS kind TEXT;

-- ─── 2. publish_room_draft: the previous live is a "before publish" row ──
CREATE OR REPLACE FUNCTION public.publish_room_draft(p_room_iid uuid, p_expected_live_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_room  record;
  v_draft record;
  v_now   timestamptz := now();
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draft FROM public.room_drafts WHERE room_iid = p_room_iid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_draft' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE iid = p_room_iid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_live_updated_at IS NOT NULL
     AND v_room.updated_at IS DISTINCT FROM p_expected_live_updated_at THEN
    RAISE EXCEPTION 'live_changed' USING ERRCODE = '40001';
  END IF;

  -- Undoable from History: keep the previous live config (rolling 20, pinned
  -- versions exempt — same window as the editor's recordRoomBackup). Tagged so
  -- History can tell it from an ordinary save.
  INSERT INTO public.room_backups (room_iid, config, kind, label)
  VALUES (
    p_room_iid,
    v_room.config,
    'before_publish',
    'Before publish ' || to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
  );
  DELETE FROM public.room_backups b
  WHERE b.room_iid = p_room_iid
    AND NOT b.is_pinned
    AND b.id NOT IN (
      SELECT id FROM public.room_backups
      WHERE room_iid = p_room_iid AND NOT is_pinned
      ORDER BY saved_at DESC
      LIMIT 20
    );

  -- The live slug wins over whatever slug the draft was saved under (a rename
  -- may have happened since). world_* columns are NOT touched: placement stays
  -- owned by the World map.
  UPDATE public.rooms
  SET config         = jsonb_set(v_draft.config, '{id}', to_jsonb(v_room.id)),
      schema_version = COALESCE((v_draft.config->>'schemaVersion')::int, v_room.schema_version),
      updated_at     = v_now
  WHERE iid = p_room_iid;

  -- Draft pop-up content replaces this room's live rows (NULL = untouched).
  IF v_draft.content IS NOT NULL THEN
    DELETE FROM public.object_content c
    WHERE c.room_id = v_room.id
      AND NOT (v_draft.content ? c.object_id);

    INSERT INTO public.object_content (object_id, room_id, content, updated_at)
    SELECT e.key, v_room.id, e.value, v_now
    FROM jsonb_each(v_draft.content) AS e(key, value)
    ON CONFLICT (object_id, room_id)
      DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at;
  END IF;

  DELETE FROM public.room_drafts WHERE room_iid = p_room_iid;
  RETURN v_now;
END;
$function$;

-- ─── 3a. Trash: remember which worlds started in this room ──────────────
-- Used by trash_room AND trash_world (both go through this helper). For a
-- whole-world trash the world row's own snapshot already carries its
-- defaultRoomId, so restoring it needs nothing extra.
CREATE OR REPLACE FUNCTION public._trash_room_rows(p_room_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    'room_draft',     (SELECT to_jsonb(r) FROM public.room_drafts r WHERE r.room_iid = v_room.iid),
    -- iids of the worlds whose start room (config.defaultRoomId) this is.
    'start_for_worlds', COALESCE(
      (SELECT jsonb_agg(w.iid) FROM public.worlds w WHERE w.config->>'defaultRoomId' = p_room_id),
      '[]'::jsonb)
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
$function$;

-- ─── 3b. Restore: put the start-room pointer back ───────────────────────
-- Only when that world still exists AND currently has no start room, or its
-- start room is missing (the client clears the pointer after trashing). A
-- world that has since chosen another, existing start room is left alone.
CREATE OR REPLACE FUNCTION public._restore_room_rows(p_payload jsonb, p_world_fallback uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_room public.rooms;
  v_w    text;
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

  -- Start-room pointer (the room row exists again, so "missing" is judged now).
  IF jsonb_typeof(p_payload->'start_for_worlds') = 'array' THEN
    FOR v_w IN SELECT jsonb_array_elements_text(p_payload->'start_for_worlds') LOOP
      UPDATE public.worlds w
      SET config     = jsonb_set(COALESCE(w.config, '{}'::jsonb), '{defaultRoomId}', to_jsonb(v_room.id)),
          updated_at = now()
      WHERE w.iid = v_w::uuid
        AND (
          COALESCE(w.config->>'defaultRoomId', '') = ''
          OR NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = w.config->>'defaultRoomId')
        );
    END LOOP;
  END IF;

  RETURN v_room.id;
END;
$function$;

-- ─── 4. Rename: neighbours' drafts follow the new slug ──────────────────
-- p_updates entries are { id, expected_updated_at, config }. New: an entry
-- with "kind": "draft" addresses the DRAFT of the room whose current slug is
-- `id` (token = the draft's updated_at; config = the rewritten draft config).
-- Same all-or-nothing rule: every token is checked before anything changes.
-- A changed draft gets a fresh updated_at so another open tab notices.
CREATE OR REPLACE FUNCTION public.rename_room_atomic(p_room_iid uuid, p_new_slug text, p_updates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- 1. Every token first: nothing is applied if any room or draft changed.
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
    IF e->>'kind' = 'draft' THEN
      SELECT d.updated_at INTO v_cur
      FROM public.room_drafts d
      JOIN public.rooms r ON r.iid = d.room_iid
      WHERE r.id = e->>'id'
      FOR UPDATE OF d;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'changed' USING ERRCODE = '40001', DETAIL = e->>'id';
      END IF;
    ELSE
      SELECT updated_at INTO v_cur FROM public.rooms WHERE id = e->>'id' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'room_missing' USING ERRCODE = 'P0002', DETAIL = e->>'id';
      END IF;
    END IF;
    IF e->>'expected_updated_at' IS NOT NULL
       AND v_cur IS DISTINCT FROM (e->>'expected_updated_at')::timestamptz THEN
      RAISE EXCEPTION 'changed' USING ERRCODE = '40001', DETAIL = e->>'id';
    END IF;
  END LOOP;

  -- 2. Config updates (neighbour doors + the renamed room's own config), and
  --    the same for drafts.
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
    IF e->>'kind' = 'draft' THEN
      UPDATE public.room_drafts d
      SET config = e->'config', updated_at = v_now
      FROM public.rooms r
      WHERE r.iid = d.room_iid AND r.id = e->>'id';
    ELSE
      UPDATE public.rooms SET config = e->'config', updated_at = v_now WHERE id = e->>'id';
    END IF;
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
$function$;

COMMIT;
