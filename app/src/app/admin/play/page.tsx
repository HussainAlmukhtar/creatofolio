"use client";

import dynamic from "next/dynamic";

// /admin/play: the owner plays the real game with their UNPUBLISHED room
// drafts (gated by src/proxy.ts like everything under /admin). Read-only:
// it never writes to the database. Phaser can't SSR, hence the dynamic import.
const PlayDraft = dynamic(() => import("@/components/admin/PlayDraft"), {
  ssr: false,
});

export default function PlayDraftPage() {
  return <PlayDraft />;
}
