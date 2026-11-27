import type { Metadata } from "next";
import { TouchModeRoot } from "@/components/admin/TouchModeRoot";

// Every /admin page: own tab title, never indexed. Pages that are client
// components can't export metadata, so each route has a tiny layout below.
export const metadata: Metadata = {
  title: { default: "Admin · Creatofolio", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* iPad / touch mode: <html data-touch> + long-press labels. */}
      <TouchModeRoot />
      {children}
    </>
  );
}
