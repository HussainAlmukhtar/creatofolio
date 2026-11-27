"use client";

// InfoTip — a small (i) next to a control that explains, on hover or keyboard
// focus, what the control does and when to use it. Used throughout Arcade
// Studio so the owner can check a setting's meaning without leaving the
// editor. Carries its own provider so it works anywhere in the tree.

import { Info } from "lucide-react";
import { Popover } from "radix-ui";
import { useTouchMode } from "@/lib/touchMode";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function InfoTip({ text, side = "left" }: { text: React.ReactNode; side?: "left" | "right" | "top" | "bottom" }) {
  const touch = useTouchMode();
  if (touch) {
    // No hover on a finger: the (i) opens on tap and closes on a tap outside.
    return (
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-grid shrink-0 place-items-center rounded-full align-middle text-muted-foreground"
            aria-label={typeof text === "string" ? `About: ${text}` : "More information"}
            data-info-tip=""
          >
            <Info className="size-4" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side={side}
            sideOffset={6}
            collisionPadding={12}
            className="z-[1100] max-w-[min(300px,calc(100vw-24px))] rounded-md bg-foreground px-3 py-2 text-sm leading-snug text-background shadow-xl"
          >
            {text}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Don't steal selection/drag from the canvas or toggle a parent label.
            onClick={(e) => e.preventDefault()}
            className="inline-grid size-4 shrink-0 cursor-help place-items-center rounded-full align-middle text-muted-foreground/80 hover:text-foreground focus-visible:outline focus-visible:outline-1"
            aria-label={typeof text === "string" ? `About: ${text}` : "More information"}
            data-info-tip=""
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} className="max-w-[260px] text-[12px] leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
