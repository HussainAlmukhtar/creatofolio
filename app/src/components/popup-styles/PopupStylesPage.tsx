"use client";

// /admin/popup-styles — the pop-up theme + frame library.
// The library grid lists every theme and frame with its status;
// `?item=<iid>` opens one in StyleEditor. Owner-only (the proxy gates /admin;
// RLS gates every write). Archive-only: nothing here deletes a drawing.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Frame, Palette, Plus, Sparkles } from "lucide-react";
import type { PopupFrameConfig, PopupThemeConfig, StyleKind } from "@/data/popupStyleTypes";
import { createPopupStyle, listPopupStyles, type StyleListResult } from "@/lib/popupStyles";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { useDialog } from "@/components/editor/useDialog";
import { StyleEditor } from "./StyleEditor";

export default function PopupStylesPage() {
  useOwnerSessionWatch();
  const router = useRouter();
  const params = useSearchParams();
  const item = params.get("item");

  // Dark chrome for Radix portals (selects, dialogs) on this page.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  const open = useCallback((iid: string | null) => router.push(iid ? `/admin/popup-styles?item=${iid}` : "/admin/popup-styles"), [router]);

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      <SessionLostBanner />
      {item ? <StyleEditor key={item} iid={item} onBack={() => open(null)} onOpen={open} /> : <Library onOpen={open} />}
    </div>
  );
}

function Library({ onOpen }: { onOpen: (iid: string) => void }) {
  const [list, setList] = useState<StyleListResult | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { prompt, dialog } = useDialog();

  useEffect(() => {
    let live = true;
    void listPopupStyles().then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, []);

  const create = async (kind: StyleKind) => {
    const name = await prompt(kind === "theme" ? "Name the new theme:" : "Name the new frame:", kind === "theme" ? "My theme" : "TV");
    if (name === null) return;
    const res = await createPopupStyle(kind, name.trim() || (kind === "theme" ? "Untitled theme" : "Untitled frame"));
    if (res.ok && res.iid) onOpen(res.iid);
    else toast.error("Couldn't create it", { description: res.error });
  };

  const items = (list?.items ?? []).filter((i) => showArchived || !i.archivedAt);
  const themes = items.filter((i) => i.kind === "theme");
  const frames = items.filter((i) => i.kind === "frame");
  const archivedCount = (list?.items ?? []).filter((i) => i.archivedAt).length;

  return (
    <>
      <header className="border-b border-neutral-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <Link
            href="/admin"
            className="text-neutral-400 hover:text-white touch:-m-3 touch:grid touch:size-11 touch:place-items-center"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <Palette className="size-4 text-neutral-400" />
          <h1 className="text-lg font-semibold">Pop-up styles</h1>
          <span className="ms-auto" />
          {list?.available && (
            <>
              <button
                type="button"
                onClick={() => create("theme")}
                className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
              >
                <Plus className="size-4" /> New theme
              </button>
              <button
                type="button"
                onClick={() => create("frame")}
                className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
              >
                <Plus className="size-4" /> New frame
              </button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-6">
        <p className="max-w-2xl text-sm text-neutral-400">
          Draw how pop-ups look. A <strong className="text-neutral-200">theme</strong> dresses every pop-up (panel,
          close button, page arrows, dialogue box); one theme is active at a time, or none for the built-in paper
          look. A <strong className="text-neutral-200">frame</strong> (a TV, a book…) is picked per pop-up in its
          settings. Each item has its own draft: nothing changes for visitors until you Publish.
        </p>

        {list === null && <p className="text-sm text-neutral-400">Loading…</p>}
        {list && !list.available && (
          <p className="rounded-md border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
            The style library needs database migration 20261008000001_popup_styles.sql (popup_styles). Until it&apos;s applied, pop-ups use the
            built-in look.
          </p>
        )}
        {list?.error && <p className="rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{list.error}</p>}

        {list?.available && (
          <>
            <Shelf title="Themes" icon={<Sparkles className="size-4" />} empty="No themes yet. Pop-ups use the built-in paper look.">
              {themes.map((t) => (
                <Card key={t.iid} item={t} onOpen={onOpen} />
              ))}
            </Shelf>
            <Shelf title="Frames" icon={<Frame className="size-4" />} empty="No frames yet.">
              {frames.map((f) => (
                <Card key={f.iid} item={f} onOpen={onOpen} />
              ))}
            </Shelf>
            {archivedCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived ({archivedCount})
              </label>
            )}
          </>
        )}
      </main>
      {dialog}
    </>
  );
}

function Shelf({ title, icon, empty, children }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-300">
        {icon} {title}
      </h2>
      {children.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
      ) : (
        <p className="text-sm text-neutral-500">{empty}</p>
      )}
    </section>
  );
}

function Card({ item, onOpen }: { item: StyleListResult["items"][number]; onOpen: (iid: string) => void }) {
  const thumb =
    item.kind === "frame"
      ? (item.config as PopupFrameConfig).art?.url
      : ((item.config as PopupThemeConfig).parts.panel ?? (item.config as PopupThemeConfig).parts.close)?.url;
  const badges: { text: string; tone: string }[] = [];
  if (item.isActive) badges.push({ text: "Active", tone: "bg-emerald-500/20 text-emerald-300" });
  if (item.archivedAt) badges.push({ text: "Archived", tone: "bg-neutral-700 text-neutral-300" });
  if (!item.publishedAt) badges.push({ text: "Never published", tone: "bg-neutral-700 text-neutral-300" });
  else if (!item.isActive && item.kind === "theme" && !item.archivedAt) badges.push({ text: "Published", tone: "bg-blue-500/15 text-blue-300" });
  else if (item.kind === "frame" && !item.archivedAt) badges.push({ text: "Published", tone: "bg-blue-500/15 text-blue-300" });
  if (item.draftUpdatedAt) badges.push({ text: "Draft", tone: "bg-amber-500/15 text-amber-300" });
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.iid)}
        className="flex w-full gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 text-start hover:border-neutral-600"
      >
        <span className="media-tile grid size-16 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-neutral-700">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-contain" />
          ) : item.kind === "frame" ? (
            <Frame className="size-5 text-neutral-500" />
          ) : (
            <Sparkles className="size-5 text-neutral-500" />
          )}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate font-medium">{item.name || "Untitled"}</span>
          {item.nameAr && (
            <span className="block truncate text-xs text-neutral-400" dir="rtl">
              {item.nameAr}
            </span>
          )}
          <span className="flex flex-wrap gap-1">
            {badges.map((b) => (
              <span key={b.text} className={`rounded-full px-2 py-0.5 text-[10px] ${b.tone}`}>
                {b.text}
              </span>
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}
