// Game engine: room state, reducers for every player/admin action, bot logic,
// and the per-player view sanitizer. Pure functions over RoomState.

import {
  Variant, Side, ColorName, FaceValue, FlexValue, GameCard, Face, HouseRules,
  LIGHT_COLOR_NAMES, DARK_COLOR_NAMES, VARIANT_META, DEFAULT_RULES,
  buildDeck, shuffled, isNumberValue, isWildFace, isActionValue, drawStrength, isDrawValue,
  facePoints, activeFace, valueLabel,
} from "./model";

export interface GameEvent {
  seq: number;
  type: string;
  msg: string;
  at: number;
  round: number;
  card?: { color: string; value: string } | null;
  actor?: string;
}

export interface ChatMessage {
  id: number;
  playerId: string;
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  isBot: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  connected: boolean;
  left: boolean;
  lastSeen: number;
  hand: GameCard[];
  score: number;
  wins: number;
  calledUno: boolean;
  eliminated: boolean;
  powerGreen: boolean;
}

export type Phase = "lobby" | "playing" | "roundOver" | "gameOver";
export type TurnStage = "play" | "drewCard" | "double" | "roulette";

// A color roulette / draw-until-color pull in progress. The cards come off the
// pile one at a time and every card drawn is public, so the whole table watches
// the victim dig for the named color.
export interface RouletteState {
  kind: "wildColorRoulette" | "wildDrawColor";
  byId: string;          // who played the card
  chooserId: string;     // who names the color
  pullerId: string;      // who draws
  color: ColorName | null;
  drawn: GameCard[];     // pulled so far, in order, face up for everyone
  advance: number;       // turn advance once the pull is done
  doneAt: number | null; // when the color turned up
}

export interface RoomState {
  variant: Variant;
  rules: HouseRules;
  phase: Phase;
  players: PlayerState[];
  round: number;
  dealerIdx: number;
  side: Side;
  drawPile: GameCard[];
  discardPile: GameCard[];
  setAside: GameCard[];
  turn: {
    playerIdx: number;
    stage: TurnStage;
    drewCardId?: string;
    doubleColor?: ColorName;
    doubleValue?: FaceValue;
    pendingAdvance?: number;
  };
  turnStartedAt: number;
  direction: 1 | -1;
  currentColor: ColorName;
  pendingDraw: number;
  stackValue: number;
  skipOnce: string[];
  lockValue?: FaceValue | null;
  challenge?: { targetId: string; byId: string; legal: boolean } | null;
  flipColorChoice?: { playerId: string } | null;
  roulette?: RouletteState | null;
  unoRace?: { playerId: string; until: number } | null;
  roundWinnerId?: string | null;
  roundNote?: string;
  roundOverAt?: number | null;
  scoresAtRound: { playerId: string; gained: number; total: number; wins: number }[];
  events: GameEvent[];
  chat: ChatMessage[];
  chatOn: boolean;
  chatSeq: number;
  seq: number;
  lastActionAt: number;
  createdAt: number;
}

const BOT_NAMES = ["Ada", "Turing", "Hopper", "Linus", "Margo", "Rex", "Nova", "Ivy", "Otto", "Zed", "Pia", "Kit"];
export const MAX_PLAYERS = 10;
const UNO_WINDOW_MS = 4000;
export const BOT_DELAY_MS = 950;
// how long the table gets to look at the card that ended the pull before the
// turn moves on by itself
export const ROULETTE_HOLD_MS = 1700;

function now() { return Date.now(); }

