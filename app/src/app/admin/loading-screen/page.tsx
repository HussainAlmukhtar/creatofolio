"use client";

import dynamic from "next/dynamic";

// /admin/loading-screen: the loading screen visitors see while the site
// loads (gated by src/proxy.ts like everything under /admin; RLS gates the
// site-settings write).
const LoadingScreenEditor = dynamic(() => import("@/components/loading-screen/LoadingScreenEditor"), {
  ssr: false,
});

export default function Page() {
  return <LoadingScreenEditor />;
}
