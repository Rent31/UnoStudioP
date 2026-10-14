import {
  addPlayer, actPlay, actDraw, actPass, actUno, actChallenge,
  tick, actChooseColor, actEndDouble, actReorder, actShuffleSeats, actChat, actSetChat, actClearChat, startRound, buildView, createRoomState, addPlayer as _addP, RoomState,
} from "../src/lib/game/engine";
import { GameCard, Face, Variant, buildAllWildDeck, buildFlipDeck, buildFlexDeck } from "../src/lib/game/model";
import { dispatchGameCommand } from "../src/lib/game/dispatch";

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

// ---------------- uno state never leaks into the view
{
  const s = rig(["A", "B"], "classic");
  const a = s.players[0], b = s.players[1];
  a.hand = [mk({ color: "red", value: "9" }), mk({ color: "red", value: "4" })];
  b.hand = [mk({ color: "green", value: "3" })];
  actPlay(s, a.id, a.hand[0].id, {});
  const v = buildView(s, b.id, 1, 0) as Record<string, unknown>;
  ok(v.unoRace === null, "view never exposes an open uno race");
  const pl = (v.players as Record<string, unknown>[]).find((x) => x.id === a.id)!;
  ok(!("calledUno" in pl) && !("vulnerable" in pl), "view never exposes uno flags");
  ok(!(v.events as {type:string}[]).some((e) => e.type === "uno"), "uno calls stay out of the log");
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

console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " FAILURES");
process.exit(failures ? 1 : 0);
