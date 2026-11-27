"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Touch selection model shared by the landing / Arcade Studio hit boxes: a finger
 * TAP selects, a finger DRAG does not (the page scrolls instead: the hit box is
 * `touch-action: pan-x pan-y` while it is not selected). Mouse and Pencil select
 * on press as before. `enabled` = touch mode; a desktop mouse is unchanged.
 */
export function useTapSelect(onSelect: () => void, enabled: boolean) {
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });
  return {
    onPointerDown: useCallback(
      (e: React.PointerEvent) => {
        if (enabled && e.pointerType === "touch") {
          press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
          return;
        }
        select.current();
      },
      [enabled]
    ),
    onPointerMove: useCallback((e: React.PointerEvent) => {
      const p = press.current;
      if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;
    }, []),
    onPointerUp: useCallback((e: React.PointerEvent) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      press.current = null;
      if (!p.moved) select.current();
    }, []),
    onPointerCancel: useCallback(() => {
      press.current = null;
    }, []),
  };
}

/** Style bits for such a hit box on touch screens. */
export function touchHitStyle(enabled: boolean, selected: boolean): React.CSSProperties | undefined {
  return enabled
    ? { touchAction: selected ? "none" : "pan-x pan-y", WebkitTouchCallout: "none", userSelect: "none" }
    : undefined;
}
