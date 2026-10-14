// Short card descriptions used by the rules page and the hold-to-inspect popup.

import type { Face, FaceValue, FlexValue, Variant, HouseRules } from "./model";
import { valueLabel, isNumberValue } from "./model";

export interface CardInfo { title: string; text: string }

function base(v: FaceValue, variant: Variant): string {
  switch (v) {
    case "skip": return "Next player loses their turn.";
    case "reverse": return "Turn order flips. With two players it acts as a skip.";
    case "draw1": return "Next player draws 1 and is skipped.";
    case "draw2": return "Next player draws 2 and is skipped.";
    case "draw4": return "Next player draws 4 and is skipped.";
    case "draw5": return "Next player draws 5 and is skipped.";
    case "wild": return variant === "allwild" ? "Plays on anything with no extra effect." : "Play on anything and name the next color.";
    case "wildDraw2": return "Name a color. Next player draws 2 and is skipped.";
    case "wildDraw4": return "Name a color. Next player draws 4. They may challenge a bluff.";
    case "flip": return "Flips the side in play. Both piles turn over, so the bottom card becomes the top.";
    case "skipEveryone": return "Everyone else is skipped and you play again.";
    case "discardAll": return "Dump every other card of this color from your hand.";
    case "wildReverseDraw4": return "Name a color, reverse the order, and add 4 to the stack.";
    case "wildDraw6": return "Name a color and add 6 to the stack.";
    case "wildDraw10": return "Name a color and add 10 to the stack.";
    case "wildColorRoulette": return "Name a color. Next player draws until they hit it, then loses their turn.";
    case "wildDrawColor": return "Name a color. Next player draws until they hit it.";
    case "wildAllFlip": return "Every power token at the table flips over.";
    case "wildReverse": return "Turn order flips.";
    case "wildSkip": return "Next player loses their turn.";
    case "wildSkipTwo": return "The next two players lose their turns.";
    case "wildTargetDraw2": return "Pick any player. They draw 2.";
    case "wildSwap": return "Pick any player and trade hands with them.";
    default: return "";
  }
}

function numberNote(v: FaceValue, variant: Variant): string {
  if (variant === "nomercy" && v === "7") return "No Mercy: a 7 lets you swap hands with a player.";
  if (variant === "nomercy" && v === "0") return "No Mercy: a 0 rotates every hand one seat.";
  return "Match by color or by number.";
}

function flexNote(fv: FlexValue): string {
  switch (fv) {
    case "allDraw1": return "Flexed: every other player draws 1.";
    case "allDraw2": return "Flexed: every other player draws 2.";
    case "reverseSkip": return "Flexed: reverse the order and skip the next player.";
    case "skipEveryone": return "Flexed: skip everyone and play again.";
    case "targetDraw2": return "Flexed: pick a player to draw 2.";
    case "targetDraw4": return "Flexed: pick a player to draw 4.";
  }
}

export function describeCard(
  face: Face,
  variant: Variant,
  opts?: { flexColor?: string | null; flexValue?: FlexValue | null; flipIcon?: boolean; rules?: HouseRules },
): CardInfo {
  const isNum = isNumberValue(face.value);
  const title = isNum
    ? (face.color === "wild" ? face.value : `${face.color} ${face.value}`)
    : (face.color === "wild" ? valueLabel(face.value) : `${face.color} ${valueLabel(face.value)}`);

  const lines: string[] = [];
  lines.push(isNum ? numberNote(face.value, variant) : base(face.value, variant));

  if (opts?.flexColor) lines.push(`Flex color: ${opts.flexColor}. Spend your token to play it as that color.`);
  if (opts?.flexValue) lines.push(flexNote(opts.flexValue));
  if (opts?.flipIcon) lines.push("Carries a flip icon, so playing it turns your power token over. Icons sit on even numbers for red and green, odd for blue and yellow.");

  const r = opts?.rules;
  if (r) {
    if (r.stacking && /^draw|^wildDraw/.test(face.value)) lines.push("Stacking is on, so this can be passed along.");
    if (r.targetedSkip && face.value === "skip") lines.push("Targeted Skip is on, so you can aim it at anyone.");
  }

  return { title, text: lines.filter(Boolean).join(" ") };
}

// Card lists used by the rules page.
export interface CardRow { face: Face; variant: Variant; count: string; flexColor?: string; flexValue?: FlexValue; flipIcon?: boolean; dark?: boolean; light?: boolean }

