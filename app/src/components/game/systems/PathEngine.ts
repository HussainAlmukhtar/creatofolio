// PathEngine — click-to-walk movement system.
//
// A TypeScript port of PathEngine.js from Yukon
// (https://github.com/wizguin/yukon), MIT License,
// Copyright (c) 2022 wizguin. See THIRD_PARTY_NOTICES.md.
//
// Core concept: line-cast from player position toward click target,
// stepping pixel-by-pixel. Stop at the last safe position before
// hitting the walkable-area boundary.

import type { Point } from "@/data/roomTypes";

/** Default room dimensions (canvas design size) */
const DEFAULT_WIDTH = 1520;
const DEFAULT_HEIGHT = 960;
const MARGIN = 30;

/** Movement speed: pixels per frame at 24fps (matches Yukon) */
const SPEED = 4;

/** Room bounds for clamping — computed per call from room dimensions */
interface RoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function getBounds(roomWidth?: number, roomHeight?: number): RoomBounds {
  const w = roomWidth ?? DEFAULT_WIDTH;
  const h = roomHeight ?? DEFAULT_HEIGHT;
  return {
    minX: MARGIN,
    maxX: w - MARGIN,
    minY: MARGIN,
    maxY: h - MARGIN,
  };
}

export interface PathResult {
  target: Point;
  duration: number; // milliseconds
  direction: number; // 1-8, clockwise from N
}

/**
 * Check if a point is inside a polygon using ray-casting algorithm.
 * This replaces Yukon's Matter.js containsPoint — we don't need full
 * Matter.js physics, just a point-in-polygon test.
 */
export function isPointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

function clampPos(pos: Point, bounds: RoomBounds): Point {
  return {
    x: Math.round(Math.max(bounds.minX, Math.min(pos.x, bounds.maxX))),
    y: Math.round(Math.max(bounds.minY, Math.min(pos.y, bounds.maxY))),
  };
}

function isBlocked(x: number, y: number, walkablePolygon: Point[]): boolean {
  return !isPointInPolygon(x, y, walkablePolygon);
}

/**
 * Get angle in degrees from pos to target (0 = North, clockwise).
 * Screen coordinates have y pointing DOWN, so the compass angle is
 * atan2(dx, -dy) — the previous atan2(dy, dx) - 90 form measured from
 * South instead, which inverted every facing (walk right → face left).
 */
function getAngle(pos: Point, target: Point): number {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const angle = Math.floor(Math.atan2(dx, -dy) * (180 / Math.PI));
  return angle < 0 ? angle + 360 : angle;
}

/**
 * Convert angle to 8-directional index (1-8).
 * 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW
 */
function getDirection(angle: number): number {
  const direction = Math.round(angle / 45) + 1;
  return direction > 8 ? 1 : direction;
}

/**
 * Calculate tween duration from distance and speed (frame-based, like Yukon).
 */
function getFrameBasedDuration(distance: number, speed: number, fps = 24): number {
  const frames = distance / speed;
  const seconds = frames / fps;
  return seconds * 1000;
}

/**
 * Line-cast from current position toward target, stepping pixel-by-pixel.
 * Returns the furthest reachable position before hitting a wall.
 */
function getSafeTarget(pos: Point, target: Point, walkablePolygon: Point[], bounds: RoomBounds): Point {
  target = clampPos(target, bounds);

  // If the target itself is inside the walkable area, walk straight to it.
  // Line-casting only matters when the target is outside the polygon
  // (e.g. clicking on a wall or outside the room).
  // Without this shortcut, a straight line through a trapezoid-shaped
  // walkable area can clip a corner and stop the player short.
  if (!isBlocked(target.x, target.y, walkablePolygon)) {
    return { ...target };
  }

  const distance = Math.round(
    Math.sqrt((target.x - pos.x) ** 2 + (target.y - pos.y) ** 2)
  );

  if (distance === 0) return { ...pos };

  const moveX = (target.x - pos.x) / distance;
  const moveY = (target.y - pos.y) / distance;
  const safe = { ...pos };

  let remaining = distance;
  while (remaining > 0) {
    if (isBlocked(safe.x + moveX, safe.y + moveY, walkablePolygon)) {
      break;
    }
    safe.x += moveX;
    safe.y += moveY;
    remaining--;
  }

  safe.x = Math.round(safe.x);
  safe.y = Math.round(safe.y);

  return safe;
}

/**
 * Calculate a movement path from the player's current position to a click target.
 * Returns null if the player is already close enough (distance < 10).
 * Pass roomWidth/roomHeight to use correct bounds clamping for the current room.
 */
export function getPath(
  playerPos: Point,
  clickTarget: Point,
  walkablePolygon: Point[],
  roomWidth?: number,
  roomHeight?: number
): PathResult | null {
  const bounds = getBounds(roomWidth, roomHeight);
  const safe = getSafeTarget(playerPos, clickTarget, walkablePolygon, bounds);
  const distance = Math.sqrt(
    (safe.x - playerPos.x) ** 2 + (safe.y - playerPos.y) ** 2
  );

  if (distance < 10) return null;

  const duration = getFrameBasedDuration(distance, SPEED * 2);
  const angle = getAngle(playerPos, safe);
  const direction = getDirection(angle);

  return { target: safe, duration, direction };
}

/**
 * Determine a random safe spawn position near the given coordinates.
 * Tries up to 25 random offsets within range; falls back to the given position.
 */
export function findSafeSpawn(
  x: number,
  y: number,
  walkablePolygon: Point[],
  range = 80,
  roomWidth?: number,
  roomHeight?: number
): Point {
  const bounds = getBounds(roomWidth, roomHeight);

  // First check if default position is safe
  if (!isBlocked(x, y, walkablePolygon)) {
    return { x, y };
  }

  for (let i = 0; i < 25; i++) {
    const clamped = clampPos(
      { x: x + (Math.random() * range * 2 - range), y: y + (Math.random() * range * 2 - range) },
      bounds
    );
    if (!isBlocked(clamped.x, clamped.y, walkablePolygon)) {
      return clamped;
    }
  }

  return { x, y };
}

/**
 * Convert an 8-directional index to a Phaser-friendly direction string.
 * Used for choosing animation frames.
 */
export function directionToString(direction: number): "left" | "right" {
  // Directions 6,7,8 face left; 2,3,4 face right; 1,5 keep current
  if (direction >= 6 && direction <= 8) return "left";
  if (direction >= 2 && direction <= 4) return "right";
  return "right"; // default
}
