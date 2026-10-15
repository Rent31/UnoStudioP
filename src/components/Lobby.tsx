"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, LogOut, Play, ScrollText, X } from "lucide-react";
import type { ViewData, PlayerView } from "@/lib/client";
import {
  VARIANT_META, GENERAL_RULES, VARIANT_RULES, TIMER_OPTIONS, GOAL_OPTIONS,
  type Variant, type HouseRuleKey,
} from "@/lib/game/model";
import type { ActFn } from "@/components/RoomClient";
import { ThemeToggle, SoundToggle } from "@/components/Toggles";
import { playSound } from "@/lib/sound";
import { useMedia } from "@/lib/useMedia";
import PlayerList from "@/components/PlayerList";
import SidePanel from "@/components/SidePanel";

const VARIANTS: Variant[] = ["classic", "nomercy", "flip", "flex", "allwild"];

export default function Lobby({ code, view, meId, act, onLeave }: {
  code: string; view: ViewData; meId: string; act: ActFn; onLeave: () => void;
}) {
  const [tab, setTab] = useState<"game" | "players">("game");
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState(false);
  const [renaming, setRenaming] = useState<PlayerView | null>(null);
  const [rnName, setRnName] = useState("");
  const [customTimer, setCustomTimer] = useState("");
  const [customGoal, setCustomGoal] = useState("");
  const [showLog, setShowLog] = useState(false);

  const docked = useMedia("(min-width: 720px)");
  const seated = view.players.filter((p) => !p.left && !p.spectator);
  const watchers = view.players.filter((p) => !p.left && p.spectator);
  const admin = view.iAmAdmin;
  const timer = view.rules.turnTimer;
  const isPreset = (TIMER_OPTIONS as readonly number[]).includes(timer);

  useEffect(() => { if (!isPreset && timer > 0) setCustomTimer(String(timer)); }, [timer, isPreset]);

  const goal = view.rules.pointGoal;
  const goalPreset = (GOAL_OPTIONS as readonly number[]).includes(goal);
  useEffect(() => { if (!goalPreset && goal > 0) setCustomGoal(String(goal)); }, [goal, goalPreset]);

  const applyCustomGoal = () => {
    const n = Math.max(0, Math.min(9999, parseInt(customGoal, 10) || 0));
    setCustomGoal(n ? String(n) : "");
    setRule("pointGoal", n);
  };

  const writeClip = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try { document.execCommand("copy"); } catch {}
      el.remove();
    }
  };

  const copy = async () => {
    await writeClip(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    playSound("click");
  };

  const copyInvite = async () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/room/${code}` : code;
    await writeClip(url);
    setInvited(true);
    setTimeout(() => setInvited(false), 1600);
    playSound("click");
  };

  const setRule = (key: HouseRuleKey, value: boolean | number) => {
    if (!admin) return;
    playSound("click");
    act("setRule", { name: key, value });
  };

  const applyCustomTimer = () => {
    const n = Math.max(0, Math.min(120, parseInt(customTimer, 10) || 0));
    setCustomTimer(n ? String(n) : "");
    setRule("turnTimer", n);
  };

  const canRename = (p: PlayerView) => p.id === meId || admin;
  const canModerate = (p: PlayerView) => admin && !p.isOwner && p.id !== meId;

  return (
    <main className="min-h-dvh flex flex-col transition-[padding] duration-200" style={{ paddingRight: showLog && docked ? "var(--panel-w)" : 0 }}>
      <header className="flex items-center justify-between px-4 md:px-7 h-14 border-b border-[var(--line)]">
        <button className="iconbtn" onClick={onLeave} title="Leave"><LogOut size={15} /></button>
        <button onClick={copy} className="flex items-center gap-2.5 group">
          <span className="disp text-2xl tracking-[0.16em] leading-none pt-0.5">{code}</span>
          {copied
            ? <Check size={14} className="text-[var(--grn)]" />
            : <Copy size={13} className="text-[var(--mut)] group-hover:text-[var(--ink)] transition-colors" />}
        </button>
        <div className="flex items-center gap-2">
          <button className={`iconbtn ${invited ? "on" : ""}`} onClick={copyInvite} title="Copy invite link">
            {invited ? <Check size={15} /> : <Link2 size={15} />}
          </button>
          <button className={`iconbtn ${showLog ? "on" : ""}`} onClick={() => setShowLog(!showLog)} title="Log and chat">
            <ScrollText size={15} />
          </button>
          <SoundToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex border-b border-[var(--line)]">
        {(["game", "players"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); playSound("click"); }}
            className={`tabfont flex-1 md:flex-none md:px-9 py-3 text-[14px] relative transition-colors ${tab === t ? "text-[var(--ink)]" : "text-[var(--mut)] hover:text-[var(--ink2)]"}`}
          >
            {t === "game" ? "Game" : `Players ${seated.length}${watchers.length ? ` +${watchers.length}` : ""}`}
            {tab === t && <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-[var(--acc)] a-in" />}
          </button>
        ))}
      </div>

      <div className="flex-1 w-full max-w-2xl mx-auto px-4 md:px-7 py-6 pb-28">
        {tab === "game" ? (
          <div className="space-y-7 a-fade">
            <section>
              <h3 className="tabfont text-[14px] mb-3">Mode</h3>
              <div className="panel">
                {VARIANTS.map((v, i) => {
                  const sel = view.variant === v;
                  return (
                    <button
                      key={v}
                      disabled={!admin}
                      onClick={() => { playSound("click"); act("setVariant", { variant: v }); }}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${i > 0 ? "border-t border-[var(--line)]" : ""} ${sel ? "bg-[var(--surf2)]" : admin ? "hover:bg-[var(--surf2)]" : ""}`}
                    >
                      <span className={`w-2 h-2 mt-1.5 shrink-0 transition-colors ${sel ? "bg-[var(--acc)]" : "bg-[var(--line2)]"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold">{VARIANT_META[v].name}</span>
                        <span className="block text-[12px] text-[var(--mut)] leading-snug mt-0.5">{VARIANT_META[v].blurb}</span>
                      </span>

                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="tabfont text-[14px] mb-3">Point goal</h3>
              <div className="flex flex-wrap items-center gap-2">
                {GOAL_OPTIONS.map((g) => (
                  <button key={g} disabled={!admin} onClick={() => setRule("pointGoal", g)}
                    className={`btn sm ${goal === g ? "acc" : "ghost"}`}>
                    {g === 0 ? "Wins only" : g}
                  </button>
                ))}
                <span className={`flex items-center border ${!goalPreset && goal > 0 ? "border-[var(--acc)]" : "border-[var(--line2)]"}`}>
                  <input
                    className="w-[66px] bg-transparent px-2.5 py-[6px] text-[12px] outline-none"
                    placeholder="Custom"
                    inputMode="numeric"
                    disabled={!admin}
                    value={customGoal}
                    onChange={(e) => setCustomGoal(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                    onBlur={applyCustomGoal}
                    onKeyDown={(e) => { if (e.key === "Enter") applyCustomGoal(); }}
                  />
                  <span className="text-[11px] text-[var(--mut)] pr-2.5">pts</span>
                </span>
              </div>
              <p className="text-[12px] text-[var(--mut)] mt-2">
                {goal === 0
                  ? "No point target. Every round you take counts as a win."
                  : `First player to ${goal} points wins the game. Only full game wins are tallied, not rounds.`}
              </p>
            </section>

            <section>
              <h3 className="tabfont text-[14px] mb-3">Turn timer</h3>
              <div className="flex flex-wrap items-center gap-2">
                {TIMER_OPTIONS.map((t) => (
                  <button key={t} disabled={!admin} onClick={() => setRule("turnTimer", t)}
                    className={`btn sm ${timer === t ? "acc" : "ghost"}`}>
                    {t === 0 ? "Off" : `${t}s`}
                  </button>
                ))}
                <span className={`flex items-center border ${!isPreset && timer > 0 ? "border-[var(--acc)]" : "border-[var(--line2)]"}`}>
                  <input
                    className="w-[62px] bg-transparent px-2.5 py-[6px] text-[12px] outline-none"
                    placeholder="Custom"
                    inputMode="numeric"
                    disabled={!admin}
                    value={customTimer}
                    onChange={(e) => setCustomTimer(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                    onBlur={applyCustomTimer}
                    onKeyDown={(e) => { if (e.key === "Enter") applyCustomTimer(); }}
                  />
                  <span className="text-[11px] text-[var(--mut)] pr-2.5">sec</span>
                </span>
              </div>
              <p className="text-[12px] text-[var(--mut)] mt-2">Miss the timer and a card is added to your hand.</p>
            </section>

            <RuleGroup title="House rules" rules={GENERAL_RULES} view={view} admin={admin} onToggle={setRule} />
            <RuleGroup title={`${VARIANT_META[view.variant].name} rules`} rules={VARIANT_RULES[view.variant]} view={view} admin={admin} onToggle={setRule} />

            {!admin && <p className="text-[12px] text-[var(--mut)]">Only admins can change these.</p>}
          </div>
        ) : (
          <div className="a-fade">
            <PlayerList
              players={view.players}
              meId={meId}
              admin={admin}
              locked={false}
              onReorder={(order) => act("reorder", { order })}
              onShuffle={() => act("shuffleSeats")}
              onRename={(p) => { setRenaming(p); setRnName(p.name); }}
              onSetAdmin={(p, v) => act("setAdmin", { targetId: p.id, value: v })}
              onRemove={(p) => act(p.isBot ? "removeBot" : "kick", { targetId: p.id })}
              onAddBot={() => act("addBot")}
              onSetSpectate={(p, v) => { playSound("click"); act("setSpectate", { targetId: p.id, value: v }); }}
            />
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 border-t border-[var(--line)] bg-[var(--bg)] px-4 md:px-7 py-3 transition-[right] duration-200"
        style={{ right: showLog && docked ? "var(--panel-w)" : 0 }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <span className="text-[12px] text-[var(--mut)] flex-1 min-w-0">
            <span className="block truncate">
              {seated.length < 2
                ? "Waiting for one more player"
                : `${VARIANT_META[view.variant].name}, ${seated.length} players, ${goal === 0 ? "wins only" : goal + " points"}`}
            </span>
            <span className="block text-[10px] mt-0.5">
              {view.iAmHost
                ? "This browser is running the room."
                : view.hostName
                  ? `${view.hostName} is running the room. It keeps going if they drop.`
                  : "Looking for someone to run the room…"}
            </span>
          </span>
          {admin ? (
            <button className="btn acc" onClick={() => act("start")} disabled={seated.length < 2}>
              <Play size={14} /> Start
            </button>
          ) : <span className="text-[12px] text-[var(--mut)] a-pulse">Waiting for the host to start</span>}
        </div>
      </div>

      {showLog && <SidePanel view={view} meId={meId} act={act} onClose={() => setShowLog(false)} title="Table log" inset={56} />}

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
    </main>
  );
}

function RuleGroup({ title, rules, view, admin, onToggle }: {
  title: string;
  rules: { key: HouseRuleKey; name: string; desc: string }[];
  view: ViewData; admin: boolean;
  onToggle: (k: HouseRuleKey, v: boolean) => void;
}) {
  return (
    <section>
      <h3 className="tabfont text-[14px] mb-3">{title}</h3>
      <div className="panel">
        {rules.map((r, i) => {
          const on = !!view.rules[r.key];
          return (
            <button
              key={r.key}
              disabled={!admin}
              onClick={() => onToggle(r.key, !on)}
              className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${i > 0 ? "border-t border-[var(--line)]" : ""} ${admin ? "hover:bg-[var(--surf2)]" : ""}`}
            >
              <span className={`sw mt-0.5 ${on ? "on" : ""}`}><i /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{r.name}</span>
                <span className="block text-[12px] text-[var(--mut)] leading-snug mt-0.5">{r.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
