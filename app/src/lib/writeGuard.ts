// Turning Supabase write outcomes into honest WriteResults. Under RLS a
// non-owner UPDATE/DELETE "succeeds" with 0 rows; an INSERT/UPSERT fails with
// 42501. Both usually mean the session lapsed, so say so plainly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WriteResult } from "./editorData";
import { useSessionStore } from "@/stores/sessionStore";

export const SESSION_LOST_MESSAGE =
  "You're signed out (your session expired). Sign in again in a new tab, then retry. Your edits are still here.";

const FORBIDDEN_MESSAGE = "This account can't edit the site.";

export function isRlsDenied(
  e: { code?: string; message?: string } | null | undefined
): boolean {
  if (!e) return false;
  return e.code === "42501" || /row-level security/i.test(e.message ?? "");
}

/** No session → "session"; a session that isn't the owner → "forbidden"; else null. */
export async function denialFor(supabase: SupabaseClient): Promise<WriteResult | null> {
  return classifyDenial(supabase);
}

async function classifyDenial(
  supabase: SupabaseClient
): Promise<WriteResult | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    useSessionStore.getState().markLost();
    return { ok: false, code: "session", error: SESSION_LOST_MESSAGE };
  }
  try {
    const res = await fetch("/api/admin/whoami", { cache: "no-store" });
    if (res.ok) {
      const who = (await res.json()) as { owner?: boolean; mfaRequired?: boolean };
      if (who.mfaRequired) {
        // Password-only session of an account with 2FA: sign in again (code step).
        useSessionStore.getState().markLost();
        return { ok: false, code: "session", error: SESSION_LOST_MESSAGE };
      }
      if (!who.owner) {
        return { ok: false, code: "forbidden", error: FORBIDDEN_MESSAGE };
      }
    }
  } catch {
    /* can't tell — fall through to the caller's default */
  }
  return null;
}

/** Map a Supabase error from a write. 42501 / RLS text means session or not-owner. */
export async function writeErrorFor(
  supabase: SupabaseClient,
  error: { code?: string; message: string }
): Promise<WriteResult> {
  if (isRlsDenied(error)) {
    const denial = await classifyDenial(supabase);
    if (denial) return denial;
    return { ok: false, code: "forbidden", error: FORBIDDEN_MESSAGE };
  }
  return { ok: false, error: error.message };
}

/** An UPDATE/DELETE that touched 0 rows: session lost, else the row is gone. */
export async function noRowsResult(
  supabase: SupabaseClient,
  what: string
): Promise<WriteResult> {
  const denial = await classifyDenial(supabase);
  if (denial) return denial;
  return {
    ok: false,
    code: "not_found",
    error: `${what} wasn't found. It may have been changed or deleted in another tab. Reload and try again.`,
  };
}

/** An API route answered 403: the owner check failed, which almost always means the session lapsed. */
export function noteForbiddenResponse(res: Response): boolean {
  if (res.status !== 403) return false;
  useSessionStore.getState().markLost();
  return true;
}

/** Message for a failed API-route response; a 403 reads as "session expired". */
export function apiErrorMessage(
  res: Response,
  body: { error?: string } | null | undefined,
  fallback: string
): string {
  if (noteForbiddenResponse(res)) return SESSION_LOST_MESSAGE;
  return body?.error ?? fallback;
}
