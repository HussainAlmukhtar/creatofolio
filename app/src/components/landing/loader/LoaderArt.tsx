// Loading screen art: one stage per preset, each slot showing the owner's
// drawing when there is one, else a built-in ink doodle placeholder.
//
// Server-safe (no hooks): SiteLoader renders it in the first HTML so the
// animation (pure CSS, siteLoader.css) runs before the page hydrates.
// Placeholders draw in `currentColor` (the loader ink) on a faint paper fill.

import type { DrawnArt } from "@/data/popupStyleTypes";
import { flipbookFrames, type LoaderConfig, type LoaderSlot } from "@/data/loaderConfig";

/** The owner's art for a slot, or the slot's placeholder doodle. */
function Slot({ art, slot, className }: { art?: DrawnArt; slot: LoaderSlot; className?: string }) {
  if (art) {
    return (
      // Plain <img>: rendered before hydration, decoded first (top of the DOM).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={art.url}
        alt=""
        draggable={false}
        decoding="async"
        fetchPriority="high"
        className={`ld-img ${className ?? ""}`}
      />
    );
  }
  return <Placeholder slot={slot} className={className} />;
}

export function LoaderStage({ config }: { config: LoaderConfig }) {
  const { art } = config;
  switch (config.preset) {
    case "spin":
      return (
        <div className="ld-box">
          <div className="ld-spin">
            <Slot art={art.main} slot="main" />
          </div>
        </div>
      );
    case "hop":
      return (
        <div className="ld-box ld-hop-box">
          <div className="ld-hop">
            <Slot art={art.main} slot="main" />
          </div>
          <div className="ld-shadow" />
        </div>
      );
    case "scribble":
      return (
        <div className="ld-box">
          {art.main ? (
            <div className="ld-reveal">
              <Slot art={art.main} slot="main" />
            </div>
          ) : (
            <FaceDrawOn />
          )}
        </div>
      );
    case "flipbook": {
      const frames = flipbookFrames(config);
      return (
        <div className="ld-box ld-flip" data-frames={frames.length}>
          {frames.map((f, i) => (
            <div key={f.slot} className="ld-frame" style={{ "--i": i } as React.CSSProperties}>
              <Slot art={f.art} slot={f.slot} />
            </div>
          ))}
        </div>
      );
    }
    case "orbit":
      return (
        <div className="ld-box ld-orbit-box">
          <div className="ld-orbit-centre">
            <Slot art={art.main} slot="main" />
          </div>
          <div className="ld-orbit">
            {(["o1", "o2", "o3"] as const).map((s, i) => (
              <div key={s} className="ld-orbiter" style={{ "--i": i } as React.CSSProperties}>
                <div className="ld-orbiter-art">
                  <Slot art={art[s]} slot={s} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "book":
      return (
        <div className="ld-box ld-book-box">
          <div className="ld-book">
            <div className="ld-book-pages" aria-hidden>
              <PagesPlaceholder />
            </div>
            <div className="ld-book-cover">
              <Slot art={art.cover} slot="cover" />
            </div>
            <div className="ld-ribbon" />
          </div>
        </div>
      );
  }
}

// ─── Placeholder doodles ────────────────────────────────────────

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Placeholder({ slot, className }: { slot: LoaderSlot; className?: string }) {
  const cls = `ld-ph ${className ?? ""}`;
  switch (slot) {
    case "main":
      return <Face className={cls} />;
    case "f1":
      return <Face className={cls} pose={0} />;
    case "f2":
      return <Face className={cls} pose={1} />;
    case "f3":
      return <Face className={cls} pose={2} />;
    case "f4":
      return <Face className={cls} pose={3} />;
    case "o1":
      return (
        <svg viewBox="0 0 100 100" className={cls} aria-hidden>
          <path
            {...STROKE}
            className="ld-fill"
            d="M50 9 L61.5 37 L91 38.5 L67.5 57.5 L76 88 L50 70.5 L23.5 88.5 L33 57.5 L9.5 39 L39 37 Z"
          />
        </svg>
      );
    case "o2":
      return (
        <svg viewBox="0 0 100 100" className={cls} aria-hidden>
          <path {...STROKE} className="ld-fill" d="M24 79 L70 31 L83 43 L36 91 Z" />
          <path {...STROKE} d="M24 79 L17 97 L36 91" />
          <path {...STROKE} d="M63 38 L76 50" />
          <path {...STROKE} strokeWidth={3} d="M20 94 L22 89" />
        </svg>
      );
    case "o3":
      return (
        <svg viewBox="0 0 100 100" className={cls} aria-hidden>
          <path
            {...STROKE}
            className="ld-fill"
            d="M50 86 C21 64 8 47 14 31 C20 16 42 15 50 33 C58 15 80 16 86 31 C92 47 79 64 50 86 Z"
          />
          <path {...STROKE} strokeWidth={3.5} d="M27 33 C29 28 33 26 37 27" />
        </svg>
      );
    case "cover":
      return <CoverPlaceholder className={cls} />;
  }
}

// The built-in face is two Lucide icons (https://lucide.dev, ISC licence):
// "smile" and "laugh", drawn in the 200x200 box the other doodles use.
// Poses 0 and 2 smile, 1 and 3 laugh, with a hair of wobble per frame so the
// flipbook "boils" like drawn frames.
const FACE_SCALE = 6.4; // Lucide's 24-unit grid -> ~154px, centred in 200
const SMILE = "M8 14s1.5 2 4 2 4-2 4-2";
const LAUGH = "M18 13a6 6 0 0 1-6 5 6 6 0 0 1-6-5h12Z";
const EYES = "M9 9h.01M15 9h.01";

function Face({ className, pose = 0 }: { className?: string; pose?: number }) {
  const tilt = [0, -4, 3, 4][pose] ?? 0;
  const laugh = pose === 1 || pose === 3;
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <g transform={`rotate(${tilt} 100 100) translate(23.2 23.2) scale(${FACE_SCALE})`}>
        <circle {...STROKE} strokeWidth={0.9} className="ld-fill" cx="12" cy="12" r="10" />
        <path {...STROKE} strokeWidth={0.9} d={laugh ? LAUGH : SMILE} />
        <path {...STROKE} strokeWidth={1.4} d={EYES} />
      </g>
    </svg>
  );
}

/** "Being drawn" placeholder: the face's outline drawn on, then its features. */
function FaceDrawOn() {
  return (
    <svg viewBox="0 0 200 200" className="ld-ph ld-drawon" aria-hidden>
      <g transform={`translate(23.2 23.2) scale(${FACE_SCALE})`}>
        <circle {...STROKE} strokeWidth={0.9} pathLength={1} className="ld-stroke ld-s1" cx="12" cy="12" r="10" />
        <path {...STROKE} strokeWidth={0.9} pathLength={1} className="ld-stroke ld-s2" d={SMILE} />
        <g className="ld-face">
          <path {...STROKE} strokeWidth={1.4} d={EYES} />
        </g>
      </g>
    </svg>
  );
}

function CoverPlaceholder({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 150 200" className={className} preserveAspectRatio="none" aria-hidden>
      <path
        {...STROKE}
        strokeWidth={4}
        className="ld-cover-fill"
        d="M6 5 L140 4 Q146 4 146 10 L145 190 Q145 196 139 196 L6 195 Z"
      />
      <path {...STROKE} strokeWidth={3} d="M20 6 L19 194" opacity={0.6} />
      <path {...STROKE} strokeWidth={3} d="M44 58 L124 57 L123 98 L45 99 Z" className="ld-label-fill" />
      <path {...STROKE} strokeWidth={3} d="M56 72 L112 71 M60 84 L106 84" opacity={0.7} />
      <g transform="translate(57 116) scale(0.36)">
        <path
          {...STROKE}
          strokeWidth={9}
          d="M52 166 C49 124 46 98 56 72 C69 37 131 36 144 71 C154 97 152 124 149 166 Q140 154 130 166 Q120 178 110 166 Q100 154 90 166 Q80 178 70 166 Q61 154 52 166 Z"
        />
        <ellipse cx="82" cy="93" rx="7" ry="10" fill="currentColor" />
        <ellipse cx="118" cy="93" rx="7" ry="10" fill="currentColor" />
      </g>
    </svg>
  );
}

function PagesPlaceholder() {
  return (
    <svg viewBox="0 0 150 200" preserveAspectRatio="none" className="ld-pages-svg" aria-hidden>
      <path {...STROKE} strokeWidth={3} className="ld-page-fill" d="M6 7 L143 6 L144 194 L6 195 Z" />
      {[40, 58, 76, 94, 112, 130, 148].map((y) => (
        <path key={y} {...STROKE} strokeWidth={2} opacity={0.35} d={`M26 ${y} L128 ${y - 1}`} />
      ))}
    </svg>
  );
}

/** Hand-drawn progress line (stroke drawn to the current progress). */
export function ProgressLine() {
  const d = "M6 12 C 60 5, 92 18, 150 10 S 248 5, 294 12";
  return (
    <svg viewBox="0 0 300 20" className="ld-line" aria-hidden>
      <path {...STROKE} strokeWidth={3} opacity={0.18} d={d} />
      <path {...STROKE} strokeWidth={4} pathLength={1} className="ld-line-ink" d={d} />
    </svg>
  );
}
