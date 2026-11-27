// Procedural torn-paper edge geometry.
//
// Replaces the old repeating 40px zig-zag / scallop mask tile (which read as a
// sawtooth pattern, not paper). Each edge is a seeded, NON-repeating contour
// built from layered value noise — a long slow wander, mid-size bumps, fine
// jitter, and a soft fibrous fuzz along the torn rim — so every section's tear is
// different but a given section always tears the same way.
//
// Determinism matters: the seed is the section iid (or an author "re-roll"
// seed), and the generator is pure integer-seeded math, so the server render
// and client hydration produce byte-identical paths (no hydration mismatch).
//
// Coordinates are CSS pixels (the SVG clipPath uses userSpaceOnUse), so the
// tear has the same physical scale on a phone and a 4K screen. The contour is
// generated `WIDTH` px wide and then continues flat, which only matters on
// screens wider than that.

export type TearStyle = "rough" | "deckle";

/** Strip height in px. The contour lives in the middle band. */
export const TEAR_HEIGHT = 96;
const WIDTH = 3000;
const STEP = 4;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, good-enough seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1-D value noise in [-1, 1], cosine-interpolated, lattice spacing `period`. */
function valueNoise(rand: () => number, period: number, length: number) {
  const n = Math.ceil(length / period) + 2;
  const lattice = Array.from({ length: n }, () => rand() * 2 - 1);
  return (x: number) => {
    const f = x / period;
    const i = Math.floor(f);
    const t = (1 - Math.cos((f - i) * Math.PI)) / 2;
    return lattice[i] * (1 - t) + lattice[i + 1] * t;
  };
}

/** How dramatic a tear is — the author's "Intensity" (tornEdge.intensity). */
export type TearIntensity = "subtle" | "natural" | "dramatic";
// Each intensity is a RANGE the per-tear depth is drawn from (not a
// multiplier on a random depth — that let a "dramatic" tear roll shallow),
// plus how ragged its small-scale edge is.
const INTENSITY: Record<TearIntensity, { depth: [number, number]; rag: number }> = {
  subtle: { depth: [0.5, 0.8], rag: 0.8 },
  natural: { depth: [0.75, 1.3], rag: 1 },
  dramatic: { depth: [1.25, 1.7], rag: 1.35 },
};

interface Recipe {
  /** [amplitude px, period px] — before the per-tear character is applied. */
  octaves: [amplitude: number, period: number][];
  jitter: number;
  /** Torn-core rim: widest it gets (px), and how much of the edge shows it. */
  rimMax: number;
  rimCoverage: number;
  /** Chance of each "big bite" (0–2 per tear) and its depth range (px). */
  biteChance: number;
  biteDepth: [number, number];
}