export const RULES_CARDS: Record<Variant, CardRow[]> = {
  classic: [
    { face: { color: "red", value: "7" }, variant: "classic", count: "2 per color, one 0 each" },
    { face: { color: "blue", value: "skip" }, variant: "classic", count: "2 per color" },
    { face: { color: "green", value: "reverse" }, variant: "classic", count: "2 per color" },
    { face: { color: "yellow", value: "draw2" }, variant: "classic", count: "2 per color" },
    { face: { color: "wild", value: "wild" }, variant: "classic", count: "4" },
    { face: { color: "wild", value: "wildDraw4" }, variant: "classic", count: "4" },
  ],
  nomercy: [
    { face: { color: "red", value: "0" }, variant: "nomercy", count: "2 per color" },
    { face: { color: "blue", value: "7" }, variant: "nomercy", count: "2 per color" },
    { face: { color: "blue", value: "skip" }, variant: "nomercy", count: "3 per color" },
    { face: { color: "green", value: "reverse" }, variant: "nomercy", count: "3 per color" },
    { face: { color: "yellow", value: "draw2" }, variant: "nomercy", count: "3 per color" },
    { face: { color: "green", value: "draw4" }, variant: "nomercy", count: "2 per color" },
    { face: { color: "red", value: "skipEveryone" }, variant: "nomercy", count: "2 per color" },
    { face: { color: "blue", value: "discardAll" }, variant: "nomercy", count: "3 per color" },
    { face: { color: "wild", value: "wildReverseDraw4" }, variant: "nomercy", count: "8" },
    { face: { color: "wild", value: "wildDraw6" }, variant: "nomercy", count: "4" },
    { face: { color: "wild", value: "wildDraw10" }, variant: "nomercy", count: "4" },
    { face: { color: "wild", value: "wildColorRoulette" }, variant: "nomercy", count: "8" },
  ],
  flip: [
    { face: { color: "red", value: "draw1" }, variant: "flip", light: true, count: "2 per color" },
    { face: { color: "blue", value: "flip" }, variant: "flip", light: true, count: "2 per color" },
    { face: { color: "wild", value: "wildDraw2" }, variant: "flip", light: true, count: "4" },
    { face: { color: "pink", value: "draw5" }, variant: "flip", dark: true, count: "2 per color" },
    { face: { color: "teal", value: "skipEveryone" }, variant: "flip", dark: true, count: "2 per color" },
    { face: { color: "orange", value: "flip" }, variant: "flip", dark: true, count: "2 per color" },
    { face: { color: "wild", value: "wildDrawColor" }, variant: "flip", dark: true, count: "4" },
  ],
  flex: [
    { face: { color: "red", value: "4" }, variant: "flex", flipIcon: true, count: "one regular copy of each number 1-8, per color" },
    { face: { color: "blue", value: "7" }, variant: "flex", flexColor: "green", count: "one flex copy of each number 1-8, per color" },
    { face: { color: "green", value: "draw2" }, variant: "flex", count: "one regular copy per color" },
    { face: { color: "green", value: "draw2" }, variant: "flex", flexValue: "allDraw1", count: "one flex copy per color" },
    { face: { color: "blue", value: "reverse" }, variant: "flex", flexValue: "reverseSkip", count: "one flex copy per color" },
    { face: { color: "yellow", value: "skip" }, variant: "flex", flexValue: "skipEveryone", count: "one flex copy per color" },
    { face: { color: "wild", value: "wild" }, variant: "flex", flexValue: "targetDraw2", count: "4" },
    { face: { color: "wild", value: "wildDraw2" }, variant: "flex", flexValue: "allDraw2", count: "4" },
    { face: { color: "wild", value: "wildDraw4" }, variant: "flex", flexValue: "targetDraw4", count: "2" },
    { face: { color: "wild", value: "wildAllFlip" }, variant: "flex", count: "6" },
  ],
  allwild: [
    { face: { color: "wild", value: "wild" }, variant: "allwild", count: "54" },
    { face: { color: "wild", value: "wildReverse" }, variant: "allwild", count: "14" },
    { face: { color: "wild", value: "wildSkip" }, variant: "allwild", count: "14" },
    { face: { color: "wild", value: "wildSkipTwo" }, variant: "allwild", count: "6" },
    { face: { color: "wild", value: "wildDraw2" }, variant: "allwild", count: "10" },
    { face: { color: "wild", value: "wildDraw4" }, variant: "allwild", count: "6" },
    { face: { color: "wild", value: "wildTargetDraw2" }, variant: "allwild", count: "4" },
    { face: { color: "wild", value: "wildSwap" }, variant: "allwild", count: "4" },
  ],
};

export const MODE_SUMMARY: Record<Variant, string[]> = {
  classic: [
    "Match the top card by color, number or symbol.",
    "No play means draw one. Play it right away or pass.",
    "Call UNO on your second to last card or get caught for 2.",
    "Round winner scores the cards left in every other hand. First to 500 wins.",
  ],
  nomercy: [
    "Draw cards stack. Answer with an equal or higher draw card to pass the total on.",
    "No play means you keep drawing until something fits.",
    "Reach 25 cards and you are out of the round.",
    "A 7 swaps your hand with a player. A 0 rotates every hand. First to 1000 wins.",
  ],
  flip: [
    "Every card has a light face and a dark face. You see the other side of each opponent card.",
    "A Flip card turns the side in play, including both piles, so the bottom card becomes the new top.",
    "An action revealed by a flip does nothing, though a revealed wild still needs a color.",
    "The dark side hits harder. First to 500 wins.",
  ],
  flex: [
    "Each color has a regular copy and a flex copy of every number and action.",
    "Flex numbers carry a second color. Flex actions keep their color but gain a second action.",
    "Your power token must be green to play a flex side, and it turns red once you do.",
    "Flip icons sit on even numbers for red and green, odd for blue and yellow. Playing one turns your token over.",
    "If every token is red at once they all reset.",
  ],
  allwild: [
    "Every card is wild, so anything can be played on anything.",
    "There are no colors or numbers to match, only effects.",
    "Targeted and swap cards let you pick who gets hit.",
    "First to 500 wins.",
  ],
};

export const DECK_TOTAL: Record<Variant, string> = {
  classic: "108 cards",
  nomercy: "168 cards",
  flip: "112 double sided cards",
  flex: "104 cards to draw from, plus 8 power tokens",
  allwild: "112 cards",
};
