// GUIDE layers for drawing loading-screen art in Klecks (same contract as
// lib/popupStyleGuides.ts: the layer is named GUIDE…, the bridge leaves it
// out of the saved PNG). Shows where the drawing sits and how it moves:
// the spin centre, the ground line a hopping character lands on, the
// book cover's spine, the safe circle an orbiting doodle fits in.
//
// Browser-only (canvas); returns a PNG data URL.

import type { LoaderPreset, LoaderSlot } from "@/data/loaderConfig";

const BLUE = "rgba(37, 99, 235, 0.9)";
const BLUE_FILL = "rgba(37, 99, 235, 0.06)";

export function loaderGuide(preset: LoaderPreset, slot: LoaderSlot, canvas: { w: number; h: number }): string {
  const { w, h } = canvas;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const unit = Math.max(2, Math.round(Math.min(w, h) / 200));
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = BLUE;
  g.fillStyle = BLUE;
  g.lineWidth = unit * 1.5;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const font = (px: number) => (g.font = `${Math.round(px)}px sans-serif`);
  const cx = w / 2;
  const cy = h / 2;
  const say = (text: string, y: number, size = Math.min(w, h) / 22) => {
    font(size);
    g.fillText(text, cx, y);
  };
  const dashed = (fn: () => void) => {
    g.save();
    g.setLineDash([unit * 6, unit * 5]);
    fn();
    g.restore();
  };

  if (slot === "cover") {
    // The whole canvas is the cover; the spine (hinge) is the left edge.
    g.fillStyle = BLUE_FILL;
    g.fillRect(0, 0, w, h);
    g.fillStyle = BLUE;
    g.fillRect(0, 0, unit * 4, h);
    dashed(() => g.strokeRect(unit * 2, unit * 2, w - unit * 4, h - unit * 4));
    say("Book cover", cy - h * 0.06, w / 12);
    say("fill the whole canvas", cy + h * 0.02);
    g.save();
    g.translate(unit * 14, cy);
    g.rotate(-Math.PI / 2);
    font(w / 22);
    g.fillText("spine: opens from here", 0, 0);
    g.restore();
  } else {
    const r = Math.min(w, h) * 0.44;
    g.fillStyle = BLUE_FILL;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = BLUE;
    dashed(() => {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    });
    // Centre cross.
    g.beginPath();
    g.moveTo(cx - unit * 8, cy);
    g.lineTo(cx + unit * 8, cy);
    g.moveTo(cx, cy - unit * 8);
    g.lineTo(cx, cy + unit * 8);
    g.stroke();

    if (preset === "hop" && slot === "main") {
      const ground = h - unit * 10;
      g.lineWidth = unit * 2;
      g.beginPath();
      g.moveTo(unit * 6, ground);
      g.lineTo(w - unit * 6, ground);
      g.stroke();
      say("feet on this line: it lands here", ground - unit * 10);
      say("Keep it inside the circle", unit * 18);
    } else if (preset === "spin" && slot === "main") {
      say("It turns around the centre +", unit * 18);
      say("Keep it inside the circle", h - unit * 18);
    } else if (slot.startsWith("f")) {
      say(`Frame ${slot.slice(1)}: same spot as the other frames`, unit * 18);
      say("Keep it inside the circle", h - unit * 18);
    } else if (slot.startsWith("o")) {
      say("Small doodle", unit * 16, Math.min(w, h) / 14);
      say("stays upright as it circles", h - unit * 16, Math.min(w, h) / 16);
    } else {
      say("Keep it inside the circle", unit * 18);
    }
  }

  font(Math.max(12, Math.min(w, h) / 30));
  g.textAlign = "end";
  g.fillText(`${w} × ${h} px`, w - unit * 6, h - unit * 6 - (slot === "main" && preset === "hop" ? unit * 14 : 0));
  return c.toDataURL("image/png");
}
