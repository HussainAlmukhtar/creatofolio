// Dev helper: how different are two screenshots?
//   node scripts/pixel-diff.mjs a.jpg b.jpg [--out diff.png]
// Prints the share of pixels that differ by more than a JPEG-noise threshold and
// the bounding box of the differences. Used to show that a change leaves the
// desktop layout pixel-identical (compare the same page on `main` and a branch).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
if (!a || !b) {
  console.error("usage: node scripts/pixel-diff.mjs a.jpg b.jpg [--out diff.png]");
  process.exit(2);
}

const load = async (p) => {
  const { data, info } = await sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
};
const A = await load(a);
const B = await load(b);
if (A.w !== B.w || A.h !== B.h) {
  console.log(`DIFFERENT SIZE: ${A.w}x${A.h} vs ${B.w}x${B.h}`);
  process.exit(1);
}
const THRESH = 40; // per-channel sum: JPEG noise sits well below this
let diff = 0;
let sum = 0;
let minX = A.w, minY = A.h, maxX = -1, maxY = -1;
const mask = Buffer.alloc(A.w * A.h * 3, 0);
for (let y = 0; y < A.h; y++) {
  for (let x = 0; x < A.w; x++) {
    const i = (y * A.w + x) * 3;
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    sum += d;
    if (d > THRESH) {
      diff++;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      mask[i] = 255;
    }
  }
}
const total = A.w * A.h;
console.log(
  `${A.w}x${A.h}  mean abs diff ${(sum / total / 3).toFixed(3)}/255  pixels over threshold: ${diff} (${((diff / total) * 100).toFixed(3)}%)` +
    (diff ? `  bbox x ${minX}-${maxX}, y ${minY}-${maxY}` : "")
);
if (out) await sharp(mask, { raw: { width: A.w, height: A.h, channels: 3 } }).png().toFile(out);
