import {
  addPlayer, actPlay, actDraw, actPass, actUno, actChallenge,
  tick, actChooseColor, actEndDouble, actReorder, actShuffleSeats, actChat, actSetChat, actClearChat, startRound, buildView, createRoomState, addPlayer as _addP, RoomState,
  actRouletteColor, actRoulettePull, actRouletteFinish, ROULETTE_HOLD_MS,
  actSetSpectate, actStart,
} from "../src/lib/game/engine";
import { GameCard, Face, Variant, buildAllWildDeck, buildFlipDeck, buildFlexDeck } from "../src/lib/game/model";
import { dispatchGameCommand } from "../src/lib/game/dispatch";
import { setHost } from "../src/lib/game/engine";
import { pickHost, hostShouldChange, isBetterHost, isNewerState, PRESENCE_TTL_MS, type HostCandidate } from "../src/lib/host";

let failures = 0;
function ok(cond: boolean, msg: string) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

function mk(light: Partial<Face>, extra: Partial<GameCard> = {}): GameCard {
  return {
    id: "t" + Math.random().toString(36).slice(2, 9),
    light: { color: light.color ?? "red", value: light.value ?? "5" },
    ...extra,
  } as GameCard;
}

function rig(names: string[], variant: Variant, rules: Record<string, unknown> = {}): RoomState {
  const s = createRoomState(variant);
  names.forEach((n) => addPlayer(s, n, false));
  Object.assign(s.rules, rules);
  s.phase = "playing";
  s.discardPile = [mk({ color: "red", value: "5" })];
  s.drawPile = Array.from({ length: 50 }, () => mk({ color: "green", value: "6" }));
  s.currentColor = "red";
  s.turn = { playerIdx: 0, stage: "play" };
  s.turnStartedAt = Date.now();
  return s;
}

// ---------------- deck sizes
ok(buildAllWildDeck().length === 112, "all wild deck is 112 cards");
ok(buildFlipDeck().length === 112, "flip deck is 112 cards");
ok(buildFlexDeck().length === 104, "flex deck is 104 draw cards plus 8 tokens");
{
  const fx = buildFlexDeck();
  const colored = fx.filter((c) => c.light.color !== "wild");
  ok(colored.filter((c) => c.flexColor).length === 32, "one flex number per value per color");
  ok(colored.filter((c) => c.flexValue).length === 12, "one flex action per type per color");
  ok(colored.filter((c) => c.flexValue && c.flexColor).length === 0, "flex action cards carry a single color");
  ok(fx.filter((c) => c.flipIcon).length === 16, "sixteen flip icon numbers");
  ok(fx.filter((c) => c.light.value === "wildAllFlip").length === 6, "six Wild All Flip cards");
}
ok(buildAllWildDeck().every((c) => c.light.color === "wild"), "every all wild card is wild");

// ---------------- all wild: anything plays, swap and skip two work
{
  const s = rig(["A", "B", "C"], "allwild");
  const a = s.players[0], b = s.players[1], c = s.players[2];
  const swap = mk({ color: "wild", value: "wildSwap" });
  a.hand = [swap, mk({ color: "wild", value: "wildSkipTwo" })];
  b.hand = [mk({ color: "wild", value: "wild" }), mk({ color: "wild", value: "wild" })];
  c.hand = [mk({ color: "wild", value: "wild" })];
  ok(actPlay(s, a.id, swap.id, { targetId: b.id }) === null, "all wild: forced swap plays");
  ok(a.hand.length === 2 && b.hand.length === 1, "forced swap exchanged hands");
  const st = s.players[s.turn.playerIdx];
  ok(st.id === b.id, "turn moved on after swap");
}
{
  const s = rig(["A", "B", "C", "D"], "allwild");
  const a = s.players[0];
  const st = mk({ color: "wild", value: "wildSkipTwo" });
  a.hand = [st, mk({ color: "wild", value: "wild" })];
  s.players.slice(1).forEach((p) => (p.hand = [mk({ color: "wild", value: "wild" })]));
  actPlay(s, a.id, st.id, {});
  ok(s.players[s.turn.playerIdx].id === s.players[3].id, "skip two jumps over two players");
}

