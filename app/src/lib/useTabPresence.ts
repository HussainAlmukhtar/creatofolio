"use client";

import { useEffect, useState } from "react";

// Same-browser "this is open in another tab" detector. Cheap, and it catches
// the common way two saves collide (the same room/draft open twice). It can't
// see other devices; the save-time conflict check (updated_at) covers those.

const CHANNEL = "creatofolio-admin-presence";

type Msg =
  | { t: "hello" | "here" | "bye"; surface: string; id: string; tabId: string };

/**
 * @param surface which editor ("room" | "landing")
 * @param id what is open in it (room slug, or `${slug}:${versionId}`); null = nothing
 * @returns true while another tab in this browser has the same surface + id open
 */
export function useTabPresence(surface: "room" | "landing", id: string | null): boolean {
  const [peers, setPeers] = useState<string[]>([]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !id) return;
    const tabId = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(CHANNEL);
    const known = new Set<string>();
    const publish = () => setPeers([...known]);

    channel.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (!m || m.surface !== surface || m.id !== id || m.tabId === tabId) return;
      if (m.t === "hello") {
        known.add(m.tabId);
        channel.postMessage({ t: "here", surface, id, tabId } satisfies Msg);
      } else if (m.t === "here") {
        known.add(m.tabId);
      } else {
        known.delete(m.tabId);
      }
      publish();
    };

    channel.postMessage({ t: "hello", surface, id, tabId } satisfies Msg);
    const onHide = () => channel.postMessage({ t: "bye", surface, id, tabId } satisfies Msg);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
      channel.close();
      // Switching to another id: the old peers no longer apply.
      setPeers([]);
    };
  }, [surface, id]);

  return peers.length > 0;
}