export function newCode(): string {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function token(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

export function createRoomState(variant: Variant): RoomState {
  return {
    variant,
    rules: { ...DEFAULT_RULES },
    phase: "lobby",
    players: [],
    round: 0,
    dealerIdx: 0,
    side: "light",
    drawPile: [], discardPile: [], setAside: [],
    turn: { playerIdx: 0, stage: "play" },
    turnStartedAt: now(),
    direction: 1,
    currentColor: "red",
    pendingDraw: 0, stackValue: 0,
    skipOnce: [],
    lockValue: null,
    challenge: null, flipColorChoice: null, roulette: null, unoRace: null,
    roundWinnerId: null,
    scoresAtRound: [],
    events: [],
    chat: [],
    chatOn: true,
    chatSeq: 0,
    seq: 0,
    lastActionAt: now(),
    createdAt: now(),
  };
}

const SILENT_EVENTS = new Set(["uno"]);

export function log(
  s: RoomState, type: string, msg: string,
  extra?: { card?: Face | null; actor?: string },
) {
  if (SILENT_EVENTS.has(type)) return;
  s.seq += 1;
  s.events.push({
    seq: s.seq, type, msg, at: now(), round: s.round,
    card: extra?.card ? { color: extra.card.color, value: extra.card.value } : null,
    actor: extra?.actor,
  });
  if (s.events.length > 400) s.events = s.events.slice(-400);
}

function touch(s: RoomState) { s.lastActionAt = now(); }

export function addPlayer(s: RoomState, name: string, isBot: boolean): PlayerState {
  const p: PlayerState = {
    id: `p${Math.random().toString(36).slice(2, 10)}`,
    token: token(),
    name: name.slice(0, 14),
    isBot,
    isOwner: s.players.length === 0 && !isBot,
    isAdmin: false,
    connected: true,
    left: false,
    lastSeen: now(),
    hand: [],
    score: 0,
    wins: 0,
    calledUno: false,
    eliminated: false,
    powerGreen: true,
  };
  if (p.isOwner) p.isAdmin = true;
  s.players.push(p);
  log(s, "join", `${p.name} joined`);
  touch(s);
  return p;
}

export function botName(s: RoomState): string {
  const used = new Set(s.players.map((p) => p.name));
  for (const n of BOT_NAMES) if (!used.has(n)) return n;
  return `Bot ${Math.floor(Math.random() * 900 + 100)}`;
}

export function findPlayer(s: RoomState, id: string): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

function activePlayers(s: RoomState): PlayerState[] {
  return s.players.filter((p) => !p.left && !p.eliminated);
}

function idxOf(s: RoomState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

function rawNext(s: RoomState, fromIdx: number): number {
  const n = s.players.length;
  let i = fromIdx;
  for (let g = 0; g < n * 2 + 4; g++) {
    i = ((i + s.direction) % n + n) % n;
    const p = s.players[i];
    if (!p.left && !p.eliminated) return i;
  }
  return fromIdx;
}

function nextIdx(s: RoomState, fromIdx: number, steps = 1): number {
  let i = fromIdx;
  for (let k = 0; k < steps; k++) {
    i = rawNext(s, i);
    // targeted skip consumption
    const pid = s.players[i]?.id;
    if (pid && s.skipOnce.includes(pid) && k === steps - 1) {
      s.skipOnce = s.skipOnce.filter((x) => x !== pid);
      log(s, "skip", `${s.players[i].name} was skipped by an earlier Skip.`);
      i = rawNext(s, i);
    }
  }
  return i;
}

function labelOf(s: RoomState, f: Face): string {
  if (f.color === "wild") return valueLabel(f.value);
  if (isNumberValue(f.value)) return `${f.color} ${f.value}`;
  return `${f.color} ${valueLabel(f.value)}`;
}

function face(s: RoomState, c: GameCard): Face {
  return activeFace(s.side, c);
}

function topDiscard(s: RoomState): GameCard | undefined {
  return s.discardPile[s.discardPile.length - 1];
}

function handPoints(s: RoomState, p: PlayerState): number {
  return p.hand.reduce((sum, c) => sum + facePoints(face(s, c), s.variant), 0);
}

function stackingOn(s: RoomState): boolean {
  return s.variant === "nomercy" || s.rules.stacking;
}

function canStackOnto(s: RoomState, v: FaceValue): boolean {
  if (!isDrawValue(v)) return false;
  if (s.rules.ultimateStacking || s.rules.darkStacking) return true;
  return drawStrength(v) >= s.stackValue;
}

// ---------------------------------------------------------------- matching

function canPlayCard(s: RoomState, p: PlayerState, card: GameCard, useFlex: boolean): boolean {
  const f = face(s, card);
  const top = topDiscard(s);
  if (!top) return true;

  if (s.pendingDraw > 0 && stackingOn(s)) {
    if (s.rules.reverseReflect && (f.value === "reverse" || f.value === "wildReverse")) return true;
    if (useFlex && s.rules.flexStacking && card.flexValue) return true;
    return canStackOnto(s, f.value);
  }

  if (s.variant === "allwild") {
    if (s.rules.colorLock && s.lockValue && card.light.value !== s.lockValue && card.light.value !== "wild") return false;
    return true;
  }

  if (useFlex) {
    if (s.variant !== "flex" || !p.powerGreen) return false;
    if (!card.flexColor && !card.flexValue) return false;
    if (isWildFace(f)) return true;
    const tf = face(s, top);
    if (card.flexColor && card.flexColor === s.currentColor) return true;
    return f.color === s.currentColor || f.value === tf.value;
  }

  if (isWildFace(f)) return true;
  const tf = face(s, top);
  if (f.color === s.currentColor) return true;
  if (f.value === tf.value) return true;
  return false;
}

export function playableMoves(s: RoomState, p: PlayerState): { card: GameCard; flex: boolean }[] {
  const out: { card: GameCard; flex: boolean }[] = [];
  for (const c of p.hand) {
    if (canPlayCard(s, p, c, false)) out.push({ card: c, flex: false });
    else if (s.variant === "flex" && canPlayCard(s, p, c, true)) out.push({ card: c, flex: true });
  }
  return out;
}

// ---------------------------------------------------------------- drawing

function ensureDrawPile(s: RoomState, need: number) {
  if (s.drawPile.length >= need) return;
  if (s.discardPile.length <= 1 && s.setAside.length === 0) return;
  const top = topDiscard(s);
  const recycle = s.discardPile.slice(0, -1).concat(s.setAside);
  s.setAside = [];
  s.drawPile = s.drawPile.concat(shuffled(recycle));
  s.discardPile = top ? [top] : [];
  if (recycle.length > 0) log(s, "shuffle", "Draw pile reshuffled");
}

function takeCards(s: RoomState, count: number, fromDiscard: boolean): GameCard[] {
  const out: GameCard[] = [];
  for (let i = 0; i < count; i++) {
    if (fromDiscard && s.discardPile.length > 1) {
      out.push(s.discardPile.splice(s.discardPile.length - 2, 1)[0]);
      continue;
    }
    ensureDrawPile(s, 1);
    const c = s.drawPile.pop();
    if (!c) break;
    out.push(c);
  }
  return out;
}

function drawToHand(s: RoomState, p: PlayerState, count: number, fromDiscard = false): GameCard[] {
  const drawn = takeCards(s, count, fromDiscard);
  p.hand.push(...drawn);
  if (p.hand.length > 1) p.calledUno = false;
  checkMercy(s, p);
  checkMercy10(s, p);
  return drawn;
}

function checkMercy(s: RoomState, p: PlayerState) {
  if (s.variant !== "nomercy") return;
  if (p.hand.length >= 25 && !p.eliminated && !p.left) {
    p.eliminated = true;
    p.calledUno = false;
    s.setAside.push(...p.hand);
    p.hand = [];
    log(s, "eliminate", `${p.name} hit 25 cards. Mercy rule: out.`);
  }
}

function checkMercy10(s: RoomState, p: PlayerState) {
  if (!s.rules.mercy10 || p.eliminated || p.left) return;
  if (p.hand.length < 10) return;
  const drop = Math.floor(p.hand.length / 2);
  const mixed = shuffled(p.hand);
  const discarded = mixed.slice(0, drop);
  p.hand = mixed.slice(drop);
  s.drawPile = discarded.concat(s.drawPile);
  log(s, "mercy", `${p.name} hit ten cards and buried ${drop} at the bottom.`);
}

function clearUnoRaceFor(s: RoomState, p: PlayerState) {
  if (s.unoRace && s.unoRace.playerId === p.id) s.unoRace = null;
}

// ---------------------------------------------------------------- rounds

export function startRound(s: RoomState) {
  if (s.rules.randomOrder || s.rules.chaosMode) {
    s.players = shuffled(s.players);
    log(s, "order", "Seating order was shuffled for this round.");
  }
  const particip = s.players.filter((p) => !p.left);
  for (const p of particip) {
    p.hand = [];
    p.eliminated = false;
    p.calledUno = false;
    p.powerGreen = true;
  }
  const deck = shuffled(buildDeck(s.variant));
  let starterIdx = s.variant === "allwild" ? 0 : deck.findIndex((c) => isNumberValue(c.light.value));
  if (starterIdx < 0) starterIdx = 0;
  const starter = deck.splice(starterIdx, 1)[0];

  for (let i = 0; i < 7; i++) {
    for (const p of particip) {
      const c = deck.pop();
      if (c) p.hand.push(c);
    }
  }
  s.drawPile = deck;
  s.discardPile = [starter];
  s.setAside = [];
  s.side = "light";
  s.direction = 1;
  s.currentColor = starter.light.color === "wild" ? "red" : starter.light.color;
  s.pendingDraw = 0;
  s.stackValue = 0;
  s.skipOnce = [];
  s.lockValue = null;
  s.challenge = null;
  s.flipColorChoice = null;
  s.roulette = null;
  s.unoRace = null;
  s.round += 1;
  s.roundWinnerId = null;
  s.scoresAtRound = [];
  s.roundOverAt = null;
  s.turn = { playerIdx: nextIdx(s, s.dealerIdx % s.players.length, 1), stage: "play" };
  s.turnStartedAt = now();
  s.phase = "playing";
  log(s, "deal", `Round ${s.round} dealt.`);
  touch(s);
}

function endRound(s: RoomState, winnerId: string, note: string) {
  const winner = findPlayer(s, winnerId);
  if (!winner) return;
  const eliminatedCount = s.players.filter((p) => p.eliminated && !p.left).length;
  let points = 0;
  for (const p of s.players) {
    if (p.id === winnerId || p.left || p.eliminated) continue;
    points += handPoints(s, p);
  }
  if (s.variant === "nomercy") points += eliminatedCount * 250;
  winner.score += points;
  // With a point goal, a win means taking the whole game. Without one,
  // every round you take counts as a win.
  if (s.rules.pointGoal === 0) winner.wins += 1;
  s.scoresAtRound = s.players
    .filter((p) => !p.left)
    .map((p) => ({ playerId: p.id, gained: p.id === winnerId ? points : 0, total: p.score, wins: p.wins }));
  s.roundWinnerId = winnerId;
  s.roundNote = note;
  s.roundOverAt = now();
  s.challenge = null;
  s.flipColorChoice = null;
  s.roulette = null;
  s.unoRace = null;
  s.pendingDraw = 0;
  const target = s.rules.pointGoal;
  const champion = target > 0
    ? s.players.filter((p) => !p.left).find((p) => p.score >= target)
    : undefined;
  if (champion) {
    s.phase = "gameOver";
    const best = s.players.filter((p) => !p.left).sort((a, b) => b.score - a.score)[0];
    best.wins += 1;
    s.scoresAtRound = s.scoresAtRound.map((r) => (r.playerId === best.id ? { ...r, wins: best.wins } : r));
    log(s, "gameOver", `${best.name} wins with ${best.score} points.`);
  } else {
    s.phase = "roundOver";
    log(s, "roundOver", `${winner.name} takes round ${s.round} for ${points}.`);
  }
  touch(s);
}

// ---------------------------------------------------------------- turn helpers

function advanceTurn(s: RoomState, steps = 1) {
  const nextI = nextIdx(s, s.turn.playerIdx, steps);
  if (s.rules.chaosMode) {
    // keep whoever is up next, then scramble everyone else around them
    const upNext = s.players[nextI];
    s.players = shuffled(s.players);
    s.turn = { playerIdx: idxOf(s, upNext.id), stage: "play" };
  } else {
    s.turn = { playerIdx: nextI, stage: "play" };
  }
  s.turnStartedAt = now();
  touch(s);
}

function afterHandChange(s: RoomState, p: PlayerState) {
  if (p.hand.length !== 1) {
    clearUnoRaceFor(s, p);
    if (p.hand.length > 1) p.calledUno = false;
  }
  if (p.hand.length === 1 && !p.calledUno && !p.isBot) {
    s.unoRace = { playerId: p.id, until: now() + UNO_WINDOW_MS };
  }
  if (p.hand.length === 1 && !p.calledUno && p.isBot) {
    s.unoRace = { playerId: p.id, until: now() + UNO_WINDOW_MS };
  }
  if (p.hand.length === 0 && s.phase === "playing" && !p.eliminated && !p.left) {
    if (s.pendingDraw > 0) {
      const victim = s.players[nextIdx(s, s.turn.playerIdx, 1)];
      const total = s.pendingDraw;
      s.pendingDraw = 0; s.stackValue = 0;
      drawToHand(s, victim, total);
      log(s, "draw", `${victim.name} eats the final stack of ${total}.`);
    }
    const alive = activePlayers(s).filter((x) => x.id !== p.id);
    if (alive.length > 0) endRound(s, p.id, "Hand emptied.");
    else { s.phase = "roundOver"; s.roundOverAt = now(); }
  }
}

function checkLastStanding(s: RoomState) {
  if (s.phase !== "playing") return;
  const alive = activePlayers(s);
  if (alive.length === 1) endRound(s, alive[0].id, "Last player standing.");
  else if (alive.length === 0) { s.phase = "roundOver"; s.roundOverAt = now(); }
}

function rotateHands(s: RoomState) {
  const seated = s.players.filter((q) => !q.left && !q.eliminated);
  if (seated.length < 2) return;
  const hands = seated.map((q) => q.hand);
  for (let i = 0; i < seated.length; i++) {
    const j = (i + s.direction + seated.length) % seated.length;
    seated[j].hand = hands[i];
  }
  for (const q of seated) if (q.hand.length !== 1) q.calledUno = false;
  s.unoRace = null;
}

function maybeResetTokens(s: RoomState) {
  const seated = s.players.filter((q) => !q.left);
  if (seated.length > 1 && seated.every((q) => !q.powerGreen)) {
    for (const q of seated) q.powerGreen = true;
    log(s, "flex", "Every token was spent. All tokens flip back on.");
  }
}

// ---------------------------------------------------------------- play

export interface PlayOpts { color?: ColorName; targetId?: string; useFlex?: boolean }

export function actPlay(s: RoomState, playerId: string, cardId: string, opts: PlayOpts): string | null {
  const p = findPlayer(s, playerId);
  if (!p || p.left || p.eliminated) return "Not in game";
  if (s.phase !== "playing") return "Round is over";
  if (s.challenge) return "Waiting on a challenge";
  if (s.flipColorChoice) return "Waiting on a color pick";
  if (s.roulette) return "Waiting on the color pull";
  const myIdx = idxOf(s, p.id);
  const card = p.hand.find((c) => c.id === cardId);
  if (!card) return "Card not in hand";
  const f = face(s, card);

  // jump in
  let jumped = false;
  if (s.turn.playerIdx !== myIdx) {
    const top = topDiscard(s);
    const tf = top ? face(s, top) : null;
    if (s.rules.jumpIn && tf && !isWildFace(f) && f.color === tf.color && f.value === tf.value && s.pendingDraw === 0) {
      jumped = true;
      s.turn = { playerIdx: myIdx, stage: "play" };
      log(s, "jump", `${p.name} jumped in with ${labelOf(s, f)}.`, { card: f, actor: p.name });
    } else {
      return "Not your turn";
    }
  }

  if (s.turn.stage === "drewCard" && s.turn.drewCardId !== cardId) return "Play the drawn card or pass";
  if (s.turn.stage === "double") {
    const okColor = !isWildFace(f) && f.color === s.turn.doubleColor;
    const okValue = f.value === s.turn.doubleValue;
    if (!okColor && !okValue) return "Second card must match color or value";
  } else if (!canPlayCard(s, p, card, !!opts.useFlex) && !jumped) {
    return "Card does not match";
  }

  const useFlex = !!opts.useFlex;
  const colorChoices = s.side === "dark" ? DARK_COLOR_NAMES : LIGHT_COLOR_NAMES;
  // a color roulette is named by the player who has to pull, not by the player
  // putting the card down; draw until color is named right here
  const needsColor = isWildFace(f) && s.variant !== "allwild"
    && f.value !== "wildSwap" && f.value !== "wildTargetDraw2" && f.value !== "wildColorRoulette";
  const chosen: ColorName | undefined = opts.color;
  if (needsColor && (!chosen || !(colorChoices as readonly string[]).includes(chosen))) return "Choose a color";

  clearUnoRaceFor(s, p);

  // -------- stacking path
  if (s.pendingDraw > 0 && stackingOn(s)) {
    const reflect = s.rules.reverseReflect && (f.value === "reverse" || f.value === "wildReverse");
    p.hand = p.hand.filter((c) => c.id !== cardId);
    s.discardPile.push(card);
    if (reflect) {
      s.direction = (s.direction * -1) as 1 | -1;
      if (!isWildFace(f)) s.currentColor = f.color;
      log(s, "reverse", `${p.name} reflected the +${s.pendingDraw} back.`, { card: f, actor: p.name });
    } else {
      const val = drawStrength(f.value);
      s.pendingDraw += val;
      s.stackValue = val;
      if (f.value === "wildReverseDraw4") s.direction = (s.direction * -1) as 1 | -1;
      if (isWildFace(f) && chosen) s.currentColor = chosen;
      log(s, "stack", `${p.name} stacked ${labelOf(s, f)}. Stack is now ${s.pendingDraw}.`, { card: f, actor: p.name });
    }
    afterHandChange(s, p);
    if (s.phase === "playing") advanceTurn(s, 1);
    return null;
  }

  p.hand = p.hand.filter((c) => c.id !== cardId);

  let extras: GameCard[] = [];
  const effValue: FaceValue | FlexValue = useFlex && card.flexValue ? card.flexValue : f.value;
  const effColor: ColorName = f.color;

  if (effValue === "discardAll") {
    extras = p.hand.filter((c) => face(s, c).color === effColor);
    p.hand = p.hand.filter((c) => face(s, c).color !== effColor);
  }
  s.discardPile.push(...extras, card);

  const wasFlipIcon = s.variant === "flex" && !!card.flipIcon && isNumberValue(f.value);
  const discardDraw = s.rules.discardRoulette;
  let advance = 1;

  const target = () => findPlayer(s, opts.targetId ?? "");

  switch (effValue) {
    case "skip":
    case "wildSkip": {
      if (s.rules.targetedSkip && opts.targetId) {
        const t = target();
        if (t && t.id !== p.id && !t.left && !t.eliminated) {
          s.skipOnce.push(t.id);
          log(s, "skip", `${p.name} played ${labelOf(s, f)} aimed at ${t.name}.`, { card: f, actor: p.name });
          advance = 1;
          break;
        }
      }
      advance = 2;
      log(s, "skip", `${p.name} played ${labelOf(s, f)}. Next player is skipped.`, { card: f, actor: p.name });
      break;
    }
    case "wildSkipTwo":
      advance = 3;
      log(s, "skip", `${p.name} played ${labelOf(s, f)}. Two players are skipped.`, { card: f, actor: p.name });
      break;
    case "skipEveryone":
      advance = 0;
      log(s, "skip", `${p.name} played ${labelOf(s, f)}. Everyone is skipped.`, { card: f, actor: p.name });
      break;
    case "reverse":
    case "wildReverse": {
      const alive = activePlayers(s).length;
      if (alive === 2) { advance = 2; log(s, "skip", `${p.name} played ${labelOf(s, f)}, which skips in a two player game.`, { card: f, actor: p.name }); break; }
      s.direction = (s.direction * -1) as 1 | -1;
      advance = 1;
      log(s, "reverse", `${p.name} played ${labelOf(s, f)}. Order is reversed.`, { card: f, actor: p.name });
      break;
    }
    case "reverseSkip": {
      s.direction = (s.direction * -1) as 1 | -1;
      advance = 2;
      log(s, "reverse", `${p.name} flexed ${labelOf(s, f)} into Reverse Skip.`, { card: f, actor: p.name });
      break;
    }
    case "allDraw1": {
      for (const q of s.players) {
        if (q.id === p.id || q.left || q.eliminated) continue;
        drawToHand(s, q, 1, discardDraw);
      }
      log(s, "draw", `${p.name} flexed ${labelOf(s, f)}. Everyone else drew 1.`, { card: f, actor: p.name });
      break;
    }
    case "allDraw2": {
      if (chosen) s.currentColor = chosen;
      for (const q of s.players) {
        if (q.id === p.id || q.left || q.eliminated) continue;
        drawToHand(s, q, 2, discardDraw);
      }
      log(s, "draw", `${p.name} flexed ${labelOf(s, f)}. Everyone else drew 2.`, { card: f, actor: p.name });
      break;
    }
    case "targetDraw2": case "targetDraw4": {
      if (s.rules.flexWildSwap) {
        const t = target();
        if (t && t.id !== p.id) {
          const tmp = p.powerGreen; p.powerGreen = t.powerGreen; t.powerGreen = tmp;
          log(s, "flex", `${p.name} swapped power tokens with ${t.name}.`, { card: f, actor: p.name });
          break;
        }
      }
      if (chosen) s.currentColor = chosen;
      const t = target();
      if (!t || t.id === p.id || t.left || t.eliminated) return "Pick a valid target";
      drawToHand(s, t, effValue === "targetDraw2" ? 2 : 4, discardDraw);
      log(s, "draw", `${p.name} played ${labelOf(s, f)} at ${t.name} for ${effValue === "targetDraw2" ? 2 : 4}.`, { card: f, actor: p.name });
      break;
    }
    case "wildTargetDraw2": {
      const t = target();
      if (!t || t.id === p.id || t.left || t.eliminated) return "Pick a target";
      drawToHand(s, t, 2, discardDraw);
      log(s, "draw", `${p.name} played ${labelOf(s, f)} at ${t.name} for 2.`, { card: f, actor: p.name });
      if (s.rules.wildChain) {
        for (const q of s.players) {
          if (q.id === p.id || q.id === t.id || q.left || q.eliminated) continue;
          drawToHand(s, q, 1, discardDraw);
        }
        log(s, "draw", "Chain reaction: everyone else draws 1.");
      }
      break;
    }
    case "wildSwap": {
      const t = target();
      if (!t || t.id === p.id || t.left || t.eliminated) return "Pick a player to swap with";
      const tmp = p.hand; p.hand = t.hand; t.hand = tmp;
      s.unoRace = null;
      p.calledUno = false; t.calledUno = false;
      log(s, "swap", `${p.name} played ${labelOf(s, f)} and swapped hands with ${t.name}.`, { card: f, actor: p.name });
      if (s.rules.wildMayhem) {
        for (const q of s.players) {
          if (q.id === p.id || q.left || q.eliminated || q.hand.length === 0) continue;
          const idx = Math.floor(Math.random() * q.hand.length);
          s.discardPile.splice(s.discardPile.length - 1, 0, q.hand.splice(idx, 1)[0]);
        }
        log(s, "swap", "Hand dump: everyone else discards a card.");
      }
      afterHandChange(s, t);
      break;
    }
    case "draw1": case "draw2": case "draw4": case "draw5": {
      if (stackingOn(s)) {
        s.pendingDraw += drawStrength(f.value);
        s.stackValue = drawStrength(f.value);
        log(s, "stack", `${p.name} played ${labelOf(s, f)} and opened a stack at ${s.pendingDraw}.`, { card: f, actor: p.name });
      } else {
        const v = s.players[nextIdx(s, myIdx, 1)];
        drawToHand(s, v, drawStrength(f.value), discardDraw);
        log(s, "draw", `${p.name} played ${labelOf(s, f)}. ${v.name} drew ${drawStrength(f.value)} and lost the turn.`, { card: f, actor: p.name });
        advance = 2;
      }
      break;
    }
    case "wild":
      if (chosen) s.currentColor = chosen;
      log(s, "wild", s.variant === "allwild" ? `${p.name} played a Wild.` : `${p.name} played a Wild and called ${chosen}.`, { card: f, actor: p.name });
      break;
    case "wildAllFlip": {
      if (chosen) s.currentColor = chosen;
      for (const q of s.players) if (!q.left) q.powerGreen = !q.powerGreen;
      log(s, "flip", `${p.name} played Wild All Flip. Every power token flipped.`, { card: f, actor: p.name });
      maybeResetTokens(s);
      break;
    }
    case "wildDraw2": {
      if (chosen) s.currentColor = chosen;
      if (stackingOn(s)) {
        s.pendingDraw += 2; s.stackValue = 2;
        log(s, "stack", `${p.name} played ${labelOf(s, f)} and opened a stack at ${s.pendingDraw}.`, { card: f, actor: p.name });
      } else {
        const v = s.players[nextIdx(s, myIdx, 1)];
        drawToHand(s, v, 2, discardDraw);
        log(s, "draw", `${p.name} played ${labelOf(s, f)}. ${v.name} drew 2 and lost the turn.`, { card: f, actor: p.name });
        advance = 2;
      }
      break;
    }
    case "wildDraw4": {
      const prevColor = s.currentColor;
      if (chosen) s.currentColor = chosen;
      if (s.rules.challengeWild4 && s.variant !== "allwild") {
        const v = s.players[nextIdx(s, myIdx, 1)];
        const hadColor = p.hand.some((c) => !isWildFace(face(s, c)) && face(s, c).color === prevColor);
        s.challenge = { targetId: v.id, byId: p.id, legal: !hadColor };
        s.turn = { playerIdx: myIdx, stage: "play" };
        log(s, "wild", `${p.name} played Wild Draw 4 on ${v.name} and called ${chosen}.`, { card: f, actor: p.name });
        afterHandChange(s, p);
        checkLastStanding(s);
        touch(s);
        return null;
      }
      if (stackingOn(s)) {
        s.pendingDraw += 4; s.stackValue = 4;
        log(s, "stack", `${p.name} played ${labelOf(s, f)} and opened a stack at ${s.pendingDraw}.`, { card: f, actor: p.name });
      } else {
        const v = s.players[nextIdx(s, myIdx, 1)];
        drawToHand(s, v, 4, discardDraw);
        log(s, "draw", `${p.name} played ${labelOf(s, f)}. ${v.name} drew 4 and lost the turn.`, { card: f, actor: p.name });
        advance = 2;
      }
      break;
    }
    case "wildDraw6": case "wildDraw10": {
      if (chosen) s.currentColor = chosen;
      s.pendingDraw += drawStrength(f.value);
      s.stackValue = drawStrength(f.value);
      log(s, "stack", `${p.name} played ${labelOf(s, f)} and opened a stack at ${s.pendingDraw}.`, { card: f, actor: p.name });
      break;
    }
    case "wildReverseDraw4": {
      if (chosen) s.currentColor = chosen;
      s.direction = (s.direction * -1) as 1 | -1;
      s.pendingDraw += 4;
      s.stackValue = 4;
      log(s, "stack", `${p.name} played ${labelOf(s, f)}. Order reversed, stack at ${s.pendingDraw}.`, { card: f, actor: p.name });
      break;
    }
    case "wildColorRoulette": case "wildDrawColor": {
      const v = s.players[nextIdx(s, myIdx, 1)];
      const adv = effValue === "wildDrawColor" && s.rules.colorCurse ? 3 : 2;
      if (!v || v.left || v.eliminated) {
        if (chosen) s.currentColor = chosen;
        advance = adv;
        break;
      }
      // Draw Until Color is named by whoever played it. The Color Roulette is
      // named by the player who has to pull, so the color stays open for now.
      const named = effValue === "wildDrawColor" ? (chosen ?? null) : null;
      if (named) s.currentColor = named;
      s.roulette = {
        kind: effValue === "wildDrawColor" ? "wildDrawColor" : "wildColorRoulette",
        byId: p.id,
        chooserId: named ? p.id : v.id,
        pullerId: v.id,
        color: named,
        drawn: [],
        advance: adv,
        doneAt: null,
      };
      log(s, "roulette", named
        ? `${p.name} played ${labelOf(s, f)} and called ${named}. ${v.name} pulls one card at a time until ${named} turns up.`
        : `${p.name} played ${labelOf(s, f)}. ${v.name} names a color, then pulls one card at a time until it turns up.`,
        { card: f, actor: p.name });
      break;
    }
    case "flip": {
      s.side = s.side === "light" ? "dark" : "light";
      s.discardPile.reverse();
      s.drawPile.reverse();
      const newTop = topDiscard(s);
      log(s, "flip", `${p.name} played Flip. The table turned to the ${s.side} side.`, { card: f, actor: p.name });
      if (s.rules.chaosFlip) {
        rotateHands(s);
        log(s, "swap", "Chaos flip: every hand passes one seat.");
      }
      if (newTop && isWildFace(face(s, newTop))) {
        s.flipColorChoice = { playerId: p.id };
        s.turn = { playerIdx: myIdx, stage: "play" };
        afterHandChange(s, p);
        touch(s);
        return null;
      }
      if (newTop) s.currentColor = face(s, newTop).color;
      break;
    }
    case "discardAll":
      log(s, "play", `${p.name} played ${labelOf(s, f)} and dumped ${extras.length} extra ${effColor} card${extras.length === 1 ? "" : "s"}.`, { card: f, actor: p.name });
      s.currentColor = effColor;
      break;
    default: {
      if (isNumberValue(f.value)) {
        s.currentColor = effColor;
        log(s, "play", `${p.name} played ${labelOf(s, f)}.`, { card: f, actor: p.name });
        if (s.variant === "nomercy") {
          if (f.value === "7") {
            const t = target();
            if (t && t.id !== p.id && !t.left && !t.eliminated && p.hand.length > 0) {
              const tmp = p.hand; p.hand = t.hand; t.hand = tmp;
              s.unoRace = null;
              p.calledUno = false; t.calledUno = false;
              log(s, "swap", `${p.name} swapped hands with ${t.name}.`, { card: f, actor: p.name });
              afterHandChange(s, t);
            }
          } else if (f.value === "0") {
            rotateHands(s);
            log(s, "swap", "Every hand rotates one seat.");
          }
        }
      }
    }
  }

  if (!isWildFace(f) && effValue !== "flip" && !isNumberValue(f.value)) s.currentColor = effColor;
  if (s.variant === "allwild") s.lockValue = s.rules.colorLock ? f.value : null;

  // flex token bookkeeping
  if (s.variant === "flex") {
    if (wasFlipIcon) {
      p.powerGreen = !p.powerGreen;
      log(s, "flex", `${p.name} flips their token ${p.powerGreen ? "on" : "off"}.`);
    }
    if (useFlex) {
      p.powerGreen = false;
      log(s, "flex", `${p.name} spends their power token.`);
      if (s.rules.powerFlipping) {
        for (const q of s.players) if (q.id !== p.id && !q.left) q.powerGreen = false;
        log(s, "flex", "Power flipping: every other token goes red.");
      }
    }
    if (wasFlipIcon || useFlex) maybeResetTokens(s);
  }

  // no win on action
  if (p.hand.length === 0 && s.rules.noWinOnAction && isActionValue(f.value)) {
    drawToHand(s, p, 1);
    log(s, "play", `${p.name} cannot go out on an action card and draws 1.`);
  }

  afterHandChange(s, p);
  checkLastStanding(s);
  if (s.phase !== "playing") { touch(s); return null; }

  // A roulette hands the table over: first to whoever names the color, then to
  // whoever has to pull. Nothing else happens until the pull is finished.
  if (s.roulette) {
    const actingId = s.roulette.color ? s.roulette.pullerId : s.roulette.chooserId;
    s.turn = { playerIdx: idxOf(s, actingId), stage: "roulette" };
    s.turnStartedAt = now();
    touch(s);
    return null;
  }

  // double play window
  const canDouble = s.rules.doublePlay && !jumped && s.turn.stage !== "double" && p.hand.length > 0 &&
    p.hand.some((c) => {
      const cf = face(s, c);
      return (!isWildFace(f) && !isWildFace(cf) && cf.color === f.color) || cf.value === f.value;
    });
  if (canDouble) {
    s.turn = {
      playerIdx: myIdx, stage: "double",
      doubleColor: isWildFace(f) ? undefined : f.color,
      doubleValue: f.value,
      pendingAdvance: advance,
    };
    s.turnStartedAt = now();
    touch(s);
    return null;
  }

  if (s.turn.stage === "double") advance = s.turn.pendingAdvance ?? 1;
  if (advance === 0) {
    s.turn = { playerIdx: myIdx, stage: "play" };
    s.turnStartedAt = now();
    touch(s);
  } else {
    advanceTurn(s, advance);
  }
  return null;
}

export function actEndDouble(s: RoomState, playerId: string): string | null {
  if (s.turn.stage !== "double") return "Nothing to end";
  if (s.players[s.turn.playerIdx]?.id !== playerId) return "Not your turn";
  const adv = s.turn.pendingAdvance ?? 1;
  if (adv === 0) {
    s.turn = { playerIdx: s.turn.playerIdx, stage: "play" };
    s.turnStartedAt = now();
    touch(s);
  } else advanceTurn(s, adv);
  return null;
}

// ---------------------------------------------------------------- draw / pass

export function actDraw(s: RoomState, playerId: string): string | null {
  const p = findPlayer(s, playerId);
  if (!p || p.left || p.eliminated) return "Not in game";
  if (s.phase !== "playing") return "Round is over";
  if (s.challenge) return "Waiting on a challenge";
  if (s.flipColorChoice) return "Waiting on a color pick";
  if (s.roulette) return "Waiting on the color pull";
  if (s.turn.playerIdx !== idxOf(s, playerId)) return "Not your turn";
  if (s.turn.stage === "drewCard") return "Already drew";
  if (s.turn.stage === "double") return actEndDouble(s, playerId);
  clearUnoRaceFor(s, p);

  if (s.pendingDraw > 0) {
    const total = s.pendingDraw;
    s.pendingDraw = 0; s.stackValue = 0;
    drawToHand(s, p, total, s.rules.discardRoulette);
    log(s, "draw", `${p.name} took the stack and drew ${total}.`, { actor: p.name });
    afterHandChange(s, p);
    checkLastStanding(s);
    if (s.phase === "playing") advanceTurn(s, 1);
    return null;
  }

  const untilPlayable = s.variant === "nomercy" || s.rules.drawUntilPlay;
  if (untilPlayable) {
    let lastDrawn: GameCard | null = null;
    let count = 0;
    for (let g = 0; g < 120; g++) {
      const got = takeCards(s, 1, false);
      if (got.length === 0) break;
      p.hand.push(got[0]);
      p.calledUno = false;
      count++;
      lastDrawn = got[0];
      checkMercy(s, p);
      if (p.eliminated) break;
      if (canPlayCard(s, p, got[0], false)) break;
    }
    checkMercy10(s, p);
    log(s, "draw", `${p.name} drew ${count} card${count === 1 ? "" : "s"}.`, { actor: p.name });
    if (lastDrawn && !p.eliminated && p.hand.some((c) => c.id === lastDrawn!.id)) {
      s.turn = { playerIdx: idxOf(s, p.id), stage: "drewCard", drewCardId: lastDrawn.id };
      s.turnStartedAt = now();
    } else advanceTurn(s, 1);
  } else {
    const drawn = drawToHand(s, p, 1);
    log(s, "draw", `${p.name} drew a card.`, { actor: p.name });
    if (drawn[0] && p.hand.some((c) => c.id === drawn[0].id)) {
      s.turn = { playerIdx: idxOf(s, p.id), stage: "drewCard", drewCardId: drawn[0].id };
      s.turnStartedAt = now();
    } else advanceTurn(s, 1);
  }
  touch(s);
  return null;
}

export function actPass(s: RoomState, playerId: string): string | null {
  const p = findPlayer(s, playerId);
  if (!p) return "Not in game";
  if (s.phase !== "playing") return "Round is over";
  if (s.turn.playerIdx !== idxOf(s, playerId)) return "Not your turn";
  if (s.roulette) return "Waiting on the color pull";
  if (s.turn.stage === "double") return actEndDouble(s, playerId);
  if (s.turn.stage !== "drewCard") return "Nothing to pass";
  if (s.rules.forcedPlay) {
    const c = p.hand.find((x) => x.id === s.turn.drewCardId);
    if (c && canPlayCard(s, p, c, false)) return "Forced play: you must play that card";
  }
  log(s, "pass", `${p.name} passed.`, { actor: p.name });
  advanceTurn(s, 1);
  return null;
}

// ---------------------------------------------------------------- uno race

export function actUno(s: RoomState, playerId: string): string | null {
  const p = findPlayer(s, playerId);
  if (!p || p.left || p.eliminated) return "Not in game";
  const race = s.unoRace;

  if (race && now() <= race.until) {
    const target = findPlayer(s, race.playerId);
    if (target && target.id !== p.id) {
      s.unoRace = null;
      if (target.hand.length === 1 && !target.calledUno) {
        drawToHand(s, target, 2);
        target.calledUno = false;
        log(s, "catch", `${p.name} beat ${target.name} to the button. ${target.name} draws 2.`);
        checkLastStanding(s);
        touch(s);
        return null;
      }
      return "They were already safe";
    }
    if (target && target.id === p.id) {
      p.calledUno = true;
      s.unoRace = null;
      log(s, "uno", `${p.name} calls UNO in time.`);
      touch(s);
      return null;
    }
  }

  if (p.hand.length === 2 || p.hand.length === 1) {
    p.calledUno = true;
    log(s, "uno", `${p.name} calls UNO.`);
    touch(s);
    return null;
  }
  return "Nothing to call";
}

// ---------------------------------------------------------------- challenge / color

export function actChallenge(s: RoomState, playerId: string, doChallenge: boolean): string | null {
  if (!s.challenge) return "No challenge pending";
  const ch = s.challenge;
  if (ch.targetId !== playerId) return "Not your challenge";
  const target = findPlayer(s, ch.targetId)!;
  const by = findPlayer(s, ch.byId)!;
  const tIdx = idxOf(s, target.id);
  const fromDiscard = s.rules.discardRoulette;
  if (!doChallenge) {
    drawToHand(s, target, 4, fromDiscard);
    log(s, "draw", `${target.name} accepted the Draw 4 and drew 4.`, { actor: target.name });
    s.challenge = null;
    checkLastStanding(s);
    if (s.phase === "playing") { s.turn.playerIdx = tIdx; advanceTurn(s, 1); }
    return null;
  }
  s.challenge = null;
  if (ch.legal) {
    drawToHand(s, target, 6, fromDiscard);
    log(s, "challenge", `${target.name} challenged. The Draw 4 was clean, so ${target.name} drew 6.`, { actor: target.name });
  } else {
    drawToHand(s, by, 4, fromDiscard);
    log(s, "challenge", `${target.name} challenged. ${by.name} was bluffing and drew 4.`, { actor: target.name });
  }
  checkLastStanding(s);
  if (s.phase === "playing") { s.turn.playerIdx = tIdx; advanceTurn(s, 1); }
  return null;
}

export function actChooseColor(s: RoomState, playerId: string, color: ColorName): string | null {
  if (!s.flipColorChoice) return "No choice pending";
  if (s.flipColorChoice.playerId !== playerId) return "Not your choice";
  const choices = s.side === "dark" ? DARK_COLOR_NAMES : LIGHT_COLOR_NAMES;
  if (!(choices as readonly string[]).includes(color)) return "Bad color";
  s.currentColor = color;
  const p = findPlayer(s, playerId)!;
  s.flipColorChoice = null;
  log(s, "wild", `${p.name} calls ${color}.`);
  advanceTurn(s, 1);
  return null;
}

// ---------------------------------------------------------------- color roulette

/** Name the color a roulette is chasing. */
export function actRouletteColor(s: RoomState, playerId: string, color: ColorName): string | null {
  const r = s.roulette;
  if (!r) return "No roulette pending";
  if (r.color) return "The color is already named";
  if (r.chooserId !== playerId) return "Not your color to name";
  const choices = s.side === "dark" ? DARK_COLOR_NAMES : LIGHT_COLOR_NAMES;
  if (!(choices as readonly string[]).includes(color)) return "Bad color";
  const chooser = findPlayer(s, playerId);
  if (!chooser || chooser.left || chooser.eliminated) return "Not in game";

  r.color = color;
  s.currentColor = color;
  log(s, "wild", `${chooser.name} calls ${color}.`);

  const puller = findPlayer(s, r.pullerId);
  if (!puller || puller.left || puller.eliminated) { finishRoulette(s); return null; }
  s.turn = { playerIdx: idxOf(s, r.pullerId), stage: "roulette" };
  s.turnStartedAt = now();
  touch(s);
  return null;
}

/** Pull exactly one card off the pile and show it to the whole table. */
export function actRoulettePull(s: RoomState, playerId: string): string | null {
  const r = s.roulette;
  if (!r) return "Nothing to pull";
  if (r.doneAt) return "The pull is over";
  if (r.pullerId !== playerId) return "Not your pull";
  if (!r.color) return "Name a color first";
  const p = findPlayer(s, playerId);
  if (!p || p.left || p.eliminated) return "Not in game";

  clearUnoRaceFor(s, p);
  const got = takeCards(s, 1, s.rules.discardRoulette);
  if (got.length === 0) {
    log(s, "roulette", `The pile is empty. ${p.name} keeps ${r.drawn.length} card${r.drawn.length === 1 ? "" : "s"} and play moves on.`);
    finishRoulette(s);
    return null;
  }

  const card = got[0];
  p.hand.push(card);
  r.drawn.push(card);
  if (p.hand.length > 1) p.calledUno = false;
  const cf = face(s, card);
  const hit = !isWildFace(cf) && cf.color === r.color;
  log(s, "draw", `${p.name} pulls ${labelOf(s, cf)}.`, { card: cf, actor: p.name });
  checkMercy(s, p);
  checkMercy10(s, p);

  s.turn = { playerIdx: idxOf(s, p.id), stage: "roulette" };
  s.turnStartedAt = now();
  if (hit) {
    r.doneAt = now();
    log(s, "roulette", `${p.name} hit ${r.color} after ${r.drawn.length} card${r.drawn.length === 1 ? "" : "s"}.`, { card: cf, actor: p.name });
  } else if (p.eliminated || p.left) {
    r.doneAt = now();
    log(s, "roulette", `${p.name} is out of the round after ${r.drawn.length} card${r.drawn.length === 1 ? "" : "s"}.`);
  }
  checkLastStanding(s);
  touch(s);
  return null;
}

/** End a finished pull early. The table gets a moment to see the last card. */
export function actRouletteFinish(s: RoomState, playerId: string): string | null {
  const r = s.roulette;
  if (!r) return "Nothing to finish";
  const p = findPlayer(s, playerId);
  if (!p) return "Not in game";
  if (r.pullerId !== playerId && !p.isAdmin) return "Not your roulette";
  finishRoulette(s);
  return null;
}

function finishRoulette(s: RoomState) {
  const r = s.roulette;
  if (!r) return;
  s.roulette = null;
  const puller = findPlayer(s, r.pullerId);
  const alive = puller && !puller.left && !puller.eliminated;

  if (alive) {
    if (puller.hand.length !== 1) clearUnoRaceFor(s, puller);
    if (puller.hand.length === 1 && !puller.calledUno) {
      s.unoRace = { playerId: puller.id, until: now() + UNO_WINDOW_MS };
    }
  }
  if (s.phase !== "playing") { touch(s); return; }

  // The advance was counted from whoever played the card, so hand the turn back
  // to them first; nextIdx steps over anyone who is out of the round.
  s.turn = { playerIdx: idxOf(s, r.byId), stage: "play" };
  s.turnStartedAt = now();
  advanceTurn(s, Math.max(1, r.advance));
  touch(s);
}

// ---------------------------------------------------------------- admin

export function actKick(s: RoomState, actorId: string, targetId: string): string | null {
  const t = findPlayer(s, targetId);
  const actor = findPlayer(s, actorId);
  if (!t) return "No such player";
  if (t.isOwner) return "The owner cannot be removed";
  if (!(actor?.isAdmin) || actor.left) return "Not allowed";
  removePlayer(s, t, `${t.name} was removed.`);
  return null;
}

export function actLeave(s: RoomState, playerId: string): string | null {
  const p = findPlayer(s, playerId);
  if (!p) return null;
  removePlayer(s, p, `${p.name} left.`);
  if (!s.players.some((q) => q.isOwner && !q.left)) {
    const heir = s.players.find((q) => !q.left && !q.isBot);
    if (heir) {
      heir.isOwner = true;
      heir.isAdmin = true;
      log(s, "admin", `${heir.name} is now the owner.`);
    }
  }
  return null;
}

export function removePlayer(s: RoomState, t: PlayerState, msg: string) {
  if (s.phase === "lobby") {
    s.players = s.players.filter((p) => p.id !== t.id);
  } else {
    t.left = true;
    t.connected = false;
    s.setAside.push(...t.hand);
    t.hand = [];
    const rouletteMine = s.roulette && (s.roulette.pullerId === t.id || s.roulette.chooserId === t.id);
    if (s.turn.playerIdx === idxOf(s, t.id)) advanceTurn(s, 1);
    if (s.challenge?.targetId === t.id) s.challenge = null;
    if (rouletteMine && s.roulette) {
      // nobody is left to pull, so the card resolves the way it would have
      const r = s.roulette;
      s.roulette = null;
      if (s.phase === "playing") {
        s.turn = { playerIdx: idxOf(s, r.byId), stage: "play" };
        advanceTurn(s, r.advance || 2);
      }
    }
    if (s.flipColorChoice?.playerId === t.id) {
      const top = topDiscard(s);
      const c = top ? face(s, top).color : s.currentColor;
      s.currentColor = c === "wild" ? "red" : c;
      s.flipColorChoice = null;
    }
    if (s.unoRace?.playerId === t.id) s.unoRace = null;
    checkLastStanding(s);
  }
  log(s, "leave", msg);
  touch(s);
}

export function actRename(s: RoomState, actorId: string, targetId: string, name: string): string | null {
  const actor = findPlayer(s, actorId);
  const t = findPlayer(s, targetId);
  if (!actor || !t) return "No such player";
  if (actor.id !== t.id && !actor.isAdmin) return "Not allowed";
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 14);
  if (!clean) return "Empty name";
  log(s, "rename", `${t.name} is now ${clean}.`);
  t.name = clean;
  touch(s);
  return null;
}

export function actSetAdmin(s: RoomState, actorId: string, targetId: string, admin: boolean): string | null {
  const actor = findPlayer(s, actorId);
  const t = findPlayer(s, targetId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (!t) return "No such player";
  if (t.isOwner) return admin ? null : "The owner keeps admin";
  t.isAdmin = admin;
  log(s, "admin", `${t.name} ${admin ? "is now an admin" : "is no longer an admin"}.`);
  touch(s);
  return null;
}

export function actSkipTurn(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "playing") return "Not playing";
  const cur = s.players[s.turn.playerIdx];
  if (s.challenge) {
    const t = findPlayer(s, s.challenge.targetId)!;
    drawToHand(s, t, 4);
    const tIdx = idxOf(s, t.id);
    s.challenge = null;
    s.turn.playerIdx = tIdx;
    log(s, "skip", `Admin resolved the challenge. ${t.name} draws 4.`);
    advanceTurn(s, 1);
    return null;
  }
  if (s.flipColorChoice) {
    s.flipColorChoice = null;
    s.currentColor = s.side === "dark" ? "pink" : "red";
    log(s, "skip", "Admin resolved the color pick.");
    advanceTurn(s, 1);
    return null;
  }
  if (s.roulette) {
    const r = s.roulette;
    const puller = findPlayer(s, r.pullerId);
    if (!r.color) s.currentColor = s.side === "dark" ? "pink" : "red";
    log(s, "skip", `Admin called the pull off${puller ? ` and ${puller.name} kept ${r.drawn.length} card${r.drawn.length === 1 ? "" : "s"}` : ""}.`);
    finishRoulette(s);
    return null;
  }
  if (s.pendingDraw > 0) {
    const total = s.pendingDraw;
    s.pendingDraw = 0; s.stackValue = 0;
    drawToHand(s, cur, total);
    log(s, "skip", `Admin skipped ${cur.name}, who takes the ${total}.`);
  } else {
    log(s, "skip", `Admin skipped ${cur.name}.`);
  }
  checkLastStanding(s);
  if (s.phase === "playing") advanceTurn(s, 1);
  return null;
}

export function actEndRound(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "playing") return "Not playing";
  const alive = activePlayers(s);
  if (alive.length === 0) return "Nobody left";
  const winner = alive.slice().sort((a, b) => a.hand.length - b.hand.length)[0];
  endRound(s, winner.id, "Ended early by an admin.");
  return null;
}

export function actNextRound(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "roundOver") return "Round is still running";
  s.dealerIdx = (s.dealerIdx + 1) % s.players.length;
  startRound(s);
  return null;
}

