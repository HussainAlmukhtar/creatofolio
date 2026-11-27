"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

// /admin — the owner's landing spot after login. A hub that links out to
// every CMS surface (room editor, world map, landing-page editor, wardrobe).
// Gated by src/proxy.ts like everything under /admin. Client-only to match
// the other admin pages (the data loaders use the browser Supabase client).
const AdminDashboard = dynamic(
  () => import("@/components/admin/AdminDashboard"),
  { ssr: false }
);

export default function AdminDashboardPage() {
  return (
    <>
      <AdminDashboard />
      <Toaster richColors position="bottom-right" theme="dark" />
    </>
  );
}
