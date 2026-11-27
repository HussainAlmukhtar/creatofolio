"use client";

// OverflowMenu — a tap-to-open "⋯" dropdown (Radix DropdownMenu). Used on
// touch screens to reach actions that otherwise live behind a right-click, a
// keyboard shortcut or a hover-only icon row (iPad editors), and for less-used
// toolbar tools. Items show their desktop shortcut on the right so the menu
// doubles as a cheat-sheet. The content caps itself to the space Radix
// reports, so a long menu scrolls inside the iPad viewport instead of running
// off-screen.

import type { ComponentType, ReactNode } from "react";
import { DropdownMenu as Menu } from "radix-ui";
import { Check, MoreHorizontal } from "lucide-react";

type Icon = ComponentType<{ size?: number; className?: string }>;

export type OverflowMenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: Icon;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** Desktop shortcut shown dimmed on the right (e.g. "Ctrl+D"). */
      shortcut?: string;
      /** Renders a check mark (toggle state). */
      checked?: boolean;
    }
  | { kind: "separator" }
  | { kind: "label"; label: string };

interface OverflowMenuProps {
  items: (OverflowMenuItem | false | null | undefined)[];
  /** Accessible name of the trigger. */
  label?: string;
  /** Custom trigger element (must forward refs/props, e.g. a <button>). */
  trigger?: ReactNode;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  /** Extra classes for the menu panel (e.g. the landing editor's `dark`). */
  contentClassName?: string;
}

export function OverflowMenu({
  items,
  label = "More actions",
  trigger,
  triggerClassName = "grid place-items-center rounded-md bg-neutral-700 p-1.5 text-neutral-200 hover:bg-neutral-600",
  align = "end",
  side = "bottom",
  contentClassName = "",
}: OverflowMenuProps) {
  const list = items.filter(Boolean) as OverflowMenuItem[];
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        {trigger ?? (
          <button type="button" aria-label={label} className={triggerClassName}>
            <MoreHorizontal size={18} />
          </button>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={`z-[1100] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-56 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-sm text-neutral-100 shadow-2xl ${contentClassName}`}
        >
          {list.map((item, i) => {
            if (item.kind === "separator") {
              return <Menu.Separator key={i} className="my-1 h-px bg-neutral-700" />;
            }
            if (item.kind === "label") {
              return (
                <Menu.Label key={i} className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {item.label}
                </Menu.Label>
              );
            }
            const ItemIcon = item.icon;
            return (
              <Menu.Item
                key={i}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={`flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-neutral-800 ${
                  item.danger ? "text-red-300 data-[highlighted]:bg-red-950/60" : ""
                }`}
              >
                {ItemIcon ? <ItemIcon size={16} className="shrink-0 opacity-80" /> : <span className="w-4" />}
                <span className="flex-1">{item.label}</span>
                {item.checked && <Check size={15} className="shrink-0 text-sky-400" />}
                {item.shortcut && (
                  <span className="shrink-0 text-xs text-neutral-500">{item.shortcut}</span>
                )}
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
