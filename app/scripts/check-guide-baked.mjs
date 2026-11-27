// READ-ONLY checker: which live drawings have the GUIDE reference layer baked
// into their saved PNG?
//
//   node scripts/check-guide-baked.mjs            # report
//   node scripts/check-guide-baked.mjs --verbose  # also list drawings that are fine
//   node scripts/check-guide-baked.mjs --pair <sceneId>=<pngUrl>   # check one specific pair
//
// Background: the studio keeps a layer named "GUIDE…" in the PSD and must leave
// it out of the PNG. A production Klecks build whose wrapper differed from the
// one developed locally made the export fall back to a flattening getPNG, so
// the guide (dashed frames, "SAFE AREA", "GAME SCREEN"…) was baked into the art.
// This script finds those: for every landing drawing (`sceneId`) it reads the
// layered PSD from the private `drawing-scenes` bucket; when the PSD has a GUIDE
// layer, it checks the PNG visitors see at the pixels where the guide has ink
// but the real art does not. Nothing is written, uploaded or changed.
//
// Needs app/.env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
// `sharp` (installed with Next) and ag-psd (from the vendored ../klecks checkout).

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const verbose = process.argv.includes("--verbose");
const require = createRequire(import.meta.url);

function loadEnv() {
  const file = resolve(appDir, ".env.local");
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}
const env = loadEnv();
const SUPA = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in app/.env.local");
  process.exit(2);
}

function loadAgPsd() {
  const candidates = [
    resolve(appDir, "node_modules/ag-psd"),
    resolve(appDir, "../klecks/node_modules/ag-psd"),
    "ag-psd",
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try next */
    }
  }
  console.error("ag-psd not found (looked in app/node_modules and ../klecks/node_modules).");
  process.exit(2);
}
const agPsd = loadAgPsd();
// Layer pixels are read as plain ImageData: no canvas is ever drawn on, so a
// tiny stand-in is enough for ag-psd's allocator.
const imageDataOf = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });
agPsd.initializeCanvas(
  (width, height) => ({ width, height, getContext: () => ({ createImageData: imageDataOf }) }),
  undefined,
  imageDataOf
);
const sharp = require("sharp");

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(table) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const res = await fetch(`${SUPA}/rest/v1/${table}?select=*`, {
      headers: { ...headers, Range: `${from}-${from + 499}`, "Range-Unit": "items" },
    });
    if (res.status === 404 || res.status === 400) return null; // table missing
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

// Every table that can hold a landing drawing reference ({ sceneId, pngUrl|url }).
const TABLES = [
  "website_pages",
  "website_page_versions",
  "website_site_config",
  "popup_styles",
  "popup_style_drafts",
  "popup_style_backups",
  "popup_presets",
  "object_templates",
];

function collectRefs(rows, table, refs) {
  for (const row of rows) {
    const text = JSON.stringify(row);
    const re = /\{[^{}]*"sceneId"\s*:\s*"([0-9a-f-]{36})"[^{}]*\}/g;
    let m;
    while ((m = re.exec(text))) {
      let obj;
      try {
        obj = JSON.parse(m[0]);
      } catch {
        continue;
      }
      const url = obj.pngUrl ?? obj.url;
      if (typeof url !== "string") continue;
      const key = m[1];
      const entry = refs.get(key) ?? { urls: new Map() };
      const where = entry.urls.get(url) ?? new Set();
      where.add(`${table}${row.slug ? `:${row.slug}` : row.id ? `:${row.id}` : ""}`);
      entry.urls.set(url, where);
      refs.set(key, entry);
    }
  }
}

