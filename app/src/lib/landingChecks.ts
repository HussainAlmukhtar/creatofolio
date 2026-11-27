// Pre-publish checks for a landing page: broken links, missing labels, half-
// translated text, empty SEO. Pure (no React, no Supabase) so the editor, the
// publish gate and scripts all see the same list.
//
// Bilingual completeness is found by SHAPE, not by a field list: any
// `{ en, ar }` pair anywhere in the page (section text, buttons' block props,
// accordion/tab/carousel/form items, SEO meta…) counts as a Localized field,
// so a new block type is covered without touching this file. A pair with BOTH
// sides empty is an unused optional field and is ignored; one side filled and
// the other empty is the warning.

import type {
  DrawnPage,
  DrawnSection,
  DrawnAsset,
  Localized,
  SiteConfig,
} from "@/data/landingTypes";
import { scheduleState } from "@/data/sectionVisibility";
import { contentTranslation, walkLocalized } from "./localizedChecks";
import { migrateObjectContent } from "@/data/contentMigrations";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueCode =
  | "link_missing_page"
  | "scroll_target_missing"
  | "interactive_no_label"
  | "missing_translation"
  | "link_offline_page"
  | "popup_no_content"
  | "popup_missing_translation"
  | "seo_no_title"
  | "seo_no_description"
  | "seo_no_share_image"
  | "section_schedule_ended"
  | "site_link_missing_page"
  | "dead_link"
  | "button_no_action";

export interface Issue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  target?: { sectionIid?: string; assetIid?: string };
}

export interface CheckInput {
  page: DrawnPage;
  siteConfig?: SiteConfig | null;
  /** Every page of the site, for link resolution. */
  pages: { slug: string; status: string }[];
  /** This page's pop-up content, keyed by asset iid. Values are opaque here.
   *  Omit when it isn't loaded yet: the "no content" check is then skipped. */
  contentMap?: Record<string, unknown>;
  /** Slugs claimed by app routes (not CMS pages); links to them are fine. */
  isReservedSlug?: (slug: string) => boolean;
  /** "Now" for scheduled sections (ms). Defaults to Date.now(). */
  now?: number;
}

