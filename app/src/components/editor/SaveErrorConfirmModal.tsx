"use client";

// Save-time integrity guard.
//
// The IssuesPanel already lists problems passively. The LDtk move that makes
// it impossible to ship a broken room: when Save runs and the *current room*
// has hard errors (not warnings), surface a confirm dialog naming each one.
// The user can still Save Anyway — we don't block work — but they have to
// acknowledge the breakage. Warnings still pass silently, the panel covers
// those.

import { useEffect } from "react";
import type { Issue } from "@/lib/integrityCheck";
import { useEditorStore } from "@/stores/editorStore";

interface Props {
  errors: Issue[];
  /** What the user is about to do: default Save; Publish for the room Publish button. */
  verb?: "Save" | "Publish";
  onConfirm: () => void;
  onCancel: () => void;
}

export function SaveErrorConfirmModal({ errors, verb = "Save", onConfirm, onCancel }: Props) {
  const selectObject = useEditorStore((s) => s.selectObject);
  const selectEntryPoint = useEditorStore((s) => s.selectEntryPoint);

  // Esc cancels; Enter confirms — the standard modal contract. Wired via the
  // window so the modal works even when focus hasn't landed inside it yet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-white">
          {verb} with {errors.length} unresolved {errors.length === 1 ? "error" : "errors"}?
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          The integrity check found problems in this room. You can still{" "}
          {verb.toLowerCase()} — nothing is blocked —{" "}
          {verb === "Publish"
            ? "but visitors will see the problems."
            : "but the issues will follow your data."}
        </p>

        <ul className="mt-3 max-h-64 overflow-y-auto rounded border border-neutral-800 bg-neutral-950 p-2 text-xs">
          {errors.map((err) => (
            <li
              key={err.id}
              className="cursor-pointer rounded px-2 py-1.5 hover:bg-neutral-800"
              onClick={() => {
                // Jump-to-fix: select the offending object/entry point so when
                // the user cancels they land in front of the broken thing.
                if (err.objectId) selectObject(err.objectId);
                else if (err.entryPointId) selectEntryPoint(err.entryPointId);
                onCancel();
              }}
              title={`Click to jump to this issue and cancel the ${verb.toLowerCase()}`}
            >
              <div className="text-red-400">{err.message}</div>
              {err.description && (
                <div className="mt-0.5 text-[10px] text-neutral-500">
                  {err.description}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
          >
            Cancel (Esc)
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
          >
            {verb} anyway (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
