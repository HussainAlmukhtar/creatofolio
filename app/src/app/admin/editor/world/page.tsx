"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

// WorldView uses the same Konva stack as EditorCanvas — lazy load to avoid SSR.
const WorldView = dynamic(
  () => import("@/components/editor/WorldView"),
  { ssr: false }
);

export default function WorldPage() {
  return (
    <>
      <WorldView />
      <Toaster richColors position="bottom-right" theme="dark" />
    </>
  );
}