export function actBackToLobby(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor) return "No such player";
  if (s.phase !== "gameOver" && s.phase !== "roundOver") return "Game is running";
  if (!actor.isAdmin) return "Not allowed";
  s.players = s.players.filter((p) => !p.left);
  for (const p of s.players) { p.score = 0; p.hand = []; p.eliminated = false; }
  s.phase = "lobby";
  s.dealerIdx = 0;
  log(s, "leave", "Back to the lobby.");
  touch(s);
  return null;
}

// ---------------------------------------------------------------- lobby

export function actSetVariant(s: RoomState, actorId: string, variant: Variant): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "lobby") return "Game already started";
  const wasDefault = s.rules.pointGoal === VARIANT_META[s.variant].target;
  s.variant = variant;
  if (wasDefault) s.rules.pointGoal = VARIANT_META[variant].target;
  log(s, "variant", `Mode set to ${VARIANT_META[variant].name}.`);
  touch(s);
  return null;
}

export function actSetRule(s: RoomState, actorId: string, key: string, value: boolean | number): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "lobby") return "Rules lock once the game starts";
  if (!(key in s.rules)) return "Unknown rule";
  if (key === "turnTimer") {
    s.rules.turnTimer = Math.max(0, Math.min(120, Number(value) || 0));
  } else if (key === "pointGoal") {
    s.rules.pointGoal = Math.max(0, Math.min(9999, Number(value) || 0));
  } else {
    (s.rules as unknown as Record<string, boolean>)[key] = !!value;
  }
  touch(s);
  return null;
}

