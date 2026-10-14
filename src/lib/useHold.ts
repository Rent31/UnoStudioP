"use client";

import { useRef } from "react";
import type { PointerEvent as RPointerEvent, MouseEvent as RMouseEvent } from "react";

// Press and hold (or right click) to inspect, plain tap to act.
// Works for both mouse and touch, and cancels if the finger starts scrolling.
export function useHold(onHold: () => void, onTap?: () => void, delay = 420) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: (e: RPointerEvent) => {
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        held.current = true;
        onHold();
      }, delay);
    },
    onPointerMove: (e: RPointerEvent) => {
      if (!start.current) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      if (dx > 10 || dy > 10) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: RMouseEvent) => {
      e.preventDefault();
      clear();
      held.current = true;
      onHold();
    },
    onClick: (e: RMouseEvent) => {
      if (held.current) {
        e.preventDefault();
        e.stopPropagation();
        held.current = false;
        return;
      }
      onTap?.();
    },
  };
}
