"use client";

import dynamic from "next/dynamic";
import type { DrawEditTarget } from "./DrawModalInner";

interface DrawModalProps {
  onClose: () => void;
  onLibraryUpdated: () => void;
  editTarget?: DrawEditTarget;
}

const DrawModalInner = dynamic(() => import("./DrawModalInner"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="text-neutral-400 text-sm">Loading drawing studio…</div>
    </div>
  ),
});

export function DrawModal(props: DrawModalProps) {
  return <DrawModalInner {...props} />;
}

export type { DrawEditTarget };