export function actAddBot(s: RoomState, actorId: string): PlayerState | string {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "lobby") return "Game already started";
  if (s.players.length >= MAX_PLAYERS) return "Room is full";
  return addPlayer(s, botName(s), true);
}

export function actRemoveBot(s: RoomState, actorId: string, botId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "lobby") return "Game already started";
  const t = findPlayer(s, botId);
  if (!t || !t.isBot) return "Not a bot";
  s.players = s.players.filter((p) => p.id !== t.id);
  log(s, "leave", `${t.name} removed.`);
  touch(s);
  return null;
}

export function actChat(s: RoomState, playerId: string, text: string): string | null {
  const p = findPlayer(s, playerId);
  if (!p || p.left) return "Not in room";
  if (!s.chatOn) return "Chat is off";
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return null;
  const last = s.chat[s.chat.length - 1];
  if (last && last.playerId === p.id && last.text === clean && now() - last.at < 1500) return null;
  s.chatSeq += 1;
  s.chat.push({ id: s.chatSeq, playerId: p.id, name: p.name, text: clean, at: now() });
  if (s.chat.length > 200) s.chat = s.chat.slice(-200);
  touch(s);
  return null;
}

export function actSetChat(s: RoomState, actorId: string, on: boolean): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  s.chatOn = on;
  s.chatSeq += 1;
  s.chat.push({ id: s.chatSeq, playerId: "", name: "", text: on ? "Chat was turned on." : "Chat was turned off.", at: now(), system: true });
  touch(s);
  return null;
}

