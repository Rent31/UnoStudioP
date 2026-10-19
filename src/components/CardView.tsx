"use client";

import type { CSSProperties, ReactNode } from "react";
import type { ColorName, Face, FaceValue, FlexValue } from "@/lib/game/model";
import { LIGHT_COLORS, DARK_COLORS } from "@/lib/game/model";

// Port of the card markup from https://github.com/Rent31/misc ("uno cards in css").
// Cards render at the authored 120x180 size; parents scale via .cardwrap { --k }.

const LCOL = ["#e63b1f", "#1565d8", "#34a853", "#f2c200"];
const DCOL = ["#e84a9a", "#1fb5a8", "#f28c28", "#8a4fd0"];

function svg(inner: ReactNode, w = 56) {
  return <svg viewBox="0 0 64 64" width={w} height={w}>{inner}</svg>;
}

const P = "4,10 28,10 28,2 46,17 28,32 28,24 4,24";

const skipI = (
  <>
    <circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="9" />
    <path d="M16 48L48 16" stroke="currentColor" strokeWidth="9" />
  </>
);

const revI = (
  <g fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <polygon transform="translate(10,0)" points={P} />
    <polygon transform="rotate(180 32 32) translate(10,0)" points={P} />
  </g>
);

const fan2 = (
  <g fill="currentColor">
    <rect x="14" y="10" width="26" height="38" rx="4" opacity=".5" transform="rotate(-16 27 29)" />
    <rect x="24" y="10" width="26" height="38" rx="4" transform="rotate(14 37 29)" />
  </g>
);

function fanC(p: string[]) {
  return (
    <>
      {[-38, -13, 13, 38].map((a, i) => (
        <rect key={i} x="22" y="6" width="20" height="32" rx="3" fill={p[i]} transform={`rotate(${a} 32 46)`} />
      ))}
    </>
  );
}

function trashI(lineColor: string) {
  return (
    <>
      <g fill="currentColor">
        <rect x="25" y="3" width="14" height="8" rx="2" />
        <rect x="11" y="12" width="42" height="9" rx="3" />
        <path d="M16 25H48L44 58Q44 61 41 61H23Q20 61 20 58Z" />
      </g>
      <path d="M26 32V52M32 32V52M38 32V52" style={{ stroke: lineColor }} strokeWidth="4" strokeLinecap="round" />
    </>
  );
}

const skipX = (
  <>
    <circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="9" />
    <path d="M20 20L44 44M44 20L20 44" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </>
);

const flipI = (
  <>
    <polygon points="6,16 28,8 28,56 6,48" fill="currentColor" />
    <polygon points="58,16 36,8 36,56 58,48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
  </>
);

const crossI = (
  <>
    <circle cx="32" cy="32" r="17" fill="none" stroke="currentColor" strokeWidth="6" />
    <circle cx="32" cy="32" r="4" fill="currentColor" />
    <path d="M32 4V16M32 48V60M4 32H16M48 32H60" stroke="currentColor" strokeWidth="6" />
  </>
);

const swapI = (
  <>
    <g fill="currentColor">
      <rect x="6" y="22" width="20" height="28" rx="3" />
      <rect x="38" y="22" width="20" height="28" rx="3" />
      <polygon points="56,13 50,23 44,13" />
      <polygon points="8,59 14,49 20,59" />
    </g>
    <g fill="none" stroke="currentColor" strokeWidth="4">
      <path d="M14 18Q32 2 50 18" />
      <path d="M50 54Q32 70 14 54" />
    </g>
  </>
);

const flipDisc = (
  <>
    <path d="M32 10A22 22 0 0 0 32 54Z" fill="#34a853" />
    <path d="M32 10A22 22 0 0 1 32 54Z" fill="#e63b1f" />
    <circle cx="32" cy="32" r="22" fill="none" stroke="#fff" strokeWidth="3" />
    <svg x="16" y="16" width="32" height="32" viewBox="0 0 64 64" style={{ color: "#fff" }}>{revI}</svg>
  </>
);

const flipMono = (
  <>
    <circle cx="32" cy="32" r="23" fill="none" stroke="currentColor" strokeWidth="5" />
    <path d="M32 9V55" stroke="currentColor" strokeWidth="4" />
    <svg x="14" y="14" width="36" height="36" viewBox="0 0 64 64">{revI}</svg>
  </>
);

const peopleI = (
  <g fill="currentColor">
    <circle cx="32" cy="20" r="10" />
    <path d="M15 56Q15 33 32 33Q49 33 49 56Z" />
    <circle cx="10" cy="28" r="6" />
    <path d="M0 54Q0 40 10 40Q14 40 17 41Q11 46 11 54Z" />
    <circle cx="54" cy="28" r="6" />
    <path d="M64 54Q64 40 54 40Q50 40 47 41Q53 46 53 54Z" />
  </g>
);

