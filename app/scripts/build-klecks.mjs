// Build the Klecks embed bundle from the sibling klecks/ checkout and copy it
// into app/public/klecks/ so the React modal's iframe can load it.
//
// Klecks lives outside the Next.js tree (a separate, pinned checkout) and uses
// Parcel for its own build. We don't try to merge build pipelines — we just
// shell out to its npm scripts and copy the artifact.
//
// Modes:
//   node scripts/build-klecks.mjs                 # full build (prebuild hook)
//   node scripts/build-klecks.mjs --if-missing    # skip if embed.js exists (postinstall)

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, "..");
const PUBLIC_DIR = resolve(APP_DIR, "public", "klecks");
const EMBED_OUT = resolve(PUBLIC_DIR, "embed.js");
const MANIFEST = resolve(PUBLIC_DIR, ".klecks-manifest.json");

const args = new Set(process.argv.slice(2));
const ifMissing = args.has("--if-missing");

// The Klecks version the app is built and tested against. A deploy used to
// `git clone --depth 1` upstream's HEAD, so production silently ran a different
// Klecks than the one developed locally (its embed wrapper had renamed
// `instance` to `embed`, which made the studio's guide-stripping export fall
// back to a flattening getPNG and bake the GUIDE layers into saved PNGs).
// Never build an unpinned Klecks: bump this on purpose, together with the
// patches below.
const PINNED_SHA = "1c3e0435c6eef15a1644c8ad06bb213e22b528c5"; // 0.10.1.5

// Our changes to Klecks, applied in name order on top of PINNED_SHA. Every
// hunk is marked `[creatofolio patch]` in the source; list: docs/ARCHITECTURE.md → Repository layout.
const PATCH_DIR = resolve(__dirname, "klecks-patches");
const patchFiles = existsSync(PATCH_DIR)
  ? readdirSync(PATCH_DIR).filter((f) => f.endsWith(".patch")).sort()
  : [];
const patchSetId = createHash("sha1")
  .update(PINNED_SHA)
  .update(patchFiles.map((f) => readFileSync(resolve(PATCH_DIR, f))).join("|"))
  .digest("hex")
  .slice(0, 12);
const PATCHSET_MARK = resolve(PUBLIC_DIR, ".klecks-patchset");

if (ifMissing && existsSync(EMBED_OUT)) {
  const built = existsSync(PATCHSET_MARK) ? readFileSync(PATCHSET_MARK, "utf8").trim() : "";
  if (built === patchSetId) {
    console.log("[klecks] embed.js already present — skipping (--if-missing).");
    process.exit(0);
  }
  console.log("[klecks] embed.js was built from a different Klecks/patch set — rebuilding.");
}

// Find the klecks/ checkout. It normally sits next to app/, but the repo can
// also be entered through a git worktree nested a few levels below the main
// checkout, so try several offsets.
const candidates = [
  resolve(APP_DIR, "..", "klecks"),
  resolve(APP_DIR, "..", "..", "klecks"),
  resolve(APP_DIR, "..", "..", "..", "klecks"),
  resolve(APP_DIR, "..", "..", "..", "..", "klecks"),
];
let KLECKS_DIR = candidates.find((p) => existsSync(resolve(p, "package.json")));

// Fresh CI/deploy checkouts only clone this repo — klecks/ is
// gitignored on purpose (see repo root .gitignore) and never committed here.
// Self-clone it as a sibling so the build works without a pre-existing
// developer machine setup.
if (!KLECKS_DIR) {
  const fallback = resolve(APP_DIR, "..", "klecks");
  console.log("[klecks] no local checkout found — cloning to", fallback);
  mkdirSync(fallback, { recursive: true });
  execSync(
    `git init && git remote add origin https://github.com/bitbof/klecks.git && git fetch --depth 1 origin ${PINNED_SHA} && git checkout -f FETCH_HEAD`,
    { cwd: fallback, stdio: "inherit", shell: true }
  );
  if (!existsSync(resolve(fallback, "package.json"))) {
    console.error("[klecks] clone did not produce a usable checkout at", fallback);
    process.exit(1);
  }
  KLECKS_DIR = fallback;
}

console.log("[klecks] using source at", KLECKS_DIR);

