"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

// /admin/popup-styles: the pop-up theme + frame library (gated by
// src/proxy.ts like everything under /admin; RLS gates every write).
const PopupStylesPage = dynamic(() => import("@/components/popup-styles/PopupStylesPage"), {
  ssr: false,
});

export default function Page() {
  return (
    <Suspense>
      <PopupStylesPage />
    </Suspense>
  );
}