// ---------------- house rule: subtype lock
{
  const s = rig(["A", "B"], "allwild", { colorLock: true });
  const a = s.players[0], b = s.players[1];
  const sk = mk({ color: "wild", value: "wildSkip" });
  a.hand = [sk, mk({ color: "wild", value: "wild" })];
  b.hand = [mk({ color: "wild", value: "wildDraw2" }), mk({ color: "wild", value: "wildSkip" })];
  actPlay(s, a.id, sk.id, {});
  s.turn = { playerIdx: 1, stage: "play" };
  ok(actPlay(s, b.id, b.hand[0].id, {}) !== null, "subtype lock blocks a mismatched card");
  ok(actPlay(s, b.id, b.hand[1].id, {}) === null, "subtype lock allows the same subtype");
}

// ---------------- house rule: stacking in classic
{
  const s = rig(["A", "B"], "classic", { stacking: true });
  const a = s.players[0], b = s.players[1];
  const d2 = mk({ color: "red", value: "draw2" });
  a.hand = [d2, mk({ color: "red", value: "1" })];
  b.hand = [mk({ color: "blue", value: "draw2" }), mk({ color: "green", value: "3" })];
  actPlay(s, a.id, d2.id, {});
  ok(s.pendingDraw === 2, "classic stacking opens a pending draw");
  ok(actPlay(s, b.id, b.hand[0].id, {}) === null && s.pendingDraw === 4, "classic stacking adds up");
}

