// DEV ONLY. Drives the editors with synthetic pointer / touch / Safari-gesture
// events so iPad behaviour can be tested in the browser pane without an iPad.
// Loaded by TouchModeRoot only when NODE_ENV !== "production" and published as
// `window.__touchSim`; never shipped to visitors.
//
//   const s = window.__touchSim;
//   await s.drag(el, { x: 100, y: 100 }, { x: 300, y: 100 }, { pointerType: "touch" });
//   await s.pinch(el, { x: 400, y: 300 }, 80, 200);
//   s.safariGesture(el, "start");     // returns whether the page default was cancelled
//
// Everything dispatches REAL event objects (PointerEvent, TouchEvent with Touch
// lists, GestureEvent-shaped Events), in the realm of the target's document, so
// it also works on elements inside an iframe (the Klecks studio).

export type Pt = { x: number; y: number };
export type PointerKind = "touch" | "pen" | "mouse";

type Win = Window & typeof globalThis;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let nextId = 100;

function winOf(el: Element | Document): Win {
  const doc = el instanceof Document ? el : el.ownerDocument;
  return doc.defaultView as Win;
}

function pointer(
  el: Element,
  type: string,
  p: Pt,
  o: { id: number; kind: PointerKind; down: boolean; pressure?: number; primary?: boolean }
): PointerEvent {
  const W = winOf(el);
  return new W.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: o.id,
    pointerType: o.kind,
    isPrimary: o.primary ?? true,
    clientX: p.x,
    clientY: p.y,
    buttons: o.down ? 1 : 0,
    button: o.down || type === "pointerup" ? 0 : -1,
    pressure: o.down ? (o.pressure ?? (o.kind === "pen" ? 0.6 : 0.5)) : 0,
    width: o.kind === "touch" ? 24 : 1,
    height: o.kind === "touch" ? 24 : 1,
  });
}

function touchEvent(
  el: Element,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  active: { id: number; p: Pt }[],
  changed: { id: number; p: Pt }[]
): TouchEvent | null {
  const W = winOf(el);
  if (typeof W.Touch !== "function" || typeof W.TouchEvent !== "function") return null;
  const mk = (t: { id: number; p: Pt }) =>
    new W.Touch({ identifier: t.id, target: el, clientX: t.p.x, clientY: t.p.y, pageX: t.p.x, pageY: t.p.y, screenX: t.p.x, screenY: t.p.y });
  return new W.TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    touches: active.map(mk),
    targetTouches: active.map(mk),
    changedTouches: changed.map(mk),
  });
}

/** A finger / pen / mouse press-move-release. Resolves when done. The returned
 *  object says whether any `pointermove` / `touchmove` default was cancelled. */
export async function drag(
  el: Element,
  from: Pt,
  to: Pt,
  opts: { pointerType?: PointerKind; steps?: number; stepMs?: number; holdMs?: number; id?: number; release?: boolean } = {}
): Promise<{ moveDefaultPrevented: boolean }> {
  const kind = opts.pointerType ?? "touch";
  const id = opts.id ?? nextId++;
  const steps = opts.steps ?? 8;
  const stepMs = opts.stepMs ?? 20;
  const doc = el.ownerDocument;
  let prevented = false;
  const isTouch = kind === "touch";
  const send = (type: string, p: Pt, down: boolean) => {
    el.dispatchEvent(pointer(el, type, p, { id, kind, down }));
    if (type === "pointermove") doc.dispatchEvent(pointer(el, "pointermove", p, { id, kind, down }));
  };
  const tdown = isTouch ? touchEvent(el, "touchstart", [{ id, p: from }], [{ id, p: from }]) : null;
  send("pointerdown", from, true);
  if (tdown) el.dispatchEvent(tdown);
  if (opts.holdMs) await sleep(opts.holdMs);
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    send("pointermove", p, true);
    const tm = isTouch ? touchEvent(el, "touchmove", [{ id, p }], [{ id, p }]) : null;
    if (tm) {
      el.dispatchEvent(tm);
      if (tm.defaultPrevented) prevented = true;
    }
    await sleep(stepMs);
  }
  if (opts.release !== false) {
    const pu = pointer(el, "pointerup", to, { id, kind, down: false });
    el.dispatchEvent(pu);
    doc.dispatchEvent(pointer(el, "pointerup", to, { id, kind, down: false }));
    const tu = isTouch ? touchEvent(el, "touchend", [], [{ id, p: to }]) : null;
    if (tu) el.dispatchEvent(tu);
  }
  return { moveDefaultPrevented: prevented };
}

