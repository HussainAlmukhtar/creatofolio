-- Migration — room drafts + atomic Publish (staging for the game).
--
-- Before: the room editor's Save wrote rooms.config directly, so every save
-- was instantly live for visitors. After: Save writes ONE draft per room
-- (room_drafts, owner-only); the public game keeps reading rooms.config and is
-- untouched. Publish copies draft → live in one transaction.
--
--   room_drafts.config   the draft RoomConfig
--   room_drafts.content  { "<objectId>": ObjectContent } — the draft's pop-up
--                        content; NULL = untouched (the live rows apply)
--
-- Purely additive: a new table + two functions (SECURITY INVOKER, so RLS still
-- applies; the explicit is_owner() check turns "RLS filtered it to 0 rows"
-- into a loud 42501). The editor feature-detects the table (42P01 / PGRST205)
-- and the functions (PGRST202) and keeps its old save-straight-to-live
-- behaviour until this is applied.

CREATE TABLE IF NOT EXISTS room_drafts (
  room_iid    UUID PRIMARY KEY,           -- rooms.iid (stable across renames)
  config      JSONB NOT NULL,
  content     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE room_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_drafts_owner_all ON room_drafts;
CREATE POLICY room_drafts_owner_all ON room_drafts FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Publish: draft → live, atomically.
--   p_expected_live_updated_at: the live row's updated_at as the editor last
--   saw it; a mismatch raises 40001 'live_changed' (NULL = publish anyway).
CREATE OR REPLACE FUNCTION public.publish_room_draft(
  p_room_iid uuid,
  p_expected_live_updated_at timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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
  -- versions exempt — same window as the editor's recordRoomBackup).
  INSERT INTO public.room_backups (room_iid, config) VALUES (p_room_iid, v_room.config);
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
$$;

-- Discard: delete the draft (0 rows → P0002).
CREATE OR REPLACE FUNCTION public.discard_room_draft(p_room_iid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.room_drafts WHERE room_iid = p_room_iid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_draft' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_room_draft(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.discard_room_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_room_draft(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_room_draft(uuid) TO authenticated;
