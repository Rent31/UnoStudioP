"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Ban, Bot, ChevronLeft, ChevronRight, Crown, FastForward, Flag, Layers, Link2, LogOut, Pencil,
  ScrollText, Shield, Trophy, Users, X,
} from "lucide-react";
import type { ViewData, PlayerView, HandCardView } from "@/lib/client";
import type { ActFn } from "@/components/RoomClient";
import type { ColorName, Face, FlexValue } from "@/lib/game/model";
import { VARIANT_META, valueLabel } from "@/lib/game/model";
import { describeCard } from "@/lib/game/cardinfo";
import { CardView, CardBack, TokView, colorHex } from "@/components/CardView";
import { ThemeToggle, SoundToggle } from "@/components/Toggles";
import { playSound } from "@/lib/sound";
import { useHold } from "@/lib/useHold";
import { useMedia } from "@/lib/useMedia";
import { useFluidScale } from "@/lib/useFluidScale";
import { useDragScroll } from "@/lib/useDragScroll";
import PlayerList from "@/components/PlayerList";
import SidePanel from "@/components/SidePanel";

const LIGHT_SET: ColorName[] = ["red", "yellow", "green", "blue"];
const DARK_SET: ColorName[] = ["pink", "teal", "orange", "purple"];
const ORDER: Record<string, number> = { red: 0, yellow: 1, green: 2, blue: 3, pink: 0, orange: 1, teal: 2, purple: 3, wild: 9 };

function faceOf(view: ViewData, c: { light: Face; dark: Face | null }): Face {
  return view.side === "dark" && c.dark ? c.dark : c.light;
}

interface Inspect { face: Face; flexColor?: ColorName | null; flexValue?: FlexValue | null; flipIcon?: boolean; dark?: boolean; light?: boolean; note?: string }

