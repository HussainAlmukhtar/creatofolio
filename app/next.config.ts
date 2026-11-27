import type { NextConfig } from "next";
import { storageImageHosts } from "./src/lib/storageUrl";

// next/image may only optimize images from hosts listed here. The public
// landing render (components/landing/AssetImage.tsx) serves uploads and
// drawings from the public Storage buckets — the (self-hosted) Supabase
// origin and, when set, NEXT_PUBLIC_STORAGE_PUBLIC_URL (e.g. the Cloudflare
// R2 bucket domain). Its `canOptimizeImage()` reads the same list and renders
// anything else unoptimized, so an unlisted URL never throws.

const nextConfig: NextConfig = {
  experimental: {
    // proxy.ts runs on every request, so Next buffers request bodies up to this
    // limit (default 10 MB) and fails larger ones. Match /api/editor/upload's
    // own 25 MB cap (room-bg originals, Klecks PSDs).
    proxyClientMaxBodySize: "25mb",
  },
  // Short git SHA of this build, shown in the admin header. Many hosts expose
  // SOURCE_COMMIT (or set GIT_SHA) at build time; empty (hidden) elsewhere, e.g. local dev.
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.SOURCE_COMMIT ?? process.env.GIT_SHA ?? "").slice(0, 7),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Same-origin framing only: the admin embeds /klecks/index.html.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: storageImageHosts().map((h) => ({
      protocol: h.protocol,
      hostname: h.hostname,
      pathname: `${h.pathPrefix}**`,
    })),
  },
  // The Next app lives in `app/`, but the git repo root is one level up and
  // holds unrelated subtrees (klecks/, supabase/, docs/, …) with no package.json
  // of their own. Without an explicit root, Turbopack walks up looking for a
  // lockfile, settles on the repo root, and then resolves PostCSS plugins
  // (`tailwindcss`) from there — which fails, because the only node_modules is
  // here in `app/`. npm always runs scripts with cwd set to this package, so
  // process.cwd() is the app directory for `next dev` and `next build` alike.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
