"use client";

import { useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";

const FOCUS_CHECK_MIN_MS = 30_000;

/**
 * Keeps sessionStore.lost in step with the real auth state. Cookie sessions
 * from @supabase/ssr don't reliably fire cross-tab auth events, so the check
 * on window focus / tab-visible (throttled) is the real mechanism.
 */
export function useOwnerSessionWatch(): void {
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { markLost, markOk } = useSessionStore.getState();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (event !== "INITIAL_SESSION" && !session)) {
        markLost();
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        markOk();
      }
    });

    let lastCheck = 0;
    const check = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastCheck < FOCUS_CHECK_MIN_MS) return;
      lastCheck = now;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) markOk();
      else markLost();
    };
    const onFocus = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    void check(true);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
