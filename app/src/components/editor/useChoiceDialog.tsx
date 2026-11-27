"use client";

// Multi-choice sibling of useDialog (which only does confirm / prompt): an
// in-app modal with a title, a message and 2-3 labelled buttons. Used for
// "this was changed somewhere else" conflicts. Usage:
//
//   const { choose, dialog } = useChoiceDialog();
//   const pick = await choose({
//     title: "…", body: "…",
//     options: [{ id: "keep", label: "Keep both", primary: true }, …],
//   });                               // null = dismissed (Escape / backdrop)
//   return <>{…}{dialog}</>;

import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ChoiceOption {
  id: string;
  label: string;
  /** Highlighted as the recommended action. */
  primary?: boolean;
  danger?: boolean;
}

export interface ChoiceRequest {
  title: string;
  body: string;
  options: ChoiceOption[];
}

interface Pending extends ChoiceRequest {
  resolve: (id: string | null) => void;
}

export function useChoiceDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  const choose = useCallback(
    (req: ChoiceRequest) =>
      new Promise<string | null>((resolve) => setPending({ ...req, resolve })),
    []
  );

  const close = (id: string | null) => {
    pending?.resolve(id);
    setPending(null);
  };

  const dialog = pending ? <ChoiceView pending={pending} onClose={close} /> : null;
  return { choose, dialog };
}

function ChoiceView({
  pending,
  onClose,
}: {
  pending: Pending;
  onClose: (id: string | null) => void;
}) {
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => primaryRef.current?.focus(), []);

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => onClose(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-[460px] max-w-[90vw] rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose(null);
          }
        }}
      >
        <h2 id={titleId} className="text-sm font-semibold text-white">
          {pending.title}
        </h2>
        <p className="mt-2 whitespace-pre-line text-xs text-neutral-300">{pending.body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {pending.options.map((o) => (
            <button
              key={o.id}
              ref={o.primary ? primaryRef : undefined}
              onClick={() => onClose(o.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
                o.danger
                  ? "bg-red-600 hover:bg-red-500"
                  : o.primary
                    ? "bg-blue-600 hover:bg-blue-500"
                    : "border border-neutral-700 bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
