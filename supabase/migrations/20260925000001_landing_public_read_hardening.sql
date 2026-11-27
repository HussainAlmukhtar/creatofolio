-- Landing CMS: stop leaking drafts and hidden sections to anonymous visitors.
--
-- Before this migration every website_* table had an anon SELECT policy of
-- USING (true), so anyone holding the (public) anon key could read DRAFT pages,
-- sections the owner had hidden, sections scheduled for a future launch, and
-- the owner's private section templates straight from the REST API — the
-- "published" / "hidden" flags were display-only.
--
-- After:
--   - website_pages: no anon read. Visitors go through
--     get_published_landing_page(slug) / list_published_landing_pages(), which
--     return ONLY published rows with non-public sections stripped server-side
--     (hidden, not started yet, or ended — the same rules as
--     app/src/data/sectionVisibility.ts; the arcade section is exempt).
--   - website_page_content: anon may read a row only when its page is
--     published AND its asset isn't inside a stripped section.
--   - website_section_templates: owner only (editor-only data).
--   - website_page_backups / website_site_config: unchanged.
-- The owner keeps full read/write through the existing *_owner_write
-- FOR ALL policies (FOR ALL includes SELECT).

-- Timestamp parse that returns NULL on garbage instead of raising, so one
-- malformed schedule value can't take the whole page down.
CREATE OR REPLACE FUNCTION public.landing_safe_ts(value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF value IS NULL OR value = '' THEN
    RETURN NULL;
  END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Is this section shown to visitors right now? Mirrors
-- isSectionPubliclyVisible(): containsGame always; else not hidden and inside
-- [startISO, endISO). hiddenOn (per-device) is NOT stripped — it's resolved in
-- CSS on the client because the server can't know the device.
CREATE OR REPLACE FUNCTION public.landing_section_is_public(section jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    COALESCE((section->>'containsGame')::boolean, false)
    OR (
      NOT COALESCE((section->>'hidden')::boolean, false)
      AND COALESCE(public.landing_safe_ts(section->'schedule'->>'startISO') <= now(), true)
      AND COALESCE(public.landing_safe_ts(section->'schedule'->>'endISO') > now(), true)
    );
$$;

-- A page config with non-public sections removed (order preserved).
CREATE OR REPLACE FUNCTION public.landing_public_config(config jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_set(
    config,
    '{sections}',
    COALESCE(
      (
        SELECT jsonb_agg(s.section ORDER BY s.ord)
        FROM jsonb_array_elements(COALESCE(config->'sections', '[]'::jsonb))
          WITH ORDINALITY AS s(section, ord)
        WHERE public.landing_section_is_public(s.section)
      ),
      '[]'::jsonb
    )
  );
$$;

-- Public page read. SECURITY DEFINER so it can read website_pages even though
-- anon no longer can; it only ever returns published, stripped configs.
CREATE OR REPLACE FUNCTION public.get_published_landing_page(page_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.landing_public_config(p.config)
  FROM public.website_pages p
  WHERE p.id = page_slug AND p.status = 'published';
$$;

-- Slugs + last-modified of every published page (sitemap.xml).
CREATE OR REPLACE FUNCTION public.list_published_landing_pages()
RETURNS TABLE (slug text, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.updated_at
  FROM public.website_pages p
  WHERE p.status = 'published'
  ORDER BY p.id;
$$;

-- Content-row gate: page published, and the asset isn't in a stripped section.
-- (An asset iid that appears in NO section is allowed — actions may point at
-- content keyed by any iid; what we refuse is content of a hidden section.)
CREATE OR REPLACE FUNCTION public.landing_content_is_public(page_slug text, asset_iid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.website_pages p
    WHERE p.id = page_slug
      AND p.status = 'published'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p.config->'sections', '[]'::jsonb)) AS s(section)
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.section->'assets', '[]'::jsonb)) AS a(asset)
        WHERE NOT public.landing_section_is_public(s.section)
          AND a.asset->>'iid' = asset_iid
      )
  );
$$;

REVOKE ALL ON FUNCTION public.get_published_landing_page(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_published_landing_pages() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.landing_content_is_public(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_landing_page(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_published_landing_pages() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landing_content_is_public(text, text) TO anon, authenticated;

-- website_pages: owner only (via website_pages_owner_write FOR ALL).
DROP POLICY IF EXISTS website_pages_anon_read ON website_pages;

-- website_page_content: public only for published, visible content.
DROP POLICY IF EXISTS website_page_content_anon_read ON website_page_content;
CREATE POLICY website_page_content_anon_read ON website_page_content
  FOR SELECT TO anon, authenticated
  USING (public.landing_content_is_public(page_slug, asset_iid::text));

-- website_section_templates: owner only (via *_owner_write FOR ALL).
DROP POLICY IF EXISTS website_section_templates_anon_read ON website_section_templates;
