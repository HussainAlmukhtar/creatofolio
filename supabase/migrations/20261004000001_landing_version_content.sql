-- Migration — per-version button pop-up content + atomic publish.
--
-- Before: button pop-up content (website_page_content) was shared by every
-- version of a page and written on every page Save. A draft's content edits
-- therefore reached visitors as soon as the page was published, and Save's
-- "the live site is unchanged" toast was not true for content.
--
-- After: each version carries its own content map
--   website_page_versions.content = { "<asset iid>": ObjectContent, ... }
-- Save writes it with the version; Publish copies it into website_page_content
-- (what the public read path serves) in the SAME transaction as the page row,
-- via public.publish_landing_version(). NULL content = a version saved by an
-- older editor: publishing it leaves the live content rows alone.
--
-- The function is SECURITY INVOKER (RLS still applies); the explicit
-- is_owner() check turns "RLS filtered it to 0 rows" into a loud 42501.
-- The editor feature-detects this (column missing → 42703, function missing
-- → PGRST202) and falls back to its old behaviour until this is applied.

-- 1. Per-version content map: { "<asset iid>": ObjectContent, ... }
ALTER TABLE website_page_versions ADD COLUMN IF NOT EXISTS content JSONB;

-- Backfill: every version starts with the page's current (live) content rows.
UPDATE website_page_versions v
SET content = COALESCE((
  SELECT jsonb_object_agg(c.asset_iid::text, c.content)
  FROM website_pages p
  JOIN website_page_content c ON c.page_slug = p.id
  WHERE p.iid = v.page_iid
), '{}'::jsonb)
WHERE v.content IS NULL;

-- 2. Atomic publish: page row + live content + version stamp in ONE
--    transaction. SECURITY INVOKER so RLS still applies; the explicit
--    is_owner() check turns "0 rows" into a loud error.
CREATE OR REPLACE FUNCTION public.publish_landing_version(p_slug text, p_version_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_config  jsonb;
  v_content jsonb;
  v_schema  int;
  v_now     timestamptz := now();
BEGIN
  IF NOT public.is_owner() THEN
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
$$;

REVOKE ALL ON FUNCTION public.publish_landing_version(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_landing_version(text, uuid) TO authenticated;