const RECIPES: Record<TearStyle, Recipe> = {
  // A real rip: lazy wander, chunky bites, and a lighter torn core that shows
  // in PATCHES — where the paper split at a slant through its thickness —
  // not as a constant outline (a uniform rim reads as a sticker border).
  rough: {
    octaves: [
      [15, 380],
      [7.5, 110],
      [3.4, 30],
      [1.2, 9],
    ],
    jitter: 0.45,
    rimMax: 6.5,
    rimCoverage: 0.55,
    biteChance: 0.45,
    biteDepth: [7, 16],
  },
  // A handmade-paper deckle: gentle waves, soft feathery edge, thin rim.
  deckle: {
    octaves: [
      [3.2, 220],
      [2.6, 34],
      [1.6, 11],
      [0.8, 5],
    ],
    jitter: 0.35,
    rimMax: 2,
    rimCoverage: 0.7,
    biteChance: 0,
    biteDepth: [0, 0],
  },
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * SVG path data for one edge, oriented as a TOP edge (paper below the
 * contour; `flip` mirrors it for a bottom edge).
 *  - `outer` — the torn contour plus soft fibre fuzz (the rim layer).
 *  - `inner` — the contour pushed in by the local rim width (the paper face).
 *
 * Every tear gets its own CHARACTER from the seed, not just its own line:
 * depth, how long its waves are, how chunky its bites, how jagged, a slight
 * slant across the page, how much torn core shows, and 0–2 deep bites. So
 * two sections never read as the same tear, and "Re-roll" changes the
 * character too. `intensity` scales the depth on top (author control).
 */
export function tearPaths(
  seed: string,
  style: TearStyle,
  /** Bottom edge: paper ABOVE the contour (mirrored geometry, so the strip
   *  needs no CSS flip and its paper texture stays upright/aligned). */
  flip = false,
  intensity: TearIntensity = "natural"
): { outer: string; inner: string } {
  const recipe = RECIPES[style];
  const rand = prng(hashString(`${style}:${seed}`));

  // ── Per-tear character ──
  const { depth: [dMin, dMax], rag } = INTENSITY[intensity];
  const depth = lerp(dMin, dMax, rand());
  const stretch = lerp(0.6, 1.5, rand()); // wave length
  const chunk = lerp(0.6, 1.5, rand()) * rag; // mid-size bite strength
  const jag = lerp(0.6, 1.7, rand()) * rag; // fine jaggedness
  const slope = (rand() * 2 - 1) * 10 * depth; // px drift across 3000px
  const rimMax = recipe.rimMax * lerp(0.55, 1.35, rand());
  const coverage = recipe.rimCoverage * lerp(0.7, 1.3, rand());

  const layers = recipe.octaves.map(([amp, period], i) => ({
    amp: amp * depth * (i === 1 ? chunk : i >= 2 ? jag : 1),
    n: valueNoise(rand, i === 0 ? period * stretch : period, WIDTH),
  }));
  // Big bites: localized smooth dips/peaks, like where the tear changed
  // direction. Gaussian-shaped so they have no hard corners.
  const bites: { x: number; w: number; d: number }[] = [];
  for (let i = 0; i < 2; i++) {
    if (rand() < recipe.biteChance) {
      bites.push({
        x: rand() * WIDTH,
        w: lerp(35, 130, rand()),
        d: lerp(recipe.biteDepth[0], recipe.biteDepth[1], rand()) * depth * (rand() < 0.5 ? 1 : -1),
      });
    }
  }
  const rimNoise = valueNoise(rand, lerp(60, 140, rand()), WIDTH);
  const rimFine = valueNoise(rand, 14, WIDTH);
  // Soft fibrous fuzz on the rim's outer line only — tiny, SMOOTH
  // irregularity. (Single-sample "fibre spikes" were tried and read as sharp
  // thorns at screen scale.)
  const fuzz = valueNoise(rand, 5, WIDTH);

  const base = TEAR_HEIGHT * 0.5;
  // Soft limit instead of a hard clamp: deep tears ease toward the strip's
  // bounds (tanh) rather than flattening into plateaus.
  const limit = base - 9;

  let lastY = base;
  let lastRim = 0.4;
  const outer: string[] = [`M0,${TEAR_HEIGHT}`];
  const inner: string[] = [`M0,${TEAR_HEIGHT}`];
  for (let x = 0; x <= WIDTH; x += STEP) {
    let dev = slope * (x / WIDTH - 0.5);
    for (const l of layers) dev += l.amp * l.n(x);
    for (const b of bites) dev += b.d * Math.exp(-(((x - b.x) / b.w) ** 2));
    dev += (rand() * 2 - 1) * recipe.jitter;
    const y = base + limit * Math.tanh(dev / limit);

    // Rim: present in patches (smoothstep over slow noise), with a little
    // fine variation; a hairline minimum keeps the edge from looking cut.
    const patch = smoothstep(1 - coverage, 1, rimNoise(x) * 0.5 + 0.5);
    const rim = 0.4 + rimMax * patch * (0.75 + 0.25 * (rimFine(x) * 0.5 + 0.5));

    lastY = y;
    lastRim = rim;
    outer.push(`L${x},${r1(y - 0.9 * Math.abs(fuzz(x)))}`);
    inner.push(`L${x},${r1(Math.min(TEAR_HEIGHT, y + rim))}`);
  }
  // Beyond the generated width: continue flat so ultra-wide screens are
  // covered (a straight run only there).
  const tailOuter = `L20000,${r1(lastY)} L20000,${TEAR_HEIGHT} Z`;
  const tailInner = `L20000,${r1(Math.min(TEAR_HEIGHT, lastY + lastRim))} L20000,${TEAR_HEIGHT} Z`;
  const out = { outer: outer.join(" ") + " " + tailOuter, inner: inner.join(" ") + " " + tailInner };
  if (!flip) return out;
  // Mirror every y (y → H − y). Coordinates are "x,y" pairs after a command
  // letter, so a regex over the pairs is exact here.
  const mirror = (d: string) =>
    d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${x},${r1(TEAR_HEIGHT - Number(y))}`);
  return { outer: mirror(out.outer), inner: mirror(out.inner) };
}
