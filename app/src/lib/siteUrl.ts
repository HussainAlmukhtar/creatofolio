// Canonical origin for absolute URLs (sitemap.xml, robots.txt). Set
// NEXT_PUBLIC_SITE_URL to the real domain in production; on Vercel the
// production hostname is used automatically when it isn't set. Never ends
// with a slash.

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
