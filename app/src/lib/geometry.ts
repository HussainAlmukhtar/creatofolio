// 2D geometry helpers — pure functions, no I/O, no React, no Konva.
//
// Lifted from `integrityCheck.ts` (point-in-polygon was previously private
// there) and extended with `nearestPointOnPolygon` for the walk-to picker
// snap behaviour. Reusable from any module that talks `Point[]` polygons.

import type { Point } from "@/data/roomTypes";

/**
 * Standard ray-cast point-in-polygon. Polygon vertices are taken as a
 * closed loop (first → last → first). Behaviour on edges/vertices is
 * "consistent but unspecified" — fine for our use cases.
 */
export function isPointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Project a point onto the closest segment of a polygon. Used to "snap" a
 * point to the nearest reachable spot on a walkable area when the user
 * drags it outside.
 *
 * Returns the input unchanged if the polygon is degenerate (< 2 verts).
 * Always returns a *new* Point object — safe to pass straight back into
 * setters that compare by reference.
 */
export function nearestPointOnPolygon(p: Point, polygon: Point[]): Point {
  if (polygon.length < 2) return { x: p.x, y: p.y };

  let best: Point = { x: polygon[0].x, y: polygon[0].y };
  let bestDistSq = Infinity;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const candidate = nearestPointOnSegment(p, polygon[j], polygon[i]);
    const dx = candidate.x - p.x;
    const dy = candidate.y - p.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = candidate;
    }
  }

  return best;
}

/**
 * Closest point on segment (a → b) to p. Standard parametric projection
 * with a t-clamp so the result is always on the segment, never the
 * extended infinite line.
 */
function nearestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y }; // a == b
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)
  );
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Convenience: snap `p` to inside-the-polygon. If already inside, returns
 * `p` unchanged. If outside, returns the nearest point on the polygon's
 * boundary. Wraps the two helpers above so callers don't need to compose
 * them manually.
 */
export function clampPointToPolygon(p: Point, polygon: Point[]): Point {
  if (isPointInPolygon(p, polygon)) return { x: p.x, y: p.y };
  return nearestPointOnPolygon(p, polygon);
}