// ---------------- house rule: jump in
{
  const s = rig(["A", "B", "C"], "classic", { jumpIn: true });
  const a = s.players[0], c = s.players[2];
  a.hand = [mk({ color: "red", value: "3" }), mk({ color: "red", value: "8" })];
  c.hand = [mk({ color: "red", value: "3" }), mk({ color: "blue", value: "9" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(actPlay(s, c.id, c.hand[0].id, {}) === null, "jump in with an identical card succeeds");
  ok(c.hand.length === 1, "jumped card left the hand");
}

// ---------------- house rule: no win on action
{
  const s = rig(["A", "B"], "classic", { noWinOnAction: true });
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "skip" })];
  b.hand = [mk({ color: "blue", value: "2" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(a.hand.length === 1, "cannot go out on an action card, drew a penalty");
  ok(s.phase === "playing", "round continues");
}

// ---------------- house rule: forced play
{
  const s = rig(["A", "B"], "classic", { forcedPlay: true });
  const a = s.players[0];
  a.hand = [mk({ color: "blue", value: "9" })];
  s.drawPile = [mk({ color: "red", value: "2" })];
  actDraw(s, a.id);
  ok(actPass(s, a.id) !== null, "forced play blocks passing on a playable draw");
}

// ---------------- house rule: double play
{
  const s = rig(["A", "B"], "classic", { doublePlay: true });
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "4" }), mk({ color: "red", value: "8" }), mk({ color: "blue", value: "1" })];
  b.hand = [mk({ color: "green", value: "2" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(s.turn.stage === "double" && s.players[s.turn.playerIdx].id === a.id, "double play opens a second window");
  ok(actPlay(s, a.id, a.hand[0].id, {}) === null && a.hand.length === 1, "second card of the same color plays");
  ok(s.players[s.turn.playerIdx].id === b.id, "turn moves on after the double");
}

// ---------------- house rule: targeted skip
{
  const s = rig(["A", "B", "C"], "classic", { targetedSkip: true });
  const a = s.players[0], c = s.players[2];
  a.hand = [mk({ color: "red", value: "skip" }), mk({ color: "red", value: "2" })];
  s.players.slice(1).forEach((p) => (p.hand = [mk({ color: "blue", value: "1" }), mk({ color: "blue", value: "4" })]));
  actPlay(s, a.id, a.hand[0].id, { targetId: c.id });
  ok(s.skipOnce.includes(c.id), "targeted skip marked the chosen player");
  ok(s.players[s.turn.playerIdx].id === s.players[1].id, "next player still takes their turn");
}

// ---------------- house rule: reverse reflect
{
  const s = rig(["A", "B", "C"], "nomercy", { reverseReflect: true });
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "draw2" }), mk({ color: "red", value: "1" })];
  b.hand = [mk({ color: "blue", value: "reverse" }), mk({ color: "blue", value: "7" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(s.pendingDraw === 2, "penalty pending on B");
  actPlay(s, b.id, b.hand[0].id, {});
  ok(s.pendingDraw === 2 && s.players[s.turn.playerIdx].id === a.id, "reverse reflected the penalty to the attacker");
}

// ---------------- house rule: power flipping (flex)
{
  const s = rig(["A", "B", "C"], "flex", { powerFlipping: true });
  const a = s.players[0];
  s.currentColor = "blue";
  s.discardPile = [mk({ color: "blue", value: "7" })];
  const fx = mk({ color: "green", value: "4" }, { flexColor: "blue" });
  a.hand = [fx, mk({ color: "red", value: "2" })];
  actPlay(s, a.id, fx.id, { useFlex: true });
  ok(s.players.every((p) => !p.powerGreen) || s.players.every((p) => p.powerGreen),
    "power flipping drains every token (then may auto reset)");
}

// ---------------- house rule: chaos flip
{
  const s = rig(["A", "B", "C"], "flip", { chaosFlip: true });
  const a = s.players[0], b = s.players[1], c = s.players[2];
  const fl = mk({ color: "red", value: "flip" }, { dark: { color: "pink", value: "flip" } });
  a.hand = [fl, mk({ color: "red", value: "1" }, { dark: { color: "teal", value: "4" } })];
  b.hand = [mk({ color: "blue", value: "2" }, { dark: { color: "pink", value: "5" } })];
  c.hand = [mk({ color: "green", value: "3" }, { dark: { color: "orange", value: "6" } })];
  s.discardPile = [mk({ color: "yellow", value: "2" }, { dark: { color: "purple", value: "9" } }), mk({ color: "red", value: "5" }, { dark: { color: "orange", value: "1" } })];
  actPlay(s, a.id, fl.id, {});
  ok(s.side === "dark", "chaos flip still flips the side");
  ok(b.hand.length === 1 && c.hand.length === 1, "hands were passed along");
}

// ---------------- uno race: self call wins
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "9" }), mk({ color: "red", value: "4" })];
  b.hand = [mk({ color: "green", value: "3" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(!!s.unoRace && s.unoRace.playerId === a.id, "uno race opened on A");
  ok(actUno(s, a.id) === null && a.calledUno && !s.unoRace, "A pressed first and is protected");
  ok(a.hand.length === 1, "no penalty for the fast caller");
}

// ---------------- uno race: opponent wins the race
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "9" }), mk({ color: "red", value: "4" })];
  b.hand = [mk({ color: "green", value: "3" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(actUno(s, b.id) === null, "B pressed first");
  ok(a.hand.length === 3, "A was penalised two cards, got " + a.hand.length);
  ok(!s.unoRace, "race closed");
}

// ---------------- uno pre-arm at two cards
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "9" }), mk({ color: "red", value: "4" })];
  b.hand = [mk({ color: "green", value: "3" }), mk({ color: "green", value: "5" }), mk({ color: "green", value: "7" })];
  actUno(s, a.id);
  actPlay(s, a.id, a.hand[0].id, {});
  ok(!s.unoRace, "pre-armed call means no race window");
  ok(actUno(s, b.id) !== null && a.hand.length === 1, "opponent cannot punish a pre-armed player");
}

// ---------------- turn timer config carries through
{
  const s = rig(["A", "B"], "classic", { turnTimer: 15 });
  ok(s.rules.turnTimer === 15, "turn timer stored on the room");
}

