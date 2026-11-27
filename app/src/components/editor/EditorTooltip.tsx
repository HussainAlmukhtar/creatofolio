"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Popover } from "radix-ui";
import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useTouchMode } from "@/lib/touchMode";

/** Mount once near the root of any subtree that uses <Tooltip> / <InfoTip>.
 *  Provider keeps a shared "skip delay" timer so moving between adjacent
 *  tooltips feels instant. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={60} skipDelayDuration={0}>
      {children}
    </RadixTooltip.Provider>
  );
}

interface TooltipProps {
  /** Tooltip text. If empty/null the wrapper renders children unchanged. */
  label: ReactNode;
  /** Optional keyboard shortcut shown as a small kbd chip (e.g. "Ctrl+S"). */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: ReactNode;
  /** When true (default) the trigger merges onto the child element via Radix
   *  Slot. Set false if the child can't forward refs (rare). */
  asChild?: boolean;
}

/** Hover/focus tooltip. Use to label icon-only controls or surface keyboard
 *  shortcuts. For prose-style explanations of a concept, prefer <InfoTip>.
 *  Touch screens never hover, so a string label is also put on the trigger
 *  as `data-tip`: a long-press shows it there (admin TouchModeRoot). */
export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  align = "center",
  children,
  asChild = true,
}: TooltipProps) {
  if (!label && !shortcut) return <>{children}</>;
  const tip =
    typeof label === "string" ? `${label}${shortcut ? ` (${shortcut})` : ""}` : undefined;
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild={asChild} data-tip={tip}>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-[100] max-w-xs rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] leading-snug text-neutral-300 select-none tooltip-content"
        >
          <span>{label}</span>
          {shortcut && (
            <span className="ml-1.5 text-neutral-500">({shortcut})</span>
          )}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

interface InfoTipProps {
  /** The explanation. Can be a string or richer JSX. */
  label: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Override the icon size (default 12px — sized to sit inline with labels). */
  size?: number;
  className?: string;
}

/** A tiny "?" icon with an explanatory tooltip. Use sparingly — only next to
 *  fields/sections where the *concept* needs explaining (jargon, hidden
 *  invariants, schema details). Don't sprinkle it on obvious controls.
 *  On touch screens the "?" is a tap-to-open popover instead (no hover). */
export function InfoTip({
  label,
  side = "top",
  size = 12,
  className = "",
}: InfoTipProps) {
  const touch = useTouchMode();
  if (touch) {
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="More info"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center justify-center text-neutral-400 ${className}`}
          >
            <HelpCircle size={Math.max(size, 16)} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={side}
            sideOffset={6}
            collisionPadding={12}
            className="z-[1100] max-w-[min(320px,calc(100vw-24px))] rounded-lg bg-neutral-950 px-3 py-2 text-sm leading-snug text-neutral-200 shadow-xl ring-1 ring-white/15"
          >
            {label}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <Tooltip label={label} side={side}>
      <button
        type="button"
        aria-label="More info"
        className={`inline-flex items-center justify-center text-neutral-500 hover:text-neutral-300 focus-visible:text-neutral-300 focus-visible:outline-none transition-colors ${className}`}
      >
        <HelpCircle size={size} />
      </button>
    </Tooltip>
  );
}
