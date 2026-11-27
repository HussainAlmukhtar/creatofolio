-- Migration — saved pop-up presets + template steps.
--
-- popup_presets            "Save as preset" in the pop-up composer: a named
--                          copy of a pop-up's body (blocks / pages / size /
--                          frame) to start new pop-ups from. Editor-only, so
--                          owner-only for every command, reads included. A
--                          preset is a convenience copy, not a drawing: it
--                          CAN be deleted (the editor asks first). The
--                          built-in presets live in code (data/popupPresets.ts).
-- object_templates.behaviour  a template's "When clicked…" / "walks near"
--                          steps, hover intensity, "starts hidden", the
--                          Character kind and the source object's iid (so a
--                          drop re-points self-references at the new object).
--                          Nullable; the table's existing policies cover it.
--
-- No functions. Additive only: a new table with its own policy, one new
-- nullable column. is_owner(), owner_mfa_satisfied() and every existing
-- policy are untouched. The editor feature-detects both (42P01 / PGRST205 →
-- "Save as preset" hidden; 42703 / PGRST204 → templates save without steps,
-- with a toast saying so).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.popup_presets;
--   ALTER TABLE public.object_templates DROP COLUMN IF EXISTS behaviour;

CREATE TABLE IF NOT EXISTS public.popup_presets (
  iid         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT '',
  name_ar     TEXT NOT NULL DEFAULT '',
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.popup_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS popup_presets_owner_all ON public.popup_presets;
CREATE POLICY popup_presets_owner_all ON public.popup_presets
  FOR ALL TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

ALTER TABLE public.object_templates ADD COLUMN IF NOT EXISTS behaviour JSONB;
