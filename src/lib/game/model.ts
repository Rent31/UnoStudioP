// Core game model: types, colors, deck construction, matching rules, scoring.

export type Variant = "classic" | "nomercy" | "flip" | "flex" | "allwild";
export type Side = "light" | "dark";

export type ColorName =
  | "red" | "yellow" | "green" | "blue"        // light / classic colors
  | "pink" | "teal" | "orange" | "purple"     // flip dark side colors
  | "wild";

export type FaceValue =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "skip" | "reverse"
  | "draw1" | "draw2" | "draw4" | "draw5"
  | "wild" | "wildDraw2" | "wildDraw4"
  | "flip"                                   // flip variant: flips the whole game
  | "skipEveryone" | "discardAll"            // no mercy (skipEveryone also flip dark)
  | "wildReverseDraw4" | "wildDraw6" | "wildDraw10" | "wildColorRoulette" // no mercy
  | "wildDrawColor"                          // flip dark side
  | "wildAllFlip"                            // flex: everyone flips power tokens
  | "wildReverse" | "wildSkip" | "wildSkipTwo" | "wildTargetDraw2" | "wildSwap"; // all wild

// Flex alternate abilities (played via power token)
export type FlexValue =
  | "allDraw1"      // draw2 flexed: every other player draws 1
  | "reverseSkip"   // reverse flexed: reverse direction and skip the next player
  | "skipEveryone"  // skip flexed: skip everyone, play again
  | "targetDraw2"   // wild flexed: choose a player to draw 2
  | "allDraw2"      // wildDraw2 flexed: every other player draws 2
  | "targetDraw4";  // wildDraw4 flexed: choose a player to draw 4

export interface Face {
  color: ColorName;
  value: FaceValue;
}

export interface GameCard {
  id: string;
  light: Face;
  dark?: Face;          // flip variant second side
  flexColor?: ColorName; // flex variant: alternative color
  flexValue?: FlexValue; // flex variant: alternative action
  flipIcon?: boolean;    // flex number cards that toggle your power token
}

export const LIGHT_COLORS: Record<string, string> = {
  red: "#e63b1f", yellow: "#f2c200", green: "#34a853", blue: "#1565d8",
};
export const DARK_COLORS: Record<string, string> = {
  pink: "#e84a9a", teal: "#1fb5a8", orange: "#f28c28", purple: "#8a4fd0",
};
export const LIGHT_COLOR_NAMES = ["red", "yellow", "green", "blue"] as const;
export const DARK_COLOR_NAMES = ["pink", "teal", "orange", "purple"] as const;

export const VARIANT_META: Record<Variant, { name: string; blurb: string; target: number }> = {
  classic: {
    name: "Classic",
    blurb: "Match color, number or symbol. The original race to an empty hand.",
    target: 500,
  },
  nomercy: {
    name: "No Mercy",
    blurb: "Draw cards stack to +10, sevens swap hands, and 25 cards knocks you out.",
    target: 1000,
  },
  flip: {
    name: "Flip",
    blurb: "Double sided cards. One Flip turns both piles and every hand to the dark side.",
    target: 500,
  },
  flex: {
    name: "Flex",
    blurb: "Spend a power token to play a card's second color or second action.",
    target: 500,
  },
  allwild: {
    name: "All Wild",
    blurb: "Every card is wild. Nothing to match, everything to fear.",
    target: 500,
  },
};