function wheelI(colors: string[], n = 8) {
  const st = 360 / n;
  const pt = (a: number) => {
    const r = ((a - 90) * Math.PI) / 180;
    return [32 + 23 * Math.cos(r), 32 + 23 * Math.sin(r)];
  };
  const parts: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = pt(i * st);
    const b = pt(i * st + st);
    parts.push(
      <path key={i} d={`M32 32L${a[0].toFixed(1)} ${a[1].toFixed(1)}A23 23 0 0 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}Z`} fill={colors[i % colors.length]} />
    );
  }
  parts.push(<circle key="r" cx="32" cy="32" r="23" fill="none" stroke="#fff" strokeWidth="3" />);
  parts.push(<circle key="c" cx="32" cy="32" r="6" fill="#17181e" stroke="#fff" strokeWidth="2.5" />);
  parts.push(<polygon key="p" points="32,2 26,10 38,10" fill="#fff" />);
  return <>{parts}</>;
}

const wheelM = (
  <>
    <circle cx="32" cy="34" r="22" fill="none" stroke="currentColor" strokeWidth="6" />
    <circle cx="32" cy="34" r="6" fill="currentColor" />
    <polygon points="32,0 26,9 38,9" fill="currentColor" />
  </>
);

function cw(icon: ReactNode, text: string) {
  return <span style={{ display: "flex", alignItems: "center", gap: 1 }}>{icon}{text}</span>;
}

function fanN(n: number, dark = false) {
  return (
    <>
      {svg(fanC(dark ? DCOL : LCOL), 52)}
      <div className="dn">+{n}</div>
    </>
  );
}

const WB = <i className="wc" style={{ width: 56, height: 56 }} />;

// -------------------------------------------- face content resolution

interface FaceBits {
  corner: ReactNode;
  center: ReactNode;
  number?: boolean;
}

function bits(face: Face, flex?: { flexValue?: FlexValue | null; flipIcon?: boolean } | null): FaceBits {
  const v = face.value;
  if (/^[0-9]$/.test(v)) {
    const show = v === "6" || v === "9" ? <span className="u">{v}</span> : v;
    const corner = flex?.flipIcon
      ? <span style={{ display: "flex", alignItems: "center", gap: 3 }}>{v}{svg(flipMono, 16)}</span>
      : v;
    return { corner, center: show, number: true };
  }
  switch (v) {
    case "skip":
      if (flex?.flexValue === "skipEveryone") return { corner: svg(skipX, 18), center: svg(skipI) };
      return { corner: svg(skipI, 18), center: svg(skipI) };
    case "reverse":
      if (flex?.flexValue === "reverseSkip") {
        return { corner: <span style={{ display: "flex", alignItems: "center", gap: 1 }}>{svg(revI, 15)}{svg(skipI, 14)}</span>, center: svg(revI) };
      }
      return { corner: svg(revI, 19), center: svg(revI) };
    case "draw1": return { corner: "+1", center: <>{svg(fan2, 50)}<div className="dn">+1</div></> };
    case "draw2":
      if (flex?.flexValue === "allDraw1") return { corner: cw(svg(peopleI, 17), "+1"), center: <>{svg(fan2, 50)}<div className="dn">+2</div></> };
      return { corner: "+2", center: <>{svg(fan2, 50)}<div className="dn">+2</div></> };
    case "draw4": return { corner: "+4", center: <>{svg(fan2, 50)}<div className="dn">+4</div></> };
    case "draw5": return { corner: "+5", center: <>{svg(fan2, 50)}<div className="dn">+5</div></> };
    case "skipEveryone": return { corner: svg(skipX, 18), center: <>{svg(skipX, 50)}<div className="sm">ALL</div></> };
    case "discardAll":
      return {
        corner: svg(trashI("var(--c)"), 18),
        center: svg(trashI("color-mix(in srgb, var(--c) 14%, #17181e)"), 56),
      };
    case "flip": return { corner: svg(flipI, 18), center: svg(flipI) };
    default:
      return { corner: v, center: v };
  }
}

function wildBits(v: FaceValue, dark: boolean): FaceBits {
  switch (v) {
    case "wild": return { corner: "W", center: "" };
    case "wildReverse": return { corner: svg(revI, 19), center: svg(revI, 48) };
    case "wildSkip": return { corner: svg(skipI, 18), center: svg(skipI, 50) };
    case "wildSkipTwo":
      return { corner: cw(svg(skipI, 18), "×2"), center: <>{svg(skipI, 48)}<div className="sm">×2</div></> };
    case "wildTargetDraw2":
      return { corner: cw(svg(crossI, 17), "+2"), center: <>{svg(crossI, 46)}<div className="dn">+2</div></> };
    case "wildSwap": return { corner: svg(swapI, 18), center: svg(swapI, 52) };
    case "wildDraw2": return { corner: "+2", center: fanN(2, dark) };
    case "wildDraw4": return { corner: "+4", center: fanN(4, dark) };
    case "wildDraw6": return { corner: "+6", center: fanN(6, dark) };
    case "wildDraw10": return { corner: "+10", center: fanN(10, dark) };
    case "wildReverseDraw4":
      return { corner: "+4⇄", center: <>{svg(revI, 40)}<div className="dn">+4</div></> };
    case "wildColorRoulette":
      return { corner: svg(wheelM, 22), center: svg(wheelI(LCOL, 8), 64) };
    case "wildDrawColor":
      return {
        corner: svg(wheelM, 22),
        center: <>{svg(wheelI(DCOL, 8), 56)}<div className="sm">DRAW COLOR</div></>,
      };
    case "wildAllFlip":
      // source shares FFM for the corner index and FFC for the face
      return {
        corner: svg(flipMono, 22),
        center: <>{svg(flipDisc, 56)}<div className="sm">ALL FLIP</div></>,
      };
    default:
      return { corner: "W", center: "" };
  }
}

