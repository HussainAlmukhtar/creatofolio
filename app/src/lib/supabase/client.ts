// Supabase browser client — used by editor components and game data loading.
//
// Uses @supabase/ssr so cookie-based sessions (set on login) flow automatically
// into every query. Without this, the admin editor hits RLS as anon and every
// write is silently rejected.

import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  client = createBrowserClient(url, anonKey) as unknown as SupabaseClient;
  return client;
}

/** Check if Supabase is configured */
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Re-export cookie type so callers importing from this module can type their
// custom cookie handlers if they wrap the client elsewhere.
export type { CookieOptions };
