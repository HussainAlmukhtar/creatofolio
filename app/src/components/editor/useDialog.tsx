"use client";

// In-app replacement for window.confirm / window.prompt. Native dialogs
// block the page, ignore the editor's styling and can't be driven by
// browser automation. Usage:
//
//   const { confirm, prompt, dialog } = useDialog();
//   if (!(await confirm("Delete it?", { danger: true }))) return;
//   const name = await prompt("New name:", "old");   // null = cancelled
//   …
//   return <>{…}{dialog}</>;

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface Pending {
  kind: "confirm" | "prompt";
  message: string;
  defaultValue: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (value: string | null) => void;
}

interface Options {
  confirmLabel?: string;
  danger?: boolean;
}

export function useDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  const open = useCallback(
    (kind: Pending["kind"], message: string, defaultValue: string, opts: Options) =>
      new Promise<string | null>((resolve) => {
        setPending({
          kind,
          message,
          defaultValue,
          confirmLabel: opts.confirmLabel ?? "OK",
          danger: opts.danger ?? false,
          resolve,
        });
      }),
    []
  );

  const confirm = useCallback(
    async (message: string, opts: Options = {}) =>
      (await open("confirm", message, "", opts)) !== null,
    [open]
  );

  const prompt = useCallback(
    (message: string, defaultValue = "", opts: Options = {}) =>
      open("prompt", message, defaultValue, opts),
    [open]
  );

  const close = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const dialog = pending ? (
    <DialogView key={pending.message + pending.defaultValue} pending={pending} onClose={close} />
  ) : null;

  return { confirm, prompt, dialog };
}

function DialogView({
  pending,
  onClose,
}: {
  pending: Pending;
  onClose: (value: string | null) => void;
}) {
  const [value, setValue] = useState(pending.defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (pending.kind === "prompt") inputRef.current?.select();
    else okRef.current?.focus();
  }, [pending.kind]);

  const submit = () => onClose(pending.kind === "prompt" ? value : "");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => onClose(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-[420px] max-w-[90vw] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose(null);
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            submit();
          }
        }}
      >
        <p id={titleId} className="whitespace-pre-line text-sm text-white">
          {pending.message}
        </p>
        {pending.kind === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-labelledby={titleId}
            className="mt-3 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => onClose(null)}
            className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            ref={okRef}
            onClick={submit}
            className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
              pending.danger ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
