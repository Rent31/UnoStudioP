"use client";

import { useEffect, type RefObject } from "react";

/**
 * Mouse support for a horizontally scrolling strip.
 *
 * Touch already scrolls .handscroll natively (overflow-x + pan-x), so touch
 * pointers are deliberately left alone -- hijacking them would fight the
 * browser's own scrolling and its tap/hold handling. A mouse has neither:
 * overflow alone only gives it a scrollbar and shift-wheel. So for mouse
 * (and pen) pointers this adds click-and-drag scrolling, and it turns a
 * plain vertical wheel into horizontal movement while hovering the strip.
 *
 * A drag that ends on a card must not also play/inspect it, so the click
 * that follows a real drag is swallowed once, in the capture phase, before
 * it can reach the card's own handler.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let down = false;
    let dragged = false;
    let suppressClick = false;
    let suppressTimer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startScrollLeft = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Left mouse button / pen contact only; touch scrolls natively.
      if (e.pointerType === "touch" || e.button !== 0) return;
      down = true;
      dragged = false;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!down) return;
      // The release happened outside the window and was never seen.
      if ((e.buttons & 1) === 0) {
        down = false;
        dragged = false;
        el.classList.remove("dragging");
        return;
      }
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) <= 6) return;
      if (!dragged) {
        dragged = true;
        el.classList.add("dragging");
      }
      el.scrollLeft = startScrollLeft - dx;
    };

    const endDrag = () => {
      if (!down) return;
      down = false;
      el.classList.remove("dragging");
      if (!dragged) return;
      dragged = false;
      // The pointerup is about to be followed by a click on whatever card
      // the drag ended over. Swallow exactly that one click.
      suppressClick = true;
      if (suppressTimer) clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => {
        suppressClick = false;
        suppressTimer = null;
      }, 120);
    };

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      if (suppressTimer) {
        clearTimeout(suppressTimer);
        suppressTimer = null;
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      const raw = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const delta = raw * unit;
      if (!delta) return;
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.max(0, Math.min(max, el.scrollLeft + delta));
      if (next === el.scrollLeft) return; // at the edge: don't trap the wheel
      e.preventDefault();
      el.scrollLeft = next;
    };

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    el.addEventListener("click", onClick, true);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("wheel", onWheel);
      if (suppressTimer) clearTimeout(suppressTimer);
    };
  }, [ref]);
}
