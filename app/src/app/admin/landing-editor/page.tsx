"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

// Renders the real DrawnSection components (which pull in client-only bits);
// lazy-load with ssr:false to match the room editor's recipe.
const LandingEditorWrapper = dynamic(
  () => import("@/components/landing-editor/LandingEditorWrapper"),
  { ssr: false }
);

export default function LandingEditorPage() {
  return (
    <>
      <LandingEditorWrapper />
      <Toaster richColors position="bottom-right" theme="dark" />
    </>
  );
}
