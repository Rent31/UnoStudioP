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
  loadMirror,
  loadPendingName,
  loadSession,
  saveHostState,
  saveMirror,
  saveName,
  savePendingName,
  saveSession,
  savedName,
} from "@/lib/client";
import { playSound, eventSound, initSoundPref, type SoundKind } from "@/lib/sound";
import { EncryptedRelay, type RelayKind, type RelayMessage } from "@/lib/relay";
import { APP_ID, rtcConfig } from "@/lib/net";
import {
  addPlayer,
  buildView,
  createRoomState,
  findPlayer,
  setHost,
  tick,
  type RoomState,
} from "@/lib/game/engine";
import { DEFAULT_RULES } from "@/lib/game/model";
import {
  HOST_TTL_MS,
  isBetterHost,
  isNewerState,
  pickHost,
  PRESENCE_INTERVAL_MS,
  PRESENCE_TTL_MS,
  type HostCandidate,
} from "@/lib/host";
import { dispatchGameCommand, type GameCommand } from "@/lib/game/dispatch";
import Lobby from "@/components/Lobby";
import Game from "@/components/Game";

export interface ActFn {
  (type: string, payload?: Record<string, unknown>): Promise<void>;
}

interface HostBundle {
  state: RoomState;
  version: number;
  /** the player this browser is, which is not always the owner any more */
  localPid: string;
}

interface JoinMessage {
  name: string;
  pid?: string;
  tok?: string;
}

interface WelcomeMessage {
  session: Session;
  view: ViewData;
  joinedAt?: number;
}

interface MirrorMessage {
  state: RoomState;
  version: number;
}

