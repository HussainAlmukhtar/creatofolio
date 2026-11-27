// Form-block submissions — the pieces shared by the public API route
// (/api/forms/submit) and the Form block. Pure functions, no I/O except the
// two destination adapters at the bottom, which the route calls.

import type { FormsConfig } from "@/data/landingTypes";

export interface FormSubmission {
  /** The page the form was on (slug) — context for the recipient. */
  page: string;
  /** Author-given form name ("contact", "newsletter"…). */
  form: string;
  /** name → value, in the form's field order. */
  fields: Record<string, string>;
  /** Honeypot: a visually-hidden field real people never fill in. */
  website?: string;
}

export const FORM_LIMITS = {
  maxFields: 20,
  maxValueLength: 5000,
  maxBodyBytes: 20_000,
} as const;

/** Field names become HubSpot property names / webhook keys: keep them tame. */
export const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Coerce an author-typed field key ("Email Address") into a valid one
 *  ("email_address") so a typo in the editor can't make every submission
 *  fail validation. */
export function normalizeFieldName(raw: string): string {
  const n = (raw || "field")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(n) ? n : `f_${n}`.slice(0, 64);
}

/**
 * Validate an untrusted submission body. Returns the cleaned submission or an
 * error string safe to show the visitor.
 */
export function validateSubmission(
  body: unknown
): { ok: true; value: FormSubmission } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid submission." };
  const b = body as Record<string, unknown>;
  const page = typeof b.page === "string" ? b.page.slice(0, 80) : "";
  const form = typeof b.form === "string" ? b.form.slice(0, 64) : "form";
  if (!b.fields || typeof b.fields !== "object") return { ok: false, error: "Invalid submission." };
  const entries = Object.entries(b.fields as Record<string, unknown>);
  if (entries.length === 0 || entries.length > FORM_LIMITS.maxFields) {
    return { ok: false, error: "Invalid submission." };
  }
  const fields: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (!FIELD_NAME_RE.test(name)) return { ok: false, error: "Invalid submission." };
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length > FORM_LIMITS.maxValueLength) {
      return { ok: false, error: "One of the answers is too long." };
    }
    if (name === "email" && value && !EMAIL_RE.test(value)) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    fields[name] = value;
  }
  if (Object.values(fields).every((v) => v === "")) {
    return { ok: false, error: "The form is empty." };
  }
  return {
    ok: true,
    value: { page, form, fields, website: typeof b.website === "string" ? b.website : undefined },
  };
}

/** HubSpot ids go into the request URL — accept only their real shapes. */
export function hubspotIdsValid(cfg: FormsConfig): boolean {
  return (
    /^\d{3,12}$/.test(cfg.hubspotPortalId ?? "") &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cfg.hubspotFormGuid ?? ""
    )
  );
}

/**
 * Whether visitors should see forms at all: the owner picked a destination
 * (and, for HubSpot, entered well-formed ids). The webhook URL is a server
 * secret the browser can't see — if it's missing, submissions fail with a
 * clear error and Site settings flags it (GET /api/forms/submit).
 */
export function formsVisible(cfg: FormsConfig | undefined): boolean {
  if (!cfg) return false;
  if (cfg.destination === "hubspot") return hubspotIdsValid(cfg);
  return cfg.destination === "webhook";
}

// ─── Destination adapters (server-side only) ───────────────────

/** HubSpot Forms API v3 (unauthenticated, public ids). FORMS_HUBSPOT_ENDPOINT
 *  points it at a stand-in server for testing; leave it unset otherwise. */
const HUBSPOT_ENDPOINT =
  process.env.FORMS_HUBSPOT_ENDPOINT ?? "https://api.hsforms.com/submissions/v3/integration/submit";

export async function sendToHubspot(
  cfg: FormsConfig,
  sub: FormSubmission,
  pageUri: string
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${HUBSPOT_ENDPOINT}/${cfg.hubspotPortalId}/${cfg.hubspotFormGuid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Field names must match the HubSpot form's internal property names
      // (email, firstname, message…) — set per field in the Form block.
      fields: Object.entries(sub.fields).map(([name, value]) => ({ name, value })),
      context: { pageUri, pageName: sub.page || "home" },
    }),
    signal: AbortSignal.timeout(8000),
  });
  return { ok: res.ok, status: res.status };
}

export async function sendToWebhook(
  url: string,
  secret: string | undefined,
  sub: FormSubmission,
  pageUri: string
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Form-Secret": secret } : {}),
    },
    body: JSON.stringify({
      form: sub.form,
      page: sub.page,
      pageUri,
      fields: sub.fields,
      submittedAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(8000),
  });
  // Some endpoints (a Google Apps Script web app, for one) cannot set a
  // status code and answer 200 with `{ "ok": false }` when they refuse a
  // message, so a JSON body that says it failed counts as a failure.
  let refused = false;
  if (res.ok) {
    try {
      const body: unknown = await res.clone().json();
      refused = typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === false;
    } catch {
      // Not JSON: the status code is all there is to go on.
    }
  }
  return { ok: res.ok && !refused, status: res.status };
}
