"use client";

// VersionSwitcher: the open version's name in the top bar (beside the page
// picker), opening a popover that lists the page's versions. Modelled on
// Shopify's theme library: exactly one version is Live (what visitors see),
// every other one is a private Draft. Save only ever writes the open version;
// going live is an explicit Publish (here, or the top-bar button).
//
// Switching with unsaved edits asks first (save & switch / discard). Prompts
// and confirms are inline, as in PageSwitcher (no window.prompt/confirm).

import { useState } from "react";
import { Popover as PopoverPrimitive, DropdownMenu as Menu } from "radix-ui";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Copy,
  EyeOff,
  Layers,
  MoreHorizontal,
  PenLine,
  Plus,
  Rocket,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import {
  useLandingEditorStore,
  selectCurrentPage,
  versionState,
} from "@/stores/landingEditorStore";
import type { PageVersionMeta } from "@/lib/landingEditorData";

type Mode =
  | { kind: "idle" }
  | { kind: "new"; from: string; initial: string }
  | { kind: "saveAs" }
  | { kind: "rename"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "switch"; id: string }
  | { kind: "publish"; id: string }
  | { kind: "offline" };

export function ago(iso: string | undefined): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function VersionPill({ live, edited }: { live: boolean; edited?: boolean }) {
  const cls = live
    ? "bg-emerald-500/15 text-emerald-400"
    : "bg-sky-500/15 text-sky-300";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ${cls}`}>
      <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-sky-300"}`} />
      {live ? (edited ? "Live · edited" : "Live") : "Draft"}
    </span>
  );
}

function InlineNameForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-center gap-1.5 px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (name) onSubmit(name);
      }}
    >
      <input
        autoFocus
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())}
        placeholder="Version name"
        maxLength={80}
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring"
      />
      <button type="submit" className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:opacity-90">
        {submitLabel}
      </button>
    </form>
  );
}

