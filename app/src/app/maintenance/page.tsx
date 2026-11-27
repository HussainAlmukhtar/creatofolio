// The holding page shown while Site settings → Maintenance is on. src/proxy.ts
// rewrites every public route here (HTTP 503) for visitors who aren't logged
// in and haven't entered SITE_PASSWORD. Visiting it directly while the site
// is open just goes home.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadPublishedSiteConfig } from "@/lib/landingData";
import { maintenanceEnabled, sitePasswordConfigured } from "@/lib/siteAccess";
import { defaultSiteConfig } from "@/data/siteConfig";
import { UnlockForm } from "./UnlockForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creatofolio",
  robots: { index: false, follow: false },
};

export default async function MaintenancePage() {
  if (!(await maintenanceEnabled())) redirect("/");
  const config = await loadPublishedSiteConfig();
  const m = config.maintenance ?? defaultSiteConfig.maintenance!;
  const withPassword = sitePasswordConfigured();
  return (
    <main
      data-paper="sketchbook"
      className="paper-material grid min-h-svh place-items-center px-6 py-16 text-section-ink"
      data-grain="true"
    >
      <div className="w-full max-w-md text-center">
        <p className="mb-8 text-xs font-semibold uppercase tracking-[0.25em] text-section-ink-soft">
          Creatofolio
        </p>
        <h1 className="font-display text-5xl font-semibold leading-tight md:text-6xl">{m.title.en}</h1>
        <p className="mt-4 text-lg leading-relaxed text-section-ink-soft">{m.message.en}</p>
        {(m.title.ar || m.message.ar) && (
          <div dir="rtl" lang="ar" className="mt-8 border-t border-[color:var(--line)] pt-6">
            {m.title.ar && <h2 className="font-display text-3xl font-semibold">{m.title.ar}</h2>}
            {m.message.ar && <p className="mt-2 text-section-ink-soft">{m.message.ar}</p>}
          </div>
        )}
        {withPassword && <UnlockForm />}
      </div>
    </main>
  );
}
