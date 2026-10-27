"use client";

// ─── UNOshima · encrypted relay mesh ────────────────────────────────────────
//
// Trystero/WebRTC stays the preferred transport. Some NATs cannot build ANY
// direct route without TURN, so this mirrors every packet through redundant
// public MQTT-over-WebSocket brokers (TLS on a web-friendly port: no UDP, no
// NAT traversal, works from behind a phone carrier or a corporate proxy).
//
// Brokers see only:
//   • an opaque SHA-256 topic
//   • AES-GCM ciphertext with an ECDSA signature
// They never see names, hands, chat, scores or room codes.
//
// Two keys are in play:
//   room key     - derived from the room code, used for broadcasts
//   pairwise key - ECDH between two peers, used for anything addressed to one
//                  peer (a hand, a seat token, an error). Everyone in the room
//                  can derive the room key, so nothing private may ride on it.
//
// Every envelope carries the sender's ECDH public key next to the ciphertext,
// signed along with it, so a reply can be sealed the moment a message lands and
// no handshake round trip is needed.

import { APP_ID, uid } from "./net";
import { MqttLite } from "./mqttlite";

export type RelayKind =
  | "host"      // the browser running the room announces itself   (broadcast)
  | "presence"  // who is here, and can they host                  (broadcast)
  | "join"      // ask for a seat                                  (to host)
  | "welcome"   // here is your seat                               (to peer)
  | "command"   // a game action                                   (to host)
  | "snapshot"  // your view of the table                          (to peer)
  | "mirror"    // a copy of the room, for the next host           (broadcast)
  | "handoff"   // the room, passed to the next host               (to peer)
  | "error"     // your action was refused                         (to peer)
  | "closed";   // the owner shut the room                         (broadcast)

interface PlainEnvelope {
  v: 1;
  id: string;
  from: string;
  target?: string;
  kind: RelayKind;
  sentAt: number;
  data: unknown;
}

interface CipherEnvelope {
  v: 2;
  pk: string;   // sender's ECDH public key (SPKI, base64)
  iv: string;
  body: string;
  pub: string;  // sender's signing key (SPKI, base64)
  sig: string;  // ECDSA P-256 over pk.iv.body
}

export interface RelayMessage {
  id: string;
  from: string;
  target?: string;
  kind: RelayKind;
  data: unknown;
}

interface BrokerState {
  url: string;
  ml: MqttLite;
  ready: boolean;
}

/**
 * Three entry points across independent operators. All are WSS on
 * HTTPS-friendly ports, so they slip past the firewalls that block WebRTC,
 * without opening five sockets on every low-end phone. Override with
 * NEXT_PUBLIC_RELAY_BROKERS (semicolon separated) to run your own broker.
 */
const DEFAULT_BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",      // EMQX
  "wss://broker.hivemq.com:8884/mqtt",   // HiveMQ
  "wss://test.mosquitto.org:8081/mqtt",  // Mosquitto (independent)
  "wss://broker-cn.emqx.io:8084/mqtt",   // EMQX alt ingress
  "wss://mqtt-dashboard.com:8884/mqtt",  // HiveMQ alt ingress
];

const BROKERS = (process.env.NEXT_PUBLIC_RELAY_BROKERS
  ? process.env.NEXT_PUBLIC_RELAY_BROKERS.split(";").map((u) => u.trim()).filter(Boolean)
  : DEFAULT_BROKERS).slice(0, 3);

/** kinds worth repeating: everything periodic or bulky is already retried */
const REPEAT = new Set<RelayKind>(["join", "welcome", "command", "handoff", "error", "closed", "host"]);
const REPEAT_DELAYS = [750, 2400];
/** how long a queued packet waits for a broker or a peer key */
const OUTBOX_TTL_MS = 20_000;
const MAX_PACKET = 1_000_000;

