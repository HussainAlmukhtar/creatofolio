// The one account that may edit the site, from the OWNER_EMAIL environment
// variable. It must match the row in public.app_owner (see
// supabase/migrations/20260501000001_admin_rls.sql): this check gates the
// /admin pages and API routes, the database row gates the writes themselves.
// Server-only: don't import from client components, and never rename the
// variable to NEXT_PUBLIC_* (that would put the address in public JS bundles).
// Unset = nobody is the owner = /admin stays closed.
export const OWNER_EMAIL = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!OWNER_EMAIL && !!email && email.trim().toLowerCase() === OWNER_EMAIL;
}
