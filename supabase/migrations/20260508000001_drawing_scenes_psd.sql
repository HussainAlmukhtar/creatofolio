-- Migration — Klecks PSD persistence for Drawing Studio scenes.
--
-- Background: the Drawing Studio used to be tldraw-based and stored its
-- store snapshot as JSONB on `drawing_scenes.snapshot`. We've swapped the
-- editor to Klecks, which round-trips through PSD (binary) — too large to
-- inline in a JSONB column, so the PSD goes to a private Storage bucket
-- (`drawing-scenes`) and the table just stores the storage path.
--
-- The legacy `snapshot` column is kept (NULLable now) so old rows still
-- parse — they're abandoned in place. New writes set `psd_path` and leave
-- `snapshot` NULL.

-- ─── Add psd_path column ──────────────────────────────────────
ALTER TABLE drawing_scenes
  ADD COLUMN IF NOT EXISTS psd_path TEXT;

-- The legacy snapshot column is no longer required for new writes. Drop
-- the NOT NULL so PSD-only rows are valid.
ALTER TABLE drawing_scenes
  ALTER COLUMN snapshot DROP NOT NULL;

-- ─── Storage bucket: drawing-scenes (private, owner-only) ─────
-- PSDs are an editing artifact, not something players should fetch.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('drawing-scenes', 'drawing-scenes', false)
  ON CONFLICT (id) DO NOTHING;

-- ─── Storage RLS policies ─────────────────────────────────────
-- Owner-only access. Mirrors the table-level scenes_owner_write policy in
-- 20260501000001_admin_rls.sql so that whoever can write the row can also
-- read/write the underlying PSD object.
DROP POLICY IF EXISTS "drawing_scenes_owner_all" ON storage.objects;
CREATE POLICY "drawing_scenes_owner_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'drawing-scenes' AND public.is_owner())
  WITH CHECK (bucket_id = 'drawing-scenes' AND public.is_owner());

-- No anon SELECT policy — drawing-scenes is fully private. Players never
-- need PSDs; they only consume the rendered PNG which lives on `sprites`
-- / `room-backgrounds` (public buckets).
