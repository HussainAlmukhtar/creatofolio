// Public Form-block submission endpoint.
//
// PUBLIC path (not /api/editor): never uses the service-role client. The
// destination comes from the published site config via the anon loader;
// the webhook URL is a server env var (FORM_WEBHOOK_URL, optional
// FORM_WEBHOOK_SECRET sent as X-Form-Secret). Nothing in the request can
// choose where data goes.
//
// Abuse controls: body-size cap, strict validation (lib/formSubmission.ts),
// a honeypot field (filled → pretend success, drop it), and a small
// per-IP rate limit. The limiter is in-memory, so it's per server instance —
// a speed bump against scripts, not a guarantee; put a platform/WAF limit in
// front if the form ever attracts real spam.

import { NextResponse, type NextRequest } from "next/server";
import { loadPublishedSiteConfig } from "@/lib/landingData";
import {
  FORM_LIMITS,
  hubspotIdsValid,
  sendToHubspot,
  sendToWebhook,
  validateSubmission,
} from "@/lib/formSubmission";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    // Bound memory: drop the oldest-inserted keys.
    for (const key of Array.from(hits.keys()).slice(0, 1000)) hits.delete(key);
  }
  return recent.length > MAX_PER_WINDOW;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Status for the editor's Site settings: is a webhook URL configured? */
export async function GET() {
  return NextResponse.json({ webhookConfigured: Boolean(process.env.FORM_WEBHOOK_URL) });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > FORM_LIMITS.maxBodyBytes) {
    return NextResponse.json({ error: "Submission too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
  }

  const parsed = validateSubmission(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const sub = parsed.value;

  // Honeypot filled → a bot. Answer like a success so it learns nothing.
  if (sub.website) return NextResponse.json({ ok: true });

  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { error: "Too many messages from here — please try again in a few minutes." },
      { status: 429 }
    );
  }

  const cfg = (await loadPublishedSiteConfig()).forms ?? { destination: "none" as const };
  const pageUri = `${req.nextUrl.origin}/${sub.page && sub.page !== "home" ? sub.page : ""}`;

  try {
    if (cfg.destination === "hubspot" && hubspotIdsValid(cfg)) {
      const r = await sendToHubspot(cfg, sub, pageUri);
      if (r.ok) return NextResponse.json({ ok: true });
      console.error("[forms] HubSpot rejected submission", r.status);
    } else if (cfg.destination === "webhook" && process.env.FORM_WEBHOOK_URL) {
      const r = await sendToWebhook(
        process.env.FORM_WEBHOOK_URL,
        process.env.FORM_WEBHOOK_SECRET,
        sub,
        pageUri
      );
      if (r.ok) return NextResponse.json({ ok: true });
      console.error("[forms] webhook rejected submission", r.status);
    } else {
      return NextResponse.json(
        { error: "This form isn't connected yet." },
        { status: 503 }
      );
    }
  } catch (err) {
    console.error("[forms] delivery failed", err);
  }
  return NextResponse.json(
    { error: "Couldn't send your message — please try again later." },
    { status: 502 }
  );
}
