export interface TurnSeat {
  id: string;
  left: boolean;
  eliminated: boolean;
  spectator: boolean;
}

/**
 * Return only players the engine can actually advance to, in play order.
 * `currentId` is first, so the visible strip reads current turn → next turn
 * even when the underlying seat array has been reversed or shuffled.
 */
export function orderTurnSeats<T extends TurnSeat>(
  players: T[],
  direction: 1 | -1,
  currentId?: string | null,
): T[] {
  const active = players.filter((p) => !p.left && !p.eliminated && !p.spectator);
  if (active.length < 2) return active;
  const found = currentId ? active.findIndex((p) => p.id === currentId) : -1;
  const start = found >= 0 ? found : 0;
  return active.map((_, offset) => active[(start + offset * direction + active.length * 2) % active.length]);
}