const MAX_PLAYERS = 10;
const SELF = "self";
/** how long the owner waits for a live host before taking their own room back */
const CLAIM_DELAY_MS = 1200;
/** safety valve: take the room if an outranked host never hands it over */
const OUTRANK_PATIENCE_MS = 5000;
/** a peer we have not heard from directly in this long also gets a relay copy */
const DIRECT_STALE_MS = 6000;
/** once the host's socket is gone, let another browser take over after this */
const HOST_LEAVE_GRACE_MS = 1500;
/** a browser offers its own newer copy back to the host at most this often */
const SYNC_PUSH_MS = 3000;
/** a seat that hears nothing from the host for this long asks again */
const REJOIN_AFTER_MS = 6000;

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
  state.hostId ??= null;
  let stamp = 0;
  for (const p of state.players) {
    p.wins ??= 0;
    p.spectator ??= false;
    p.joinedAt ??= ++stamp;
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
  const [isHost, setIsHost] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  const viewRef = useRef<ViewData | null>(null);
  const stateRef = useRef<RoomState | null>(null);
  const versionRef = useRef(-1);
  const isHostRef = useRef(false);
  const hostPeerRef = useRef<string | null>(null);
  // the newest copy of the room this browser has seen, used to take over
  const mirrorRef = useRef<MirrorMessage | null>(null);
  const presenceRef = useRef(new Map<string, HostCandidate>());
  /**
   * The newest "I am running the room" packet we have seen, plus a digest of
   * the table that browser is holding, so a peer with a newer copy can hand it
   * back instead of the room quietly forking into two timelines.
   */
  const hostBeatRef = useRef<{
    peerId: string; pid: string; joinedAt: number; at: number; seq: number; lastActionAt: number;
  } | null>(null);
  const joinedAtRef = useRef<number>(Number.MAX_SAFE_INTEGER);
  const outrankSinceRef = useRef<number>(0);
  /** when this browser last offered its own copy back to the host */
  const syncPushRef = useRef<number>(0);
  /** say hello to the host on demand, e.g. the moment the tab is looked at again */
  const pingRef = useRef<(() => void) | null>(null);
  /** when this browser last heard from the browser running the room */
  const lastViewAtRef = useRef<number>(0);
  const publishAllRef = useRef<(() => void) | null>(null);
  const stopHostingRef = useRef<(() => void) | null>(null);
  const handoffRef = useRef<(() => void) | null>(null);
  const roomRef = useRef<{ leave: () => Promise<void> } | null>(null);
  const peerPlayers = useRef(new Map<string, string>());
  const peerSeq = useRef(new Map<string, number>());
  const seenCommands = useRef(new Map<string, Set<string>>());
  const firstView = useRef(true);
  const soundSeq = useRef(0);
  const desiredName = useRef("");
  const sendJoinRef = useRef<((force?: boolean) => void) | null>(null);
  const sendCommandRef = useRef<((command: GameCommand) => Promise<void>) | null>(null);
  const hostCommandRef = useRef<((pid: string, command: GameCommand, peerId?: string) => void) | null>(null);
  const closeRoomRef = useRef<(() => Promise<void>) | null>(null);
  const relayRef = useRef<EncryptedRelay | null>(null);
  const relayHandlers = useRef(new Map<RelayKind, (data: unknown, from: string) => void>());
  const selfPeerRef = useRef("");
  const joinedHostRef = useRef<string | null>(null);
  const announceRef = useRef<(() => void) | null>(null);
  // how recently each peer was heard from over WebRTC rather than the relay
  const directPeers = useRef(new Map<string, number>());
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
    let mirrorTimer: ReturnType<typeof setInterval>;
    let presenceTimer: ReturnType<typeof setInterval>;
    let monitorTimer: ReturnType<typeof setInterval>;
    let joinTimer: ReturnType<typeof setInterval>;
    let heartbeatTimer: ReturnType<typeof setInterval>;
    let claimTimer: ReturnType<typeof setTimeout>;
    let noHostTimer: ReturnType<typeof setTimeout>;
    let onVisibility: (() => void) | null = null;

    initSoundPref();
    const hostIntent = loadHostIntent(code);
    const storedSession = loadSession(code);
    desiredName.current = loadPendingName(code) || storedSession?.name || savedName();
    setName(desiredName.current);

    const needsRelay = (peerId: string) => {
      const at = directPeers.current.get(peerId);
      return !at || Date.now() - at > DIRECT_STALE_MS;
    };

    interface RoomAction {
      send: (data: unknown, opts?: { target?: string }) => Promise<unknown>;
      onMessage: ((data: any, meta: { peerId: string }) => void) | null;
    }
    // the wire actions are created once the peer room opens, but the host
    // switchover above needs them, so they live out here
    let hostHello!: RoomAction;
    let presenceAction!: RoomAction;
    let mirrorAction!: RoomAction;
    let handoffAction!: RoomAction;
    let sendHostBeat!: (data: unknown, target?: string) => void;
    let sendMirrorCopy!: (data: unknown, target?: string) => void;
    let sendHandoffPacket!: (data: unknown, target?: string) => void;
    let bundle: HostBundle | null = null;
    const restoredMirror = loadMirror<MirrorMessage>(code);
    if (restoredMirror?.state) {
      mirrorRef.current = { state: normalizeState(restoredMirror.state), version: restoredMirror.version ?? 1 };
    }

    const saveBundle = () => {
      if (!bundle) return;
      saveHostState(code, bundle);
      saveMirror(code, { state: bundle.state, version: bundle.version });
    };

    const keepMirror = (state: RoomState, version: number) => {
      const current = mirrorRef.current;
      if (current && !isNewerState(state, current.state)) return;
      mirrorRef.current = { state, version };
      saveMirror(code, { state, version });
    };

    const selfJoinedAt = () => {
      const pid = sessionRef.current?.pid;
      if (!pid) return Number.MAX_SAFE_INTEGER;
      const from = mirrorRef.current?.state ?? bundle?.state;
      const me = from ? findPlayer(from, pid) : undefined;
      if (me?.joinedAt) return me.joinedAt;
      return joinedAtRef.current;
    };

    const selfCandidate = (): HostCandidate | null => {
      const pid = sessionRef.current?.pid;
      if (!pid) return null;
      return {
        pid,
        peerId: SELF,
        joinedAt: selfJoinedAt(),
        canHost: !!(mirrorRef.current || bundle),
        at: Date.now(),
      };
    };

    const localView = (since = soundSeq.current) => {
      if (!bundle) return null;
      return buildView(bundle.state, bundle.localPid, bundle.version, since) as unknown as ViewData;
    };

    const stopHosting = () => {
      clearInterval(tickTimer);
      clearInterval(snapshotTimer);
      clearInterval(helloTimer);
      clearInterval(mirrorTimer);
      if (!isHostRef.current) return;
      isHostRef.current = false;
      setIsHost(false);
      setNetworkNote("");
    };
    stopHostingRef.current = stopHosting;

      // Every "I am running the room" packet carries a digest of the table this
      // browser is holding, so a peer that has moved the room further along can
      // hand its copy back instead of the two of them drifting apart.
      const beatPayload = () => ({
        live: true,
        hostPid: bundle?.localPid,
        joinedAt: joinedAtRef.current,
        seq: bundle?.state.seq ?? 0,
        lastActionAt: bundle?.state.lastActionAt ?? 0,
      });
      const stampOwnBeat = () => {
        if (!bundle) return;
        hostBeatRef.current = {
          peerId: SELF, pid: bundle.localPid, joinedAt: joinedAtRef.current, at: Date.now(),
          seq: bundle.state.seq, lastActionAt: bundle.state.lastActionAt,
        };
      };

      const startHosting = (state: RoomState, version: number, localPid: string) => {
        versionRef.current = -1;
        soundSeq.current = 0;
        firstView.current = true;
        bundle = { state, version, localPid };
        stateRef.current = state;
        setHost(state, localPid);
        const me = findPlayer(state, localPid);
        if (me) { me.connected = true; me.lastSeen = Date.now(); }
        isHostRef.current = true;
        setIsHost(true);
        joinedAtRef.current = me?.joinedAt ?? joinedAtRef.current;
        outrankSinceRef.current = 0;
        syncPushRef.current = 0;
        stampOwnBeat();
        keepMirror(state, version);
        saveBundle();

        clearInterval(joinTimer);
        clearInterval(heartbeatTimer);
        tickTimer = setInterval(() => {
          if (!bundle) return;
          const self = findPlayer(bundle.state, bundle.localPid);
          if (self) { self.connected = true; self.lastSeen = Date.now(); }
          if (tick(bundle.state)) {
            bundle.version += 1;
            publishAllRef.current?.();
          }
        }, 300);
        snapshotTimer = setInterval(() => publishAllRef.current?.(), 1000);
        helloTimer = setInterval(() => {
          sendHostBeat(beatPayload());
          stampOwnBeat();
        }, 2000);
        mirrorTimer = setInterval(() => { if (bundle) sendMirrorCopy({ state: bundle.state, version: bundle.version }); }, 2000);
        const v = localView(0);
        if (v) acceptView(v);
        sendHostBeat(beatPayload());
        sendMirrorCopy({ state, version });
        publishAllRef.current?.();
      };

      // The tab is being thrown away, or the phone is putting it to sleep:
      // leave the freshest copy behind AND pass the live room straight to the
      // next browser, so nobody has to sit out the host timeout.
      const onHide = () => {
        if (isHostRef.current && bundle) {
          sendMirrorCopy?.({ state: bundle.state, version: bundle.version });
          handoffToNext();
          saveBundle();
        }
      };
      window.addEventListener("pagehide", onHide);

      // Browsers throttle timers hard in a background tab and stop them
      // altogether on a suspended phone. Catch up the moment we are looked at
      // again instead of waiting for the next tick to happen.
      onVisibility = () => {
        if (document.visibilityState !== "visible") {
          if (isHostRef.current && bundle) sendMirrorCopy?.({ state: bundle.state, version: bundle.version });
          return;
        }
        announceRef.current?.();
        if (isHostRef.current && bundle) {
          sendHostBeat(beatPayload());
          stampOwnBeat();
          sendMirrorCopy({ state: bundle.state, version: bundle.version });
          publishAllRef.current?.();
        } else if (sessionRef.current) {
          // tell the room we are back at once instead of waiting for the next
          // heartbeat, so the seat stops reading as away
          pingRef.current?.();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);

    // hand the live room to the next browser in line, used when this one
    // steps out on purpose as well as when it is outranked
      const handoffToNext = () => {
        if (!bundle) return;
        const now = Date.now();
        const others = [...presenceRef.current.values()]
          .filter((c) => c.peerId !== SELF && now - c.at <= PRESENCE_TTL_MS);
        // A browser that already holds a copy is the natural heir, but anybody
        // still here will do: the packet itself is the copy they take over with,
        // so the room never dies just because nobody had mirrored it yet.
        const best = pickHost(others, now)
          ?? others.slice().sort((a, b) => (isBetterHost(a, b) ? -1 : 1))[0]
          ?? null;
        if (!best) return;
        sendHandoffPacket({ state: bundle.state, version: bundle.version }, best.peerId);
      };
    handoffRef.current = handoffToNext;

    const claimHost = () => {
      if (isHostRef.current) return;
      const m = mirrorRef.current;
      const pid = sessionRef.current?.pid;
      if (!m || !pid) return;
      const state = normalizeState(m.state);
      if (!findPlayer(state, pid)) return;
      startHosting(state, Math.max(1, (m.version ?? 1) + 1), pid);
      setNetworkNote("");
    };

    (async () => {
      const { joinRoom, selfId } = await import("trystero");
      if (stopped) return;

      const room = joinRoom(
        { appId: APP_ID, password: code, rtcConfig: rtcConfig() },
        code,
        { onJoinError: () => !stopped && setNetworkNote("Peer connection failed. Trying the relay…") },
      );
      roomRef.current = room;
      selfPeerRef.current = selfId;

      // WebRTC first, but plenty of networks refuse to punch through at all:
      // this mesh carries the same packets over plain WebSocket/TLS instead.
      relayRef.current = new EncryptedRelay(
        code,
        selfId,
        (m: RelayMessage) => {
          if (stopped || m.from === selfId) return;
          relayHandlers.current.get(m.kind)?.(m.data, m.from);
        },
        () => {
          if (stopped) return;
          // say hello on the new transport at once, so nobody waits a whole
          // presence tick to learn our key
          announceRef.current?.();
        },
      );
      void relayRef.current.start();

      /** send one packet down both transports; the relay only where it is needed */
      const mkSender = (kind: RelayKind, action: RoomAction) => (data: unknown, target?: string) => {
        action.send(data, target ? { target } : undefined).catch(() => {});
        const relay = relayRef.current;
        if (relay && (!target || needsRelay(target))) void relay.send(kind, data, target);
      };

      /** receive from both transports; the trystero peer id and the relay id are the same */
      const onWire = (kind: RelayKind, action: RoomAction, handler: (data: any, from: string) => void) => {
        action.onMessage = ((data: any, meta: { peerId: string }) => {
          directPeers.current.set(meta.peerId, Date.now());
          handler(data, meta.peerId);
        }) as never;
        relayHandlers.current.set(kind, handler);
      };

      hostHello = room.makeAction<any>("host") as unknown as RoomAction;
      presenceAction = room.makeAction<any>("presence") as unknown as RoomAction;
      const joinAction = room.makeAction<any>("join");
      const welcomeAction = room.makeAction<any>("welcome");
      const commandAction = room.makeAction<any>("command");
      const snapshotAction = room.makeAction<any>("snapshot");
      mirrorAction = room.makeAction<any>("mirror") as unknown as RoomAction;
      handoffAction = room.makeAction<any>("handoff") as unknown as RoomAction;
      const errorAction = room.makeAction<any>("error");
      const closedAction = room.makeAction<any>("closed");

      const sendPresenceMsg = mkSender("presence", presenceAction);
      const sendWelcome = mkSender("welcome", welcomeAction);
      const sendSnapshot = mkSender("snapshot", snapshotAction);
      const sendError = mkSender("error", errorAction);
      const sendClosed = mkSender("closed", closedAction);
      const sendJoin = mkSender("join", joinAction);
      const sendCommandWire = mkSender("command", commandAction);
      sendHostBeat = mkSender("host", hostHello);
      sendMirrorCopy = mkSender("mirror", mirrorAction);
      sendHandoffPacket = mkSender("handoff", handoffAction);

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
            joinedAt: player.joinedAt,
          };
          sendWelcome(data, peerId);
        } else {
          sendSnapshot({ view: peerView }, peerId);
        }
      };

        const publishAll = () => {
          if (!bundle) return;
          persistAndLocalView();
          for (const [peerId, pid] of peerPlayers.current) sendViewTo(peerId, pid);
        };
        publishAllRef.current = publishAll;

        /**
         * Run somebody else's copy of the room instead of the one this browser
         * was holding. Used whenever another browser turns out to have carried
         * the table further: taking the newer copy keeps every browser on one
         * timeline, rather than two tables each missing the other's players.
         */
          const adoptState = (state: RoomState, version: number) => {
            if (!bundle) return;
            const localPid = bundle.localPid;
            // A copy this browser has no seat in belongs to a room it was
            // removed from: take it on, then step aside so somebody who is
            // still at that table runs it.
            const orphaned = !findPlayer(state, localPid);
            bundle = { state, version: Math.max(bundle.version, version) + 1, localPid };
            stateRef.current = state;
            setHost(state, localPid);
            const me = findPlayer(state, localPid);
            if (me) { me.connected = true; me.lastSeen = Date.now(); }
            // everyone is treated as caught up to here, or the gap would replay
            // every sound and log line from the rounds they never saw
            soundSeq.current = Math.max(soundSeq.current, state.seq);
            for (const peerId of [...peerSeq.current.keys()]) peerSeq.current.set(peerId, state.seq);
            keepMirror(state, bundle.version);
            publishAll();
            if (orphaned) stopHosting();
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
          if (peerId) sendError({ message: error }, peerId);
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
      onWire("host", hostHello, (data: any, peerId: string) => {
        if (data?.hostPid === sessionRef.current?.pid) return;
        const now = Date.now();
        const prev = hostBeatRef.current;
          const incoming = {
            peerId,
            pid: String(data?.hostPid ?? ""),
            joinedAt: Number(data?.joinedAt ?? Number.MAX_SAFE_INTEGER),
            at: now,
            seq: Number(data?.seq ?? 0),
            lastActionAt: Number(data?.lastActionAt ?? 0),
          };
        const takeOver = !prev || prev.pid === incoming.pid || prev.peerId === peerId ||
          now - prev.at > HOST_TTL_MS || isBetterHost(incoming, prev);
        if (!takeOver) return;
        // while this browser is the one running the room its own beat is the
        // truth; another browser claiming host is settled by the monitor
        if (!isHostRef.current && prev?.pid !== incoming.pid) {
          // different host, different version numbering: start over rather
          // than dropping everything they send as "too old"
          versionRef.current = -1;
          soundSeq.current = 0;
          firstView.current = true;
        }
        hostBeatRef.current = incoming;
        if (!isHostRef.current) {
          if (hostPeerRef.current !== peerId) {
            hostPeerRef.current = peerId;
            joinedHostRef.current = null;
            sendJoinRef.current?.();
          }
          setNetworkNote(viewRef.current ? "" : "Joining the room…");
        }
      });

      // Everybody says who they are, so the room can always work out who
      // should be running it without anybody being in charge of the answer.
      onWire("presence", presenceAction, (data: HostCandidate, peerId: string) => {
        if (!data?.pid || data.pid === sessionRef.current?.pid) return;
        presenceRef.current.set(data.pid, { ...data, peerId, at: Date.now() });
      });

      onWire("join", joinAction, (data: JoinMessage, peerId: string) => {
        if (!bundle || !isHostRef.current) return;
        const state = bundle.state;
        // A join can arrive more than once: it goes down both transports and
        // the client keeps asking until a welcome turns up. A peer that
        // already holds a seat gets that seat back, never a second one.
        const seatedId = peerPlayers.current.get(peerId);
        let player = seatedId ? findPlayer(state, seatedId) : undefined;
        if (!player && data.pid && data.tok) {
          player = state.players.find((p) => p.id === data.pid && p.token === data.tok);
        }

        if (player && player.left) {
          // came back after leaving or being dropped: give the seat back, or a
          // place at the rail if the round is already running
          player.left = false;
          player.spectator = state.phase !== "lobby";
          player.hand = [];
          bundle.version += 1;
        }

        if (!player) {
          const live = state.players.filter((p) => !p.left && !p.spectator).length;
          if (state.phase !== "lobby") {
            // mid game: watch, do not disturb the deal
            const cleanName = String(data.name ?? "").replace(/\s+/g, " ").trim().slice(0, 14);
            if (!cleanName) return;
            player = addPlayer(state, cleanName, false, true);
            bundle.version += 1;
          } else if (live >= MAX_PLAYERS) {
            sendError({ message: "Room is full." }, peerId);
            return;
          } else {
            const cleanName = String(data.name ?? "").replace(/\s+/g, " ").trim().slice(0, 14);
            if (!cleanName) return;
            player = addPlayer(state, cleanName, false);
            bundle.version += 1;
          }
        }

        player.connected = true;
        player.lastSeen = Date.now();
        peerPlayers.current.set(peerId, player.id);
        sendViewTo(peerId, player.id, true);
        // hand over a copy of the room there and then, so this browser can
        // take over straight away instead of waiting for the next broadcast
        sendMirrorCopy({ state: bundle.state, version: bundle.version }, peerId);
        publishAll();
      });

      onWire("welcome", welcomeAction, (data: WelcomeMessage, peerId: string) => {
        if (isHostRef.current) return;
        hostPeerRef.current = peerId;
        saveSession(code, data.session);
        clearPendingName(code);
        saveName(data.session.name);
        sessionRef.current = data.session;
        setSession(data.session);
        if (data.joinedAt) joinedAtRef.current = data.joinedAt;
        lastViewAtRef.current = Date.now();
        setJoinBusy(false);
        setJoinErr("");
        firstView.current = true;
        acceptView(data.view);
      });

      onWire("snapshot", snapshotAction, (data: { view: ViewData }, peerId: string) => {
        if (isHostRef.current || peerId !== hostPeerRef.current) return;
        lastViewAtRef.current = Date.now();
        // A host that took over numbers its views from scratch. A small step
        // back is a packet arriving out of order; a big one means this browser
        // is pinned to a dead numbering and would drop everything they send
        // from here on.
        if (data.view.version + 3 < versionRef.current) versionRef.current = -1;
        acceptView(data.view);
      });

      // a copy of the whole room, so this browser can take over if the host
      // goes away mid game
      onWire("mirror", mirrorAction, (data: MirrorMessage, peerId: string) => {
        if (!data?.state) return;
        const state = normalizeState(data.state);
        const version = data.version ?? 1;
        // The newest table wins, whoever is holding it. Without this a
        // browser that took over while this one was asleep leaves the room
        // forked: two tables, each missing the other's players and plays.
        if (isHostRef.current && bundle && isNewerState(state, bundle.state)) {
          adoptState(state, version);
          return;
        }
        // a participant only trusts copies from the browser running the room
        if (!isHostRef.current && hostPeerRef.current && peerId !== hostPeerRef.current) return;
        keepMirror(state, version);
      });

      onWire("handoff", handoffAction, (data: MirrorMessage, peerId: string) => {
        if (!data?.state) return;
        const state = normalizeState(data.state);
        const version = data.version ?? 1;
        mirrorRef.current = { state, version };
        saveMirror(code, mirrorRef.current);
        // already running the room: keep whichever copy has moved further.
        // Dropping theirs is what used to fork the room when a sleeping tab
        // woke up and carried on from a table everyone else had left behind.
        if (isHostRef.current) {
          if (bundle && isNewerState(state, bundle.state)) adoptState(state, version);
          return;
        }
        hostBeatRef.current = null;
        hostPeerRef.current = peerId;
        claimHost();
      });

      onWire("command", commandAction, (command: GameCommand, peerId: string) => {
        if (!bundle || !isHostRef.current) return;
        const pid = peerPlayers.current.get(peerId);
        if (!pid) {
          sendError({ message: "Rejoin the room." }, peerId);
          return;
        }
        runCommand(pid, command, peerId);
      });

      onWire("error", errorAction, (data: { message: string }, peerId: string) => {
        if (isHostRef.current || (hostPeerRef.current && peerId !== hostPeerRef.current)) return;
        setJoinBusy(false);
        setJoinErr(data.message);
        showToast(data.message);
        playSound("error");
      });

      onWire("closed", closedAction, (_data: any, peerId: string) => {
        if (!isHostRef.current && peerId === hostPeerRef.current) setGone("The room was closed by the owner.");
      });

      const requestJoin = (force = false) => {
        const hostPeer = hostPeerRef.current;
        if (!hostPeer) return;
        const current = sessionRef.current;
        const requestedName = desiredName.current.trim();
        if (!current && !requestedName) return;
        // already at the table with this host: asking again would only make
        // extra copies of the same name
        if (!force && current && joinedHostRef.current === hostPeer && viewRef.current?.meId === current.pid) return;
        const data: JoinMessage = {
          name: current?.name || requestedName,
          pid: current?.pid,
          tok: current?.tok,
        };
        setJoinBusy(true);
        sendJoin(data, hostPeer);
        joinedHostRef.current = hostPeer;
      };
      sendJoinRef.current = requestJoin;

      pingRef.current = () => {
        const hostPeer = hostPeerRef.current;
        if (hostPeer) sendCommandWire({ type: "ping", nonce: nonce() }, hostPeer);
      };

      sendCommandRef.current = async (command) => {
        const hostPeer = hostPeerRef.current;
        if (!hostPeer) {
          showToast("No host right now. One moment…");
          playSound("error");
          return;
        }
        sendCommandWire(command, hostPeer);
      };

      closeRoomRef.current = async () => {
        sendClosed({ closed: true });
        clearHostRoom(code);
        clearSession(code);
        await room.leave();
      };

      room.onPeerJoin = (peerId) => {
        // say who we are at once, so a new arrival can be picked to run the
        // room without waiting a whole presence tick to learn about them
        announceRef.current?.();
        if (isHostRef.current) sendHostBeat(beatPayload(), peerId);
      };

      room.onPeerLeave = (peerId) => {
        directPeers.current.delete(peerId); // from here on it needs the relay
        presenceRef.current.forEach((c, pid) => { if (c.peerId === peerId) presenceRef.current.delete(pid); });
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
          // The socket we were talking to is gone, so this is a departure
          // rather than a hiccup: let the next browser take the room in about
          // a second instead of sitting out the whole host timeout. A beat
          // that still arrives over the relay refreshes it and nothing moves.
          const beat = hostBeatRef.current;
          if (beat) {
            hostBeatRef.current = {
              ...beat,
              at: Math.min(beat.at, Date.now() - (HOST_TTL_MS - HOST_LEAVE_GRACE_MS)),
            };
          }
          setNetworkNote("Host left. Passing the room to the next player…");
        }
      };

      // ------------------------------------------------ host election
      const monitor = () => {
        if (stopped) return;
        const now = Date.now();
        // forget peers that have gone quiet, so the maps cannot grow forever
        for (const [peerId, at] of directPeers.current) {
          if (now - at > HOST_TTL_MS) directPeers.current.delete(peerId);
        }

        const me = selfCandidate();
        const list = [...presenceRef.current.values()];
        if (me) list.push(me);
        const best = pickHost(list, now);

        if (isHostRef.current) {
          if (!bundle) return;
          // Someone with an earlier seat is here: hand the room over with the
          // live state rather than making them reconstruct it.
          if (best && best.pid !== bundle.localPid && best.peerId !== SELF &&
              isBetterHost(best, { joinedAt: joinedAtRef.current, pid: bundle.localPid })) {
            sendHandoffPacket({ state: bundle.state, version: bundle.version }, best.peerId);
            stopHosting();
          }
          return;
        }

        if (!best || !me || best.pid !== me.pid) { outrankSinceRef.current = 0; return; }
        const beat = hostBeatRef.current;
        const hostGone = !beat || now - beat.at > HOST_TTL_MS;
        if (hostGone) { claimHost(); return; }
        // The host is talking but no table is getting through: ask for the seat
        // again instead of sitting on a frozen room. Only for a browser that
        // still holds one - asking back would undo a departure.
        if (hostPeerRef.current && viewRef.current?.meId && now - lastViewAtRef.current > REJOIN_AFTER_MS) {
          lastViewAtRef.current = now;
          requestJoin(true);
        }
        // This browser is holding a table that has moved further than the
        // host's: offer it back, rather than let the room carry on from the
        // older copy and lose everything that happened on this one.
        const held = mirrorRef.current;
        if (held && beat.peerId !== SELF && now - syncPushRef.current > SYNC_PUSH_MS &&
            held.state.seq > beat.seq) {
          syncPushRef.current = now;
          sendMirrorCopy({ state: held.state, version: held.version }, beat.peerId);
        }
        // outranked the current host: give them a moment to hand it over
        if (isBetterHost(best, beat)) {
          if (!outrankSinceRef.current) outrankSinceRef.current = now;
          else if (now - outrankSinceRef.current > OUTRANK_PATIENCE_MS) { outrankSinceRef.current = 0; claimHost(); }
        } else outrankSinceRef.current = 0;
      };

      announceRef.current = () => {
        const me = selfCandidate();
        if (!me || !me.pid) return;
        sendPresenceMsg({ pid: me.pid, joinedAt: me.joinedAt, canHost: me.canHost, at: Date.now() });
      };
      presenceTimer = setInterval(() => announceRef.current?.(), PRESENCE_INTERVAL_MS);
      monitorTimer = setInterval(monitor, 1000);

      // ------------------------------------------------ starting up
      if (hostIntent) {
        // Whoever opened the room outranks everyone, so they can simply pick it
        // back up. They wait a beat first in case another browser is already
        // running it, which is when they get handed the freshest copy.
        const restored = loadHostState<HostBundle>(code);
        const seeds: MirrorMessage[] = [];
        if (restored?.state) seeds.push({ state: restored.state, version: Math.max(1, restored.version ?? 1) });
        if (restoredMirror?.state) seeds.push({ state: restoredMirror.state, version: Math.max(1, restoredMirror.version ?? 1) });
        seeds.sort((a, b) => (isNewerState(a.state, b.state) ? -1 : 1));
        const seed = seeds[0] ?? null;

        const state = seed ? normalizeState(seed.state) : createRoomState("classic");
        let owner = state.players.find((p) => p.isOwner);
        if (!owner) owner = addPlayer(state, hostIntent.name, false);
        joinedAtRef.current = owner.joinedAt ?? Date.now();
        const ownerSession: Session = { pid: owner.id, tok: owner.token, name: owner.name };
        saveSession(code, ownerSession);
        sessionRef.current = ownerSession;
        setSession(ownerSession);
        mirrorRef.current = { state, version: Math.max(1, seed?.version ?? 1) };

        const takeRoom = () => {
          if (stopped || isHostRef.current) return;
          if (!findPlayer(state, owner!.id)) return;
          // somebody else is already running the room: they will hand it over
          // (and if they never do, the monitor takes it back for us)
          const beat = hostBeatRef.current;
          if (beat && beat.pid !== owner!.id && Date.now() - beat.at <= HOST_TTL_MS) return;
          // a fresher copy may have landed while we were waiting
          const m = mirrorRef.current;
          const fresher = m && isNewerState(m.state, state);
          startHosting(
            normalizeState(fresher ? m.state : state),
            Math.max(1, (fresher ? m.version : seed?.version ?? 1) + 1),
            owner!.id,
          );
        };
        if (!restoredMirror) takeRoom();
        else claimTimer = setTimeout(takeRoom, CLAIM_DELAY_MS);
      } else {
        sessionRef.current = storedSession;
        setSession(storedSession);
      }

      if (!isHostRef.current) {
        joinTimer = setInterval(requestJoin, 2200);
        heartbeatTimer = setInterval(() => {
          const current = sessionRef.current;
          if (!current || !hostPeerRef.current) return;
          sendCommandWire({ type: "ping", nonce: nonce() }, hostPeerRef.current);
        }, 8000);
        noHostTimer = setTimeout(() => {
          if (viewRef.current || hostPeerRef.current) return;
          setNetworkNote(relayRef.current?.connected
            ? "Nobody is running this room right now. Check the code, or ask whoever opened it to come back."
            : "Cannot reach the room. Your network is blocking both peer-to-peer and the relay - try mobile data, or another network.");
        }, 10000);
      }

    })().catch(() => !stopped && setNetworkNote("WebRTC could not start in this browser."));

    return () => {
      stopped = true;
      window.removeEventListener("pagehide", onHide);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(tickTimer);
      clearInterval(snapshotTimer);
      clearInterval(helloTimer);
      clearInterval(mirrorTimer);
      clearInterval(presenceTimer);
      clearInterval(monitorTimer);
      clearInterval(joinTimer);
      clearInterval(heartbeatTimer);
      clearTimeout(claimTimer);
      clearTimeout(noHostTimer);
      sendJoinRef.current = null;
      sendCommandRef.current = null;
      pingRef.current = null;
      hostCommandRef.current = null;
      publishAllRef.current = null;
      stopHostingRef.current = null;
      handoffRef.current = null;
      announceRef.current = null;
      relayHandlers.current.clear();
      directPeers.current.clear();
      relayRef.current?.stop();
      relayRef.current = null;
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
    const current = sessionRef.current;
    const state = stateRef.current ?? mirrorRef.current?.state ?? null;
    const others = state ? state.players.filter((p) => !p.left && p.id !== current?.pid).length : 0;

    // step away from the seat, then pass the room on so nobody has to wait
    // for this browser to go quiet before the next one picks it up
    if (current) await act("leave");
    handoffRef.current?.();
    publishAllRef.current?.();
    stopHostingRef.current?.();

    if (isHostRef.current || others === 0) {
      // nobody left to hand the room to
      if (closeRoomRef.current) await closeRoomRef.current();
      else { clearHostRoom(code); clearSession(code); }
    } else {
      await roomRef.current?.leave().catch(() => {});
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

  // A participant can name themselves before the host is discovered. Existing
  // sessions reconnect automatically and retain the current game view.
  if (!isHost && !session && !view) {
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
        <p className="text-[13px] text-[var(--mut)] mt-3">{networkNote || "Connecting to the room…"}</p>
        <button className="btn ghost mt-5" onClick={() => router.push("/")}>Back</button>
      </Center>
    );
  }

  const kicked = view.meId === null && !view.iAmHost;
  if (kicked) {
    return (
      <Center>
        <h2 className="disp text-3xl">You left the table</h2>
        <div className="flex gap-2 mt-6">
          <button className="btn acc" onClick={() => { sendJoinRef.current?.(true); }}>Rejoin</button>
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
      {networkNote && (
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