export function actClearChat(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  s.chat = [];
  s.chatSeq += 1;
  s.chat.push({ id: s.chatSeq, playerId: "", name: "", text: "Chat was cleared.", at: now(), system: true });
  touch(s);
  return null;
}

export function actReorder(s: RoomState, actorId: string, order: string[]): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "lobby") return "Order locks once the game starts";
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const next: PlayerState[] = [];
  for (const id of order) {
    const p = byId.get(id);
    if (p && !next.includes(p)) next.push(p);
  }
  for (const p of s.players) if (!next.includes(p)) next.push(p);
  s.players = next;
  touch(s);
  return null;
}

export function actShuffleSeats(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Not allowed";
  if (s.phase !== "lobby") return "Order locks once the game starts";
  s.players = shuffled(s.players);
  log(s, "order", "Seating order shuffled.");
  touch(s);
  return null;
}

export function actStart(s: RoomState, actorId: string): string | null {
  const actor = findPlayer(s, actorId);
  if (!actor?.isAdmin || actor.left) return "Only an admin can start";
  if (s.phase !== "lobby") return "Already started";
  const seated = s.players.filter((p) => !p.left);
  if (seated.length < 2) return "Need at least 2 players";
  for (const p of seated) p.score = 0;
  s.dealerIdx = 0;
  log(s, "start", `${actor.name} started the game.`);
  startRound(s);
  return null;
}

