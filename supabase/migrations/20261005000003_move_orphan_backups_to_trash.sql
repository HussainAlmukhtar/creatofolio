-- Migration — move orphaned page backups into "Recently deleted".
--
-- Pages deleted before the trash existed left their website_page_backups rows
-- behind (history for a page that no longer exists). This moves each such
-- group into deleted_items as ONE entry per missing page iid:
--   kind = 'page', label = '<slug from the newest backup> (history only)',
--   payload = { page: null, versions: [], content: [], backups: [<rows>] }
-- restore_deleted_item() rebuilds an OFFLINE page from the newest backup for
-- such an entry. deleted_at is the newest backup's saved_at (the real delete
-- time is unknown). Orphaned room_backups are not touched; rooms deleted from
-- now on go through trash_room.
--
-- MOVES data (copy into deleted_items, then delete the orphan rows): back up
-- website_page_backups before applying. Idempotent: a second run finds no
-- orphans.

WITH orphan AS (
  SELECT b.*
  FROM public.website_page_backups b
  WHERE NOT EXISTS (SELECT 1 FROM public.website_pages p WHERE p.iid = b.page_iid)
),
moved AS (
  INSERT INTO public.deleted_items (kind, label, payload, deleted_at)
  SELECT
    'page',
    COALESCE((array_agg(o.config->>'slug' ORDER BY o.saved_at DESC))[1], o.page_iid::text)
      || ' (history only)',
    jsonb_build_object(
      'page', NULL,
      'versions', '[]'::jsonb,
      'content', '[]'::jsonb,
      'backups', jsonb_agg(to_jsonb(o) ORDER BY o.saved_at)
    ),
    max(o.saved_at)
  FROM orphan o
  GROUP BY o.page_iid
  RETURNING 1
)
DELETE FROM public.website_page_backups b
WHERE b.id IN (SELECT id FROM orphan);
