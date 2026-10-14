"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogIn, Radio } from "lucide-react";
import type { Session, ViewData } from "@/lib/client";
import {
  clearHostRoom,
  clearPendingName,
  clearSession,
  loadHostIntent,
  loadHostState,
  loadPendingName,
  loadSession,
  saveHostState,
  saveName,
  savePendingName,
  saveSession,
  savedName,
} from "@/lib/client";
import { playSound, eventSound, initSoundPref, type SoundKind } from "@/lib/sound";
import {
  addPlayer,
  buildView,
  createRoomState,
  findPlayer,
  tick,
  type RoomState,
} from "@/lib/game/engine";
import { DEFAULT_RULES } from "@/lib/game/model";
import { dispatchGameCommand, type GameCommand } from "@/lib/game/dispatch";
import Lobby from "@/components/Lobby";
import Game from "@/components/Game";

export interface ActFn {
  (type: string, payload?: Record<string, unknown>): Promise<void>;
}

interface HostBundle {
  state: RoomState;
  version: number;
  ownerPid: string;
}

interface JoinMessage {
  name: string;
  pid?: string;
  tok?: string;
}

interface WelcomeMessage {
  session: Session;
  view: ViewData;
}

const APP_ID = "uno-studio-p2p-v1";
const MAX_PLAYERS = 10;

const SOUND_RANK: Record<string, number> = {
  win: 100, eliminate: 90, catch: 85, flip: 80, roulette: 70, stack: 65,
  uno: 60, wild: 55, reverse: 50, skip: 45, shuffle: 40, draw: 35,
  deal: 30, play: 25, join: 20, click: 5, error: 1,
};

function normalizeState(state: RoomState): RoomState {
  state.rules = { ...DEFAULT_RULES, ...(state.rules ?? {}) };
  state.chat ??= [];
  state.chatOn ??= true;
  state.chatSeq ??= 0;
  state.events ??= [];
  state.players ??= [];
  for (const p of state.players) {
    p.wins ??= 0;
    p.connected = false;
  }
  return state;
}

