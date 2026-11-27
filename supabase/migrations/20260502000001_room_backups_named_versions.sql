-- Named saved versions for room_backups.
-- Adds label (human name for pinned snapshots) and is_pinned (exempt from
-- the 20-backup rolling window). Auto-backups have label=NULL, is_pinned=FALSE.

ALTER TABLE room_backups
  ADD COLUMN IF NOT EXISTS label     TEXT,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS room_backups_pinned_idx
  ON room_backups (room_iid, is_pinned, saved_at DESC);