let uid = 0;
function cid(): string {
  uid = (uid + 1) % 0xffffff;
  return `k${Date.now().toString(36)}${uid.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function colored(color: ColorName, value: FaceValue, n: number, out: GameCard[], extra?: Partial<GameCard>) {
  for (let i = 0; i < n; i++) out.push({ id: cid(), light: { color, value }, ...extra });
}
function wild(value: FaceValue, n: number, out: GameCard[], extra?: Partial<GameCard>) {
  for (let i = 0; i < n; i++) out.push({ id: cid(), light: { color: "wild", value }, ...extra });
}

// ---------------------------------------------------------------- classic
export function buildClassicDeck(): GameCard[] {
  const out: GameCard[] = [];
  for (const c of LIGHT_COLOR_NAMES) {
    colored(c, "0", 1, out);
    for (let n = 1; n <= 9; n++) colored(c, String(n) as FaceValue, 2, out);
    colored(c, "skip", 2, out);
    colored(c, "reverse", 2, out);
    colored(c, "draw2", 2, out);
  }
  wild("wild", 4, out);
  wild("wildDraw4", 4, out);
  return out;
}

// ---------------------------------------------------------------- no mercy (168)
export function buildNoMercyDeck(): GameCard[] {
  const out: GameCard[] = [];
  for (const c of LIGHT_COLOR_NAMES) {
    for (let n = 0; n <= 9; n++) colored(c, String(n) as FaceValue, 2, out);
    colored(c, "skip", 3, out);
    colored(c, "reverse", 3, out);
    colored(c, "draw2", 3, out);
    colored(c, "draw4", 2, out);
    colored(c, "skipEveryone", 2, out);
    colored(c, "discardAll", 3, out);
  }
  wild("wildReverseDraw4", 8, out);
  wild("wildDraw6", 4, out);
  wild("wildDraw10", 4, out);
  wild("wildColorRoulette", 8, out);
  return out;
}

// ---------------------------------------------------------------- flip (112)
export function buildFlipDeck(): GameCard[] {
  // Build full light and dark distributions separately, then zip into
  // double sided cards (pairings are arbitrary, distribution is exact).
  const light: Face[] = [];
  const dark: Face[] = [];
  for (const c of LIGHT_COLOR_NAMES) {
    for (let n = 1; n <= 9; n++) { light.push({ color: c, value: String(n) as FaceValue }); light.push({ color: c, value: String(n) as FaceValue }); }
    for (let i = 0; i < 2; i++) {
      light.push({ color: c, value: "skip" });
      light.push({ color: c, value: "reverse" });
      light.push({ color: c, value: "draw1" });
      light.push({ color: c, value: "flip" });
    }
  }
  for (let i = 0; i < 4; i++) { light.push({ color: "wild", value: "wild" }); light.push({ color: "wild", value: "wildDraw2" }); }
  for (const c of DARK_COLOR_NAMES) {
    for (let n = 1; n <= 9; n++) { dark.push({ color: c, value: String(n) as FaceValue }); dark.push({ color: c, value: String(n) as FaceValue }); }
    for (let i = 0; i < 2; i++) {
      dark.push({ color: c, value: "draw5" });
      dark.push({ color: c, value: "skipEveryone" });
      dark.push({ color: c, value: "reverse" });
      dark.push({ color: c, value: "flip" });
    }
  }
  for (let i = 0; i < 4; i++) { dark.push({ color: "wild", value: "wild" }); dark.push({ color: "wild", value: "wildDrawColor" }); }

  const li = shuffled(light.map((_, i) => i));
  const di = shuffled(dark.map((_, i) => i));
  const out: GameCard[] = [];
  for (let k = 0; k < 112; k++) {
    out.push({ id: cid(), light: light[li[k]], dark: dark[di[k]] });
  }
  return out;
}

// ---------------------------------------------------------------- flex (112)
// Flex colour pairings: numbers 1-3 take the first partner, 4-6 the second,
// 7-8 the third, exactly as the reference deck lays them out.
const FLEX_MAP: Record<string, ColorName[]> = {
  red: ["blue", "green", "yellow"],
  blue: ["red", "yellow", "green"],
  green: ["yellow", "red", "blue"],
  yellow: ["green", "blue", "red"],
};

// The flip icon sits on even numbers for red and green, odd for blue and yellow.
function hasFlipIcon(color: ColorName, n: number): boolean {
  const even = color === "red" || color === "green";
  return even ? n % 2 === 0 : n % 2 === 1;
}

export function buildFlexDeck(): GameCard[] {
  // 104 cards to draw from, plus 8 power tokens that live outside the deck.
  const out: GameCard[] = [];
  for (const c of LIGHT_COLOR_NAMES) {
    // regular copies: solid face, no flex side, flip icon on half the numbers
    for (let n = 1; n <= 8; n++) {
      out.push({
        id: cid(),
        light: { color: c, value: String(n) as FaceValue },
        flipIcon: hasFlipIcon(c, n),
      });
    }
    colored(c, "draw2", 1, out);
    colored(c, "reverse", 1, out);
    colored(c, "skip", 1, out);

    // flex copies: numbers carry a flex colour, actions carry a flex action
    for (let n = 1; n <= 8; n++) {
      const partner = FLEX_MAP[c][n <= 3 ? 0 : n <= 6 ? 1 : 2];
      out.push({
        id: cid(),
        light: { color: c, value: String(n) as FaceValue },
        flexColor: partner,
      });
    }
    colored(c, "draw2", 1, out, { flexValue: "allDraw1" });
    colored(c, "reverse", 1, out, { flexValue: "reverseSkip" });
    colored(c, "skip", 1, out, { flexValue: "skipEveryone" });
  }
  wild("wild", 4, out, { flexValue: "targetDraw2" });
  wild("wildDraw2", 4, out, { flexValue: "allDraw2" });
  wild("wildDraw4", 2, out, { flexValue: "targetDraw4" });
  wild("wildAllFlip", 6, out);
  return out;
}

// ---------------------------------------------------------------- all wild (112)
export function buildAllWildDeck(): GameCard[] {
  const out: GameCard[] = [];
  wild("wild", 54, out);
  wild("wildReverse", 14, out);
  wild("wildSkip", 14, out);
  wild("wildSkipTwo", 6, out);
  wild("wildDraw2", 10, out);
  wild("wildDraw4", 6, out);
  wild("wildTargetDraw2", 4, out);
  wild("wildSwap", 4, out);
  return out;
}

export function buildDeck(variant: Variant): GameCard[] {
  switch (variant) {
    case "classic": return buildClassicDeck();
    case "nomercy": return buildNoMercyDeck();
    case "flip": return buildFlipDeck();
    case "flex": return buildFlexDeck();
    case "allwild": return buildAllWildDeck();
  }
}

// ---------------------------------------------------------------- helpers
export function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isNumberValue(v: FaceValue): boolean {
  return /^[0-9]$/.test(v);
}

export function isWildFace(f: Face): boolean {
  return f.color === "wild";
}

const ACTION_VALUES = new Set<FaceValue>([
  "skip", "reverse", "draw1", "draw2", "draw4", "draw5", "wild", "wildDraw2", "wildDraw4",
  "flip", "skipEveryone", "discardAll", "wildReverseDraw4", "wildDraw6", "wildDraw10",
  "wildColorRoulette", "wildDrawColor", "wildAllFlip", "wildReverse", "wildSkip", "wildSkipTwo",
  "wildTargetDraw2", "wildSwap",
]);
export function isActionValue(v: FaceValue): boolean {
  return ACTION_VALUES.has(v);
}

// Draw strength used for stacking (equal or higher rule)
export function drawStrength(v: FaceValue): number {
  switch (v) {
    case "draw1": return 1;
    case "draw2": case "wildDraw2": case "wildTargetDraw2": return 2;
    case "draw4": case "wildDraw4": case "wildReverseDraw4": return 4;
    case "draw5": return 5;
    case "wildDraw6": return 6;
    case "wildDraw10": return 10;
    default: return 0;
  }
}

export function isDrawValue(v: FaceValue): boolean {
  return drawStrength(v) > 0;
}

export function facePoints(f: Face, variant: Variant): number {
  if (isNumberValue(f.value)) return parseInt(f.value, 10);
  if (variant === "allwild") {
    if (f.value === "wild") return 20;
    if (f.value === "wildDraw4") return 50;
    return 30;
  }
  if (variant === "flip") {
    if (f.value === "wild") return 40;
    if (f.value === "wildDraw2") return 50;
    if (f.value === "wildDrawColor") return 60;
    return 20;
  }
  if (f.color === "wild") return 50;
  return 20;
}

export function activeFace(side: Side, card: GameCard): Face {
  if (side === "dark" && card.dark) return card.dark;
  return card.light;
}

export function valueLabel(v: FaceValue | FlexValue): string {
  switch (v) {
    case "skip": return "Skip";
    case "reverse": return "Reverse";
    case "draw1": return "Draw 1";
    case "draw2": return "Draw 2";
    case "draw4": return "Draw 4";
    case "draw5": return "Draw 5";
    case "wild": return "Wild";
    case "wildDraw2": return "Wild Draw 2";
    case "wildDraw4": return "Wild Draw 4";
    case "flip": return "Flip";
    case "skipEveryone": return "Skip Everyone";
    case "discardAll": return "Discard All";
    case "wildReverseDraw4": return "Wild Reverse Draw 4";
    case "wildDraw6": return "Wild Draw 6";
    case "wildDraw10": return "Wild Draw 10";
    case "wildColorRoulette": return "Wild Color Roulette";
    case "wildDrawColor": return "Wild Draw Color";
    case "wildAllFlip": return "Wild All Flip";
    case "wildReverse": return "Wild Reverse";
    case "wildSkip": return "Wild Skip";
    case "wildSkipTwo": return "Wild Skip Two";
    case "wildTargetDraw2": return "Targeted Draw 2";
    case "wildSwap": return "Forced Swap";
    case "allDraw1": return "All Draw 1";
    case "allDraw2": return "All Draw 2";
    case "reverseSkip": return "Reverse Skip";
    case "targetDraw2": return "Target Draw 2";
    case "targetDraw4": return "Target Draw 4";
    default: return String(v);
  }
}

// ---------------------------------------------------------------- house rules

export interface HouseRules {
  turnTimer: number;          // seconds, 0 = off
  pointGoal: number;          // points to win, 0 = play for round wins instead
  randomOrder: boolean;       // reshuffle seating before every round
  chaosMode: boolean;         // reshuffle seating before every turn
  stacking: boolean;
  jumpIn: boolean;
  drawUntilPlay: boolean;
  forcedPlay: boolean;
  noWinOnAction: boolean;
  challengeWild4: boolean;
  mercy10: boolean;
  targetedSkip: boolean;
  doublePlay: boolean;
  ultimateStacking: boolean;
  reverseReflect: boolean;
  discardRoulette: boolean;
  chaosFlip: boolean;
  darkStacking: boolean;
  colorCurse: boolean;
  flexStacking: boolean;
  powerFlipping: boolean;
  flexWildSwap: boolean;
  colorLock: boolean;
  wildChain: boolean;
  wildMayhem: boolean;
  showOwnHandAtTable: boolean;
}

export type HouseRuleKey = keyof HouseRules;

export const DEFAULT_RULES: HouseRules = {
  turnTimer: 0,
  pointGoal: 500,
  randomOrder: false,
  chaosMode: false,
  stacking: false,
  jumpIn: false,
  drawUntilPlay: false,
  forcedPlay: false,
  noWinOnAction: false,
  challengeWild4: false,
  mercy10: false,
  targetedSkip: false,
  doublePlay: false,
  ultimateStacking: false,
  reverseReflect: false,
  discardRoulette: false,
  chaosFlip: false,
  darkStacking: false,
  colorCurse: false,
  flexStacking: false,
  powerFlipping: false,
  flexWildSwap: false,
  colorLock: false,
  wildChain: false,
  wildMayhem: false,
  showOwnHandAtTable: false,
};

export interface RuleDef { key: HouseRuleKey; name: string; desc: string }

export const GENERAL_RULES: RuleDef[] = [
  { key: "randomOrder", name: "Random Order", desc: "Shuffle the seating order before every round. Overrides any manual order." },
  { key: "chaosMode", name: "Chaos Mode", desc: "Shuffle the seating order before every turn. Overrides any manual order." },
  { key: "stacking", name: "Stacking", desc: "Answer a draw card with another draw card to pass the combined penalty along." },
  { key: "jumpIn", name: "Jump In", desc: "Play out of turn the instant you hold the exact same card that was just played." },
  { key: "drawUntilPlay", name: "Draw Until You Play", desc: "Keep drawing until a playable card turns up." },
  { key: "forcedPlay", name: "Forced Play", desc: "If the card you draw is playable, you have to play it." },
  { key: "noWinOnAction", name: "No Win On Action", desc: "You cannot go out on an action card. Draw one penalty card instead." },
  { key: "challengeWild4", name: "Challenge Wild Draw 4", desc: "Call out a suspect Wild Draw 4. The loser of the challenge draws extra." },
  { key: "showOwnHandAtTable", name: "Show Your Hand at Your Seat", desc: "Add your own card backs to the table at your seat; your hand stays visible below too." }
];

export const VARIANT_RULES: Record<Variant, RuleDef[]> = {
  classic: [
    { key: "mercy10", name: "Mercy Rule at 10", desc: "Hit ten cards and half your hand goes back to the bottom of the deck at random." },
    { key: "targetedSkip", name: "Targeted Skip", desc: "A Skip card can be aimed at any player at the table." },
    { key: "doublePlay", name: "Double Play", desc: "Follow your card with a second one of the same color or the same value." },
  ],
  nomercy: [
    { key: "ultimateStacking", name: "Ultimate Stacking", desc: "Any draw card stacks on any other draw card, no matter the value." },
    { key: "reverseReflect", name: "Reverse Reflect", desc: "Play a Reverse while a draw penalty is aimed at you to send it back." },
    { key: "discardRoulette", name: "Discard Pile Roulette", desc: "Wild reverse and wild draw penalties are drawn off the discard pile instead." },
  ],
  flip: [
    { key: "chaosFlip", name: "Chaos Flip", desc: "A Flip card also forces every hand to pass one seat along." },
    { key: "darkStacking", name: "Dark Side Stacking", desc: "Dark side draws stack onto light side draws and the other way round." },
    { key: "colorCurse", name: "Targeted Color Curse", desc: "Draw Until Color also costs the target their next turn." },
  ],
  flex: [
    { key: "flexStacking", name: "Flex Stacking", desc: "Flexed action cards can be stacked onto a pending penalty to redirect it." },
    { key: "powerFlipping", name: "Power Flipping", desc: "Spending your token forces every other green token to flip red too." },
    { key: "flexWildSwap", name: "Flex Wild Swap", desc: "A flexed wild swaps your power token status with a player of your choice." },
  ],
  allwild: [
    { key: "colorLock", name: "Subtype Lock", desc: "The next player must answer with the same card type or draw two." },
    { key: "wildChain", name: "Chain Reaction", desc: "A Targeted Draw Two also makes every other player draw one." },
    { key: "wildMayhem", name: "Hand Dump", desc: "A Forced Swap makes every other player discard a card at random." },
  ],
};

export const TIMER_OPTIONS = [0, 10, 15, 20, 30, 45] as const;

export const GOAL_OPTIONS = [0, 200, 300, 500, 1000] as const;
