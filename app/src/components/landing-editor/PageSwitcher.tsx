"use client";

// PageSwitcher: the current page's name in the top bar, opening a popover
// that lists every page (status at a glance), creates new ones, and holds each
// page's actions (rename / duplicate / preview / delete) behind a "⋯" menu.
// It replaces the old always-open Pages rail, which cost the canvas 224px and
// showed five raw text links under the active page. Shopify's editor works
// the same way: pages come from a top-bar picker, not a permanent column.
//
// Prompts are inline (not window.prompt/confirm), as before: native dialogs
// are unstyled and don't work in embedded/automation contexts.

import { useState } from "react";
import { Popover as PopoverPrimitive, DropdownMenu as Menu } from "radix-ui";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Home,
  MoreHorizontal,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useLandingEditorStore } from "@/stores/landingEditorStore";
import { validateSlug } from "@/lib/landingEditorData";
import { RecentlyDeletedPanel } from "@/components/admin/RecentlyDeletedPanel";
import { restoreDeletedItem } from "@/lib/trashData";
import { useTrashAvailable } from "@/lib/useTrashAvailable";

type Mode =
  | { kind: "idle" }
  | { kind: "create" }
  | { kind: "rename"; slug: string }
  | { kind: "duplicate"; slug: string }
  | { kind: "delete"; slug: string };

