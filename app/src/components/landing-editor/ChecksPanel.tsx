"use client";

// "Checks" in the top bar: a badge (red = errors, amber = only warnings) that
// opens the pre-publish checklist. Clicking an item selects its section/asset.

import { Popover as PopoverPrimitive } from "radix-ui";
import { ListChecks, CircleAlert, TriangleAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import type { Issue } from "@/lib/landingChecks";
import { useLandingChecks } from "./useLandingChecks";

const ICON = {
  error: <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-red-400" />,
  warning: <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />,
  info: <Info className="mt-0.5 size-3.5 shrink-0 text-sky-400" />,
} as const;

export function ChecksButton({ disabled }: { disabled?: boolean }) {
  const { issues, errors, warnings } = useLandingChecks();
  const selectSection = useLandingEditorStore((s) => s.selectSection);
  const selectAsset = useLandingEditorStore((s) => s.selectAsset);
  const badge = errors + warnings;

  const jump = (i: Issue) => {
    if (!i.target?.sectionIid) return;
    selectSection(i.target.sectionIid);
    if (i.target.assetIid) selectAsset(i.target.assetIid);
  };

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          title="Checks: broken links, missing labels and translations, SEO"
          className="relative"
        >
          <ListChecks /> <span className="hidden xl:inline">Checks</span>
          {badge > 0 && (
            <span
              className={`ms-0.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white ${
                errors > 0 ? "bg-red-600" : "bg-amber-600"
              }`}
              aria-label={`${errors} errors, ${warnings} warnings`}
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="dark z-50 max-h-[70dvh] w-[26rem] max-w-[92vw] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-2xl"
        >
          <h3 className="mb-2 text-sm font-semibold">Checks for this page</h3>
          {issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing to fix: links resolve, labels and translations are complete, SEO is set.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((i, n) => (
                <li key={n}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    disabled={!i.target?.sectionIid}
                    className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-start text-xs leading-snug hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {ICON[i.severity]}
                    <span>{i.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Errors need “Publish anyway”; warnings are shown but don&apos;t block.
          </p>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
