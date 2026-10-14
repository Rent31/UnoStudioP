"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eraser, Info, Send, X } from "lucide-react";
import type { ViewData } from "@/lib/client";
import type { Face } from "@/lib/game/model";
import type { ActFn } from "@/components/RoomClient";
import { CardView } from "@/components/CardView";
import { playSound } from "@/lib/sound";

function clock(at: number) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Log on top, chat underneath. The log keeps its history instead of vanishing.
export default function SidePanel({ view, meId, act, onClose, title = "Table log", inset = 48 }: {
  view: ViewData; meId: string; act: ActFn; onClose: () => void; title?: string; inset?: number;
}) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const lastLog = useRef(0);
  const lastChat = useRef(0);

  const entries = view.logTail ?? [];
  const chat = view.chat ?? [];
  const isFlip = view.variant === "flip";
  const isFlex = view.variant === "flex";

  // stick to the bottom only when new items arrive
  useEffect(() => {
    const el = logRef.current;
    const top = entries[entries.length - 1]?.seq ?? 0;
    if (el && top !== lastLog.current) { lastLog.current = top; el.scrollTop = el.scrollHeight; }
  }, [entries]);
  useEffect(() => {
    const el = chatRef.current;
    const top = chat[chat.length - 1]?.id ?? 0;
    if (el && top !== lastChat.current) { lastChat.current = top; el.scrollTop = el.scrollHeight; }
  }, [chat]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    playSound("click");
    act("chat", { text: t });
  };

  let lastRound = -1;

  return (
    <aside className="sidepanel bottom-0 panel border-l a-left" style={{ top: inset }}>
      <div className="flex items-center justify-between px-3 h-11 border-b border-[var(--line)] shrink-0">
        <span className="tabfont text-[13px] pl-1">{title}</span>
        <span className="flex items-center gap-1.5">
          <Link href="/rules" className="iconbtn !w-7 !h-7" title="Rules and cards"><Info size={13} /></Link>
          <button className="iconbtn !w-7 !h-7" onClick={onClose}><X size={13} /></button>
        </span>
      </div>

      {/* log */}
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-1.5">
        {entries.length === 0 && <p className="text-[12px] text-[var(--mut)]">Nothing yet.</p>}
        {entries.map((e) => {
          const showRound = e.round > 0 && e.round !== lastRound;
          lastRound = e.round;
          const face = e.card ? ({ color: e.card.color, value: e.card.value } as unknown as Face) : null;
          return (
            <div key={e.seq}>
              {showRound && (
                <p className="lbl !text-[10px] border-t border-[var(--line)] pt-2 mt-2 mb-1.5">Round {e.round}</p>
              )}
              <div className="flex items-start gap-2">
                {face ? (
                  <span className="cardwrap pointer-events-none shrink-0 mt-0.5" style={{ "--k": 0.14 } as never}>
                    <CardView
                      face={face}
                      flipDark={isFlip && view.side === "dark"}
                      flipLight={isFlip && view.side === "light"}
                      useFlexArt={isFlex}
                    />
                  </span>
                ) : (
                  <span className="w-[17px] shrink-0" />
                )}
                <span className="min-w-0">
                  <span className="block text-[12px] leading-snug text-[var(--ink2)]">{e.msg}</span>
                  <span className="block text-[10px] text-[var(--mut)] mt-0.5">{clock(e.at)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* chat */}
      <div className="border-t border-[var(--line)] shrink-0 flex flex-col" style={{ height: "46%" }}>
        <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--line)] shrink-0">
          <span className="tabfont text-[12px]">Chat</span>
          {view.iAmAdmin && (
            <span className="flex items-center gap-1.5">
              <button className="iconbtn !w-6 !h-6" title="Clear chat" onClick={() => act("clearChat")}>
                <Eraser size={11} />
              </button>
              <button
                className={`btn xs ${view.chatOn ? "ghost" : "acc"} !py-1 !px-2`}
                onClick={() => act("setChat", { value: !view.chatOn })}
              >
                {view.chatOn ? "Disable" : "Enable"}
              </button>
            </span>
          )}
        </div>

        <div ref={chatRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5">
          {chat.length === 0 && <p className="text-[12px] text-[var(--mut)]">No messages.</p>}
          {chat.map((m) => (
            m.system ? (
              <p key={m.id} className="text-[11px] text-[var(--mut)] italic">{m.text}</p>
            ) : (
              <p key={m.id} className="text-[12px] leading-snug break-words">
                <span className={`font-semibold ${m.playerId === meId ? "text-[var(--gold)]" : "text-[var(--acc)]"}`}>{m.name}</span>
                <span className="text-[var(--ink2)]"> {m.text}</span>
              </p>
            )
          ))}
        </div>

        <div className="flex items-center gap-1.5 p-2 border-t border-[var(--line)] shrink-0">
          <input
            className="input !py-2 !px-2.5 !text-[12px] flex-1"
            maxLength={200}
            placeholder={view.chatOn ? "Message" : "Chat is off"}
            disabled={!view.chatOn}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          />
          <button className="iconbtn !w-9 !h-9" disabled={!view.chatOn || !draft.trim()} onClick={send} title="Send">
            <Send size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