// ---------------------------------------------------------------- bots

function colorModes(hand: GameCard[], s: RoomState): ColorName {
  const counts = new Map<ColorName, number>();
  for (const c of hand) {
    const f = face(s, c);
    if (!isWildFace(f)) counts.set(f.color, (counts.get(f.color) ?? 0) + 1);
  }
  let best: ColorName = s.side === "dark" ? "pink" : "red";
  let bestN = -1;
  for (const [k, v] of counts) if (v > bestN) { best = k; bestN = v; }
  return best;
}

function botTarget(s: RoomState, p: PlayerState): string | undefined {
  const others = s.players.filter((q) => q.id !== p.id && !q.left && !q.eliminated);
  others.sort((a, b) => a.hand.length - b.hand.length);
  return others[0]?.id;
}

export function botAct(s: RoomState, bot: PlayerState) {
  const myIdx = idxOf(s, bot.id);

  if (s.challenge && s.challenge.targetId === bot.id) {
    actChallenge(s, bot.id, Math.random() < 0.35);
    return;
  }
  if (s.flipColorChoice && s.flipColorChoice.playerId === bot.id) {
    actChooseColor(s, bot.id, colorModes(bot.hand, s));
    return;
  }
  if (s.roulette) {
    const r = s.roulette;
    if (r.doneAt) return;
    if (!r.color) {
      if (r.chooserId === bot.id) actRouletteColor(s, bot.id, colorModes(bot.hand, s));
      return;
    }
    if (r.pullerId === bot.id) actRoulettePull(s, bot.id);
    return;
  }
  if (s.turn.playerIdx !== myIdx) return;

  if (s.turn.stage === "double") {
    const opts = bot.hand.filter((c) => {
      const cf = face(s, c);
      return cf.color === s.turn.doubleColor || cf.value === s.turn.doubleValue;
    });
    if (opts.length > 0 && Math.random() < 0.8) {
      playCardAsBot(s, bot, opts[0], false);
      return;
    }
    actEndDouble(s, bot.id);
    return;
  }

  if (s.turn.stage === "drewCard") {
    const card = bot.hand.find((c) => c.id === s.turn.drewCardId);
    if (card && canPlayCard(s, bot, card, false)) { playCardAsBot(s, bot, card, false); return; }
    actPass(s, bot.id);
    return;
  }

  const moves = playableMoves(s, bot);
  if (moves.length === 0) { actDraw(s, bot.id); return; }
  if (s.pendingDraw > 0 && Math.random() < 0.2) { actDraw(s, bot.id); return; }

  const minOpp = Math.min(...s.players.filter((q) => q.id !== bot.id && !q.left && !q.eliminated).map((q) => q.hand.length).concat([99]));
  const aggressive = minOpp <= 2;
  const score = (m: { card: GameCard; flex: boolean }): number => {
    const f = face(s, m.card);
    if (s.pendingDraw > 0) return -drawStrength(f.value);
    let v = 0;
    if (isWildFace(f)) v += aggressive ? 1 : 4;
    else if (isNumberValue(f.value)) v += aggressive ? 3 : 1;
    else v += 2;
    if (m.flex) v += 1.5;
    return v;
  };
  moves.sort((a, b) => score(a) - score(b));
  const pick = moves[0];
  playCardAsBot(s, bot, pick.card, pick.flex);
}

