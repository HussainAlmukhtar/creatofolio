"use client";

// SiteSettingsPanel — editor for the site-wide announcement bar, header/nav
// and footer (SiteConfig). One singleton config, not per-page, so this is a
// dialog opened from the editor toolbar rather than a page in the PAGES
// list. Fields are GENERATED the same way a block's settings are (see
// FormFields.tsx / BlockInspector.tsx) — three flat FieldDescriptor groups,
// one per SiteConfig section.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldControl, ArrayField } from "./FormFields";
import { FontPairField } from "./FontPicker";
import { DEFAULT_TYPOGRAPHY } from "@/data/fonts";
import type { CustomFont } from "@/data/landingTypes";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { useSiteConfigEditorStore } from "@/stores/siteConfigEditorStore";
import type { FieldDescriptor, FormsConfig } from "@/data/landingTypes";
import { hubspotIdsValid } from "@/lib/formSubmission";
import { defaultSiteConfig } from "@/data/siteConfig";
import { HOVER_EFFECT_OPTIONS, DEFAULT_HOVER_EFFECT } from "@/components/landing/hoverEffect";

const LINK_ITEM_FIELDS: FieldDescriptor[] = [
  { kind: "text", key: "label", label: "Label", localized: true },
  { kind: "url", key: "href", label: "Link URL" },
  { kind: "toggle", key: "newTab", label: "Open in new tab" },
];

const ANNOUNCEMENT_FIELDS: FieldDescriptor[] = [
  { kind: "toggle", key: "enabled", label: "Show announcement bar" },
  { kind: "text", key: "text", label: "Message", localized: true },
  { kind: "url", key: "href", label: "Link (optional — makes the whole bar clickable)" },
  { kind: "toggle", key: "dismissible", label: "Visitors can dismiss it" },
  { kind: "color", key: "bg", label: "Background colour" },
  { kind: "color", key: "color", label: "Text colour" },
];

const INTERACTION_FIELDS: FieldDescriptor[] = [
  {
    kind: "select",
    key: "hoverEffect",
    label: "Hover effect (links & buttons)",
    options: HOVER_EFFECT_OPTIONS,
  },
  {
    kind: "note",
    label:
      "The default for every clickable element. Any element can override it in its own settings. Touch screens get a press effect; visitors who prefer reduced motion get no movement.",
  },
];

