// Shared client-side types mirroring the server's per-player view, plus session storage.

import type { Face, FaceValue, FlexValue, ColorName, Variant, Side, HouseRules } from "@/lib/game/model";

export interface HandCardView {
  id: string;
  light: Face;
  dark: Face | null;
  flexColor: ColorName | null;
  flexValue: FlexValue | null;
  flipIcon: boolean;
  playable?: boolean;
  flexPlayable?: boolean;
  flexUpgradable?: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  connected: boolean;
  left: boolean;
  eliminated: boolean;
  cardCount: number;
  score: number;
  wins: number;
  powerGreen: boolean;
  isTurn: boolean;
  hand?: HandCardView[];
  otherSide?: Face[];
}

export interface GameEventView {
  seq: number; type: string; msg: string; at: number; round: number;
  card?: { color: string; value: string } | null;
  actor?: string;
}

export interface ChatMessageView {
  id: number; playerId: string; name: string; text: string; at: number; system?: boolean;
}

export interface RouletteView {
  kind: "wildColorRoulette" | "wildDrawColor";
  byId: string;
  byName: string;
  chooserId: string;
  chooserName: string;
  pullerId: string;
  pullerName: string;
  color: ColorName | null;
  drawn: { id: string; light: Face; dark: Face | null; flexColor: ColorName | null; flexValue: FlexValue | null; flipIcon: boolean }[];
  done: boolean;
}

export interface ViewData {
  phase: "lobby" | "playing" | "roundOver" | "gameOver";
  variant: Variant;
  rules: HouseRules;
  lockValue: FaceValue | null;
  unoRace: { playerId: string; msLeft: number } | null;
  turnMsLeft: number | null;
  round: number;
  side: Side;
  direction: 1 | -1;
  currentColor: ColorName;
  pendingDraw: number;
  stackValue: number;
  targetScore: number;
  meId: string | null;
  iAmAdmin: boolean;
  iAmOwner: boolean;
  players: PlayerView[];
  drawCount: number;
  discardCount: number;
  topCard: { id: string; light: Face; dark: Face | null; flexColor: ColorName | null; flexValue: FlexValue | null; flipIcon: boolean } | null;
  drawTopBackSide: Face | null;
  challenge: { targetId: string; byId: string; byName?: string } | null;
  flipColorChoice: { playerId: string } | null;
  roulette: RouletteView | null;
  turnStage: "play" | "drewCard" | "double" | "roulette";
  drewCardId: string | null;
  roundWinnerId: string | null;
  roundNote: string;
  scoresAtRound: { playerId: string; gained: number; total: number; wins: number }[];
  events: GameEventView[];
  logTail: GameEventView[];
  chat: ChatMessageView[];
  chatOn: boolean;
  lastSeq: number;
  serverNow: number;
  version: number;
}

export interface Session { pid: string; tok: string; name: string }

export interface HostIntent {
  code: string;
  name: string;
  createdAt: number;
  secret: string;
}

const HOST_KEY = (code: string) => `uno-host-${code}`;
const HOST_STATE_KEY = (code: string) => `uno-host-state-${code}`;
const PENDING_KEY = (code: string) => `uno-pending-name-${code}`;

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

export function createHostIntent(code: string, name: string): HostIntent {
  const secretBytes = new Uint8Array(16);
  crypto.getRandomValues(secretBytes);
  const intent: HostIntent = {
    code,
    name,
    createdAt: Date.now(),
    secret: Array.from(secretBytes, (n) => n.toString(16).padStart(2, "0")).join(""),
  };
  localStorage.setItem(HOST_KEY(code), JSON.stringify(intent));
  return intent;
}

export function loadHostIntent(code: string): HostIntent | null {
  try {
    const value = localStorage.getItem(HOST_KEY(code));
    return value ? JSON.parse(value) as HostIntent : null;
  } catch { return null; }
}

export function clearHostRoom(code: string) {
  try {
    localStorage.removeItem(HOST_KEY(code));
    localStorage.removeItem(HOST_STATE_KEY(code));
  } catch {}
}

export function saveHostState(code: string, value: unknown) {
  try { localStorage.setItem(HOST_STATE_KEY(code), JSON.stringify(value)); } catch {}
}

export function loadHostState<T>(code: string): T | null {
  try {
    const value = localStorage.getItem(HOST_STATE_KEY(code));
    return value ? JSON.parse(value) as T : null;
  } catch { return null; }
}

export function savePendingName(code: string, name: string) {
  try { localStorage.setItem(PENDING_KEY(code), name); } catch {}
}
export function loadPendingName(code: string): string {
  try { return localStorage.getItem(PENDING_KEY(code)) ?? ""; } catch { return ""; }
}
export function clearPendingName(code: string) {
  try { localStorage.removeItem(PENDING_KEY(code)); } catch {}
}

export function loadSession(code: string): Session | null {
  try {
    const raw = localStorage.getItem(`uno-sess-${code}`);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s?.pid && s?.tok) return s;
    return null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, s: Session) {
  try { localStorage.setItem(`uno-sess-${code}`, JSON.stringify(s)); } catch {}
}

export function clearSession(code: string) {
  try { localStorage.removeItem(`uno-sess-${code}`); } catch {}
}

export function savedName(): string {
  try { return localStorage.getItem("uno-name") ?? ""; } catch { return ""; }
}
export function saveName(n: string) {
  try { localStorage.setItem("uno-name", n); } catch {}
}