function playCardAsBot(s: RoomState, bot: PlayerState, card: GameCard, useFlex: boolean) {
  const f = face(s, card);
  const eff = useFlex && card.flexValue ? card.flexValue : f.value;
  // a color roulette is named by the victim, not by the bot playing it
  const needsColor = isWildFace(f) && s.variant !== "allwild" && eff !== "wildSwap" &&
    eff !== "wildTargetDraw2" && eff !== "wildColorRoulette";
  const needsTarget =
    eff === "targetDraw2" || eff === "targetDraw4" || eff === "wildTargetDraw2" || eff === "wildSwap" ||
    (eff === "7" && s.variant === "nomercy") ||
    (eff === "skip" && s.rules.targetedSkip);
  if (bot.hand.length === 2 && !bot.calledUno) {
    bot.calledUno = true;
    log(s, "uno", `${bot.name} calls UNO.`);
  }
  actPlay(s, bot.id, card.id, {
    color: needsColor ? colorModes(bot.hand, s) : undefined,
    targetId: needsTarget ? botTarget(s, bot) : undefined,
    useFlex,
  });
}

const catchMemory = new Map<string, number>();

function maybeBotCatch(s: RoomState): boolean {
  const race = s.unoRace;
  if (!race) return false;
  if (now() > race.until) { s.unoRace = null; return true; }
  const key = `${race.playerId}:${race.until}`;
  if (catchMemory.has(key)) return false;
  // give humans a moment before bots pounce
  if (now() - (race.until - UNO_WINDOW_MS) < 1200) return false;
  const bots = s.players.filter((p) => p.isBot && !p.left && !p.eliminated && p.id !== race.playerId);
  if (bots.length === 0) return false;
  catchMemory.set(key, 1);
  if (catchMemory.size > 400) catchMemory.clear();
  const target = findPlayer(s, race.playerId);
  if (target?.isBot) {
    // bots cover for themselves most of the time
    if (Math.random() < 0.7) { target.calledUno = true; s.unoRace = null; log(s, "uno", `${target.name} calls UNO.`); return true; }
  }
  if (Math.random() < 0.55) {
    const b = bots[Math.floor(Math.random() * bots.length)];
    actUno(s, b.id);
    return true;
  }
  return false;
}

