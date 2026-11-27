// GUIDE layers for drawing pop-up theme parts and frames in Klecks.
//
// Each part opens on a canvas of its own size with a faint reference layer
// underneath: the part's most basic shape (a ring with an X for the close
// button, an arrow, a box with its stretchy edges marked…) plus its size.
// The Klecks bridge (public/klecks/index.html) leaves layers named GUIDE…
// out of the exported PNG and swaps in a fresh guide when a saved PSD is
// reopened, so guides never end up in what visitors see.
//
// Browser-only (canvas); returns a PNG data URL.

import type { ScreenRect, SliceInsets, ThemePartKey } from "@/data/popupStyleTypes";

const BLUE = "rgba(37, 99, 235, 0.95)";
const BLUE_FILL = "rgba(37, 99, 235, 0.07)";
const RED = "rgba(220, 38, 38, 0.85)";

function setup(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  g.lineCap = "round";
  const unit = Math.max(2, Math.round(Math.min(w, h) / 160));
  g.lineWidth = unit * 1.5;
  g.strokeStyle = BLUE;
  g.fillStyle = BLUE;
  g.font = `${Math.max(14, Math.round(Math.min(w, h) / 14))}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  return { c, g, unit };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Size marks along the bottom and right edges ("900 px"). */
function sizeMarks(g: CanvasRenderingContext2D, w: number, h: number, unit: number) {
  g.save();
  g.setLineDash([]);
  g.lineWidth = unit;
  g.font = `${Math.max(12, Math.round(Math.min(w, h) / 18))}px sans-serif`;
  const y = h - unit * 4;
  g.beginPath();
  g.moveTo(unit * 4, y);
  g.lineTo(w - unit * 4, y);
  g.moveTo(w - unit * 4, unit * 4);
  g.lineTo(w - unit * 4, h - unit * 4);
  g.stroke();
  g.fillText(`${w} × ${h} px`, w / 2, y - unit * 6);
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
  g.save();
  g.fillStyle = BLUE;
  g.fillText(text, x, y);
  g.restore();
}

/** Where the edges stop and the stretchy middle begins (red). */
function sliceLines(g: CanvasRenderingContext2D, w: number, h: number, slice: SliceInsets) {
  g.save();
  g.strokeStyle = RED;
  g.beginPath();
  g.moveTo(slice.left, 0);
  g.lineTo(slice.left, h);
  g.moveTo(w - slice.right, 0);
  g.lineTo(w - slice.right, h);
  g.moveTo(0, slice.top);
  g.lineTo(w, slice.top);
  g.moveTo(0, h - slice.bottom);
  g.lineTo(w, h - slice.bottom);
  g.stroke();
  g.restore();
}

export function partGuide(
  key: ThemePartKey,
  canvas: { w: number; h: number },
  slice?: SliceInsets
): string {
  const { w, h } = canvas;
  const { c, g, unit } = setup(w, h);
  const m = unit * 10; // margin
  g.setLineDash([unit * 5, unit * 4]);
  switch (key) {
    case "panel": {
      roundRect(g, m, m, w - 2 * m, h - 2 * m, unit * 12);
      g.fillStyle = BLUE_FILL;
      g.fill();
      g.stroke();
      if (slice) sliceLines(g, w, h, slice);
      label(g, "PANEL", w / 2, h / 2 - unit * 12);
      label(g, "corners stay put, the middle stretches", w / 2, h / 2 + unit * 12);
      break;
    }
    case "close": {
      g.beginPath();
      g.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(w * 0.33, h * 0.33);
      g.lineTo(w * 0.67, h * 0.67);
      g.moveTo(w * 0.67, h * 0.33);
      g.lineTo(w * 0.33, h * 0.67);
      g.stroke();
      break;
    }
    case "prev":
    case "next": {
      const dir = key === "prev" ? -1 : 1;
      const cx = w / 2;
      g.beginPath();
      g.moveTo(cx - dir * w * 0.12, h * 0.25);
      g.lineTo(cx + dir * w * 0.18, h / 2);
      g.lineTo(cx - dir * w * 0.12, h * 0.75);
      g.stroke();
      g.beginPath();
      g.arc(cx, h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case "titleStrip": {
      roundRect(g, m, m, w - 2 * m, h - 2 * m, unit * 8);
      g.fillStyle = BLUE_FILL;
      g.fill();
      g.stroke();
      label(g, "TITLE (stretches to the title's width)", w / 2, h / 2);
      break;
    }
    case "pageTurn": {
      g.beginPath();
      g.moveTo(w - m, m * 2);
      g.lineTo(w - m, h - m);
      g.lineTo(m * 2, h - m);
      g.closePath();
      g.fillStyle = BLUE_FILL;
      g.fill();
      g.stroke();
      label(g, "page corner", w * 0.62, h * 0.68);
      break;
    }
    case "dialogueBox": {
      roundRect(g, m, h * 0.18, w - 2 * m, h * 0.82 - m, unit * 10);
      g.fillStyle = BLUE_FILL;
      g.fill();
      g.stroke();
      for (let i = 0; i < 3; i++) {
        const y = h * (0.38 + i * 0.16);
        g.beginPath();
        g.moveTo(m * 4, y);
        g.lineTo(w * (i === 2 ? 0.55 : 0.85), y);
        g.stroke();
      }
      label(g, "the words go here", w / 2, h * 0.86);
      if (slice) sliceLines(g, w, h, slice);
      break;
    }
    case "namePlate": {
      roundRect(g, m, m, w - 2 * m, h - 2 * m, (h - 2 * m) / 2);
      g.stroke();
      label(g, "Name", w / 2, h / 2);
      break;
    }
    case "dialogueNext": {
      g.beginPath();
      g.moveTo(w * 0.25, h * 0.35);
      g.lineTo(w * 0.75, h * 0.35);
      g.lineTo(w / 2, h * 0.72);
      g.closePath();
      g.stroke();
      break;
    }
    case "choiceButton": {
      roundRect(g, m, m, w - 2 * m, h - 2 * m, (h - 2 * m) / 2);
      g.fillStyle = BLUE_FILL;
      g.fill();
      g.stroke();
      label(g, "An answer", w / 2, h / 2);
      break;
    }
  }
  sizeMarks(g, w, h, unit);
  return c.toDataURL("image/png");
}

/** A frame's guide: the outline plus its SCREEN window (where content shows). */
export function frameGuide(canvas: { w: number; h: number }, screen: ScreenRect): string {
  const { w, h } = canvas;
  const { c, g, unit } = setup(w, h);
  const m = unit * 6;
  g.setLineDash([unit * 5, unit * 4]);
  roundRect(g, m, m, w - 2 * m, h - 2 * m, unit * 14);
  g.stroke();
  const sx = (screen.x / 100) * w;
  const sy = (screen.y / 100) * h;
  const sw = (screen.w / 100) * w;
  const sh = (screen.h / 100) * h;
  g.strokeStyle = RED;
  g.fillStyle = "rgba(220, 38, 38, 0.06)";
  roundRect(g, sx, sy, sw, sh, unit * 6);
  g.fill();
  g.stroke();
  g.fillStyle = RED;
  g.fillText("SCREEN: erase this to see-through", sx + sw / 2, sy + sh / 2 - unit * 8);
  g.fillText("(the pop-up shows through it)", sx + sw / 2, sy + sh / 2 + unit * 8);
  g.strokeStyle = BLUE;
  sizeMarks(g, w, h, unit);
  return c.toDataURL("image/png");
}

/** A small square icon's guide (e.g. a room name tag icon): a centred circle. */
export function iconGuide(canvas: { w: number; h: number }): string {
  const { w, h } = canvas;
  const { c, g, unit } = setup(w, h);
  g.setLineDash([unit * 5, unit * 4]);
  g.fillStyle = BLUE_FILL;
  g.beginPath();
  g.arc(w / 2, h / 2, Math.min(w, h) / 2 - unit * 8, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  label(g, "ICON", w / 2, h / 2);
  sizeMarks(g, w, h, unit);
  return c.toDataURL("image/png");
}