// Pin the checkout. A different HEAD is only tolerated when it is our own
// pinned commit plus patches (a dirty tree), never another upstream version.
const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { cwd: KLECKS_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const head = git("rev-parse HEAD");
if (head !== PINNED_SHA) {
  console.log(`[klecks] checkout is at ${head.slice(0, 7)}, expected ${PINNED_SHA.slice(0, 7)} — switching.`);
  try {
    git(`fetch --depth 1 origin ${PINNED_SHA}`);
    git("checkout -f FETCH_HEAD");
  } catch (e) {
    console.error("[klecks] could not switch to the pinned Klecks commit:", String(e.stderr || e));
    process.exit(1);
  }
}

// Apply our patches. A checkout that already holds exactly these patches is
// left alone. Otherwise (a fresh clone, or a tree patched with an older
// version of the patch set) start again from the pristine pinned source, so
// editing a patch never leaves a half-patched tree behind.
const patchPaths = patchFiles.map((f) => resolve(PATCH_DIR, f));
const isApplied = (file) => {
  try {
    git(`apply --check --reverse "${file}"`);
    return true;
  } catch {
    return false;
  }
};
if (patchPaths.length && patchPaths.every(isApplied)) {
  console.log(`[klecks] ${patchPaths.length} patch(es) already applied.`);
} else {
  git("checkout -f HEAD -- .");
  git("clean -fdq");
  for (const [i, file] of patchPaths.entries()) {
    try {
      git(`apply --whitespace=nowarn --ignore-whitespace "${file}"`);
      console.log(`[klecks] patch ${patchFiles[i]}: applied.`);
    } catch (e) {
      console.error(`[klecks] patch ${patchFiles[i]} does not apply to the pinned Klecks:`, String(e.stderr || e));
      process.exit(1);
    }
  }
}

const run = (cmd) => {
  console.log(`[klecks] $ ${cmd}`);
  execSync(cmd, { cwd: KLECKS_DIR, stdio: "inherit", shell: true });
};

// Skip `npm ci` if node_modules already exists (the .package-lock.json file
// in node_modules/ is npm's "resolved tree" marker; trust it).
const nmMarker = resolve(KLECKS_DIR, "node_modules", ".package-lock.json");
if (!existsSync(nmMarker)) {
  run("npm ci --no-audit --no-fund");
} else {
  console.log("[klecks] node_modules present — skipping npm ci.");
}

run("npm run lang:build");
// Newer Klecks (2025+) generates src/icons/icons.ts in a separate step; without
// it the Parcel build fails to resolve '../../icons/icons'. Older checkouts
// don't have the script, so only run it when package.json declares it.
const klecksScripts =
  JSON.parse(readFileSync(resolve(KLECKS_DIR, "package.json"), "utf8"))
    .scripts ?? {};
if (klecksScripts["icon:build"]) run("npm run icon:build");
run("npm run build:embed");

// Remove ONLY files we emitted last time (per .klecks-manifest.json) so the
// hand-written iframe wrapper at public/klecks/index.html survives the
// rebuild. Parcel emits content-hashed sibling chunks; without manifest
// cleanup, stale hashed chunks would accumulate forever.
mkdirSync(PUBLIC_DIR, { recursive: true });
if (existsSync(MANIFEST)) {
  try {
    const prev = JSON.parse(readFileSync(MANIFEST, "utf8"));
    if (Array.isArray(prev)) {
      for (const rel of prev) {
        const p = resolve(PUBLIC_DIR, rel);
        if (existsSync(p)) rmSync(p, { force: true });
      }
    }
  } catch {
    /* corrupted manifest — ignore, just overwrite */
  }
}

const distDir = resolve(KLECKS_DIR, "dist");
if (!existsSync(distDir)) {
  console.error("[klecks] build did not produce dist/", distDir);
  process.exit(1);
}

const emitted = [];
let copied = 0;
for (const f of readdirSync(distDir)) {
  // Skip the standalone-build artifacts; we only want embed.js + its sibling
  // assets (worker chunks, sourcemaps, fonts, glsl, etc).
  if (f === "index.html") continue;
  const src = resolve(distDir, f);
  const dst = resolve(PUBLIC_DIR, f);
  if (statSync(src).isDirectory()) {
    copyDir(src, dst, f, emitted);
  } else {
    copyFileSync(src, dst);
    emitted.push(f);
  }
  copied += 1;
}
writeFileSync(MANIFEST, JSON.stringify(emitted, null, 2));
writeFileSync(PATCHSET_MARK, patchSetId);

if (!existsSync(EMBED_OUT)) {
  console.error("[klecks] embed.js missing after copy — build output unexpected.");
  process.exit(1);
}

console.log(`[klecks] copied ${copied} entrie(s) to ${PUBLIC_DIR}`);

function copyDir(src, dst, relRoot, emitted) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = resolve(src, entry);
    const d = resolve(dst, entry);
    const rel = `${relRoot}/${entry}`;
    if (statSync(s).isDirectory()) {
      copyDir(s, d, rel, emitted);
    } else {
      copyFileSync(s, d);
      emitted.push(rel);
    }
  }
}