// ---------------- seat reorder and shuffle
{
  const s = createRoomState("classic");
  ["A","B","C","D"].forEach((n) => addPlayer(s, n, false));
  const ids = s.players.map((p) => p.id);
  const owner = s.players[0].id;
  actReorder(s, owner, [ids[3], ids[1], ids[0], ids[2]]);
  ok(s.players.map((p) => p.id).join() === [ids[3], ids[1], ids[0], ids[2]].join(), "manual reorder applied");
  actShuffleSeats(s, owner);
  ok(s.players.length === 4, "shuffle keeps every seat");
}

// ---------------- random order each turn keeps the right player up next
{
  const s = rig(["A", "B", "C", "D"], "classic", { randomOrder: true });
  s.players.forEach((p) => (p.hand = [mk({ color: "red", value: "3" }), mk({ color: "red", value: "8" })]));
  const a = s.players[0];
  const expectNext = s.players[1].id;
  actPlay(s, a.id, a.hand[0].id, {});
  ok(s.players[s.turn.playerIdx].id === expectNext, "random order still hands the turn to the correct player");
  ok(s.players.length === 4, "random order keeps every seat");
}

// ---------------- a successful uno call is public, everything else stays hidden
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "9" }), mk({ color: "red", value: "4" })];
  b.hand = [mk({ color: "green", value: "3" })];
  actPlay(s, a.id, a.hand[0].id, {});
  const v = buildView(s, b.id, 1, 0) as Record<string, unknown>;
  ok(v.unoRace === null, "view never exposes an open uno race");
  const pl = (v.players as Record<string, unknown>[]).find((x) => x.id === a.id)!;
  ok(pl.calledUno === false, "a player who has not called is not flagged as safe");
  ok(!("vulnerable" in pl), "view never exposes a vulnerability flag");
  ok(!(v.events as {type:string}[]).some((e) => e.type === "uno"), "uno calls stay out of the log");

  actUno(s, a.id);
  const v2 = buildView(s, b.id, 1, 0) as Record<string, unknown>;
  const pl2 = (v2.players as Record<string, unknown>[]).find((x) => x.id === a.id)!;
  ok(pl2.calledUno === true, "a successful uno call is visible to every player");
  ok(!pl2.hand, "the caller's hand is still hidden");
  const call = (v2.events as {type:string; actor?:string}[]).find((e) => e.type === "uno");
  ok(!!call && call.actor === "A", "the call is announced in the log with the caller's name");
}

// ---------------- chat
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  ok(actChat(s, a.id, "  hello   there ") === null, "chat message accepted");
  ok(s.chat[0].text === "hello there" && s.chat[0].name === "A", "chat text normalised and attributed");
  actChat(s, a.id, "hello there");
  ok(s.chat.length === 1, "duplicate spam is dropped");
  ok(actSetChat(s, b.id, false) !== null, "non admins cannot toggle chat");
  ok(actSetChat(s, a.id, false) === null && s.chatOn === false, "admin turned chat off");
  ok(actChat(s, b.id, "hi") !== null, "messages blocked while chat is off");
  actSetChat(s, a.id, true);
  actChat(s, b.id, "back on");
  ok(actClearChat(s, a.id) === null, "admin cleared chat");
  ok(s.chat.filter((m) => !m.system).length === 0, "chat history emptied");
}

// ---------------- log keeps card detail and history
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "skip" }), mk({ color: "red", value: "2" })];
  b.hand = [mk({ color: "blue", value: "4" }), mk({ color: "blue", value: "9" })];
  actPlay(s, a.id, a.hand[0].id, {});
  const last = s.events[s.events.length - 1];
  ok(!!last.card && last.card.value === "skip" && last.card.color === "red", "log entry carries the played card");
  ok(last.msg.includes("A played red Skip"), "log names the player and the card, got: " + last.msg);
  ok(typeof last.at === "number" && last.round === s.round, "log entry is stamped with time and round");
  const v = buildView(s, b.id, 1, 9999) as Record<string, unknown>;
  ok((v.logTail as unknown[]).length > 0, "view always carries the full log tail");
}

// ---------------- random order shuffles per round, chaos per turn
{
  const s = rig(["A", "B", "C", "D"], "classic", { randomOrder: true });
  s.dealerIdx = 0;
  startRound(s);
  ok(s.players.length === 4, "random order keeps every seat through a deal");
  ok(s.events.some((e) => e.type === "order"), "round shuffle is logged");
}

