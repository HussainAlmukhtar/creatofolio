"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

// /admin/storage — what's using space, and the files nothing points at. Gated
// by src/proxy.ts like everything under /admin; the data comes from the
// owner-only /api/admin/storage/* routes.
const StoragePanel = dynamic(() => import("@/components/admin/StoragePanel"), {
  ssr: false,
});

export default function AdminStoragePage() {
  return (
    <>
      <StoragePanel />
      <Toaster richColors position="bottom-right" theme="dark" />
    </>
  );
}