// -------------------------------------------- the card

export interface CardViewProps {
  face: Face;
  flipDark?: boolean;   // render flip-variant dark side styling
  flipLight?: boolean;  // render flip-variant light side styling
  flex?: { flexColor?: ColorName | null; flexValue?: FlexValue | null; flipIcon?: boolean } | null;
  useFlexArt?: boolean; // flex variant art (dotted flex color zone)
}

export function CardView({ face, flipDark, flipLight, flex, useFlexArt }: CardViewProps) {
  const isWild = face.color === "wild";
  const style: CSSProperties = {};
  const classes = ["card"];
  let corner: ReactNode;
  let center: ReactNode;
  let numberCls = false;

  if (isWild) {
    classes.push("wild");
    const wb = wildBits(face.value, !!flipDark);
    corner = wb.corner;
    center = wb.center;
    if (flipDark) classes.push("dk");
    const fxv = useFlexArt ? flex?.flexValue ?? null : null;
    if (fxv) classes.push("fa");
    // A flexed wild carries its action in the corner and the four colour blob
    // in the middle. Wild Draw Four keeps its fan: that card is a draw card
    // first and a targeted draw second.
    if (fxv === "targetDraw2") { corner = cw(svg(crossI, 16), "+2"); center = WB; }
    else if (fxv === "allDraw2") { corner = cw(svg(peopleI, 17), "+2"); center = WB; }
    else if (fxv === "targetDraw4") corner = cw(svg(crossI, 16), "+4");
    if (!center) classes.push("plain");
  } else {
    // fall back across both palettes so a face from the other side of a flip
    // keeps its own colour instead of falling through to the bare card
    const hex = flipDark
      ? DARK_COLORS[face.color] ?? LIGHT_COLORS[face.color] ?? "#17181e"
      : LIGHT_COLORS[face.color] ?? DARK_COLORS[face.color] ?? "#17181e";
    (style as Record<string, string>)["--c"] = hex;
    const b = bits(face, flex);
    corner = b.corner;
    center = b.center;
    numberCls = !!b.number;
    if (flipLight) classes.push("lt");
    if (flipDark) classes.push("dks");
    if (useFlexArt && flex?.flexColor) {
      // flex number: the oval keeps the main colour, the field takes the flex colour
      classes.push("fx");
      (style as Record<string, string>)["--c2"] = LIGHT_COLORS[flex.flexColor] ?? "#888";
    } else if (useFlexArt && flex?.flexValue) {
      // flex action: one colour only, marked by the dotted face
      classes.push("fa");
    }
  }

  return (
    <div className={classes.join(" ")} style={style}>
      <b className="c tl">{corner}</b>
      {/* source: a flip icon number uses .s with an inner .nn, which supplies
          the skew itself. Plain numbers use .s.n. Using both double skews. */}
      <div className={numberCls && !flex?.flipIcon ? "s n" : "s"}>
        {numberCls && flex?.flipIcon ? <span className="nn">{center}</span> : center}
      </div>
      <b className="c br">{corner}</b>
    </div>
  );
}

// Generic card back for hidden piles
export function CardBack({ label = "UNO" }: { label?: string }) {
  return (
    <div className="card wild plain">
      <b className="c tl">UNO</b>
      <div className="s n" style={{ fontSize: 34 }}>
        <span style={{ transform: "rotate(-24deg)", display: "block" }}>{label}</span>
      </div>
      <b className="c br">UNO</b>
    </div>
  );
}

// Power token (flex variant)
export function TokView({ green }: { green: boolean }) {
  return (
    <div className="tok" style={{ "--c": green ? "#34a853" : "#e63b1f" } as CSSProperties}>
      <svg viewBox="0 0 64 64" width="58" height="58" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
        {green ? <path d="M12 34L26 48L52 16" /> : <path d="M16 16L48 48M48 16L16 48" />}
      </svg>
    </div>
  );
}

export function colorHex(name: ColorName): string {
  return LIGHT_COLORS[name] ?? DARK_COLORS[name] ?? "#17181e";
}
