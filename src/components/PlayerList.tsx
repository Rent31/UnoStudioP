"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Crown, EyeOff, GripVertical, Pencil, Plus, Shield, ShieldOff, Shuffle, UserPlus, X } from "lucide-react";
import type { PlayerView } from "@/lib/client";
import { playSound } from "@/lib/sound";

const ROW_H = 58;
const GAP = 8;
const SLOT = ROW_H + GAP;

export default function PlayerList({ players, meId, admin, locked, onReorder, onShuffle, onRename, onSetAdmin, onRemove, onAddBot, onSetSpectate }: {
  players: PlayerView[];
  meId: string;
  admin: boolean;
  locked: boolean;
  onReorder: (ids: string[]) => void;
  onShuffle: () => void;
  onRename: (p: PlayerView) => void;
  onSetAdmin: (p: PlayerView, v: boolean) => void;
  onRemove: (p: PlayerView) => void;
  onAddBot: () => void;
  // only supplied while seats can still change, i.e. in the lobby
  onSetSpectate?: (p: PlayerView, v: boolean) => void;
}) {
  const incoming = players.filter((p) => !p.left);
  const canDrag = admin && !locked;

  const [order, setOrder] = useState<string[]>(() => incoming.map((p) => p.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const [settling, setSettling] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const grabOff = useRef(0);
  const pending = useRef<string[] | null>(null);
  const liveRef = useRef<{ ids: string[]; visual: string[] } | null>(null);

  // follow the server unless we are mid drag or waiting on our own echo
  useEffect(() => {
    const live = incoming.map((p) => p.id);
    if (dragId) return;
    if (pending.current) {
      if (live.join() === pending.current.join()) pending.current = null;
      else return;
    }
    setOrder((prev) => (prev.join() === live.join() ? prev : live));
  }, [incoming, dragId]);

  const byId = new Map(incoming.map((p) => [p.id, p]));
  const ids = order.filter((id) => byId.has(id));
  for (const p of incoming) if (!ids.includes(p.id)) ids.push(p.id);
  const n = ids.length;

  // where the floating row would land right now
  const fromIndex = dragId ? ids.indexOf(dragId) : -1;
  const targetIndex = dragId
    ? Math.max(0, Math.min(n - 1, Math.round(dragY / SLOT)))
    : -1;

  // order as it appears while dragging, with the gap already opened
  const visual = (() => {
    if (!dragId) return ids;
    const rest = ids.filter((id) => id !== dragId);
    rest.splice(targetIndex, 0, dragId);
    return rest;
  })();

  const startDrag = (id: string, clientY: number) => {
    const box = boxRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const slotTop = ids.indexOf(id) * SLOT;
    grabOff.current = clientY - top - slotTop;
    setDragY(slotTop);
    setDragId(id);
    setSettling(false);
    playSound("click");
  };

  const moveDrag = (clientY: number) => {
    const box = boxRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const y = clientY - top - grabOff.current;
    setDragY(Math.max(-SLOT * 0.5, Math.min((n - 1) * SLOT + SLOT * 0.5, y)));
    // nudge the page when dragging near a screen edge
    const edge = 90;
    if (clientY < edge) window.scrollBy({ top: -12 });
    else if (clientY > window.innerHeight - edge) window.scrollBy({ top: 12 });
  };

  const endDrag = (cancel = false) => {
    if (!dragId) return;
    const snap = liveRef.current;
    const next = cancel || !snap ? (snap?.ids ?? ids) : snap.visual;
    const baseline = snap?.ids ?? ids;
    setDragId(null);
    setSettling(true);
    setTimeout(() => setSettling(false), 240);
    if (!cancel && next.join() !== baseline.join()) {
      setOrder(next);
      pending.current = next;
      playSound("shuffle");
      onReorder(next);
    }
  };

  liveRef.current = dragId ? { ids, visual } : null;

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => { e.preventDefault(); moveDrag(e.clientY); };
    const onUp = () => endDrag();
    const onCancel = () => endDrag(true);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId, n]);

  if (!canDrag) {
    return (
      <div className="grid sm:grid-cols-2 gap-2 stagger">
        {ids.map((id) => {
          const p = byId.get(id)!;
          return (
            <Row key={id} p={p} meId={meId} admin={admin} index={-1} canDrag={false}
              onRename={onRename} onSetAdmin={onSetAdmin} onRemove={onRemove} onSetSpectate={onSetSpectate} />
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5 max-w-[460px]">
        <span className="lbl">Drag to set the turn order</span>
        <button className="btn xs ghost" onClick={() => { playSound("shuffle"); onShuffle(); }}>
          <Shuffle size={12} /> Randomize
        </button>
      </div>

      <div
        ref={boxRef}
        className="relative max-w-[460px]"
        style={{ height: n * SLOT - GAP, touchAction: dragId ? "none" : undefined }}
      >
        {ids.map((id) => {
          const p = byId.get(id)!;
          const isDrag = id === dragId;
          const slot = visual.indexOf(id);
          const y = isDrag ? dragY : slot * SLOT;
          return (
            <div
              key={id}
              className={`absolute left-0 right-0 ${isDrag ? "dragrow" : settling ? "slotrow" : "slotrow"}`}
              style={{
                height: ROW_H,
                transform: `translate3d(0, ${y}px, 0)`,
                transition: isDrag ? "none" : "transform .2s cubic-bezier(.2,.8,.3,1)",
                zIndex: isDrag ? 30 : 1,
              }}
            >
              <Row
                p={p}
                meId={meId}
                admin={admin}
                index={visual.indexOf(id)}
                canDrag
                lifted={isDrag}
                onGrab={(clientY) => startDrag(id, clientY)}
                onRename={onRename}
                onSetAdmin={onSetAdmin}
                onRemove={onRemove}
                onSetSpectate={onSetSpectate}
              />
            </div>
          );
        })}

        {/* the landing slot shows through the gap the rows opened */}
        {dragId && (
          <div
            className="dropslot absolute left-0 right-0 pointer-events-none"
            style={{
              height: ROW_H,
              transform: `translate3d(0, ${targetIndex * SLOT}px, 0)`,
              transition: "transform .2s cubic-bezier(.2,.8,.3,1)",
              zIndex: 0,
            }}
          />
        )}
      </div>

      {incoming.length < 10 && (
        <button
          className="mt-2 w-full max-w-[460px] border border-dashed border-[var(--line2)] px-3 flex items-center gap-2.5 text-[var(--mut)] hover:text-[var(--ink)] hover:border-[var(--mut)] transition-colors"
          style={{ height: ROW_H }}
          onClick={() => { playSound("join"); onAddBot(); }}
        >
          <span className="w-8 h-8 rounded-full border border-dashed border-[var(--line2)] grid place-items-center"><Plus size={14} /></span>
          <span className="text-[13px] font-medium">Add a bot</span>
        </button>
      )}
    </div>
  );
}

function Row({ p, meId, admin, index, canDrag, lifted, onGrab, onRename, onSetAdmin, onRemove, onSetSpectate }: {
  p: PlayerView; meId: string; admin: boolean; index: number; canDrag: boolean; lifted?: boolean;
  onGrab?: (clientY: number) => void;
  onRename: (p: PlayerView) => void;
  onSetAdmin: (p: PlayerView, v: boolean) => void;
  onRemove: (p: PlayerView) => void;
  onSetSpectate?: (p: PlayerView, v: boolean) => void;
}) {
  return (
    <div
      className={`panel h-full px-3 flex items-center gap-2.5 ${lifted ? "lifted" : ""}`}
      style={{ height: "100%" }}
    >
      {index >= 0 && <span className="text-[11px] text-[var(--mut)] w-3 tabular-nums shrink-0">{index + 1}</span>}

      {canDrag && (
        <span
          className="grip shrink-0 -ml-0.5 py-2"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
            onGrab?.(e.clientY);
          }}
        >
          <GripVertical size={15} />
        </span>
      )}

      <span className="w-8 h-8 shrink-0 rounded-full bg-[var(--surf2)] border border-[var(--line)] grid place-items-center text-[13px] font-semibold">
        {p.name.slice(0, 1).toUpperCase()}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold truncate">{p.name}</span>
          {p.isOwner && <Crown size={12} className="text-[var(--acc)] shrink-0" />}
          {!p.isOwner && p.isAdmin && <Shield size={11} className="text-[var(--gold)] shrink-0" />}
          {p.isBot && <Bot size={12} className="text-[var(--mut)] shrink-0" />}
        </span>
        <span className="text-[11px] text-[var(--mut)]">
          {p.spectator
            ? <span className="text-[var(--ink2)]">Watching</span>
            : p.id === meId ? "You" : p.isBot ? "Bot" : p.connected ? "Ready" : "Away"}
          {p.wins > 0 && <span className="text-[var(--gold)]"> · {p.wins} {p.wins === 1 ? "win" : "wins"}</span>}
        </span>
      </span>

      <span className="flex items-center gap-1 shrink-0">
        {!!onSetSpectate && admin && !p.isOwner && !p.isBot && (
          <button
            className={`iconbtn !w-7 !h-7 ${p.spectator ? "on" : ""}`}
            title={p.spectator ? "Put them back at the table" : "Move them to the rail"}
            onClick={() => onSetSpectate(p, !p.spectator)}
          >
            {p.spectator ? <UserPlus size={11} /> : <EyeOff size={11} />}
          </button>
        )}
        {(p.id === meId || admin) && (
          <button className="iconbtn !w-7 !h-7" title="Rename" onClick={() => onRename(p)}><Pencil size={11} /></button>
        )}
        {admin && !p.isOwner && p.id !== meId && !p.isBot && (
          <button className="iconbtn !w-7 !h-7" title={p.isAdmin ? "Remove admin" : "Make admin"} onClick={() => onSetAdmin(p, !p.isAdmin)}>
            {p.isAdmin ? <ShieldOff size={11} /> : <Shield size={11} />}
          </button>
        )}
        {admin && !p.isOwner && p.id !== meId && (
          <button className="iconbtn !w-7 !h-7 hover:!text-[#ff6b52]" title="Remove" onClick={() => onRemove(p)}><X size={11} /></button>
        )}
      </span>
    </div>
  );
}