export function tick(s: RoomState): boolean {
  let changed = false;
  for (const p of s.players) {
    if (!p.isBot && !p.left && p.connected && now() - p.lastSeen > 30000) {
      p.connected = false;
      changed = true;
    }
  }
  if (maybeBotCatch(s)) changed = true;

  for (let guard = 0; guard < 5; guard++) {
    const elapsed = now() - s.lastActionAt;

    // a finished pull clears itself once the table has seen the last card
    if (s.roulette?.doneAt && now() - s.roulette.doneAt >= ROULETTE_HOLD_MS) {
      finishRoulette(s);
      changed = true;
      continue;
    }

    if (s.phase === "playing" && s.rules.turnTimer > 0 && !s.challenge && !s.flipColorChoice) {
      const cur = s.players[s.turn.playerIdx];
      if (cur && !cur.isBot && now() - s.turnStartedAt > s.rules.turnTimer * 1000) {
        if (s.roulette) {
          // a stalled pull still has to move: pick for them, then pull for them
          const r = s.roulette;
          if (!r.color) {
            if (r.chooserId === cur.id) actRouletteColor(s, cur.id, colorModes(cur.hand, s));
          } else if (!r.doneAt && r.pullerId === cur.id) {
            actRoulettePull(s, cur.id);
            s.turnStartedAt = now();
          }
          changed = true;
          continue;
        }
        if (s.pendingDraw > 0) {
          const total = s.pendingDraw;
          s.pendingDraw = 0; s.stackValue = 0;
          drawToHand(s, cur, total);
          log(s, "timer", `${cur.name} ran out of time and takes the ${total}.`);
        } else {
          drawToHand(s, cur, 1);
          log(s, "timer", `${cur.name} ran out of time and draws 1.`);
        }
        checkLastStanding(s);
        if (s.phase === "playing") advanceTurn(s, 1);
        changed = true;
        continue;
      }
    }

    if (s.phase === "playing" && elapsed >= BOT_DELAY_MS) {
      if (s.challenge) {
        const t = findPlayer(s, s.challenge.targetId);
        if (t?.isBot) { botAct(s, t); changed = true; continue; }
      } else if (s.flipColorChoice) {
        const t = findPlayer(s, s.flipColorChoice.playerId);
        if (t?.isBot) { botAct(s, t); changed = true; continue; }
      } else if (s.roulette) {
        // bots name the color and then pull at one card per bot tick, so the
        // whole table watches the pile turn over
        const r = s.roulette;
        if (!r.doneAt) {
          const t = findPlayer(s, r.color ? r.pullerId : r.chooserId);
          if (t?.isBot) { botAct(s, t); changed = true; continue; }
        }
      } else {
        const cur = s.players[s.turn.playerIdx];
        if (cur?.isBot && !cur.left && !cur.eliminated) { botAct(s, cur); changed = true; continue; }
      }
    }

    // a finished round waits for an admin, it never deals itself
    break;
  }
  return changed;
}

// ---------------------------------------------------------------- views

export function buildView(s: RoomState, forPlayerId: string | null, version: number, sinceSeq: number) {
  const me = forPlayerId ? findPlayer(s, forPlayerId) : null;
  const flip = s.variant === "flip";
  const top = topDiscard(s);
  const race = s.unoRace && now() <= s.unoRace.until ? s.unoRace : null;

  const players = s.players.map((p) => {
    const mine = me && p.id === me.id;
    const base: Record<string, unknown> = {
      id: p.id, name: p.name, isBot: p.isBot, isOwner: p.isOwner, isAdmin: p.isAdmin,
      connected: p.connected, left: p.left, eliminated: p.eliminated,
      cardCount: p.hand.length, score: p.score, wins: p.wins,
      powerGreen: p.powerGreen,
      isTurn: s.phase === "playing" && s.players[s.turn.playerIdx]?.id === p.id,
    };
    if (mine) {
      const canAct = s.phase === "playing" && !s.challenge && !s.flipColorChoice && !s.roulette &&
        s.players[s.turn.playerIdx]?.id === p.id;
      base.hand = p.hand.map((c) => {
        const inDouble = s.turn.stage === "double";
        const cf = face(s, c);
        const doubleOk = inDouble && (cf.color === s.turn.doubleColor || cf.value === s.turn.doubleValue);
        const normal = canAct && !inDouble && (s.turn.stage === "play" || s.turn.drewCardId === c.id) && canPlayCard(s, p, c, false);
        return {
          id: c.id, light: c.light, dark: c.dark ?? null,
          flexColor: c.flexColor ?? null, flexValue: c.flexValue ?? null, flipIcon: !!c.flipIcon,
          playable: !!(canAct && (inDouble ? doubleOk : normal)),
          flexPlayable: !!(canAct && !inDouble && s.turn.stage === "play" && s.variant === "flex" &&
            p.powerGreen && !canPlayCard(s, p, c, false) && canPlayCard(s, p, c, true)),
          flexUpgradable: !!(canAct && s.variant === "flex" && p.powerGreen && c.flexValue && canPlayCard(s, p, c, false)),
        };
      });
    } else if (flip && s.phase !== "lobby") {
      base.otherSide = p.hand.map((c) => (s.side === "dark" ? c.light : c.dark ?? c.light));
    }
    return base;
  });

  const drawBackTop = s.drawPile[s.drawPile.length - 1];
  return {
    phase: s.phase,
    variant: s.variant,
    rules: s.rules,
    round: s.round,
    side: s.side,
    direction: s.direction,
    currentColor: s.currentColor,
    pendingDraw: s.pendingDraw,
    stackValue: s.stackValue,
    lockValue: s.lockValue ?? null,
    targetScore: s.rules.pointGoal,
    meId: me?.id ?? null,
    iAmAdmin: !!(me?.isAdmin),
    iAmOwner: !!(me?.isOwner),
    players,
    drawCount: s.drawPile.length,
    discardCount: s.discardPile.length,
    topCard: top ? { id: top.id, light: top.light, dark: top.dark ?? null, flexColor: top.flexColor ?? null, flexValue: top.flexValue ?? null, flipIcon: !!top.flipIcon } : null,
    drawTopBackSide: drawBackTop ? (s.side === "dark" ? drawBackTop.light : (drawBackTop.dark ?? drawBackTop.light)) : null,
    challenge: s.challenge ? { targetId: s.challenge.targetId, byId: s.challenge.byId, byName: findPlayer(s, s.challenge.byId)?.name } : null,
    flipColorChoice: s.flipColorChoice ? { playerId: s.flipColorChoice.playerId } : null,
    roulette: s.roulette ? {
      kind: s.roulette.kind,
      byId: s.roulette.byId,
      byName: findPlayer(s, s.roulette.byId)?.name ?? "",
      chooserId: s.roulette.chooserId,
      chooserName: findPlayer(s, s.roulette.chooserId)?.name ?? "",
      pullerId: s.roulette.pullerId,
      pullerName: findPlayer(s, s.roulette.pullerId)?.name ?? "",
      color: s.roulette.color,
      // every card pulled is public: the table watches the pile turn over
      drawn: s.roulette.drawn.map((c) => ({
        id: c.id, light: c.light, dark: c.dark ?? null,
        flexColor: c.flexColor ?? null, flexValue: c.flexValue ?? null, flipIcon: !!c.flipIcon,
      })),
      done: !!s.roulette.doneAt,
    } : null,
    unoRace: null,
    turnStage: s.turn.stage,
    drewCardId: s.turn.drewCardId ?? null,
    turnMsLeft: s.rules.turnTimer > 0 && s.phase === "playing"
      ? Math.max(0, s.rules.turnTimer * 1000 - (now() - s.turnStartedAt)) : null,
    roundWinnerId: s.roundWinnerId ?? null,
    roundNote: s.roundNote ?? "",
    scoresAtRound: s.scoresAtRound,
    events: s.events.filter((e) => e.seq > sinceSeq),
    logTail: s.events.slice(-120),
    chat: s.chat.slice(-80),
    chatOn: s.chatOn,
    lastSeq: s.seq,
    serverNow: now(),
    version,
  };
}
