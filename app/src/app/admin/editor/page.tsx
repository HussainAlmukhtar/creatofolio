"use client";

import dynamic from "next/dynamic";
import { Toaster } from "sonner";

// Konva needs window — lazy load to avoid SSR issues
const EditorWrapper = dynamic(
  () => import("@/components/editor/EditorWrapper"),
  { ssr: false }
);

export default function EditorPage() {
  return (
    <>
      <EditorWrapper />
      <Toaster richColors position="bottom-right" theme="dark" />
    </>
  );
}
