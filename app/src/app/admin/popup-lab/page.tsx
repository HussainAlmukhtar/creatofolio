"use client";

import dynamic from "next/dynamic";

// /admin/popup-lab — owner-only QA bench for pop-ups (gated by src/proxy.ts
// like everything under /admin). Renders fixtures through the real visitor
// components; it never writes to the database.
const PopupLab = dynamic(() => import("@/components/admin/PopupLab"), {
  ssr: false,
});

export default function PopupLabPage() {
  return <PopupLab />;
}
