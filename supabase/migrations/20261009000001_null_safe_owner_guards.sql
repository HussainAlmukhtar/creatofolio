-- Migration — null-safe owner guards (security hygiene, defence in depth).
--
-- WHY. public.is_owner() returns NULL (not false) when there is no signed-in
-- user / JWT: auth.jwt() ->> 'email' is NULL, NULL = '<owner>' is NULL, and
-- NULL AND <mfa ok> stays NULL. So a plpgsql guard written
--     IF NOT public.is_owner() THEN RAISE ...
-- evaluates NOT NULL = NULL, the IF is not taken, and the function carries on.
-- The two functions in 20261008000001_popup_styles.sql already use the safe
-- form; this migration brings the 12 older ones in line:
--     IF NOT COALESCE(public.is_owner(), false) THEN
--
-- NOT an active hole today: anon has no EXECUTE on any of these (only
-- authenticated + service_role + postgres), and RLS blocks the underlying
-- writes for non-owners. This closes the gap in the function itself so the
-- guard no longer depends on those other layers.
--
-- WHAT CHANGES. The guard line, in each of these functions, and nothing else
-- (same error code 42501 and message 'not_owner', same body, signature,
-- return type, LANGUAGE, SECURITY INVOKER, SET search_path = ''):
--     _restore_room_rows(jsonb,uuid)
--     _trash_room_rows(text)
--     discard_room_draft(uuid)
--     publish_landing_version(text,uuid)
--     publish_room_draft(uuid,timestamp with time zone)
--     purge_deleted_items(uuid[])
--     rename_landing_page_atomic(text,text)
--     rename_room_atomic(uuid,text,jsonb)
--     restore_deleted_item(uuid)
--     trash_landing_page(text)
--     trash_room(text)
--     trash_world(uuid)
-- BEHAVIOUR NOTE. A caller with no owner JWT used to slip past the guard; it
-- now gets 42501 not_owner. That means anon (no EXECUTE anyway), but also a
-- service_role / postgres caller with no owner JWT. No code does that: every
-- app caller is the browser client signed in as the owner (editorData,
-- landingEditorData, trashData, popupStyles). If you ever need to run one of
-- these from a script, run it with the owner's session, not the service key.
--
-- NOT TOUCHED: is_owner(), owner_mfa_satisfied(), every RLS policy, every
-- function not listed above (publish_popup_style and set_active_popup_theme
-- from 20261008000001_popup_styles.sql are already null-safe).
--
-- GRANTS. CREATE OR REPLACE FUNCTION on an existing function keeps its owner,
-- its ACL (EXECUTE grants / revokes), its comment and its attributes, and
-- these statements restate the same SET search_path / SECURITY INVOKER, so no
-- GRANT / REVOKE is re-stated here. After applying, re-run the check script:
-- it also prints each function's anon / authenticated / PUBLIC EXECUTE, which
-- must read anon=false authenticated=true public=false for all 12.
--
-- ROLLBACK. The previous definitions are below, commented out: the live
-- pg_get_functiondef() output read on 2026-10-07 (whitespace-equivalent to the
-- latest earlier migration for each function, checked). To roll back, strip the
-- leading "--   " from the lines of the functions you want back and run them;
-- each is one CREATE OR REPLACE and nothing else needs undoing.
--
-- ----------------------------------------------------------------------
-- _restore_room_rows(jsonb,uuid)
--   CREATE OR REPLACE FUNCTION public._restore_room_rows(p_payload jsonb, p_world_fallback uuid)
--    RETURNS text
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_room public.rooms;
--     v_w    text;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--
--     v_room := jsonb_populate_record(NULL::public.rooms, p_payload->'room');
--
--     IF EXISTS (SELECT 1 FROM public.rooms WHERE id = v_room.id) THEN
--       RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_room.id;
--     END IF;
--     IF v_room.iid IS NOT NULL AND EXISTS (SELECT 1 FROM public.rooms WHERE iid = v_room.iid) THEN
--       RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_room.id;
--     END IF;
--
--     -- Its world may have been deleted since: fall back to the main world.
--     IF v_room.world_iid IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.worlds WHERE iid = v_room.world_iid) THEN
--       v_room.world_iid := p_world_fallback;
--       v_room.config := jsonb_set(v_room.config, '{worldIid}', to_jsonb(p_world_fallback));
--     END IF;
--
--     INSERT INTO public.rooms SELECT (v_room).*;
--
--     INSERT INTO public.object_content
--       SELECT * FROM jsonb_populate_recordset(NULL::public.object_content, p_payload->'object_content');
--     INSERT INTO public.drawing_scenes
--       SELECT * FROM jsonb_populate_recordset(NULL::public.drawing_scenes, p_payload->'drawing_scenes');
--     INSERT INTO public.sprites
--       SELECT * FROM jsonb_populate_recordset(NULL::public.sprites, p_payload->'sprites');
--     INSERT INTO public.room_backups
--       SELECT * FROM jsonb_populate_recordset(NULL::public.room_backups, p_payload->'room_backups');
--     IF jsonb_typeof(p_payload->'room_draft') = 'object' THEN
--       INSERT INTO public.room_drafts
--         SELECT * FROM jsonb_populate_record(NULL::public.room_drafts, p_payload->'room_draft');
--     END IF;
--
--     -- Start-room pointer (the room row exists again, so "missing" is judged now).
--     IF jsonb_typeof(p_payload->'start_for_worlds') = 'array' THEN
--       FOR v_w IN SELECT jsonb_array_elements_text(p_payload->'start_for_worlds') LOOP
--         UPDATE public.worlds w
--         SET config     = jsonb_set(COALESCE(w.config, '{}'::jsonb), '{defaultRoomId}', to_jsonb(v_room.id)),
--             updated_at = now()
--         WHERE w.iid = v_w::uuid
--           AND (
--             COALESCE(w.config->>'defaultRoomId', '') = ''
--             OR NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = w.config->>'defaultRoomId')
--           );
--       END LOOP;
--     END IF;
--
--     RETURN v_room.id;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- _trash_room_rows(text)
--   CREATE OR REPLACE FUNCTION public._trash_room_rows(p_room_id text)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_room    public.rooms;
--     v_payload jsonb;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--
--     SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
--     END IF;
--
--     v_payload := jsonb_build_object(
--       'room', to_jsonb(v_room),
--       'object_content', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.object_content c WHERE c.room_id = p_room_id), '[]'::jsonb),
--       'drawing_scenes', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.drawing_scenes d WHERE d.room_id = p_room_id), '[]'::jsonb),
--       'sprites',        COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.sprites s WHERE s.room_id = p_room_id), '[]'::jsonb),
--       'room_backups',   COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.saved_at) FROM public.room_backups b WHERE b.room_iid = v_room.iid), '[]'::jsonb),
--       'room_draft',     (SELECT to_jsonb(r) FROM public.room_drafts r WHERE r.room_iid = v_room.iid),
--       -- iids of the worlds whose start room (config.defaultRoomId) this is.
--       'start_for_worlds', COALESCE(
--         (SELECT jsonb_agg(w.iid) FROM public.worlds w WHERE w.config->>'defaultRoomId' = p_room_id),
--         '[]'::jsonb)
--     );
--
--     DELETE FROM public.object_content WHERE room_id = p_room_id;
--     DELETE FROM public.drawing_scenes WHERE room_id = p_room_id;
--     DELETE FROM public.sprites        WHERE room_id = p_room_id;
--     IF v_room.iid IS NOT NULL THEN
--       DELETE FROM public.room_backups WHERE room_iid = v_room.iid;
--       DELETE FROM public.room_drafts  WHERE room_iid = v_room.iid;
--     END IF;
--     DELETE FROM public.rooms WHERE id = p_room_id;
--
--     RETURN v_payload;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- discard_room_draft(uuid)
--   CREATE OR REPLACE FUNCTION public.discard_room_draft(p_room_iid uuid)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--     DELETE FROM public.room_drafts WHERE room_iid = p_room_iid;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'no_draft' USING ERRCODE = 'P0002';
--     END IF;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- publish_landing_version(text,uuid)
--   CREATE OR REPLACE FUNCTION public.publish_landing_version(p_slug text, p_version_id uuid)
--    RETURNS timestamp with time zone
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_config  jsonb;
--     v_content jsonb;
--     v_schema  int;
--     v_now     timestamptz := now();
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--
--     SELECT v.config, v.content, v.schema_version
--       INTO v_config, v_content, v_schema
--     FROM public.website_page_versions v
--     JOIN public.website_pages p ON p.iid = v.page_iid
--     WHERE v.id = p_version_id AND p.id = p_slug;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002';
--     END IF;
--
--     UPDATE public.website_pages
--     SET config          = jsonb_set(v_config, '{slug}', to_jsonb(p_slug)),
--         schema_version  = v_schema,
--         status          = 'published',
--         live_version_id = p_version_id,
--         published_at    = v_now,
--         updated_at      = v_now
--     WHERE id = p_slug;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
--     END IF;
--
--     -- NULL content = a version saved by an older editor: leave live content alone.
--     IF v_content IS NOT NULL THEN
--       DELETE FROM public.website_page_content c
--       WHERE c.page_slug = p_slug
--         AND NOT (v_content ? c.asset_iid::text);
--
--       INSERT INTO public.website_page_content (page_slug, asset_iid, content, updated_at)
--       SELECT p_slug, e.key::uuid, e.value, v_now
--       FROM jsonb_each(v_content) AS e(key, value)
--       WHERE e.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--       ON CONFLICT (page_slug, asset_iid)
--         DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at;
--     END IF;
--
--     UPDATE public.website_page_versions SET published_at = v_now WHERE id = p_version_id;
--     RETURN v_now;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- publish_room_draft(uuid,timestamp with time zone)
--   CREATE OR REPLACE FUNCTION public.publish_room_draft(p_room_iid uuid, p_expected_live_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
--    RETURNS timestamp with time zone
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_room  record;
--     v_draft record;
--     v_now   timestamptz := now();
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--
--     SELECT * INTO v_draft FROM public.room_drafts WHERE room_iid = p_room_iid FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'no_draft' USING ERRCODE = 'P0002';
--     END IF;
--
--     SELECT * INTO v_room FROM public.rooms WHERE iid = p_room_iid FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
--     END IF;
--
--     IF p_expected_live_updated_at IS NOT NULL
--        AND v_room.updated_at IS DISTINCT FROM p_expected_live_updated_at THEN
--       RAISE EXCEPTION 'live_changed' USING ERRCODE = '40001';
--     END IF;
--
--     -- Undoable from History: keep the previous live config (rolling 20, pinned
--     -- versions exempt — same window as the editor's recordRoomBackup). Tagged so
--     -- History can tell it from an ordinary save.
--     INSERT INTO public.room_backups (room_iid, config, kind, label)
--     VALUES (
--       p_room_iid,
--       v_room.config,
--       'before_publish',
--       'Before publish ' || to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
--     );
--     DELETE FROM public.room_backups b
--     WHERE b.room_iid = p_room_iid
--       AND NOT b.is_pinned
--       AND b.id NOT IN (
--         SELECT id FROM public.room_backups
--         WHERE room_iid = p_room_iid AND NOT is_pinned
--         ORDER BY saved_at DESC
--         LIMIT 20
--       );
--
--     -- The live slug wins over whatever slug the draft was saved under (a rename
--     -- may have happened since). world_* columns are NOT touched: placement stays
--     -- owned by the World map.
--     UPDATE public.rooms
--     SET config         = jsonb_set(v_draft.config, '{id}', to_jsonb(v_room.id)),
--         schema_version = COALESCE((v_draft.config->>'schemaVersion')::int, v_room.schema_version),
--         updated_at     = v_now
--     WHERE iid = p_room_iid;
--
--     -- Draft pop-up content replaces this room's live rows (NULL = untouched).
--     IF v_draft.content IS NOT NULL THEN
--       DELETE FROM public.object_content c
--       WHERE c.room_id = v_room.id
--         AND NOT (v_draft.content ? c.object_id);
--
--       INSERT INTO public.object_content (object_id, room_id, content, updated_at)
--       SELECT e.key, v_room.id, e.value, v_now
--       FROM jsonb_each(v_draft.content) AS e(key, value)
--       ON CONFLICT (object_id, room_id)
--         DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at;
--     END IF;
--
--     DELETE FROM public.room_drafts WHERE room_iid = p_room_iid;
--     RETURN v_now;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- purge_deleted_items(uuid[])
--   CREATE OR REPLACE FUNCTION public.purge_deleted_items(p_ids uuid[])
--    RETURNS integer
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_n int;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--     DELETE FROM public.deleted_items WHERE id = ANY (p_ids);
--     GET DIAGNOSTICS v_n = ROW_COUNT;
--     RETURN v_n;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- rename_landing_page_atomic(text,text)
--   CREATE OR REPLACE FUNCTION public.rename_landing_page_atomic(p_old text, p_new text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--     IF p_new !~ '^[a-z0-9][a-z0-9_-]*$' THEN
--       RAISE EXCEPTION 'invalid_slug' USING ERRCODE = 'P0001';
--     END IF;
--     IF p_old = p_new THEN
--       RETURN;
--     END IF;
--   
--     PERFORM 1 FROM public.website_pages WHERE id = p_old FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
--     END IF;
--     IF EXISTS (SELECT 1 FROM public.website_pages WHERE id = p_new)
--        OR EXISTS (SELECT 1 FROM public.website_page_content WHERE page_slug = p_new) THEN
--       RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = p_new;
--     END IF;
--   
--     UPDATE public.website_pages
--     SET id         = p_new,
--         config     = jsonb_set(config, '{slug}', to_jsonb(p_new)),
--         updated_at = now()
--     WHERE id = p_old;
--   
--     UPDATE public.website_page_content SET page_slug = p_new WHERE page_slug = p_old;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- rename_room_atomic(uuid,text,jsonb)
--   CREATE OR REPLACE FUNCTION public.rename_room_atomic(p_room_iid uuid, p_new_slug text, p_updates jsonb)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_old text;
--     v_now timestamptz := now();
--     e     jsonb;
--     v_cur timestamptz;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--     IF p_new_slug !~ '^[a-z0-9][a-z0-9_-]*$' THEN
--       RAISE EXCEPTION 'invalid_slug' USING ERRCODE = 'P0001';
--     END IF;
--
--     SELECT id INTO v_old FROM public.rooms WHERE iid = p_room_iid FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
--     END IF;
--     IF v_old = p_new_slug THEN
--       RETURN;
--     END IF;
--     IF EXISTS (SELECT 1 FROM public.rooms WHERE id = p_new_slug)
--        OR EXISTS (SELECT 1 FROM public.object_content WHERE room_id = p_new_slug)
--        OR EXISTS (SELECT 1 FROM public.drawing_scenes WHERE room_id = p_new_slug)
--        OR EXISTS (SELECT 1 FROM public.sprites WHERE room_id = p_new_slug) THEN
--       RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = p_new_slug;
--     END IF;
--
--     -- 1. Every token first: nothing is applied if any room or draft changed.
--     FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
--       IF e->>'kind' = 'draft' THEN
--         SELECT d.updated_at INTO v_cur
--         FROM public.room_drafts d
--         JOIN public.rooms r ON r.iid = d.room_iid
--         WHERE r.id = e->>'id'
--         FOR UPDATE OF d;
--         IF NOT FOUND THEN
--           RAISE EXCEPTION 'changed' USING ERRCODE = '40001', DETAIL = e->>'id';
--         END IF;
--       ELSE
--         SELECT updated_at INTO v_cur FROM public.rooms WHERE id = e->>'id' FOR UPDATE;
--         IF NOT FOUND THEN
--           RAISE EXCEPTION 'room_missing' USING ERRCODE = 'P0002', DETAIL = e->>'id';
--         END IF;
--       END IF;
--       IF e->>'expected_updated_at' IS NOT NULL
--          AND v_cur IS DISTINCT FROM (e->>'expected_updated_at')::timestamptz THEN
--         RAISE EXCEPTION 'changed' USING ERRCODE = '40001', DETAIL = e->>'id';
--       END IF;
--     END LOOP;
--
--     -- 2. Config updates (neighbour doors + the renamed room's own config), and
--     --    the same for drafts.
--     FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) LOOP
--       IF e->>'kind' = 'draft' THEN
--         UPDATE public.room_drafts d
--         SET config = e->'config', updated_at = v_now
--         FROM public.rooms r
--         WHERE r.iid = d.room_iid AND r.id = e->>'id';
--       ELSE
--         UPDATE public.rooms SET config = e->'config', updated_at = v_now WHERE id = e->>'id';
--       END IF;
--     END LOOP;
--
--     -- 3. The id change (config.id follows).
--     UPDATE public.rooms
--     SET id         = p_new_slug,
--         config     = jsonb_set(config, '{id}', to_jsonb(p_new_slug)),
--         updated_at = v_now
--     WHERE iid = p_room_iid;
--
--     -- 4. Rows keyed by the room SLUG follow the rename.
--     UPDATE public.object_content SET room_id = p_new_slug WHERE room_id = v_old;
--     UPDATE public.drawing_scenes SET room_id = p_new_slug WHERE room_id = v_old;
--     UPDATE public.sprites        SET room_id = p_new_slug WHERE room_id = v_old;
--
--     -- 5. The draft keeps its slug in sync (its updated_at token is left alone).
--     UPDATE public.room_drafts
--     SET config = jsonb_set(config, '{id}', to_jsonb(p_new_slug))
--     WHERE room_iid = p_room_iid;
--
--     -- 6. Any world whose start room was this one.
--     UPDATE public.worlds
--     SET config = jsonb_set(config, '{defaultRoomId}', to_jsonb(p_new_slug)),
--         updated_at = v_now
--     WHERE config->>'defaultRoomId' = v_old;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- restore_deleted_item(uuid)
--   CREATE OR REPLACE FUNCTION public.restore_deleted_item(p_id uuid)
--    RETURNS text
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_item     public.deleted_items;
--     v_main     uuid;
--     v_world    public.worlds;
--     v_page     public.website_pages;
--     v_backup   public.website_page_backups;
--     v_room     jsonb;
--     v_slug     text;
--     v_version  uuid;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--   
--     SELECT * INTO v_item FROM public.deleted_items WHERE id = p_id FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
--     END IF;
--   
--     SELECT iid INTO v_main FROM public.worlds WHERE id = 'main';
--   
--     IF v_item.kind = 'room' THEN
--       v_slug := public._restore_room_rows(v_item.payload, v_main);
--   
--     ELSIF v_item.kind = 'world' THEN
--       v_world := jsonb_populate_record(NULL::public.worlds, v_item.payload->'world');
--       IF EXISTS (SELECT 1 FROM public.worlds WHERE id = v_world.id OR iid = v_world.iid) THEN
--         RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_world.id;
--       END IF;
--       -- Never comes back as the live world.
--       v_world.config := COALESCE(v_world.config, '{}'::jsonb) - 'live';
--       INSERT INTO public.worlds SELECT (v_world).*;
--       FOR v_room IN SELECT * FROM jsonb_array_elements(v_item.payload->'rooms') LOOP
--         PERFORM public._restore_room_rows(v_room, v_world.iid);
--       END LOOP;
--       v_slug := v_world.id;
--   
--     ELSIF v_item.kind = 'page' THEN
--       IF jsonb_typeof(v_item.payload->'page') = 'object' THEN
--         v_page := jsonb_populate_record(NULL::public.website_pages, v_item.payload->'page');
--         IF EXISTS (SELECT 1 FROM public.website_pages WHERE id = v_page.id OR iid = v_page.iid) THEN
--           RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = v_page.id;
--         END IF;
--         -- Versions first (the page row references its live version).
--         INSERT INTO public.website_page_versions
--           SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_versions, v_item.payload->'versions');
--         -- Offline: published fields stay on the rows, but nothing is served.
--         v_page.status := 'draft';
--         INSERT INTO public.website_pages SELECT (v_page).*;
--         INSERT INTO public.website_page_content
--           SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_content, v_item.payload->'content');
--         INSERT INTO public.website_page_backups
--           SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_backups, v_item.payload->'backups');
--         v_slug := v_page.id;
--       ELSE
--         -- "History only": a page that was deleted before the trash existed left
--         -- just its backups. Recreate it offline from the newest one.
--         SELECT * INTO v_backup
--         FROM jsonb_populate_recordset(NULL::public.website_page_backups, v_item.payload->'backups')
--         ORDER BY saved_at DESC LIMIT 1;
--         IF NOT FOUND THEN
--           RAISE EXCEPTION 'nothing_to_restore' USING ERRCODE = 'P0002';
--         END IF;
--         v_slug := v_backup.config->>'slug';
--         IF v_slug IS NULL OR EXISTS (
--           SELECT 1 FROM public.website_pages WHERE id = v_slug OR iid = v_backup.page_iid
--         ) THEN
--           RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505', DETAIL = COALESCE(v_slug, '?');
--         END IF;
--         v_version := gen_random_uuid();
--         INSERT INTO public.website_page_versions (id, page_iid, name, config, schema_version)
--         VALUES (v_version, v_backup.page_iid, 'Restored from history', v_backup.config,
--                 COALESCE((v_backup.config->>'schemaVersion')::int, 1));
--         INSERT INTO public.website_pages (id, iid, config, schema_version, status)
--         VALUES (v_slug, v_backup.page_iid, v_backup.config,
--                 COALESCE((v_backup.config->>'schemaVersion')::int, 1), 'draft');
--         INSERT INTO public.website_page_backups
--           SELECT * FROM jsonb_populate_recordset(NULL::public.website_page_backups, v_item.payload->'backups');
--       END IF;
--     END IF;
--   
--     DELETE FROM public.deleted_items WHERE id = p_id;
--     RETURN v_slug;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- trash_landing_page(text)
--   CREATE OR REPLACE FUNCTION public.trash_landing_page(p_slug text)
--    RETURNS uuid
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_page    public.website_pages;
--     v_payload jsonb;
--     v_id      uuid;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--   
--     SELECT * INTO v_page FROM public.website_pages WHERE id = p_slug FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
--     END IF;
--   
--     v_payload := jsonb_build_object(
--       'page', to_jsonb(v_page),
--       'versions', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at)
--                             FROM public.website_page_versions v WHERE v.page_iid = v_page.iid), '[]'::jsonb),
--       'content', COALESCE((SELECT jsonb_agg(to_jsonb(c))
--                            FROM public.website_page_content c WHERE c.page_slug = p_slug), '[]'::jsonb),
--       'backups', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.saved_at)
--                            FROM public.website_page_backups b WHERE b.page_iid = v_page.iid), '[]'::jsonb)
--     );
--   
--     INSERT INTO public.deleted_items (kind, label, payload)
--     VALUES (
--       'page',
--       COALESCE(NULLIF(v_page.config->'meta'->'title'->>'en', ''), p_slug) || ' (/' || p_slug || ')',
--       v_payload
--     )
--     RETURNING id INTO v_id;
--   
--     DELETE FROM public.website_page_content WHERE page_slug = p_slug;
--     DELETE FROM public.website_page_backups WHERE page_iid = v_page.iid;
--     DELETE FROM public.website_pages WHERE id = p_slug;
--     -- After the row: it references its live version.
--     DELETE FROM public.website_page_versions WHERE page_iid = v_page.iid;
--   
--     RETURN v_id;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- trash_room(text)
--   CREATE OR REPLACE FUNCTION public.trash_room(p_room_id text)
--    RETURNS uuid
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_name    text;
--     v_payload jsonb;
--     v_id      uuid;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--   
--     -- The live world's start room can't go (the game would have nowhere to start).
--     -- "Live" = config.live, else the main world (see loadDefaultWorld).
--     IF EXISTS (
--       SELECT 1 FROM public.worlds w
--       WHERE w.config->>'defaultRoomId' = p_room_id
--         AND (
--           COALESCE((w.config->>'live')::boolean, false)
--           OR (w.id = 'main' AND NOT EXISTS (
--                 SELECT 1 FROM public.worlds x WHERE COALESCE((x.config->>'live')::boolean, false)))
--         )
--     ) THEN
--       RAISE EXCEPTION 'start_room' USING ERRCODE = 'P0001';
--     END IF;
--   
--     v_payload := public._trash_room_rows(p_room_id);
--     v_name := v_payload->'room'->'config'->>'name';
--   
--     INSERT INTO public.deleted_items (kind, label, payload)
--     VALUES ('room', COALESCE(NULLIF(v_name, ''), p_room_id) || ' (' || p_room_id || ')', v_payload)
--     RETURNING id INTO v_id;
--     RETURN v_id;
--   END;
--   $function$;
----
-- ----------------------------------------------------------------------
-- trash_world(uuid)
--   CREATE OR REPLACE FUNCTION public.trash_world(p_world_iid uuid)
--    RETURNS uuid
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_world   public.worlds;
--     v_rooms   jsonb := '[]'::jsonb;
--     v_room_id text;
--     v_live    boolean;
--     v_id      uuid;
--   BEGIN
--     IF NOT public.is_owner() THEN
--       RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
--     END IF;
--   
--     SELECT * INTO v_world FROM public.worlds WHERE iid = p_world_iid FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'world_not_found' USING ERRCODE = 'P0002';
--     END IF;
--     IF v_world.id = 'main' THEN
--       RAISE EXCEPTION 'main_world' USING ERRCODE = 'P0001';
--     END IF;
--     v_live := COALESCE((v_world.config->>'live')::boolean, false);
--     IF v_live THEN
--       RAISE EXCEPTION 'live_world' USING ERRCODE = 'P0001';
--     END IF;
--   
--     FOR v_room_id IN
--       SELECT id FROM public.rooms WHERE world_iid = p_world_iid ORDER BY id
--     LOOP
--       v_rooms := v_rooms || jsonb_build_array(public._trash_room_rows(v_room_id));
--     END LOOP;
--   
--     INSERT INTO public.deleted_items (kind, label, payload)
--     VALUES (
--       'world',
--       v_world.name || ' (world, ' || jsonb_array_length(v_rooms) || ' room'
--         || CASE WHEN jsonb_array_length(v_rooms) = 1 THEN '' ELSE 's' END || ')',
--       jsonb_build_object('world', to_jsonb(v_world), 'rooms', v_rooms)
--     )
--     RETURNING id INTO v_id;
--   
--     DELETE FROM public.worlds WHERE iid = p_world_iid;
--     RETURN v_id;
--   END;
--   $function$;
--
-- ----------------------------------------------------------------------
-- End of rollback.