// ---------------- a finished round waits for the admin
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "3" })];
  b.hand = [mk({ color: "blue", value: "4" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(s.phase === "roundOver", "round ended");
  s.roundOverAt = Date.now() - 60000;
  tick(s);
  ok(s.phase === "roundOver", "round never auto deals, it waits for the admin");
}

// ---------------- point goal and win tracking
{
  // a reachable goal ends the game
  const s = rig(["A", "B"], "classic", { pointGoal: 10 });
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "3" })];
  b.hand = [mk({ color: "blue", value: "9" }), mk({ color: "blue", value: "8" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(a.score === 17, "round winner scores the other hands, got " + a.score);
  ok(s.phase === "gameOver", "passing the point goal ends the game");
  ok(a.wins === 1, "taking the whole game banks a win");
}
{
  // goal of zero never ends the game, it just counts wins
  const s = rig(["A", "B"], "classic", { pointGoal: 0 });
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "3" })];
  b.hand = [mk({ color: "blue", value: "9" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(a.wins === 1 && b.wins === 0, "wins only mode still tracks the win");
  ok(s.phase === "roundOver", "wins only mode never declares a champion");
  const v = buildView(s, a.id, 1, 0) as Record<string, unknown>;
  ok(v.targetScore === 0, "view reports the wins only goal");
  const pl = (v.players as Record<string, unknown>[]).find((x) => x.id === a.id)!;
  ok(pl.wins === 1, "view exposes the win count");
  const srow = (v.scoresAtRound as {playerId:string;wins:number}[]).find((r) => r.playerId === a.id)!;
  ok(srow.wins === 1, "scoreboard snapshot includes the win just earned, got " + srow.wins);
}
{
  // a high goal keeps the game running across rounds
  const s = rig(["A", "B"], "classic", { pointGoal: 500 });
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "3" })];
  b.hand = [mk({ color: "blue", value: "5" })];
  actPlay(s, a.id, a.hand[0].id, {});
  ok(s.phase === "roundOver", "short of the goal the game continues");
  ok(a.wins === 0, "a round win alone does not count when a point goal is set");
}

// ---------------- challenge is opt in now
{
  const s = rig(["A", "B", "C"], "classic");
  ok(s.rules.challengeWild4 === false, "Wild Draw 4 challenge is off by default");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "3" }), mk({ color: "wild", value: "wildDraw4" })];
  b.hand = [mk({ color: "blue", value: "2" }), mk({ color: "blue", value: "5" })];
  actPlay(s, a.id, a.hand[1].id, { color: "blue" });
  ok(s.challenge === null, "no challenge window opens when the rule is off");
  ok(b.hand.length === 6, "the Draw 4 simply lands, got " + b.hand.length);
}

// ---------------- peer command dispatcher
{
  const s = rig(["Owner", "Guest"], "classic");
  const owner = s.players[0], guest = s.players[1];
  owner.isOwner = true; owner.isAdmin = true;
  guest.isOwner = false; guest.isAdmin = false;
  const target = guest.hand[0] = mk({ color: "red", value: "3" });
  guest.hand.push(mk({ color: "blue", value: "8" }));
  s.turn = { playerIdx: 1, stage: "play" };
  s.currentColor = "red";
  s.discardPile = [mk({ color: "red", value: "5" })];
  ok(dispatchGameCommand(s, guest.id, { type: "play", payload: { cardId: target.id } }) === null,
    "peer dispatcher applies an authenticated card play");
  ok(guest.hand.length === 1, "peer-dispatched card leaves the hand");
  ok(dispatchGameCommand(s, guest.id, { type: "addBot" }) === "Not allowed",
    "peer dispatcher preserves admin authorization");
  ok(dispatchGameCommand(s, "missing", { type: "draw" }) !== null,
    "peer dispatcher rejects an unknown session");
}

