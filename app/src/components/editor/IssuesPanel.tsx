"use client";

// Issues panel — Twine storygraph warnings + Unreal Map Check.
// Scans every loaded room config and surfaces broken navigation, missing
// targets, empty external URLs, and orphan rooms. Each issue is "findable":
// click it to jump to the offending object.

import { useEffect, useMemo, useState } from "react";
import { X, AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import type { RoomId, WorldConfig } from "@/data/roomTypes";
import { runIntegrityCheck, type Issue } from "@/lib/integrityCheck";
import { loadDefaultWorld } from "@/lib/editorData";
import { Tooltip } from "@/components/editor/EditorTooltip";

interface IssuesPanelProps {
  onClose: () => void;
}

export function IssuesPanel({ onClose }: IssuesPanelProps) {
  const allRooms = useEditorStore((s) => s.allRooms);
  const currentRoomId = useEditorStore((s) => s.currentRoomId);
  const currentRoomConfig = useEditorStore((s) => s.currentRoomConfig);
  const loadRoom = useEditorStore((s) => s.loadRoom);
  const selectObject = useEditorStore((s) => s.selectObject);
  const selectEntryPoint = useEditorStore((s) => s.selectEntryPoint);

  // Use the live current room config so unsaved fixes reflect immediately.
  const merged = useMemo(() => {
    if (!currentRoomId || !currentRoomConfig) return allRooms;
    return { ...allRooms, [currentRoomId]: currentRoomConfig };
  }, [allRooms, currentRoomId, currentRoomConfig]);

  // Load the default world once so the gridvania-aware orphan check can fire.
  // Cheap (one row) — and the result is reused across re-scans via useMemo.
  const [world, setWorld] = useState<WorldConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadDefaultWorld().then((w) => {
      if (!cancelled) setWorld(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const contentMap = useEditorStore((st) => st.contentMap);
  const issues = useMemo(
    () => runIntegrityCheck(merged, world, contentMap),
    [merged, world, contentMap]
  );

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const handleJump = (issue: Issue) => {
    if (issue.roomId !== currentRoomId) {
      loadRoom(issue.roomId as RoomId);
      // Defer so loadRoom's clear-selection effect doesn't undo our select.
      setTimeout(() => {
        if (issue.objectId) selectObject(issue.objectId);
        else if (issue.entryPointId) selectEntryPoint(issue.entryPointId);
      }, 0);
    } else {
      if (issue.objectId) selectObject(issue.objectId);
      else if (issue.entryPointId) selectEntryPoint(issue.entryPointId);
    }
  };

  return (
    <div className="h-64 bg-neutral-900 border-t border-neutral-700 flex flex-col flex-shrink-0">
      <header className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <h2 className="text-sm font-medium flex items-center gap-2">
          Issues
          <span className="text-[10px] text-neutral-400">
            {errors.length} error{errors.length === 1 ? "" : "s"}
            {" · "}
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          <Tooltip label="Re-scan (already live — issues update as you edit)">
            <button
              onClick={() => {
                // Memo recomputes via dependency on `merged`; nothing else to
                // do — this button is a visual reassurance that the scan is
                // live.
              }}
              className="p-1 rounded hover:bg-neutral-700 text-neutral-300"
              aria-label="Refresh"
            >
              <RefreshCw size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Close">
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-neutral-700 text-neutral-300"
              aria-label="Close issues panel"
            >
              <X size={14} />
            </button>
          </Tooltip>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {issues.length === 0 ? (
          <div className="text-xs text-green-400 text-center py-6">
            ✓ No issues found across {Object.keys(merged).length} rooms.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {[...errors, ...warnings].map((issue) => (
              <li
                key={issue.id}
                onClick={() => handleJump(issue)}
                className="px-3 py-2 hover:bg-neutral-800 cursor-pointer flex items-start gap-2 text-xs"
                title="Click to jump to this object"
              >
                {issue.severity === "error" ? (
                  <AlertCircle
                    size={14}
                    className="text-red-400 flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <AlertTriangle
                    size={14}
                    className="text-amber-400 flex-shrink-0 mt-0.5"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-neutral-200 truncate">
                    {issue.message}
                  </div>
                  {issue.description && (
                    <div className="text-[10px] text-neutral-500 mt-0.5">
                      {issue.description}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-neutral-500 flex-shrink-0">
                  {merged[issue.roomId]?.name ?? issue.roomId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