/** Press and release without moving. Mouse also fires click. */
export async function tap(el: Element, at: Pt, opts: { pointerType?: PointerKind; holdMs?: number } = {}) {
  await drag(el, at, at, { pointerType: opts.pointerType ?? "touch", steps: 1, holdMs: opts.holdMs });
  if ((opts.pointerType ?? "touch") !== "pen") {
    const W = winOf(el);
    el.dispatchEvent(new W.MouseEvent("click", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
  }
}

/** Two fingers moving apart / together around `center`. Returns the last
 *  touchmove's defaultPrevented (a page that scrolls/zooms natively must have
 *  cancelled it). */
export async function pinch(
  el: Element,
  center: Pt,
  startDist: number,
  endDist: number,
  opts: { steps?: number; stepMs?: number; angleDeg?: number; release?: boolean } = {}
): Promise<{ moveDefaultPrevented: boolean }> {
  const steps = opts.steps ?? 10;
  const stepMs = opts.stepMs ?? 20;
  const ang = ((opts.angleDeg ?? 0) * Math.PI) / 180;
  const ids = [nextId++, nextId++];
  const doc = el.ownerDocument;
  const at = (d: number): [Pt, Pt] => [
    { x: center.x - (Math.cos(ang) * d) / 2, y: center.y - (Math.sin(ang) * d) / 2 },
    { x: center.x + (Math.cos(ang) * d) / 2, y: center.y + (Math.sin(ang) * d) / 2 },
  ];
  let prevented = false;
  let [a, b] = at(startDist);
  el.dispatchEvent(pointer(el, "pointerdown", a, { id: ids[0], kind: "touch", down: true, primary: true }));
  const t0 = touchEvent(el, "touchstart", [{ id: ids[0], p: a }], [{ id: ids[0], p: a }]);
  if (t0) el.dispatchEvent(t0);
  el.dispatchEvent(pointer(el, "pointerdown", b, { id: ids[1], kind: "touch", down: true, primary: false }));
  const t1 = touchEvent(el, "touchstart", [{ id: ids[0], p: a }, { id: ids[1], p: b }], [{ id: ids[1], p: b }]);
  if (t1) el.dispatchEvent(t1);
  for (let i = 1; i <= steps; i++) {
    [a, b] = at(startDist + ((endDist - startDist) * i) / steps);
    el.dispatchEvent(pointer(el, "pointermove", a, { id: ids[0], kind: "touch", down: true }));
    el.dispatchEvent(pointer(el, "pointermove", b, { id: ids[1], kind: "touch", down: true, primary: false }));
    doc.dispatchEvent(pointer(el, "pointermove", a, { id: ids[0], kind: "touch", down: true }));
    doc.dispatchEvent(pointer(el, "pointermove", b, { id: ids[1], kind: "touch", down: true, primary: false }));
    const tm = touchEvent(el, "touchmove", [{ id: ids[0], p: a }, { id: ids[1], p: b }], [{ id: ids[0], p: a }, { id: ids[1], p: b }]);
    if (tm) {
      el.dispatchEvent(tm);
      if (tm.defaultPrevented) prevented = true;
    }
    await sleep(stepMs);
  }
  if (opts.release !== false) {
    for (let k = 0; k < 2; k++) {
      const p = k === 0 ? a : b;
      el.dispatchEvent(pointer(el, "pointerup", p, { id: ids[k], kind: "touch", down: false }));
      doc.dispatchEvent(pointer(el, "pointerup", p, { id: ids[k], kind: "touch", down: false }));
    }
    const te = touchEvent(el, "touchend", [], [{ id: ids[0], p: a }, { id: ids[1], p: b }]);
    if (te) el.dispatchEvent(te);
  }
  return { moveDefaultPrevented: prevented };
}

/** Safari's proprietary pinch events (they ignore touch-action). Returns true
 *  when the page cancelled the default, i.e. Safari will NOT zoom the page. */
export function safariGesture(el: Element, phase: "start" | "change" | "end", scale = 1.4): boolean {
  const W = winOf(el);
  const ev = new W.Event(`gesture${phase}`, { bubbles: true, cancelable: true });
  Object.assign(ev, { scale, rotation: 0 });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/** Pencil hover: pen pointer moving with no button down. */
export function penHover(el: Element, p: Pt) {
  el.dispatchEvent(pointer(el, "pointermove", p, { id: 77, kind: "pen", down: false }));
  el.dispatchEvent(pointer(el, "pointerover", p, { id: 77, kind: "pen", down: false }));
  el.dispatchEvent(pointer(el, "pointerenter", p, { id: 77, kind: "pen", down: false }));
}

export const touchSim = { drag, tap, pinch, safariGesture, penHover, sleep };
export type TouchSim = typeof touchSim;