const INTERNAL_PAGE_RE = /^\/([a-z0-9][a-z0-9_-]*)?\/?(?:[?#].*)?$/;

/** A target that goes nowhere: empty, a bare "#", or a javascript: URL. */
const isDeadTarget = (s: unknown) => {
  if (!isStr(s)) return true;
  const t = s.trim().toLowerCase();
  return t === "" || t === "#" || t.startsWith("javascript:");
};

const isStr = (v: unknown): v is string => typeof v === "string";
const blank = (s: unknown) => !isStr(s) || s.trim() === "";

function preview(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 37)}…` : t;
}

/** Result of resolving an internal path against the site's pages. */
type LinkVerdict = "ok" | "missing" | "offline";

function resolveInternalLink(
  href: string,
  pages: CheckInput["pages"],
  isReserved?: (slug: string) => boolean
): { verdict: LinkVerdict; slug?: string } {
  const m = href.trim().match(INTERNAL_PAGE_RE);
  if (!m) return { verdict: "ok" }; // external, #anchor, mailto:, tel: …
  const slug = m[1] ?? "home";
  // The public "/" always renders (static seed fallback), so home is never
  // missing or offline.
  if (slug === "home") return { verdict: "ok", slug };
  if (isReserved?.(slug)) return { verdict: "ok", slug };
  const page = pages.find((p) => p.slug === slug);
  if (!page) return { verdict: "missing", slug };
  if (page.status !== "published") return { verdict: "offline", slug };
  return { verdict: "ok", slug };
}

export function checkLandingPage(input: CheckInput): Issue[] {
  const { page, siteConfig, pages, contentMap, isReservedSlug } = input;
  const now = input.now ?? Date.now();
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  const sectionIds = new Set(page.sections.map((s) => s.id));

  const half = (
    l: Localized,
    what: string,
    target?: Issue["target"]
  ) => {
    const en = !blank(l.en);
    const ar = !blank(l.ar);
    if (en === ar) return; // both filled (fine) or both empty (unused)
    add({
      severity: "warning",
      code: "missing_translation",
      message: en
        ? `${what}: Arabic is missing for “${preview(l.en)}”.`
        : `${what}: English is missing for “${preview(l.ar)}”.`,
      target,
    });
  };

  const checkHref = (href: string, what: string, target?: Issue["target"]) => {
    const r = resolveInternalLink(href, pages, isReservedSlug);
    if (r.verdict === "missing") {
      add({
        severity: "error",
        code: "link_missing_page",
        message: `${what} links to “${href}”, but there is no page called “${r.slug}”. Visitors would get a “not found” page.`,
        target,
      });
    } else if (r.verdict === "offline") {
      add({
        severity: "warning",
        code: "link_offline_page",
        message: `${what} links to “${r.slug}”, which is offline (not published). Visitors would get a “not found” page until you publish it.`,
        target,
      });
    }
  };

  const deadLink = (what: string, href: string, target?: Issue["target"]) =>
    add({
      severity: "error",
      code: "dead_link",
      message: `${what} goes nowhere (${blank(href) ? "no link set" : `“${href.trim()}”`}). Visitors would click and nothing would happen.`,
      target,
    });

  // ── Page-level SEO ──────────────────────────────────────────
  const meta = page.meta;
  if (!meta || (blank(meta.title?.en) && blank(meta.title?.ar))) {
    add({
      severity: "warning",
      code: "seo_no_title",
      message: "The page has no SEO title (shown in browser tabs and search results).",
    });
  } else {
    half(meta.title, "SEO title");
  }
  if (!meta?.description || (blank(meta.description.en) && blank(meta.description.ar))) {
    add({
      severity: "warning",
      code: "seo_no_description",
      message: "The page has no SEO description (the grey text under the title in search results).",
    });
  } else {
    half(meta.description, "SEO description");
  }
  if (blank(meta?.ogImage) && blank(siteConfig?.seo?.defaultOgImage)) {
    add({
      severity: "warning",
      code: "seo_no_share_image",
      message: "No share image: link previews (WhatsApp, LinkedIn, X) will have no picture. Set one on the page or a site default.",
    });
  }

  // ── Sections ────────────────────────────────────────────────
  page.sections.forEach((section: DrawnSection, si) => {
    const sName = section.name?.en?.trim() || section.id || `Section ${si + 1}`;
    // Hidden / scheduled-out sections aren't visible, so only note the latter.
    if (scheduleState(section, now) === "ended") {
      add({
        severity: "info",
        code: "section_schedule_ended",
        message: `“${sName}” is scheduled to end in the past, so visitors can't see it.`,
        target: { sectionIid: section.iid },
      });
      return;
    }
    if (section.hidden) return;

    section.assets.forEach((asset: DrawnAsset, ai) => {
      const target = { sectionIid: section.iid, assetIid: asset.iid };
      const where = `${sName} › element ${ai + 1}`;

      // Text.
      if (asset.source.kind === "text") {
        half(asset.source.text, `${sName} › ${asset.titleRole ?? "text"}`, target);
      }

      // Components: every bilingual pair + every `href` inside the block.
      if (asset.source.kind === "component") {
        const block = asset.source;
        walkLocalized(
          block.block.props,
          [block.block.type],
          ({ en, ar, path }) => half({ en, ar }, `${sName} › ${path.join(" › ")}`, target),
          (href, path) => {
            const what = `${sName} › ${path.join(" › ")}`;
            if (isDeadTarget(href)) deadLink(what, href, target);
            else checkHref(href, what, target);
          }
        );
        // A button component with an empty href is skipped by the walk above.
        // (Email / download buttons carry their target in other props.)
        const kind = block.block.props?.kind;
        if (block.block.type === "button" && (!kind || kind === "link") && blank(block.block.props?.href)) {
          deadLink(`${sName} › button`, "", target);
        }
      }

      // Interactive role.
      if (asset.role.kind !== "decoration") {
        if (blank(asset.label) && blank(asset.labelAr)) {
          add({
            severity: "error",
            code: "interactive_no_label",
            message: `${where} is a ${asset.role.kind} with no label in either language (screen readers can't announce it).`,
            target,
          });
        } else {
          half(
            { en: asset.label ?? "", ar: asset.labelAr ?? "" },
            `${where} label`,
            target
          );
        }
      }
      if (!blank(asset.description) || !blank(asset.descriptionAr)) {
        half(
          { en: asset.description ?? "", ar: asset.descriptionAr ?? "" },
          `${where} description`,
          target
        );
      }

      // Link / button targets.
      if (asset.role.kind === "link") {
        if (isDeadTarget(asset.role.href)) deadLink(where, asset.role.href ?? "", target);
        else checkHref(asset.role.href, where, target);
      } else if (asset.role.kind === "button") {
        const id = asset.role.actionId ?? "";
        if (blank(id)) {
          add({
            severity: "error",
            code: "button_no_action",
            message: `${where} is a button with no action chosen, so a click does nothing. Pick what it opens or scrolls to (public visitors see it as plain artwork until then).`,
            target,
          });
        }
        const i = id.indexOf(":");
        const prefix = i === -1 ? "" : id.slice(0, i);
        const value = i === -1 ? "" : id.slice(i + 1);
        if (prefix === "content") {
          // Pop-up content lives under the button's own iid (or the iid it names).
          if (contentMap && contentMap[value] === undefined && contentMap[asset.iid] === undefined) {
            add({
              severity: "warning",
              code: "popup_no_content",
              message: `${where} opens a pop-up, but the pop-up has no content yet.`,
              target,
            });
          } else if (contentMap) {
            // Half-translated pop-up text, by the same shape rule as the page.
            const c = migrateObjectContent(contentMap[value] ?? contentMap[asset.iid]);
            const gaps = contentTranslation(c).gaps;
            if (gaps.length) {
              const g = gaps[0];
              add({
                severity: "warning",
                code: "popup_missing_translation",
                message: `${where} › pop-up: ${g.filled === "en" ? "Arabic" : "English"} is missing for “${g.preview}”${
                  gaps.length > 1 ? ` (and ${gaps.length - 1} more)` : ""
                }.`,
                target,
              });
            }
          }
        } else if (prefix === "scroll") {
          if (!sectionIds.has(value)) {
            add({
              severity: "error",
              code: "scroll_target_missing",
              message: `${where} scrolls to a section (“${value}”) that no longer exists on this page.`,
              target,
            });
          }
        }
      }
    });
  });

  // ── Site chrome links (live on save, so only warnings here) ──
  if (siteConfig) {
    const siteLinks: { href: string; what: string }[] = [];
    siteConfig.header?.links?.forEach((l, i) =>
      siteLinks.push({ href: l.href, what: `Nav link ${i + 1}` })
    );
    if (siteConfig.header?.cta?.enabled)
      siteLinks.push({ href: siteConfig.header.cta.href, what: "Nav button" });
    siteConfig.footer?.links?.forEach((l, i) =>
      siteLinks.push({ href: l.href, what: `Footer link ${i + 1}` })
    );
    if (siteConfig.announcementBar?.enabled && siteConfig.announcementBar.href)
      siteLinks.push({ href: siteConfig.announcementBar.href, what: "Announcement bar" });
    for (const l of siteLinks) {
      if (blank(l.href)) continue;
      const r = resolveInternalLink(l.href, pages, isReservedSlug);
      if (r.verdict !== "ok") {
        add({
          severity: "warning",
          code: "site_link_missing_page",
          message:
            r.verdict === "missing"
              ? `${l.what} (site-wide) links to “${l.href}”, but there is no page called “${r.slug}”.`
              : `${l.what} (site-wide) links to “${r.slug}”, which is offline.`,
        });
      }
    }
  }

  return issues;
}

/** Counts by severity, for the toolbar badge. */
export function summarizeIssues(issues: Issue[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    infos: issues.filter((i) => i.severity === "info").length,
  };
}
