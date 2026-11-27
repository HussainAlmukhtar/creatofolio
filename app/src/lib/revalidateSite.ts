// Best-effort client helper for /api/admin/revalidate: asks the server to
// drop the cached public pages after a Publish / "Save & go live". Never
// throws and never blocks the UI — the 60 s ISR window is the safety net.

export async function revalidatePublicPaths(
  paths: string[],
  opts: { layout?: boolean } = {}
): Promise<void> {
  try {
    await fetch("/api/admin/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, layout: opts.layout === true }),
    });
  } catch {
    // ignore
  }
}

/** The public paths a landing page occupies (plus the sitemap). */
export function landingPublicPaths(slug: string): string[] {
  return [slug === "home" ? "/" : `/${slug}`, "/sitemap.xml"];
}
