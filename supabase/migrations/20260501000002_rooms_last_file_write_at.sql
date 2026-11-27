-- Migration — rooms.last_file_write_at
--
-- Added so the editor can detect drift between the DB row and the on-disk
-- JSON file. Only meaningful when the world has externalFilesEnabled = true.
-- The editor sets this column from the client right after a successful
-- /api/editor/world-file POST, so a "DB updated_at > last_file_write_at"
-- signal means somebody changed the DB outside the file-mirror flow
-- (Supabase dashboard, another tab, raw SQL).
--
-- Nullable on purpose: legacy rows have never been file-mirrored and the
-- comparison is intentionally false-y (we only flag drift for rows where
-- both timestamps exist).

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS last_file_write_at timestamptz;