const bytesTo64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const b64ToBytes = (s: string) => {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

async function digest(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

async function roomKey(code: string): Promise<CryptoKey> {
  const material = await digest(`${APP_ID}:relay-key:${code.toUpperCase()}`);
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function roomTopic(code: string): Promise<string> {
  const hash = await digest(`${APP_ID}:relay-topic:${code.toUpperCase()}`);
  return `uno/${bytesTo64(hash.subarray(0, 20)).replace(/[+/=]/g, "")}`;
}

const SIG_ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIG_PARAMS = { name: "ECDSA", hash: "SHA-256" } as const;
const DH_ALG = { name: "ECDH", namedCurve: "P-256" } as const;

async function makeSigningKeys() {
  const pair = await crypto.subtle.generateKey(SIG_ALG, false, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { priv: pair.privateKey, pub: bytesTo64(spki) };
}

async function makeExchangeKeys() {
  const pair = await crypto.subtle.generateKey(DH_ALG, false, ["deriveKey"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { priv: pair.privateKey, pub: bytesTo64(spki) };
}

const verifyKeyCache = new Map<string, CryptoKey>();
async function importVerifyKey(pub: string): Promise<CryptoKey | null> {
  const hit = verifyKeyCache.get(pub);
  if (hit) return hit;
  try {
    const key = await crypto.subtle.importKey("spki", b64ToBytes(pub), SIG_ALG, false, ["verify"]);
    if (verifyKeyCache.size > 200) verifyKeyCache.clear();
    verifyKeyCache.set(pub, key);
    return key;
  } catch {
    return null;
  }
}

const signedBytes = (pk: string, iv: string, body: string) =>
  new TextEncoder().encode(`${pk}.${iv}.${body}`);

export class EncryptedRelay {
  private code: string;
  private self: string;
  private onMessage: (m: RelayMessage) => void;
  private onStatus: () => void;
  private key: CryptoKey | null = null;
  private topic = "";
  private brokers: BrokerState[] = [];
  private stopped = false;
  private seen = new Map<string, number>();
  private rxQueue: Promise<void> = Promise.resolve();
  private senderKeys = new Map<string, string>();
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private outbox: { kind: RelayKind; data: unknown; target?: string; id: string; at: number }[] = [];
  private signingKey: { priv: CryptoKey; pub: string } | null = null;
  private exchange: { priv: CryptoKey; pub: string } | null = null;
  private peerPublic = new Map<string, string>();
  private sharedKeys = new Map<string, CryptoKey>();

  constructor(
    code: string,
    self: string,
    onMessage: (m: RelayMessage) => void,
    onStatus: () => void,
  ) {
    this.code = code;
    this.self = self;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
  }

  get connected() { return this.brokers.some((b) => b.ready); }
  get connectedCount() { return this.brokers.filter((b) => b.ready).length; }

  async start() {
    try {
      const [key, topic, signing, exchange] = await Promise.all([
        roomKey(this.code),
        roomTopic(this.code),
        makeSigningKeys(),
        makeExchangeKeys(),
      ]);
      if (this.stopped) return;
      this.key = key;
      this.topic = topic;
      this.signingKey = signing;
      this.exchange = exchange;

      for (const url of BROKERS) {
        try {
          const ml = new MqttLite(url, { keepAlive: 20, connectTimeout: 9000 });
          const state: BrokerState = { url, ml, ready: false };
          this.brokers.push(state);

          ml.onLive = live => {
            if (this.stopped) return;
            const was = state.ready;
            state.ready = live;
            if (live && !was) this.flush();
            if (live !== was) this.onStatus();
          };
          ml.onMessage = payload => this.receive(payload);
          // subscribe() opens the socket and re-subscribes after every
          // reconnect, so this is the subscription and not only a listener.
          void ml.subscribe(topic);
        } catch { /* next broker */ }
      }

      this.presenceTimer = setInterval(() => {
        this.pruneSeen();
        this.pruneOutbox();
      }, 4000);
    } catch (err) {
      console.warn("[relay] unavailable; WebRTC still active", err);
    }
  }

  /**
   * Send a packet. Broadcasts ride the room key; anything addressed to one peer
   * is sealed with the pairwise key so the rest of the room cannot read it.
   */
  async send(kind: RelayKind, data: unknown, target?: string, id = uid(12)) {
    if (this.stopped) return id;
    if (!this.key || !this.signingKey || !this.exchange || !this.topic || !this.connected) {
      if (kind !== "presence") {
        this.outbox.push({ kind, data, target, id, at: Date.now() });
        if (this.outbox.length > 40) this.outbox.shift();
      }
      return id;
    }
    const key = target ? await this.peerKey(target) : this.key;
    if (!key) {
      // no exchange key for that peer yet: hold it until their next packet
      this.outbox.push({ kind, data, target, id, at: Date.now() });
      if (this.outbox.length > 40) this.outbox.shift();
      return id;
    }
    await this.broadcast(kind, data, target, id, key);
    if (REPEAT.has(kind)) {
      for (const delay of REPEAT_DELAYS) {
        setTimeout(() => {
          if (this.stopped || !this.key || !this.signingKey || !this.exchange) return;
          void this.broadcast(kind, data, target, id, key);
        }, delay);
      }
    }
    return id;
  }

  private async broadcast(
    kind: RelayKind,
    data: unknown,
    target: string | undefined,
    id: string,
    key: CryptoKey,
  ) {
    if (this.stopped || !this.signingKey || !this.exchange || !this.topic) return;
    const plain: PlainEnvelope = {
      v: 1, id, from: this.self, target, kind, sentAt: Date.now(), data,
    };
    const wire = await this.encrypt(key, plain);
    // Every packet goes to every ready broker. Volume here is small and it
    // removes the disjoint-ingress failure (my brokers ≠ your brokers).
    await Promise.allSettled(
      this.brokers.filter(b => b.ready).map(b => b.ml.publish(this.topic, wire, { qos: 1 })),
    );
  }

  private async encrypt(key: CryptoKey, plain: PlainEnvelope): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(plain));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    const ivB64 = bytesTo64(iv);
    const bodyB64 = bytesTo64(new Uint8Array(encrypted));
    const sig = new Uint8Array(await crypto.subtle.sign(
      SIG_PARAMS,
      this.signingKey!.priv,
      signedBytes(this.exchange!.pub, ivB64, bodyB64),
    ));
    const wire: CipherEnvelope = {
      v: 2,
      pk: this.exchange!.pub,
      iv: ivB64,
      body: bodyB64,
      pub: this.signingKey!.pub,
      sig: bytesTo64(sig),
    };
    return JSON.stringify(wire);
  }

  private receive(raw: Uint8Array) {
    // verify-and-pin must not race: WebCrypto is async and mirrored copies
    // would otherwise interleave against the sender-key compare-and-set
    this.rxQueue = this.rxQueue.then(() => this.process(raw).catch(() => undefined));
  }

  private async process(raw: Uint8Array) {
    if (this.stopped || !this.key) return;
    const verified = await this.decrypt(raw);
    if (!verified) return;
    const { msg, pub, pk } = verified;
    if (msg.from === this.self) return;
    if (msg.target && msg.target !== this.self) return;

    // Trust on first use: pin each sender to the signing key it first used, so
    // another member of the room cannot forge its identity (they all share the
    // room key, so encryption alone cannot stop impersonation).
    const pinned = this.senderKeys.get(msg.from);
    if (pinned && pinned !== pub) return;
    if (!pinned) this.senderKeys.set(msg.from, pub);

    const known = this.peerPublic.get(msg.from);
    if (known !== pk) {
      this.peerPublic.set(msg.from, pk);
      this.sharedKeys.delete(msg.from);
    }
    await this.peerKey(msg.from);
    // a fresh key may unblock packets that were waiting for it
    if (known !== pk) this.flush();

    if (this.seen.has(msg.id)) return; // mirrored across the relay mesh
    this.seen.set(msg.id, Date.now());
    this.onMessage({ id: msg.id, from: msg.from, target: msg.target, kind: msg.kind, data: msg.data });
  }

  private async decrypt(
    raw: Uint8Array,
  ): Promise<{ msg: PlainEnvelope; pub: string; pk: string } | null> {
    try {
      if (raw.byteLength > MAX_PACKET) return null;
      const wire = JSON.parse(new TextDecoder().decode(raw)) as CipherEnvelope;
      if (
        wire.v !== 2 || typeof wire.iv !== "string" || typeof wire.body !== "string" ||
        typeof wire.pub !== "string" || typeof wire.sig !== "string" || typeof wire.pk !== "string"
      ) return null;

      // verify BEFORE decrypting, so forged packets never reach the cipher
      const verifyKey = await importVerifyKey(wire.pub);
      if (!verifyKey) return null;
      const ok = await crypto.subtle.verify(
        SIG_PARAMS,
        verifyKey,
        b64ToBytes(wire.sig),
        signedBytes(wire.pk, wire.iv, wire.body),
      );
      if (!ok) return null;

      const msg = await this.open(b64ToBytes(wire.iv), b64ToBytes(wire.body), wire.pk);
      if (!msg) return null;
      const age = Date.now() - Number(msg.sentAt);
      if (!Number.isFinite(age) || age < -60_000 || age > 120_000) return null;
      return { msg, pub: wire.pub, pk: wire.pk };
    } catch {
      return null;
    }
  }

  /**
   * The sender lives inside the ciphertext, so a pairwise packet is opened by
   * trying the keys of the peers we know. Only the real sender's key produces a
   * valid AES-GCM tag, so this reveals nothing and cannot be spoofed.
   */
  private async open(iv: Uint8Array<ArrayBuffer>, body: Uint8Array<ArrayBuffer>, pk: string): Promise<PlainEnvelope | null> {
    const keys: CryptoKey[] = this.key ? [this.key] : [];
    // the sender's key off the envelope first: it is what lets a peer we have
    // never heard from be understood, and answered, on its very first packet
    const envelopeKey = await this.deriveShared(pk);
    if (envelopeKey) keys.push(envelopeKey);
    for (const peerId of this.peerPublic.keys()) {
      const shared = await this.peerKey(peerId);
      if (shared) keys.push(shared);
    }
    for (const key of keys) {
      const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body).catch(() => null);
      if (!clear) continue;
      try {
        const msg = JSON.parse(new TextDecoder().decode(clear)) as PlainEnvelope;
        if (msg && msg.v === 1 && typeof msg.id === "string" && typeof msg.from === "string") return msg;
      } catch { /* not this key */ }
    }
    return null;
  }

  private async deriveShared(pub: string): Promise<CryptoKey | null> {
    if (!this.exchange || !pub) return null;
    try {
      const their = await crypto.subtle.importKey("spki", b64ToBytes(pub), DH_ALG, false, []);
      return await crypto.subtle.deriveKey(
        { name: "ECDH", public: their },
        this.exchange.priv,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    } catch {
      return null;
    }
  }

  private async peerKey(peerId: string): Promise<CryptoKey | null> {
    const cached = this.sharedKeys.get(peerId);
    if (cached) return cached;
    const pub = this.peerPublic.get(peerId);
    if (!pub) return null;
    const shared = await this.deriveShared(pub);
    if (!shared) return null;
    if (this.sharedKeys.size > 64) this.sharedKeys.clear();
    this.sharedKeys.set(peerId, shared);
    return shared;
  }

  private flush() {
    if (!this.connected || !this.outbox.length || !this.key) return;
    const queued = this.outbox.splice(0);
    for (const q of queued) void this.send(q.kind, q.data, q.target, q.id);
  }

  private pruneOutbox() {
    const cutoff = Date.now() - OUTBOX_TTL_MS;
    this.outbox = this.outbox.filter(q => q.at > cutoff);
  }

  private pruneSeen() {
    const cutoff = Date.now() - 1000 * 60 * 5;
    for (const [id, at] of this.seen) if (at < cutoff) this.seen.delete(id);
  }

  stop() {
    this.stopped = true;
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    for (const b of this.brokers) {
      try { b.ml.end(); } catch { /* noop */ }
    }
    this.brokers = [];
    this.outbox = [];
    this.senderKeys.clear();
    this.peerPublic.clear();
    this.sharedKeys.clear();
  }
}