function Confirm({
  tone = "default",
  text,
  actions,
}: {
  tone?: "default" | "danger";
  text: React.ReactNode;
  actions: { label: string; onClick: () => void; primary?: boolean }[];
}) {
  return (
    <div className={`space-y-1.5 rounded-md px-2 py-2 text-xs ${tone === "danger" ? "bg-destructive/10" : "bg-accent/70"}`}>
      <p className="leading-snug">{text}</p>
      <div className="flex flex-wrap justify-end gap-1">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className={`rounded-md px-2 py-1 font-medium ${
              a.primary
                ? tone === "danger"
                  ? "bg-destructive text-white hover:opacity-90"
                  : "bg-primary text-primary-foreground hover:opacity-90"
                : "hover:bg-background/60"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VersionSwitcher({ onSave }: { onSave: () => Promise<boolean> }) {
  const versioning = useLandingEditorStore((s) => s.versioning);
  const record = useLandingEditorStore(selectCurrentPage);
  const slug = useLandingEditorStore((s) => s.currentPageSlug);
  const versions = useLandingEditorStore((s) => (s.currentPageSlug ? s.versions[s.currentPageSlug] : undefined));
  const isDirty = useLandingEditorStore((s) => s.isDirty);
  const store = useLandingEditorStore.getState;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  if (!versioning || !record || !slug) return null;

  const list = versions ?? [];
  const current = list.find((v) => v.id === record.versionId);
  const liveRow = record.status === "published" ? list.find((v) => v.id === record.liveVersionId) : undefined;
  const drafts = list.filter((v) => v !== liveRow);
  const curState = versionState(record, current);
  const idle = () => setMode({ kind: "idle" });

  // Every action: busy guard + toast on failure + back to idle.
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong.");
      if (success) toast.success(success);
      idle();
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (id: string, save: boolean) =>
    run(async () => {
      if (save && !(await onSave())) return { ok: false, error: "Save failed, so the switch was cancelled." };
      const res = await store().switchVersion(id);
      if (res.ok) setOpen(false);
      return res;
    });

  const publish = (v: PageVersionMeta) =>
    run(async () => {
      // Publishing the open version publishes what's on screen.
      if (v.id === record.versionId && isDirty && !(await onSave())) {
        return { ok: false, error: "Save failed, so nothing was published." };
      }
      return store().publishVersion(v.id);
    }, `“${v.name}” is live.`);

  const preview = (v: PageVersionMeta) =>
    window.open(
      `/admin/landing-editor/preview/${encodeURIComponent(slug)}?version=${encodeURIComponent(v.id)}`,
      `landing-preview-${slug}-${v.id}`
    );

  const row = (v: PageVersionMeta) => {
    const st = versionState(record, v);
    const active = v.id === record.versionId;
    if (mode.kind === "rename" && mode.id === v.id)
      return (
        <li key={v.id}>
          <InlineNameForm initial={v.name} submitLabel="Rename" onCancel={idle} onSubmit={(n) => run(() => store().renameVersion(v.id, n))} />
        </li>
      );
    if (mode.kind === "delete" && mode.id === v.id)
      return (
        <li key={v.id}>
          <Confirm
            tone="danger"
            text={<>Delete “{v.name}” for good? Its save history goes with it.</>}
            actions={[
              { label: "Cancel", onClick: idle },
              { label: "Delete", primary: true, onClick: () => run(() => store().deleteVersion(v.id), `Deleted “${v.name}”.`) },
            ]}
          />
        </li>
      );
    if (mode.kind === "switch" && mode.id === v.id)
      return (
        <li key={v.id}>
          <Confirm
            text={<>You have unsaved edits on “{current?.name ?? "this version"}”.</>}
            actions={[
              { label: "Cancel", onClick: idle },
              { label: "Discard & open", onClick: () => switchTo(v.id, false) },
              { label: "Save & open", primary: true, onClick: () => switchTo(v.id, true) },
            ]}
          />
        </li>
      );
    if (mode.kind === "publish" && mode.id === v.id)
      return (
        <li key={v.id}>
          <Confirm
            text={
              liveRow ? (
                <>Make “{v.name}” live? It replaces “{liveRow.name}” for visitors; that one stays here as a draft.</>
              ) : (
                <>Make “{v.name}” live? Visitors will see it right away.</>
              )
            }
            actions={[
              { label: "Cancel", onClick: idle },
              { label: "Publish", primary: true, onClick: () => publish(v) },
            ]}
          />
        </li>
      );

    const meta = st.live
      ? `Live since ${ago(record.publishedAt)}${st.edited ? " · edited since" : ""}`
      : `Edited ${ago(v.updatedAt)}${v.publishedAt ? ` · last live ${ago(v.publishedAt)}` : ""}`;

    return (
      <li key={v.id} className={`group flex items-center gap-1 rounded-md ${active ? "bg-accent" : "hover:bg-accent/60"}`}>
        <button
          disabled={busy}
          onClick={() => {
            if (active) return setOpen(false);
            if (isDirty) return setMode({ kind: "switch", id: v.id });
            void switchTo(v.id, false);
          }}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-1.5 text-start"
        >
          <span className="flex w-full items-center gap-2 text-sm">
            <span className="truncate">{v.name}</span>
            <VersionPill live={st.live} edited={st.edited} />
            {active && <Check className="ms-auto size-3.5 shrink-0 text-muted-foreground" />}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{meta}</span>
        </button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              aria-label={`Actions for ${v.name}`}
              className="me-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="end" className="dark z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl">
              {(!st.live || st.edited || (active && isDirty)) && (
                <MenuItem icon={Rocket} onSelect={() => (st.live ? publish(v) : setMode({ kind: "publish", id: v.id }))}>
                  {st.live ? "Update live" : "Publish"}
                </MenuItem>
              )}
              <MenuItem icon={SquareArrowOutUpRight} onSelect={() => preview(v)}>
                Preview{active && isDirty ? " (last save)" : ""}
              </MenuItem>
              <MenuItem
                icon={Copy}
                onSelect={() => setMode({ kind: "new", from: v.id, initial: `Copy of ${v.name}` })}
              >
                Duplicate
              </MenuItem>
              <MenuItem icon={PenLine} onSelect={() => setMode({ kind: "rename", id: v.id })}>
                Rename
              </MenuItem>
              <Menu.Separator className="my-1 h-px bg-border" />
              <MenuItem
                icon={Trash2}
                danger
                disabled={st.live || list.length <= 1}
                onSelect={() => setMode({ kind: "delete", id: v.id })}
              >
                {st.live ? "Delete (it's live)" : "Delete…"}
              </MenuItem>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </li>
    );
  };

  const newFrom = liveRow ?? current ?? list[0];

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
          className="flex h-8 max-w-56 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 text-sm hover:bg-accent"
          title="Versions: switch between the live version and drafts, publish one, or start a new draft"
        >
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{current?.name ?? "Unsaved"}</span>
          {current ? <VersionPill live={curState.live} edited={curState.edited} /> : <VersionPill live={false} />}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className="dark z-50 w-96 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-2 px-2 pb-2 pt-1">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versions</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Visitors see the Live version. Drafts are private until you publish one. Save only changes the version you have open.
              </p>
            </div>
            {newFrom && (
              <button
                disabled={busy}
                title={`New draft, copied from “${newFrom.name}”`}
                onClick={() => setMode({ kind: "new", from: newFrom.id, initial: "New draft" })}
                className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-accent"
              >
                <Plus className="size-3.5" /> New draft
              </button>
            )}
          </div>

          {mode.kind === "new" && (
            <InlineNameForm
              initial={mode.initial}
              submitLabel="Create"
              onCancel={idle}
              onSubmit={(name) =>
                run(async () => {
                  const res = await store().duplicateVersion(mode.from, name);
                  if (res.ok) setOpen(false);
                  return res;
                }, `Created “${name}”. You're editing it now.`)
              }
            />
          )}

          <div className="max-h-[60dvh] overflow-auto">
            <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">Live</div>
            {liveRow ? (
              <ul>{row(liveRow)}</ul>
            ) : (
              <p className="px-2 pb-1 text-xs text-muted-foreground">
                {record.status === "published"
                  ? "Live from before versions existed. Publish a version to manage it here."
                  : "This page is offline: visitors can't see it. Publish a version to put it online."}
              </p>
            )}
            {drafts.length > 0 && (
              <>
                <div className="px-2 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground">Drafts</div>
                <ul>{drafts.map(row)}</ul>
              </>
            )}
            {list.length === 0 && (
              <p className="px-2 pb-1 text-xs text-muted-foreground">Not saved yet. Your first Save creates a draft version.</p>
            )}
          </div>

          {(isDirty && current) || record.status === "published" ? (
            <div className="mt-1.5 space-y-1 border-t border-border pt-1.5">
              {isDirty && current && (
                mode.kind === "saveAs" ? (
                  <InlineNameForm
                    initial={`${current.name} (edits)`}
                    submitLabel="Save"
                    onCancel={idle}
                    onSubmit={(name) => run(() => store().saveAsNewVersion(name), `Saved your edits as “${name}”. “${current.name}” is unchanged.`)}
                  />
                ) : (
                  <FooterButton icon={Plus} disabled={busy} onClick={() => setMode({ kind: "saveAs" })}>
                    Save my unsaved edits as a new draft
                  </FooterButton>
                )
              )}
              {record.status === "published" &&
                (mode.kind === "offline" ? (
                  <Confirm
                    tone="danger"
                    text="Take this page offline? Visitors get a 404 (the home page falls back to the built-in default) until you publish again."
                    actions={[
                      { label: "Cancel", onClick: idle },
                      {
                        label: "Take offline",
                        primary: true,
                        onClick: () => run(() => store().setStatus(slug, "draft"), "Page is offline."),
                      },
                    ]}
                  />
                ) : (
                  <FooterButton icon={EyeOff} disabled={busy} onClick={() => setMode({ kind: "offline" })}>
                    Take page offline…
                  </FooterButton>
                ))}
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function FooterButton({
  icon: Icon,
  disabled,
  onClick,
  children,
}: {
  icon: typeof Copy;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function MenuItem({
  icon: Icon,
  danger,
  disabled,
  onSelect,
  children,
}: {
  icon: typeof Copy;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Menu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent ${
        danger ? "text-red-400" : ""
      }`}
    >
      <Icon className="size-3.5" />
      {children}
    </Menu.Item>
  );
}
