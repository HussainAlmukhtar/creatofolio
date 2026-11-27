"use client";

// Read-only JSON inspector.
//
// Open with Ctrl+J. Shows the JSON of whatever is selected (object > entry
// point > current room, in that priority). Replaces the console.log workflow
// for "wait, why is this shape weird?" debugging. Read-only on purpose —
// editing JSON directly would be a separate power tool; this one's just visibility.

import { useEffect, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { Tooltip } from "@/components/editor/EditorTooltip";

interface Props {
  onClose: () => void;
}

export function JsonInspectorPanel({ onClose }: Props) {
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const selectedEntryPointId = useEditorStore((s) => s.selectedEntryPointId);
  const [copied, setCopied] = useState(false);

  // Pick the "most specific" thing the user has in focus. Object beats
  // entry-point beats whole-room — same priority the side panel uses, so
  // the inspector mirrors what the user is "looking at."
  const { kind, payload } = (() => {
    if (!currentRoomConfig)
      return { kind: "nothing loaded", payload: null as unknown };
    if (selectedObjectId) {
      const obj = currentRoomConfig.objects.find(
        (o) => o.id === selectedObjectId
      );
      if (obj) return { kind: `object: ${obj.label || obj.id}`, payload: obj };
    }
    if (selectedEntryPointId) {
      const ep = currentRoomConfig.entryPoints.find(
        (e) => e.id === selectedEntryPointId
      );
      if (ep) return { kind: `entry point: ${ep.id}`, payload: ep };
    }
    return {
      kind: `room: ${currentRoomConfig.name ?? currentRoomConfig.id}`,
      payload: currentRoomConfig,
    };
  })();

  const json = payload ? JSON.stringify(payload, null, 2) : "(nothing selected)";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  };

  // Esc closes — matches every other modal/panel in the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="w-72 flex-shrink-0 border-l border-neutral-700 bg-neutral-900 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-2 py-1.5 border-b border-neutral-700">
        <div className="text-xs font-medium text-neutral-200">
          JSON Inspector
        </div>
        <div className="flex items-center gap-1">
          <Tooltip label={copied ? "Copied!" : "Copy JSON to clipboard"}>
            <button
              onClick={handleCopy}
              className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
              aria-label="Copy JSON to clipboard"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </Tooltip>
          <Tooltip label="Close inspector" shortcut="Ctrl+J">
            <button
              onClick={onClose}
              className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
              aria-label="Close JSON inspector"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </header>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500 border-b border-neutral-800">
        {kind}
      </div>
      <pre className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-snug text-neutral-200 whitespace-pre">
        {json}
      </pre>
    </div>
  );
}