// ---------------- color roulette: the victim names the color and pulls one at a time
{
  const s = rig(["A", "B", "C"], "nomercy");
  const a = s.players[0], b = s.players[1], c = s.players[2];
  const roul = mk({ color: "wild", value: "wildColorRoulette" });
  a.hand = [roul, mk({ color: "red", value: "1" })];
  b.hand = [mk({ color: "blue", value: "3" })];
  c.hand = [mk({ color: "green", value: "4" })];
  // pop() takes from the end, so the pull order is red 7, then blue 2, then green 9
  s.drawPile = [mk({ color: "green", value: "9" }), mk({ color: "blue", value: "2" }), mk({ color: "red", value: "7" })];

  ok(actPlay(s, a.id, roul.id, {}) === null, "roulette: the card plays without naming a color");
  ok(!!s.roulette, "roulette: a pull is pending after the card");
  ok(s.roulette!.byId === a.id, "roulette: remembers who played it");
  ok(s.roulette!.chooserId === b.id, "roulette: the next player names the color");
  ok(s.roulette!.pullerId === b.id, "roulette: the next player does the pulling");
  ok(s.players[s.turn.playerIdx].id === b.id, "roulette: the turn moves to the victim");
  ok(actRoulettePull(s, b.id) !== null, "roulette: nobody pulls before the color is named");
  ok(actRouletteColor(s, a.id, "green") !== null, "roulette: the player of the card cannot name the color");

  ok(actRouletteColor(s, b.id, "green") === null, "roulette: the victim names green");
  ok(s.currentColor === "green", "roulette: the table follows the call");
  const before = b.hand.length;
  ok(actRoulettePull(s, b.id) === null, "roulette: first pull");
  ok(b.hand.length === before + 1, "roulette: one card per pull, got " + (b.hand.length - before));
  ok(s.roulette!.drawn.length === 1, "roulette: the pulled card is recorded");
  ok(!s.roulette!.doneAt, "roulette: keeps going while the color is missing");
  ok(actRoulettePull(s, b.id) === null, "roulette: second pull");
  ok(!s.roulette!.doneAt, "roulette: still going after the second card");
  ok(actRoulettePull(s, b.id) === null, "roulette: third pull");
  ok(!!s.roulette!.doneAt, "roulette: stops the moment the color turns up");
  ok(b.hand.length === before + 3, "roulette: the victim keeps every card pulled");
  ok(s.roulette!.drawn.length === 3, "roulette: three cards recorded");
  ok(actRoulettePull(s, b.id) !== null, "roulette: no pulling after the color landed");

  const seen = buildView(s, c.id, 1, 0);
  ok(seen.roulette !== null, "roulette: shown to the whole table");
  ok(seen.roulette!.drawn.length === 3, "roulette: every pulled card is public");
  ok(seen.roulette!.drawn[2].light.color === "green", "roulette: the winning card is public too");
  ok(seen.roulette!.pullerName === "B" && seen.roulette!.byName === "A", "roulette: the view names both players");
  ok(seen.players.every((p) => !p.hand || p.id === c.id), "roulette: no other hand leaks");

  ok(actRouletteFinish(s, b.id) === null, "roulette: the victim ends the pull");
  ok(s.roulette === null, "roulette: state clears");
  ok(s.players[s.turn.playerIdx].id === c.id, "roulette: the victim loses their turn");
}

// ---------------- color roulette: bots name the color and pull one card per tick
{
  const s = rig(["A", "Bot"], "nomercy");
  const a = s.players[0], bot = s.players[1];
  bot.isBot = true;
  const roul = mk({ color: "wild", value: "wildColorRoulette" });
  a.hand = [roul, mk({ color: "red", value: "1" })];
  bot.hand = [mk({ color: "blue", value: "3" })];
  s.drawPile = Array.from({ length: 20 }, () => mk({ color: "yellow", value: "4" }));
  actPlay(s, a.id, roul.id, {});
  s.lastActionAt = Date.now() - 2000;
  tick(s);
  ok(!!s.roulette?.color, "roulette bot: names a color on its tick");
  s.lastActionAt = Date.now() - 2000;
  tick(s);
  ok(s.roulette!.drawn.length === 1, "roulette bot: pulls exactly one card per tick, got " + s.roulette!.drawn.length);
  ok(s.roulette!.drawn.length === bot.hand.length - 1, "roulette bot: the pull landed in its hand");
}

