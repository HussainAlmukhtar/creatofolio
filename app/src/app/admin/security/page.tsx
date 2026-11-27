"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

// /admin/security — two-factor authenticators + password change. Gated by
// src/proxy.ts like everything under /admin. Client-only: it talks to the
// browser Supabase auth client (mfa.*, updateUser).
const SecurityPanel = dynamic(() => import("@/components/admin/SecurityPanel"), {
  ssr: false,
});

export default function AdminSecurityPage() {
  return (
    <>
      <SecurityPanel />
      <Toaster richColors position="bottom-right" theme="dark" />
    </>
  );
}