-- _restore_room_rows(jsonb,uuid)
CREATE OR REPLACE FUNCTION public._restore_room_rows(p_payload jsonb, p_world_fallback uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_room public.rooms;
  v_w    text;
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
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

-- _trash_room_rows(text)
CREATE OR REPLACE FUNCTION public._trash_room_rows(p_room_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_room    public.rooms;
  v_payload jsonb;
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
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

-- discard_room_draft(uuid)
CREATE OR REPLACE FUNCTION public.discard_room_draft(p_room_iid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.room_drafts WHERE room_iid = p_room_iid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_draft' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- publish_landing_version(text,uuid)
CREATE OR REPLACE FUNCTION public.publish_landing_version(p_slug text, p_version_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_config  jsonb;
  v_content jsonb;
  v_schema  int;
  v_now     timestamptz := now();
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT v.config, v.content, v.schema_version
    INTO v_config, v_content, v_schema
  FROM public.website_page_versions v
  JOIN public.website_pages p ON p.iid = v.page_iid
  WHERE v.id = p_version_id AND p.id = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.website_pages
  SET config          = jsonb_set(v_config, '{slug}', to_jsonb(p_slug)),
      schema_version  = v_schema,
      status          = 'published',
      live_version_id = p_version_id,
      published_at    = v_now,
      updated_at      = v_now
  WHERE id = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- NULL content = a version saved by an older editor: leave live content alone.
  IF v_content IS NOT NULL THEN
    DELETE FROM public.website_page_content c
    WHERE c.page_slug = p_slug
      AND NOT (v_content ? c.asset_iid::text);

    INSERT INTO public.website_page_content (page_slug, asset_iid, content, updated_at)
    SELECT p_slug, e.key::uuid, e.value, v_now
    FROM jsonb_each(v_content) AS e(key, value)
    WHERE e.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ON CONFLICT (page_slug, asset_iid)
      DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at;
  END IF;

  UPDATE public.website_page_versions SET published_at = v_now WHERE id = p_version_id;
  RETURN v_now;
END;
$function$;

-- publish_room_draft(uuid,timestamp with time zone)
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
  IF NOT COALESCE(public.is_owner(), false) THEN
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

-- purge_deleted_items(uuid[])
CREATE OR REPLACE FUNCTION public.purge_deleted_items(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n int;
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.deleted_items WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- rename_landing_page_atomic(text,text)
CREATE OR REPLACE FUNCTION public.rename_landing_page_atomic(p_old text, p_new text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
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
$function$;

-- rename_room_atomic(uuid,text,jsonb)
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
  IF NOT COALESCE(public.is_owner(), false) THEN
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

-- restore_deleted_item(uuid)
CREATE OR REPLACE FUNCTION public.restore_deleted_item(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  IF NOT COALESCE(public.is_owner(), false) THEN
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
$function$;

-- trash_landing_page(text)
CREATE OR REPLACE FUNCTION public.trash_landing_page(p_slug text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_page    public.website_pages;
  v_payload jsonb;
  v_id      uuid;
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
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
$function$;

-- trash_room(text)
CREATE OR REPLACE FUNCTION public.trash_room(p_room_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_name    text;
  v_payload jsonb;
  v_id      uuid;
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
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
$function$;

-- trash_world(uuid)
CREATE OR REPLACE FUNCTION public.trash_world(p_world_iid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_world   public.worlds;
  v_rooms   jsonb := '[]'::jsonb;
  v_room_id text;
  v_live    boolean;
  v_id      uuid;
BEGIN
  IF NOT COALESCE(public.is_owner(), false) THEN
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
$function$;