export function StatusPill({ published }: { published: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ${
        published ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
      }`}
    >
      <span className={`size-1.5 rounded-full ${published ? "bg-emerald-400" : "bg-amber-400"}`} />
      {published ? "Live" : "Offline"}
    </span>
  );
}

function InlineSlugForm({
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (slug: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-center gap-1.5 px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim().toLowerCase());
      }}
    >
      <span className="text-xs text-muted-foreground">/</span>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
      />
      <button type="submit" className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:opacity-90">
        {submitLabel}
      </button>
    </form>
  );
}

export function PageSwitcher() {
  const allPages = useLandingEditorStore((s) => s.allPages);
  const current = useLandingEditorStore((s) => s.currentPageSlug);
  const setCurrentPage = useLandingEditorStore((s) => s.setCurrentPage);
  const createPage = useLandingEditorStore((s) => s.createPage);
  const renamePage = useLandingEditorStore((s) => s.renamePage);
  const deletePage = useLandingEditorStore((s) => s.deletePage);
  const duplicatePage = useLandingEditorStore((s) => s.duplicatePage);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [showTrash, setShowTrash] = useState(false);
  // Deletes move to Recently deleted once migration 20261005000002_trash_and_atomic_ops is applied.
  const trashAvailable = useTrashAvailable();

  // Re-read the page list after a restore. Skipped while there are unsaved
  // edits (a re-read would replace them): the page then shows up on next load.
  const refreshPages = async () => {
    const st = useLandingEditorStore.getState();
    if (st.isDirty) {
      toast.info("Restored. Save your changes, then reload the editor to see it in the page list.");
      return;
    }
    await st.hydrateFromSupabase();
  };

  // Home first, then alphabetical.
  const slugs = Object.keys(allPages).sort((a, b) =>
    a === "home" ? -1 : b === "home" ? 1 : a.localeCompare(b)
  );
  const idle = () => setMode({ kind: "idle" });

  const create = async (slug: string) => {
    const err = validateSlug(slug);
    if (err) return toast.error(err);
    if (allPages[slug]) return toast.error(`A page "${slug}" already exists.`);
    const res = await createPage(slug);
    if (!res.ok) return toast.error(res.error ?? "Couldn't create page.");
    toast.success(`Created "${slug}".`);
    idle();
    setOpen(false);
  };
  const rename = async (from: string, to: string) => {
    if (!to || to === from) return idle();
    if (allPages[to]) return toast.error(`A page "${to}" already exists.`);
    const res = await renamePage(from, to);
    if (!res.ok) return toast.error(res.error ?? "Rename failed.");
    toast.success(`Renamed to "${to}".`);
    idle();
  };
  const duplicate = async (from: string, to: string) => {
    const err = validateSlug(to);
    if (err) return toast.error(err);
    if (allPages[to]) return toast.error(`A page "${to}" already exists.`);
    const res = await duplicatePage(from, to);
    if (!res.ok) return toast.error(res.error ?? "Duplicate failed.");
    toast.success(`Duplicated as "${to}".`);
    idle();
  };
  const remove = async (slug: string) => {
    const res = await deletePage(slug);
    if (!res.ok) return toast.error(res.error ?? "Delete failed.");
    if (res.trashId) {
      const trashId = res.trashId;
      toast.success(`Moved "${slug}" to Recently deleted.`, {
        duration: 10000,
        action: {
          label: "Undo",
          onClick: () => {
            void restoreDeletedItem(trashId, "page").then((r) => {
              if (r.ok) {
                toast.success(`Restored "${slug}". It's back offline: publish it when you're ready.`);
                void refreshPages();
              } else toast.error(r.error ?? "Couldn't restore it");
            });
          },
        },
      });
    } else {
      toast.success(`Deleted "${slug}".`);
    }
    idle();
  };

  const record = current ? allPages[current] : null;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) idle();
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          className="flex h-8 max-w-64 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 text-sm hover:bg-accent"
          title="Switch page, or create / rename / duplicate / delete pages"
        >
          {current === "home" ? <Home className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}
          <span className="truncate font-medium">{current ? (current === "home" ? "Home" : `/${current}`) : "No page"}</span>
          {record && <StatusPill published={record.status === "published"} />}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="dark z-50 w-80 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</span>
            <button
              title="New page"
              onClick={() => setMode(mode.kind === "create" ? { kind: "idle" } : { kind: "create" })}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-accent"
            >
              <Plus className="size-3.5" /> New page
            </button>
          </div>
          {mode.kind === "create" && (
            <InlineSlugForm initial="" placeholder="page-slug" submitLabel="Create" onSubmit={create} onCancel={idle} />
          )}
          <ul className="max-h-[60dvh] overflow-auto">
            {slugs.map((slug) => {
              const rec = allPages[slug];
              const active = slug === current;
              if (mode.kind === "rename" && mode.slug === slug)
                return (
                  <li key={slug}>
                    <InlineSlugForm initial={slug} placeholder="new-slug" submitLabel="Rename" onSubmit={(to) => rename(slug, to)} onCancel={idle} />
                  </li>
                );
              if (mode.kind === "duplicate" && mode.slug === slug)
                return (
                  <li key={slug}>
                    <InlineSlugForm initial={`${slug}-copy`} placeholder="copy-slug" submitLabel="Duplicate" onSubmit={(to) => duplicate(slug, to)} onCancel={idle} />
                  </li>
                );
              if (mode.kind === "delete" && mode.slug === slug)
                return (
                  <li key={slug} className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs">
                    <span>
                      {trashAvailable
                        ? `Move “${slug}” to Recently deleted?`
                        : `Delete “${slug}” for good?`}
                    </span>
                    <span className="flex gap-1">
                      <button onClick={() => remove(slug)} className="rounded-md bg-destructive px-2 py-1 font-medium text-white hover:opacity-90">
                        Delete
                      </button>
                      <button onClick={idle} className="rounded-md px-2 py-1 hover:bg-accent">
                        Cancel
                      </button>
                    </span>
                  </li>
                );
              return (
                <li key={slug} className={`group flex items-center gap-1 rounded-md ${active ? "bg-accent" : "hover:bg-accent/60"}`}>
                  <button
                    onClick={() => {
                      if (!active) setCurrentPage(slug);
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-start text-sm"
                  >
                    {slug === "home" ? <Home className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{slug === "home" ? "Home" : `/${slug}`}</span>
                    <StatusPill published={rec?.status === "published"} />
                    {active && <Check className="ms-auto size-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <button
                        aria-label={`Actions for ${slug}`}
                        className="me-1 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content
                        align="end"
                        className="dark z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl"
                      >
                        <MenuItem icon={PenLine} onSelect={() => setMode({ kind: "rename", slug })}>
                          Rename
                        </MenuItem>
                        <MenuItem icon={Copy} onSelect={() => setMode({ kind: "duplicate", slug })}>
                          Duplicate
                        </MenuItem>
                        <MenuItem
                          icon={ExternalLink}
                          onSelect={() => window.open(`/admin/landing-editor/preview/${encodeURIComponent(slug)}`, `landing-preview-${slug}`)}
                        >
                          Preview saved version
                        </MenuItem>
                        <Menu.Separator className="my-1 h-px bg-border" />
                        <MenuItem icon={Trash2} danger onSelect={() => setMode({ kind: "delete", slug })}>
                          Delete…
                        </MenuItem>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t border-border pt-1">
            <button
              onClick={() => {
                setOpen(false);
                setShowTrash(true);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" /> Recently deleted…
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
      {showTrash && (
        <RecentlyDeletedPanel
          onClose={() => setShowTrash(false)}
          onRestored={(item) => {
            if (item.kind === "page") void refreshPages();
          }}
        />
      )}
    </PopoverPrimitive.Root>
  );
}

function MenuItem({
  icon: Icon,
  danger,
  onSelect,
  children,
}: {
  icon: typeof Copy;
  danger?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent ${
        danger ? "text-red-400" : ""
      }`}
    >
      <Icon className="size-3.5" />
      {children}
    </Menu.Item>
  );
}