// ---------------- a finished pull clears itself on the host tick
{
  const s = rig(["A", "B", "C"], "nomercy");
  const a = s.players[0], b = s.players[1], c = s.players[2];
  const roul = mk({ color: "wild", value: "wildColorRoulette" });
  a.hand = [roul, mk({ color: "red", value: "1" })];
  b.hand = [mk({ color: "blue", value: "3" })];
  c.hand = [mk({ color: "green", value: "4" })];
  s.drawPile = [mk({ color: "green", value: "9" }), mk({ color: "red", value: "7" })];
  actPlay(s, a.id, roul.id, {});
  actRouletteColor(s, b.id, "green");
  ok(actRoulettePull(s, b.id) === null, "auto finish: first pull");
  ok(actRoulettePull(s, b.id) === null, "auto finish: second pull hits the color");
  ok(!!s.roulette?.doneAt, "auto finish: the pull is marked done");
  tick(s);
  ok(s.roulette !== null, "auto finish: the table still sees the winning card");
  s.roulette!.doneAt = Date.now() - ROULETTE_HOLD_MS - 20;
  tick(s);
  ok(s.roulette === null, "auto finish: the pull clears after the hold");
  ok(s.players[s.turn.playerIdx].id === c.id, "auto finish: play resumes with the player after the victim");
}

// ---------------- draw until color: the player names it, the next player pulls
{
  const s = rig(["A", "B", "C"], "flip");
  const a = s.players[0], b = s.players[1], c = s.players[2];
  const wdc = mk({ color: "wild", value: "wildDrawColor" });
  a.hand = [wdc, mk({ color: "red", value: "1" })];
  b.hand = [mk({ color: "blue", value: "3" })];
  c.hand = [mk({ color: "green", value: "4" })];
  s.drawPile = [mk({ color: "blue", value: "9" }), mk({ color: "red", value: "7" })];

  ok(actPlay(s, a.id, wdc.id, { color: "blue" }) === null, "draw color: the card plays with its color");
  ok(s.roulette!.chooserId === a.id, "draw color: the player who played it names the color");
  ok(s.roulette!.pullerId === b.id, "draw color: the next player pulls");
  ok(s.roulette!.color === "blue", "draw color: the called color is the target");
  ok(s.currentColor === "blue", "draw color: the table color is the called color");
  ok(s.players[s.turn.playerIdx].id === b.id, "draw color: the turn goes to the victim");
  ok(actRoulettePull(s, a.id) !== null, "draw color: the caller does not pull");
  ok(actRouletteColor(s, b.id, "green") !== null, "draw color: the color is not renamed by the victim");

  const before = b.hand.length;
  ok(actRoulettePull(s, b.id) === null, "draw color: first pull");
  ok(!s.roulette!.doneAt, "draw color: red is not the target");
  ok(actRoulettePull(s, b.id) === null, "draw color: second pull");
  ok(!!s.roulette!.doneAt, "draw color: stops on blue");
  ok(b.hand.length === before + 2, "draw color: two cards pulled, got " + (b.hand.length - before));
  const seen = buildView(s, a.id, 1, 0);
  ok(seen.roulette!.drawn.length === 2 && seen.roulette!.drawn[1].light.color === "blue",
    "draw color: the caller also watches every card");
  actRouletteFinish(s, b.id);
  ok(s.players[s.turn.playerIdx].id === c.id, "draw color: the victim loses the turn");
}


