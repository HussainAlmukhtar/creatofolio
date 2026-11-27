"use client";

// Admin dashboard — the hub the owner lands on after signing in. It doesn't
// edit anything itself; it answers "where do I want to go?" and shows just
// enough state (room list, page statuses, maintenance flag) to pick a
// destination. Every card deep-links into the real editors:
//
//   /admin/editor?room=<id>          room editor, opened on that room
//   /admin/editor/world              world map
//   /admin/landing-editor?page=<slug> landing editor, opened on that page
//   /admin/landing-editor/preview/<slug>  draft preview
//   /admin/wardrobe                  avatar catalog
//
// Reads go through the browser anon client + RLS, same as the editors.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOwnerSessionWatch } from "@/lib/useOwnerSessionWatch";
import { SessionLostBanner } from "@/components/admin/SessionLostBanner";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDialog } from "@/components/editor/useDialog";
import { SiteConflictDialog } from "@/components/landing-editor/SiteConflictDialog";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import { versionState } from "@/stores/landingEditorStore";
import { RecentlyDeletedPanel } from "@/components/admin/RecentlyDeletedPanel";
import {
  ArrowRight,
  Eye,
  ExternalLink,
  Gamepad2,
  LayoutTemplate,
  LogOut,
  Map as MapIcon,
  RotateCcw,
  Shirt,
  ShieldCheck,
  Settings2,
  PanelTop,
  HardDrive,
  Hourglass,
  Palette,
  Play,
} from "lucide-react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  loadAllLandingPagesForEditor,
  loadSiteConfigForEditor,
  type LandingPageRecord,
  type PageVersionMeta,
} from "@/lib/landingEditorData";
import { formatBytes } from "@/lib/assetWeight";

/** Short git SHA of the deployed build (next.config.ts); empty in local dev. */
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";

interface StorageSummary {
  bytes: number;
  unusedCount: number;
  unusedBytes: number;
}

interface RoomSummary {
  id: string;
  name: string;
  updatedAt: string | null;
  /** Has an unpublished draft (room_drafts) — visitors still see the live room. */
  hasDraft: boolean;
}

interface SiteFlags {
  maintenance: boolean;
  announcementBar: boolean;
}

