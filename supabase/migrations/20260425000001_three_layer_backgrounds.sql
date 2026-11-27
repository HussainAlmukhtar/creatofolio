-- Migration: rename single bgImageUrl/bgOriginalPath/bgCrop into per-layer
-- triplets (back / middle / front) and add foregroundEffect support.
--
-- Run this once in the Supabase SQL editor against any existing rooms table.
-- Idempotent: only rooms that still have the legacy field are touched.

UPDATE rooms
SET config = jsonb_strip_nulls(
  (config
    - 'bgImageUrl'
    - 'bgOriginalPath'
    - 'bgCrop'
  )
  || jsonb_build_object(
       'bgMiddleUrl',          config->'bgImageUrl',
       'bgMiddleOriginalPath', config->'bgOriginalPath',
       'bgMiddleCrop',         config->'bgCrop'
     )
)
WHERE config ? 'bgImageUrl'
   OR config ? 'bgOriginalPath'
   OR config ? 'bgCrop';

-- Drawing Studio snapshots used target_id = 'room' for the single background.
-- Move them to 'background_middle' so future back/front snapshots can coexist.
-- The existing CHECK on target_kind already permits any string for target_id.
UPDATE drawing_scenes
SET target_id = 'background_middle'
WHERE target_kind = 'background'
  AND target_id = 'room';