// ---------------- watchers sit out the deal and the turn order
{
  const s = createRoomState("classic");
  const a = addPlayer(s, "A", false);
  const b = addPlayer(s, "B", false);
  const spec = addPlayer(s, "S", false);
  a.isAdmin = true;

  ok(actSetSpectate(s, b.id, spec.id, true) !== null, "seats: only an admin can move people to the rail");
  ok(actSetSpectate(s, a.id, spec.id, true) === null, "seats: an admin moves a player to the rail");
  ok(spec.spectator === true, "seats: the player is flagged as watching");
  ok(actSetSpectate(s, a.id, a.id, true) !== null, "seats: the owner always has a seat");
  ok(actStart(s, a.id) === null, "seats: two seated players are enough to start");

  ok(a.hand.length === 7 && b.hand.length === 7, "seats: only seated players are dealt in");
  ok(spec.hand.length === 0, "seats: a watcher holds no cards");
  ok(s.players[s.turn.playerIdx].id !== spec.id, "seats: the watcher is not the turn player");
  ok(buildView(s, spec.id, 1, 0).players.find((p) => p.id === spec.id)!.spectator === true,
    "seats: the watcher is flagged in the view");
  ok(actSetSpectate(s, a.id, spec.id, false) !== null, "seats: nobody is reseated once a round is running");

  // a watcher in the middle of the order is stepped over, not stuck on
  const before = s.players[s.turn.playerIdx].id;
  actPlay(s, before === a.id ? a.id : b.id, s.players[s.turn.playerIdx].hand[0].id, {});
  ok(s.players[s.turn.playerIdx].id !== spec.id, "seats: turn order skips the watcher");
}

// ---------------- the room can be handed to another browser and taken back
{
  const s = createRoomState("classic");
  const owner = addPlayer(s, "A", false);
  const second = addPlayer(s, "B", false);
  ok(owner.isOwner && owner.isAdmin, "host: the opener is owner and admin");
  ok(second.joinedAt >= owner.joinedAt, "host: join order follows the seats");

  setHost(s, second.id);
  ok(s.hostId === second.id, "host: another browser can run the room");
  ok(second.isAdmin === true, "host: a stand-in host gets admin powers");
  ok(second.isOwner === false, "host: a stand-in host never becomes owner");

  setHost(s, owner.id);
  ok(s.hostId === owner.id, "host: the owner takes the room straight back");
  ok(owner.isOwner === true, "host: owner powers are untouched by the stand-in");
  const v = buildView(s, second.id, 1, 0);
  ok(v.iAmHost === false && v.hostId === owner.id, "host: the view names the current host");
}

// ---------------- host election, run by every browser on its own
{
  const now = 500000;
  const seat = (pid: string, joinedAt: number, canHost = true, at = now): HostCandidate =>
    ({ pid, peerId: "p" + pid, joinedAt, canHost, at });

  const list = [seat("b", 2000), seat("a", 1000)];
  ok(pickHost(list, now)?.pid === "a", "election: the earliest seat runs the room");
  ok(pickHost(list, now + PRESENCE_TTL_MS + 1) === null, "election: a browser that stopped answering is dropped");
  ok(pickHost([seat("a", 1000, false)], now) === null, "election: no copy of the room means no hosting");
  ok(pickHost([seat("z", 1000), seat("a", 1000)], now)?.pid === "a", "election: identical seats fall back to id");

  ok(hostShouldChange(null, list[1], now) === true, "election: with nobody hosting, the best seat takes it");
  ok(hostShouldChange({ pid: "a", joinedAt: 1000, at: now }, list[1], now) === false,
    "election: a sitting host that outranks everyone keeps the room");
  ok(hostShouldChange({ pid: "b", joinedAt: 2000, at: now }, list[1], now) === true,
    "election: an outranked host gives the room up");
  ok(isBetterHost({ joinedAt: 1000, pid: "a" }, { joinedAt: 1000, pid: "b" }) === true, "election: tie broken by id");

  ok(isNewerState({ seq: 5, lastActionAt: 1 }, { seq: 4, lastActionAt: 99 }) === true,
    "election: the copy with more events wins");
  ok(isNewerState({ seq: 4, lastActionAt: 99 }, { seq: 5, lastActionAt: 1 }) === false,
    "election: an older copy never replaces a newer one");
}

console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " FAILURES");
process.exit(failures ? 1 : 0);
