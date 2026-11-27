// SectionThumb: a miniature wireframe of a section, drawn from its REAL data
// (heading, canvas aspect, every element's box and kind). The template picker
// shows these instead of a generic icon, so you can see the layout before
// adding it, the way Shopify's section picker previews sections.

import type { DrawnAsset, DrawnSection } from "@/data/landingTypes";
import { isPlaceholderSrc } from "@/data/landingPlaceholders";

const W = 160;

export function SectionThumb({ section, className = "" }: { section: DrawnSection | null; className?: string }) {
  const digital = section?.surface?.kind === "digital";
  const ink = digital ? "#e9e7e1" : "#2b2420";
  const bg = digital ? "#14181a" : "#efe9dc";
  // The tile is filled with the section's surface colour and the drawing is
  // centred in it, so short or tall sections never show a dark band.
  return (
    <span className={`flex items-center justify-center ${className}`} style={{ background: bg }}>
      <Drawing section={section} ink={ink} bg={bg} />
    </span>
  );
}

function Drawing({ section, ink, bg }: { section: DrawnSection | null; ink: string; bg: string }) {
  const className = "max-h-full max-w-full";
  if (!section) {
    return (
      <svg viewBox="0 0 160 100" className={className} aria-hidden="true">
        <rect width="160" height="100" fill={bg} />
        <rect x="8" y="8" width="144" height="84" rx="4" fill="none" stroke={ink} strokeOpacity="0.2" strokeDasharray="4 3" />
      </svg>
    );
  }
  const head = 4;
  const canvasH = Math.min((W * section.aspectRatio.h) / section.aspectRatio.w, 140);
  const H = head + canvasH + 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} style={{ height: "100%", width: "100%" }} aria-hidden="true">
      <rect width={W} height={H} fill={bg} />
      <g transform={`translate(0 ${head})`}>
        {[...section.assets]
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((a) => (
            <Element key={a.iid} a={a} ink={ink} cw={W} ch={canvasH} />
          ))}
      </g>
    </svg>
  );
}

function Element({ a, ink, cw, ch }: { a: DrawnAsset; ink: string; cw: number; ch: number }) {
  const x = (a.x / 100) * cw;
  const y = (a.y / 100) * ch;
  const w = (a.w / 100) * cw;
  const h = Math.max((a.h / 100) * ch, 3);
  const line = (lx: number, ly: number, lw: number, o = 0.35, t = 2.2) => (
    <rect x={lx} y={ly} width={Math.max(lw, 2)} height={t} rx={t / 2} fill={ink} fillOpacity={o} />
  );
  const lines = (n: number, cx = x + w / 2, top = y + 2, gap = 5, frac = 0.8) =>
    Array.from({ length: n }, (_, i) => (
      <g key={i}>{line(cx - (w * frac * (i === n - 1 ? 0.7 : 1)) / 2, top + i * gap, w * frac * (i === n - 1 ? 0.7 : 1))}</g>
    ));
  const box = (bx: number, by: number, bw: number, bh: number) => (
    <rect x={bx} y={by} width={bw} height={bh} rx={2} fill={ink} fillOpacity={0.1} stroke={ink} strokeOpacity={0.22} strokeWidth={0.6} />
  );

  if (a.source.kind === "text") return <g>{lines(Math.min(3, Math.max(1, Math.round(h / 6))))}</g>;
  if (a.source.kind === "upload" || a.source.kind === "drawn") {
    const ph = a.source.kind === "upload" && isPlaceholderSrc(a.source.url);
    return (
      <g>
        {box(x, y, w, h)}
        {ph && <path d={`M${x + w * 0.3} ${y + h * 0.7} l${w * 0.15} -${h * 0.2} l${w * 0.1} ${h * 0.1} l${w * 0.15} -${h * 0.15}`} stroke={ink} strokeOpacity={0.3} strokeWidth={0.8} fill="none" />}
      </g>
    );
  }
  if (a.source.kind !== "component") return box(x, y, w, h);
  const t = a.source.block.type;
  switch (t) {
    case "heading":
      return line(x + w * 0.15, y + 1, w * 0.7, 0.75, 4);
    case "text":
      return <g>{lines(3)}</g>;
    case "button":
      return <rect x={x + w / 2 - 14} y={y} width={28} height={7} rx={3.5} fill={ink} fillOpacity={0.85} />;
    case "quote":
      return (
        <g>
          <text x={x + w / 2} y={y + 8} textAnchor="middle" fontSize="10" fill={ink} fillOpacity={0.35}>
            “
          </text>
          {lines(2, x + w / 2, y + 11)}
          {line(x + w / 2 - 6, y + 23, 12, 0.6)}
        </g>
      );
    case "feature-list":
      return (
        <g>
          {[0, 1, 2].map((i) => {
            const cx = x + (w / 3) * (i + 0.5);
            return (
              <g key={i}>
                <circle cx={cx} cy={y + 5} r={3.5} fill={ink} fillOpacity={0.15} />
                {line(cx - 8, y + 12, 16, 0.6)}
                {line(cx - 10, y + 17, 20, 0.3)}
              </g>
            );
          })}
        </g>
      );
    case "gallery":
      return (
        <g>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const gw = (w - 4) / 3;
            return <g key={i}>{box(x + (i % 3) * (gw + 2), y + Math.floor(i / 3) * (gw + 2), gw, gw)}</g>;
          })}
        </g>
      );
    case "accordion":
      return (
        <g>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={x} y={y + i * 7} width={w} height={0.6} fill={ink} fillOpacity={0.25} />
              {line(x + 1, y + i * 7 + 2.5, w * 0.4, 0.5)}
            </g>
          ))}
        </g>
      );
    case "form":
    case "newsletter": {
      const rows = t === "form" ? 3 : 1;
      return (
        <g>
          {Array.from({ length: rows }, (_, i) => (
            <rect key={i} x={x} y={y + i * 9} width={t === "form" ? w : w * 0.68} height={6} rx={2} fill="none" stroke={ink} strokeOpacity={0.3} strokeWidth={0.6} />
          ))}
          <rect x={t === "form" ? x + w / 2 - 10 : x + w * 0.72} y={y + (t === "form" ? rows * 9 : 0)} width={t === "form" ? 20 : w * 0.28} height={6} rx={3} fill={ink} fillOpacity={0.85} />
        </g>
      );
    }
    case "map":
      return (
        <g>
          {box(x, y, w, h)}
          <circle cx={x + w / 2} cy={y + h / 2 - 2} r={3} fill={ink} fillOpacity={0.5} />
        </g>
      );
    case "carousel":
      return (
        <g>
          {box(x, y, w, h - 4)}
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={x + w / 2 - 4 + i * 4} cy={y + h - 1.5} r={1} fill={ink} fillOpacity={i === 0 ? 0.8 : 0.3} />
          ))}
        </g>
      );
    case "divider":
      return <rect x={x} y={y + 1} width={w} height={0.6} fill={ink} fillOpacity={0.3} />;
    default:
      return box(x, y, w, h);
  }
}