export default function AdminDashboard() {
  useOwnerSessionWatch();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  // No Supabase: settle the rooms card up front instead of in the effect.
  const [rooms, setRooms] = useState<RoomSummary[] | null>(() =>
    isSupabaseConfigured() ? null : []
  );
  const [roomsError, setRoomsError] = useState<string | null>(() =>
    isSupabaseConfigured() ? null : "Supabase not configured — edits will not persist."
  );
  const [pages, setPages] = useState<LandingPageRecord[] | null>(null);
  const [versions, setVersions] = useState<Record<string, PageVersionMeta[]>>({});
  // null = not known (loading, or the user has no factor / the check failed).
  const [twoFactor, setTwoFactor] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [flags, setFlags] = useState<SiteFlags | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [togglingMaintenance, setTogglingMaintenance] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  // Bump to re-read the rooms / pages cards (after a restore).
  const [reloadKey, setReloadKey] = useState(0);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();

    if (supabase) {
      supabase.auth.getUser().then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null);
      });
      supabase.auth.mfa
        .listFactors()
        .then(({ data, error }) => {
          if (cancelled || error) return;
          setTwoFactor((data?.totp ?? []).some((f) => f.status === "verified"));
        })
        .catch(() => {});
      Promise.all([
        supabase
          .from("rooms")
          .select("id, iid, updated_at, name:config->>name")
          .order("id"),
        // Drafts table missing (migration 20261005000001_room_drafts not applied) → just no badges.
        supabase.from("room_drafts").select("room_iid"),
      ]).then(([roomsRes, draftsRes]) => {
        if (cancelled) return;
        if (roomsRes.error) {
          setRooms([]);
          setRoomsError(roomsRes.error.message);
          return;
        }
        const drafted = new Set(
          (draftsRes.error ? [] : draftsRes.data ?? []).map((d) => d.room_iid as string)
        );
        setRooms(
          (roomsRes.data ?? []).map((row) => ({
            id: row.id as string,
            name: (row.name as string | null) || (row.id as string),
            updatedAt: (row.updated_at as string | null) ?? null,
            hasDraft: !!row.iid && drafted.has(row.iid as string),
          }))
        );
      });
    }

    loadAllLandingPagesForEditor().then((result) => {
      if (cancelled) return;
      const sorted = [...result.pages].sort((a, b) =>
        a.page.slug === "home" ? -1 : b.page.slug === "home" ? 1 : a.page.slug.localeCompare(b.page.slug)
      );
      setPages(sorted);
      setVersions(result.versions);
      if (result.source === "static") setPagesError(result.error ?? "Couldn't load pages.");
    });

    loadSiteConfigForEditor().then((result) => {
      if (cancelled) return;
      setFlags({
        maintenance: Boolean(result.config.maintenance?.enabled),
        announcementBar: Boolean(result.config.announcementBar?.enabled),
      });
    });

    // Storage totals: a full scan, so it loads after everything else and a
    // failure just leaves the card without numbers.
    fetch("/api/admin/storage/unused", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((scan) => {
        if (cancelled || !scan) return;
        setStorage({
          bytes: scan.buckets.reduce((n: number, b: { bytes: number }) => n + b.bytes, 0),
          unusedCount: scan.unused.length,
          unusedBytes: scan.unused.reduce((n: number, o: { size: number }) => n + o.size, 0),
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await getSupabaseClient()?.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  };

  // Live-on-save, like every site setting: flips what visitors see at once.
  const handleToggleMaintenance = async () => {
    if (!flags || togglingMaintenance) return;
    const turnOn = !flags.maintenance;
    const ok = await confirm(
      turnOn
        ? "Turn maintenance mode on? Visitors will see the holding page until you turn it off."
        : "Turn maintenance mode off? The site goes back online for everyone.",
      { confirmLabel: turnOn ? "Turn on" : "Go back online", danger: turnOn }
    );
    if (!ok) return;
    setTogglingMaintenance(true);
    const store = useSiteConfigEditorStore.getState();
    await store.hydrate();
    if (!useSiteConfigEditorStore.getState().isHydrated) {
      setTogglingMaintenance(false);
      return;
    }
    useSiteConfigEditorStore.getState().updateMaintenance({ enabled: turnOn });
    const result = await useSiteConfigEditorStore.getState().save();
    setTogglingMaintenance(false);
    if (result.ok) {
      setFlags({ ...flags, maintenance: turnOn });
      toast.success(turnOn ? "Maintenance mode is on" : "The site is back online");
    } else if (result.code !== "conflict") {
      // A conflict opens SiteConflictDialog on its own.
      toast.error("Couldn't change maintenance mode", { description: result.error });
    }
  };

  const draftRooms = rooms?.filter((r) => r.hasDraft) ?? [];
  const publishedCount = pages?.filter((p) => p.status === "published").length ?? 0;

  return (
    <div className="min-h-dvh bg-neutral-900 text-neutral-100">
      <SessionLostBanner />
      <SiteConflictDialog />
      {dialog}
      {showTrash && (
        <RecentlyDeletedPanel
          onClose={() => setShowTrash(false)}
          onRestored={() => setReloadKey((k) => k + 1)}
        />
      )}
      <header className="border-b border-neutral-800 bg-neutral-900/80 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <div className="me-auto">
            <h1 className="text-lg font-semibold tracking-tight">Creatofolio — Admin</h1>
            {email && (
              <p className="text-xs text-neutral-400">
                Signed in as {email}
                {BUILD_SHA && (
                  <span className="ms-2 font-mono text-neutral-500" title="Deployed version">
                    · v{BUILD_SHA}
                  </span>
                )}
              </p>
            )}
          </div>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 touch:min-h-11"
          >
            <ExternalLink className="h-4 w-4" /> View site
          </a>
          <Link
            href="/admin/security"
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 touch:min-h-11"
          >
            <ShieldCheck className="h-4 w-4" /> Security
          </Link>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 touch:min-h-11"
          >
            <LogOut className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {flags?.maintenance && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-700/60 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
            <span className="font-medium">Maintenance mode is on.</span>
            <span className="text-amber-200/80">
              Public visitors see the maintenance page until you turn it off in Site settings.
            </span>
            <Link
              href="/admin/landing-editor"
              className="ms-auto text-amber-100 underline underline-offset-2 hover:text-white"
            >
              Open landing editor
            </Link>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Game world ─────────────────────────────────────── */}
          <Section
            icon={<Gamepad2 className="h-5 w-5" />}
            title="Game rooms"
            description="Objects, doors, characters and backgrounds for the game world."
            primary={{ href: "/admin/editor", label: "Open room editor" }}
            secondary={{ href: "/admin/editor/world", label: "World map", icon: <MapIcon className="h-4 w-4" /> }}
            meta={rooms ? `${rooms.length} room${rooms.length === 1 ? "" : "s"}` : undefined}
          >
            {roomsError && <ErrorNote>{roomsError}</ErrorNote>}
            {draftRooms.length > 0 && (
              <p className="mb-2 flex flex-wrap items-center gap-2 rounded border border-sky-800 bg-sky-900/20 px-2 py-1.5 text-xs text-sky-200">
                <span>
                  {draftRooms.length} room{draftRooms.length === 1 ? " has" : "s have"} unpublished changes.
                </span>
                <Link
                  href={`/admin/editor?room=${encodeURIComponent(draftRooms[0].id)}`}
                  className="ms-auto underline underline-offset-2 hover:text-white"
                >
                  Review &amp; publish
                </Link>
              </p>
            )}
            {rooms === null ? (
              <Loading />
            ) : rooms.length === 0 ? (
              !roomsError && <Empty>No saved rooms yet. The editor starts from the built-in starter rooms.</Empty>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {rooms.map((room) => (
                  <li key={room.id} className="flex items-center">
                    <Link
                      href={`/admin/editor?room=${encodeURIComponent(room.id)}`}
                      className="group flex min-w-0 flex-1 items-center gap-3 px-1 py-2 text-sm hover:bg-neutral-800/60 touch:min-h-12"
                    >
                      <span className="truncate font-medium">{room.name}</span>
                      <span className="truncate font-mono text-xs text-neutral-500">{room.id}</span>
                      {room.hasDraft && (
                        <span className="shrink-0 rounded-full bg-sky-900/50 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                          Draft
                        </span>
                      )}
                      <span className="ms-auto shrink-0 text-xs text-neutral-500">
                        {formatRelative(room.updatedAt)}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-neutral-600 group-hover:text-neutral-300" />
                    </Link>
                    {room.hasDraft && (
                      // Play the real game with this room's draft (new tab, read-only).
                      <a
                        href={`/admin/play?room=${encodeURIComponent(room.id)}`}
                        target="_blank"
                        rel="noopener"
                        title="Play draft"
                        aria-label={`Play the draft of ${room.name}`}
                        className="ms-1 shrink-0 rounded p-1 text-sky-400 hover:bg-neutral-800 hover:text-sky-200 touch:grid touch:size-11 touch:place-items-center"
                      >
                        <Play className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── Landing pages ─────────────────────────────────── */}
          <Section
            icon={<LayoutTemplate className="h-5 w-5" />}
            title="Landing pages"
            description="The public website: sections, header, footer and site settings."
            primary={{ href: "/admin/landing-editor", label: "Open landing editor" }}
            meta={pages ? `${publishedCount} of ${pages.length} published` : undefined}
          >
            {pagesError && <ErrorNote>{pagesError}</ErrorNote>}
            {pages === null ? (
              <Loading />
            ) : (
              <ul className="divide-y divide-neutral-800">
                {pages.map((record) => {
                  const { page, status, updatedAt } = record;
                  const title = page.meta?.title.en || page.slug;
                  const publicPath = page.slug === "home" ? "/" : `/${page.slug}`;
                  return (
                    <li key={page.iid} className="flex items-center gap-3 px-1 py-2 text-sm">
                      <Link
                        href={`/admin/landing-editor?page=${encodeURIComponent(page.slug)}`}
                        className="flex min-w-0 flex-1 items-center gap-3 hover:underline touch:min-h-11"
                      >
                        <span className="truncate font-medium">{title}</span>
                        <span className="truncate font-mono text-xs text-neutral-500">{publicPath}</span>
                      </Link>
                      <PageBadges record={record} versions={versions[page.slug]} />
                      <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
                        {formatRelative(updatedAt ?? null)}
                      </span>
                      <Link
                        href={`/admin/landing-editor/preview/${encodeURIComponent(page.slug)}`}
                        title="Preview draft"
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 touch:grid touch:size-11 touch:place-items-center"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      {status === "published" && (
                        <a
                          href={publicPath}
                          target="_blank"
                          rel="noreferrer"
                          title="Open live page"
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 touch:grid touch:size-11 touch:place-items-center"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {flags && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                <label className="flex items-center gap-2">
                  <span>Maintenance</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={flags.maintenance}
                    aria-label="Maintenance mode"
                    disabled={togglingMaintenance}
                    onClick={handleToggleMaintenance}
                    className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                      flags.maintenance ? "bg-amber-500" : "bg-neutral-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        flags.maintenance ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                  <span>{flags.maintenance ? "on" : "off"}</span>
                </label>
                <span>
                  Announcement bar: {flags.announcementBar ? "on" : "off"}
                </span>
              </div>
            )}
          </Section>
        </div>

        {/* ── Other tools ─────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ToolCard
            href="/admin/landing-editor?open=site"
            icon={<Settings2 className="h-5 w-5" />}
            title="Site settings"
            description="Announcement bar, footer, fonts, forms, maintenance."
          />
          <ToolCard
            href="/admin/landing-editor?open=nav"
            icon={<PanelTop className="h-5 w-5" />}
            title="Nav Studio"
            description="The navigation bar: links, drawings, mobile menu."
          />
          <ToolCard
            href="/admin/popup-styles"
            icon={<Palette className="h-5 w-5" />}
            title="Pop-up styles"
            description="Draw the pop-up look (panel, buttons, dialogue box) and frames like a TV."
          />
          <ToolCard
            href="/admin/loading-screen"
            icon={<Hourglass className="h-5 w-5" />}
            title="Loading screen"
            description="The animated welcome visitors see while the site loads, then it opens onto the page."
          />
          <ToolCard
            href="/admin/storage"
            icon={<HardDrive className="h-5 w-5" />}
            title="Storage"
            description={
              storage
                ? `${formatBytes(storage.bytes)} used · ${storage.unusedCount} unused file${storage.unusedCount === 1 ? "" : "s"} (${formatBytes(storage.unusedBytes)})`
                : "See what's using space and clear unused files."
            }
          />
          <ToolCard
            href="/admin/security"
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Security"
            description={
              twoFactor === null
                ? "Two-factor authenticators and password."
                : twoFactor
                  ? "Two-factor: on"
                  : "Two-factor: off. Add an authenticator."
            }
          />
          <ToolCard
            href="/admin/wardrobe"
            icon={<Shirt className="h-5 w-5" />}
            title="Wardrobe"
            description="The character wardrobe: upload or draw hair, clothes and accessories."
          />
          <ToolCard
            onClick={() => setShowTrash(true)}
            icon={<RotateCcw className="h-5 w-5" />}
            title="Recently deleted"
            description="Restore rooms, worlds and pages you deleted."
          />
        </div>
      </main>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  description,
  primary,
  secondary,
  meta,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string; icon: React.ReactNode };
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-800/40 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-neutral-800 p-2 text-sky-400">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            {meta && <span className="text-xs text-neutral-500">{meta}</span>}
          </div>
          <p className="text-sm text-neutral-400">{description}</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={primary.href}
          className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 touch:min-h-11"
        >
          {primary.label} <ArrowRight className="h-4 w-4" />
        </Link>
        {secondary && (
          <Link
            href={secondary.href}
            className="flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 touch:min-h-11"
          >
            {secondary.icon} {secondary.label}
          </Link>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto touch:max-h-none touch:overflow-visible">{children}</div>
    </section>
  );
}

function ToolCard({
  href,
  onClick,
  icon,
  title,
  description,
}: {
  href?: string;
  /** A card that opens something in place instead of navigating. */
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const className =
    "group flex items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-800/40 p-4 text-start hover:border-neutral-700 hover:bg-neutral-800/70";
  const body = (
    <>
      <div className="rounded-lg bg-neutral-800 p-2 text-sky-400">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-neutral-400">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-neutral-600 group-hover:text-neutral-300" />
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/** Live / Live · unpublished edits / Offline, plus "N drafts" for the versions
 *  that aren't the live one (the Shopify-style page versions). */
function PageBadges({
  record,
  versions,
}: {
  record: LandingPageRecord;
  versions: PageVersionMeta[] | undefined;
}) {
  const live = record.status === "published";
  const liveVersion = live ? versions?.find((v) => v.id === record.liveVersionId) : undefined;
  const edited = versionState(record, liveVersion).edited;
  const drafts = (versions ?? []).filter((v) => !(live && v.id === record.liveVersionId)).length;
  return (
    <>
      {live ? (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            edited ? "bg-amber-900/40 text-amber-300" : "bg-emerald-900/40 text-emerald-300"
          }`}
          title={edited ? "The live version has edits visitors can't see yet" : "Visitors see this page"}
        >
          {edited ? "Live · unpublished edits" : "Live"}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-neutral-400">
          Offline
        </span>
      )}
      {drafts > 0 && (
        <span className="shrink-0 rounded-full bg-sky-900/40 px-2 py-0.5 text-[11px] font-medium text-sky-300">
          {drafts} draft{drafts === 1 ? "" : "s"}
        </span>
      )}
    </>
  );
}

function Loading() {
  return <p className="text-sm italic text-neutral-500">Loading…</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm italic text-neutral-500">{children}</p>;
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 rounded border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-300">
      {children}
    </p>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never saved";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
