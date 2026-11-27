"use client";

// /admin/landing-editor/preview/<slug> — owner-only draft preview. Renders a
// page through the REAL public components (LandingPage for home, SubPageView
// otherwise) so the owner sees exactly what visitors will once it's published:
// scroll animations, language toggle, site header/footer and all.
//
// Gated by src/proxy.ts like everything under /admin. Client-only
// (ssr:false) to match the admin recipe and because the home page pulls in
// Phaser; see LandingPreview for the two data sources.

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const LandingPreview = dynamic(
  () => import("@/components/landing-editor/LandingPreview"),
  { ssr: false }
);

export default function LandingPreviewPage() {
  const { slug } = useParams<{ slug: string }>();
  return <LandingPreview slug={slug} />;
}
