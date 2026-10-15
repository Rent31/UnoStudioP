"use client";

import { useEffect, type RefObject } from "react";

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (n: number) => Math.round(n * 1000) / 1000;

const CARD_W = 120;
const CARD_H = 180;

/**
 * Card scales are fitted to the measured table rather than guessed from the
 * viewport. A short landscape window and a tall phone leave very different
 * room, and only the real box knows how much. The element is observed so the
 * fit survives rotation, resizing and the log panel docking beside the table.
 */
export function useFluidScale(
  feltRef: RefObject<HTMLElement | null>,
  handRef: RefObject<HTMLElement | null>,
  opts: { maxOpponentCards: number },
) {
  const { maxOpponentCards } = opts;

  useEffect(() => {
    const root = document.documentElement.style;

    const apply = () => {
      const felt = feltRef.current;
      if (!felt) return;
      const W = felt.clientWidth;
      const H = felt.clientHeight;
      if (W < 40 || H < 40) return;

      // The top seat sits in its own row, the piles and side seats share the
      // next one, so each gets a slice of the table height to live inside.
      const topRowH = H * 0.28;
      const midRowH = H * 0.52;

      // Top seat: an upright card plus its name header.
      const kSeat = clamp(0.13, Math.min((topRowH - 28) / CARD_H, (W * 0.34) / CARD_W), 0.36);

      // Centre piles: two cards side by side with a gap between them.
      const kPile = clamp(0.24, Math.min((midRowH - 46) / CARD_H, (W * 0.2) / CARD_W), 0.84);

      // Side seats: a vertical fan of rotated cards. Work out how tight the
      // overlap has to be for the whole fan to fit the row, then size the card.
      const n = Math.max(1, Math.min(maxOpponentCards, 10));
      const fanBudget = midRowH - 32;
      const sideColW = Math.max(60, (W - kPile * CARD_W * 2 - 48) / 2);
      let kSide = clamp(0.12, Math.min((sideColW - 10) / CARD_H, 0.31), 0.31);
      let overlap = clamp(0.16, 0.16 + n * 0.032, 0.86);
      // fan height = cardH * (1 + (n - 1) * (1 - overlap)), card lies rotated
      const fanH = (k: number, o: number) => CARD_W * k * (1 + (n - 1) * (1 - o));
      if (fanH(kSide, overlap) > fanBudget) {
        const needed = 1 - (fanBudget / (CARD_W * kSide) - 1) / Math.max(1, n - 1);
        overlap = clamp(overlap, needed, 0.88);
      }
      if (fanH(kSide, overlap) > fanBudget) {
        kSide = clamp(0.1, fanBudget / (CARD_W * (1 + (n - 1) * (1 - overlap))), kSide);
      }

      root.setProperty("--k-seat", String(round(kSeat)));
      root.setProperty("--k-pile", String(round(kPile)));
      root.setProperty("--k-seat-side", String(round(kSide)));
      root.setProperty("--seat-overlap", String(round(overlap)));

      // Hand cards are sized from the window height only -- never from how
      // many cards are held or how narrow the strip is. Shrinking (or
      // overlapping harder) to squeeze a big hand into the width made cards
      // unreadably small on phones. Instead the hand keeps a readable size,
      // the extra cards run off the right edge, and .handscroll scrolls to
      // reach them. A short window (a phone held sideways) still scales the
      // cards down, since there the height genuinely is not there.
      const byViewH = (window.innerHeight * 0.27 - 34) / CARD_H;
      root.setProperty("--k-hand", String(round(clamp(0.42, byViewH, 0.72))));
      root.setProperty("--hand-overlap", "0.42");
    };

    apply();
    const ro = new ResizeObserver(apply);
    if (feltRef.current) ro.observe(feltRef.current);
    if (handRef.current) ro.observe(handRef.current);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, [feltRef, handRef, maxOpponentCards]);
}