function nonce() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export default function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<ViewData | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [networkNote, setNetworkNote] = useState("Connecting to peers…");
  const [toast, setToast] = useState("");
  const [name, setName] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinErr, setJoinErr] = useState("");

  const sessionRef = useRef<Session | null>(null);
  const viewRef = useRef<ViewData | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  const versionRef = useRef(-1);
  const ownerPidRef = useRef("");
  const isHostRef = useRef(false);
  const hostPeerRef = useRef<string | null>(null);
  const roomRef = useRef<{ leave: () => Promise<void> } | null>(null);
  const peerPlayers = useRef(new Map<string, string>());
  const peerSeq = useRef(new Map<string, number>());
  const seenCommands = useRef(new Map<string, Set<string>>());
  const firstView = useRef(true);
  const soundSeq = useRef(0);
  const desiredName = useRef("");
  const sendJoinRef = useRef<(() => void) | null>(null);
  const sendCommandRef = useRef<((command: GameCommand) => Promise<void>) | null>(null);
  const hostCommandRef = useRef<((pid: string, command: GameCommand, peerId?: string) => void) | null>(null);
  const closeRoomRef = useRef<(() => Promise<void>) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  sessionRef.current = session ?? null;
  viewRef.current = view;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const acceptView = useCallback((next: ViewData) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;

    if (firstView.current) {
      firstView.current = false;
    } else {
      let best: SoundKind | null = null;
      let rank = -1;
      for (const event of next.events) {
        if (event.seq <= soundSeq.current) continue;
        const kind = eventSound(event.type);
        if (!kind) continue;
        const score = SOUND_RANK[kind] ?? 10;
        if (score > rank) { rank = score; best = kind; }
      }
      if (best) playSound(best);
    }
    soundSeq.current = Math.max(soundSeq.current, next.lastSeq);
    setView(next);
    setNetworkNote("");
  }, []);

  // ---------------------------------------------------------------- P2P lifecycle
  useEffect(() => {
    let stopped = false;
    let tickTimer: ReturnType<typeof setInterval>;
    let snapshotTimer: ReturnType<typeof setInterval>;
    let helloTimer: ReturnType<typeof setInterval>;
    let joinTimer: ReturnType<typeof setInterval>;
    let heartbeatTimer: ReturnType<typeof setInterval>;
    let noHostTimer: ReturnType<typeof setTimeout>;

    initSoundPref();
    const hostIntent = loadHostIntent(code);
    const storedSession = loadSession(code);
    desiredName.current = loadPendingName(code) || storedSession?.name || savedName();
    setName(desiredName.current);

    let bundle: HostBundle | null = null;

    const saveBundle = () => {
      if (!bundle) return;
      saveHostState(code, bundle);
    };

    const localView = (since = soundSeq.current) => {
      if (!bundle) return null;
      return buildView(bundle.state, bundle.ownerPid, bundle.version, since) as unknown as ViewData;
    };

    if (hostIntent) {
      isHostRef.current = true;
      const restored = loadHostState<HostBundle>(code);
      if (restored?.state) {
        bundle = {
          state: normalizeState(restored.state),
          version: Math.max(1, restored.version ?? 1),
          ownerPid: restored.ownerPid,
        };
      } else {
        const state = createRoomState("classic");
        const owner = addPlayer(state, hostIntent.name, false);
        bundle = { state, version: 1, ownerPid: owner.id };
      }
      stateRef.current = bundle.state;
      ownerPidRef.current = bundle.ownerPid;
      const owner = findPlayer(bundle.state, bundle.ownerPid) ?? bundle.state.players.find((p) => p.isOwner);
      if (owner) {
        bundle.ownerPid = owner.id;
        owner.connected = true;
        owner.lastSeen = Date.now();
        const ownerSession = { pid: owner.id, tok: owner.token, name: owner.name };
        saveSession(code, ownerSession);
        sessionRef.current = ownerSession;
        setSession(ownerSession);
        const v = localView(0);
        if (v) acceptView(v);
      }
      saveBundle();
      setNetworkNote("Room is live from this browser");
    } else {
      sessionRef.current = storedSession;
      setSession(storedSession);
    }

    (async () => {
      const { joinRoom } = await import("trystero");
      if (stopped) return;

      const room = joinRoom(
        {
          appId: APP_ID,
          password: code,
          rtcConfig: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun.cloudflare.com:3478" },
            ],
          },
        },
        code,
        { onJoinError: () => !stopped && setNetworkNote("Peer connection failed. Retrying…") },
      );
      roomRef.current = room;

      const hostHello = room.makeAction<any>("host");
      const joinAction = room.makeAction<any>("join");
      const welcomeAction = room.makeAction<any>("welcome");
      const commandAction = room.makeAction<any>("command");
      const snapshotAction = room.makeAction<any>("snapshot");
      const errorAction = room.makeAction<any>("error");
      const closedAction = room.makeAction<any>("closed");

      const persistAndLocalView = () => {
        if (!bundle) return;
        saveBundle();
        const next = localView();
        if (next) acceptView(next);
      };

      const sendViewTo = (peerId: string, pid: string, welcome = false) => {
        if (!bundle) return;
        const player = findPlayer(bundle.state, pid);
        const since = peerSeq.current.get(peerId) ?? 0;
        const peerView = buildView(bundle.state, player && !player.left ? pid : null, bundle.version, since) as unknown as ViewData;
        peerSeq.current.set(peerId, bundle.state.seq);
        if (welcome && player) {
          const data: WelcomeMessage = {
            session: { pid: player.id, tok: player.token, name: player.name },
            view: peerView,
          };
          welcomeAction.send(data, { target: peerId }).catch(() => {});
        } else {
          snapshotAction.send({ view: peerView }, { target: peerId }).catch(() => {});
        }
      };

      const publishAll = () => {
        if (!bundle) return;
        persistAndLocalView();
        for (const [peerId, pid] of peerPlayers.current) sendViewTo(peerId, pid);
      };

      const runCommand = (pid: string, command: GameCommand, peerId?: string) => {
        if (!bundle) return;
        if (command.nonce && peerId) {
          const seen = seenCommands.current.get(peerId) ?? new Set<string>();
          if (seen.has(command.nonce)) return;
          seen.add(command.nonce);
          if (seen.size > 200) seen.delete(seen.values().next().value!);
          seenCommands.current.set(peerId, seen);
        }

        const error = dispatchGameCommand(bundle.state, pid, command);
        const ticked = tick(bundle.state);
        if (error) {
          if (peerId) errorAction.send({ message: error }, { target: peerId }).catch(() => {});
          else { showToast(error); playSound("error"); }
          if (ticked) { bundle.version += 1; publishAll(); }
          return;
        }
        if (command.type !== "ping" || ticked) bundle.version += 1;
        publishAll();

        if (command.type === "leave" && peerId) {
          peerPlayers.current.delete(peerId);
          peerSeq.current.delete(peerId);
        }
      };
      hostCommandRef.current = runCommand;

      // Host announces itself. A participant sends credentials only to the
      // peer that made this announcement, never to the rest of the mesh.
      hostHello.onMessage = (_data, { peerId }) => {
        if (isHostRef.current) return;
        hostPeerRef.current = peerId;
        setNetworkNote(viewRef.current ? "" : "Joining owner…");
        sendJoinRef.current?.();
      };

      joinAction.onMessage = (data: JoinMessage, { peerId }) => {
        if (!bundle || !isHostRef.current) return;
        const state = bundle.state;
        let player = data.pid && data.tok
          ? state.players.find((p) => p.id === data.pid && p.token === data.tok && !p.left)
          : undefined;

        if (!player) {
          if (state.phase !== "lobby") {
            errorAction.send({ message: "That game already started." }, { target: peerId }).catch(() => {});
            return;
          }
          if (state.players.filter((p) => !p.left).length >= MAX_PLAYERS) {
            errorAction.send({ message: "Room is full." }, { target: peerId }).catch(() => {});
            return;
          }
          const cleanName = String(data.name ?? "").replace(/\s+/g, " ").trim().slice(0, 14);
          if (!cleanName) return;
          player = addPlayer(state, cleanName, false);
          bundle.version += 1;
        }

        player.connected = true;
        player.lastSeen = Date.now();
        peerPlayers.current.set(peerId, player.id);
        sendViewTo(peerId, player.id, true);
        publishAll();
      };

      welcomeAction.onMessage = (data: WelcomeMessage, { peerId }) => {
        if (isHostRef.current) return;
        hostPeerRef.current = peerId;
        saveSession(code, data.session);
        clearPendingName(code);
        saveName(data.session.name);
        sessionRef.current = data.session;
        setSession(data.session);
        setJoinBusy(false);
        setJoinErr("");
        firstView.current = true;
        acceptView(data.view);
      };

      snapshotAction.onMessage = (data: { view: ViewData }, { peerId }) => {
        if (isHostRef.current || peerId !== hostPeerRef.current) return;
        acceptView(data.view);
      };

      commandAction.onMessage = (command: GameCommand, { peerId }) => {
        if (!bundle || !isHostRef.current) return;
        const pid = peerPlayers.current.get(peerId);
        if (!pid) {
          errorAction.send({ message: "Rejoin the room." }, { target: peerId }).catch(() => {});
          return;
        }
        runCommand(pid, command, peerId);
      };

      errorAction.onMessage = (data: { message: string }, { peerId }) => {
        if (isHostRef.current || (hostPeerRef.current && peerId !== hostPeerRef.current)) return;
        setJoinBusy(false);
        setJoinErr(data.message);
        showToast(data.message);
        playSound("error");
      };

      closedAction.onMessage = (_data, { peerId }) => {
        if (!isHostRef.current && peerId === hostPeerRef.current) setGone("The owner closed this room.");
      };

      const requestJoin = () => {
        const hostPeer = hostPeerRef.current;
        if (!hostPeer) return;
        const current = sessionRef.current;
        const requestedName = desiredName.current.trim();
        if (!current && !requestedName) return;
        const data: JoinMessage = {
          name: current?.name || requestedName,
          pid: current?.pid,
          tok: current?.tok,
        };
        setJoinBusy(true);
        joinAction.send(data, { target: hostPeer }).catch(() => setNetworkNote("Could not reach owner. Retrying…"));
      };
      sendJoinRef.current = requestJoin;

      sendCommandRef.current = async (command) => {
        const hostPeer = hostPeerRef.current;
        if (!hostPeer) {
          showToast("Owner is offline. Waiting to reconnect.");
          playSound("error");
          return;
        }
        await commandAction.send(command, { target: hostPeer });
      };

      closeRoomRef.current = async () => {
        await closedAction.send({ closed: true }).catch(() => {});
        clearHostRoom(code);
        clearSession(code);
        await room.leave();
      };

      room.onPeerJoin = (peerId) => {
        if (isHostRef.current) hostHello.send({ live: true }, { target: peerId }).catch(() => {});
      };

      room.onPeerLeave = (peerId) => {
        if (isHostRef.current && bundle) {
          const pid = peerPlayers.current.get(peerId);
          peerPlayers.current.delete(peerId);
          peerSeq.current.delete(peerId);
          seenCommands.current.delete(peerId);
          if (pid) {
            const p = findPlayer(bundle.state, pid);
            if (p) p.connected = false;
            bundle.version += 1;
            publishAll();
          }
        } else if (peerId === hostPeerRef.current) {
          hostPeerRef.current = null;
          setNetworkNote("Owner disconnected. Waiting for them to return…");
        }
      };

      if (isHostRef.current) {
        hostHello.send({ live: true }).catch(() => {});
        helloTimer = setInterval(() => hostHello.send({ live: true }).catch(() => {}), 2500);
        tickTimer = setInterval(() => {
          if (!bundle) return;
          const owner = findPlayer(bundle.state, bundle.ownerPid);
          if (owner) { owner.connected = true; owner.lastSeen = Date.now(); }
          if (tick(bundle.state)) {
            bundle.version += 1;
            publishAll();
          }
        }, 300);
        snapshotTimer = setInterval(publishAll, 1000);
      } else {
        joinTimer = setInterval(requestJoin, 2200);
        heartbeatTimer = setInterval(() => {
          const current = sessionRef.current;
          if (!current || !hostPeerRef.current) return;
          commandAction.send({ type: "ping", nonce: nonce() }, { target: hostPeerRef.current }).catch(() => {});
        }, 8000);
        noHostTimer = setTimeout(() => {
          if (!viewRef.current && !hostPeerRef.current) {
            setNetworkNote("No owner found yet. Check the code or ask the owner to keep their room open.");
          }
        }, 10000);
      }
    })().catch(() => !stopped && setNetworkNote("WebRTC could not start in this browser."));

    return () => {
      stopped = true;
      clearInterval(tickTimer);
      clearInterval(snapshotTimer);
      clearInterval(helloTimer);
      clearInterval(joinTimer);
      clearInterval(heartbeatTimer);
      clearTimeout(noHostTimer);
      sendJoinRef.current = null;
      sendCommandRef.current = null;
      hostCommandRef.current = null;
      closeRoomRef.current = null;
      roomRef.current?.leave().catch(() => {});
      roomRef.current = null;
    };
  }, [acceptView, code, showToast]);

  // ---------------------------------------------------------------- Actions
  const act: ActFn = useCallback(async (type, payload = {}) => {
    const current = sessionRef.current;
    if (!current) return;
    const command: GameCommand = { type, payload, nonce: nonce() };
    if (isHostRef.current) {
      hostCommandRef.current?.(current.pid, command);
      return;
    }
    try {
      await sendCommandRef.current?.(command);
    } catch {
      showToast("Peer connection interrupted. Retrying…");
      playSound("error");
    }
  }, [showToast]);

  const doJoin = useCallback((rawName: string) => {
    const clean = rawName.replace(/\s+/g, " ").trim().slice(0, 14);
    if (!clean) { setJoinErr("Pick a name."); return; }
    desiredName.current = clean;
    savePendingName(code, clean);
    saveName(clean);
    setName(clean);
    setJoinBusy(true);
    setJoinErr("");
    sendJoinRef.current?.();
  }, [code]);

  const leaveForHome = useCallback(async () => {
    if (isHostRef.current) {
      if (!window.confirm("Leaving closes this peer room for everyone. Continue?")) return;
      if (closeRoomRef.current) await closeRoomRef.current();
      else {
        clearHostRoom(code);
        clearSession(code);
      }
    } else {
      await act("leave");
      await roomRef.current?.leave().catch(() => {});
      clearSession(code);
      clearPendingName(code);
    }
    router.push("/");
  }, [act, code, router]);

  // ---------------------------------------------------------------- Render
  if (gone) {
    return (
      <Center>
        <h2 className="disp text-3xl">Room closed</h2>
        <p className="text-[13px] text-[var(--mut)] mt-2">{gone}</p>
        <button className="btn ghost mt-6" onClick={() => router.push("/")}><ArrowLeft size={14} /> Back</button>
      </Center>
    );
  }

  if (session === undefined) {
    return <Center><p className="text-[13px] text-[var(--mut)] a-pulse">Opening peer room</p></Center>;
  }

  // A participant can name themselves before the owner is discovered. Existing
  // sessions reconnect automatically and retain the current game view.
  if (!isHostRef.current && !session && !view) {
    return (
      <Center>
        <Radio size={18} className="text-[var(--mut)]" />
        <h2 className="disp text-5xl tracking-[0.12em] mt-3">{code}</h2>
        {networkNote && <p className="text-[12px] text-[var(--mut)] mt-2 max-w-[320px]">{networkNote}</p>}
        <div className="w-full max-w-[300px] mt-6">
          <input
            className="input"
            maxLength={14}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doJoin(name); }}
          />
          <button className="btn acc w-full mt-2.5" onClick={() => doJoin(name)} disabled={joinBusy && !!hostPeerRef.current}>
            {joinBusy && hostPeerRef.current ? "Joining" : <><LogIn size={14} /> Join peer room</>}
          </button>
          {joinErr && <p className="text-[12px] text-[#ff6b52] mt-2.5">{joinErr}</p>}
          <button className="btn ghost w-full mt-2" onClick={() => router.push("/")}>Back</button>
        </div>
      </Center>
    );
  }

  if (!view) {
    return (
      <Center>
        <Radio size={18} className="text-[var(--mut)] a-pulse" />
        <p className="text-[13px] text-[var(--mut)] mt-3">{networkNote || "Waiting for owner…"}</p>
        <button className="btn ghost mt-5" onClick={() => router.push("/")}>Back</button>
      </Center>
    );
  }

  const kicked = view.meId === null;
  if (kicked) {
    return (
      <Center>
        <h2 className="disp text-3xl">You left the table</h2>
        <div className="flex gap-2 mt-6">
          {view.phase === "lobby" && <button className="btn acc" onClick={() => { clearSession(code); setSession(null); doJoin(name || savedName()); }}>Rejoin</button>}
          <button className="btn ghost" onClick={() => router.push("/")}>Back</button>
        </div>
      </Center>
    );
  }

  return (
    <div className="relative">
      {view.phase === "lobby" ? (
        <Lobby code={code} view={view} meId={session?.pid ?? view.meId!} act={act} onLeave={leaveForHome} />
      ) : (
        <Game code={code} view={view} meId={session?.pid ?? view.meId!} act={act} onLeave={leaveForHome} />
      )}
      {networkNote && !isHostRef.current && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 a-pop max-w-[90vw]">
          <div className="text-[11px] bg-[var(--surf)] text-[var(--mut)] border border-[var(--line2)] px-3 py-2">{networkNote}</div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 a-pop">
          <div className="text-[12px] bg-[#3a140e] text-[#ffb9ab] border border-[#7c2418] px-4 py-2">{toast}</div>
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">{children}</main>;
}
