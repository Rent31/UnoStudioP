// Who keeps a peer room alive.
//
// The browser that opened the room runs the game engine. If that browser goes
// away (closed tab, phone suspended, network drop) the next player to have
// joined takes over, using the copy of the room every browser keeps. When the
// owner comes back they outrank everyone and get the room straight back, so
// succession is just join order: earliest joinedAt wins, ties broken by id.

export interface HostCandidate {
  pid: string;
  peerId: string;
  joinedAt: number;
  /** has a copy of the room state, so it is able to run the engine */
  canHost: boolean;
  at: number;
}

/** A presence beat older than this is treated as gone. */
export const PRESENCE_TTL_MS = 7000;
/** A host that stops saying hello for this long has lost the room. */
export const HOST_TTL_MS = 7000;
/** How often every browser says who it is. */
export const PRESENCE_INTERVAL_MS = 2000;

export function isBetterHost(
  a: { joinedAt: number; pid: string },
  b: { joinedAt: number; pid: string },
): boolean {
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt;
  return a.pid < b.pid;
}

/** The browser that should be running the room right now, or null if the room is empty. */
export function pickHost(candidates: HostCandidate[], now = Date.now()): HostCandidate | null {
  let best: HostCandidate | null = null;
  for (const c of candidates) {
    if (!c.canHost) continue;
    if (now - c.at > PRESENCE_TTL_MS) continue;
    if (!best || isBetterHost(c, best)) best = c;
  }
  return best;
}

/** True when the announced host has gone quiet, or someone outranks them. */
export function hostShouldChange(
  host: { pid: string; joinedAt: number; at: number } | null,
  best: HostCandidate | null,
  now = Date.now(),
): boolean {
  if (!best) return false;
  if (!host) return true;
  if (now - host.at > HOST_TTL_MS) return true;
  return isBetterHost(best, host);
}

/** Newer room state wins when two copies meet, e.g. an owner returning. */
export function isNewerState(a: { seq: number; lastActionAt: number }, b: { seq: number; lastActionAt: number }): boolean {
  if (a.seq !== b.seq) return a.seq > b.seq;
  return a.lastActionAt > b.lastActionAt;
}
