-- Migration — pop-up theme + frame library, and the
-- content-videos bucket's file-type allowlist.
--
-- popup_styles         one row per library item: kind 'theme' (the drawn
--                      parts every pop-up uses: panel, close, arrows, title
--                      strip, page turn, dialogue box parts) or 'frame' (a
--                      drawn frame like a TV, with a "screen" window the
--                      content sits in). `config` is the LIVE version that
--                      visitors see; `published_at` NULL = never published.
--                      Exactly one theme may be active (partial unique index);
--                      none active = the built-in default look. Anon can read
--                      (the runtime needs it); only the owner writes. There is
--                      deliberately NO delete policy: items are archive-only,
--                      so a drawing is never lost.
-- popup_style_drafts   one owner-only draft per item; Publish copies it live.
-- popup_style_backups  owner-only history (rolling 20 per item), written by
--                      Publish with the previous live config.
--
-- Functions (mirroring publish_room_draft: SECURITY INVOKER so RLS still
-- applies, an explicit is_owner() check turning "0 rows" into a loud 42501,
-- SET search_path = '' with fully-qualified names; EXECUTE revoked from
-- public/anon, granted to authenticated):
--   publish_popup_style(iid, expected_updated_at)  draft → live in one
--     transaction (40001 'live_changed' when the live row moved on;
--     P0002 'no_draft' / 'style_not_found').
--   set_active_popup_theme(iid | NULL)  make one published, unarchived theme
--     the active one (NULL = back to the built-in default; P0001
--     'not_activatable' otherwise).
--
-- content-videos: until now only /api/editor/upload refused non-video files.
-- The bucket gets the same list the route stores (mp4, m4v, webm, mov, ogv),
-- only while it has none, so a later manual change is never overwritten.
--
-- Additive only: new tables, policies on those tables, new functions, one
-- bucket setting. is_owner(), owner_mfa_satisfied() and every existing policy
-- are untouched. The editor feature-detects the tables (42P01 / PGRST205) and
-- functions (PGRST202) and the runtime falls back to the built-in look.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_active_popup_theme(uuid);
--   DROP FUNCTION IF EXISTS public.publish_popup_style(uuid, timestamptz);
--   DROP TABLE IF EXISTS public.popup_style_backups, public.popup_style_drafts, public.popup_styles;
--   UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'content-videos';

CREATE TABLE IF NOT EXISTS public.popup_styles (
  iid           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('theme', 'frame')),
  name          TEXT NOT NULL DEFAULT '',
  name_ar       TEXT NOT NULL DEFAULT '',
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  archived_at   TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Only a live (unarchived) theme can be the active one.
  CONSTRAINT popup_styles_active_is_live_theme
    CHECK (NOT is_active OR (kind = 'theme' AND archived_at IS NULL AND published_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS popup_styles_one_active_theme
  ON public.popup_styles ((true)) WHERE is_active;

ALTER TABLE public.popup_styles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS popup_styles_public_read ON public.popup_styles;
CREATE POLICY popup_styles_public_read ON public.popup_styles
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS popup_styles_owner_insert ON public.popup_styles;
CREATE POLICY popup_styles_owner_insert ON public.popup_styles
  FOR INSERT TO authenticated WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS popup_styles_owner_update ON public.popup_styles;
CREATE POLICY popup_styles_owner_update ON public.popup_styles
  FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE IF NOT EXISTS public.popup_style_drafts (
  style_iid   UUID PRIMARY KEY REFERENCES public.popup_styles(iid) ON DELETE CASCADE,
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.popup_style_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS popup_style_drafts_owner_all ON public.popup_style_drafts;
CREATE POLICY popup_style_drafts_owner_all ON public.popup_style_drafts
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE IF NOT EXISTS public.popup_style_backups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  style_iid   UUID NOT NULL REFERENCES public.popup_styles(iid) ON DELETE CASCADE,
  config      JSONB NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS popup_style_backups_by_style
  ON public.popup_style_backups (style_iid, saved_at DESC);

ALTER TABLE public.popup_style_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS popup_style_backups_owner_all ON public.popup_style_backups;
CREATE POLICY popup_style_backups_owner_all ON public.popup_style_backups
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

-- Publish: draft → live, atomically.
--   p_expected_updated_at: the live row's updated_at as the editor last saw
--   it; a mismatch raises 40001 'live_changed' (NULL = publish anyway).
CREATE OR REPLACE FUNCTION public.publish_popup_style(
  p_iid uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_style record;
  v_draft record;
  v_now   timestamptz := now();
BEGIN
  -- NULL-safe: is_owner() is NULL (not false) with no signed-in user.
  IF NOT COALESCE(public.is_owner(), false) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_draft FROM public.popup_style_drafts WHERE style_iid = p_iid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_draft' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_style FROM public.popup_styles WHERE iid = p_iid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'style_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_style.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'live_changed' USING ERRCODE = '40001';
  END IF;

  -- History: the version being replaced (never the empty never-published one).
  IF v_style.published_at IS NOT NULL THEN
    INSERT INTO public.popup_style_backups (style_iid, config, label)
    VALUES (p_iid, v_style.config,
            'Before publish ' || to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');
    DELETE FROM public.popup_style_backups b
    WHERE b.style_iid = p_iid
      AND b.id NOT IN (
        SELECT id FROM public.popup_style_backups
        WHERE style_iid = p_iid
        ORDER BY saved_at DESC
        LIMIT 20
      );
  END IF;

  UPDATE public.popup_styles
  SET config       = v_draft.config,
      published_at = v_now,
      updated_at   = v_now
  WHERE iid = p_iid;

  DELETE FROM public.popup_style_drafts WHERE style_iid = p_iid;
  RETURN v_now;
END;
$$;

-- Make one theme the active one (NULL = none: the built-in default look).
CREATE OR REPLACE FUNCTION public.set_active_popup_theme(p_iid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- NULL-safe: is_owner() is NULL (not false) with no signed-in user.
  IF NOT COALESCE(public.is_owner(), false) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  IF p_iid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.popup_styles
    WHERE iid = p_iid AND kind = 'theme' AND archived_at IS NULL AND published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not_activatable' USING ERRCODE = 'P0001';
  END IF;

  -- Off first, then on: the one-active index never sees two.
  UPDATE public.popup_styles SET is_active = false
  WHERE is_active AND iid IS DISTINCT FROM p_iid;

  IF p_iid IS NOT NULL THEN
    UPDATE public.popup_styles SET is_active = true WHERE iid = p_iid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_popup_style(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_active_popup_theme(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_popup_style(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_popup_theme(uuid) TO authenticated;

-- content-videos: the same video list /api/editor/upload stores.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['video/mp4', 'video/x-m4v', 'video/webm', 'video/quicktime', 'video/ogg']
WHERE id = 'content-videos' AND allowed_mime_types IS NULL;
