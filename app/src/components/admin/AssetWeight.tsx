"use client";

// "Room weight: 3.4 MB" — a traffic-light total of the Storage files a room or
// landing page loads, with the heaviest files one click away. Sizes come from
// cached HEAD requests (lib/assetWeight), so it's cheap to leave mounted.

import { useEffect, useMemo, useState } from "react";
import {
  measureAssets,
  weightTone,
  formatBytes,
  type WeightReport,
} from "@/lib/assetWeight";

const TONE_CLASS = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
} as const;

export function AssetWeight({
  label,
  urls,
}: {
  label: string;
  urls: string[];
}) {
  // Stable identity: only re-measure when the set of files changes.
  const key = useMemo(() => [...urls].sort().join("\n"), [urls]);
  const [report, setReport] = useState<WeightReport | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    // Debounced: dragging a slider or typing mustn't fire a HEAD burst.
    const t = setTimeout(() => {
      void measureAssets(key ? key.split("\n") : []).then((r) => {
        if (live) setReport(r);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);

  if (!report) {
    return <div className="text-xs text-neutral-500">{label}: measuring…</div>;
  }
  const tone = weightTone(report.total);
  return (
    <div className="text-xs" data-testid="asset-weight">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="text-neutral-400">
          {label}:{" "}
          <span className={`font-medium ${TONE_CLASS[tone]}`}>
            {formatBytes(report.total)}
          </span>
          {report.unknown > 0 && (
            <span className="text-neutral-500"> (+{report.unknown} unmeasured)</span>
          )}
        </span>
        <span className="text-neutral-500">{open ? "Hide" : "Largest files"}</span>
      </button>
      {tone !== "green" && (
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {tone === "amber"
            ? "Getting heavy for phones; consider smaller images."
            : "Too heavy for most phones; shrink the biggest files."}
        </p>
      )}
      {open && (
        <ul className="mt-1 space-y-0.5">
          {report.files.slice(0, 8).map((f) => (
            <li key={f.url} className="flex justify-between gap-2 text-[11px] text-neutral-400">
              <span className="truncate" title={f.url}>
                {decodeURIComponent(f.url.split("/").slice(-2).join("/"))}
              </span>
              <span className="shrink-0 tabular-nums">{formatBytes(f.bytes)}</span>
            </li>
          ))}
          {report.files.length === 0 && (
            <li className="text-[11px] text-neutral-500">No uploaded files.</li>
          )}
        </ul>
      )}
    </div>
  );
}
