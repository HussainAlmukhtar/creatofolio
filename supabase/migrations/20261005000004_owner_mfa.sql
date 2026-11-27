-- Migration — require two-factor (aal2) for owner writes.
--
-- Safe to apply with the rest. It CHANGES public.is_owner(), which every owner
-- RLS policy and RPC calls, but it is a no-op until the owner has a verified
-- authenticator (enrolled on /admin/security). From then on an owner session
-- that is still aal1 (password only) fails every owner write until it signs in
-- again with a code. The app already enforces the same rule in proxy.ts and
-- getOwnerUser() (lib/mfa.ts); this is the second wall: it stops a stolen
-- password session from writing straight to the database with the public anon
-- key.
--
-- Behaviour:
--   owner_mfa_satisfied()  true when the caller has NO verified factor in
--                          auth.mfa_factors (2FA not enrolled → password only,
--                          as today), or their JWT says aal = 'aal2'.
--   is_owner()             unchanged email check AND owner_mfa_satisfied().
--
-- owner_mfa_satisfied() is SECURITY DEFINER (it reads the auth schema) with an
-- empty search_path. Default EXECUTE (PUBLIC) is kept on purpose: is_owner() is
-- evaluated by whichever role runs a query, and the function only reports on
-- the caller's own session (anon has no uid → true, but is_owner's email check
-- still fails for anon).
--
-- ROLLBACK (restores the definition from 20260509000001_admin_rls_hardening.sql):
--
--   CREATE OR REPLACE FUNCTION public.is_owner()
--     RETURNS boolean
--     LANGUAGE sql
--     STABLE
--     SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--   AS $$
--     SELECT lower(auth.jwt() ->> 'email') = (SELECT lower(email) FROM public.app_owner LIMIT 1)
--   $$;
--   -- (optional) DROP FUNCTION public.owner_mfa_satisfied();
--
-- Lost authenticator? Delete the factor server-side instead of rolling back:
-- see docs/ops/ACCOUNT_RECOVERY.md.

CREATE OR REPLACE FUNCTION public.owner_mfa_satisfied()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM auth.mfa_factors f
      WHERE f.user_id = auth.uid()
        AND f.status = 'verified'
    )
    OR COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT lower(auth.jwt() ->> 'email') = (SELECT lower(email) FROM public.app_owner LIMIT 1)
     AND public.owner_mfa_satisfied()
$$;