export default function Game({ code, view, meId, act, onLeave }: {
  code: string; view: ViewData; meId: string; act: ActFn; onLeave: () => void;
}) {
  const me = view.players.find((p) => p.id === meId);
  const myIdx = view.players.findIndex((p) => p.id === meId);

  const opponents = useMemo(() => {
    const out: PlayerView[] = [];
    const n = view.players.length;
    for (let i = 1; i <= n; i++) {
      const p = view.players[(myIdx + i) % n];
      if (p && !p.left && p.id !== meId) out.push(p);
    }
    return out;
  }, [view.players, myIdx, meId]);

  const [off, setOff] = useState(0);
  const [sel, setSel] = useState<HandCardView | null>(null);
  const [selColor, setSelColor] = useState<ColorName | null>(null);
  const [selTarget, setSelTarget] = useState<string | null>(null);
  const [selFlex, setSelFlex] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [renaming, setRenaming] = useState<PlayerView | null>(null);
  const [rnName, setRnName] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const seenSeq = useRef(0);
  const feltRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  // the log docks beside the table on wide screens and becomes a sheet below 720px
  const docked = useMedia("(min-width: 720px)");
  useFluidScale(feltRef, handRef, {
    maxOpponentCards: Math.max(1, ...view.players.filter((p) => p.id !== meId && !p.left).map((p) => p.cardCount), 1),
  });
  // a large hand overflows to the right: swipe it (touch) or drag/wheel it (mouse)
  useDragScroll(handRef);
  const [invited, setInvited] = useState(false);

  const copyInvite = async () => {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url; el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      try { document.execCommand("copy"); } catch {}
      el.remove();
    }
    setInvited(true);
    setTimeout(() => setInvited(false), 1600);
    playSound("click");
  };

  const orderedPlayers = useMemo(() => {
    const seated = view.players.filter((p) => !p.left);
    if (view.direction === 1) return seated;
    const me0 = seated.findIndex((p) => p.id === meId);
    if (me0 < 0) return seated;
    const out = [seated[me0]];
    for (let i = 1; i < seated.length; i++) out.push(seated[(me0 - i + seated.length * 2) % seated.length]);
    return out;
  }, [view.players, view.direction, meId]);

  // Seats are shown a page at a time, three to a page. A short final page
  // simply fills the left and top slots and leaves the rest empty.
  const pageCount = Math.max(1, Math.ceil(opponents.length / 3));
  const page = Math.min(off, pageCount - 1);
  // With only one opponent there is no left/right ring to speak of: park them
  // at the top of the table instead of off to one side.
  const ring: (PlayerView | undefined)[] = opponents.length === 1
    ? [undefined, opponents[0], undefined]
    : opponents.slice(page * 3, page * 3 + 3);
  const outside = opponents.filter((p) => !ring.includes(p));

  const isFlip = view.variant === "flip";
  const isFlex = view.variant === "flex";
  const isAllWild = view.variant === "allwild";
  const myTurn = !!me?.isTurn && view.phase === "playing";
  const colorSet = view.side === "dark" ? DARK_SET : LIGHT_SET;
  const top = view.topCard;
  const topFace = top ? faceOf(view, top) : null;

  const hand = useMemo(() => {
    const h = [...(me?.hand ?? [])];
    h.sort((a, b) => {
      const fa = faceOf(view, a), fb = faceOf(view, b);
      const d = ORDER[fa.color] - ORDER[fb.color];
      return d !== 0 ? d : fa.value.localeCompare(fb.value);
    });
    return h;
  }, [me?.hand, view]);

  useEffect(() => {
    for (const e of view.events) {
      if (e.seq <= seenSeq.current) continue;
      seenSeq.current = e.seq;
      if (e.type === "flip" && !e.msg.includes("token")) setBanner(view.side === "dark" ? "Dark side" : "Light side");
      if (e.type === "catch") setBanner("Caught");
      if (e.type === "eliminate") setBanner("Knocked out");
      // a successful UNO call is loud: banner, badge on the seat, and the sound
      if (e.type === "uno") setBanner(`${e.actor ?? "Someone"} called UNO`);
    }
  }, [view.events, view.side]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1300);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => { setSel(null); setSelColor(null); setSelTarget(null); setSelFlex(false); }, [view.turnStage, me?.cardCount, myTurn]);

  if (!me) return null;

  const challengeMine = view.challenge?.targetId === meId;
  const blocked = !!view.challenge || !!view.flipColorChoice || !!view.roulette;

  // A color pull in progress: one card at a time, every card face up for the
  // whole table, until the named color turns up.
  const roulette = view.roulette;
  const rouletteColor = roulette?.color ? roulette.color[0].toUpperCase() + roulette.color.slice(1) : null;
  const rouletteShown = roulette ? roulette.drawn.slice(-10) : [];
  const rouletteHidden = roulette ? roulette.drawn.length - rouletteShown.length : 0;

  // Whether a given side of a card actually asks you to pick a player. A
  // flexed Skip becomes Skip Everyone, so there is nobody to aim it at, and a
  // plain Skip only aims when the Targeted Skip house rule is on.
  const needsTargetFor = (c: HandCardView, useFlex: boolean): boolean => {
    const eff = useFlex && c.flexValue ? c.flexValue : faceOf(view, c).value;
    switch (eff) {
      case "wildSwap":
      case "wildTargetDraw2":
      case "targetDraw2":
      case "targetDraw4":
        return true;
      case "7":
        return view.variant === "nomercy";
      case "skip":
        return view.rules.targetedSkip && !useFlex;
      default:
        return false;
    }
  };

  const tapCard = (c: HandCardView) => {
    if (!myTurn || blocked) return;
    const f = faceOf(view, c);
    const canNormal = !!c.playable;
    const canFlexOnly = !!c.flexPlayable && !canNormal;
    if (!canNormal && !canFlexOnly) { playSound("error"); return; }
    const wild = f.color === "wild";
    // a color roulette is named by the player who has to pull, not here
    const needsColor = wild && !isAllWild && f.value !== "wildSwap" && f.value !== "wildTargetDraw2" && f.value !== "wildColorRoulette";
    const needsTarget = needsTargetFor(c, canFlexOnly);
    const flexChoice = canNormal && !!c.flexUpgradable;
    if (canFlexOnly && !needsColor && !needsTarget) { act("play", { cardId: c.id, useFlex: true }); return; }
    if (!needsColor && !needsTarget && !flexChoice) { playSound("click"); act("play", { cardId: c.id }); return; }
    playSound("click");
    setSel(c); setSelColor(null); setSelTarget(null); setSelFlex(!!c.flexPlayable);
  };

  const confirmPlay = () => {
    if (!sel) return;
    const f = faceOf(view, sel);
    const wild = f.color === "wild";
    const needsColor = wild && !isAllWild && f.value !== "wildSwap" && f.value !== "wildTargetDraw2" && f.value !== "wildColorRoulette";
    if (needsColor && !selColor) { playSound("error"); return; }
    const useFlex = !!sel.flexPlayable || selFlex;
    const effVal = useFlex && sel.flexValue ? sel.flexValue : f.value;
    const hardTarget = effVal === "wildSwap" || effVal === "wildTargetDraw2" || effVal === "targetDraw2" ||
      effVal === "targetDraw4" || (effVal === "7" && view.variant === "nomercy" && liveOpponents.length > 0);
    if (hardTarget && !selTarget) { playSound("error"); return; }
    act("play", { cardId: sel.id, color: needsColor ? selColor : undefined, targetId: selTarget ?? undefined, useFlex: useFlex || undefined });
    setSel(null);
  };

  const selFace = sel ? faceOf(view, sel) : null;
  const selEff = sel && (selFlex && sel.flexValue ? sel.flexValue : selFace?.value);
  const selWantsTarget = !!sel && needsTargetFor(sel, selFlex || !!sel.flexPlayable);
  const liveOpponents = opponents.filter((o) => !o.eliminated);
  // No Mercy forces the swap: there is no keeping your hand unless there is
  // genuinely nobody left to trade with
  const forcedSwap = selEff === "7" && view.variant === "nomercy" && liveOpponents.length > 0;
  const selOptionalTarget = selEff === "skip" || (selEff === "7" && !forcedSwap);

  const status = (() => {
    if (view.phase !== "playing") return "";
    if (view.challenge) return challengeMine ? `${view.challenge.byName} hit you with a Draw 4` : "A Draw 4 is being challenged";
    if (view.flipColorChoice) return view.flipColorChoice.playerId === meId ? "Pick a color" : "Waiting on a color";
    if (roulette) {
      if (!rouletteColor) return roulette.chooserId === meId ? "Name the color to pull for" : `Waiting for ${roulette.chooserName} to name a color`;
      if (roulette.done) return `${roulette.pullerName} hit ${rouletteColor}`;
      return roulette.pullerId === meId ? `Pull until ${rouletteColor}` : `${roulette.pullerName} pulls until ${rouletteColor}`;
    }
    if (me?.spectator) return "You are watching this game";
    if (myTurn) {
      if (view.pendingDraw > 0) return `Stack it or take ${view.pendingDraw}`;
      if (view.turnStage === "drewCard") return "Play it or pass";
      if (view.turnStage === "double") return "Play a second card or end turn";
      return "Your turn";
    }
    const cur = view.players.find((p) => p.isTurn);
    return cur ? `${cur.name}'s turn` : "";
  })();

  const seatCommon = { view, isFlip, isFlex };

  return (
    <main className="h-dvh flex flex-col overflow-hidden select-none transition-[padding] duration-200"
      style={{ paddingRight: showLog && docked ? "var(--panel-w)" : 0 }}>
      <header className="flex items-center gap-2 px-3 md:px-5 h-12 border-b border-[var(--line)] shrink-0">
        <span className="mono text-[12px] font-semibold tracking-[0.12em]">{code}</span>
        <span className="chip">{VARIANT_META[view.variant].name}</span>
        {isFlip && <span className="chip">{view.side === "dark" ? "Dark" : "Light"}</span>}
        {view.pendingDraw > 0 && <span className="chip !border-[var(--acc)] !text-[var(--acc)]">+{view.pendingDraw}</span>}
        {me?.spectator && <span className="chip">Watching</span>}
        <span className="ml-auto flex items-center gap-2">
          {!isAllWild && <i className="w-4 h-4 border border-black/25" style={{ background: colorHex(view.currentColor) }} />}
          {view.iAmAdmin && <button className="iconbtn" onClick={() => setShowAdmin(true)} title="Admin"><Shield size={14} /></button>}
          <button className={`iconbtn ${showLog ? "on" : ""}`} onClick={() => setShowLog(!showLog)} title="Log"><ScrollText size={14} /></button>
          <SoundToggle />
          <ThemeToggle />
        </span>
      </header>

      {view.turnMsLeft !== null && view.rules.turnTimer > 0 && view.phase === "playing" && (
        <div className="h-[2px] bg-[var(--line)] shrink-0">
          <div className="timerbar h-full" style={{ width: `${Math.max(0, Math.min(100, (view.turnMsLeft / (view.rules.turnTimer * 1000)) * 100))}%` }} />
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--line)] overflow-x-auto shrink-0">
        {orderedPlayers.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && (
              <span className="text-[var(--line2)] text-[10px]">{view.direction === 1 ? "\u203a" : "\u2039"}</span>
            )}
            <span
              className={`chip shrink-0 ${p.isTurn ? "!border-white !text-[var(--gold)]" : ""} ${p.eliminated ? "opacity-40 line-through" : ""} ${p.id === meId ? "!text-[var(--ink)] font-semibold" : ""}`}
            >
              {p.name}<span className="text-[var(--mut)]">{p.cardCount}</span>
              {p.calledUno && !p.eliminated && p.cardCount > 0 && <span className="unotag !ml-0.5">UNO</span>}
            </span>
          </span>
        ))}
      </div>

      {/* table */}
      <div ref={feltRef} className="felt flex-1 min-h-0 relative overflow-hidden flex justify-center">
        <div
          className="w-full max-w-[860px] h-full px-1.5 py-2 grid gap-x-2"
          style={{
            // equal side columns keep the pile centred even when a seat is empty,
            // and space-evenly spreads the rows instead of pooling dead space
            gridTemplateColumns: "1fr auto 1fr",
            gridTemplateRows: "auto auto",
            alignContent: "space-evenly",
          }}
        >
        <div className="col-span-3 flex justify-center items-start">
          {ring[1] && <Seat key={ring[1].id} p={ring[1]} edge="top" {...seatCommon} />}
        </div>

        <div className="flex items-center justify-start min-w-0">
          {ring[0] && <Seat key={ring[0].id} p={ring[0]} edge="left" {...seatCommon} />}
        </div>

        <div className="grid place-items-center min-w-0">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[12px] text-[var(--ink2)] min-h-4 text-center px-2 mb-1">{status}</p>

            <div className="flex items-center gap-4 md:gap-7">
              <HoldArea
                className={`cardwrap lift [--k:var(--k-pile)] ${myTurn && !blocked && view.turnStage === "play" ? "playable" : ""}`}
                onHold={() => { playSound("click"); setInspect({ face: { color: "wild", value: "wild" }, note: `Draw pile, ${view.drawCount} cards left. Tap to draw when it is your turn.` }); }}
                onTap={() => { if (myTurn && !blocked && view.turnStage === "play") { playSound("click"); act("draw"); } }}
              >
                {isFlip && view.drawTopBackSide
                  ? <CardView face={view.drawTopBackSide} flipDark={view.side === "light"} flipLight={view.side === "dark"} />
                  : <CardBack />}
              </HoldArea>

              <HoldArea
                key={top?.id ?? "none"}
                className={`cardwrap a-drop [--k:var(--k-pile)] ${isAllWild ? "" : "colorlit"}`}
                style={isAllWild ? undefined : ({ "--lit": colorHex(view.currentColor) } as CSSProperties)}
                onHold={() => {
                  if (!topFace || !top) return;
                  playSound("click");
                  setInspect({
                    face: topFace, flexColor: top.flexColor, flexValue: top.flexValue, flipIcon: top.flipIcon,
                    dark: isFlip && view.side === "dark", light: isFlip && view.side === "light",
                  });
                }}
              >
                {topFace && top
                  ? <CardView
                      face={topFace}
                      flipDark={isFlip && view.side === "dark"}
                      flipLight={isFlip && view.side === "light"}
                      flex={isFlex ? { flexColor: top.flexColor, flexValue: top.flexValue, flipIcon: top.flipIcon } : null}
                      useFlexArt={isFlex}
                    />
                  : <CardBack />}
              </HoldArea>
            </div>

            {roulette && (
              <div className="flex flex-col items-center gap-1.5 a-fade w-full px-1">
                <span className="text-[11px] text-[var(--ink2)] text-center">
                  {roulette.done
                    ? `${roulette.pullerName} hit ${rouletteColor} in ${roulette.drawn.length}`
                    : !rouletteColor
                      ? `${roulette.chooserId === meId ? "You name" : `${roulette.chooserName} names`} the color to pull for`
                      : `${roulette.pullerId === meId ? "You pull" : `${roulette.pullerName} pulls`} until ${rouletteColor} · ${roulette.drawn.length} so far`}
                </span>
                <div className="flex items-center justify-center gap-1 flex-wrap max-w-[min(520px,84vw)] min-h-[46px]">
                  {rouletteHidden > 0 && <span className="text-[11px] text-[var(--mut)] pr-0.5">+{rouletteHidden}</span>}
                  {rouletteShown.map((c, i) => (
                    <span
                      key={c.id}
                      className={`cardwrap [--k:var(--k-seat)] ${i === rouletteShown.length - 1 ? "a-pop" : ""} ${roulette.done && i === rouletteShown.length - 1 ? "roulettehit" : ""}`}
                    >
                      <CardView
                        face={faceOf(view, c)}
                        flipDark={isFlip && view.side === "dark"}
                        flipLight={isFlip && view.side === "light"}
                        flex={isFlex ? { flexColor: c.flexColor, flexValue: c.flexValue, flipIcon: c.flipIcon } : null}
                        useFlexArt={isFlex}
                      />
                    </span>
                  ))}
                  {roulette.drawn.length === 0 && <span className="text-[11px] text-[var(--mut)]">nothing pulled yet</span>}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-[var(--mut)]">
              {pageCount > 1 && (
                <button className="iconbtn !w-7 !h-7" disabled={page === 0}
                  onClick={() => { setOff(page - 1); playSound("click"); }} title="Previous players">
                  <ChevronLeft size={13} />
                </button>
              )}
              <span className="flex items-center gap-1"><Layers size={11} />{view.drawCount}</span>
              <span className="hidden xs:inline">{view.discardCount} played</span>
              {pageCount > 1 && <span className="tabular-nums">{page + 1}/{pageCount}</span>}
              {pageCount > 1 && (
                <button className="iconbtn !w-7 !h-7" disabled={page >= pageCount - 1}
                  onClick={() => { setOff(page + 1); playSound("click"); }} title="More players">
                  <ChevronRight size={13} />
                </button>
              )}
            </div>

            {view.challenge && challengeMine && (
              <div className="flex gap-2 a-pop">
                <button className="btn sm acc" onClick={() => act("challenge", { value: false })}>Take 4</button>
                <button className="btn sm danger" onClick={() => act("challenge", { value: true })}>Challenge</button>
              </div>
            )}
            {view.flipColorChoice?.playerId === meId && (
              <div className="flex gap-2 a-pop">
                {colorSet.map((c) => (
                  <button key={c} className="swatch !w-9 !h-9" style={{ background: colorHex(c) }} onClick={() => act("chooseColor", { color: c })} aria-label={c} />
                ))}
              </div>
            )}
            {roulette && roulette.chooserId === meId && !roulette.color && (
              <div className="flex gap-2 a-pop">
                {colorSet.map((c) => (
                  <button key={c} className="swatch !w-9 !h-9" style={{ background: colorHex(c) }} onClick={() => { playSound("click"); act("rouletteColor", { color: c }); }} aria-label={c} />
                ))}
              </div>
            )}
            {roulette && roulette.pullerId === meId && roulette.color && !roulette.done && (
              <button className="btn sm acc a-pop" onClick={() => { playSound("click"); act("roulettePull"); }}>Pull a card</button>
            )}
            {myTurn && !blocked && view.turnStage === "drewCard" && <button className="btn sm ghost a-pop" onClick={() => act("pass")}>Pass</button>}
            {myTurn && !blocked && view.turnStage === "double" && <button className="btn sm ghost a-pop" onClick={() => act("endDouble")}>End turn</button>}
          </div>
        </div>

        <div className="flex items-center justify-end min-w-0">
          {ring[2] && <Seat key={ring[2].id} p={ring[2]} edge="right" {...seatCommon} />}
        </div>
        </div>

        {banner && (
          <div className="absolute inset-0 grid place-items-center z-30 pointer-events-none">
            <div className="flipbanner bg-[var(--ink)] text-[var(--bg)] px-7 py-3.5">
              <span className="disp text-2xl md:text-4xl">{banner}</span>
            </div>
          </div>
        )}
      </div>

      {/* selection tray */}
      {sel && selFace && (
        <div className="shrink-0 border-t border-[var(--line)] bg-[var(--surf)] px-3 py-2.5 a-fade">
          <div className="max-w-3xl mx-auto flex items-center gap-3 flex-wrap">
            <span className="cardwrap [--k:.2]">
              <CardView face={selFace} flipDark={isFlip && view.side === "dark"} flipLight={isFlip && view.side === "light"}
                flex={isFlex ? { flexColor: sel.flexColor, flexValue: sel.flexValue, flipIcon: sel.flipIcon } : null} useFlexArt={isFlex} />
            </span>
            <div className="flex-1 min-w-[190px] flex flex-col gap-2">
              {selFace.color === "wild" && !isAllWild && selFace.value !== "wildSwap" && selFace.value !== "wildTargetDraw2" && (
                <div className="flex items-center gap-2">
                  <span className="lbl w-12">Color</span>
                  {colorSet.map((c) => (
                    <button key={c} className={`swatch !w-7 !h-7 ${selColor === c ? "sel" : ""}`} style={{ background: colorHex(c) }} onClick={() => { setSelColor(c); playSound("click"); }} aria-label={c} />
                  ))}
                </div>
              )}
              {selWantsTarget && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="lbl w-12">{selEff === "7" ? "Swap" : selEff === "skip" ? "Skip" : "Target"}</span>
                  {liveOpponents.map((o) => (
                    <button key={o.id} className={`btn xs ${selTarget === o.id ? "acc" : "ghost"}`} onClick={() => { setSelTarget(o.id); playSound("click"); }}>{o.name}</button>
                  ))}
                  {selOptionalTarget && (
                    <button className={`btn xs ${selTarget === null ? "acc" : "ghost"}`} onClick={() => setSelTarget(null)}>
                      {selEff === "7" ? "Keep" : "Next"}
                    </button>
                  )}
                </div>
              )}
              {sel.flexUpgradable && !sel.flexPlayable && (
                <button className="flex items-center gap-2" onClick={() => { setSelFlex(!selFlex); setSelTarget(null); playSound("click"); }}>
                  <span className={`sw ${selFlex ? "on" : ""}`}><i /></span>
                  <span className="text-[12px] text-[var(--ink2)]">Flex: {valueLabel(sel.flexValue!)}</span>
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn sm acc" onClick={confirmPlay}>Play</button>
              <button className="btn sm ghost" onClick={() => setSel(null)}><X size={13} /></button>
            </div>
          </div>
        </div>
      )}

      {/* my area */}
      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--bg2)] relative">
        <div className="flex items-center gap-2.5 px-3 pt-2">
          <span className={`text-[13px] font-semibold ${myTurn ? "text-[var(--gold)]" : ""}`}>{me.name}</span>
          {view.targetScore > 0 && <span className="text-[11px] text-[var(--mut)]">{me.score} pts</span>}
          {me.wins > 0 && <span className="text-[11px] text-[var(--gold)]">{me.wins} {me.wins === 1 ? "win" : "wins"}</span>}
          {me.spectator
            ? <span className="text-[11px] text-[var(--mut)]">watching, no hand</span>
            : <span className="text-[11px] text-[var(--mut)]">{me.cardCount} cards</span>}
          {isFlex && (
            <span className="flex items-center gap-1">
              <span className="tokwrap pointer-events-none" style={{ "--k": 0.12 } as never}><TokView green={me.powerGreen} /></span>
              <span className="text-[11px] text-[var(--mut)]">{me.powerGreen ? "ready" : "spent"}</span>
            </span>
          )}

        </div>

        <div ref={handRef} className={`handscroll ${myTurn && !blocked ? "myturn" : ""}`}>
          {/* cards keep their size however big the hand gets: the row runs off the right edge and this strip scrolls (swipe, drag, or wheel) */}
          <div className="handrow">
            {hand.map((c, i) => {
              const f = faceOf(view, c);
              const playable = myTurn && !blocked && c.playable;
              const flexable = myTurn && !blocked && !c.playable && c.flexPlayable;
              return (
                <HoldArea
                  key={c.id}
                  className={`cardwrap lift [--k:var(--k-hand)] ${playable ? "playable" : ""} ${flexable ? "flexable" : ""} ${sel?.id === c.id ? "sel" : ""}`}
                  style={{ zIndex: i }}
                  onHold={() => {
                    playSound("click");
                    setInspect({
                      face: f, flexColor: c.flexColor, flexValue: c.flexValue, flipIcon: c.flipIcon,
                      dark: isFlip && view.side === "dark", light: isFlip && view.side === "light",
                    });
                  }}
                  onTap={() => tapCard(c)}
                >
                  <CardView
                    face={f}
                    flipDark={isFlip && view.side === "dark"}
                    flipLight={isFlip && view.side === "light"}
                    flex={isFlex ? { flexColor: c.flexColor, flexValue: c.flexValue, flipIcon: c.flipIcon } : null}
                    useFlexArt={isFlex}
                  />
                </HoldArea>
              );
            })}
            {hand.length === 0 && <p className="text-[12px] text-[var(--mut)] py-8 px-4">No cards</p>}
          </div>
        </div>

        {view.phase === "playing" && (
          <button
            className="unobtn absolute right-3 md:right-6 top-0 -translate-y-1/2 z-30"
            onClick={() => { playSound("uno"); act("uno"); }}
          >
            UNO
          </button>
        )}
      </div>

      {inspect && (
        <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center px-5 a-in" onClick={() => setInspect(null)}>
          <div className="panel w-full max-w-[330px] p-5 flex flex-col items-center text-center a-pop" onClick={(e) => e.stopPropagation()}>
            <span className="cardwrap pointer-events-none" style={{ "--k": 0.78 } as never}>
              <CardView
                face={inspect.face}
                flipDark={inspect.dark}
                flipLight={inspect.light}
                flex={isFlex ? { flexColor: inspect.flexColor, flexValue: inspect.flexValue, flipIcon: inspect.flipIcon } : null}
                useFlexArt={isFlex}
              />
            </span>
            {(() => {
              const info = describeCard(inspect.face, view.variant, {
                flexColor: inspect.flexColor, flexValue: inspect.flexValue, flipIcon: inspect.flipIcon, rules: view.rules,
              });
              return (
                <>
                  <p className="text-[14px] font-semibold capitalize mt-4">{inspect.note ? "Draw pile" : info.title}</p>
                  <p className="text-[12px] text-[var(--mut)] leading-snug mt-1.5">{inspect.note ?? info.text}</p>
                </>
              );
            })()}
            <button className="btn ghost sm w-full mt-4" onClick={() => setInspect(null)}>Close</button>
          </div>
        </div>
      )}

      {showLog && <SidePanel view={view} meId={meId} act={act} onClose={() => setShowLog(false)} />}

      {showAdmin && (
        <AdminPanel view={view} meId={meId} act={act} onClose={() => setShowAdmin(false)} onLeave={onLeave}
          onInvite={copyInvite} invited={invited}
          onRename={(p) => { setRenaming(p); setRnName(p.name); }} />
      )}

      {renaming && (
        <div className="fixed inset-0 z-50 bg-black/55 grid place-items-center px-4 a-in" onClick={() => setRenaming(null)}>
          <div className="panel w-full max-w-[340px] p-5 a-pop" onClick={(e) => e.stopPropagation()}>
            <p className="lbl mb-2">Rename {renaming.name}</p>
            <input autoFocus className="input" maxLength={14} value={rnName} onChange={(e) => setRnName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { act("rename", { targetId: renaming.id, name: rnName }); setRenaming(null); } }} />
            <div className="flex gap-2 mt-3">
              <button className="btn acc flex-1" onClick={() => { act("rename", { targetId: renaming.id, name: rnName }); setRenaming(null); }}>Save</button>
              <button className="btn ghost" onClick={() => setRenaming(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {view.phase === "roundOver" && <RoundOver view={view} act={act} meId={meId} onLeave={onLeave} />}
      {view.phase === "gameOver" && <GameOver view={view} act={act} meId={meId} onLeave={onLeave} />}
    </main>
  );
}

// -------------------------------------------------- press and hold wrapper
function HoldArea({ className, style, onHold, onTap, children }: {
  className?: string; style?: CSSProperties; onHold: () => void; onTap?: () => void; children: ReactNode;
}) {
  const handlers = useHold(onHold, onTap);
  return <button type="button" className={className} style={style} {...handlers}>{children}</button>;
}

// -------------------------------------------------- a card lying along a table edge
function RotCard({ kVar, deg, offset, z, children }: { kVar: string; deg: number; offset: number | string; z: number; children: ReactNode }) {
  return (
    <span className="rotcard" style={{ "--k": kVar, marginTop: offset, zIndex: z } as never}>
      <span className="cardwrap" style={{ "--k": kVar, transform: `rotate(${deg}deg)` } as never}>
        {children}
      </span>
    </span>
  );
}

// -------------------------------------------------- seat
function Seat({ p, edge, view, isFlip, isFlex }: {
  p: PlayerView; edge: "top" | "left" | "right";
  view: ViewData; isFlip: boolean; isFlex: boolean;
}) {
  const faces = p.otherSide;
  const count = p.cardCount;
  const side = edge !== "top";
  // the fitted overlap keeps a tall fan inside the table on short screens
  const shown = Math.min(count, side ? 10 : 14);
  const kVar = side ? "var(--k-seat-side)" : "var(--k-seat)";
  const ovVar = side ? "var(--seat-overlap, .4)" : String(Math.min(0.86, 0.16 + count * 0.032));
  const step = `calc(-120px * ${kVar} * ${ovVar})`;

  const cardAt = (i: number) =>
    isFlip && faces && faces[i]
      ? <CardView face={faces[i]} flipDark={view.side === "light"} flipLight={view.side === "dark"} />
      : <CardBack />;

  return (
    <div
      className={`seat ${p.isTurn ? "active" : ""} ${p.eliminated ? "out" : ""} px-1.5 py-1.5 a-fade`}
      style={side
        ? { width: "clamp(72px, 13vw, 136px)" }
        : { maxWidth: "min(470px, 72vw)" }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] font-semibold truncate flex-1">{p.name}</span>
        {p.isOwner && <Crown size={10} className="text-[var(--acc)] shrink-0" />}
        {p.isAdmin && !p.isOwner && <Shield size={9} className="text-[var(--gold)] shrink-0" />}
        {p.isBot && <Bot size={10} className="text-[var(--mut)] shrink-0" />}
        {isFlex && <span className={`w-1.5 h-1.5 shrink-0 ${p.powerGreen ? "bg-[var(--grn)]" : "bg-[var(--acc)]"}`} />}
        {p.calledUno && !p.eliminated && count > 0 && <span className="unotag shrink-0">UNO</span>}
        <span className="text-[11px] text-[var(--mut)] shrink-0">{count}</span>
      </div>

      {p.eliminated ? (
        <span className="text-[11px] text-[#ff6b52] flex items-center gap-1 py-1.5"><Ban size={10} /> out</span>
      ) : count === 0 ? (
        <span className="block text-[11px] text-[var(--mut)] py-1.5">empty</span>
      ) : side ? (
        <div className="flex flex-col items-center mt-1">
          {Array.from({ length: shown }).map((_, i) => (
            <RotCard key={i} kVar={kVar} deg={edge === "left" ? -90 : 90} offset={i === 0 ? 0 : step} z={i}>
              {cardAt(i)}
            </RotCard>
          ))}
          {count > shown && <span className="text-[10px] text-[var(--mut)] mt-1">+{count - shown}</span>}
        </div>
      ) : (
        <div className="fan mt-1 justify-center">
          {Array.from({ length: shown }).map((_, i) => (
            <span key={i} className="cardwrap pointer-events-none" style={{ "--k": kVar, marginLeft: i === 0 ? 0 : step, zIndex: i } as never}>
              {cardAt(i)}
            </span>
          ))}
          {count > shown && <span className="text-[10px] text-[var(--mut)] ml-1 self-center">+{count - shown}</span>}
        </div>
      )}

    </div>
  );
}

// -------------------------------------------------- admin
function AdminPanel({ view, meId, act, onClose, onRename, onLeave, onInvite, invited }: {
  view: ViewData; meId: string; act: ActFn; onClose: () => void;
  onRename: (p: PlayerView) => void; onLeave: () => void; onInvite: () => void; invited: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/45 a-in" onClick={onClose}>
      <aside className="absolute right-0 top-0 bottom-0 w-[310px] max-w-[92vw] panel border-l flex flex-col a-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--line)]">
          <span className="tabfont text-[14px]">Admin</span>
          <button className="iconbtn !w-7 !h-7" onClick={onClose}><X size={13} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3 border-b border-[var(--line)] space-y-2">
            <button className="btn sm ghost w-full" onClick={onInvite}><Link2 size={13} /> {invited ? "Link copied" : "Copy invite link"}</button>
            {view.phase === "playing" && (
              <>
                <button className="btn sm ghost w-full" onClick={() => act("skipTurn")}><FastForward size={13} /> Skip turn</button>
                <button className="btn sm danger w-full" onClick={() => { if (window.confirm("End the round now?")) act("endRound"); }}><Flag size={13} /> End round</button>
              </>
            )}
            {view.phase === "roundOver" && <button className="btn sm ghost w-full" onClick={() => act("nextRound")}><FastForward size={13} /> Next round</button>}
            {(view.phase === "roundOver" || view.phase === "gameOver") && <button className="btn sm ghost w-full" onClick={() => act("backToLobby")}>Back to lobby</button>}
            <button className="btn sm danger w-full" onClick={onLeave}><LogOut size={13} /> Leave</button>
          </div>
          <div className="px-4 py-3">
            <PlayerList
              players={view.players}
              meId={meId}
              admin={view.iAmAdmin}
              locked
              onReorder={() => {}}
              onShuffle={() => {}}
              onRename={onRename}
              onSetAdmin={(p, v) => act("setAdmin", { targetId: p.id, value: v })}
              onRemove={(p) => { if (p.isBot || window.confirm(`Remove ${p.name}?`)) act("kick", { targetId: p.id }); }}
              onAddBot={() => {}}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

// -------------------------------------------------- overlays
function RoundOver({ view, act, meId, onLeave }: { view: ViewData; act: ActFn; meId: string; onLeave: () => void }) {
  const winner = view.players.find((p) => p.id === view.roundWinnerId);
  const goalMode = view.targetScore > 0;
  const rows = view.players.filter((p) => !p.left)
    .map((p) => ({ p, s: view.scoresAtRound.find((x) => x.playerId === p.id) }))
    .sort((a, b) => goalMode
      ? (b.s?.total ?? 0) - (a.s?.total ?? 0)
      : (b.s?.wins ?? b.p.wins) - (a.s?.wins ?? a.p.wins));
  return (
    <Overlay>
      <p className="lbl">Round {view.round}</p>
      <h2 className="disp text-4xl md:text-5xl mt-1">{winner ? winner.name : "No winner"}</h2>
      {view.roundNote && <p className="text-[12px] text-[var(--mut)] mt-1">{view.roundNote}</p>}
      <div className="w-full max-w-[360px] mt-5 panel">
        {rows.map(({ p, s }, i) => (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-[var(--line)]" : ""} ${p.id === meId ? "bg-[var(--surf2)]" : ""}`}>
            <span className="text-[13px] flex-1 text-left truncate">{p.name}</span>
            {goalMode && (s?.gained ?? 0) > 0 && <span className="text-[12px] text-[var(--grn)]">+{s?.gained}</span>}
            {goalMode && <span className="text-[13px] font-semibold w-12 text-right">{s?.total ?? 0}</span>}
            <span className="text-[12px] text-[var(--gold)] w-14 text-right">
              {s?.wins ?? p.wins} {(s?.wins ?? p.wins) === 1 ? "win" : "wins"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-5 flex-wrap justify-center">
        {view.iAmAdmin ? (
          <>
            <button className="btn acc" onClick={() => act("nextRound")}>Play again</button>
            <button className="btn ghost" onClick={() => act("backToLobby")}>Lobby</button>
          </>
        ) : (
          <span className="text-[12px] text-[var(--mut)] a-pulse self-center">Waiting for the admin</span>
        )}
        <button className="btn ghost" onClick={onLeave}>Leave</button>
      </div>
    </Overlay>
  );
}

function GameOver({ view, act, meId, onLeave }: { view: ViewData; act: ActFn; meId: string; onLeave: () => void }) {
  const goalMode = view.targetScore > 0;
  const rows = view.players.filter((p) => !p.left).slice()
    .sort((a, b) => goalMode ? b.score - a.score : b.wins - a.wins);
  const champ = rows[0];
  return (
    <Overlay>
      <Trophy size={22} className="text-[var(--gold)]" />
      <h2 className="disp text-5xl md:text-6xl mt-2" style={{ color: "var(--gold)" }}>{champ?.name}</h2>
      <p className="text-[12px] text-[var(--mut)] mt-1">
        {goalMode ? `${champ?.score} points` : `${champ?.wins} ${champ?.wins === 1 ? "win" : "wins"}`}
      </p>
      <div className="w-full max-w-[360px] mt-5 panel">
        {rows.map((p, i) => (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-[var(--line)]" : ""} ${p.id === meId ? "bg-[var(--surf2)]" : ""}`}>
            <span className="text-[13px] flex-1 text-left truncate">{p.name}</span>
            {goalMode && <span className="text-[13px] font-semibold w-12 text-right">{p.score}</span>}
            <span className="text-[12px] text-[var(--gold)] w-14 text-right">{p.wins} {p.wins === 1 ? "win" : "wins"}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-5 flex-wrap justify-center">
        {view.iAmAdmin
          ? <button className="btn acc" onClick={() => act("backToLobby")}>Play again</button>
          : <span className="text-[12px] text-[var(--mut)] a-pulse self-center">Waiting for the admin</span>}
        <button className="btn ghost" onClick={onLeave}>Leave</button>
      </div>
    </Overlay>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] overflow-y-auto a-in">
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-10 text-center a-fade">{children}</div>
    </div>
  );
}