const FORMS_FIELDS: FieldDescriptor[] = [
  {
    kind: "select",
    key: "destination",
    label: "Where form submissions go",
    options: [
      { value: "none", label: "Not connected — forms hidden from visitors" },
      { value: "hubspot", label: "HubSpot form" },
      { value: "webhook", label: "Webhook — any CRM / mailing tool / automation" },
    ],
  },
  { kind: "text", key: "hubspotPortalId", label: "HubSpot portal ID (HubSpot only)", placeholder: "e.g. 12345678" },
  {
    kind: "text",
    key: "hubspotFormGuid",
    label: "HubSpot form GUID (HubSpot only)",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
];

const MAINTENANCE_FIELDS: FieldDescriptor[] = [
  { kind: "toggle", key: "enabled", label: "Show a maintenance page to visitors" },
  { kind: "text", key: "title", label: "Title", localized: true },
  { kind: "textarea", key: "message", label: "Message", localized: true },
  {
    kind: "note",
    label:
      "While this is on, every public page shows this holding page instead (search engines are told to come back later). You always see the real site while logged in to the editor.",
  },
];

const SEO_FIELDS: FieldDescriptor[] = [
  { kind: "text", key: "siteName", label: "Site name", localized: true },
  { kind: "image", key: "defaultOgImage", label: "Default share image (used by pages without their own)" },
  { kind: "text", key: "twitterHandle", label: "Twitter / X handle", placeholder: "@yourhandle" },
  {
    kind: "note",
    label:
      "Shown when a page is shared (LinkedIn, WhatsApp, X…). A page's own title, description and share image are set in its Search & sharing panel. 1200×630 works best.",
  },
];

const FOOTER_FIELDS: FieldDescriptor[] = [
  { kind: "toggle", key: "enabled", label: "Show footer" },
  { kind: "text", key: "brandLine", label: "Brand line (optional)", localized: true },
  {
    kind: "array",
    key: "links",
    label: "Footer links",
    itemLabelKey: "label",
    itemFields: LINK_ITEM_FIELDS,
    defaultItem: { label: { en: "New link", ar: "رابط جديد" }, href: "/", newTab: false },
  },
  { kind: "text", key: "copyright", label: "Copyright line", localized: true },
];

function FieldGroup({
  title,
  fields,
  values,
  onChange,
}: {
  title: string;
  fields: FieldDescriptor[];
  values: Record<string, unknown>;
  onChange: (partial: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {fields.map((f) =>
        f.kind === "array" ? (
          <ArrayField
            key={f.key}
            field={f}
            items={(values[f.key] as Record<string, unknown>[]) ?? []}
            onChange={(items) => onChange({ [f.key]: items })}
          />
        ) : f.kind === "heading" || f.kind === "note" ? (
          <FieldControl key={f.label} field={f} value={undefined} onChange={() => {}} />
        ) : (
          <FieldControl
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => onChange({ [f.key]: v })}
          />
        )
      )}
    </div>
  );
}

export function SiteSettingsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = useSiteConfigEditorStore((s) => s.config);
  const source = useSiteConfigEditorStore((s) => s.source);
  const isDirty = useSiteConfigEditorStore((s) => s.isDirty);
  const isSaving = useSiteConfigEditorStore((s) => s.isSaving);
  const hydrate = useSiteConfigEditorStore((s) => s.hydrate);
  const updateAnnouncementBar = useSiteConfigEditorStore((s) => s.updateAnnouncementBar);
  const setNavStudioOpen = useSiteConfigEditorStore((s) => s.setNavStudioOpen);
  const updateFooter = useSiteConfigEditorStore((s) => s.updateFooter);
  const updateInteractions = useSiteConfigEditorStore((s) => s.updateInteractions);
  const updateForms = useSiteConfigEditorStore((s) => s.updateForms);
  const updateMaintenance = useSiteConfigEditorStore((s) => s.updateMaintenance);
  const updateSeo = useSiteConfigEditorStore((s) => s.updateSeo);
  const save = useSiteConfigEditorStore((s) => s.save);

  useEffect(() => {
    if (open) void hydrate();
  }, [open, hydrate]);

  const onSave = async () => {
    const result = await save();
    if (result.ok) toast.success("Site settings are live.");
    else if (result.code !== "conflict") toast.error("Save failed", { description: result.error });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Site settings</DialogTitle>
          <DialogDescription>
            Maintenance page, announcement bar, header/nav, interactions, forms
            and footer: site-wide, edited once here. Changes here go live on
            every page as soon as you save. They aren&apos;t part of page
            drafts.
          </DialogDescription>
        </DialogHeader>

        {source === "static" && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Couldn&apos;t reach Supabase — changes here won&apos;t persist.
          </p>
        )}

        <div className="max-h-[65dvh] space-y-4 overflow-y-auto pr-1">
          <FieldGroup
            title="Maintenance / password page"
            fields={MAINTENANCE_FIELDS}
            values={(config.maintenance ?? defaultSiteConfig.maintenance!) as unknown as Record<string, unknown>}
            onChange={updateMaintenance}
          />
          <MaintenanceStatus enabled={Boolean(config.maintenance?.enabled)} />
          <FieldGroup
            title="Announcement bar"
            fields={ANNOUNCEMENT_FIELDS}
            values={config.announcementBar as unknown as Record<string, unknown>}
            onChange={updateAnnouncementBar}
          />
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Header / nav</h3>
              <p className="text-[12px] text-muted-foreground">
                {config.header.enabled ? "On" : "Off"} · style, scroll behaviour, drawings and the phone menu live in the Nav Studio.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                onOpenChange(false);
                setNavStudioOpen(true);
              }}
            >
              Open Nav Studio
            </Button>
          </div>
          <TypographyGroup />
          <FieldGroup
            title="Interactions"
            fields={INTERACTION_FIELDS}
            values={
              (config.interactions ?? { hoverEffect: DEFAULT_HOVER_EFFECT }) as unknown as Record<
                string,
                unknown
              >
            }
            onChange={updateInteractions}
          />
          <FieldGroup
            title="Forms"
            fields={FORMS_FIELDS}
            values={(config.forms ?? { destination: "none" }) as unknown as Record<string, unknown>}
            onChange={updateForms}
          />
          <FormsStatus forms={config.forms} />
          <FieldGroup
            title="SEO defaults"
            fields={SEO_FIELDS}
            values={
              {
                siteName: { en: "", ar: "" },
                ...(config.seo ?? {}),
              } as unknown as Record<string, unknown>
            }
            onChange={updateSeo}
          />
          <FieldGroup
            title="Footer"
            fields={FOOTER_FIELDS}
            values={config.footer as unknown as Record<string, unknown>}
            onChange={updateFooter}
          />
        </div>

        <DialogFooter>
          <Button onClick={onSave} disabled={isSaving || !isDirty}>
            {isSaving ? "Saving…" : "Save & go live"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One line under the Forms group saying whether the chosen destination will
 * actually work: HubSpot ids well-formed, or the webhook URL present on the
 * server (a secret env var the browser can't read — asked via GET
 * /api/forms/submit).
 */
function FormsStatus({ forms }: { forms?: FormsConfig }) {
  const destination = forms?.destination ?? "none";
  const [webhookConfigured, setWebhookConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    if (destination !== "webhook") return;
    let cancelled = false;
    fetch("/api/forms/submit")
      .then((r) => r.json())
      .then((j: { webhookConfigured?: boolean }) => {
        if (!cancelled) setWebhookConfigured(Boolean(j.webhookConfigured));
      })
      .catch(() => {
        if (!cancelled) setWebhookConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [destination]);

  let text: string;
  let ok = false;
  if (destination === "none") {
    text = "Forms are hidden from visitors until a destination is chosen.";
  } else if (destination === "hubspot") {
    ok = hubspotIdsValid(forms ?? { destination });
    text = ok
      ? "HubSpot is set. Field keys in each Form block must match the HubSpot form's property names (email, firstname, message…)."
      : "Enter the portal ID (digits) and the form GUID from the HubSpot form's embed code.";
  } else if (webhookConfigured === null) {
    text = "Checking the server…";
  } else {
    ok = webhookConfigured;
    text = ok
      ? "Webhook URL is configured on the server. Submissions are POSTed as JSON."
      : "Set FORM_WEBHOOK_URL (and optionally FORM_WEBHOOK_SECRET) in the server's environment — it's a secret, so it isn't stored here.";
  }
  return (
    <p className={`-mt-2 text-[11px] ${ok ? "text-emerald-400" : "text-amber-400"}`}>{text}</p>
  );
}

/** Under the Maintenance group: is a visitor password set on the server? */
function MaintenanceStatus({ enabled }: { enabled: boolean }) {
  const [pw, setPw] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-access")
      .then((r) => r.json())
      .then((j: { passwordConfigured?: boolean }) => !cancelled && setPw(Boolean(j.passwordConfigured)))
      .catch(() => !cancelled && setPw(false));
    return () => {
      cancelled = true;
    };
  }, []);
  const text =
    pw === null
      ? "Checking the server…"
      : pw
        ? "A visitor password is set (SITE_PASSWORD): people you give it to can enter the site while it's in maintenance."
        : "No visitor password: the page only shows your message. To let testers in, set SITE_PASSWORD in the server's environment (it's a secret, so it isn't stored here).";
  return (
    <p className={`-mt-2 text-[11px] ${enabled ? "text-amber-400" : "text-muted-foreground"}`}>
      {enabled ? "ON after you save: visitors see the holding page. " : ""}
      {text}
    </p>
  );
}

/** Site fonts: headings + text, each with an Arabic pairing; uploaded fonts. */
function TypographyGroup() {
  const typography = useSiteConfigEditorStore((s) => s.config.typography ?? DEFAULT_TYPOGRAPHY);
  const updateTypography = useSiteConfigEditorStore((s) => s.updateTypography);
  const setFont = (id: string, patch: Partial<CustomFont>) =>
    updateTypography((t) => ({
      ...t,
      customFonts: t.customFonts.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  return (
    <div className="space-y-4 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fonts</h3>
        <p className="text-[12px] text-muted-foreground">
          Used everywhere unless an element picks its own. Arabic text uses the Arabic pick.
        </p>
      </div>
      <FontPairField
        label="Headings (logo, titles, big text)"
        latin={typography.display.latin}
        arabic={typography.display.arabic}
        onChange={(latin, arabic) =>
          updateTypography((t) => ({
            ...t,
            display: { latin: latin ?? DEFAULT_TYPOGRAPHY.display.latin, arabic: arabic ?? DEFAULT_TYPOGRAPHY.display.arabic },
          }))
        }
      />
      <FontPairField
        label="Text (paragraphs, links, buttons)"
        latin={typography.body.latin}
        arabic={typography.body.arabic}
        onChange={(latin, arabic) =>
          updateTypography((t) => ({
            ...t,
            body: { latin: latin ?? DEFAULT_TYPOGRAPHY.body.latin, arabic: arabic ?? DEFAULT_TYPOGRAPHY.body.arabic },
          }))
        }
      />
      {typography.customFonts.length > 0 && (
        <div className="space-y-2">
          <span className="text-[12px] text-muted-foreground">Your uploaded fonts</span>
          {typography.customFonts.map((f) => (
            <div key={f.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1.5">
              <Input value={f.name} onChange={(e) => setFont(f.id, { name: e.target.value })} aria-label="Font name" />
              <select
                className="h-8 rounded-md border border-input bg-background px-1.5 text-[12px]"
                value={f.weight}
                onChange={(e) => setFont(f.id, { weight: Number(e.target.value) })}
                aria-label="Weight"
                title="The weight this file is (one file = one weight)"
              >
                {[300, 400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <select
                className="h-8 rounded-md border border-input bg-background px-1.5 text-[12px]"
                value={f.script}
                onChange={(e) => setFont(f.id, { script: e.target.value as CustomFont["script"] })}
                aria-label="Script"
              >
                <option value="latin">English</option>
                <option value="arabic">Arabic</option>
                <option value="both">Both</option>
              </select>
              <Button
                size="icon-sm"
                variant="ghost"
                title="Remove this font (text using it falls back to the site font)"
                onClick={() => updateTypography((t) => ({ ...t, customFonts: t.customFonts.filter((x) => x.id !== f.id) }))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