async function download(url, auth) {
  const res = await fetch(url, auth ? { headers } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function isGuide(name) {
  return typeof name === "string" && name.startsWith("GUIDE");
}

/** Normal-blend composite of PSD layers into a w×h RGBA buffer. */
function composite(layers, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const walk = (list) => {
    for (const l of list) {
      if (l.children) walk(l.children);
      if (l.hidden || !l.imageData) continue;
      const { data, width, height } = l.imageData;
      const op = typeof l.opacity === "number" ? l.opacity : 1;
      for (let y = 0; y < height; y++) {
        const oy = y + (l.top ?? 0);
        if (oy < 0 || oy >= h) continue;
        for (let x = 0; x < width; x++) {
          const ox = x + (l.left ?? 0);
          if (ox < 0 || ox >= w) continue;
          const si = (y * width + x) * 4;
          const sa = (data[si + 3] / 255) * op;
          if (sa === 0) continue;
          const di = (oy * w + ox) * 4;
          const da = out[di + 3] / 255;
          const ra = sa + da * (1 - sa);
          for (let c = 0; c < 3; c++) {
            out[di + c] = (data[si + c] * sa + out[di + c] * da * (1 - sa)) / (ra || 1);
          }
          out[di + 3] = ra * 255;
        }
      }
    }
  };
  walk(layers);
  return out;
}

async function resizeRaw(buf, w, h, nw, nh) {
  const { data } = await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .resize(nw, nh, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function checkScene(sceneId, entry) {
  const psdBuf = await download(`${SUPA}/storage/v1/object/authenticated/drawing-scenes/landing/${sceneId}.psd`, true).catch(
    (e) => ({ error: String(e.message ?? e) })
  );
  if (psdBuf.error) return [{ sceneId, verdict: "no-psd", note: psdBuf.error }];
  const psd = agPsd.readPsd(psdBuf, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const all = [];
  const flat = (list) => list.forEach((l) => (l.children ? flat(l.children) : all.push(l)));
  flat(psd.children ?? []);
  const guides = all.filter((l) => isGuide(l.name));
  if (guides.length === 0) return [{ sceneId, verdict: "no-guide-layer" }];
  const nonGuide = composite((psd.children ?? []).filter((l) => !isGuide(l.name)), psd.width, psd.height);
  const guideOnly = composite(guides, psd.width, psd.height);
  const results = [];
  for (const [url, where] of entry.urls) {
    const base = { sceneId, url, where: [...where].join(", "), guideLayers: guides.map((g) => g.name).join(" | ") };
    let png;
    try {
      png = await download(url);
    } catch (e) {
      results.push({ ...base, verdict: "png-unreachable", note: String(e.message ?? e) });
      continue;
    }
    const { data: pngRaw, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const aspectPsd = psd.width / psd.height;
    const aspectPng = info.width / info.height;
    if (Math.abs(aspectPsd - aspectPng) / aspectPsd > 0.02) {
      results.push({ ...base, verdict: "uncertain", note: `PNG ${info.width}×${info.height} vs PSD ${psd.width}×${psd.height}: cropped/trimmed, can't compare pixels` });
      continue;
    }
    const ng = await resizeRaw(Buffer.from(nonGuide.buffer), psd.width, psd.height, info.width, info.height);
    const gd = await resizeRaw(Buffer.from(guideOnly.buffer), psd.width, psd.height, info.width, info.height);
    let probe = 0;
    let baked = 0;
    for (let i = 3; i < pngRaw.length; i += 4) {
      // Guide has ink here, the real art doesn't.
      if (ng[i] < 8 && gd[i] >= 64) {
        probe++;
        if (pngRaw[i] >= 64) baked++;
      }
    }
    const score = probe ? baked / probe : 0;
    results.push({
      ...base,
      verdict: probe < 50 ? "inconclusive" : score > 0.5 ? "GUIDE BAKED IN" : "clean",
      score: Math.round(score * 1000) / 1000,
      probePixels: probe,
    });
  }
  return results;
}

async function main() {
  const refs = new Map();
  const skipped = [];
  const pairs = process.argv.filter((a, i, arr) => arr[i - 1] === "--pair");
  if (pairs.length) {
    for (const p of pairs) {
      const [id, url] = p.split("=");
      refs.set(id, { urls: new Map([[url, new Set(["--pair"])]]) });
    }
  }
  for (const t of pairs.length ? [] : TABLES) {
    const rows = await rest(t);
    if (rows === null) {
      skipped.push(t);
      continue;
    }
    collectRefs(rows, t, refs);
  }
  console.log(`Checked ${refs.size} landing drawing(s) with a kept PSD${skipped.length ? ` (tables not present: ${skipped.join(", ")})` : ""}.`);
  const all = [];
  for (const [sceneId, entry] of refs) all.push(...(await checkScene(sceneId, entry)));
  const bad = all.filter((r) => r.verdict === "GUIDE BAKED IN");
  const unsure = all.filter((r) => ["uncertain", "inconclusive", "png-unreachable", "no-psd"].includes(r.verdict));
  for (const r of all) {
    if (!verbose && !["GUIDE BAKED IN", "uncertain", "inconclusive", "png-unreachable", "no-psd"].includes(r.verdict)) continue;
    console.log(`\n[${r.verdict}] scene ${r.sceneId}`);
    if (r.where) console.log(`  used in: ${r.where}`);
    if (r.url) console.log(`  png:     ${r.url}`);
    if (r.guideLayers) console.log(`  guide:   ${r.guideLayers}`);
    if (r.score !== undefined) console.log(`  baked:   ${(r.score * 100).toFixed(1)}% of ${r.probePixels} guide-only pixels are inked in the PNG`);
    if (r.note) console.log(`  note:    ${r.note}`);
  }
  console.log(`\nSummary: ${bad.length} with the guide baked in, ${unsure.length} need a look, ${all.length - bad.length - unsure.length} fine.`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
